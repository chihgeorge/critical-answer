// 占卜師 in the room (docs/designs/fortune-teller.md): the ❓ door into the crystal ball, the pizza clock, the pick and its
// lit slice, the effect card until 下一題, what STATE shows at each step, pacing, the host's way out, and restarts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DungeonRoom, FORK_BEAT_MS, FORTUNE_BEAT_MS, FORTUNE_HOST_GRACE_MS } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { currentTurnTeamId, FORK_MS, FORTUNE_INTRO_MS, type GameState } from "../game-state";
import { parseSnapshot, SNAPSHOT_KEY } from "./snapshot";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const T3 = "00000000-0000-0000-0000-000000000003";
const TOKEN = "host-token-0123456789abcdef";
const KEY = "team-key-0123456789abcdef";
const text = (id: string) => ({ kind: "text" as const, id, content: { kind: "text" as const, value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = parseBank({
  rooms: [0, 1, 2, 3].map((r) => ({ monster: "slime-soft", baseDifficulty: 1, reward: 10 * (r + 1), questions: [0, 1, 2, 3, 4, 5].map((i) => text(`r${r}-${i}`)) })),
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [text("boss-a"), text("boss-b")] },
});

type Spy = ReturnType<typeof vi.fn>;
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: Spy };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const broadcasts = (room: DungeonRoom) => (room.room.broadcast as Spy).mock.calls.map((c) => JSON.parse(c[0]));
const state = (room: DungeonRoom) => broadcasts(room).filter((m) => m.type === "STATE").at(-1);
const narrations = (room: DungeonRoom) => broadcasts(room).filter((m) => m.type === "NARRATION");
const lastSent = (conn: Conn) => JSON.parse((conn.send as unknown as Spy).mock.calls.at(-1)![0]);
const sentAll = (conn: Conn) => (conn.send as unknown as Spy).mock.calls.map((c) => JSON.parse(c[0]));

function memoryStorage(): RoomStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), delete: async (k: string) => data.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } as never;
}

/** A room whose rng the test turns: 0 until the ❓ press, 0.99 for it (the fortune teller, the last condition in the pool and the last effect). */
function setup(opts: { storage?: RoomStorage; teams?: number } = {}) {
  const rng = { r: 0 };
  const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), ...(opts.storage ? { storage: opts.storage } : {}) } as unknown as RoomIO;
  const room = new DungeonRoom(io, () => rng.r, { bank, e2eEventTeam: "EventTeam", e2eMonsterSide: "left", epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const ids = [T1, T2, T3].slice(0, opts.teams ?? 2);
  const phones = ids.map((_, i) => makeConn(`p${i}`));
  ids.forEach((id, i) => {
    room.onConnect(phones[i]);
    send(room, phones[i], { type: "JOIN", teamId: id, teamKey: KEY, teamName: i === 0 ? "EventTeam" : `Plain${i}` });
  });
  send(room, host, { type: "HOST_START" });
  return { room, host, phones, rng };
}
type S = ReturnType<typeof setup>;

function next(s: S) {
  const eventId = state(s.room).eventId;
  send(s.room, s.host, { type: "HOST_SERVE", eventId });
  (s.room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(s.room, s.host, { type: "HOST_NEXT", eventId });
}
function answerRight(s: S, i: number) {
  const t = s.room.game!.teams[i];
  send(s.room, s.host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(s.room).eventId });
  next(s);
}

/** EventTeam comes to a fork, every other team answers right (吃過最多種料理 ties them all), and ❓ draws the fortune teller;
 * the door opening plays out, so the crystal ball is up. */
async function toFortune(s: S) {
  answerRight(s, 0);
  for (let i = 1; i < s.phones.length; i++) answerRight(s, i);
  s.rng.r = 0.99;
  send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "right", eventId: state(s.room).eventId });
  s.rng.r = 0;
  await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
}
const pick = (s: S, effect: string, phone = 0) => send(s.room, s.phones[phone], { type: "TEAM_CHOOSE_FORTUNE", effect, eventId: state(s.room).eventId });

afterEach(() => {
  vi.useRealTimers();
});

describe("占卜師 in the room", () => {
  // Value: protects=the ❓ door leads into the crystal ball, its deadline and its scripted lines (R3, E13); fails_when=the
  // door names a monster, the event opens at once, the deadline is wrong, or the lines wait for the AI; no_claim=effects
  it("❓ on the fortune teller: the door opens, then the crystal ball with the condition, its lines and its deadline", async () => {
    vi.useFakeTimers();
    const s = setup();
    answerRight(s, 0);
    answerRight(s, 1);
    s.rng.r = 0.99;
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "right", eventId: state(s.room).eventId });
    s.rng.r = 0;
    // The door opening: the fortune is drawn and saved, but STATE says nothing of it.
    expect(s.room.game!.fortune).toMatchObject({ teamId: T1, condition: "dishes", value: 1, matchIds: [T1, T2] });
    expect(state(s.room).forkBeat).toMatchObject({ door: "mystery" });
    expect(state(s.room).fortune).toBeUndefined();
    const lines = narrations(s.room).length;
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    const st = state(s.room);
    expect(st.fortune).toEqual({ teamId: T1, condition: "dishes", step: "intro" });
    expect(st.eventReveal).toBeUndefined();
    expect(st.question).toBeNull();
    expect(s.room.game!.fortune!.deadline).toBe(Date.now() + FORTUNE_INTRO_MS + FORK_MS);
    expect(currentTurnTeamId(s.room.game!)).toBe(T1);
    const said = narrations(s.room);
    expect(said.length).toBe(lines + 1);
    expect(said.at(-1).eventId).toBe(st.eventId);
    expect(said.at(-1).lines.join("")).toMatch(/吃過最多種料理/);
    expect(said.at(-1).lines.at(-1)).toMatch(/EventTeam/);
    // No ⚔️ line, no event-room line.
    expect(said.at(-1).lines.join("")).not.toMatch(/⚔️/);
  });

  // Value: protects=step 1 refuses a pick, step 2 opens the pizza with its clock (R8); fails_when=a pick lands under the
  // ball or the phones get no STATE when the ball goes; no_claim=manual pacing (below)
  it("a pick under the crystal ball is refused; the pizza comes with its 15 s clock", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    pick(s, "blessing");
    expect(lastSent(s.phones[0])).toMatchObject({ type: "ERROR", detail: "fortune_intro" });
    expect(s.room.game!.fortune!.effect).toBeUndefined();
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS);
    const st = state(s.room);
    expect(st.fortune).toEqual({ teamId: T1, condition: "dishes", step: "choose" });
    expect(st.fortuneLeft).toBe(FORK_MS);
  });

  // Value: protects=the pick resolves at once (E3) while STATE shows the game from before with only the lit slice (E2), then
  // the card with the matching teams (G4); fails_when=the effect or turn shows early, or the card lacks its matches;
  // no_claim=each effect's numbers (event-rooms.test.ts)
  it("the pick lands at once; the lit slice shows the old game; the card shows who matched until 下一題", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS);
    pick(s, "potion");
    const g = s.room.game!;
    expect(g.teams[0].events).toEqual(["fortune"]);
    expect(g.teams.map((t) => t.item)).toEqual(["luckyPotion", "luckyPotion"]);
    expect(currentTurnTeamId(g)).toBe(T2);
    const beat = state(s.room);
    expect(beat.fortune).toEqual({ teamId: T1, condition: "dishes", step: "beat", effect: "potion" });
    expect(beat.view.currentTurnTeamId).toBe(T1);
    expect(beat.view.teams[0].item).toBeUndefined();
    expect(beat.cue).toBe("check-pass");
    expect(beat.question).toBeNull();
    await vi.advanceTimersByTimeAsync(FORTUNE_BEAT_MS);
    const card = state(s.room);
    expect(card.fortune).toEqual({ teamId: T1, condition: "dishes", step: "card", effect: "potion", value: 1, matchIds: [T1, T2] });
    expect(card.view.currentTurnTeamId).toBe(T2);
    expect(narrations(s.room).at(-1).lines.join("")).toMatch(/藥水/);
    // The drawing team matched itself: the mocking line.
    expect(narrations(s.room).at(-1).lines.join("")).toMatch(/自己/);
    // The card holds the room until 下一題.
    send(s.room, s.phones[1], { type: "TEAM_SUBMIT_TEXT", questionId: g.teams[1].currentQuestionId, text: "x", eventId: card.eventId });
    expect(lastSent(s.phones[1])).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    send(s.room, s.host, { type: "HOST_NEXT", eventId: card.eventId });
    expect(s.room.game!.fortune).toBeUndefined();
    const after = state(s.room);
    expect(after.fortune).toBeUndefined();
    expect(after.question?.id).toBe(s.room.game!.teams[1].currentQuestionId);
    expect(narrations(s.room).at(-1).lines.at(-1)).toMatch(/Plain1/);
  });

  // Value: protects=E12's checks; fails_when=a double tap, a second phone, a stale STATE or another team picks; no_claim=none
  it("refuses a double tap, a stale eventId and another team; the host's 下一題 does nothing before the card", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    const eventId = state(s.room).eventId;
    send(s.room, s.host, { type: "HOST_NEXT", eventId });
    expect(s.room.game!.fortune).toBeDefined();
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS);
    send(s.room, s.phones[1], { type: "TEAM_CHOOSE_FORTUNE", effect: "curse", eventId });
    expect(lastSent(s.phones[1])).toMatchObject({ type: "ERROR", detail: "not_your_turn" });
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORTUNE", effect: "curse", eventId: eventId - 1 });
    expect(lastSent(s.phones[0])).toMatchObject({ type: "ERROR", detail: "stale_event" });
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORTUNE", effect: "nope", eventId });
    expect(lastSent(s.phones[0])).toMatchObject({ type: "ERROR", detail: "bad_message" });
    pick(s, "curse");
    pick(s, "blessing");
    expect(lastSent(s.phones[0])).toMatchObject({ type: "ERROR", detail: "no_fortune" });
    expect(s.room.game!.fortune!.effect).toBe("curse");
    send(s.room, s.host, { type: "HOST_NEXT", eventId });
    expect(s.room.game!.fortune).toBeDefined();
  });

  // Value: protects=time running out picks at random, the drawing team offline included (R2); fails_when=the clock never
  // fires, or the offline team loses the turn and the pick fails; no_claim=none
  it("the clock picks at random, the drawing team offline too", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    s.room.onClose(s.phones[0]);
    expect(currentTurnTeamId(s.room.game!)).toBe(T1);
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS + FORK_MS);
    expect(s.room.game!.fortune).toMatchObject({ effect: "blessing", timeout: true });
    expect(state(s.room).fortune).toMatchObject({ step: "beat", timeout: true });
    await vi.advanceTimersByTimeAsync(FORTUNE_BEAT_MS);
    send(s.room, s.host, { type: "HOST_NEXT", eventId: state(s.room).eventId });
    expect(currentTurnTeamId(s.room.game!)).toBe(T2);
  });

  // Value: protects=R12/E14: before the card no STATE to any connection, host included, carries the value or the matching
  // teams, from the door opening on; fails_when=any message before the card names them; no_claim=the counters themselves
  it("no message to anyone carries the value or the matching teams before the card", async () => {
    vi.useFakeTimers();
    const s = setup();
    answerRight(s, 0);
    answerRight(s, 1);
    const from = [s.host, ...s.phones].map((c) => sentAll(c).length);
    const fromB = broadcasts(s.room).length;
    s.rng.r = 0.99;
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "right", eventId: state(s.room).eventId });
    s.rng.r = 0;
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS + FORTUNE_INTRO_MS);
    pick(s, "tribute");
    await vi.advanceTimersByTimeAsync(FORTUNE_BEAT_MS - 1);
    const seen = [...[s.host, ...s.phones].flatMap((c, i) => sentAll(c).slice(from[i])), ...broadcasts(s.room).slice(fromB)];
    expect(seen.filter((m) => m.type === "STATE").length).toBeGreaterThan(3);
    for (const m of seen) expect(JSON.stringify(m)).not.toMatch(/matchIds|"fortune":\{[^}]*"value"/);
    await vi.advanceTimersByTimeAsync(1);
    expect(state(s.room).fortune.matchIds).toEqual([T1, T2]);
  });

  // Value: protects=the paused rules (E3, E5): judging, 送王房, 給藥水, a late team and 改判答對 wait; fails_when=one slips
  // through and changes the matching teams or the turn; no_claim=none
  it("while a fortune runs the host cannot judge, send to the boss, give a potion or let a late team in", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    const eventId = state(s.room).eventId;
    send(s.room, s.host, { type: "HOST_JUDGE", teamId: T1, questionId: s.room.game!.teams[0].currentQuestionId, correct: true, eventId });
    expect(lastSent(s.host)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    send(s.room, s.host, { type: "HOST_SEND_TO_BOSS", teamId: T2 });
    expect(lastSent(s.host)).toMatchObject({ type: "ERROR", detail: "paused" });
    send(s.room, s.host, { type: "HOST_GIVE_ITEM", teamId: T2 });
    expect(lastSent(s.host)).toMatchObject({ type: "ERROR", detail: "paused" });
    const late = makeConn("late");
    s.room.onConnect(late);
    send(s.room, late, { type: "JOIN", teamId: T3, teamKey: KEY, teamName: "Late" });
    send(s.room, s.host, { type: "HOST_LATE_TEAM", teamId: T3, admit: true });
    expect(lastSent(s.host)).toMatchObject({ type: "ERROR", detail: "late_closed" });
    expect(s.room.game!.teams).toHaveLength(2);
  });

  // Value: protects=R3: 下一題 on the card starts the next team's fork clock; fails_when=the next fork team waits forever
  // or its clock runs under the card; no_claim=none
  it("下一題 on the card starts the next fork team's door clock", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    s.room.game = { ...s.room.game!, teams: s.room.game!.teams.map((t) => (t.id === T2 ? { ...t, fork: { phase: "waiting" as const } } : t)) };
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS);
    pick(s, "curse");
    await vi.advanceTimersByTimeAsync(FORTUNE_BEAT_MS);
    expect(s.room.game!.teams[1].fork).toEqual({ phase: "waiting" });
    send(s.room, s.host, { type: "HOST_NEXT", eventId: state(s.room).eventId });
    expect(s.room.game!.teams[1].fork?.phase).toBe("choosing");
    expect(state(s.room).forkLeft).toBe(FORK_MS);
  });

  // Value: protects=結束冒險 at steps 1–2 leaves no fortune behind (R11); fails_when=the podium STATE still shows one or its
  // clock fires after; no_claim=none
  it("結束冒險 under the crystal ball leaves no fortune and no clock", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    send(s.room, s.host, { type: "HOST_END_GAME" });
    expect(s.room.game!.fortune).toBeUndefined();
    expect(state(s.room).fortune).toBeUndefined();
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS + FORK_MS);
    expect(s.room.game!.teams[0].fortunes).toBeUndefined();
  });

  // Value: protects=the host's way out (E12): refused until 2 s past the deadline, then a random effect; fails_when=the host
  // can cut the pick short or pick the effect; no_claim=none
  it("立即隨機 waits for 2 s past the deadline, then picks at random", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    send(s.room, s.host, { type: "HOST_PACING", mode: "manual" });
    const eventId = state(s.room).eventId;
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS + FORK_MS + FORTUNE_HOST_GRACE_MS - 1);
    send(s.room, s.host, { type: "HOST_FORTUNE_RANDOM", eventId });
    expect(lastSent(s.host)).toMatchObject({ type: "ERROR", detail: "too_early" });
    await vi.advanceTimersByTimeAsync(1);
    send(s.room, s.host, { type: "HOST_FORTUNE_RANDOM", eventId });
    expect(s.room.game!.fortune).toMatchObject({ effect: "blessing", timeout: true });
  });

  // Value: protects=manual pacing (E13, R8): no clock, ▶ 下一步 offered after the ball is the timeout, back to auto resets the
  // deadline; fails_when=the pizza times out in manual or a fresh clock replays the ball; no_claim=none
  it("manual: no clock and ▶ 下一步 is the timeout; back to auto gives the pizza a fresh 15 s", async () => {
    vi.useFakeTimers();
    const s = setup();
    send(s.room, s.host, { type: "HOST_PACING", mode: "manual" });
    answerRight(s, 0);
    answerRight(s, 1);
    s.rng.r = 0.99;
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "right", eventId: state(s.room).eventId });
    s.rng.r = 0;
    send(s.room, s.host, { type: "HOST_STEP", eventId: state(s.room).eventId, step: state(s.room).hold.id });
    expect(state(s.room).fortune.step).toBe("intro");
    expect(state(s.room).hold).toBeUndefined();
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS + FORK_MS * 2);
    expect(s.room.game!.fortune!.effect).toBeUndefined();
    const st = state(s.room);
    expect(st.fortune.step).toBe("choose");
    expect(st.fortuneLeft).toBeUndefined();
    expect(st.hold).toMatchObject({ kind: "fortune" });
    // Back to auto at step 2: a fresh 15 s, no second ball.
    send(s.room, s.host, { type: "HOST_PACING", mode: "auto" });
    expect(s.room.game!.fortune!.deadline).toBe(Date.now() + FORK_MS);
    expect(state(s.room).fortune.step).toBe("choose");
    send(s.room, s.host, { type: "HOST_PACING", mode: "manual" });
    send(s.room, s.host, { type: "HOST_STEP", eventId: state(s.room).eventId, step: state(s.room).hold.id });
    expect(s.room.game!.fortune).toMatchObject({ effect: "blessing", timeout: true });
  });

  it("manual → auto under the crystal ball plays the ball again: now + 3 s + 15 s", async () => {
    vi.useFakeTimers();
    const s = setup();
    await toFortune(s);
    send(s.room, s.host, { type: "HOST_PACING", mode: "manual" });
    send(s.room, s.host, { type: "HOST_PACING", mode: "auto" });
    expect(s.room.game!.fortune!.deadline).toBe(Date.now() + FORTUNE_INTRO_MS + FORK_MS);
  });
});

describe("占卜師 across a restart", () => {
  const restore = async (storage: RoomStorage) => {
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), storage } as unknown as RoomIO;
    const r = new DungeonRoom(io, () => 0, { bank });
    await r.restore();
    const host = makeConn("host2");
    r.onConnect(host);
    send(r, host, { type: "HOST_CLAIM", token: TOKEN });
    [T1, T2].forEach((id, i) => {
      const phone = makeConn(`q${i}`);
      r.onConnect(phone);
      send(r, phone, { type: "JOIN", teamId: id, teamKey: KEY, teamName: i === 0 ? "EventTeam" : `Plain${i}` });
    });
    return { r, host };
  };

  // Value: protects=E1/R10 step 1–2 save: the fortune event and deadline survive, the clock fires, 下一題 moves on;
  // fails_when=the event is turned into a fork, the clock is lost, or the turn sticks; no_claim=none
  it("steps 1–2: the deadline holds, time running out picks, and 下一題 hands the turn on", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup({ storage });
    await toFortune(s);
    await vi.advanceTimersByTimeAsync(0);
    const deadline = s.room.game!.fortune!.deadline!;
    const { r, host } = await restore(storage);
    expect(r.game!.fortune).toMatchObject({ teamId: T1, deadline });
    expect(r.game!.teams[0].event).toMatchObject({ outcome: "fortune" });
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS + FORK_MS);
    expect(r.game!.fortune).toMatchObject({ effect: "blessing", timeout: true });
    await vi.advanceTimersByTimeAsync(FORTUNE_BEAT_MS);
    send(r, host, { type: "HOST_NEXT", eventId: state(r).eventId });
    expect(r.game!.fortune).toBeUndefined();
    expect(currentTurnTeamId(r.game!)).toBe(T2);
  });

  it("a restart inside the door opening starts the crystal ball on restore", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup({ storage });
    answerRight(s, 0);
    answerRight(s, 1);
    s.rng.r = 0.99;
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "right", eventId: state(s.room).eventId });
    await vi.advanceTimersByTimeAsync(0);
    const { r } = await restore(storage);
    expect(r.game!.fortune!.deadline).toBe(Date.now() + FORTUNE_INTRO_MS + FORK_MS);
    expect(state(r).fortune).toMatchObject({ step: "intro" });
  });

  // Value: protects=R10 step 4 save and E2's restart inside the lit slice: the card comes back, 下一題 closes it;
  // fails_when=the effect applies twice or the card is lost with the turn stuck; no_claim=none
  it("inside the lit slice or on the card: the card comes back and 下一題 closes it", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup({ storage });
    await toFortune(s);
    await vi.advanceTimersByTimeAsync(FORTUNE_INTRO_MS);
    pick(s, "relief");
    await vi.advanceTimersByTimeAsync(0);
    const rewards = s.room.game!.teams.map((t) => t.reward);
    const { r, host } = await restore(storage);
    expect(state(r).fortune).toMatchObject({ step: "card", effect: "relief", matchIds: [T1, T2] });
    expect(r.game!.teams.map((t) => t.reward)).toEqual(rewards);
    send(r, host, { type: "HOST_NEXT", eventId: state(r).eventId });
    expect(r.game!.fortune).toBeUndefined();
  });

  // Value: protects=E1's shape check: a damaged fortune is dropped and its team goes back to a waiting fork; fails_when=a
  // bad save pins the turn forever or crashes the restore; no_claim=none
  it("a fortune of a bad shape is dropped and its team waits at a fork", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup({ storage });
    await toFortune(s);
    await vi.advanceTimersByTimeAsync(0);
    const raw = storage.data.get(SNAPSHOT_KEY) as { game: GameState };
    for (const bad of [{ condition: "luck" }, { matchIds: ["nobody"] }, { deadline: "soon" }, { effect: "nope" }]) {
      const snap = parseSnapshot({ ...raw, game: { ...raw.game, fortune: { ...raw.game.fortune, ...bad } } })!;
      expect(snap.game!.fortune).toBeUndefined();
      expect(snap.game!.teams[0].event).toBeUndefined();
      expect(snap.game!.teams[0].fork).toEqual({ phase: "waiting" });
    }
    // Both good shapes load as they are.
    expect(parseSnapshot(raw)!.game!.fortune).toMatchObject({ teamId: T1 });
    const card = { ...raw.game, fortune: { ...raw.game.fortune, effect: "curse" }, teams: raw.game.teams.map((t) => ({ ...t, event: undefined })) };
    expect(parseSnapshot({ ...raw, game: card })!.game!.fortune).toMatchObject({ effect: "curse" });
  });
});
