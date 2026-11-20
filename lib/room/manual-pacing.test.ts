/* eslint-disable @typescript-eslint/no-explicit-any */
// 手動停頓 in the room (docs/designs/manual-pacing.md): in manual every pause the room times itself waits for the
// host's ▶ 下一步 (HOST_STEP); auto is as before; a switch either way moves the waiting step between the two.
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendSettled } from "./test-send";
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
const send = (room: DungeonRoom, conn: Conn, msg: object) => sendSettled(room, conn, msg);
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
/** ▶ 下一步, unsettled: a step that starts the dish die leaves it in its beat (the next step lands it). */
const step = (s: S) => s.room.onMessage(JSON.stringify({ type: "HOST_STEP", eventId: state(s.room).eventId, step: state(s.room).hold.id }), s.host);
/** 🎲 擲料理骰: the host's HOST_NEXT under a correct answer's reveal rolls its dish die (not landed, unlike `send`). */
const roll = (s: S) => s.room.onMessage(JSON.stringify({ type: "HOST_NEXT", eventId: state(s.room).eventId }), s.host);
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
    // The answer and its explanation first: the reveal waits for the host's 🎲 擲料理骰, in auto too.
    expect(state(s.room).reveal).toMatchObject({ dishNext: true });
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).pendingRoll).toBeNull();
    roll(s);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "dish" });
    vi.advanceTimersByTime(BEAT_MS);
    expect(state(s.room).reveal).toMatchObject({ scored: { teamId: T1 } });
    expect(state(s.room).reveal.dishNext).toBeUndefined();
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
  it("公布答案's beat, then the dish die: neither moves on by itself, each takes one step", () => {
    const s = setup({ bank: mcBank, teams: 1, fixedDie: 10 });
    lockAndReveal(s, true);
    expect(state(s.room).hold).toMatchObject({ kind: "lock" });
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    step(s);
    // The answer's reveal is not a step: it waits for 🎲 擲料理骰, then the die's beat is one.
    expect(state(s.room)).toMatchObject({ pendingLock: null, pendingRoll: null, reveal: { dishNext: true } });
    expect(state(s.room).hold).toBeUndefined();
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).pendingRoll).toBeNull();
    roll(s);
    expect(state(s.room)).toMatchObject({ pendingRoll: { kind: "dish" }, hold: { kind: "roll" }, reveal: { dishNext: true } });
    vi.advanceTimersByTime(LONG);
    expect(state(s.room).reveal.scored).toBeUndefined();
    step(s);
    expect(state(s.room).reveal).toMatchObject({ scored: { teamId: T1 } });
    expect(state(s.room).hold).toBeUndefined();
  });

  it("a second press with the same ids, or an old eventId, runs nothing more", () => {
    const s = setup({ bank: mcBank, teams: 1, fixedDie: 10 });
    lockAndReveal(s, true);
    const { eventId, hold } = state(s.room);
    const press = (e: number, id: number) => s.room.onMessage(JSON.stringify({ type: "HOST_STEP", eventId: e, step: id }), s.host);
    press(eventId - 1, hold.id);
    expect(state(s.room).pendingLock).toMatchObject({ revealing: true });
    press(eventId, hold.id);
    press(eventId, hold.id); // the double press: no step is up under the answer's reveal
    expect(state(s.room)).toMatchObject({ pendingRoll: null, reveal: { dishNext: true } });
    expect(state(s.room).hold).toBeUndefined();
    roll(s);
    roll(s); // 🎲 擲料理骰 pressed twice rolls one die
    expect(state(s.room).hold.id).not.toBe(hold.id);
    step(s);
    expect(state(s.room)).toMatchObject({ pendingRoll: null, reveal: { scored: { teamId: T1 } } });
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
    send(s.room, s.host, { type: "HOST_NEXT", eventId: state(s.room).eventId });
    // The second miss uses the phase up: its card is due once the retry line is in, and then waits.
    lockAndReveal(s, false);
    step(s);
    step(s);
    expect(state(s.room).reveal).toMatchObject({ questionId: "p1-b" });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room).phaseCard).toBeUndefined();
    send(s.room, s.host, { type: "HOST_NEXT", eventId: state(s.room).eventId });
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

  it("叉路: a team that picks long after the old 15 seconds still gets the side it pressed", () => { // pregate-literal: CHEF_BONUS_PERCENT=15 the fork's old seconds, not the chef
    const s = setup();
    toChoosing(s);
    vi.advanceTimersByTime(FORK_MS * 4);
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "right", eventId: state(s.room).eventId });
    expect(state(s.room).forkBeat).toEqual({ teamId: T1, side: "right", door: "mystery" });
  });

  it("the kill's 4d20, then the podium: the reveal waits though its lines are in", async () => {
    const s = setup({ teams: 1 });
    toLastHit(s);
    expect(state(s.room)).toMatchObject({ stageBeat: "kill-defeated", pendingRoll: { kind: "kill" }, hold: { kind: "kill-defeated" } });
    step(s);
    expect(state(s.room)).toMatchObject({ pendingRoll: { kind: "kill" }, hold: { kind: "roll" }, phase: "playing", view: { bossHp: 0 } });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room).phase).toBe("playing");
    step(s);
    expect(state(s.room)).toMatchObject({ phase: "finished", hold: { kind: "podium" }, podium: { step: -1 } });
    await vi.advanceTimersByTimeAsync(FINISH_PODIUM_MS + LONG);
    expect((s.room as any).epilogue).not.toBeNull();
    expect(state(s.room).podium.step).toBe(-1);
    step(s);
    expect(state(s.room).podium).toMatchObject({ elapsedMs: 0 });
    expect(state(s.room).podium.beats.length).toBeGreaterThan(0);
    expect(state(s.room).hold).toMatchObject({ kind: "podium" });
  });

  it("結束冒險 holds the podium too", async () => {
    const s = setup();
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room)).toMatchObject({ phase: "finished", hold: { kind: "podium" }, podium: { step: -1 } });
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
    expect(state(s.room).reveal).toMatchObject({ dishNext: true });
    roll(s);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "dish" });
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

  it("manual to auto at a fork: a fresh 15 seconds, then the timeout", () => { // pregate-literal: CHEF_BONUS_PERCENT=15 not the chef share
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

  it("manual to auto with the podium held: it still waits for the host", async () => {
    const s = setup();
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    pacing(s, "auto");
    expect(state(s.room).podium).toMatchObject({ step: -1 });
    expect(state(s.room).podium.step).toBe(-1);
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
    roll(s);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "dish" });

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
    expect(state(s.room).reveal).toMatchObject({ dishNext: true });
    roll(s);
    expect(state(s.room).pendingRoll).toMatchObject({ kind: "dish" });
  });

  it("auto to manual on a finished game: awards always wait for the host", async () => {
    const s = setup({ manual: false });
    send(s.room, s.host, { type: "HOST_END_GAME" });
    pacing(s, "manual");
    expect(state(s.room)).toMatchObject({ hold: { kind: "podium" }, podium: { step: -1 } });

    const p = setup({ manual: false });
    send(p.room, p.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    pacing(p, "manual");
    expect(state(p.room).hold).toMatchObject({ kind: "podium" });
    expect(state(p.room).podium.step).toBe(-1);
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
    step(s);
    pacing(s, "auto");
    await vi.advanceTimersByTimeAsync(0);
    expect((s.room as any).revealFrom).toBe(Date.now() + FINISH_PODIUM_MS);
  });

  it("a podium step pressed while the boss cooks waits for the host to press after cooking", () => {
    const s = setup({ teams: 1 });
    toLastHit(s);
    step(s);
    step(s);
    step(s);
    expect(state(s.room).hold).toMatchObject({ kind: "podium" });
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
    expect(fin.last()).toMatchObject({ hold: { kind: "podium" }, podium: { step: -1 } });
    send(fin.room, fin.host, { type: "HOST_STEP", eventId: fin.last().eventId, step: fin.last().hold.id });
    expect(state(fin.room).podium.beats).not.toBeNull();
  });

  it("a finished, held save from before host-stepped awards still waits at the first podium beat", async () => {
    const b = memoryStorage();
    const s = setup({ storage: b });
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    delete (b.data.get(SNAPSHOT_KEY) as Record<string, unknown>).podiumStep;
    const fin = await restored(b);
    expect(fin.last()).toMatchObject({ hold: { kind: "podium" }, podium: { step: -1 } });
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

describe("#364: 飽足感 waits for 上菜", () => {
  it("the stage shows the answer's 飽足感 only once the dish is served", () => {
    const s = setup();
    const t = s.room.game!.teams[0];
    send(s.room, s.host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(s.room).eventId });
    const before = state(s.room);
    expect(before.reveal.dish).toBeTruthy();
    expect(before.view.teams[0].reward).toBe(0);
    expect(s.room.game!.teams[0].reward).toBe(10); // scored when judged, shown later
    send(s.room, s.host, { type: "HOST_SERVE", eventId: before.eventId });
    expect(state(s.room).view.teams[0].reward).toBe(10);
  });
});

describe("#364: beats that hold the turn", () => {
  // Value: protects=a kill judged at once (a finishing blow rolls no dish die) keeps its team on turn when its phone dropped
  // during the lock (/review); fails_when=resolveLock syncs the team offline and resolveRoll drops the kill as "turn moved on"
  it("finishing blow: a phone that dropped during the lock still lands the kill", () => {
    const s = setup({ bank: mcBank, teams: 2 });
    const g = s.room.game!;
    s.room.game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, phaseIndex: g.boss.phases.length - 1 } };
    const turn = s.room.game.turnOrder[s.room.game.currentTurnIndex];
    const phone = s.phones[[T1, T2].indexOf(turn)];
    const id = s.room.game.boss.currentQuestionId!;
    send(s.room, phone, { type: "TEAM_SELECT_OPTION", questionId: id, optionIndex: s.room.game.optionOrder[id].indexOf(1) });
    send(s.room, phone, { type: "TEAM_LOCK_OPTION", questionId: id });
    send(s.room, s.host, { type: "HOST_REVEAL", teamId: turn, questionId: id });
    s.room.onClose(phone);
    step(s); // the lock's beat: judged at once, no dish die
    expect(state(s.room)).toMatchObject({ stageBeat: "kill-defeated", hold: { kind: "kill-defeated" } });
    step(s); // the defeat beat, then the 4d20
    step(s);
    expect(s.room.game!.phase).toBe("finished");
    expect(s.room.game!.boss.hp).toBe(0);
  });

  it("a passed check holds its beat in manual until 下一步, then the question shows", () => {
    const s = setup({ teams: 1, fixedDie: 18 });
    // The check rolled itself at the start, and its die landed (sendSettled).
    expect(state(s.room)).toMatchObject({ stageBeat: "check-success", hold: { kind: "check-success" }, question: null });
    step(s);
    expect(state(s.room).stageBeat).toBeUndefined();
    expect(state(s.room).hold).toBeUndefined();
    expect(state(s.room).question.id).toBe(s.room.game!.teams[0].currentQuestionId);
  });
});

describe("host-controlled turns and awards (#366)", () => {
  it("only a current host skip moves an away team, keeping its question and scores", () => {
    const s = setup({ manual: false });
    const before = s.room.game!.teams[0];
    s.room.onClose(s.phones[0]);
    expect(state(s.room).view.currentTurnTeamId).toBe(T1);
    const msg = { type: "HOST_SKIP_TURN", teamId: T1, eventId: state(s.room).eventId };
    send(s.room, s.phones[1], msg);
    expect(sent(s.phones[1]).at(-1)).toMatchObject({ error: "not_host" });
    send(s.room, s.host, { ...msg, eventId: msg.eventId + 1 });
    expect(state(s.room).view.currentTurnTeamId).toBe(T1);
    send(s.room, s.host, msg);
    expect(state(s.room).view.currentTurnTeamId).toBe(T2);
    expect(s.room.game!.teams[0]).toMatchObject({ currentQuestionId: before.currentQuestionId, reward: before.reward, score: before.score });
    expect(state(s.room).reveal).toBeNull();
    send(s.room, s.host, msg); // buffered double click
    expect(state(s.room).view.currentTurnTeamId).toBe(T2);
    send(s.room, s.host, { type: "HOST_SKIP_TURN", teamId: T2, eventId: state(s.room).eventId });
    expect(state(s.room).view.currentTurnTeamId).toBe(T1);
  });

  it("a skip cannot discard a pending answer lock or its reveal", () => {
    const s = setup({ bank: mcBank });
    lockAndReveal(s, true);
    const skip = () => s.room.onMessage(JSON.stringify({ type: "HOST_SKIP_TURN", teamId: state(s.room).view.currentTurnTeamId, eventId: state(s.room).eventId }), s.host);
    skip();
    expect(state(s.room).view.currentTurnTeamId).toBe(T1);
    expect(state(s.room).pendingLock).toBeTruthy();
    step(s);
    skip(); // the answer's reveal before its dish die holds the turn too
    expect(state(s.room).reveal).toMatchObject({ dishNext: true });
    expect(state(s.room).view.currentTurnTeamId).toBe(T1);
    roll(s);
    skip();
    expect(state(s.room).pendingRoll).toBeTruthy();
    step(s);
    const game = s.room.game;
    skip();
    expect(s.room.game).toBe(game);
    expect(state(s.room).reveal).toBeTruthy();
  });

  it("a skip cannot throw away a typed answer waiting for the host's judgment", () => {
    const s = setup({ manual: false });
    s.room.game = { ...s.room.game!, teams: s.room.game!.teams.map((t) => (t.id === T1 ? { ...t, typedAnswer: "台北市" } : t)) };
    const game = s.room.game;
    send(s.room, s.host, { type: "HOST_SKIP_TURN", teamId: T1, eventId: state(s.room).eventId });
    expect(s.room.game).toBe(game);
  });

  it.each(["flee", "switch"])("%s reveals and retires the abandoned question until the host continues", (fleeChoice) => {
    const s = setup({ manual: false });
    const questionId = s.room.game!.teams[0].currentQuestionId;
    send(s.room, s.host, { type: "HOST_JUDGE", teamId: T1, questionId, correct: false, fleeChoice });
    expect(state(s.room).reveal).toMatchObject({ questionId, answer: `答案 ${questionId}` });
    expect(s.room.game!.revealedQuestionIds).toContain(questionId);
    expect(s.room.game!.teams.every((t) => t.currentQuestionId !== questionId)).toBe(true);
    const next = s.room.game;
    send(s.room, s.host, { type: "HOST_SKIP_TURN", teamId: T2, eventId: state(s.room).eventId });
    expect(s.room.game).toBe(next);
    send(s.room, s.host, { type: "HOST_NEXT", eventId: state(s.room).eventId });
    expect(state(s.room).reveal).toBeNull();
  });

  it("auto-paced awards need one host press per beat, survive restart, and ignore duplicate presses", async () => {
    const storage = memoryStorage();
    const s = setup({ manual: false, storage });
    send(s.room, s.host, { type: "HOST_END_GAME" });
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room).podium.step).toBe(-1);
    const firstPress = { type: "HOST_STEP", eventId: state(s.room).eventId, step: state(s.room).hold.id };
    send(s.room, s.phones[0], firstPress);
    expect(state(s.room).podium.step).toBe(-1);
    send(s.room, s.host, firstPress);
    send(s.room, s.host, firstPress);
    expect(state(s.room).podium.step).toBe(0);
    await vi.advanceTimersByTimeAsync(LONG);
    expect(state(s.room).podium.step).toBe(0);
    const room = new DungeonRoom(makeIo(storage), () => 0, { bank: textBank });
    expect(await room.restore()).toBe("restored");
    const host = makeConn("new-host");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    const peek = () => state(room) ?? sent(host).filter((m) => m.type === "STATE").at(-1);
    expect(peek().podium.step).toBe(0);
    for (let i = 1; i <= peek().podium.beats.length; i++) {
      const current = peek();
      send(room, host, { type: "HOST_STEP", eventId: current.eventId, step: current.hold.id });
      expect(peek().podium.step).toBe(i);
    }
    expect(peek().hold).toBeUndefined();
  });
});
