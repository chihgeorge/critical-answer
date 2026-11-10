/* eslint-disable @typescript-eslint/no-explicit-any */
// 手動停頓 in the room (docs/designs/manual-pacing.md): in manual every pause the room times itself waits for the
// host's ▶ 下一步 (HOST_STEP); auto is as before; a switch either way moves the waiting step between the two.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DungeonRoom, FORK_BEAT_MS } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { FORK_MS } from "../game-state";
import { INITIATIVE_MS } from "../initiative";
import { FINISH_PODIUM_MS } from "../protocol";
import { parseSnapshot, SNAPSHOT_KEY } from "./snapshot";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TOKEN = "host-token-0123456789abcdef";
const KEY = "team-key-0123456789abcdef";
const BEAT_MS = 2000;
const LONG = 10 * 60_000;

const video = (id: string) => ({ kind: "text" as const, id, content: { kind: "youtube" as const, value: "dQw4w9WgXcQ" }, prompt: "這首歌是？", answer: `答案 ${id}` });
const mc = (id: string) => ({ kind: "multipleChoice" as const, id, content: { kind: "text" as const, value: `題目 ${id}` }, options: ["甲", "乙", "丙"], correctIndex: 1 });
/** Host-judged questions: forks, the kill and the podium. */
const textBank = parseBank({
  rooms: [0, 1, 2, 3].map((r) => ({ monster: "slime-soft", baseDifficulty: 1, reward: 10 * (r + 1), questions: [0, 1, 2, 3, 4, 5].map((i) => video(`r${r}-${i}`)) })),
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [video("boss-a"), video("boss-b")] },
});
/** Locked questions: the lock's beat, the dice, a boss miss, and a phase two misses use up. */
const mcBank = parseBank({
  rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [mc("r0-a"), mc("r0-b")] }],
  boss: { monster: "dragon", phases: [{ maxHp: 5, questions: [mc("p1-a"), mc("p1-b")] }, { name: "第二階段", rule: "規則", maxHp: 1, questions: [mc("p2-a"), mc("p2-b")] }] },
});

type Spy = ReturnType<typeof vi.fn>;
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: Spy };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const broadcasts = (room: DungeonRoom) => (room.room.broadcast as Spy).mock.calls.map((c) => JSON.parse(c[0]));
const state = (room: DungeonRoom) => broadcasts(room).filter((m) => m.type === "STATE").at(-1);
const sent = (conn: Conn) => (conn.send as unknown as Spy).mock.calls.map((c) => JSON.parse(c[0]));

function memoryStorage(): RoomStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), delete: async (k: string) => data.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } as never;
}
const makeIo = (storage?: RoomStorage) => ({ id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), ...(storage ? { storage } : {}) }) as unknown as RoomIO;

function setup(o: { bank?: typeof textBank; manual?: boolean; initiative?: boolean; storage?: RoomStorage; teams?: number; fixedDie?: number } = {}) {
  vi.useFakeTimers();
  const bank = o.bank ?? textBank;
  const room = new DungeonRoom(makeIo(o.storage), () => 0, { bank, e2eEventTeam: "EventTeam", epilogueDelayMs: 1000, ...(o.fixedDie ? { fixedDie: o.fixedDie } : {}) });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = [T1, T2].slice(0, o.teams ?? 2).map((id, i) => {
    const c = makeConn(`p${i}`);
    room.onConnect(c);
    send(room, c, { type: "JOIN", teamId: id, teamKey: KEY, teamName: i === 0 ? "EventTeam" : "Plain" });
    return c;
  });
  if (o.manual ?? true) send(room, host, { type: "HOST_PACING", mode: "manual" });
  send(room, host, { type: "HOST_START", ...(o.initiative ? { initiative: true } : {}) });
  return { room, host, phones };
}
type S = ReturnType<typeof setup>;

/** ▶ 下一步 on the hold the last STATE showed. */
const step = (s: S) => send(s.room, s.host, { type: "HOST_STEP", eventId: state(s.room).eventId, step: state(s.room).hold.id });
const pacing = (s: S, mode: "auto" | "manual") => send(s.room, s.host, { type: "HOST_PACING", mode });

/** The host judges team `i` right, then 上菜 and 下一題 (the cooking's hold skipped). */
function answerRight(s: S, i: number) {
  const t = s.room.game!.teams[i];
  send(s.room, s.host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(s.room).eventId });
  const eventId = state(s.room).eventId;
  send(s.room, s.host, { type: "HOST_SERVE", eventId });
  (s.room as any).servedAt = -Infinity;
  send(s.room, s.host, { type: "HOST_NEXT", eventId });
}
/** EventTeam answers right (fork), Plain answers right, and EventTeam stands before its doors. */
function toChoosing(s: S) {
  answerRight(s, 0);
  answerRight(s, 1);
}
/** The one team locks the question on show, right or wrong, and the host presses 公布答案. */
function lockAndReveal(s: S, right: boolean) {
  const id: string = state(s.room).question.id;
  const optionIndex = s.room.game!.optionOrder[id].indexOf(right ? 1 : 0);
  send(s.room, s.phones[0], { type: "TEAM_SELECT_OPTION", questionId: id, optionIndex });
  send(s.room, s.phones[0], { type: "TEAM_LOCK_OPTION", questionId: id });
  send(s.room, s.host, { type: "HOST_REVEAL", teamId: T1, questionId: id });
}
/** Every team in the boss room with 1 HP left in its last phase: the next 答對 is the kill. */
function toLastHit(s: S) {
  const g = s.room.game!;
  s.room.game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, phaseIndex: g.boss.phases.length - 1 } };
  send(s.room, s.host, { type: "HOST_JUDGE", teamId: T1, questionId: s.room.game.boss.currentQuestionId, correct: true });
}

afterEach(() => vi.useRealTimers());

describe("手動停頓: the switch", () => {
  it("auto is the default and says nothing in LOBBY or STATE; a lock's beat still resolves itself", () => {
    const s = setup({ bank: mcBank, manual: false, teams: 1, fixedDie: 10 });
    expect(broadcasts(s.room).some((m) => "pacing" in m || "hold" in m)).toBe(false);
    lockAndReveal(s, true);
    expect(state(s.room).hold).toBeUndefined();
    vi.advanceTimersByTime(BEAT_MS);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "crit" });
    vi.advanceTimersByTime(BEAT_MS);
    expect(state(s.room).reveal).not.toBeNull();
    expect(state(s.room).pacing).toBeUndefined();
  });

  it("the host switches in the lobby and mid-game; a phone cannot switch or step", () => {
    const s = setup({ bank: mcBank, teams: 1 });
    expect(broadcasts(s.room).filter((m) => m.type === "LOBBY").at(-1).pacing).toBe("manual");
    expect(state(s.room).pacing).toBe("manual");
    send(s.room, s.phones[0], { type: "HOST_PACING", mode: "auto" });
    expect(sent(s.phones[0]).at(-1)).toMatchObject({ type: "ERROR", error: "not_host" });
    lockAndReveal(s, true);
    send(s.room, s.phones[0], { type: "HOST_STEP", eventId: state(s.room).eventId, step: state(s.room).hold.id });
    expect(sent(s.phones[0]).at(-1)).toMatchObject({ type: "ERROR", error: "not_host" });
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    pacing(s, "auto");
    expect(state(s.room).pacing).toBeUndefined();
  });
});

describe("手動停頓: each pause waits for ▶ 下一步", () => {
  it("公布答案's beat, then the crit die: neither moves on by itself, each takes one step", () => {
    const s = setup({ bank: mcBank, teams: 1, fixedDie: 10 });
    lockAndReveal(s, true);
    expect(state(s.room).hold).toMatchObject({ kind: "lock" });
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    step(s);
    expect(state(s.room)).toMatchObject({ pendingLock: null, pendingRoll: { kind: "crit" }, hold: { kind: "roll" }, reveal: null });
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).reveal).toBeNull();
    step(s);
    expect(state(s.room).reveal).not.toBeNull();
    expect(state(s.room).hold).toBeUndefined();
  });

  it("a second press with the same ids, or an old eventId, runs nothing more", () => {
    const s = setup({ bank: mcBank, teams: 1, fixedDie: 10 });
    lockAndReveal(s, true);
    const { eventId, hold } = state(s.room);
    const press = (e: number, id: number) => send(s.room, s.host, { type: "HOST_STEP", eventId: e, step: id });
    press(eventId - 1, hold.id);
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    press(eventId, hold.id);
    press(eventId, hold.id); // the double press: the die's step has another id
    expect(state(s.room)).toMatchObject({ pendingRoll: { kind: "crit" }, reveal: null });
    expect(state(s.room).hold.id).not.toBe(hold.id);
  });

  it("a boss miss's red tile, and the phase card two misses bring", async () => {
    const s = setup({ bank: mcBank, teams: 1 });
    send(s.room, s.host, { type: "HOST_SEND_TO_BOSS", teamId: T1 });
    lockAndReveal(s, false);
    step(s); // the lock's beat
    expect(state(s.room).hold).toMatchObject({ kind: "boss-miss" });
    const seq = state(s.room).eventId;
    await vi.advanceTimersByTimeAsync(LONG);
    expect(s.room.game!.pendingWrong).not.toBeNull();
    expect(state(s.room).eventId).toBe(seq);
    step(s);
    expect(s.room.game!.pendingWrong).toBeNull();
    expect(state(s.room).question.id).toBe("p1-b");
    // The second miss uses the phase up: its card is due once the retry line is in, and then waits.
    lockAndReveal(s, false);
    step(s);
    step(s);
    await vi.advanceTimersByTimeAsync(0);
    expect(state(s.room)).toMatchObject({ phaseCardDue: true, hold: { kind: "phase-card" } });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room).phaseCard).toBeUndefined();
    step(s);
    expect(state(s.room).phaseCard).toBeTruthy();
    expect(state(s.room).hold).toBeUndefined();
  });

  it("擲先攻: no countdown; one step rolls for the teams left, the next starts the game", () => {
    const s = setup({ initiative: true });
    expect(state(s.room)).toMatchObject({ initiative: { untimed: true }, hold: { kind: "initiative" } });
    const first = state(s.room).hold;
    vi.advanceTimersByTime(INITIATIVE_MS * 4);
    expect(state(s.room).initiative.order).toBeUndefined();
    step(s);
    expect(state(s.room).initiative.order).toHaveLength(2);
    expect(state(s.room).hold.label).not.toBe(first.label);
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).question).toBeNull();
    step(s);
    expect(state(s.room).initiative).toBeUndefined();
    expect(state(s.room).question).not.toBeNull();
  });

  it("叉路: no door clock and no late press; a step is the timeout, and the open door waits for one more", () => {
    const s = setup();
    toChoosing(s);
    expect(state(s.room).forkLeft).toBeUndefined();
    expect(state(s.room).hold).toMatchObject({ kind: "fork" });
    vi.advanceTimersByTime(FORK_MS * 4);
    expect(s.room.game!.teams[0].fork?.phase).toBe("choosing");
    step(s);
    // rng 0 hides ⚔️ on the left: the same door the clock would open.
    expect(state(s.room).forkBeat).toEqual({ teamId: T1, side: "left", door: "monster", timeout: true });
    expect(state(s.room).hold).toMatchObject({ kind: "fork-beat" });
    vi.advanceTimersByTime(FORK_BEAT_MS * 20);
    expect(state(s.room).forkBeat).toBeDefined();
    step(s);
    expect(state(s.room).forkBeat).toBeUndefined();
    expect(state(s.room).question).not.toBeNull();
  });

  it("叉路: a team that picks long after the old 15 seconds still gets the side it pressed", () => {
    const s = setup();
    toChoosing(s);
    vi.advanceTimersByTime(FORK_MS * 4);
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "right", eventId: state(s.room).eventId });
    expect(state(s.room).forkBeat).toEqual({ teamId: T1, side: "right", door: "mystery" });
  });

  it("the kill's 4d20, then the podium: the reveal waits though its lines are in", async () => {
    const s = setup({ teams: 1 });
    toLastHit(s);
    expect(state(s.room)).toMatchObject({ pendingRoll: { kind: "kill" }, hold: { kind: "roll" }, phase: "playing" });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room).phase).toBe("playing");
    step(s);
    expect(state(s.room)).toMatchObject({ phase: "finished", hold: { kind: "podium" }, podium: { beats: null } });
    await vi.advanceTimersByTimeAsync(FINISH_PODIUM_MS + LONG);
    expect((s.room as any).epilogue).not.toBeNull();
    expect(state(s.room).podium.beats).toBeNull();
    step(s);
    expect(state(s.room).podium).toMatchObject({ elapsedMs: 0 });
    expect(state(s.room).podium.beats.length).toBeGreaterThan(0);
    expect(state(s.room).hold).toBeUndefined();
  });

  it("結束冒險 holds the podium too", async () => {
    const s = setup();
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room)).toMatchObject({ phase: "finished", hold: { kind: "podium" }, podium: { beats: null } });
    step(s);
    expect(state(s.room).podium.beats).not.toBeNull();
  });
});

describe("手動停頓: switching with a pause up", () => {
  it("manual to auto: the waiting beat runs its whole length again from the switch", () => {
    const s = setup({ bank: mcBank, teams: 1, fixedDie: 10 });
    lockAndReveal(s, true);
    vi.advanceTimersByTime(LONG);
    pacing(s, "auto");
    expect(state(s.room).hold).toBeUndefined();
    vi.advanceTimersByTime(BEAT_MS - 1);
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    vi.advanceTimersByTime(1);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "crit" });
  });

  it("manual to auto on a boss miss, and on an open door: each runs its beat again", () => {
    const s = setup({ bank: mcBank, teams: 1 });
    send(s.room, s.host, { type: "HOST_SEND_TO_BOSS", teamId: T1 });
    lockAndReveal(s, false);
    step(s);
    pacing(s, "auto");
    vi.advanceTimersByTime(BEAT_MS - 1);
    expect(s.room.game!.pendingWrong).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(s.room.game!.pendingWrong).toBeNull();

    const f = setup();
    toChoosing(f);
    step(f);
    pacing(f, "auto");
    vi.advanceTimersByTime(FORK_BEAT_MS - 1);
    expect(state(f.room).forkBeat).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(state(f.room).forkBeat).toBeUndefined();
  });

  it("manual to auto at a fork: a fresh 15 seconds, then the timeout", () => {
    const s = setup();
    toChoosing(s);
    vi.advanceTimersByTime(FORK_MS * 4);
    pacing(s, "auto");
    expect(state(s.room).forkLeft).toBe(FORK_MS);
    vi.advanceTimersByTime(FORK_MS - 1);
    expect(state(s.room).forkBeat).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(state(s.room).forkBeat).toMatchObject({ door: "monster", timeout: true });
  });

  it("manual to auto with the podium held: it starts after the usual pause", async () => {
    const s = setup();
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    pacing(s, "auto");
    expect(state(s.room).podium).toMatchObject({ elapsedMs: -1000 });
    expect(state(s.room).podium.beats).not.toBeNull();
  });

  it("auto to manual: a running beat and a running door clock stop and wait", () => {
    const s = setup({ bank: mcBank, manual: false, teams: 1, fixedDie: 10 });
    lockAndReveal(s, true);
    vi.advanceTimersByTime(BEAT_MS / 2);
    pacing(s, "manual");
    expect(state(s.room).hold).toMatchObject({ kind: "lock" });
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    step(s);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "crit" });

    const f = setup({ manual: false });
    toChoosing(f);
    pacing(f, "manual");
    vi.advanceTimersByTime(FORK_MS * 4);
    expect(f.room.game!.teams[0].fork?.phase).toBe("choosing");
    expect(state(f.room).forkLeft).toBeUndefined();
  });
});

describe("手動停頓: review cases (2026-11-09)", () => {
  it("HOST_STEP does nothing in auto: the beat keeps its own time", () => {
    const s = setup({ bank: mcBank, manual: false, teams: 1, fixedDie: 10 });
    lockAndReveal(s, true);
    const id = (s.room as any).steps.get("lock").id;
    send(s.room, s.host, { type: "HOST_STEP", eventId: state(s.room).eventId, step: id });
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    vi.advanceTimersByTime(BEAT_MS);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "crit" });
  });

  it("auto to manual on a finished game: an unstarted podium is held, one already playing plays on", async () => {
    const s = setup({ manual: false });
    send(s.room, s.host, { type: "HOST_END_GAME" });
    pacing(s, "manual");
    expect(state(s.room)).toMatchObject({ hold: { kind: "podium" }, podium: { beats: null } });

    const p = setup({ manual: false });
    send(p.room, p.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    pacing(p, "manual");
    expect(state(p.room).hold).toBeUndefined();
    expect(state(p.room).podium.beats).not.toBeNull();
  });

  it("manual to auto in 擲先攻: a fresh countdown, then the room rolls", () => {
    const s = setup({ initiative: true });
    vi.advanceTimersByTime(INITIATIVE_MS * 4);
    pacing(s, "auto");
    expect(state(s.room).initiative).toMatchObject({ left: INITIATIVE_MS });
    expect(state(s.room).initiative.untimed).toBeUndefined();
    vi.advanceTimersByTime(INITIATIVE_MS);
    expect(state(s.room).initiative.order).toHaveLength(2);
  });

  it("manual to auto after a kill: the podium still waits for the boss to cook", async () => {
    const s = setup({ teams: 1 });
    toLastHit(s);
    step(s);
    pacing(s, "auto");
    await vi.advanceTimersByTimeAsync(0);
    expect((s.room as any).revealFrom).toBe(Date.now() + FINISH_PODIUM_MS);
  });

  it("a podium step pressed while the boss cooks starts the reveal after the cooking", () => {
    const s = setup({ teams: 1 });
    toLastHit(s);
    step(s);
    step(s);
    expect(state(s.room).hold).toBeUndefined();
    expect((s.room as any).revealFrom).toBe(Date.now() + FINISH_PODIUM_MS);
  });

  it("回到大廳 drops a held podium: the next game's STATE has no hold", async () => {
    const s = setup();
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    send(s.room, s.host, { type: "HOST_BACK_TO_LOBBY" });
    expect((s.room as any).revealHold).toBeNull();
    send(s.room, s.host, { type: "HOST_START" });
    expect(state(s.room).pacing).toBe("manual");
    expect(state(s.room).hold).toBeUndefined();
  });
});

describe("手動停頓: a restart, and what never leaves the room", () => {
  async function restored(storage: RoomStorage, bank = textBank) {
    const room = new DungeonRoom(makeIo(storage), () => 0, { bank, epilogueDelayMs: 1000 });
    expect(await room.restore()).toBe("restored");
    const host = makeConn("host2");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    const last = () => state(room) ?? sent(host).filter((m) => m.type === "STATE").at(-1);
    return { room, host, last };
  }

  it("the mode is saved, and a fork's hold is there again after a restart", async () => {
    const storage = memoryStorage();
    const s = setup({ storage });
    toChoosing(s);
    await vi.advanceTimersByTimeAsync(0);
    const r = await restored(storage);
    expect(r.last()).toMatchObject({ pacing: "manual", hold: { kind: "fork" } });
    await vi.advanceTimersByTimeAsync(FORK_MS * 4);
    expect(r.room.game!.teams[0].fork?.phase).toBe("choosing");
    send(r.room, r.host, { type: "HOST_STEP", eventId: r.last().eventId, step: r.last().hold.id });
    expect(r.room.game!.teams[0].forks).toEqual([{ side: "left", door: "monster", timeout: true }]);
  });

  it("a boss miss waits again after a restart, and a press from before the restart names no step", async () => {
    const storage = memoryStorage();
    const s = setup({ bank: mcBank, teams: 1, storage });
    send(s.room, s.host, { type: "HOST_SEND_TO_BOSS", teamId: T1 });
    lockAndReveal(s, false);
    step(s);
    const before = state(s.room);
    await vi.advanceTimersByTimeAsync(0);
    const r = await restored(storage, mcBank);
    expect(r.last()).toMatchObject({ pacing: "manual", hold: { kind: "boss-miss" } });
    send(r.room, r.host, { type: "HOST_STEP", eventId: before.eventId, step: before.hold.id });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(r.room.game!.pendingWrong).not.toBeNull();
    send(r.room, r.host, { type: "HOST_STEP", eventId: r.last().eventId, step: r.last().hold.id });
    expect(r.room.game!.pendingWrong).toBeNull();
  });

  it("擲先攻 and a held podium wait again after a restart", async () => {
    const a = memoryStorage();
    setup({ storage: a, initiative: true });
    await vi.advanceTimersByTimeAsync(0);
    const ini = await restored(a);
    await vi.advanceTimersByTimeAsync(INITIATIVE_MS * 4);
    expect(ini.last()).toMatchObject({ hold: { kind: "initiative" } });
    expect((ini.room as any).initiative.order).toBeUndefined();

    const b = memoryStorage();
    const s = setup({ storage: b });
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    const fin = await restored(b);
    expect(fin.last()).toMatchObject({ hold: { kind: "podium" }, podium: { beats: null } });
    send(fin.room, fin.host, { type: "HOST_STEP", eventId: fin.last().eventId, step: fin.last().hold.id });
    expect(state(fin.room).podium.beats).not.toBeNull();
  });

  it("a save from before the switch, or a damaged one, is auto", async () => {
    const storage = memoryStorage();
    setup({ storage, manual: false });
    await vi.advanceTimersByTimeAsync(0);
    const saved = storage.data.get(SNAPSHOT_KEY) as Record<string, unknown>;
    expect("pacing" in saved).toBe(false);
    expect(parseSnapshot(saved)?.pacing).toBeUndefined();
    expect(parseSnapshot({ ...saved, pacing: "fast", revealHeld: 1 })).toMatchObject({ pacing: undefined, revealHeld: undefined });
    expect(parseSnapshot({ ...saved, pacing: "manual" })?.pacing).toBe("manual");
  });

  it("which side hides ⚔️ reaches nobody: not in a STATE, not in the hold's label", () => {
    const s = setup();
    toChoosing(s);
    expect(s.room.game!.teams[0].fork).toMatchObject({ phase: "choosing", monsterSide: "left" });
    expect(state(s.room).hold.label).not.toMatch(/左|右|怪物|神秘/);
    pacing(s, "auto");
    pacing(s, "manual");
    const told = [...[s.host, ...s.phones].flatMap((c) => (c.send as unknown as Spy).mock.calls.map((x) => x[0] as string)), ...(s.room.room.broadcast as Spy).mock.calls.map((x) => x[0] as string)];
    expect(told.some((m) => m.includes("monsterSide"))).toBe(false);
  });
});
