// 觀眾投票 (#285, docs/designs/branch-fork.md): waiting teams vote a door while a team chooses; advice only.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DungeonRoom, FORK_BEAT_MS } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { FORK_MS } from "../game-state";
import { FORK_VOTE_GAP_MS, parseClientMessage } from "../protocol";
import { gameLog } from "../game-log";

const IDS = [1, 2, 3].map((n) => `00000000-0000-0000-0000-00000000000${n}`);
const TOKEN = "host-token-0123456789abcdef";
const KEY = "team-key-0123456789abcdef";
const video = (id: string) => ({ kind: "text" as const, id, content: { kind: "youtube" as const, value: "dQw4w9WgXcQ" }, prompt: "這首歌是？", answer: `答案 ${id}` });
const bank = parseBank({
  rooms: [0, 1, 2, 3].map((r) => ({ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => video(`r${r}-${i}`)) })),
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [video("boss-a"), video("boss-b")] },
});

type Spy = ReturnType<typeof vi.fn>;
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: Spy };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const broadcasts = (room: DungeonRoom) => (room.room.broadcast as Spy).mock.calls.map((c) => JSON.parse(c[0]));
const state = (room: DungeonRoom) => broadcasts(room).filter((m) => m.type === "STATE").at(-1);
const tallies = (room: DungeonRoom) => broadcasts(room).filter((m) => m.type === "FORK_VOTES");

function memoryStorage(): RoomStorage & { put: Spy } {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => data.get(k), put: vi.fn(async (k: string, v: unknown) => void data.set(k, structuredClone(v))), delete: async (k: string) => data.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } as never;
}

function setup(storage?: RoomStorage) {
  const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), ...(storage ? { storage } : {}) } as unknown as RoomIO;
  const room = new DungeonRoom(io, () => 0, { bank, e2eEventTeam: "EventTeam", epilogueDelayMs: 0, e2eMonsterSide: "left" });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((_, i) => makeConn(`p${i}`));
  IDS.forEach((id, i) => {
    room.onConnect(phones[i]);
    send(room, phones[i], { type: "JOIN", teamId: id, teamKey: KEY, teamName: ["EventTeam", "Plain", "Third"][i] });
  });
  send(room, host, { type: "HOST_START" });
  return { room, host, phones };
}
type S = ReturnType<typeof setup>;

function answerRight({ room, host }: S, i: number) {
  const t = room.game!.teams[i];
  send(room, host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(room).eventId });
  const eventId = state(room).eventId;
  send(room, host, { type: "HOST_SERVE", eventId });
  (room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(room, host, { type: "HOST_NEXT", eventId });
}
/** EventTeam walks into a fork; the other two answer; EventTeam's door clock starts. */
function toChoosing(s: S) {
  answerRight(s, 0);
  answerRight(s, 1);
  answerRight(s, 2);
  expect(s.room.game!.teams[0].fork?.phase).toBe("choosing");
}
const vote = (s: S, i: number, side: "left" | "right") => send(s.room, s.phones[i], { type: "FORK_VOTE", side });
const tick = () => vi.advanceTimersByTime(FORK_VOTE_GAP_MS);

afterEach(() => vi.useRealTimers());

describe("觀眾投票 at a fork", () => {
  it("parses only a side", () => {
    expect(parseClientMessage({ type: "FORK_VOTE", side: "left" })).toEqual({ type: "FORK_VOTE", side: "left" });
    expect(parseClientMessage({ type: "FORK_VOTE", side: "up" })).toBeNull();
  });

  it("waiting teams vote and switch; the tally goes out at once, in STATE too, and never names the hidden side", () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    vote(s, 1, "left");
    expect(tallies(s.room).at(-1)).toEqual({ type: "FORK_VOTES", votes: { [IDS[1]]: "left" } });
    vote(s, 2, "right");
    tick();
    vote(s, 1, "right");
    expect(tallies(s.room).at(-1).votes).toEqual({ [IDS[1]]: "right", [IDS[2]]: "right" });
    expect(JSON.stringify(broadcasts(s.room))).not.toContain("monsterSide");
    expect((s.room as unknown as { snapshot(): { forkVotes?: object } }).snapshot().forkVotes).toEqual({ [IDS[1]]: "right", [IDS[2]]: "right" });
  });

  it("drops the choosing team, a repeat inside the gap, the same side again, and votes with no fork", () => {
    vi.useFakeTimers();
    const s = setup();
    vote(s, 1, "left"); // no fork yet
    expect(tallies(s.room)).toHaveLength(0);
    toChoosing(s);
    vote(s, 0, "left"); // the choosing team
    expect(tallies(s.room)).toHaveLength(0);
    vote(s, 1, "left");
    vote(s, 1, "right"); // inside the gap
    tick();
    vote(s, 1, "left"); // unchanged
    expect(tallies(s.room)).toHaveLength(1);
  });

  it("drops a waiting late team's vote", () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    const late = makeConn("late");
    s.room.onConnect(late);
    send(s.room, late, { type: "JOIN", teamId: "00000000-0000-0000-0000-000000000009", teamKey: KEY, teamName: "Late" });
    send(s.room, late, { type: "FORK_VOTE", side: "left" });
    expect(tallies(s.room)).toHaveLength(0);
  });

  it("a fork the host skips starts its next door clock with no votes, and records none", () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    vote(s, 1, "left");
    send(s.room, s.host, { type: "HOST_SKIP_TURN", teamId: IDS[0], eventId: state(s.room).eventId });
    expect(s.room.game!.teams[0].fork?.phase).toBe("waiting");
    answerRight(s, 1);
    answerRight(s, 2);
    expect(s.room.game!.teams[0].fork?.phase).toBe("choosing");
    expect(state(s.room).forkVotes).toBeUndefined();
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "left", eventId: state(s.room).eventId });
    expect(s.room.game!.teams[0].forks).toEqual([{ side: "left", door: "monster" }]);
  });

  it("the choice records the tally in the game log, clears the votes, and a vote after the choice is dropped", () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    vote(s, 1, "right");
    vote(s, 2, "right");
    send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side: "left", eventId: state(s.room).eventId });
    expect(s.room.game!.teams[0].forks).toEqual([{ side: "left", door: "monster", crowd: { left: 0, right: 2 } }]);
    tick();
    vote(s, 1, "left");
    expect(tallies(s.room)).toHaveLength(2);
    vi.advanceTimersByTime(FORK_BEAT_MS);
    expect(state(s.room).forkVotes).toBeUndefined();
    expect(gameLog(s.room.game!, 0).teams[0].forks[0].crowd).toEqual({ left: 0, right: 2 });
  });

  it("a timeout records the tally too", () => {
    vi.useFakeTimers();
    const s = setup();
    toChoosing(s);
    vote(s, 2, "left");
    vi.advanceTimersByTime(FORK_MS);
    expect(s.room.game!.teams[0].forks).toEqual([{ side: "left", door: "monster", timeout: true, crowd: { left: 1, right: 0 } }]);
  });

  it("a vote saves nothing and counts as no activity", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup(storage);
    toChoosing(s);
    // Past the saved activity time's rounding (60 s), so a vote that counted as activity would write.
    vi.advanceTimersByTime(61_000);
    const puts = storage.put.mock.calls.length;
    vote(s, 1, "left");
    tick();
    vote(s, 1, "right");
    expect(storage.put.mock.calls.length).toBe(puts);
  });

  it("a restart keeps the fork but not the votes", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup(storage);
    toChoosing(s);
    vote(s, 1, "left");
    await vi.advanceTimersByTimeAsync(0);
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), storage } as unknown as RoomIO;
    const again = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0 });
    await again.restore();
    expect(again.game!.teams[0].fork?.phase).toBe("choosing");
    expect((again as unknown as { snapshot(): { forkVotes?: object } }).snapshot().forkVotes).toBeUndefined();
    // Nothing of the vote reached the save.
    expect(JSON.stringify(storage.put.mock.calls)).not.toMatch(/forkVotes|crowd/);
  });
});
