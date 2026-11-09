// 岔路 in the room (docs/designs/branch-fork.md): the roll after a correct answer, the door clock that starts on the
// team's turn, ⚔️ / ❓ / timeout, the door opening (forkBeat) and what STATE shows meanwhile, and a restart.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DungeonRoom, FORK_BEAT_MS } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import type { NarrationProvider } from "../narration/scripted";
import { parseBank } from "../question-bank";
import { currentTurnTeamId, FORK_MS } from "../game-state";
import { SNAPSHOT_KEY } from "./snapshot";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TOKEN = "host-token-0123456789abcdef";
const KEY = "team-key-0123456789abcdef";
// Video questions: the host judges them, and a video tells whether the big screen would start one under a door.
const video = (id: string) => ({ kind: "text" as const, id, content: { kind: "youtube" as const, value: "dQw4w9WgXcQ" }, prompt: "這首歌是？", answer: `答案 ${id}` });
const bank = parseBank({
  rooms: [0, 1, 2, 3].map((r) => ({ monster: "slime-soft", baseDifficulty: 1, reward: 10 * (r + 1), questions: [0, 1, 2, 3, 4, 5].map((i) => video(`r${r}-${i}`)) })),
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [video("boss-a"), video("boss-b")] },
});

type Spy = ReturnType<typeof vi.fn>;
function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: Spy };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const broadcasts = (room: DungeonRoom) => (room.room.broadcast as Spy).mock.calls.map((c) => JSON.parse(c[0]));
const state = (room: DungeonRoom) => broadcasts(room).filter((m) => m.type === "STATE").at(-1);
const narrations = (room: DungeonRoom) => broadcasts(room).filter((m) => m.type === "NARRATION");
const lastSent = (conn: Conn) => JSON.parse((conn.send as unknown as Spy).mock.calls.at(-1)![0]);
const sentStates = (conn: Conn) => (conn.send as unknown as Spy).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE");

function memoryStorage(): RoomStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), delete: async (k: string) => data.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } as never;
}

function setup(opts: { eventTeam?: string | null; rng?: () => number; storage?: RoomStorage; teams?: number; provider?: NarrationProvider } = {}) {
  const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), ...(opts.storage ? { storage: opts.storage } : {}) } as unknown as RoomIO;
  const room = new DungeonRoom(io, opts.rng ?? (() => 0), { bank, ...(opts.eventTeam === null ? {} : { e2eEventTeam: opts.eventTeam ?? "EventTeam" }), epilogueDelayMs: 0, ...(opts.provider ? { provider: opts.provider } : {}) });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const ids = [T1, T2].slice(0, opts.teams ?? 2);
  const phones = ids.map((_, i) => makeConn(`p${i}`));
  ids.forEach((id, i) => {
    room.onConnect(phones[i]);
    send(room, phones[i], { type: "JOIN", teamId: id, teamKey: KEY, teamName: i === 0 ? "EventTeam" : "Plain" });
  });
  send(room, host, { type: "HOST_START" });
  return { room, host, phones };
}
type S = ReturnType<typeof setup>;

/** The host judges team `i` right, then 上菜 and 下一題 (the cooking's hold skipped). */
function answerRight(s: S, i: number, next = true) {
  const { room, host } = s;
  const t = room.game!.teams[i];
  send(room, host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(room).eventId });
  if (!next) return;
  const eventId = state(room).eventId;
  send(room, host, { type: "HOST_SERVE", eventId });
  (room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(room, host, { type: "HOST_NEXT", eventId });
}

/** EventTeam answers right (fork), Plain answers right, and EventTeam's door clock starts. */
function toChoosing(s: S) {
  answerRight(s, 0);
  answerRight(s, 1);
}

const choose = (s: S, door: "monster" | "mystery", phone = 0) => send(s.room, s.phones[phone], { type: "TEAM_CHOOSE_FORK", door, eventId: state(s.room).eventId });

afterEach(() => {
  vi.useRealTimers();
});

describe("岔路 in the room", () => {
  // Value: protects=a fork waits for its team's turn and hides everything behind the doors; fails_when=the fork draws
  // an event early, the clock starts under a reveal, or the question leaks; no_claim=which event is drawn.
  it("a correct answer brings the fork team to a fork: waiting, no clock, nothing drawn; its clock starts on its turn after 下一題", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room } = s;
    answerRight(s, 0, false);
    expect(room.game!.teams[0].fork).toEqual({ phase: "waiting" });
    expect(room.game!.teams[0].event).toBeUndefined();
    // Its own reveal is up: no clock yet.
    expect(state(room).forkLeft).toBeUndefined();
    const first = state(room).eventId;
    send(room, s.host, { type: "HOST_SERVE", eventId: first });
    (room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(room, s.host, { type: "HOST_NEXT", eventId: first });
    answerRight(s, 1, false);
    // Plain's reveal is up and it is EventTeam's turn: still no clock under the reveal.
    expect(currentTurnTeamId(room.game!)).toBe(T1);
    expect(room.game!.teams[0].fork).toEqual({ phase: "waiting" });
    expect(state(room).view.teams[0].fork).toBe("waiting");
    const eventId = state(room).eventId;
    send(room, s.host, { type: "HOST_SERVE", eventId });
    (room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(room, s.host, { type: "HOST_NEXT", eventId });
    expect(room.game!.teams[0].fork).toEqual({ phase: "choosing", deadline: Date.now() + FORK_MS });
    const st = state(room);
    expect(st.forkLeft).toBe(FORK_MS);
    expect(st.question).toBeNull();
    expect(st.view.teams[0].fork).toBe("choosing");
    expect(st.answerClock).toBeUndefined();
    // The line before the turn is the neutral door line: no monster, no scene.
    await vi.advanceTimersByTimeAsync(10);
    expect(narrations(room).at(-1).lines.join("")).toMatch(/兩扇門|岔路|兩條/);
  });

  it("a team at a fork cannot answer, lock, roll, drink or use an ability; the host cannot judge it", () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host, phones } = s;
    toChoosing(s);
    const q = room.game!.teams[0].currentQuestionId;
    send(room, phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "x", eventId: state(room).eventId });
    expect(lastSent(phones[0])).toMatchObject({ type: "ERROR" });
    send(room, phones[0], { type: "TEAM_ROLL_CHECK", questionId: q, eventId: state(room).eventId });
    expect(lastSent(phones[0])).toMatchObject({ type: "ERROR", detail: "fork" });
    send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: q, correct: true, eventId: state(room).eventId });
    expect(lastSent(host)).toMatchObject({ type: "ERROR", detail: "fork" });
    expect(room.game!.teams[0].fork?.phase).toBe("choosing");
  });

  it("⚔️: the door opens for FORK_BEAT_MS with no question, then the room's question and its scripted line; the room is as with no fork", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host } = s;
    toChoosing(s);
    const held = room.game!.teams[0].currentQuestionId;
    const turns = room.game!.teams[0].turns;
    const eventId = state(room).eventId;
    choose(s, "monster");
    expect(room.game!.teams[0].fork).toEqual({ phase: "monster" });
    expect(room.game!.teams[0].forks).toEqual(["monster"]);
    expect(room.game!.teams[0].currentQuestionId).toBe(held);
    expect(room.game!.teams[0].turns).toBe(turns);
    const during = state(room);
    expect(during.forkBeat).toEqual({ teamId: T1, door: "monster" });
    expect(during.question).toBeNull();
    expect(during.eventId).toBe(eventId);
    // The door beat holds the room: no 下一題, no judging.
    send(room, host, { type: "HOST_NEXT", eventId });
    send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: held, correct: true, eventId });
    expect(lastSent(host)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    const after = state(room);
    expect(after.forkBeat).toBeUndefined();
    expect(after.question?.id).toBe(held);
    expect(narrations(room).at(-1).lines.at(-1)).toMatch(/⚔️/);
    // Its correct answer rolls no fork (the e2e team always would), and clears the mark.
    answerRight(s, 0, false);
    expect(room.game!.teams[0].fork).toBeUndefined();
  });

  it("❓: the press applies and saves the event at once, while STATE shows the game from before until the door is open", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const narrated: string[] = [];
    const provider: NarrationProvider = { name: "test", narrate: async (e) => (narrated.push(e.type), "旁白。") };
    const s = setup({ storage, provider });
    const { room, host } = s;
    toChoosing(s);
    await vi.advanceTimersByTimeAsync(0);
    narrated.length = 0;
    const before = state(room);
    const t0 = before.view.teams[0];
    choose(s, "mystery");
    // Applied: the team walked on, the turn passed, the choice and outcome are saved.
    const real = room.game!.teams[0];
    expect(real.forks).toEqual(["mystery"]);
    expect(real.events).toHaveLength(1);
    expect(real.event).toBeUndefined();
    expect(real.fork).toBeUndefined();
    expect(real.roomIndex).toBe(t0.roomIndex + 1);
    expect(currentTurnTeamId(room.game!)).toBe(T2);
    await Promise.resolve();
    const saved = (storage.data.get(SNAPSHOT_KEY) as { game: { teams: { forks?: string[]; events?: string[] }[] } }).game.teams[0];
    expect(saved.forks).toEqual(["mystery"]);
    expect(saved.events).toHaveLength(1);
    // Shown: the team as before the press, the turn still its own, nothing behind the door.
    const during = state(room);
    expect(during.forkBeat).toEqual({ teamId: T1, door: "mystery" });
    expect(during.view.currentTurnTeamId).toBe(T1);
    expect(during.view.teams[0]).toMatchObject({ reward: t0.reward, roomIndex: t0.roomIndex, abilityUses: t0.abilityUses });
    expect(during.view.teams[0].boon).toBe(t0.boon);
    expect(during.eventReveal).toBeUndefined();
    expect(during.question).toBeNull();
    expect(during.cueSeq).toBe(before.cueSeq);
    expect(during.eventId).toBe(before.eventId + 1);
    expect(JSON.stringify(during)).not.toMatch(/"scene"|"outcome"|"before"|"dish"/);
    expect(narrated).toEqual([]);
    // A phone reconnecting meanwhile gets the same STATE, door and all.
    const late = makeConn("late");
    room.onConnect(late);
    send(room, late, { type: "REJOIN", teamId: T2, teamKey: KEY });
    expect(sentStates(late).at(-1)).toMatchObject({ forkBeat: { teamId: T1, door: "mystery" }, view: { currentTurnTeamId: T1 } });
    // A second press is stale; the host's 下一題 does nothing.
    send(room, s.phones[0], { type: "TEAM_CHOOSE_FORK", door: "mystery", eventId: before.eventId });
    expect(lastSent(s.phones[0])).toMatchObject({ type: "ERROR", detail: "stale_event" });
    send(room, host, { type: "HOST_NEXT", eventId: during.eventId });
    expect(state(room).forkBeat).toBeDefined();

    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    const after = state(room);
    expect(after.forkBeat).toBeUndefined();
    expect(after.eventReveal).toMatchObject({ teamId: T1, outcome: real.events![0] });
    expect(after.view.teams[0].roomIndex).toBe(t0.roomIndex + 1);
    expect(after.view.currentTurnTeamId).toBe(T2);
    expect(["correct", "fumble"]).toContain(after.cue);
    expect(after.cueSeq).toBe(before.cueSeq + 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(narrated).toEqual(["event-room"]);
    expect(narrations(room).at(-1).eventId).toBe(after.eventId);
    // The next team's turn waits for 下一題 under the outcome.
    send(room, host, { type: "HOST_NEXT", eventId: after.eventId });
    expect(state(room).eventReveal).toBeUndefined();
  });

  it("a feast's dish is drawn on the press, so the rng order holds", () => {
    vi.useFakeTimers();
    // drawEvent: the first draw 0.0 → chest feast; the dish draw comes next.
    const values = [0, 0, 0];
    let calls = 0;
    const s = setup({ rng: () => (calls++, values.shift() ?? 0) });
    toChoosing(s);
    choose(s, "mystery");
    expect(s.room.game!.teams[0].events).toEqual(["feast"]);
    // The dish is in the held outcome already, before the beat ends.
    expect((s.room as unknown as { forkBeat: { reveal?: { dish?: unknown } } }).forkBeat.reveal?.dish).toBeDefined();
    expect(calls).toBeGreaterThan(0);
  });

  it("the clock runs out: timeout takes ⚔️ with a ⏳ beat; a stale timer after a send to the boss does nothing", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host } = s;
    toChoosing(s);
    await vi.advanceTimersByTimeAsync(FORK_MS - 1);
    expect(room.game!.teams[0].fork?.phase).toBe("choosing");
    expect(state(room).forkLeft).toBeLessThanOrEqual(FORK_MS);
    await vi.advanceTimersByTimeAsync(1);
    expect(room.game!.teams[0].fork).toEqual({ phase: "monster" });
    expect(room.game!.teams[0].forks).toEqual(["timeout"]);
    expect(state(room).forkBeat).toEqual({ teamId: T1, door: "monster", timeout: true });
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    expect(state(room).question).not.toBeNull();
    expect(narrations(room).at(-1).lines.at(-1)).toMatch(/⚔️/);

    // A second game state: the host sends a choosing team to the boss; its old timer finds nothing to do.
    const s2 = setup();
    toChoosing(s2);
    send(s2.room, s2.host, { type: "HOST_SEND_TO_BOSS", teamId: T1 });
    expect(s2.room.game!.teams[0].fork).toBeUndefined();
    const g = s2.room.game;
    await vi.advanceTimersByTimeAsync(FORK_MS + FORK_BEAT_MS);
    expect(s2.room.game).toBe(g);
    void host;
  });

  it("a press at or after the deadline, before the timer fires, is a timeout", () => {
    let now = 1_000_000;
    vi.useFakeTimers();
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []) } as unknown as RoomIO;
    const room = new DungeonRoom(io, () => 0, { bank, e2eEventTeam: "EventTeam", epilogueDelayMs: 0, now: () => now });
    const host = makeConn("host");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    const phone = makeConn("p0");
    room.onConnect(phone);
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "EventTeam" });
    send(room, host, { type: "HOST_START" });
    answerRight({ room, host, phones: [phone] }, 0);
    expect(room.game!.teams[0].fork?.phase).toBe("choosing");
    now += FORK_MS;
    send(room, phone, { type: "TEAM_CHOOSE_FORK", door: "mystery", eventId: state(room).eventId });
    expect(room.game!.teams[0].forks).toEqual(["timeout"]);
  });

  it("one team alone: its clock starts only once its own reveal is gone", () => {
    vi.useFakeTimers();
    const s = setup({ teams: 1 });
    answerRight(s, 0, false);
    expect(s.room.game!.teams[0].fork).toEqual({ phase: "waiting" });
    const eventId = state(s.room).eventId;
    send(s.room, s.host, { type: "HOST_SERVE", eventId });
    (s.room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(s.room, s.host, { type: "HOST_NEXT", eventId });
    expect(s.room.game!.teams[0].fork?.phase).toBe("choosing");
  });

  it("offline: a choosing team keeps the turn and may come back to pick; a waiting team offline is skipped with no clock", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, phones } = s;
    toChoosing(s);
    room.onClose(phones[0]);
    expect(currentTurnTeamId(room.game!)).toBe(T1);
    await vi.advanceTimersByTimeAsync(10_000);
    const back = makeConn("p0b");
    room.onConnect(back);
    send(room, back, { type: "REJOIN", teamId: T1, teamKey: KEY });
    send(room, back, { type: "TEAM_CHOOSE_FORK", door: "monster", eventId: state(room).eventId });
    expect(room.game!.teams[0].forks).toEqual(["monster"]);

    // Waiting and offline when its turn comes: skipped, still waiting, no deadline.
    const s2 = setup();
    answerRight(s2, 0);
    s2.room.onClose(s2.phones[0]);
    answerRight(s2, 1);
    expect(s2.room.game!.teams[0].fork).toEqual({ phase: "waiting" });
    expect(currentTurnTeamId(s2.room.game!)).toBe(T2);
  });

  it("an offline team's timeout: the beat still shows its doors; then the turn is the next team's", async () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    s.room.onClose(s.phones[0]);
    await vi.advanceTimersByTimeAsync(FORK_MS);
    expect(currentTurnTeamId(s.room.game!)).toBe(T2);
    expect(state(s.room)).toMatchObject({ forkBeat: { teamId: T1, timeout: true }, view: { currentTurnTeamId: T1 }, question: null });
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    expect(state(s.room).view.currentTurnTeamId).toBe(T2);
    expect(state(s.room).question?.id).toBe(s.room.game!.teams[1].currentQuestionId);
  });

  it("结束冒險 during the beat: the finished STATE shows real scores, and the beat's timer does nothing after", async () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    choose(s, "mystery");
    send(s.room, s.host, { type: "HOST_END_GAME" });
    const fin = state(s.room);
    expect(fin.phase).toBe("finished");
    expect(fin.forkBeat).toBeUndefined();
    expect(fin.view.teams[0].roomIndex).toBe(s.room.game!.teams[0].roomIndex);
    const n = narrations(s.room).length;
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    expect(state(s.room).eventReveal).toBeUndefined();
    expect(narrations(s.room).filter((m) => m.lines.join("").includes("寶箱")).length).toBeLessThanOrEqual(n);
  });

  it("a send to the boss during the beat lands but shows once the door is open; no other team starts choosing meanwhile", async () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    choose(s, "monster");
    send(s.room, s.host, { type: "HOST_SEND_TO_BOSS", teamId: T2 });
    expect(s.room.game!.teams[1].inBoss).toBe(true);
    expect(state(s.room).view.teams[1].inBossPhase).toBe(false);
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    expect(state(s.room).view.teams[1].inBossPhase).toBe(true);
  });

  it("no video starts under a door: HOST_MEDIA is ignored during the beat", () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    choose(s, "mystery");
    const next = s.room.game!.teams[1].currentQuestionId;
    send(s.room, s.host, { type: "HOST_MEDIA", questionId: next, action: "play" });
    expect(state(s.room).media).toBeUndefined();
  });

  it("an undoable 答錯 before the fork turn: the clock starts without closing it; once a door opens it is closed", () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host } = s;
    answerRight(s, 0);
    const q = room.game!.teams[1].currentQuestionId;
    send(room, host, { type: "HOST_JUDGE", teamId: T2, questionId: q, correct: false, fleeChoice: "retry", eventId: state(room).eventId });
    expect(room.game!.teams[0].fork?.phase).toBe("choosing");
    expect(state(room).undoWrong).toEqual({ teamId: T2, questionId: q });
    choose(s, "monster");
    send(room, host, { type: "HOST_UNDO_WRONG", teamId: T2, questionId: q, eventId: state(room).eventId });
    expect(lastSent(host)).toMatchObject({ type: "ERROR", detail: "no_undo" });
  });

  it("undo of that 答錯 brings the fork team back to waiting", () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host } = s;
    answerRight(s, 0);
    const q = room.game!.teams[1].currentQuestionId;
    send(room, host, { type: "HOST_JUDGE", teamId: T2, questionId: q, correct: false, fleeChoice: "retry", eventId: state(room).eventId });
    send(room, host, { type: "HOST_UNDO_WRONG", teamId: T2, questionId: q, eventId: state(room).eventId });
    expect(room.game!.teams[0].fork).toEqual({ phase: "waiting" });
  });

  it("a restart keeps a choosing deadline (time down counts) and takes ⚔️ at once when it passed", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup({ storage });
    toChoosing(s);
    await vi.advanceTimersByTimeAsync(0);
    const deadline = (s.room.game!.teams[0].fork as { deadline: number }).deadline;
    const restoreAt = async () => {
      const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), storage } as unknown as RoomIO;
      const r = new DungeonRoom(io, () => 0, { bank });
      await r.restore();
      return r;
    };
    await vi.advanceTimersByTimeAsync(5000);
    const r1 = await restoreAt();
    expect(r1.game!.teams[0].fork).toEqual({ phase: "choosing", deadline });
    await vi.advanceTimersByTimeAsync(FORK_MS - 5000);
    expect(r1.game!.teams[0].forks).toEqual(["timeout"]);
    // Past the deadline already at the restart: ⚔️ straight away.
    const r2 = await restoreAt();
    await vi.advanceTimersByTimeAsync(0);
    expect(r2.game!.teams[0].fork).toEqual({ phase: "monster" });
  });

  it("a restart inside the ❓ beat: no beat, real values, no replay; the next team can play", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup({ storage });
    toChoosing(s);
    choose(s, "mystery");
    await vi.advanceTimersByTimeAsync(0);
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), storage } as unknown as RoomIO;
    const r = new DungeonRoom(io, () => 0, { bank });
    await r.restore();
    const phone = makeConn("p1b");
    r.onConnect(phone);
    send(r, phone, { type: "REJOIN", teamId: T2, teamKey: KEY });
    const st = state(r);
    expect(st.forkBeat).toBeUndefined();
    expect(st.eventReveal).toBeUndefined();
    expect(st.view.teams[0].roomIndex).toBe(s.room.game!.teams[0].roomIndex);
    expect(st.question?.id).toBe(r.game!.teams[1].currentQuestionId);
  });

  it("the room picks ⚔️ led to and a room the host picked rolls no fork; with no e2e team the top quarter of the rng is a fork", () => {
    vi.useFakeTimers();
    const s = setup();
    send(s.room, s.host, { type: "HOST_QUEUE_QUESTION", target: T1, questionId: "r1-3" });
    answerRight(s, 0, false);
    expect(s.room.game!.teams[0].fork).toBeUndefined();
    for (const [r, expected] of [[0, false], [0.74, false], [0.75, true], [0.99, true]] as const) {
      const one = setup({ eventTeam: null, rng: () => r, teams: 1 });
      answerRight(one, 0, false);
      expect(!!one.room.game!.teams[0].fork).toBe(expected);
    }
  });

  it("a ❓ outcome on show holds the next fork team: its clock starts after 下一題", async () => {
    vi.useFakeTimers();
    const s = setup({ teams: 1 });
    answerRight(s, 0);
    // One team: after ❓ the team itself is next; it walked out of the event room, so it is not at a fork.
    choose(s, "mystery");
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    expect(state(s.room).eventReveal).toBeDefined();
    expect(state(s.room).question).not.toBeNull();
    expect(s.room.game!.teams[0].fork).toBeUndefined();
  });
});
