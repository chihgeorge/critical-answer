/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, it, expect, vi } from "vitest";
import { DungeonRoom, fixedDie, sprintLine } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { DIFFICULTIES, answerText, bossPhaseStates, findQuestion, parseBank, roomTemplates, type Bank } from "../question-bank";
import { MONSTERS, catalogMonster, variantOf } from "../monster-catalog";
import { BANK } from "../question-bank-data";
// Room tests judge turns with HOST_JUDGE, so they play the bundled bank as text questions, with
// the bank's own monsters (no per-game draw) so a test knows which monster stands in which room.
vi.mock("../question-bank-data", async (actual) => {
  const { asTextBank } = await import("../text-bank");
  return { BANK: { ...asTextBank((await actual<typeof import("../question-bank-data")>()).BANK), randomMonsters: undefined } };
});
import { WARRIOR_TARGET, checkKey, currentTurnTeamId, setTeamOnline, type ClassId } from "../game-state";
import { sortCode } from "../sort-order";
import { EPILOGUE_MODEL } from "../narration/llm";
import { SERVE_HOLD_MS } from "../protocol";
import { MAX_LINE } from "../narration/runner";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const T3 = "00000000-0000-0000-0000-000000000003";
const BAD_ID = "not-a-uuid";
/** A team's secret: only the client that created the team knows it. */
const KEY = "team-key-0123456789abcdef";
const KEY2 = "another-key-0123456789abcd";
/** A host's pasted Anthropic key (fake, but in the right format). */
const HOST_KEY = "sk-ant-test-HOSTKEY-0123456789abcdefWXYZ";

/** A killing blow waits for its 4d20 beat (docs/designs/kill-roll.md). Tests that play a game to its end land the dice
 * now, as the beat's timer would. */
function landKill(room: DungeonRoom) {
  const r = room as any;
  if (r.pendingRoll?.kind !== "kill") return;
  clearTimeout(r.lockTimer);
  r.resolveRoll();
}

function makeConn(id = "conn-1") {
  return {
    id,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as Conn;
}

function makeRoom() {
  return {
    id: "room-1",
    broadcast: vi.fn(),
    getConnections: vi.fn(() => []),
  } as unknown as RoomIO;
}

/** The persuasion check the room asks for before a fill-in answer or a warrior's roll on one (dnd design R2, R6):
 * written as a plain pass (no hint) for every team's current question, so tests about something else can answer. */
function passChecks(room: DungeonRoom) {
  const g = room.game!;
  const checks = { ...g.checks };
  for (const t of g.teams) checks[checkKey(t.currentQuestionId, t.id)] ??= { value: 10, bonus: 0, dc: 8, passed: true };
  room.game = { ...g, checks };
}

function send(room: DungeonRoom, conn: ReturnType<typeof makeConn>, msg: object) {
  room.onMessage(JSON.stringify(msg), conn);
}

/** 上菜 then 下一題 (monster-cuisine.md cooking I2), skipping the cooking's hold a real host waits out. */
function serveNext(room: DungeonRoom, conn: ReturnType<typeof makeConn>, eventId: number) {
  send(room, conn, { type: "HOST_SERVE", eventId });
  (room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(room, conn, { type: "HOST_NEXT", eventId });
}

/** The host's 公布答案 for whatever lock is pending (host-reveal.md): what every lock waited for before its beat. */
function reveal(room: DungeonRoom) {
  const lock = (room as any).pendingLock;
  const host = [...(room as any).hostConns.values()][0];
  if (lock && host) send(room, host, { type: "HOST_REVEAL", teamId: lock.teamId, questionId: lock.questionId });
}

function lastBroadcast(room: DungeonRoom) {
  const mock = room.room.broadcast as ReturnType<typeof vi.fn>;
  const last = mock.mock.calls.at(-1)?.[0];
  return last ? JSON.parse(last) : null;
}

/** The room's current eventSeq — what a real host echoes back in HOST_NEXT (the eventId of the STATE it saw). */
const seqOf = (room: DungeonRoom) => (room as unknown as { eventSeq: number }).eventSeq;

/** A /screen page's socket: connected, then announced with SCREEN_HELLO, as the page does on every open. */
function screenConn(room: DungeonRoom, id = "screen") {
  const conn = makeConn(id);
  room.onConnect(conn);
  send(room, conn, { type: "SCREEN_HELLO" });
  return conn;
}

function lastSentTo(conn: ReturnType<typeof makeConn>) {
  const calls = (conn.send as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls.at(-1)?.[0];
  return last ? JSON.parse(last) : null;
}

const TOKEN = "host-token-0123456789abcdef";

function claim(room: DungeonRoom, conn: ReturnType<typeof makeConn>, token = TOKEN) {
  send(room, conn, { type: "HOST_CLAIM", token });
}

function makeRoomWithHost() {
  const room = new DungeonRoom(makeRoom() as any, () => 0); // always deal the first free question
  const hostConn = makeConn("host-conn");
  room.onConnect(hostConn);
  claim(room, hostConn);
  return { room, hostConn };
}

function joinTeams(room: DungeonRoom, hostConn: ReturnType<typeof makeConn>, count: number) {
  const ids = [T1, T2, T3].slice(0, count);
  const conns = ids.map((id, i) => makeConn(`player-conn-${i}`));
  ids.forEach((id, i) => send(room, conns[i], { type: "JOIN", teamId: id, teamKey: KEY, teamName: `Team ${i}` }));
  return { ids, conns };
}

describe("HOST_CLAIM", () => {
  it("does not make the first connection a host", () => {
    const room = new DungeonRoom(makeRoom() as any);
    const conn = makeConn("first");
    room.onConnect(conn);
    expect((room as any).isHost(conn)).toBe(false);
  });

  it("accepts the first claim and answers HOST_OK", () => {
    const room = new DungeonRoom(makeRoom() as any);
    const conn = makeConn("h1");
    claim(room, conn);
    expect((room as any).isHost(conn)).toBe(true);
    const msgs = (conn.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs.map((m) => m.type)).toEqual(["HOST_OK", "HOST_NEXT_LINE_STATE", "HOST_AI_STATUS"]);
    expect(msgs[0]).toEqual({ type: "HOST_OK", joinPassword: "" });
  });

  it("rejects a claim with a different token once a token is set", () => {
    const { room } = makeRoomWithHost();
    const intruder = makeConn("intruder");
    claim(room, intruder, "another-token-0123456789abcd");
    expect((room as any).isHost(intruder)).toBe(false);
    expect(lastSentTo(intruder)).toMatchObject({ type: "ERROR", error: "bad_token" });
  });

  it("lets a refreshed host reclaim control with the same token", () => {
    const { room, hostConn } = makeRoomWithHost();
    room.onClose(hostConn);
    expect((room as any).isHost(hostConn)).toBe(false);
    const again = makeConn("host-conn-2");
    claim(room, again);
    expect((room as any).isHost(again)).toBe(true);
  });

  it("lets two devices hold the token at once, and both can judge-gate", () => {
    const { room, hostConn } = makeRoomWithHost();
    const second = makeConn("host-phone");
    claim(room, second);
    joinTeams(room, hostConn, 1);
    send(room, second, { type: "HOST_START" });
    expect(room.game).not.toBeNull();
  });

  it("drops host rights when that connection closes", () => {
    const { room, hostConn } = makeRoomWithHost();
    room.onClose(hostConn);
    // The same client back on a new socket must claim again.
    const reconnected = makeConn(hostConn.id);
    room.onConnect(reconnected);
    joinTeams(room, reconnected, 1);
    send(room, reconnected, { type: "HOST_START" });
    expect(room.game).toBeNull();
    expect(lastSentTo(reconnected)).toMatchObject({ type: "ERROR", error: "not_host" });
  });

  it("rejects a token that is too short", () => {
    const room = new DungeonRoom(makeRoom() as any);
    const conn = makeConn("weak");
    claim(room, conn, "short");
    expect((room as any).isHost(conn)).toBe(false);
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });
});

describe("roomEpoch", () => {
  it("is on LOBBY and STATE and stays the same within one room instance", () => {
    const { room, hostConn } = makeRoomWithHost();
    const lobby = makeConn("a");
    room.onConnect(lobby);
    const epoch = lastSentTo(lobby).roomEpoch;
    expect(typeof epoch).toBe("string");
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    expect(lastBroadcast(room).roomEpoch).toBe(epoch);
  });

  it("differs between two room instances (a restart)", () => {
    const a = new DungeonRoom(makeRoom() as any);
    const b = new DungeonRoom(makeRoom() as any);
    const ca = makeConn("ca");
    const cb = makeConn("cb");
    a.onConnect(ca);
    b.onConnect(cb);
    expect(lastSentTo(ca).roomEpoch).not.toBe(lastSentTo(cb).roomEpoch);
  });
});

describe("onConnect", () => {
  it("sends a LOBBY message with the current pending teams before the game starts", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    const conn = makeConn("late-joiner");
    room.onConnect(conn);
    expect(lastSentTo(conn)).toMatchObject({ type: "LOBBY", teams: [{ id: T1 }] });
  });

  it("sends a STATE message once the game has started", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const conn = makeConn("late-joiner");
    room.onConnect(conn);
    expect(lastSentTo(conn)).toMatchObject({ type: "STATE", phase: "playing" });
  });
});

describe("JOIN", () => {
  it("rejects a non-UUID team id", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    send(room, conn, { type: "JOIN", teamId: BAD_ID, teamKey: KEY, teamName: "Team X" });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_team_id" });
  });

  it("rejects an empty/whitespace team name after sanitization", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    send(room, conn, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "   " });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_name" });
  });

  // Value: protects=two lobby teams never share a name (the epilogue and transcript match teams by name); fails_when=JOIN stops checking names already taken; why_new=only rename checked duplicates; seam=none; no_claim=none beyond protects
  it("rejects a name another team already has, like a rename does", () => {
    const { room } = makeRoomWithHost();
    send(room, makeConn("c1"), { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "紅隊" });
    const second = makeConn("c2");
    send(room, second, { type: "JOIN", teamId: T2, teamKey: KEY, teamName: " 紅隊 " });
    expect(lastSentTo(second)).toMatchObject({ type: "ERROR", error: "invalid_name", detail: "duplicate_name" });
    // Full-width and letter case look the same on the big screen, so they count as the same name.
    send(room, second, { type: "JOIN", teamId: T2, teamKey: KEY, teamName: "ｒｅｄ" });
    const third = makeConn("c3");
    send(room, third, { type: "JOIN", teamId: "00000000-0000-0000-0000-000000000003", teamKey: KEY2, teamName: "RED" });
    expect(lastSentTo(third)).toMatchObject({ type: "ERROR", error: "invalid_name", detail: "duplicate_name" });
  });

  // Value: protects=one socket cannot fill all MAX_TEAMS slots by JOINing new ids (TODOS: 一條連線能佔滿 8 隊);
  // fails_when=JOIN or REJOIN rebinds a connection that already plays for another team.
  it("one connection plays for one team: a different id is refused, the same id again still works", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn("c1");
    send(room, conn, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "紅隊" });
    send(room, conn, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "藍隊" });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "already_in_team" });
    expect(lastBroadcast(room).teams.map((t: { id: string }) => t.id)).toEqual([T1]);
    // A second team made elsewhere cannot be taken over from this socket with REJOIN either.
    send(room, makeConn("c2"), { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "藍隊" });
    send(room, conn, { type: "REJOIN", teamId: T2, teamKey: KEY2 });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "already_in_team" });
    // A resend of its own JOIN, or a REJOIN as itself, is fine.
    send(room, conn, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "紅隊" });
    send(room, conn, { type: "REJOIN", teamId: T1, teamKey: KEY });
    expect(lastSentTo(conn)).not.toMatchObject({ type: "ERROR" });
  });

  it("strips HTML-special characters from a team name", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    send(room, conn, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "<b>Team</b>" });
    const state = lastBroadcast(room);
    expect(state.teams[0].name).toBe("bTeam/b");
  });

  it("broadcasts the updated lobby roster on a successful join", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    send(room, conn, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Team A" });
    expect(lastBroadcast(room)).toMatchObject({ type: "LOBBY", teams: [{ id: T1, name: "Team A" }] });
  });

  it("asks new teams for the join password once the host sets one, but not a team that already joined", () => {
    const { room, hostConn } = makeRoomWithHost();
    send(room, makeConn("early"), { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Early" });
    const otherTab = makeConn("host-tab-2");
    claim(room, otherTab);
    send(room, hostConn, { type: "HOST_SET_PASSWORD", password: " dragon " });
    // Every host page hears the password the room now enforces.
    for (const c of [hostConn, otherTab]) expect(lastSentTo(c)).toEqual({ type: "HOST_OK", joinPassword: "dragon" });
    const noPw = makeConn("no-pw");
    send(room, noPw, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "Guess" });
    expect(lastSentTo(noPw)).toMatchObject({ type: "ERROR", error: "bad_password" });
    send(room, noPw, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "Guess", password: "dragons" });
    expect(lastSentTo(noPw)).toMatchObject({ type: "ERROR", error: "bad_password" });
    send(room, makeConn("pw"), { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "Friend", password: "dragon" });
    // A reload of an already-joined phone carries no password and still gets back in.
    send(room, makeConn("early-again"), { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Early" });
    expect(lastBroadcast(room).teams.map((t: { name: string }) => t.name)).toEqual(["Early", "Friend"]);
    // Only the host may set it.
    send(room, noPw, { type: "HOST_SET_PASSWORD", password: "" });
    expect(lastSentTo(noPw)).toMatchObject({ type: "ERROR", error: "not_host" });
    claim(room, makeConn("host-reload"));
    expect((room as any).joinPassword).toBe("dragon");
  });

  // Value: protects=a script cannot guess a short join password in minutes, and a phone that has not typed one yet
  // does not use up the room's guesses; fails_when=wrong guesses are unlimited, an empty password counts, or the
  // room stays locked after the window
  it("takes 10 wrong join passwords a minute, then refuses every password JOIN until the minute is up", () => {
    const clock = { t: 1_000_000 };
    const room = new DungeonRoom(makeRoom() as any, () => 0, { now: () => clock.t });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    send(room, hostConn, { type: "HOST_SET_PASSWORD", password: "1234" });
    const guesser = makeConn("guesser");
    for (let i = 0; i < 20; i++) send(room, guesser, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "Guess" }); // no password: not a guess
    for (let i = 0; i < 10; i++) {
      send(room, guesser, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "Guess", password: String(i) });
      expect(lastSentTo(guesser)).toEqual({ type: "ERROR", error: "bad_password" });
    }
    const friend = makeConn("friend");
    send(room, friend, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Friend", password: "1234" });
    expect(lastSentTo(friend)).toEqual({ type: "ERROR", error: "bad_password", detail: "too_many_attempts" });
    clock.t += 60_000;
    send(room, friend, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Friend", password: "1234" });
    expect(lastBroadcast(room).teams.map((t: { name: string }) => t.name)).toEqual(["Friend"]);
    // A new password lifts a lock at once.
    for (let i = 0; i < 10; i++) send(room, guesser, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "Guess", password: String(i) });
    send(room, hostConn, { type: "HOST_SET_PASSWORD", password: "5678" });
    send(room, makeConn("late"), { type: "JOIN", teamId: T3, teamKey: KEY2, teamName: "Late", password: "5678" });
    expect(lastBroadcast(room).teams.map((t: { name: string }) => t.name)).toEqual(["Friend", "Late"]);
  });

  it("rejects a 9th distinct team once the room is full (max 8)", () => {
    const { room } = makeRoomWithHost();
    for (let i = 0; i < 8; i++) {
      const id = `00000000-0000-0000-0000-00000000000${i}`;
      send(room, makeConn(`conn-${i}`), { type: "JOIN", teamId: id, teamKey: KEY, teamName: `Team ${i}` });
    }
    const overflowConn = makeConn("overflow");
    send(room, overflowConn, {
      type: "JOIN",
      teamId: "00000000-0000-0000-0000-000000000009", teamKey: KEY,
      teamName: "One Too Many",
    });
    expect(lastSentTo(overflowConn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "room_full" });
  });

  it("allows a team already in the pending roster to re-JOIN even when the room is at capacity", () => {
    const { room } = makeRoomWithHost();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = `00000000-0000-0000-0000-00000000000${i}`;
      ids.push(id);
      send(room, makeConn(`conn-${i}`), { type: "JOIN", teamId: id, teamKey: KEY, teamName: `Team ${i}` });
    }
    const rejoinConn = makeConn("rejoin-conn");
    send(room, rejoinConn, { type: "JOIN", teamId: ids[0], teamKey: KEY, teamName: "Team 0 again" });
    expect(lastSentTo(rejoinConn)).toBeNull();
  });

  it("rejects joining after the game has already started", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const conn = makeConn("latecomer");
    send(room, conn, { type: "JOIN", teamId: T2, teamKey: KEY, teamName: "Late Team" });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "game_already_started" });
  });
});

describe("HOST_START", () => {
  it("rejects a non-host trying to start the game", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    const conn = makeConn("not-host");
    send(room, conn, { type: "HOST_START" });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "not_host" });
  });

  it("rejects starting with zero teams", () => {
    const { room, hostConn } = makeRoomWithHost();
    send(room, hostConn, { type: "HOST_START" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "not_enough_teams" });
  });

  it("creates the game from the fixture rooms and broadcasts STATE", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    expect(room.game).not.toBeNull();
    expect(room.game!.rooms).toEqual(roomTemplates(BANK));
    expect(room.game!.boss.questionIds).toEqual(bossPhaseStates(BANK)[0].questionIds);
    expect(lastBroadcast(room)).toMatchObject({ type: "STATE", phase: "playing" });
  });

  it("a bank with randomMonsters draws this game's monsters: different room monsters, any boss, shown on the question", () => {
    const { room, hostConn } = makeRoomWithHost();
    (room as any).bank = { ...BANK, randomMonsters: true };
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const ids = room.game!.rooms.map((r) => r.monsterId!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => !catalogMonster(id).boss)).toBe(true);
    expect(catalogMonster(room.game!.bossMonsterId!).boss).toBe(true);
    expect(room.game!.rooms.map((r) => r.dish)).toEqual(ids.map((id) => catalogMonster(id).dish.name));
    expect(lastBroadcast(room).question.monster.id).toBe(ids[0]);
  });

  it("rejects starting twice", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    send(room, hostConn, { type: "HOST_START" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "game_already_started" });
  });
});

describe("HOST_JUDGE", () => {
  function startedGame(teamCount = 2) {
    const { room, hostConn } = makeRoomWithHost();
    const { ids } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids };
  }

  it("rejects a non-host judgment", () => {
    const { room, ids } = startedGame(1);
    const conn = makeConn("not-host");
    send(room, conn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "not_host" });
  });

  it("rejects judgment when there's no active game", () => {
    const { room, hostConn } = makeRoomWithHost();
    send(room, hostConn, { type: "HOST_JUDGE", teamId: T1, questionId: "r0-q1", correct: true });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "no_active_game" });
  });

  it("applies a correct answer and broadcasts the updated STATE", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    // Find STATE specifically rather than assuming it's the very last broadcast.
    const mock = room.room.broadcast as ReturnType<typeof vi.fn>;
    const state = mock.mock.calls.map((c) => JSON.parse(c[0])).findLast((m) => m.type === "STATE");
    expect(state.view.teams[0].score).toBe(1); // room 0 base difficulty
    expect(state.view.teams[0].roomIndex).toBe(1);
  });

  it("surfaces a stale-question InvalidActionError as an ERROR message without mutating state", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "wrong-question-id", correct: true });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[0].score).toBe(0);
  });

  it("surfaces an out-of-turn judgment as an ERROR", () => {
    const { room, hostConn, ids } = startedGame(2);
    // ids[1] is not first in turn order.
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[1], questionId: "r0-q1", correct: true });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });

  it("drops a judgment made from an older STATE without an error (a key pressed as the turn moved on)", () => {
    const { room, hostConn, ids } = startedGame(2);
    const seen = seqOf(room);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: false, fleeChoice: "retry", eventId: seen });
    const sends = (hostConn.send as ReturnType<typeof vi.fn>).mock.calls.length;
    // The host had not seen the STATE above yet: it judges team 0 again from the old one.
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true, eventId: seen });
    expect((hostConn.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sends);
    expect(room.game!.teams[0].score).toBe(0);
  });

  it("broadcasts GAME_OVER once the boss dies", () => {
    const { room, hostConn, ids } = startedGame(1);
    // Answer whatever question is current (room deal or boss) correctly until the game ends.
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) {
      const g = room.game!;
      const t = g.teams[0];
      const qid = t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId;
      serveNext(room, hostConn, seqOf(room)); // close the previous reveal (D7); no-op if none
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: qid, correct: true });
      landKill(room);
    }
    expect(room.game!.phase).toBe("finished");
    const broadcastCalls = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
    expect(broadcastCalls.some((m) => m.type === "GAME_OVER")).toBe(true);
  });
});

// Value: protects=the boss kill's 4d20 shows before it scores (kill-roll.md): no score, no game over and no podium
// before the beat ends, then exactly the shown dice are scored; fails_when=the kill is judged at once again, the scored
// bonus differs from the dice on screen, a second judgment slips in during the beat, or a dropped phone loses the kill;
// why_new=game-state tests cover killDice only, not the room's beat; seam=none; no_claim=the TV animation (d20 tests)
describe("the boss kill's 4d20 beat (kill-roll.md)", () => {
  afterEach(() => vi.useRealTimers());
  function lastHit(opts: { fixedDie?: number } = {}, io: Partial<RoomIO> = {}) {
    vi.useFakeTimers();
    const room = new DungeonRoom({ ...(makeRoom() as any), ...io }, () => 0.5, opts);
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    const g = room.game!;
    room.game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, phaseIndex: g.boss.phases.length - 1 } };
    const turn = currentTurnTeamId(room.game)!;
    const judge = () => send(room, hostConn, { type: "HOST_JUDGE", teamId: turn, questionId: room.game!.boss.currentQuestionId, correct: true });
    return { room, hostConn, ids, conns, turn, judge };
  }

  // Value: protects=a game won by the kill reaches the owner's log once; fails_when=the kill path stops calling
  // logGame, or a 結束冒險 after the finish logs the game a second time
  it("a kill logs the game once, as won by the killer", () => {
    const logGame = vi.fn();
    const { room, hostConn, turn, judge } = lastHit({}, { logGame });
    judge();
    vi.advanceTimersByTime(4000);
    expect(room.game!.phase).toBe("finished");
    send(room, hostConn, { type: "HOST_END_GAME" });
    expect(logGame).toHaveBeenCalledTimes(1);
    const log = logGame.mock.calls[0][0];
    expect(log).toMatchObject({ endedBy: "kill", bossHpLeft: 0 });
    expect(log.teams.find((t: { killedBoss: boolean }) => t.killedBoss).name).toBe(room.game!.teams.find((t) => t.id === turn)!.name);
  });

  it("holds the kill for the beat, then scores exactly the dice it showed", () => {
    const { room, turn, judge } = lastHit();
    const before = room.game!.teams.find((t) => t.id === turn)!.reward;
    judge();
    const roll = lastBroadcast(room).pendingRoll;
    expect(roll).toMatchObject({ teamId: turn, kind: "kill", values: [11, 11, 11, 11], value: 44 }); // rng 0.5: each d20 is 11
    expect(room.game!.phase).toBe("playing");
    expect(room.game!.teams.find((t) => t.id === turn)!.reward).toBe(before);
    vi.advanceTimersByTime(3999);
    expect(room.game!.phase).toBe("playing");
    vi.advanceTimersByTime(1);
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.teams.find((t) => t.id === turn)!.reward).toBe(before + 10 + 44);
  });

  it("refuses another judgment during the beat", () => {
    const { room, hostConn, turn, judge } = lastHit();
    judge();
    send(room, hostConn, { type: "HOST_JUDGE", teamId: turn, questionId: room.game!.boss.currentQuestionId, correct: false, fleeChoice: "retry" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "roll_pending" });
  });

  it("lands every die on E2E_DIE", () => {
    const { room, judge } = lastHit({ fixedDie: 7 });
    judge();
    expect(lastBroadcast(room).pendingRoll).toMatchObject({ kind: "kill", values: [7, 7, 7, 7], value: 28 });
  });

  it("keeps a team whose phone drops during the beat on turn, and still kills", () => {
    const { room, ids, conns, turn, judge } = lastHit();
    judge();
    room.onClose(conns[ids.indexOf(turn)]);
    vi.advanceTimersByTime(4000);
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.boss.killedByTeamId).toBe(turn);
  });

  // Value: protects=a kill is not dropped when a skipped offline team comes back during its beat; fails_when=the stored
  // turn index still points at the returning team, so resolveRoll sees "turn moved on" and drops the kill
  it("a skipped team whose phone comes back during the beat does not take the kill's turn", () => {
    const { room, ids, turn } = lastHit();
    const other = ids.find((id) => id !== turn)!;
    room.game = setTeamOnline(room.game!, turn, false);
    expect(currentTurnTeamId(room.game)).toBe(other);
    (room as any).judge(other, room.game!.boss.currentQuestionId, true, "retry");
    expect(lastBroadcast(room).pendingRoll).toMatchObject({ teamId: other, kind: "kill" });
    room.game = setTeamOnline(room.game!, turn, true);
    vi.advanceTimersByTime(4000);
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.boss.killedByTeamId).toBe(other);
  });

  it("ending the game during the beat drops the kill unscored", () => {
    const { room, hostConn, turn, judge } = lastHit();
    judge();
    send(room, hostConn, { type: "HOST_END_GAME" });
    vi.advanceTimersByTime(4000);
    expect((room as any).pendingRoll).toBeNull();
    expect((room as any).pendingKill).toBeNull();
    expect(room.game!.boss.killedByTeamId ?? null).toBeNull();
    expect(room.game!.teams.find((t) => t.id === turn)!.reward).toBe(0);
  });

  it("an ordinary boss hit is judged at once, with no dice", () => {
    const { room, turn, judge } = lastHit();
    room.game = { ...room.game!, boss: { ...room.game!.boss, hp: 3 } };
    judge();
    expect(lastBroadcast(room).pendingRoll ?? null).toBeNull();
    expect(room.game!.boss.hp).toBe(2);
    expect(room.game!.teams.find((t) => t.id === turn)!.reward).toBe(10);
  });
});

describe("HOST_SEND_TO_BOSS (scoring-and-score-pools.md S13)", () => {
  function startedGame(teamCount = 2) {
    const { room, hostConn } = makeRoomWithHost();
    const { ids } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids };
  }

  it("rejects a non-host", () => {
    const { room, ids } = startedGame(1);
    const conn = makeConn("not-host");
    send(room, conn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "not_host" });
    expect(room.game!.teams[0].inBoss).toBe(false);
  });

  it("rejects when there's no active game", () => {
    const { room, hostConn } = makeRoomWithHost();
    send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: T1 });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "no_active_game" });
  });

  it("puts the team in the boss room and broadcasts it", () => {
    const { room, hostConn, ids } = startedGame(2);
    send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[1] });
    expect(room.game!.teams.find((t) => t.id === ids[1])!.inBoss).toBe(true);
    expect(lastBroadcast(room)).toMatchObject({ type: "STATE" });
    expect(lastBroadcast(room).view.teams.find((t: { id: string }) => t.id === ids[1]).inBossPhase).toBe(true);
    send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[1] });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });
  it("pays the bank's boss.hitReward on a boss hit, not the default 10", () => {
    const bank = parseBank({
      rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [{ kind: "text", id: "r0-q1", content: { kind: "text", value: "？" }, answer: "x" }] }],
      boss: { monster: "dragon", maxHp: 3, hitReward: 25, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
    });
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids } = joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "boss-q1", correct: true });
    expect(room.game!.teams[0].reward).toBe(25);
  });
});

describe("HOST_QUEUE_QUESTION (the host picks the next question)", () => {
  function startedGame(teamCount = 2) {
    const { room, hostConn } = makeRoomWithHost();
    const { ids, conns } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids, conns };
  }
  const sentOf = (conn: ReturnType<typeof makeConn>) => (conn.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const lastPicks = (conn: ReturnType<typeof makeConn>) => sentOf(conn).findLast((m) => m.type === "HOST_PICKS");

  it("rejects a non-host and a room with no game", () => {
    const { room, ids } = startedGame(1);
    const conn = makeConn("not-host");
    send(room, conn, { type: "HOST_QUEUE_QUESTION", target: ids[0], questionId: null });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "not_host" });
    const { room: idle, hostConn } = makeRoomWithHost();
    send(idle, hostConn, { type: "HOST_QUEUE_QUESTION", target: T1, questionId: null });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "no_active_game" });
  });

  it("sends the host its picker with answers, queues a pick, and deals it on the team's next correct answer", () => {
    const { room, hostConn, ids } = startedGame(2);
    const picks = lastPicks(hostConn);
    const pick = picks.options[ids[0]].find((id: string) => !picks.questions.find((q: { id: string; block?: unknown }) => q.id === id).block);
    const entry = picks.questions.find((q: { id: string }) => q.id === pick);
    expect(entry.answer).toBe(answerText(findQuestion(BANK, pick)!));
    send(room, hostConn, { type: "HOST_QUEUE_QUESTION", target: ids[0], questionId: pick });
    expect(lastPicks(hostConn).queued).toEqual({ [ids[0]]: pick });
    // The picker (it carries answers) never goes out to everyone.
    const broadcasts = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
    expect(broadcasts.some((m) => m.type === "HOST_PICKS")).toBe(false);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: room.game!.teams[0].currentQuestionId, correct: true });
    expect(room.game!.teams[0].currentQuestionId).toBe(pick);
  });

  // Regression: ISSUE-002 — every STATE (even a phone's option tap) re-sent the whole picker with every answer
  // Found by /review on 2026-10-28
  it("sends the host its picker again only when the picker changed", () => {
    const { room, hostConn, ids, conns } = startedGame(2);
    const picksSent = () => sentOf(hostConn).filter((m) => m.type === "HOST_PICKS").length;
    const before = picksSent();
    const states = () => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.length;
    const broadcasts = states();
    room.onClose(conns[1]); // a phone dropping: a STATE goes out, the picker is the same
    expect(states()).toBeGreaterThan(broadcasts);
    expect(picksSent()).toBe(before);
    send(room, hostConn, { type: "HOST_QUEUE_QUESTION", target: ids[1], questionId: lastPicks(hostConn).options[ids[1]].at(-1) });
    expect(picksSent()).toBe(before + 1);
  });

  // Regression: ISSUE-003 — after the last host left, the room's record of the last picker went stale and dropped a real change
  // Found by /ship adversarial review on 2026-10-28
  it("a host that comes back still gets every picker change", () => {
    const { room, hostConn, ids, conns } = startedGame(2);
    const pick = lastPicks(hostConn).options[ids[1]].at(-1);
    send(room, hostConn, { type: "HOST_QUEUE_QUESTION", target: ids[1], questionId: pick });
    room.onClose(hostConn);
    // While no host is connected the picker changes (a phone's play can do this; set it directly here).
    (room as any).game = { ...room.game!, teams: room.game!.teams.map((t) => ({ ...t, queuedQuestionId: undefined })) };
    room.onClose(conns[0]); // a STATE goes out
    const back = makeConn("host-back");
    room.onConnect(back);
    claim(room, back);
    expect(lastPicks(back).queued).toEqual({});
    send(room, back, { type: "HOST_QUEUE_QUESTION", target: ids[1], questionId: pick });
    expect(lastPicks(back).queued).toEqual({ [ids[1]]: pick });
  });

  it("queues the boss's next question and reports it in HOST_PICKS", () => {
    const { room, hostConn, ids } = startedGame(2);
    send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
    const picks = lastPicks(hostConn);
    expect(picks.options[ids[0]]).toBeUndefined();
    const pick = picks.options.boss.find((id: string) => !picks.questions.find((q: { id: string; block?: unknown }) => q.id === id).block);
    send(room, hostConn, { type: "HOST_QUEUE_QUESTION", target: "boss", questionId: pick });
    expect(lastPicks(hostConn).queued).toEqual({ boss: pick });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: room.game!.boss.currentQuestionId, correct: true });
    expect(room.game!.boss.currentQuestionId).toBe(pick);
  });

  it("refuses a question the team can't be dealt next", () => {
    const { room, hostConn, ids } = startedGame(2);
    send(room, hostConn, { type: "HOST_QUEUE_QUESTION", target: ids[0], questionId: room.game!.teams[1].currentQuestionId });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[0].queuedQuestionId).toBeUndefined();
  });
});

describe("answer reveal on STATE (D2/D3/D5/D7)", () => {
  function startedGame(teamCount = 2) {
    const { room, hostConn } = makeRoomWithHost();
    const { ids } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids };
  }
  const broadcastsOf = (room: DungeonRoom) => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const revealOf = (room: DungeonRoom) => broadcastsOf(room).findLast((m) => m.type === "STATE")?.reveal;

  it("broadcasts the correct answer to everyone (not just the host) on a correct answer", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const revealed = revealOf(room);
    expect(revealed).toMatchObject({ questionId: "r0-q1", answer: answerText(findQuestion(BANK, "r0-q1")!) });
  });

  it("does not reveal on a retry (wrong answer, staying on the same question)", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: false, fleeChoice: "retry" });
    expect(revealOf(room)).toBeNull();
  });

  it("does not reveal on a flee (wrong answer, giving up on the question)", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: false, fleeChoice: "flee" });
    expect(revealOf(room)).toBeNull();
  });

  it("includes the explanation when the question has one, using room.env.R2_PUBLIC_BASE_URL for an image explanation", () => {
    const bankWithExplanation = parseBank({
      rooms: [
        {
          monster: "slime-soft",
          baseDifficulty: 1, reward: 10,
          questions: [
            {
              kind: "text",
              id: "r0-q1",
              content: { kind: "text", value: "題目？" },
              answer: "答案",
              explanation: { kind: "image", value: "66666666-6666-6666-6666-666666666666" },
            },
          ],
        },
      ],
      boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
    });
    const roomIO = { ...(makeRoom() as any), env: { R2_PUBLIC_BASE_URL: "https://pub.example.r2.dev" } } as RoomIO;
    const explanationRoom = new DungeonRoom(roomIO, () => 0, { bank: bankWithExplanation });
    const hostConn2 = makeConn("host-conn-2");
    explanationRoom.onConnect(hostConn2);
    claim(explanationRoom, hostConn2);
    const { ids: teamIds } = joinTeams(explanationRoom, hostConn2, 1);
    send(explanationRoom, hostConn2, { type: "HOST_START" });
    send(explanationRoom, hostConn2, { type: "HOST_JUDGE", teamId: teamIds[0], questionId: "r0-q1", correct: true });
    const revealed = revealOf(explanationRoom);
    expect(revealed.explanation).toEqual({ kind: "image", url: "https://pub.example.r2.dev/66666666-6666-6666-6666-666666666666" });
  });

  it("reveals the boss question on a correct boss hit (the correct-boss-hit branch, not just room advances)", () => {
    const { room, hostConn, ids } = startedGame(1);
    for (let i = 0; i < 100 && room.game!.teams[0].score < room.game!.config.bossThreshold; i++) {
      serveNext(room, hostConn, seqOf(room)); // close the previous reveal (D7); no-op if none
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: room.game!.teams[0].currentQuestionId, correct: true });
    }
    const bossQid = room.game!.boss.currentQuestionId;
    serveNext(room, hostConn, seqOf(room));
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: bossQid, correct: true });
    const revealed = revealOf(room);
    expect(revealed).toMatchObject({ questionId: bossQid, answer: answerText(findQuestion(BANK, bossQid)!) });
    // Revealed means never redealt: the ring moved on and remembers it (D4/D5).
    expect(room.game!.revealedQuestionIds).toContain(bossQid);
    expect(room.game!.boss.currentQuestionId).not.toBe(bossQid);
  });

  it("has no explanation field at all when the question has none", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const revealed = revealOf(room);
    expect(revealed).not.toHaveProperty("explanation");
  });

  it("reveals the question that was JUST answered, not the one now in play (state-capture-ordering trap, Outside Voice finding)", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const revealed = revealOf(room);
    // Must name the question that was actually answered (r0-q1), never whatever the team is
    // holding now that the turn has already advanced.
    expect(revealed.questionId).toBe("r0-q1");
    expect(room.game!.teams[0].currentQuestionId).not.toBe("r0-q1");
  });

  it("the reveal and the post-judgment state arrive in the same STATE, so no client ever shows the next question first", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const state = broadcastsOf(room).findLast((m) => m.type === "STATE");
    expect(state.reveal.questionId).toBe("r0-q1");
    expect(state.view.teams[0].score).toBe(1);
  });

  it("stays up until the host sends HOST_NEXT, which clears it and rebroadcasts (D7)", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    serveNext(room, hostConn, seqOf(room));
    expect(revealOf(room)).toBeNull();
  });

  it("a reconnecting screen still gets the reveal", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const late = makeConn("late-screen");
    room.onConnect(late);
    expect(lastSentTo(late)).toMatchObject({ type: "STATE", reveal: { questionId: "r0-q1" } });
  });

  it("a stale HOST_NEXT (for an older STATE) doesn't close a newer reveal", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const firstRevealEvent = seqOf(room);
    serveNext(room, hostConn, firstRevealEvent);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: room.game!.teams[0].currentQuestionId, correct: true });
    const second = revealOf(room);
    serveNext(room, hostConn, firstRevealEvent); // a second device's late tap
    expect(revealOf(room)).toEqual(second);
    expect(second).not.toBeNull();
  });

  it("HOST_NEXT from a non-host is rejected and leaves the reveal up", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const stranger = makeConn("stranger");
    room.onConnect(stranger);
    // The host serves and the hold is over, so only the host check stands between the stranger and 下一題.
    send(room, hostConn, { type: "HOST_SERVE", eventId: seqOf(room) });
    (room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(room, stranger, { type: "HOST_NEXT", eventId: seqOf(room) });
    expect(lastSentTo(stranger)).toMatchObject({ type: "ERROR", error: "not_host" });
    expect(revealOf(room)).toMatchObject({ questionId: "r0-q1" });
  });

  it("rejects a judgment while a reveal is up, so a second host device can't skip past it (D7)", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const next = room.game!.teams[0].currentQuestionId;
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: next, correct: true });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "reveal_pending" });
    expect(room.game!.teams[0].currentQuestionId).toBe(next);
    serveNext(room, hostConn, seqOf(room));
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: next, correct: false, fleeChoice: "retry" });
    expect(revealOf(room)).toBeNull();
  });

  it("HOST_NEXT with nothing revealed is a no-op (no extra STATE)", () => {
    const { room, hostConn } = startedGame(1);
    const before = broadcastsOf(room).length;
    serveNext(room, hostConn, seqOf(room));
    expect(broadcastsOf(room).length).toBe(before);
  });
});

describe("TEAM_SELECT_OPTION", () => {
  // A minimal bank with one multipleChoice question so the success path (and the live
  // options.length bounds check) can be exercised without touching the shipped bank.
  const mcBank = parseBank({
    rooms: [
      {
        monster: "slime-soft",
        baseDifficulty: 1, reward: 10,
        questions: [{ kind: "multipleChoice", id: "r0-mc1", content: { kind: "text", value: "選哪個？" }, options: ["A", "B", "C"], correctIndex: 1 }],
      },
    ],
    boss: {
      monster: "dragon",
      maxHp: 3, hitReward: 10,
      questions: [
        { kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" },
        { kind: "multipleChoice", id: "boss-mc1", content: { kind: "text", value: "選哪個？" }, options: ["X", "Y"], correctIndex: 0 },
      ],
    },
  });

  function startedMcGame(teamCount = 2) {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: mcBank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids, conns };
  }

  // Value: protects=a correct lock's crit die (dnd design R9, R10, D10, E2): it shows for a beat before anything is
  // scored, a 20 pays half again, its team keeps the turn through a dropped phone, every roll is logged once, and the
  // big screen hears roll then crit/fumble through cueSeq; fails_when=the score or answer leaks into the die's beat, the
  // die is skipped or rolled on a wrong lock, or a cue repeats; seam=none; no_claim=the overlay itself (e2e)
  describe("the crit die after a correct lock (dnd design R9, R10)", () => {
    afterEach(() => vi.useRealTimers());
    function critGame(teamCount = 1) {
      let r = 0;
      const room = new DungeonRoom(makeRoom() as any, () => r, { bank: mcBank });
      const hostConn = makeConn("host-conn");
      room.onConnect(hostConn);
      claim(room, hostConn);
      const { ids, conns } = joinTeams(room, hostConn, teamCount);
      send(room, hostConn, { type: "HOST_START" });
      /** Locks option `i` for team 0, sets the die to land on `value`, and presses 公布答案. */
      const lockAndReveal = (i: number, value: number, questionId = "r0-mc1") => {
        send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId, optionIndex: i });
        send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId });
        r = (value - 1) / 20;
        reveal(room);
      };
      const states = () => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE");
      return { room, hostConn, ids, conns, lockAndReveal, states };
    }

    it("rolls only after a right reveal, holds it for 2 s with no score, answer or reveal, then judges a 20 as +50%", () => {
      vi.useFakeTimers();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { room, hostConn, ids, lockAndReveal } = critGame();
      const seq = seqOf(room);
      lockAndReveal(1, 20);
      vi.advanceTimersByTime(2000);
      const held = lastBroadcast(room);
      expect(held.pendingLock).toBeNull();
      expect(held.pendingRoll).toEqual({ teamId: ids[0], questionId: "r0-mc1", value: 20, kind: "crit" });
      expect(held.reveal).toBeNull();
      expect(held.view.teams[0].score).toBe(0);
      expect(JSON.stringify(held)).not.toContain("correctIndex");
      expect(seqOf(room)).toBe(seq);
      const rolls = log.mock.calls.filter((c) => String(c[0]).includes('"event":"roll"')).map((c) => JSON.parse(String(c[0])));
      expect(rolls).toEqual([{ event: "roll", kind: "crit", value: 20 }]);
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-mc1", correct: true, eventId: seq });
      expect(lastSentTo(hostConn)?.detail).toBe("roll_pending");
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).pendingRoll).toBeNull();
      expect(lastBroadcast(room).reveal).toMatchObject({ questionId: "r0-mc1", choice: { points: 15 } });
      expect(room.game!.teams[0]).toMatchObject({ score: 1, reward: 15 });
      expect(seqOf(room)).toBe(seq + 1);
      log.mockRestore();
    });

    it("a wrong lock rolls no die", () => {
      vi.useFakeTimers();
      const { room, lockAndReveal } = critGame();
      lockAndReveal(0, 20);
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).pendingRoll).toBeNull();
      expect(room.game!.pendingWrong).toMatchObject({ questionId: "r0-mc1", optionIndex: 0 });
    });

    it("the big screen gets roll, then crit for a 20 or fumble for a 1, each with a new cueSeq", () => {
      vi.useFakeTimers();
      for (const [value, cue] of [[20, "crit"], [1, "fumble"], [7, "correct"]] as const) {
        const { lockAndReveal, states } = critGame();
        const start = states().at(-1).cueSeq;
        lockAndReveal(1, value);
        vi.advanceTimersByTime(2000);
        expect(states().at(-1)).toMatchObject({ cue: "roll", cueSeq: start + 1 });
        vi.advanceTimersByTime(2000);
        expect(states().at(-1)).toMatchObject({ cue, cueSeq: start + 2 });
      }
    });

    it("a team whose phone closes during the die keeps its right answer, then shows offline", () => {
      vi.useFakeTimers();
      const { room, ids, conns, lockAndReveal } = critGame(2);
      lockAndReveal(1, 9);
      vi.advanceTimersByTime(2000);
      room.onClose(conns[0]);
      expect(currentTurnTeamId(room.game!)).toBe(ids[0]);
      vi.advanceTimersByTime(2000);
      expect(room.game!.teams[0]).toMatchObject({ score: 1, reward: 10 });
      expect(room.game!.teams[0].online).toBe(false);
    });

    // Value: protects=ending the game inside the die drops it unscored and still shows a closed phone's team offline;
    // fails_when=clearAnswerTimers stops clearing or syncing a crit roll; no_claim=the end screen (e2e)
    it("ending the game during the die drops it unscored and shows a team whose phone closed offline", () => {
      vi.useFakeTimers();
      const { room, hostConn, conns, lockAndReveal } = critGame(2);
      lockAndReveal(1, 20);
      vi.advanceTimersByTime(2000);
      room.onClose(conns[0]);
      send(room, hostConn, { type: "HOST_END_GAME" });
      vi.advanceTimersByTime(2000);
      expect((room as any).pendingRoll).toBeNull();
      expect(room.game?.teams[0]).toMatchObject({ score: 0, online: false });
    });

    // Value: protects=a room that expires inside the die comes back usable; fails_when=the next game's judge says roll_pending
    it("an expiring room drops a crit die still in its beat: the next game is not stuck behind it", async () => {
      vi.useFakeTimers();
      const { room, lockAndReveal } = critGame();
      lockAndReveal(1, 20);
      vi.advanceTimersByTime(2000);
      await (room as any).expire();
      vi.advanceTimersByTime(2000);
      expect(room.game).toBeNull();
      const host2 = makeConn("host-conn-2");
      room.onConnect(host2);
      claim(room, host2);
      const { conns: conns2 } = joinTeams(room, host2, 1);
      send(room, host2, { type: "HOST_START" });
      const q = room.game!.teams[0].currentQuestionId; // multipleChoice is phone-judged: the next game locks
      send(room, conns2[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: 1 });
      send(room, conns2[0], { type: "TEAM_LOCK_OPTION", questionId: q });
      expect(lastSentTo(conns2[0])?.type).not.toBe("ERROR");
      expect((room as any).pendingLock).toMatchObject({ questionId: q });
    });

    // Value: protects=a crit die that kills the boss pays half the hit reward and keeps the boss-kill sound (dnd design E2);
    // fails_when=setCue drops the boss-kill exception (cue "crit") or the kill skips the crit bonus; why_new=game-state tests
    // cover the reward only, cue tests cover room hits only; seam=none; no_claim=the sound itself (cue name only)
    it("a 20 that kills the boss pays half the hit reward on top and keeps the boss-kill cue", () => {
      vi.useFakeTimers();
      const { room, ids, lockAndReveal, states } = critGame();
      const g = room.game!;
      (room as any).game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, currentQuestionId: "boss-mc1" } };
      lockAndReveal(room.game!.optionOrder["boss-mc1"].indexOf(0), 20, "boss-mc1");
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).pendingRoll).toMatchObject({ teamId: ids[0], questionId: "boss-mc1", value: 20, kind: "crit" });
      const seq = states().at(-1).cueSeq;
      vi.advanceTimersByTime(2000);
      // The crit die's beat ends in the kill's 4d20 beat: nothing is scored yet (kill-roll.md).
      expect(lastBroadcast(room).pendingRoll).toMatchObject({ kind: "kill", values: [20, 20, 20, 20], value: 80 });
      expect(room.game!.phase).toBe("playing");
      vi.advanceTimersByTime(4000);
      // hitReward 10 + half of it 5 + the 4d20 at the same rng, four 20s = 80 (not raised by the crit).
      expect(room.game!.teams[0].reward).toBe(95);
      expect(room.game!.phase).toBe("finished");
      // The kill's dice roll with their own cue, then the kill keeps its boss-kill cue.
      expect(states().at(-1)).toMatchObject({ cue: "boss-kill", cueSeq: seq + 2 });
    });

    // Value: protects=a crit that kills still scores when the phone drops during the crit beat; fails_when=resolveRoll
    // syncs the team offline before the chained kill beat lands (the 4d20 then throws "not T's turn" and never scores)
    it("a 20 that kills keeps its team on turn through a phone dropped during the crit beat", () => {
      vi.useFakeTimers();
      const { room, conns, lockAndReveal } = critGame();
      const g = room.game!;
      (room as any).game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, currentQuestionId: "boss-mc1" } };
      lockAndReveal(room.game!.optionOrder["boss-mc1"].indexOf(0), 20, "boss-mc1");
      vi.advanceTimersByTime(2000);
      room.onClose(conns[0]);
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).pendingRoll).toMatchObject({ kind: "kill" });
      vi.advanceTimersByTime(4000);
      expect(room.game!.phase).toBe("finished");
      expect(room.game!.teams[0]).toMatchObject({ reward: 95, online: false });
    });
  });

  // Value: protects=the persuasion check's room rules (dnd design R6, R-E1, R-E4): only the team on turn rolls, once per
  // question, under the current eventId; the hint stays out of every broadcast until the beat ends; a retry keeps the
  // check instead of rolling again; fails_when=a stale or off-turn press rolls, the hint leaks during the beat, or a
  // retry re-rolls; seam=none; no_claim=the phone button and DC chip (e2e)
  describe("the persuasion check (dnd design R6, R-E1)", () => {
    afterEach(() => vi.useRealTimers());
    const checkBank: Bank = { ...mcBank, pools: { ...mcBank.pools, 1: [{ kind: "text", id: "r0-t1", content: { kind: "text", value: "？" }, answer: "萬家福" }] } };
    function checkGame(teamCount = 1) {
      let r = 0;
      const room = new DungeonRoom(makeRoom() as any, () => r, { bank: checkBank });
      const hostConn = makeConn("host-conn");
      room.onConnect(hostConn);
      claim(room, hostConn);
      const { ids, conns } = joinTeams(room, hostConn, teamCount);
      send(room, hostConn, { type: "HOST_START" });
      /** Team `i` presses 擲骰說服 with the die set to land on `value`. */
      const roll = (value: number, i = 0, eventId = seqOf(room)) => {
        r = (value - 1) / 20;
        send(room, conns[i], { type: "TEAM_ROLL_CHECK", questionId: "r0-t1", eventId });
      };
      return { room, hostConn, ids, conns, roll };
    }

    it("refuses a stale eventId, a team off turn and a multiple-choice question, rolling nothing", () => {
      const { room, conns, roll } = checkGame(2);
      roll(15, 0, seqOf(room) - 1);
      expect(lastSentTo(conns[0])).toMatchObject({ error: "invalid_action", detail: "stale_event" });
      roll(15, 1);
      expect(lastSentTo(conns[1])).toMatchObject({ error: "invalid_action", detail: "not_your_turn" });
      send(room, conns[0], { type: "TEAM_ROLL_CHECK", questionId: "r0-mc1", eventId: seqOf(room) });
      expect(lastSentTo(conns[0])).toMatchObject({ error: "invalid_action", detail: "stale_question" });
      expect(lastBroadcast(room).pendingRoll).toBeNull();
      expect(room.game!.checks ?? {}).toEqual({});
    });

    it("holds the hint out of every broadcast during the beat, then shows the check with its first character", () => {
      vi.useFakeTimers();
      const { room, ids, roll } = checkGame();
      roll(15);
      const held = lastBroadcast(room);
      expect(held.pendingRoll).toMatchObject({ teamId: ids[0], questionId: "r0-t1", value: 15, kind: "check" });
      expect(held.view.checks ?? {}).toEqual({});
      expect(JSON.stringify(held)).not.toContain("萬");
      vi.advanceTimersByTime(2000);
      const after = lastBroadcast(room);
      expect(after.pendingRoll).toBeNull();
      expect(after.cue).toBe("check-pass");
      expect(after.view.checks[checkKey("r0-t1", ids[0])]).toMatchObject({ value: 15, passed: true, hint: "萬" });
    });

    it("rolls once per question: a second press and a press after a wrong retry are refused", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns, roll } = checkGame();
      roll(3);
      roll(18);
      expect(lastSentTo(conns[0])).toMatchObject({ detail: "answer_pending" });
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).cue).toBe("check-fail");
      roll(18);
      expect(lastSentTo(conns[0])).toMatchObject({ detail: "check_done" });
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-t1", correct: false, eventId: seqOf(room) });
      send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "r0-t1", choice: "retry" });
      roll(18);
      expect(lastSentTo(conns[0])).toMatchObject({ detail: "check_done" });
      expect(room.game!.checks![checkKey("r0-t1", ids[0])]).toMatchObject({ value: 3, passed: false });
    });

    // Value: protects=the e2e die seam only takes a real die face (worker E2E_DIE); fails_when=a bad var fixes the die
    it("a fixed die (e2e E2E_DIE) lands every roll on its face, and only a face 1-20 counts", () => {
      expect([fixedDie("10"), fixedDie("20"), fixedDie("1")]).toEqual([10, 20, 1]);
      for (const bad of [undefined, "", "0", "21", "9.5", "x"]) expect(fixedDie(bad)).toBeUndefined();
      vi.useFakeTimers();
      const room = new DungeonRoom(makeRoom() as any, () => 0.99, { bank: checkBank, fixedDie: 10 });
      const hostConn = makeConn("host-conn");
      room.onConnect(hostConn);
      claim(room, hostConn);
      const { conns } = joinTeams(room, hostConn, 1);
      send(room, hostConn, { type: "HOST_START" });
      send(room, conns[0], { type: "TEAM_ROLL_CHECK", questionId: "r0-t1", eventId: seqOf(room) });
      expect(lastBroadcast(room).pendingRoll).toMatchObject({ value: 10, kind: "check" });
    });

    it("a natural 20 wins outright with no hint", () => {
      vi.useFakeTimers();
      const { room, roll } = checkGame();
      roll(20);
      vi.advanceTimersByTime(2000);
      expect(room.game!.teams[0].score).toBe(1);
      expect(JSON.stringify(lastBroadcast(room).view.checks ?? {})).not.toContain("萬");
      // The win plays the correct answer's cue, not the crit die's (dnd design E2).
      expect(lastBroadcast(room).cue).toBe("correct");
    });

    // Value: protects=a team cannot throw a bad check away by closing its phone during the beat (state matrix
    // check × drop-turn-moved); fails_when=onClose lets the turn move, the roll is dropped, the team rolls again.
    it("a phone that closes during the beat keeps the turn: the check is written, and a second press is refused", () => {
      vi.useFakeTimers();
      const { room, ids, conns, roll } = checkGame(2);
      roll(1);
      room.onClose(conns[0]);
      expect(currentTurnTeamId(room.game!)).toBe(ids[0]);
      vi.advanceTimersByTime(2000);
      expect(room.game!.checks![checkKey("r0-t1", ids[0])]).toMatchObject({ value: 1, passed: false });
      // No phone left: the team shows offline now, and the turn moves on.
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
    });

    // Value: protects=a natural 20 that kills the boss still scores when the phone drops during the check beat (state
    // matrix check20 x phone-drop); fails_when=resolveRoll syncs the team offline before the chained kill beat lands
    it("a natural 20 that kills keeps its team on turn through a phone dropped during the check beat", () => {
      vi.useFakeTimers();
      const { room, ids, conns, roll } = checkGame(2);
      const g = room.game!;
      (room as any).game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, phaseIndex: g.boss.phases.length - 1, currentQuestionId: "r0-t1" } };
      roll(20);
      room.onClose(conns[0]);
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).pendingRoll).toMatchObject({ teamId: ids[0], kind: "kill" });
      vi.advanceTimersByTime(4000);
      expect(room.game!.phase).toBe("finished");
      expect(room.game!.boss.killedByTeamId).toBe(ids[0]);
    });

    it("ending the game during the beat leaves no roll behind, and a natural 20 wins nothing after the end", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, roll } = checkGame();
      roll(20);
      send(room, hostConn, { type: "HOST_END_GAME" });
      vi.advanceTimersByTime(2000);
      expect((room as any).pendingRoll).toBeNull();
      expect(room.game!.phase).toBe("finished");
      expect(room.game!.teams.find((t) => t.id === ids[0])!.reward).toBe(0);
    });

    // Value: protects=a check written at the roll survives a restart inside the beat, so the team cannot reroll a 1
    // (Codex outside voice); fails_when=the record is written only when the beat ends; no_claim=the natural 20's win.
    it("the rolled check is in the saved game during the beat, so a restart cannot roll it again", () => {
      vi.useFakeTimers();
      const { room, ids, roll } = checkGame();
      roll(1);
      expect(room.game!.checks?.[checkKey("r0-t1", ids[0])]).toMatchObject({ value: 1, passed: false });
      expect(lastBroadcast(room).view.checks?.[checkKey("r0-t1", ids[0])]).toBeUndefined();
    });

    // Value: protects=the room, not only the phone, asks for the check first (Codex P1 in /review), and a typed
    // answer waiting for the host cannot be beaten by a natural 20; fails_when=a crafted message skips the roll.
    it("refuses a typed answer and a warrior's roll before the check, and a check after a typed answer", () => {
      vi.useFakeTimers();
      const { room, conns, roll } = checkGame();
      send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: "r0-t1", text: "萬家福", eventId: seqOf(room) });
      expect(lastSentTo(conns[0])).toMatchObject({ detail: "check_needed" });
      const warrior = new DungeonRoom(makeRoom() as any, () => 0, { bank: checkBank });
      const host = makeConn("host-conn");
      warrior.onConnect(host);
      claim(warrior, host);
      const w = joinTeams(warrior, host, 1);
      send(warrior, w.conns[0], { type: "TEAM_PICK_CLASS", classId: "warrior" });
      send(warrior, host, { type: "HOST_START" });
      send(warrior, w.conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t1" });
      expect(lastSentTo(w.conns[0])).toMatchObject({ detail: "check_needed" });
      expect(warrior.game!.teams[0].abilityUses).toBe(4);
      passChecks(room);
      send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: "r0-t1", text: "萬家福", eventId: seqOf(room) });
      delete room.game!.checks![checkKey("r0-t1", room.game!.teams[0].id)];
      roll(20);
      expect(lastSentTo(conns[0])).toMatchObject({ detail: "answer_submitted" });
    });
  });

  it("rejects a connection that never joined any team", () => {
    const { room } = startedMcGame(1);
    const spectator = makeConn("spectator-conn");
    send(room, spectator, { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 0 });
    expect(lastSentTo(spectator)).toMatchObject({ type: "ERROR", error: "unknown_team" });
  });

  it("rejects when there's no active game", () => {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: mcBank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { conns } = joinTeams(room, hostConn, 1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 0 });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "no_active_game" });
  });

  it("rejects a pick while an answer reveal is up, and accepts it once the host moves on (D7)", () => {
    vi.useFakeTimers();
    const { room, hostConn, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 1 });
    send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
    reveal(room);
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
    vi.useRealTimers();
    const next = room.game!.teams[0].currentQuestionId; // the room's only question, redealt
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: next, optionIndex: 0 });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "reveal_pending" });
    expect(room.game!.teams[0].currentSelection).toBeNull();
    serveNext(room, hostConn, seqOf(room));
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: next, optionIndex: 0 });
    expect(room.game!.teams[0].currentSelection).toBe(0);
  });

  it("shows the options in the game's shuffled order and judges a lock by the shown slot", () => {
    vi.useFakeTimers();
    // A non-zero rng moves the options (shuffledOptionOrders); the right answer is wherever B ends up.
    const room = new DungeonRoom(makeRoom() as any, () => 0.99, { bank: mcBank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { conns } = joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const order = room.game!.optionOrder["r0-mc1"];
    const shown = order.map((i) => ["A", "B", "C"][i]);
    expect(shown).not.toEqual(["A", "B", "C"]);
    expect(lastBroadcast(room).question.options).toEqual(shown);
    const right = shown.indexOf("B");
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: right });
    send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
    reveal(room);
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
    vi.useRealTimers();
    expect(room.game!.teams[0].reward).toBe(15); // rng 0.99 rolls the crit die to 20: 10 plus half
    expect(lastBroadcast(room).reveal.choice).toMatchObject({ options: shown, correctIndex: right });
  });

  it("records a valid pick and broadcasts it in STATE", () => {
    const { room, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 1 });
    const state = lastBroadcast(room);
    expect(state.type).toBe("STATE");
    expect(state.view.teams[0].currentSelection).toBe(1);
  });

  it("the broadcast question carries options for a multipleChoice question, with no correctIndex leaked", () => {
    const { room } = startedMcGame(1);
    const state = lastBroadcast(room);
    expect(state.question.options).toEqual(["A", "B", "C"]);
    expect(state.question).not.toHaveProperty("correctIndex");
  });

  it("is re-selectable — a later pick overwrites the earlier one", () => {
    const { room, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 0 });
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 2 });
    expect(room.game!.teams[0].currentSelection).toBe(2);
  });

  it("re-tapping the option already selected is a no-op — no redundant broadcast (adversarial review: no other rate limit on this message)", () => {
    const { room, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 1 });
    const broadcastsAfterFirstPick = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.length;
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 1 });
    expect((room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.length).toBe(broadcastsAfterFirstPick);
    expect(room.game!.teams[0].currentSelection).toBe(1);
  });

  it("rejects an optionIndex out of range for the live question, even though the protocol layer allowed it", () => {
    const { room, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 3 }); // only 0/1/2 exist
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[0].currentSelection).toBeNull();
  });

  it("rejects a questionId that isn't a multipleChoice question", () => {
    const { room, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "boss-q1", optionIndex: 0 });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });

  it("ignores a spoofed teamId in the payload — the sender's own team (via connTeam) is always used", () => {
    const { room, ids, conns } = startedMcGame(2);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: 1, teamId: ids[1] } as never);
    expect(room.game!.teams.find((t) => t.id === ids[0])!.currentSelection).toBe(1);
    expect(room.game!.teams.find((t) => t.id === ids[1])!.currentSelection).toBeNull();
  });

  it("rejects a questionId that isn't the one the team is actually facing right now", () => {
    const { room, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "some-other-question", optionIndex: 0 });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });

  it("rejects a real, in-bounds multipleChoice question that just isn't the team's current one (not in boss phase yet)", () => {
    const { room, conns } = startedMcGame(1);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "boss-mc1", optionIndex: 0 });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[0].currentSelection).toBeNull();
  });

  describe("phone answering: lock, 公布答案, beat, wrong choice (phone-answering.md, host-reveal.md)", () => {
    // A failed assertion must not leave fake timers on for the rest of the file.
    afterEach(() => vi.useRealTimers());
    const pick = (room: DungeonRoom, conn: Conn, i: number) => send(room, conn, { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: i });
    const lock = (room: DungeonRoom, conn: Conn) => {
      send(room, conn, { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      reveal(room);
    };
    const err = (conn: Conn) => lastSentTo(conn as never)?.detail;

    it("rejects a lock with no pick, off turn, or on a stale question (E11)", () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(2);
      lock(room, conns[0]);
      expect(err(conns[0])).toBe("no_selection");
      send(room, conns[1], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      reveal(room);
      expect(err(conns[1])).toBe("not_your_turn");
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "boss-mc1" });
      reveal(room);
      expect(err(conns[0])).toBe("stale_question");
      vi.useRealTimers();
    });

    it("rejects a lock whose index is not the room's current pick: another phone on the team changed it", () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(1);
      pick(room, conns[0], 1);
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1", optionIndex: 2 });
      reveal(room);
      expect(err(conns[0])).toBe("selection_changed");
      expect((room as any).pendingLock).toBeNull();
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1", optionIndex: 1 });
      reveal(room);
      expect((room as any).pendingLock).toMatchObject({ optionIndex: 1 });
    });

    it("holds the lock for 2 s with no score change, then reveals a correct answer (E2)", () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(1);
      const seq = seqOf(room);
      pick(room, conns[0], 1);
      lock(room, conns[0]);
      const held = lastBroadcast(room);
      expect(held.pendingLock).toMatchObject({ optionIndex: 1, questionId: "r0-mc1" });
      expect(held.view.teams[0].score).toBe(0);
      expect(held.reveal).toBeNull();
      expect(JSON.stringify(held)).not.toContain("correctIndex");
      vi.advanceTimersByTime(1999);
      expect(room.game!.teams[0].score).toBe(0);
      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
      const out = lastBroadcast(room);
      expect(out.pendingLock).toBeNull();
      expect(out.reveal).toMatchObject({ questionId: "r0-mc1", answer: "B" });
      expect(room.game!.teams[0].score).toBe(1);
      expect(seqOf(room)).toBe(seq + 1);
      expect((room as any).lastActivityAt).toBe(Date.now()); // the idle clock restarts at the reveal
      vi.useRealTimers();
    });

    it("a wrong lock waits for the team's choice without bumping eventSeq (E7), then retry narrates", () => {
      vi.useFakeTimers();
      const { room, hostConn, conns } = startedMcGame(2);
      const seq = seqOf(room);
      pick(room, conns[0], 0);
      lock(room, conns[0]);
      vi.advanceTimersByTime(2000);
      const st = lastBroadcast(room);
      expect(st.view.pendingWrong).toMatchObject({ optionIndex: 0, questionId: "r0-mc1" });
      expect(st.view.eliminated).toEqual({ "r0-mc1": [0] });
      expect(st.reveal).toBeNull();
      expect(JSON.stringify(st)).not.toContain("correctIndex"); // a wrong lock never reveals the right option
      expect(seqOf(room)).toBe(seq);
      pick(room, conns[0], 2);
      expect(err(conns[0])).toBe("answer_pending");
      serveNext(room, hostConn, seqOf(room));
      expect(room.game!.pendingWrong).not.toBeNull();
      send(room, conns[1], { type: "TEAM_WRONG_CHOICE", questionId: "r0-mc1", choice: "retry" });
      expect(err(conns[1])).toBe("no_wrong_answer");
      send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "r0-mc1", choice: "retry" });
      expect(room.game!.pendingWrong).toBeNull();
      expect(seqOf(room)).toBe(seq + 1);
      expect(lastBroadcast(room).view.currentTurnTeamId).toBe(room.game!.turnOrder[1]);
      vi.useRealTimers();
    });

    it("HOST_JUDGE on multipleChoice: 答對 is refused, 重答/逃跑 resolves a stuck team, nothing during the beat (E5, E10)", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(2);
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-mc1", correct: true });
      expect(err(hostConn)).toBe("auto_judged");
      pick(room, conns[0], 0);
      lock(room, conns[0]);
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-mc1", correct: false, fleeChoice: "retry" });
      expect(err(hostConn)).toBe("lock_pending");
      vi.advanceTimersByTime(2000);
      send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "r0-mc1", choice: "x" } as never);
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-mc1", correct: false, fleeChoice: "flee" });
      expect(room.game!.pendingWrong).toBeNull();
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
      vi.useRealTimers();
    });

    it("a wrong boss lock offers no choice: after a beat the question rotates and the turn moves on (D2=B)", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(2);
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      room.game = { ...room.game!, boss: { ...room.game!.boss, currentQuestionId: "boss-mc1" } };
      const wrongIdx = room.game.optionOrder["boss-mc1"].indexOf(1); // "Y"; "X" is right
      const seq = seqOf(room);
      send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "boss-mc1", optionIndex: wrongIdx });
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "boss-mc1" });
      reveal(room);
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).view.pendingWrong).toMatchObject({ teamId: ids[0], questionId: "boss-mc1" }); // the red tile shows
      expect(seqOf(room)).toBe(seq);
      vi.advanceTimersByTime(1999);
      expect(room.game!.pendingWrong).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(room.game!.pendingWrong).toBeNull();
      expect(room.game!.boss.currentQuestionId).not.toBe("boss-mc1");
      expect(room.game!.eliminated["boss-mc1"]).toBeUndefined();
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
      expect(seqOf(room)).toBe(seq + 1);
      vi.useRealTimers();
    });

    // Value: protects=a phone cannot cut a boss miss's red tile short, and the miss is judged once;
    // fails_when=handleTeamWrongChoice judges a boss team; seam=none; no_claim=none beyond protects (fake timers)
    it("a phone's 重答 during a boss miss is ignored: the beat judges it, once", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(1); // one team: the turn comes straight back to it
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      room.game = { ...room.game!, boss: { ...room.game!.boss, currentQuestionId: "boss-mc1" } };
      const wrongIdx = room.game.optionOrder["boss-mc1"].indexOf(1);
      send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "boss-mc1", optionIndex: wrongIdx });
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "boss-mc1" });
      reveal(room);
      vi.advanceTimersByTime(2000);
      expect(room.game!.pendingWrong).not.toBeNull();
      const seq = seqOf(room);
      send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "boss-mc1", choice: "retry" });
      expect(seqOf(room)).toBe(seq);
      vi.advanceTimersByTime(2000);
      expect(seqOf(room)).toBe(seq + 1);
      expect(room.game!.pendingWrong).toBeNull();
      vi.useRealTimers();
    });

    it("a flee the host sends during a boss miss (stuck row, key 3) resolves as the retry the beat would", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(1);
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      room.game = { ...room.game!, boss: { ...room.game!.boss, currentQuestionId: "boss-mc1" } };
      const wrongIdx = room.game.optionOrder["boss-mc1"].indexOf(1);
      send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "boss-mc1", optionIndex: wrongIdx });
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "boss-mc1" });
      reveal(room);
      vi.advanceTimersByTime(2000);
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "boss-mc1", correct: false, fleeChoice: "flee" });
      const last = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE").at(-1);
      expect(last.cue).toBe("retry");
      expect(room.game!.boss.currentQuestionId).not.toBe("boss-mc1");
      vi.useRealTimers();
    });

    // Value: protects=a boss miss the host settles inside its red-tile beat leaves no stale timer that makes the next lock
    // read as revealing and refuse 公布答案 forever (/review, 2026-11-05); fails_when=revealing is derived from lockTimer again
    it("after the host settles a boss miss early, the next lock still waits for 公布答案 and is judged", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(1);
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      const lockBoss = (option: number) => {
        room.game = { ...room.game!, boss: { ...room.game!.boss, currentQuestionId: "boss-mc1" } };
        send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "boss-mc1", optionIndex: room.game.optionOrder["boss-mc1"].indexOf(option) });
        send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "boss-mc1" });
      };
      lockBoss(1);
      reveal(room);
      vi.advanceTimersByTime(2000); // the reveal's beat: the red tile and its own beat start
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "boss-mc1", correct: false, fleeChoice: "retry" });
      vi.advanceTimersByTime(2000); // the boss miss's timer fires late and finds its miss settled
      lockBoss(0);
      const states = () => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE");
      expect(states().at(-1).pendingLock.revealing).toBeUndefined();
      reveal(room);
      expect(lastSentTo(hostConn as never)?.detail).not.toBe("reveal_pending");
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
      expect((room as any).pendingLock).toBeNull();
      expect(states().at(-1).reveal).not.toBeNull();
    });

    it("a wrong room lock still waits for the team's choice: no timer resolves it", () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(2);
      pick(room, conns[0], 0);
      lock(room, conns[0]);
      vi.advanceTimersByTime(60_000);
      expect(room.game!.pendingWrong).not.toBeNull();
      vi.useRealTimers();
    });

    // Value: protects=a team that locks and puts its phone down (it sleeps, the socket closes) keeps its answer until
    // 公布答案, like a sent fill-in (/review D9 = A, 2026-11-05); fails_when=onClose marks a locked team offline at once
    it("a team whose phone closes after its lock keeps the turn: 公布答案 still judges it, then it shows offline", () => {
      vi.useFakeTimers();
      const { room, ids, conns } = startedMcGame(2);
      pick(room, conns[0], room.game!.optionOrder["r0-mc1"].indexOf(1));
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      room.onClose(conns[0]);
      expect(currentTurnTeamId(room.game!)).toBe(ids[0]);
      reveal(room);
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
      expect((room as any).reveal).toMatchObject({ questionId: "r0-mc1" });
      expect(room.game!.teams.find((t) => t.id === ids[0])!.online).toBe(false);
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
    });

    // Value: protects=a team that comes back online while another team's lock waits does not take the turn and void it
    // (/review fix pass, 2026-11-05); fails_when=the lock does not pin currentTurnIndex
    it("a team that comes back while another team's lock waits does not take the turn from it", () => {
      vi.useFakeTimers();
      const { room, ids, conns } = startedMcGame(2);
      const online = (id: string, on: boolean) => (room.game = { ...room.game!, teams: room.game!.teams.map((t) => (t.id === id ? { ...t, online: on } : t)) });
      online(ids[0], false); // its phone slept on its own turn: the turn passes to team 1
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
      pick(room, conns[1], room.game!.optionOrder[room.game!.teams[1].currentQuestionId].indexOf(1));
      send(room, conns[1], { type: "TEAM_LOCK_OPTION", questionId: room.game!.teams[1].currentQuestionId });
      online(ids[0], true); // and wakes up while the lock waits
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
      reveal(room);
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
      expect((room as any).reveal).not.toBeNull();
    });

    it("a team that drops offline while deciding keeps the turn (E9)", () => {
      vi.useFakeTimers();
      const { room, ids, conns } = startedMcGame(2);
      pick(room, conns[0], 0);
      lock(room, conns[0]);
      vi.advanceTimersByTime(2000);
      room.onClose(conns[0]);
      expect(currentTurnTeamId(room.game!)).toBe(ids[0]);
      vi.useRealTimers();
    });

    const revealOpen = (room: DungeonRoom) => (room as unknown as { reveal: unknown }).reveal !== null;
    // Value: protects=a lock waits for the host's 公布答案 and its correct reveal waits for 下一題 (host-reveal.md R1, R3);
    // fails_when=a lock or a reveal gets a timer again, or the correct reveal loses its option wall; why_new=replaces the auto-advance tests; seam=none
    it("a lock waits for the host: no timer judges it, 公布答案 starts the beat, and the correct reveal waits for 下一題 (host-reveal.md)", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(1);
      pick(room, conns[0], 1);
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      vi.advanceTimersByTime(60_000);
      expect(room.game!.teams[0].reward).toBe(0);
      expect(lastBroadcast(room).pendingLock).toEqual({ teamId: ids[0], questionId: "r0-mc1", optionIndex: 1 });
      send(room, hostConn, { type: "HOST_REVEAL", teamId: ids[0], questionId: "r0-mc1" });
      expect(lastBroadcast(room).pendingLock).toMatchObject({ revealing: true });
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
      expect(room.game!.teams[0].reward).toBe(10);
      expect(lastBroadcast(room).reveal.choice).toMatchObject({ correctIndex: 1, points: 10 });
      vi.advanceTimersByTime(60_000);
      expect(revealOpen(room)).toBe(true);
      serveNext(room, hostConn, seqOf(room));
      expect(revealOpen(room)).toBe(false);
    });

    // Value: protects=only the host reveals, only the pending lock, and a double press judges once (host-reveal.md finding 2);
    // fails_when=a phone or a stale press reveals, or two presses start two beats; why_new=new message; seam=none
    it("HOST_REVEAL is refused from a phone, with no lock, for another question, and a second press in the beat", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(1);
      const press = (conn: Conn, questionId = "r0-mc1") => send(room, conn, { type: "HOST_REVEAL", teamId: ids[0], questionId });
      press(hostConn);
      expect(lastSentTo(hostConn)).toMatchObject({ error: "invalid_action", detail: "no_lock" });
      pick(room, conns[0], 1);
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      press(conns[0]);
      expect(lastSentTo(conns[0])).toMatchObject({ error: "not_host" });
      press(hostConn, "r0-mc2");
      expect(lastSentTo(hostConn)).toMatchObject({ detail: "no_lock" });
      send(room, hostConn, { type: "HOST_REVEAL", teamId: "other-team", questionId: "r0-mc1" }); // the right question, another team
      expect(lastSentTo(hostConn)).toMatchObject({ detail: "no_lock" });
      expect((room as any).pendingLock.revealing).toBeUndefined();
      const seq = seqOf(room);
      press(hostConn);
      press(hostConn);
      expect(lastSentTo(hostConn)).toMatchObject({ detail: "reveal_pending" });
      vi.advanceTimersByTime(4000);
      expect(room.game!.teams[0].reward).toBe(10);
      expect(seqOf(room)).toBe(seq + 1);
    });

    // Value: protects=a lock left behind when its team's turn moved on can still be cleared by the host (host-reveal.md R3);
    // fails_when=HOST_REVEAL only accepts the team on turn, so the room-wide lock blocks every other team; why_new=no timer drops it now; seam=none
    it("a lock whose turn moved on waits, and the host's reveal drops it so the next team can lock", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(2);
      pick(room, conns[0], 1);
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      // A closed phone no longer moves the turn (D9 = A, the test above): move it by hand, as any other path would.
      room.game = { ...room.game!, teams: room.game!.teams.map((t) => (t.id === ids[0] ? { ...t, online: false } : t)) };
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
      vi.advanceTimersByTime(60_000);
      expect(lastBroadcast(room).pendingLock).toMatchObject({ teamId: ids[0] });
      send(room, hostConn, { type: "HOST_REVEAL", teamId: ids[0], questionId: "r0-mc1" });
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).pendingLock).toBeNull();
      expect(room.game!.teams[0].score).toBe(0);
      pick(room, conns[1], 1);
      send(room, conns[1], { type: "TEAM_LOCK_OPTION", questionId: room.game!.teams[1].currentQuestionId });
      expect(lastBroadcast(room).pendingLock).toMatchObject({ teamId: ids[1] });
    });

    // Value: protects=a locked team whose phone closed shows offline once 結束冒險 drops its lock unrevealed (host-reveal.md D9);
    // fails_when=clearAnswerTimers stops calling syncLockTeam, so the podium shows a gone team online; why_new=only resolveLock's sync is tested;
    // seam=none; no_claim=the lobby after 回到大廳 (no game then)
    it("a locked team whose phone closed shows offline when the host ends the game before 公布答案", () => {
      const { room, hostConn, ids, conns } = startedMcGame(2);
      pick(room, conns[0], 1);
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      room.onClose(conns[0]);
      expect(room.game!.teams.find((t) => t.id === ids[0])!.online).toBe(true);
      send(room, hostConn, { type: "HOST_END_GAME" });
      expect((room as any).pendingLock).toBeNull();
      const lastState = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE").at(-1);
      expect(lastState.view.teams.find((t: { id: string }) => t.id === ids[0]).online).toBe(false);
    });

    // Value: protects=a warrior's success on a multipleChoice question keeps its option wall and waits for 下一題 (host-reveal.md R1, finding 1);
    // fails_when=choice is gated on the lock path again, or the roll's reveal gets a timer; why_new=room roll tests play text questions;
    // seam=none; no_claim=the TV's green tile rendering (e2e)
    it("a warrior's 20 on a multipleChoice question reveals the option wall and waits for 下一題", () => {
      vi.useFakeTimers();
      let r = 0;
      const room = new DungeonRoom(makeRoom() as any, () => r, { bank: mcBank });
      const hostConn = makeConn("host-conn");
      room.onConnect(hostConn);
      claim(room, hostConn);
      const { conns } = joinTeams(room, hostConn, 1);
      send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "warrior" });
      send(room, hostConn, { type: "HOST_START" });
      r = 19 / 20; // a 20
      send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-mc1" });
      vi.advanceTimersByTime(2000);
      expect(lastBroadcast(room).reveal).toMatchObject({ questionId: "r0-mc1", choice: { correctIndex: 1 } });
      expect(room.game!.teams[0].reward).toBe(15); // a warrior's 20 on a multipleChoice question is a crit too
      expect(lastBroadcast(room)).toMatchObject({ cue: "crit" });
      vi.advanceTimersByTime(60_000);
      expect(revealOpen(room)).toBe(true);
      serveNext(room, hostConn, seqOf(room));
      expect(revealOpen(room)).toBe(false);
    });

    // Value: protects=the chef's share on the phone's 答對 line (chef design D5) and a chef never spending a use;
    // fails_when=the room drops chefBonus from reveal.choice, or a chef's TEAM_USE_ABILITY is accepted; seam=none
    it("a chef's correct lock carries its share in reveal.choice, and its ability press is refused", () => {
      vi.useFakeTimers();
      const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: mcBank });
      const hostConn = makeConn("host-conn");
      room.onConnect(hostConn);
      claim(room, hostConn);
      const { ids, conns } = joinTeams(room, hostConn, 2);
      send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "chef" });
      send(room, hostConn, { type: "HOST_START" });
      send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-mc1" });
      expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
      expect(room.game!.teams[0].abilityUses).toBe(2);
      expect((room as any).pendingRoll ?? null).toBeNull();
      pick(room, conns[0], 1);
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      send(room, hostConn, { type: "HOST_REVEAL", teamId: ids[0], questionId: "r0-mc1" });
      vi.advanceTimersByTime(4000);
      expect(lastBroadcast(room).reveal.choice).toMatchObject({ teamId: ids[0], points: 12, chefBonus: 2 }); // pregate-literal: WARRIOR_TARGET=12 a room reward, not the warrior target
    });

    it("the host cannot send a team to the boss while its lock is in its beat", () => {
      vi.useFakeTimers();
      const { room, hostConn, ids, conns } = startedMcGame(1);
      pick(room, conns[0], 1);
      lock(room, conns[0]);
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "lock_pending" });
      expect(room.game!.teams[0].inBoss).toBe(false);
    });

    it("boss: a killing lock reveals with the kill bonus as its points", () => {
      vi.useFakeTimers();
      const { room, ids, conns } = startedMcGame(1);
      const g = room.game!;
      (room as any).game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, currentQuestionId: "boss-mc1" } };
      send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "boss-mc1", optionIndex: 0 });
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "boss-mc1" });
      reveal(room);
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000); // then the crit die's beat (dnd design R9)
      vi.advanceTimersByTime(4000); // then the kill's 4d20 (kill-roll.md)
      const reward = room.game!.teams.find((t) => t.id === ids[0])!.reward;
      expect(reward).toBeGreaterThan(10); // the hit reward plus the kill bonus
      expect((room as any).reveal.choice).toMatchObject({ correctIndex: 0, points: reward });
    });

    it("an expiring room drops a lock still in its beat: the timer never fires into the reset room", async () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(1);
      pick(room, conns[0], 1);
      lock(room, conns[0]);
      await (room as any).expire();
      expect((room as any).lockTimer).toBeNull();
      expect(room.game).toBeNull();
      vi.advanceTimersByTime(2000);
      expect(room.game).toBeNull();
    });

    it("a text question's reveal never auto-advances: the host closes it", async () => {
      vi.useFakeTimers();
      const textBank: Bank = { ...mcBank, pools: { ...mcBank.pools, 1: [{ kind: "text", id: "r0-t1", content: { kind: "text", value: "？" }, answer: "a" }] } };
      const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: textBank });
      const hostConn = makeConn("host-conn");
      room.onConnect(hostConn);
      claim(room, hostConn);
      const { ids } = joinTeams(room, hostConn, 1);
      send(room, hostConn, { type: "HOST_START" });
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-t1", correct: true });
      expect(revealOpen(room)).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(revealOpen(room)).toBe(true);
    });
  });
});

describe("REJOIN", () => {
  it("rejects a non-UUID team id", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    send(room, conn, { type: "REJOIN", teamId: BAD_ID, teamKey: KEY });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_team_id" });
  });

  it("rejects rejoining an unknown team before the game starts", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    send(room, conn, { type: "REJOIN", teamId: T1, teamKey: KEY });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "unknown_team" });
  });

  it("re-sends LOBBY to a known pending team before the game starts", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    const conn = makeConn("reconnect");
    send(room, conn, { type: "REJOIN", teamId: T1, teamKey: KEY });
    expect(lastSentTo(conn)).toMatchObject({ type: "LOBBY" });
  });

  it("marks a team back online after the game has started", () => {
    const { room, ids } = (() => {
      const r = makeRoomWithHost();
      const j = joinTeams(r.room, r.hostConn, 1);
      send(r.room, r.hostConn, { type: "HOST_START" });
      return { ...r, ids: j.ids };
    })();
    room.onClose(makeConn("player-conn-0")); // mark offline first
    expect(room.game!.teams[0].online).toBe(false);

    const conn = makeConn("player-conn-0-again");
    send(room, conn, { type: "REJOIN", teamId: ids[0], teamKey: KEY });
    expect(room.game!.teams[0].online).toBe(true);
  });

  it("rejects rejoining an unknown team once the game has started", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const conn = makeConn();
    send(room, conn, { type: "REJOIN", teamId: T3, teamKey: KEY });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "unknown_team" });
  });
});

describe("onClose — offline handling (T7)", () => {
  it("marks the associated team offline and broadcasts the updated state", () => {
    const { room, hostConn } = makeRoomWithHost();
    const { conns, ids } = joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });

    room.onClose(conns[0]);
    expect(room.game!.teams.find((t) => t.id === ids[0])!.online).toBe(false);
    expect(lastBroadcast(room)).toMatchObject({ type: "STATE" });
  });

  it("does nothing when a connection with no associated team closes", () => {
    const { room } = makeRoomWithHost();
    expect(() => room.onClose(makeConn("never-joined"))).not.toThrow();
  });

  it("does not throw when closing a connection before the game has started", () => {
    const { room, hostConn } = makeRoomWithHost();
    const { conns } = joinTeams(room, hostConn, 1);
    expect(() => room.onClose(conns[0])).not.toThrow();
  });
});

describe("malformed messages", () => {
  it("answers unparseable JSON with invalid_action instead of throwing", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    expect(() => room.onMessage("not json", conn)).not.toThrow();
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });

  it("answers an unknown message type with invalid_action", () => {
    const { room } = makeRoomWithHost();
    const conn = makeConn();
    send(room, conn, { type: "SOMETHING_ELSE" });
    expect(lastSentTo(conn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });

  it("answers a wrong-typed field with invalid_action and changes nothing", () => {
    const { room, hostConn } = makeRoomWithHost();
    send(room, hostConn, { type: "HOST_JUDGE", teamId: T1, questionId: "r0-q1", correct: "yes" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });
});

describe("questions and answers (T3)", () => {
  function started(teamCount = 2) {
    const { room, hostConn } = makeRoomWithHost();
    const { ids, conns } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids, conns };
  }
  const sent = (conn: ReturnType<typeof makeConn>) =>
    (conn.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const broadcasts = (room: DungeonRoom) =>
    (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));

  it("STATE carries the public question for the team on turn, with monster and no answer", () => {
    const { room } = started();
    const state = broadcasts(room).findLast((m) => m.type === "STATE");
    expect(state.question).toMatchObject({ id: "r0-q1", boss: false, monster: { sprite: "slime" } });
    expect(state.question.content.kind).toBe("text");
    expect(typeof state.question.content.value).toBe("string");
    expect(state.question).not.toHaveProperty("answer");
  });

  it("sends the answer only to host connections, on start and after every judgment", () => {
    const { room, hostConn, ids, conns } = started();
    expect(sent(hostConn).findLast((m) => m.type === "HOST_ANSWER")).toMatchObject({ questionId: "r0-q1", answer: "梅花" });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    // Turn passes to team 2, whose question is r0-q2.
    expect(sent(hostConn).findLast((m) => m.type === "HOST_ANSWER")).toMatchObject({ questionId: "r0-q2", answer: "115 年" });
    for (const c of conns) expect(sent(c).some((m) => m.type === "HOST_ANSWER")).toBe(false);
  });

  it("a host that claims mid-game gets the current answer and the question picker at once", () => {
    const { room } = started();
    const second = makeConn("host-phone");
    claim(room, second);
    expect(sent(second).map((m) => m.type)).toEqual(["HOST_OK", "HOST_NEXT_LINE_STATE", "HOST_AI_STATUS", "HOST_ANSWER", "HOST_PICKS"]);
  });

  it("STATE's live question never carries an answer, and STATE.reveal carries the correct one only for questions actually answered correctly (D2/D3/D5)", () => {
    const { room, hostConn, conns } = started(2);
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) {
      const g = room.game!;
      const teamId = g.turnOrder[g.currentTurnIndex];
      const t = g.teams.find((x) => x.id === teamId)!;
      const qid = t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId;
      serveNext(room, hostConn, seqOf(room)); // close the previous reveal (D7); no-op if none
      send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
      landKill(room);
    }
    expect(room.game!.phase).toBe("finished");
    const messages = [...broadcasts(room), ...conns.flatMap(sent)];
    // The live in-play question is never the answer, in any STATE message.
    for (const m of messages.filter((x) => x.type === "STATE" && x.question)) expect(m.question).not.toHaveProperty("answer");
    // The reveal is intentional (D2/D3 — a shared-screen party game), but only carries the real
    // answer for a question this playthrough actually got right (every judgment above was
    // correct, so every judged question should have one).
    const revealed = messages.filter((m) => m.type === "STATE" && m.reveal).map((m) => m.reveal);
    expect(revealed.length).toBeGreaterThan(0);
    for (const r of revealed) expect(r.answer).toBe(answerText(findQuestion(BANK, r.questionId)!));
    // HOST_ANSWER itself must still never appear outside a host-only sendTo (the invariant this
    // test originally guarded — the reveal is a deliberately separate, narrower channel).
    expect(JSON.stringify(messages)).not.toContain("HOST_ANSWER");
  });

  it("in the boss room the public question is flagged as boss", () => {
    const { room, hostConn, ids } = started(1);
    for (let i = 0; i < 100 && room.game!.teams[0].score < 15; i++) {
      const t = room.game!.teams[0];
      serveNext(room, hostConn, seqOf(room)); // close the previous reveal (D7); no-op if none
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: t.currentQuestionId, correct: true });
    }
    const state = broadcasts(room).findLast((m) => m.type === "STATE");
    expect(state.question).toMatchObject({ boss: true, monster: { sprite: "dragon" } });
  });

  it("dealing follows the injected rng (0.99 picks room 0's last question)", () => {
    const room = new DungeonRoom(makeRoom() as any, () => 0.99);
    const host = makeConn("h");
    claim(room, host);
    joinTeams(room, host, 1);
    send(room, host, { type: "HOST_START" });
    expect(room.game!.teams[0].currentQuestionId).toBe("r0-q12");
  });
});

describe("narration (T5-T7)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const all = (room: DungeonRoom) =>
    (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const sentMsgs = (conn: ReturnType<typeof makeConn>) =>
    (conn.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));

  function narrRoom(opts: ConstructorParameters<typeof DungeonRoom>[2] = { holdMs: 30, epilogueDelayMs: 0 }) {
    const room = new DungeonRoom(makeRoom() as any, () => 0, opts);
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    return { room, hostConn };
  }
  function start(teamCount = 2, opts?: ConstructorParameters<typeof DungeonRoom>[2]) {
    const { room, hostConn } = narrRoom(opts);
    const { ids, conns } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids, conns };
  }
  /** Judge the team on turn correct, using whatever question it currently holds. */
  function judgeCorrect(room: DungeonRoom, hostConn: ReturnType<typeof makeConn>) {
    const g = room.game!;
    const teamId = g.turnOrder[g.currentTurnIndex];
    const t = g.teams.find((x) => x.id === teamId)!;
    const qid = t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId;
    serveNext(room, hostConn, seqOf(room)); // close the previous reveal (D7); no-op if none
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
    landKill(room);
  }

  describe("結束冒險 and the narration on screen", () => {
    /** A game whose start narration is in, ended by the host; `read` the screen read it out first. */
    async function ended(read: boolean, opts: ConstructorParameters<typeof DungeonRoom>[2] = {}) {
      const clock = { t: 10_000 };
      const { room, hostConn } = start(2, { holdMs: 30, epilogueDelayMs: 4000, now: () => clock.t, ...opts });
      await sleep(40);
      const n = all(room).filter((m) => m.type === "NARRATION").at(-1);
      const readOut = (done = n.lines.length) => send(room, screenConn(room), { type: "SCREEN_NARRATION_PROGRESS", eventId: n.eventId, rev: n.rev ?? 0, done });
      if (read) readOut();
      send(room, hostConn, { type: "HOST_END_GAME" });
      await sleep(40);
      const podium = () => all(room).filter((m) => m.type === "STATE").at(-1)!.podium!;
      return { room, clock, readOut, podium };
    }

    // Value: protects=the first place call never cuts off the narration the big screen is still reading (owner,
    // 2026-11-08); fails_when=the reveal starts 4 s after 結束冒險 while that narration is unread, or does not move up
    // once the screen reports it read.
    it("holds the reveal until the screen has read the last narration, then starts a second later", async () => {
      const { clock, readOut, podium } = await ended(false);
      expect(podium().elapsedMs).toBe(-20_000);
      clock.t += 5_000;
      readOut();
      expect(podium().elapsedMs).toBe(-1000);
    });

    it("starts after the usual delay when the narration was already read", async () => {
      const { podium } = await ended(true);
      expect(podium().elapsedMs).toBe(-4000);
    });

    it("a read after the 20 s cap never moves a reveal already playing", async () => {
      const { room, clock, readOut, podium } = await ended(false);
      clock.t += 25_000;
      readOut();
      expect((room as unknown as { revealFrom: number }).revealFrom).toBe(30_000);
      expect(podium().elapsedMs).toBe(-20_000); // no new STATE: the reveal on screens keeps its clock
    });

    it("a narration read only in part keeps the reveal held", async () => {
      const { room, clock, readOut } = await ended(false);
      clock.t += 5_000;
      readOut(1);
      expect((room as unknown as { revealFrom: number }).revealFrom).toBe(30_000);
    });

    it("a read reported before the AI's calls are in still starts the reveal a second after it", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const provider = { name: "slow", narrate: async (e: { type: string }) => (e.type === "epilogue" ? (await gate, "太短") : "一行") };
      const { clock, readOut, podium } = await ended(false, { provider, epilogueHoldMs: 5000 });
      expect(podium().beats).toBeNull();
      clock.t += 5_000;
      readOut();
      release();
      await sleep(40);
      expect(podium().elapsedMs).toBe(-1000);
    });
  });

  it("announces the start with one NARRATION after STATE", async () => {
    const { room } = start();
    await flush();
    const msgs = all(room);
    const stateAt = msgs.findIndex((m) => m.type === "STATE");
    const narrAt = msgs.findIndex((m) => m.type === "NARRATION");
    expect(stateAt).toBeGreaterThanOrEqual(0);
    expect(narrAt).toBeGreaterThan(stateAt);
    expect(msgs.filter((m) => m.type === "NARRATION")).toHaveLength(1);
    expect(msgs[stateAt].eventId).toBe(1);
    expect(msgs[narrAt].eventId).toBe(1);
  });

  it("sends STATE immediately and exactly one NARRATION per judgment, with rising eventIds", async () => {
    const { room, hostConn } = start();
    await flush();
    judgeCorrect(room, hostConn);
    // STATE for the judgment (carrying the reveal, since judgeCorrect always judges correctly)
    // is out synchronously, before any narration for it.
    const afterJudge = all(room);
    expect(afterJudge.at(-1)).toMatchObject({ type: "STATE", eventId: 2, reveal: { questionId: expect.any(String) } });
    await flush();
    judgeCorrect(room, hostConn);
    await flush();
    const narr = all(room).filter((m) => m.type === "NARRATION");
    expect(narr.map((m) => m.eventId)).toEqual([1, 2, 3]);
    for (const n of narr) expect(n.lines[0].length).toBeGreaterThan(0);
  });

  it("names the team that was judged in the line", async () => {
    const { room, hostConn } = start();
    await flush();
    judgeCorrect(room, hostConn);
    await flush();
    const last = all(room).filter((m) => m.type === "NARRATION").at(-1);
    expect(last.lines[0]).toContain("Team 0");
  });

  it("a rejected judgment produces no event and no narration", async () => {
    const { room, hostConn } = start();
    await flush();
    const before = all(room).filter((m) => m.type === "NARRATION").length;
    send(room, hostConn, { type: "HOST_JUDGE", teamId: T1, questionId: "stale", correct: true });
    await flush();
    expect(all(room).filter((m) => m.type === "NARRATION")).toHaveLength(before);
    expect(all(room).filter((m) => m.type === "STATE").at(-1).eventId).toBe(1);
  });

  describe("⚔️ 最後衝刺's owl line (last-sprint.md)", () => {
    const lowThreshold = (room: DungeonRoom) => (room.game = { ...room.game!, config: { ...room.game!.config, bossThreshold: 1 } });

    it("rides on the narration of the answer that opened the door, held until it lands", async () => {
      const { room, hostConn } = start(3);
      await flush();
      lowThreshold(room);
      judgeCorrect(room, hostConn);
      expect(room.game!.sprint?.teamIds).toHaveLength(2);
      await flush();
      const narr = all(room).filter((m) => m.type === "NARRATION" && m.eventId === 2);
      expect(narr).toHaveLength(1);
      expect(narr[0].lines.at(-1)).toBe("🦉 Team 0進魔王房了！Team 1、Team 2獲得祝福！");
    });

    it("is appended with rev + 1 to a narration already on screen, and dropped once the game is over", async () => {
      const { room } = start(2);
      await flush();
      (room as any).appendLine(1, "🦉 一行");
      const last = all(room).filter((m) => m.type === "NARRATION").at(-1);
      expect(last).toMatchObject({ eventId: 1, rev: 1 });
      expect(last.lines.at(-1)).toBe("🦉 一行");
      const count = all(room).length;
      room.game = { ...room.game!, phase: "finished" };
      (room as any).appendLine(1, "🦉 兩行");
      expect(all(room)).toHaveLength(count);
    });

    it("drops a held line when the game ends before its narration lands, and a reset forgets any hold", async () => {
      const { room, hostConn } = start(3);
      await flush();
      lowThreshold(room);
      judgeCorrect(room, hostConn);
      expect((room as any).heldLines).toMatchObject({ eventId: 2 });
      room.game = { ...room.game!, phase: "finished" };
      await flush();
      const narr = all(room).filter((m) => m.type === "NARRATION" && m.eventId === 2);
      expect(narr.flatMap((m) => m.lines).some((l: string) => l.startsWith("🦉"))).toBe(false);
      expect((room as any).heldLines).toBeNull();
      // reset() restarts eventIds at 0: an old hold must not ride the next game's narration of the same id.
      (room as any).heldLines = { eventId: 2, lines: ["🦉 舊的"] };
      (room as any).reset();
      expect((room as any).heldLines).toBeNull();
    });

    it("has no owl line on the host's 送進魔王房", async () => {
      const { room, hostConn, ids } = start(3);
      await flush();
      const before = all(room).filter((m) => m.type === "NARRATION").length;
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      await flush();
      expect(room.game!.sprint).toBeDefined();
      expect(all(room).filter((m) => m.type === "NARRATION")).toHaveLength(before);
      expect(all(room).filter((m) => m.type === "STATE").at(-1).view.sprint).toEqual(room.game!.sprint);
    });

    it("caps the names, never the 獲得祝福！, and fits MAX_EDIT_LINE with two 20-character tied names", () => {
      const long = "一二三四五六七八九十一二三四五六七八九十";
      const line = sprintLine(long, [long, long]);
      expect(line).toBe("🦉 一二三四五六七八九…進魔王房了！一二三四五六七八九十一二三…獲得祝福！");
      expect(line.length).toBe(38);
      // An emoji (2 units) is never split.
      expect(sprintLine("隊🐉🐉🐉🐉🐉🐉", ["乙"])).toBe("🦉 隊🐉🐉🐉🐉…進魔王房了！乙獲得祝福！");
    });
  });

  it("replays the last narration to a connection that arrives later", async () => {
    const { room } = start();
    await flush();
    const late = makeConn("late");
    room.onConnect(late);
    const types = sentMsgs(late).map((m) => m.type);
    expect(types).toEqual(["STATE", "NARRATION"]);
  });

  it("falls back to the scripted line when the provider is slower than the hold, without delaying STATE", async () => {
    const slow = { name: "slow", narrate: async () => (await sleep(200), "太慢的一行") };
    const { room, hostConn } = start(2, { holdMs: 20, epilogueDelayMs: 0, provider: slow });
    await sleep(60);
    const narr = all(room).filter((m) => m.type === "NARRATION");
    expect(narr).toHaveLength(1);
    expect(narr[0].lines[0]).not.toBe("太慢的一行");
    await sleep(250);
    expect(all(room).filter((m) => m.type === "NARRATION")).toHaveLength(1); // late answer sends nothing
    expect(hostConn).toBeDefined();
  });

  it("uses the provider's line when it answers in time", async () => {
    const quick = { name: "quick", narrate: async () => "提供者的一行" };
    const { room } = start(2, { holdMs: 50, epilogueDelayMs: 0, provider: quick });
    await flush();
    expect(all(room).find((m) => m.type === "NARRATION").lines[0]).toBe("提供者的一行");
  });

  it("drops an older event's narration that resolves after a newer one's (no overwrite, no stale replay)", async () => {
    const pending: ((line: string) => void)[] = [];
    const slow = { name: "slow", narrate: () => new Promise<string>((resolve) => pending.push(resolve)) };
    const { room, hostConn } = start(2, { holdMs: 5000, epilogueDelayMs: 0, provider: slow });
    await flush();
    pending[0]("開場的一行");
    await flush();
    judgeCorrect(room, hostConn); // event 2: its LLM call is still out...
    judgeCorrect(room, hostConn); // ...when event 3 is judged
    await flush();
    expect(pending).toHaveLength(3);
    pending[2]("新的一行");
    await flush();
    pending[1]("舊的一行");
    await flush();
    const narr = all(room).filter((m) => m.type === "NARRATION");
    expect(narr.map((m) => m.lines[0])).toEqual(["開場的一行", "新的一行"]);
    const late = makeConn("late");
    room.onConnect(late);
    expect(sentMsgs(late).find((m) => m.type === "NARRATION").lines[0]).toBe("新的一行");
  });

  it("drops a judgment's line that arrives after 結束冒險: the podium is up, nobody is next", async () => {
    const pending: ((line: string) => void)[] = [];
    const slow = { name: "slow", narrate: () => new Promise<string>((resolve) => pending.push(resolve)) };
    const { room, hostConn } = start(2, { holdMs: 5000, epilogueDelayMs: 0, provider: slow });
    await flush();
    pending[0]("開場的一行");
    await flush();
    judgeCorrect(room, hostConn); // its LLM call is still out...
    send(room, hostConn, { type: "HOST_END_GAME" }); // ...when the host ends the game
    await flush();
    pending[1]("接下來輪到乙隊");
    await flush();
    expect(all(room).filter((m) => m.type === "NARRATION").map((m) => m.lines[0])).toEqual(["開場的一行"]);
  });

  it("survives a provider that throws", async () => {
    const bad = { name: "bad", narrate: async () => { throw new Error("boom"); } };
    const { room } = start(2, { holdMs: 30, epilogueDelayMs: 0, provider: bad });
    await flush();
    expect(all(room).filter((m) => m.type === "NARRATION")).toHaveLength(1);
  });

  describe("epilogue", () => {
    async function finishGame() {
      const { room, hostConn, conns } = start(1);
      for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) judgeCorrect(room, hostConn);
      await sleep(30);
      return { room, hostConn, conns };
    }

    it("is sent once, after the kill-shot line, with the winner and score from the facts", async () => {
      const { room } = await finishGame();
      const msgs = all(room);
      const epi = msgs.filter((m) => m.type === "EPILOGUE");
      expect(epi).toHaveLength(1);
      const score = room.game!.teams[0].reward;
      expect(epi[0].text).toContain("Team 0");
      expect(epi[0].text).toContain(String(score));
      const killShot = msgs.findLast((m) => m.type === "NARRATION");
      expect(msgs.indexOf(epi[0])).toBeGreaterThan(msgs.indexOf(killShot));
    });

    it("is not generated again when GAME_OVER is re-broadcast (close, rejoin)", async () => {
      const { room, conns } = await finishGame();
      room.onClose(conns[0]);
      send(room, makeConn("again"), { type: "REJOIN", teamId: T1, teamKey: KEY });
      await sleep(30);
      expect(all(room).filter((m) => m.type === "EPILOGUE")).toHaveLength(1);
    });

    it("is replayed to a connection that arrives after game over", async () => {
      const { room } = await finishGame();
      const late = makeConn("late");
      room.onConnect(late);
      expect(sentMsgs(late).map((m) => m.type)).toEqual(["STATE", "NARRATION", "EPILOGUE"]);
      // Marked as a replay, so /screen shows it without speaking it again; the live one isn't.
      expect(sentMsgs(late).find((m) => m.type === "EPILOGUE").replay).toBe(true);
      expect(all(room).find((m) => m.type === "EPILOGUE").replay).toBeUndefined();
    });
  });

  describe("transcript", () => {
    it("is sent only to the host, with event, scores, line and provider", async () => {
      const { room, hostConn, conns } = start();
      await flush();
      judgeCorrect(room, hostConn);
      await flush();
      send(room, hostConn, { type: "HOST_GET_TRANSCRIPT" });
      const t = sentMsgs(hostConn).findLast((m) => m.type === "TRANSCRIPT");
      expect(t.entries.length).toBe(2); // start + one judgment
      expect(t.entries[1]).toMatchObject({ eventId: 2, provider: "scripted", event: { type: "correct" } });
      expect(t.entries[1].scores).toEqual({ "Team 0": 10, "Team 1": 0 });
      const intruder = makeConn("nope");
      send(room, intruder, { type: "HOST_GET_TRANSCRIPT" });
      expect(sentMsgs(intruder).at(-1)).toMatchObject({ type: "ERROR", error: "not_host" });
      for (const c of conns) expect(sentMsgs(c).some((m) => m.type === "TRANSCRIPT")).toBe(false);
    });

    it("records the fallback reason when the provider was too slow", async () => {
      const slow = { name: "slow", narrate: async () => (await sleep(200), "晚") };
      const { room, hostConn } = start(2, { holdMs: 10, epilogueDelayMs: 0, provider: slow });
      await sleep(40);
      send(room, hostConn, { type: "HOST_GET_TRANSCRIPT" });
      const t = sentMsgs(hostConn).findLast((m) => m.type === "TRANSCRIPT");
      expect(t.entries[0]).toMatchObject({ provider: "scripted", fallbackReason: "timeout" });
    });
  });
});

describe("LLM narration and director (T8-T10)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const all = (room: DungeonRoom) => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const sentMsgs = (conn: ReturnType<typeof makeConn>) => (conn.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const json = (b: object, status = 200) => new Response(JSON.stringify(b), { status });
  const textReply = (text: string) => json({ content: [{ type: "text", text }], stop_reason: "end_turn" });

  /** A room whose host pasted a key (or none: scripted only), and a fake fetch that records every narration request.
   * The key check (GET /v1/models) is answered 200 and counted apart in `checks`. */
  async function llmRoom(fetchImpl: (req: { model: string; system: string; user: string; apiKey: string }) => Response | Promise<Response>, opts: { key?: string | null; epilogueHoldMs?: number; env?: Record<string, string> } = {}) {
    const calls: { model: string; system: string; user: string; apiKey: string }[] = [];
    const checks: string[] = [];
    const fake = async (url: unknown, init?: RequestInit) => {
      const apiKey = (init!.headers as Record<string, string>)["x-api-key"];
      if (String(url).includes("/v1/models")) {
        checks.push(apiKey);
        return json({ data: [] });
      }
      const b = JSON.parse(init!.body as string);
      const req = { model: b.model, system: b.system, user: b.messages[0].content, apiKey };
      calls.push(req);
      return fetchImpl(req);
    };
    const roomMock = makeRoom() as any;
    roomMock.env = opts.env ?? {};
    const room = new DungeonRoom(roomMock, () => 0, { holdMs: 200, epilogueDelayMs: 0, epilogueHoldMs: opts.epilogueHoldMs ?? 200, fetch: fake as unknown as typeof fetch });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    if (opts.key !== null) {
      send(room, hostConn, { type: "HOST_AI_KEY", source: "own", provider: "anthropic", key: opts.key ?? HOST_KEY });
      await sleep(0);
    }
    return { room, hostConn, calls, checks };
  }
  function begin(r: Awaited<ReturnType<typeof llmRoom>>, ai?: boolean, teams = 2) {
    joinTeams(r.room, r.hostConn, teams);
    send(r.room, r.hostConn, ai === undefined ? { type: "HOST_START" } : { type: "HOST_START", aiNarration: ai });
  }
  function judge(room: DungeonRoom, hostConn: ReturnType<typeof makeConn>) {
    const g = room.game!;
    const teamId = g.turnOrder[g.currentTurnIndex];
    const t = g.teams.find((x) => x.id === teamId)!;
    const qid = t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId;
    serveNext(room, hostConn, seqOf(room)); // close the previous reveal (D7); no-op if none
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
    landKill(room);
  }
  const narrations = (room: DungeonRoom) => all(room).filter((m) => m.type === "NARRATION");
  const transcript = (room: DungeonRoom, hostConn: ReturnType<typeof makeConn>) => {
    send(room, hostConn, { type: "HOST_GET_TRANSCRIPT" });
    return sentMsgs(hostConn).findLast((m) => m.type === "TRANSCRIPT").entries;
  };

  it("tells the host who pays and how much is left, never the key itself", async () => {
    const withKey = await llmRoom(() => textReply("x"));
    const status = sentMsgs(withKey.hostConn).findLast((m) => m.type === "HOST_AI_STATUS");
    expect(status).toEqual({ type: "HOST_AI_STATUS", source: "own", provider: "anthropic", keyHint: `…${HOST_KEY.slice(-4)}`, keyMissing: false, used: 0, limit: 300, exhausted: false });
    const noKey = await llmRoom(() => textReply("x"), { key: null });
    expect(sentMsgs(noKey.hostConn).findLast((m) => m.type === "HOST_AI_STATUS")).toMatchObject({ source: "none", keyHint: null, keyMissing: false });
  });

  it("uses the LLM line when AI narration is on and a key exists", async () => {
    const r = await llmRoom(() => textReply("地城主親自開口了！"));
    begin(r);
    await sleep(30);
    expect(narrations(r.room)[0].lines[0]).toBe("地城主親自開口了！");
    expect(r.calls[0].model).toBe("claude-haiku-4-5");
    expect(transcript(r.room, r.hostConn)[0]).toMatchObject({ provider: "llm" });
  });

  // Value: protects=a team's typed answer never reaches the paid LLM prompt (#104 AC9);
  // fails_when=a narration event starts carrying team.typedAnswer into the prompt; no_claim=the scripted provider.
  it("never puts a team's typed answer into the prompt (#104)", async () => {
    const r = await llmRoom(() => textReply("x"));
    const { conns } = joinTeams(r.room, r.hostConn, 2);
    send(r.room, r.hostConn, { type: "HOST_START" });
    const g = r.room.game!;
    passChecks(r.room);
    send(r.room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: g.teams[0].currentQuestionId, text: "祕密答案ZQX" });
    expect(r.room.game!.teams[0].typedAnswer).toBe("祕密答案ZQX");
    judge(r.room, r.hostConn);
    await sleep(30);
    expect(r.calls.length).toBeGreaterThan(1);
    expect(r.calls.some((c) => JSON.stringify(c).includes("ZQX"))).toBe(false);
  });

  it("makes no LLM call when the host turns AI narration off, or when there is no key", async () => {
    const off = await llmRoom(() => textReply("不該出現"));
    begin(off, false);
    judge(off.room, off.hostConn);
    await sleep(30);
    expect(off.calls).toHaveLength(0);
    expect(narrations(off.room).every((n) => n.lines[0] !== "不該出現")).toBe(true);
    const noKey = await llmRoom(() => textReply("不該出現"), { key: null });
    begin(noKey, true);
    await sleep(30);
    expect(noKey.calls).toHaveLength(0);
  });

  it("falls back to the scripted line on an LLM failure and still sends exactly one NARRATION", async () => {
    const r = await llmRoom(() => json({ error: {} }, 500));
    begin(r);
    await sleep(30);
    expect(narrations(r.room)).toHaveLength(1);
    expect(transcript(r.room, r.hostConn)[0]).toMatchObject({ provider: "scripted", fallbackReason: "upstream" });
  });

  it("rejects an LLM line that repeats a bank answer and uses the scripted line", async () => {
    const r = await llmRoom(() => textReply("其實它叫新高山啦"));
    begin(r);
    await sleep(30);
    expect(narrations(r.room)[0].lines[0]).not.toContain("新高山");
    expect(transcript(r.room, r.hostConn)[0]).toMatchObject({ fallbackReason: "invalid_output" });
  });

  it("stops calling the LLM after a 401 (breaker) and records the trip", async () => {
    const r = await llmRoom(() => json({ error: {} }, 401));
    begin(r);
    await sleep(30);
    judge(r.room, r.hostConn);
    judge(r.room, r.hostConn);
    await sleep(30);
    expect(r.calls).toHaveLength(1); // start only; later events never reached the API
    const t = transcript(r.room, r.hostConn);
    expect(t.some((e: any) => e.kind === "breaker")).toBe(true);
    // The refused key is dropped (the host page asks for another), so later events go straight to scripted lines.
    expect(t.slice(-2).every((e: any) => e.provider === "scripted")).toBe(true);
    expect(sentMsgs(r.hostConn).findLast((m) => m.type === "HOST_AI_STATUS")).toMatchObject({ keyMissing: true, error: "invalid_key" });
    expect(narrations(r.room)).toHaveLength(3); // still exactly one per event
  });

  it("opens the breaker after three failures in a row", async () => {
    const r = await llmRoom(() => json({ error: {} }, 500));
    begin(r);
    for (let i = 0; i < 4; i++) { judge(r.room, r.hostConn); await sleep(20); }
    await sleep(30);
    expect(r.calls).toHaveLength(3);
  });

  describe("director", () => {
    // Guards the removal of the director notes (host-narration-edit.md): fails if HOST_SET_NOTES is accepted again.
    it("HOST_SET_NOTES is no longer a message", async () => {
      const r = await llmRoom(() => textReply("行"));
      send(r.room, r.hostConn, { type: "HOST_SET_NOTES", notes: "用武俠口吻" });
      expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "bad_message" });
    });

    /** A started game whose latest narration has three lines (the AI's), after one judgment. */
    async function threeLines() {
      const r = await llmRoom(() => textReply("第一句\n第二句\n第三句"));
      begin(r);
      await sleep(30);
      judge(r.room, r.hostConn);
      await sleep(30);
      const n = narrations(r.room).at(-1);
      expect(n.lines).toEqual(["第一句", "第二句", "第三句"]);
      return { ...r, n };
    }
    const progress = (r: { room: DungeonRoom }, eventId: number, rev: number, done: number) =>
      send(r.room, screenConn(r.room), { type: "SCREEN_NARRATION_PROGRESS", eventId, rev, done });

    // Value: protects=the host rewrites any line, not just the first (D9); fails_when=the room still only swaps
    // lines[0], drops the other lines, forgets the edit for a late joiner, or does not bump rev for the screen.
    it("replaces line N under the same eventId, bumps rev, and a late joiner gets the edited lines", async () => {
      const r = await threeLines();
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 2, line: "主持人改寫的第三句" });
      expect(narrations(r.room).at(-1)).toEqual({ type: "NARRATION", eventId: r.n.eventId, lines: ["第一句", "第二句", "主持人改寫的第三句"], rev: 1 });
      expect(transcript(r.room, r.hostConn).at(-1)).toMatchObject({ kind: "edit", text: "主持人改寫的第三句", eventId: r.n.eventId });
      const late = makeConn("late");
      r.room.onConnect(late);
      expect(sentMsgs(late).find((m) => m.type === "NARRATION")).toMatchObject({ lines: ["第一句", "第二句", "主持人改寫的第三句"], rev: 1 });
    });

    // Value: protects=a line the big screen already read stays as the room heard it (D3); fails_when=the room
    // accepts an edit below `done`, or refuses the line still being read.
    it("refuses a line the big screen has already read, and still takes the next one", async () => {
      const r = await threeLines();
      progress(r, r.n.eventId, 0, 1);
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 0, line: "太晚了" });
      expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "line_read" });
      expect(narrations(r.room).at(-1).lines[0]).toBe("第一句");
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 1, line: "來得及" });
      expect(narrations(r.room).at(-1).lines).toEqual(["第一句", "來得及", "第三句"]);
    });

    // Value: protects=only the host edits, and only the narration it was looking at (D9); fails_when=a non-host
    // edit lands, a stale eventId or rev edits the newer text, or a bad index / empty line / no narration slips through.
    it("refuses a non-host, a stale eventId or rev, a bad index, an empty line, and an edit before any narration", async () => {
      const early = await llmRoom(() => textReply("行"));
      send(early.room, early.hostConn, { type: "HOST_EDIT_NARRATION", eventId: 0, rev: 0, index: 0, line: "太早了" });
      expect(sentMsgs(early.hostConn).at(-1)).toMatchObject({ error: "invalid_action", detail: "no_narration" });

      const r = await threeLines();
      const intruder = makeConn("nope");
      r.room.onConnect(intruder);
      send(r.room, intruder, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 1, line: "駭進來" });
      expect(sentMsgs(intruder).at(-1)).toMatchObject({ error: "not_host" });
      const refused = (msg: object, detail: string) => {
        send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 1, line: "改", ...msg });
        expect(sentMsgs(r.hostConn).at(-1), detail).toMatchObject({ error: "invalid_action", detail });
      };
      refused({ eventId: r.n.eventId - 1 }, "stale_narration");
      refused({ rev: 1 }, "stale_narration"); // another host device's edit landed first: never overwrite it (D9)
      refused({ index: 3 }, "bad_index");
      refused({ line: "   " }, "empty_edit"); // not HOST_NEXT_LINE's empty_line: the host page routes this one to the panel
      expect(narrations(r.room).at(-1).lines).toEqual(["第一句", "第二句", "第三句"]);
    });

    // Value: protects=an edited line stays one dialogue-box line of at most MAX_LINE, and a prefilled scripted line
    // longer than MAX_LINE still lands (red-team); fails_when=the whitespace collapse goes, or the room stops cutting to MAX_LINE.
    it("an edit becomes one line, cut to MAX_LINE", async () => {
      const r = await threeLines();
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 1, line: "上\n下\t句" });
      expect(narrations(r.room).at(-1).lines[1]).toBe("上 下 句");
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 1, index: 2, line: "字".repeat(MAX_LINE + 5) });
      expect(narrations(r.room).at(-1).lines[2]).toBe("字".repeat(MAX_LINE));
    });

    // Value: protects=a player cannot lock the host's edits from their own phone, nor the host page by mistake (D3);
    // fails_when=the room takes SCREEN_NARRATION_PROGRESS from a joined team's connection or a host connection.
    it("takes reading progress only from an announced screen that is neither a team nor the host", async () => {
      const r = await threeLines();
      const told = () => sentMsgs(r.hostConn).filter((m) => m.type === "HOST_NARRATION_PROGRESS");
      const report = (c: ReturnType<typeof makeConn>) => send(r.room, c, { type: "SCREEN_NARRATION_PROGRESS", eventId: r.n.eventId, rev: 0, done: 3 });
      report(makeConn("player-conn-0")); // the first team's phone (joinTeams)
      report(r.hostConn);
      const stray = makeConn("devtools"); // a second socket that never joined a team, nor said SCREEN_HELLO
      r.room.onConnect(stray);
      report(stray);
      send(r.room, makeConn("player-conn-0"), { type: "SCREEN_HELLO" }); // a phone cannot announce itself either
      report(makeConn("player-conn-0"));
      expect(told()).toEqual([]);
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 2, line: "還能改" });
      expect(narrations(r.room).at(-1).lines[2]).toBe("還能改");
      report(screenConn(r.room));
      expect(told()).toEqual([]); // rev moved on with the edit: this report is about the old text
    });

    // Value: protects=the big screen's reading progress the host sees (D3, D14); fails_when=a report about old text
    // (stale rev or eventId) locks a line, progress goes backwards, runs past the line count, or the host is not told.
    it("keeps the furthest progress about the text on screen now, and tells every host page", async () => {
      const r = await threeLines();
      const told = () => sentMsgs(r.hostConn).filter((m) => m.type === "HOST_NARRATION_PROGRESS").map((m) => m.done);
      progress(r, r.n.eventId, 0, 2);
      progress(r, r.n.eventId, 0, 1); // a slower second screen, or a reconnect retyping from line 1
      progress(r, r.n.eventId, 0, 4); // more lines than there are
      progress(r, r.n.eventId - 1, 0, 3); // another narration
      expect(told()).toEqual([2]);
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 2, line: "新的第三句" });
      progress(r, r.n.eventId, 0, 3); // about the old third line: must not lock the new one
      expect(told()).toEqual([2]);
      progress(r, r.n.eventId, 1, 3);
      expect(told()).toEqual([2, 3]);
      const other = makeConn("host-2");
      r.room.onConnect(other);
      claim(r.room, other);
      expect(sentMsgs(other).filter((m) => m.type === "HOST_NARRATION_PROGRESS")).toEqual([{ type: "HOST_NARRATION_PROGRESS", eventId: r.n.eventId, done: 3 }]);
    });

    // Value: protects=an edit lands only on the narration the big screen shows, and a new narration starts unread and
    // unedited (D3, D14); fails_when=the room takes an edit of the old narration while the next one is generating (the
    // screen shows … but would speak the edit), or keeps the old done/rev, so line 0 of the next narration is refused.
    it("refuses an edit while the next narration is on its way, then takes line 0 of the new one", async () => {
      const r = await threeLines();
      progress(r, r.n.eventId, 0, 3);
      judge(r.room, r.hostConn); // the next narration is generating: lastNarration is still the old one
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: r.n.eventId, rev: 0, index: 2, line: "太晚了" });
      expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ error: "invalid_action", detail: "stale_narration" });
      await sleep(30);
      const next = narrations(r.room).at(-1);
      expect(next.eventId).toBeGreaterThan(r.n.eventId);
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId: next.eventId, rev: 0, index: 0, line: "新的開場" });
      expect(narrations(r.room).at(-1)).toMatchObject({ eventId: next.eventId, rev: 1, lines: ["新的開場", "第二句", "第三句"] });
    });

// Value: protects=the host's queued line is said once, in segment 2, by AI or scripted narration (host-next-line.md);
// fails_when=the line is lost, said twice, lands in another segment, or a stale narration eats a re-queued line; no_claim=real model behaviour (llm.live.test.ts).
    describe("next line (HOST_NEXT_LINE)", () => {
      const states = (conn: ReturnType<typeof makeConn>) => sentMsgs(conn).filter((m) => m.type === "HOST_NEXT_LINE_STATE").map((m) => m.line);

      it("the AI's second line keeps it when it says the line; the next narration has no line; every host page is told", async () => {
        const r = await llmRoom((req) => textReply(req.system.includes("珍珠能吃嗎") ? "紅隊答對了\n冒險者問：珍珠能吃嗎？\n輪到藍隊" : "結果\n氣氛\n換人"));
        const other = makeConn("host-2");
        r.room.onConnect(other);
        claim(r.room, other);
        expect(states(other)).toEqual([""]);
        begin(r);
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        expect(states(other).at(-1)).toBe("珍珠能吃嗎");
        judge(r.room, r.hostConn);
        await sleep(30);
        expect(r.calls.at(-1)!.system).toContain("一定要包含主持人指定的這句話：「珍珠能吃嗎」");
        expect(narrations(r.room).at(-1).lines).toEqual(["紅隊答對了", "冒險者問：珍珠能吃嗎？", "輪到藍隊"]);
        expect(transcript(r.room, r.hostConn).at(-1)).toMatchObject({ sources: ["llm", "llm", "llm"], event: { hostLine: "珍珠能吃嗎" } });
        for (const c of [r.hostConn, other]) expect(states(c).at(-1)).toBe("");
        judge(r.room, r.hostConn);
        await sleep(30);
        expect(r.calls.at(-1)!.system).not.toContain("珍珠能吃嗎");
        expect(narrations(r.room).at(-1).lines).toEqual(["結果", "氣氛", "換人"]);
      });

      it("writes the line over segment 2 when the AI left it out, and scripted narration says it word for word", async () => {
        const r = await llmRoom(() => textReply("結果\n氣氛\n換人"));
        begin(r);
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        judge(r.room, r.hostConn);
        await sleep(30);
        expect(narrations(r.room).at(-1).lines).toEqual(["結果", "珍珠能吃嗎", "換人"]);
        expect(transcript(r.room, r.hostConn).at(-1)).toMatchObject({ sources: ["llm", "host", "llm"] });

        const s = await llmRoom(() => textReply("x"), { key: null });
        begin(s);
        await sleep(30);
        send(s.room, s.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        judge(s.room, s.hostConn);
        await sleep(30);
        expect(narrations(s.room).at(-1).lines[1]).toBe("珍珠能吃嗎");
        expect(s.calls).toHaveLength(0);
      });

      it("keeps a line holding a bank answer out of the prompt and says it word for word", async () => {
        const r = await llmRoom(() => textReply("結果\n氣氛\n換人"));
        begin(r);
        await sleep(30);
        const answer = (r.room as unknown as { bankAnswers: string[] }).bankAnswers.find((a) => a.length >= 3 && a.length <= 30)!;
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: `答案是${answer}` });
        judge(r.room, r.hostConn);
        await sleep(30);
        expect(r.calls.at(-1)!.system).not.toContain(answer);
        expect(narrations(r.room).at(-1).lines[1]).toBe(`答案是${answer}`);
      });

      it("cancels on \"\", rejects text that cleans to nothing, and only the host may queue", async () => {
        const r = await llmRoom(() => textReply("結果\n氣氛\n換人"));
        begin(r);
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "<>" });
        expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "empty_line" });
        const intruder = makeConn("nope");
        send(r.room, intruder, { type: "HOST_NEXT_LINE", line: "駭進來" });
        expect(sentMsgs(intruder).at(-1)).toMatchObject({ error: "not_host" });
        expect(states(r.hostConn).at(-1)).toBe("珍珠能吃嗎");
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "" });
        expect(states(r.hostConn).at(-1)).toBe("");
        judge(r.room, r.hostConn);
        await sleep(30);
        expect(narrations(r.room).at(-1).lines[1]).toBe("氣氛");
        expect(transcript(r.room, r.hostConn).filter((e: { kind?: string }) => e.kind === "next").map((e: { text: string }) => e.text)).toEqual(["珍珠能吃嗎", ""]);
      });

      it("a narration already running when the host cancels and re-queues the same text leaves the new one queued", async () => {
        let release!: () => void;
        const r = await llmRoom(() => new Promise<Response>((res) => (release = () => res(textReply("結果\n氣氛\n換人")))));
        begin(r);
        release();
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        judge(r.room, r.hostConn);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "" });
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        release();
        await sleep(30);
        expect(narrations(r.room).at(-1).lines[1]).toBe("珍珠能吃嗎");
        expect(states(r.hostConn).at(-1)).toBe("珍珠能吃嗎");
      });

      // /review: two narrations in flight both carried the line, so a quick second judgment said it twice.
      it("only one narration in flight carries the line, so two quick judgments never say it twice", async () => {
        const releases: (() => void)[] = [];
        const r = await llmRoom(() => new Promise<Response>((res) => releases.push(() => res(textReply("結果\n氣氛\n換人")))));
        begin(r);
        releases.shift()!();
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        judge(r.room, r.hostConn); // narration 1 carries the line and waits
        judge(r.room, r.hostConn); // narration 2 must not carry it too
        releases[0]();
        await sleep(10);
        releases[1]();
        await sleep(30);
        expect(narrations(r.room).map((n: { lines: string[] }) => n.lines[1]).slice(-2)).toEqual(["珍珠能吃嗎", "氣氛"]);
        expect(states(r.hostConn).at(-1)).toBe("");
      });

      it("a narration the room drops as stale does not use up the line: the next one says it", async () => {
        const releases: (() => void)[] = [];
        const r = await llmRoom(() => new Promise<Response>((res) => releases.push(() => res(textReply("結果\n氣氛\n換人")))));
        begin(r);
        releases.shift()!();
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        judge(r.room, r.hostConn); // narration 1 carries the line and waits
        judge(r.room, r.hostConn); // narration 2 does not
        releases[1]();
        await sleep(10);
        releases[0](); // narration 1 lands after 2: dropped as stale
        await sleep(30);
        expect(narrations(r.room).at(-1).lines[1]).toBe("氣氛");
        expect(states(r.hostConn).at(-1)).toBe("珍珠能吃嗎");
        judge(r.room, r.hostConn);
        releases[2]();
        await sleep(30);
        expect(narrations(r.room).at(-1).lines[1]).toBe("珍珠能吃嗎");
        expect(states(r.hostConn).at(-1)).toBe("");
      });

      it("a room reset drops the queued line: the next host of the code starts with none", async () => {
        const r = await llmRoom(() => textReply("結果\n氣氛\n換人"));
        begin(r);
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        await (r.room as any).expire();
        const next = makeConn("host-next");
        r.room.onConnect(next);
        claim(r.room, next);
        expect(states(next)).toEqual([""]);
      });

      it("folds newlines a raw socket sends into one line", async () => {
        const r = await llmRoom(() => textReply("結果\n氣氛\n換人"));
        begin(r);
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠\n\n能吃嗎" });
        expect(states(r.hostConn).at(-1)).toBe("珍珠 能吃嗎");
      });

      it("clears a queued line when the game ends and refuses new ones", async () => {
        const r = await llmRoom(() => textReply("行"), { key: null });
        begin(r, undefined, 1);
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "還沒說" });
        // Queued after the last narration started: still queued until the game ends.
        for (let i = 0; i < 200 && r.room.game!.phase === "playing"; i++) {
          judge(r.room, r.hostConn);
          await sleep(5);
          if (r.room.game!.phase === "playing") send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "還沒說" });
        }
        await sleep(30);
        expect(r.room.game!.phase).toBe("finished");
        // /review: the game-ending judgment's own narration still says the line queued before it.
        expect(narrations(r.room).at(-1).lines[1]).toBe("還沒說");
        expect(states(r.hostConn).at(-1)).toBe("");
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "太晚了" });
        expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "game_over" });
      });
    });

    it("feeds the last five edited lines back as style examples", async () => {
      const r = await llmRoom(() => textReply("行"));
      begin(r);
      await sleep(30);
      const eventId = narrations(r.room).at(-1).eventId;
      for (let i = 1; i <= 6; i++) send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", eventId, rev: i - 1, index: 0, line: `改寫第${i}句` });
      judge(r.room, r.hostConn);
      await sleep(30);
      const system = r.calls.at(-1)!.system;
      expect(system).not.toContain("改寫第1句");
      for (let i = 2; i <= 6; i++) expect(system).toContain(`改寫第${i}句`);
    });
  });

  describe("epilogue", () => {
    async function finish(r: Awaited<ReturnType<typeof llmRoom>>) {
      begin(r, undefined, 1);
      for (let i = 0; i < 200 && r.room.game!.phase === "playing"; i++) judge(r.room, r.hostConn);
      await sleep(60);
    }

    it("is written by the bigger model, sent once, and the scripted one is not used", async () => {
      // One reply carries the podium calls, then the story (eng D21).
      const story = () => "第一名是 Team 0！\n漫長的一夜過去了，Team 0 帶著滿滿的戰利品走出了地城。";
      const r = await llmRoom((req) => textReply(req.model === EPILOGUE_MODEL ? story() : "行"));
      await finish(r);
      const epi = all(r.room).filter((m) => m.type === "EPILOGUE");
      expect(epi).toHaveLength(1);
      expect(epi[0].text).toBe("漫長的一夜過去了，Team 0 帶著滿滿的戰利品走出了地城。");
      const podium = all(r.room).filter((m) => m.type === "STATE").at(-1)!.podium!;
      expect(podium.beats!.at(-1)).toMatchObject({ kind: "place", place: 1, line: "第一名是 Team 0！" });
      expect(r.calls.some((c) => c.model === EPILOGUE_MODEL && c.user.includes("排名"))).toBe(true);
    });

    it("falls back to the program-built epilogue when the LLM fails", async () => {
      const r = await llmRoom((req) => (req.model === EPILOGUE_MODEL ? json({ error: {} }, 500) : textReply("行")));
      await finish(r);
      const epi = all(r.room).filter((m) => m.type === "EPILOGUE");
      expect(epi).toHaveLength(1);
      expect(epi[0].text).toContain("Team 0");
      expect(epi[0].text).toContain(String(r.room.game!.teams[0].reward));
    });

    it("waits for the LLM up to the epilogue hold, then falls back once", async () => {
      const r = await llmRoom(async (req) => (req.model === EPILOGUE_MODEL ? (await sleep(300), textReply("太慢了")) : textReply("行")), { epilogueHoldMs: 40 });
      await finish(r);
      await sleep(350);
      const epi = all(r.room).filter((m) => m.type === "EPILOGUE");
      expect(epi).toHaveLength(1);
      expect(epi[0].text).not.toBe("太慢了");
    });
  });
});

describe("story moves on to the next team (two-line narration)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const all = (room: DungeonRoom) => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const sentMsgs = (conn: ReturnType<typeof makeConn>) => (conn.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
  const narrs = (room: DungeonRoom) => all(room).filter((m) => m.type === "NARRATION");

  function begin(teamCount = 2, opts: ConstructorParameters<typeof DungeonRoom>[2] = { holdMs: 30, epilogueDelayMs: 0 }) {
    const room = new DungeonRoom(makeRoom() as any, () => 0, opts);
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn };
  }
  function judge(room: DungeonRoom, hostConn: ReturnType<typeof makeConn>, correct = true) {
    const g = room.game!;
    const teamId = g.turnOrder[g.currentTurnIndex];
    const t = g.teams.find((x) => x.id === teamId)!;
    const qid = t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId;
    serveNext(room, hostConn, seqOf(room)); // close the previous reveal (D7); no-op if none
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct });
    landKill(room);
  }

  it("the opening narration is followed by a line about the first team on turn", async () => {
    const { room } = begin();
    await flush();
    expect(narrs(room)[0].lines.at(-1)).toContain("Team 0");
  });

  it("a judgment's narration carries a follow-up that names the team now on turn and its monster", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn); // Team 0 answers; Team 1 is next, still in the first room
    await flush();
    const n = narrs(room).at(-1);
    expect(n.lines[0]).toContain("Team 0");
    expect(n.lines.at(-1)).toContain("Team 1");
    expect(n.lines.at(-1)).toContain("軟趴趴史萊姆");
  });

  it("names the right team after a wrong answer too (turn still passes)", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn, false);
    await flush();
    expect(narrs(room).at(-1).lines.at(-1)).toContain("Team 1");
  });

  it("the killing blow has no follow-up: nobody is next", async () => {
    const { room, hostConn } = begin(1);
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) judge(room, hostConn);
    await sleep(40);
    const kill = narrs(room).at(-1);
    expect(kill.lines).toHaveLength(2); // result + atmosphere, no transition — nobody is next
  });

  it("replays the follow-up to a late connection, and a host edit keeps it", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn);
    await flush();
    send(room, hostConn, { type: "HOST_EDIT_NARRATION", eventId: narrs(room).at(-1).eventId, rev: 0, index: 0, line: "主持人改的結果句" });
    const edited = narrs(room).at(-1);
    expect(edited.lines[0]).toBe("主持人改的結果句");
    expect(edited.lines.at(-1)).toContain("Team 1");
    const late = makeConn("late");
    room.onConnect(late);
    const replayed = sentMsgs(late).find((m) => m.type === "NARRATION");
    expect(replayed.lines[0]).toBe("主持人改的結果句");
    expect(replayed.lines.at(-1)).toContain("Team 1");
  });

  it("records the follow-up and who wrote it in the transcript", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn);
    await flush();
    send(room, hostConn, { type: "HOST_GET_TRANSCRIPT" });
    const t = sentMsgs(hostConn).findLast((m) => m.type === "TRANSCRIPT").entries;
    expect(t.at(-1).sources.at(-1)).toBe("scripted");
    expect(t.at(-1).lines.at(-1)).toContain("Team 1");
  });

  it("uses the model's own second line for atmosphere, but still falls back to scripted for the transition it didn't write", async () => {
    // The provider only wrote 2 of the 3 target segments (result + atmosphere) for this
    // has-next event, so its 2nd line lands in the atmosphere slot — the transition slot
    // (naming the next team) always falls back to scripted when the provider didn't supply it.
    const two = { name: "llm", narrate: async () => "結果句在這裡！\n輪到 Team 1，準備好了嗎？" };
    const { room } = begin(2, { holdMs: 50, epilogueDelayMs: 0, provider: two });
    await sleep(40);
    const n = narrs(room)[0];
    expect(n.lines[0]).toBe("結果句在這裡！");
    expect(n.lines[1]).toBe("輪到 Team 1，準備好了嗎？");
    expect(n.lines[2]).toContain("Team 0"); // scripted fallback transition, not the provider's line
  });
});

describe("team identity and reconnect (audit findings)", () => {
  function twoTeamGame() {
    const { room, hostConn } = makeRoomWithHost();
    const { ids, conns } = joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids, conns };
  }
  const online = (room: DungeonRoom) => room.game!.teams.map((t) => t.online);

  it("another connection cannot take over an existing team id with a different key", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    const attacker = makeConn("attacker");
    send(room, attacker, { type: "JOIN", teamId: T1, teamKey: KEY2, teamName: "Hijack" });
    expect(lastSentTo(attacker)).toMatchObject({ type: "ERROR", error: "bad_token" });
    expect(lastBroadcast(room)).toMatchObject({ type: "LOBBY", teams: [{ id: T1, name: "Team 0" }] });
  });

  it("impersonating a team with REJOIN and a wrong key does nothing, and leaving does not take the team offline", () => {
    const { room, ids } = twoTeamGame();
    const spy = makeConn("spy");
    send(room, spy, { type: "REJOIN", teamId: ids[1], teamKey: KEY2 });
    expect(lastSentTo(spy)).toMatchObject({ type: "ERROR", error: "bad_token" });
    room.onClose(spy);
    expect(online(room)).toEqual([true, true]);
    expect(currentTurnAny(room)).not.toBeNull();
  });

  it("a phone that reconnects (JOIN with its own id and key) comes back online after the game started", () => {
    const { room, ids, conns } = twoTeamGame();
    room.onClose(conns[0]);
    expect(online(room)).toEqual([false, true]);
    const again = makeConn("player-again");
    send(room, again, { type: "JOIN", teamId: ids[0], teamKey: KEY, teamName: "Team 0" });
    expect(online(room)).toEqual([true, true]);
    expect(lastBroadcast(room)).toMatchObject({ type: "STATE" });
  });

  it("REJOIN with the right key restores the team; the wrong key is refused", () => {
    const { room, ids, conns } = twoTeamGame();
    room.onClose(conns[0]);
    const bad = makeConn("bad");
    send(room, bad, { type: "REJOIN", teamId: ids[0], teamKey: KEY2 });
    expect(lastSentTo(bad)).toMatchObject({ error: "bad_token" });
    expect(online(room)).toEqual([false, true]);
    send(room, makeConn("good"), { type: "REJOIN", teamId: ids[0], teamKey: KEY });
    expect(online(room)).toEqual([true, true]);
  });

  it("an unknown team still cannot join once the game has started", () => {
    const { room } = twoTeamGame();
    const late = makeConn("late");
    send(room, late, { type: "JOIN", teamId: T3, teamKey: KEY, teamName: "Late" });
    expect(lastSentTo(late)).toMatchObject({ error: "game_already_started" });
  });

  it("a page reload: the old connection closing after the new one joined does not take the team offline", () => {
    const { room, ids, conns } = twoTeamGame();
    send(room, makeConn("reloaded"), { type: "JOIN", teamId: ids[0], teamKey: KEY, teamName: "Team 0" });
    room.onClose(conns[0]); // the stale socket closes late
    expect(online(room)).toEqual([true, true]);
  });

  it("the turn keeps going for a team that came back", () => {
    const { room, ids, conns } = twoTeamGame();
    room.onClose(conns[0]);
    send(room, makeConn("again"), { type: "JOIN", teamId: ids[0], teamKey: KEY, teamName: "Team 0" });
    expect(currentTurnAny(room)).toBe(ids[0]);
  });

  // Value: protects=60 junk sockets cannot keep the host, the TV or a team's phone out (TODOS: 60 條連線能鎖死房間);
  // fails_when=a full room refuses the newcomer instead of closing its oldest spare socket, or closes a host, one of
  // the first two screens, or a team's only connection.
  it("a full room closes its oldest spare socket, never the host, the first screens or a team's only phone", () => {
    const { room, hostConn } = makeRoomWithHost();
    const closed = (c: ReturnType<typeof makeConn>) => (c.close as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    const tv = screenConn(room, "tv");
    const tv2 = screenConn(room, "tv2");
    const phone = makeConn("phone");
    room.onConnect(phone);
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "紅隊" });
    const twin = makeConn("twin"); // a second socket for the same team (a reload): the older of the two is a spare
    room.onConnect(twin);
    send(room, twin, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "紅隊" });
    const tv3 = screenConn(room, "tv3"); // a third screen: a spare
    const junk = Array.from({ length: 54 }, (_, i) => makeConn(`junk${i}`));
    junk.forEach((c) => room.onConnect(c));
    expect(junk.some(closed)).toBe(false); // 60 sockets, none closed yet

    const late = makeConn("late");
    room.onConnect(late);
    expect(closed(late)).toBe(false);
    expect(closed(phone)).toBe(true); // the oldest spare: the team keeps its newer socket
    room.onConnect(makeConn("later"));
    expect(closed(tv3)).toBe(true);
    room.onConnect(makeConn("latest"));
    expect(closed(junk[0])).toBe(true);
    for (const c of [hostConn, tv, tv2, twin]) expect(closed(c)).toBe(false);
  });

  // Value: protects=a socket the room closed (or a reconnect replaced) cannot keep acting if its client ignores the
  // close, and host-only messages stop going to a dead socket; fails_when=a closed or superseded socket's message is
  // handled, or the replaced host socket keeps host rights before the new one claims
  it("ignores a socket it closed or replaced, and a reconnecting host page must claim again", () => {
    const { room, hostConn } = makeRoomWithHost();
    const phone = makeConn("phone");
    room.onConnect(phone);
    room.onClose(phone);
    const broadcasts = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.length;
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Ghost" });
    expect(phone.send).toHaveBeenCalledTimes(1); // only the snapshot on connect
    expect((room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.length).toBe(broadcasts);
    expect((room as any).pendingTeams).toEqual([]);

    const newHostSocket = makeConn(hostConn.id);
    room.onConnect(newHostSocket);
    expect(hostConn.close).toHaveBeenCalled();
    expect((room as any).isHost(newHostSocket)).toBe(false);
    send(room, hostConn, { type: "HOST_SET_PASSWORD", password: "x" });
    expect((room as any).joinPassword).toBe("");
    claim(room, newHostSocket);
    expect((room as any).isHost(newHostSocket)).toBe(true);
  });

  it("refuses a newcomer when every socket in a full room is a host, a kept screen or a team's only phone", () => {
    const { room } = makeRoomWithHost();
    screenConn(room, "tv");
    screenConn(room, "tv2");
    for (let i = 0; i < 8; i++) {
      const c = makeConn(`p${i}`);
      room.onConnect(c);
      send(room, c, { type: "JOIN", teamId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, teamKey: KEY, teamName: `隊${i}` });
    }
    // The rest are host pages (every device the host opened): 1 + 2 + 8 + 49 = 60.
    for (let i = 0; i < 49; i++) {
      const c = makeConn(`h${i}`);
      room.onConnect(c);
      claim(room, c);
    }
    const next = makeConn("next");
    room.onConnect(next);
    expect((next.close as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

function currentTurnAny(room: DungeonRoom) {
  const g = room.game!;
  return currentTurnTeamId(g);
}

describe("image questions: R2_PUBLIC_BASE_URL wiring", () => {
  const imageBank = parseBank({
    rooms: [
      {
        monster: "slime-soft",
        baseDifficulty: 1, reward: 10,
        questions: [{ kind: "text", id: "r0-img1", content: { kind: "image", value: "55555555-5555-5555-5555-555555555555" }, answer: "松鼠" }],
      },
    ],
    boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
  });

  it("builds the broadcast question's content.url from room.env.R2_PUBLIC_BASE_URL", () => {
    const roomIO = { ...(makeRoom() as any), env: { R2_PUBLIC_BASE_URL: "https://pub.example.r2.dev" } } as RoomIO;
    const room = new DungeonRoom(roomIO, () => 0, { bank: imageBank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const state = lastBroadcast(room);
    expect(state.question.content).toEqual({ kind: "image", url: "https://pub.example.r2.dev/55555555-5555-5555-5555-555555555555" });
    expect(state.question).not.toHaveProperty("answer");
  });

  it("falls back to a base-less path (never throws) when R2_PUBLIC_BASE_URL is unset", () => {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: imageBank }); // no env at all
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const state = lastBroadcast(room);
    expect(state.question.content).toEqual({ kind: "image", url: "/55555555-5555-5555-5555-555555555555" });
  });
});

describe("sound cues (big-screen effects)", () => {
  const states = (room: DungeonRoom) =>
    (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE");

  it("tags each event's STATE with its effect: start, then correct / retry", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    expect(states(room).at(-1)).toMatchObject({ eventId: 1, cue: "start" });

    const g = room.game!;
    const t = g.teams.find((x) => x.id === g.turnOrder[g.currentTurnIndex])!;
    send(room, hostConn, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true });
    expect(states(room).at(-1)).toMatchObject({ eventId: 2, cue: "correct" });

    serveNext(room, hostConn, seqOf(room));
    const g2 = room.game!;
    const t2 = g2.teams.find((x) => x.id === g2.turnOrder[g2.currentTurnIndex])!;
    send(room, hostConn, { type: "HOST_JUDGE", teamId: t2.id, questionId: t2.currentQuestionId, correct: false, fleeChoice: "retry" });
    expect(states(room).at(-1)).toMatchObject({ eventId: 3, cue: "retry" });
  });

  it("sends no cue before any event", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 2);
    const late = makeConn("late");
    room.onConnect(late);
    expect(JSON.parse((late.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).cue).toBeUndefined();
  });
});

describe("class abilities: lobby pick and the warrior's roll (class-abilities.md)", () => {
  afterEach(() => vi.useRealTimers());
  // The room's rng both deals questions and rolls the d20: rollD20 gives floor(r * 20) + 1.
  function warriorGame(teamCount = 2) {
    let r = 0;
    const room = new DungeonRoom(makeRoom() as any, () => r);
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, teamCount);
    send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "warrior" });
    send(room, hostConn, { type: "HOST_START" });
    const roll = (value: number) => {
      r = (value - 1) / 20;
      passChecks(room);
      send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: room.game!.teams[0].currentQuestionId });
    };
    return { room, hostConn, ids, conns, roll };
  }
  const err = (conn: Conn) => lastSentTo(conn as never)?.detail ?? lastSentTo(conn as never)?.error;

  it("a lobby pick shows on LOBBY, the last pick wins, null clears it, and it is fixed at the start", () => {
    const { room, hostConn } = makeRoomWithHost();
    const { conns } = joinTeams(room, hostConn, 2);
    send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: null });
    send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "warrior" });
    send(room, conns[1], { type: "TEAM_PICK_CLASS", classId: "warrior" });
    send(room, conns[1], { type: "TEAM_PICK_CLASS", classId: null });
    expect(lastBroadcast(room).teams.map((t: { classId?: string }) => t.classId)).toEqual(["warrior", undefined]);
    send(room, hostConn, { type: "HOST_START" });
    expect(room.game!.teams.map((t) => [t.classId, t.abilityUses])).toEqual([["warrior", 4], [undefined, 2]]);
    send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "thief" });
    expect(err(conns[0])).toBe("game_already_started");
    expect(room.game!.teams[0].classId).toBe("warrior");
  });

  it("every class can be picked in the lobby (PR 2)", () => {
    const { room, hostConn } = makeRoomWithHost();
    const { conns } = joinTeams(room, hostConn, 1);
    for (const classId of ["mage", "cleric", "thief", "warrior"] as const) {
      send(room, conns[0], { type: "TEAM_PICK_CLASS", classId });
      expect(lastBroadcast(room).teams[0].classId).toBe(classId);
    }
  });

  it("spends the use at the roll, holds a hit for 2 s (host judging and a second roll refused), then judges it correct", () => {
    vi.useFakeTimers();
    const { room, hostConn, conns, roll } = warriorGame();
    const q = room.game!.teams[0].currentQuestionId;
    const seq = seqOf(room);
    roll(WARRIOR_TARGET);
    const held = lastBroadcast(room);
    expect(held.pendingRoll).toMatchObject({ questionId: q, value: WARRIOR_TARGET });
    expect(held.view.teams[0].abilityUses).toBe(3);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: room.game!.teams[0].id, questionId: q, correct: true, eventId: seq });
    expect(err(hostConn)).toBe("roll_pending");
    roll(WARRIOR_TARGET);
    expect(err(conns[0])).toBe("answer_pending");
    vi.advanceTimersByTime(2000);
    const out = lastBroadcast(room);
    expect(out.pendingRoll).toBeNull();
    expect(out.reveal).toMatchObject({ questionId: q });
    expect(room.game!.teams[0]).toMatchObject({ abilityUses: 3, roomIndex: 1 });
    expect(seqOf(room)).toBe(seq + 1);
  });

  it("a 5 is a retry: same question, the turn passes, one use spent", () => {
    vi.useFakeTimers();
    const { room, ids, roll } = warriorGame();
    const q = room.game!.teams[0].currentQuestionId;
    roll(5);
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).reveal).toBeNull();
    expect(room.game!.teams[0]).toMatchObject({ abilityUses: 3, currentQuestionId: q, roomIndex: 0 });
    expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
  });

  // Value: protects=the narrator says the warrior's d20 and whether it hit (TODOS: 旁白念出戰士擲到幾點);
  // fails_when=the room drops the die from the narration event, so the line is a plain correct / retry one.
  it("the narration says the warrior's roll and whether it hit", async () => {
    vi.useFakeTimers();
    const { room, roll } = warriorGame(1);
    const said = () => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "NARRATION").at(-1).lines[0];
    roll(5);
    await vi.advanceTimersByTimeAsync(2000);
    expect(said()).toMatch(/^戰士擲出 5 點，沒打中。/);
    roll(17);
    await vi.advanceTimersByTimeAsync(2000);
    expect(said()).toMatch(/^戰士擲出 17 點，命中！/);
  });

  it("drops a roll whose turn moved on during the beat, and the use stays spent (R3, reversed in /review)", () => {
    // A phone that reloads during the beat must not throw a bad die away for free and roll again.
    vi.useFakeTimers();
    const { room, ids, conns, roll } = warriorGame();
    roll(1);
    room.onClose(conns[0]);
    expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).pendingRoll).toBeNull();
    expect(room.game!.teams[0]).toMatchObject({ abilityUses: 3, roomIndex: 0 });
  });

  it("a classless team is refused on its own turn, and nothing is spent", () => {
    const { room, ids, conns } = warriorGame();
    room.onClose(conns[0]);
    expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
    send(room, conns[1], { type: "TEAM_USE_ABILITY", questionId: room.game!.teams[1].currentQuestionId });
    expect(err(conns[1])).toMatch(/not a warrior/);
    expect((room as any).pendingRoll).toBeNull();
    expect(room.game!.teams[1].abilityUses).toBe(2);
  });

  it("during the beat the rolling team's select and lock, and sending it to the boss, are refused; the roll still judges", () => {
    vi.useFakeTimers();
    const { room, hostConn, ids, conns, roll } = warriorGame();
    const q = room.game!.teams[0].currentQuestionId;
    roll(WARRIOR_TARGET);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: 0 });
    expect(err(conns[0])).toBe("answer_pending");
    send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: q });
    reveal(room);
    expect(err(conns[0])).toBe("answer_pending");
    send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
    expect(err(hostConn)).toBe("lock_pending");
    expect((room as any).pendingRoll).toMatchObject({ questionId: q });
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).reveal).toMatchObject({ questionId: q });
  });

  it("a roll while a reveal is open is refused", () => {
    vi.useFakeTimers();
    const { room, conns, roll } = warriorGame();
    roll(WARRIOR_TARGET);
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).reveal).not.toBeNull();
    roll(WARRIOR_TARGET);
    expect(err(conns[0])).toBe("reveal_pending");
  });

  // Value: protects=a room that expires during a roll's beat comes back usable: the next game's host can judge;
  // fails_when=clearAnswerTimers stops clearing pendingRoll, so every later judge says roll_pending; why_new=the
  // expiry test above covers a lock's beat only; seam=none; no_claim=real Durable Object storage (mock RoomIO)
  it("ending the game during a warrior's roll drops it with no judgment", () => {
    vi.useFakeTimers();
    const { room, hostConn, roll } = warriorGame();
    roll(20);
    send(room, hostConn, { type: "HOST_END_GAME" });
    vi.advanceTimersByTime(2000);
    expect((room as any).pendingRoll).toBeNull();
    expect(lastBroadcast(room).reveal ?? null).toBeNull();
  });

  it("an expiring room drops a roll still in its beat: the next game in the room is not stuck behind it", async () => {
    vi.useFakeTimers();
    const { room, roll } = warriorGame();
    roll(20);
    await (room as any).expire();
    vi.advanceTimersByTime(2000);
    expect(room.game).toBeNull();
    const host2 = makeConn("host-conn-2");
    room.onConnect(host2);
    claim(room, host2);
    const { ids } = joinTeams(room, host2, 1);
    send(room, host2, { type: "HOST_START" });
    const q = room.game!.teams[0].currentQuestionId;
    send(room, host2, { type: "HOST_JUDGE", teamId: ids[0], questionId: q, correct: true, eventId: seqOf(room) });
    expect(lastSentTo(host2)?.type).not.toBe("ERROR");
    expect(lastBroadcast(room).reveal).toMatchObject({ questionId: q });
  });

  it("a class pick from a connection with no team is refused", () => {
    const { room } = makeRoomWithHost();
    const stranger = makeConn("stranger");
    room.onConnect(stranger);
    send(room, stranger, { type: "TEAM_PICK_CLASS", classId: "warrior" });
    expect(err(stranger)).toBe("unknown_team");
  });

  it("refuses a team with no class, another team's turn, a stale question and no uses left", () => {
    vi.useFakeTimers();
    const { room, conns, roll } = warriorGame();
    send(room, conns[1], { type: "TEAM_USE_ABILITY", questionId: room.game!.teams[1].currentQuestionId });
    expect(err(conns[1])).toMatch(/turn/);
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "boss-q1" });
    expect(err(conns[0])).toBe("stale_question");
    expect(room.game!.teams[0].abilityUses).toBe(4);
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, abilityUses: 0 } : t)) };
    roll(20);
    expect(err(conns[0])).toMatch(/no ability uses/);
    expect((room as any).pendingRoll).toBeNull();
  });

  // Value: protects=a warrior roll that kills the boss goes through the 4d20 beat and scores its dice (kill-roll.md);
  // fails_when=the warrior path skips the kill beat, or resolveRoll drops pendingKill.roll and judges a plain answer
  it("a warrior roll that kills the boss shows the 4d20, then scores them", () => {
    vi.useFakeTimers();
    const { room, ids, conns } = warriorGame();
    const g = room.game!;
    room.game = { ...g, teams: g.teams.map((t) => ({ ...t, inBoss: true })), boss: { ...g.boss, hp: 1, phaseIndex: g.boss.phases.length - 1 } };
    (room as any).rng = () => 19 / 20;
    const bq = room.game!.boss.currentQuestionId!;
    room.game = { ...room.game!, checks: { ...room.game!.checks, [checkKey(bq, ids[0])]: { value: 10, bonus: 0, dc: 8, passed: true } } };
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: bq });
    expect(lastBroadcast(room).pendingRoll).toMatchObject({ teamId: ids[0], kind: "warrior", value: 20 });
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).pendingRoll).toMatchObject({ teamId: ids[0], kind: "kill", values: [20, 20, 20, 20], value: 80 });
    expect(room.game!.phase).toBe("playing");
    vi.advanceTimersByTime(4000);
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.boss.killedByTeamId).toBe(ids[0]);
  });
});

describe("class abilities: mage, cleric and thief in the room (class-abilities.md PR 2)", () => {
  afterEach(() => vi.useRealTimers());
  const mc = (id: string) => ({ kind: "multipleChoice" as const, id, content: { kind: "text" as const, value: "選哪個？" }, options: ["A", "B", "C", "D"], correctIndex: 1 });
  const bank = parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [mc("r0-mc1"), { kind: "text", id: "r0-t1", content: { kind: "text", value: "？" }, answer: "a" }, { kind: "text", id: "r0-t2", content: { kind: "text", value: "？" }, answer: "〈萬家福〉" }] }],
    boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [mc("boss-mc1"), mc("boss-mc2")] },
  });
  const err = (conn: Conn) => lastSentTo(conn as never)?.detail ?? lastSentTo(conn as never)?.error;

  /** Team 0 is `classId`; it faces r0-mc1 (or the boss's boss-mc1 with `boss`). */
  function game(classId: "mage" | "cleric" | "thief", boss = false) {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, 2);
    send(room, conns[0], { type: "TEAM_PICK_CLASS", classId });
    send(room, hostConn, { type: "HOST_START" });
    if (boss) {
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      room.game = { ...room.game!, boss: { ...room.game!.boss, currentQuestionId: "boss-mc1" } };
    } else room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "r0-mc1" } : t)) };
    const q = boss ? "boss-mc1" : "r0-mc1";
    const use = () => send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: q });
    const lockWrong = () => {
      const wrong = room.game!.optionOrder[q].indexOf(0); // "A"; "B" is right
      send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: wrong });
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: q });
      reveal(room);
      vi.advanceTimersByTime(2000);
    };
    return { room, hostConn, ids, conns, q, use, lockWrong };
  }

  it("the mage greys out 2 wrong options for everyone, and is refused on a 1-character fill-in answer without spending", () => {
    const { room, conns, q, use } = game("mage");
    use();
    const removed = lastBroadcast(room).view.eliminated[q];
    expect(removed).toHaveLength(2);
    expect(removed).not.toContain(room.game!.optionOrder[q].indexOf(1));
    expect(room.game!.teams[0].abilityUses).toBe(3);
    use();
    expect(err(conns[0])).toBe("no_option_to_remove");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "r0-t1" } : t)) };
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t1" });
    expect(err(conns[0])).toBe("no_hint");
    expect(room.game!.teams[0].abilityUses).toBe(3);
  });

  // Value: protects=the mage on a fill-in question shows the answer's first character to every screen and
  // spends a use, once per question (#106); fails_when=the room still refuses fill-in, or a second cast spends;
  // seam=room → game-state mageHint; no_claim=how each page renders it (e2e)
  it("the mage shows a fill-in answer's first character to everyone, once per question", () => {
    const { room, conns } = game("mage");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "r0-t2" } : t)) };
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t2" });
    expect(lastBroadcast(room).view.mageHints).toEqual({ "r0-t2": "萬" });
    expect(room.game!.teams[0].abilityUses).toBe(3);
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t2" });
    expect(err(conns[0])).toBe("hint_shown");
    expect(room.game!.teams[0].abilityUses).toBe(3);
  });

  // Value: protects=a mage cast on a question id the bank lacks is refused as stale and spends nothing (/review);
  // fails_when=mageHint or mageEliminate runs on a missing question, or the error names the wrong cause; seam=room; no_claim=none
  it("the mage is refused on a question id the bank lacks, without spending", () => {
    const { room, conns } = game("mage");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "nope" } : t)) };
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "nope" });
    expect(err(conns[0])).toBe("stale_question");
    expect(room.game!.teams[0].abilityUses).toBe(4);
  });

  it("the thief's sneak attack shows on every screen until its answer is judged, and cannot be armed twice", () => {
    vi.useFakeTimers();
    const { room, conns, use, lockWrong } = game("thief");
    use();
    expect(lastBroadcast(room).view.teams[0]).toMatchObject({ sneakArmed: true, abilityUses: 1 });
    use();
    expect(err(conns[0])).toBe("sneak_armed");
    lockWrong();
    send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "r0-mc1", choice: "retry" });
    expect(lastBroadcast(room).view.teams[0].sneakArmed).toBeUndefined();
    expect(room.game!.teams[0].abilityUses).toBe(1);
  });

  // Value: protects=a thief's sneak kill shows the 1.5× bonus on the big screen and scores that same value
  // (kill-roll.md); fails_when=pendingRoll.value is the raw dice sum, so the TV and the score disagree
  it("a sneak attack that kills shows and scores the 1.5× 4d20", () => {
    vi.useFakeTimers();
    const { room, ids, conns, q, use } = game("thief", true);
    room.game = { ...room.game!, boss: { ...room.game!.boss, hp: 1, phaseIndex: room.game!.boss.phases.length - 1 } };
    use();
    const before = room.game!.teams[0].reward;
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q].indexOf(1) });
    send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: q });
    reveal(room);
    vi.advanceTimersByTime(4000); // the lock's beat, then the crit die's
    const roll = lastBroadcast(room).pendingRoll;
    expect(roll).toMatchObject({ teamId: ids[0], kind: "kill", values: [1, 1, 1, 1], value: 6 }); // rng 0: four 1s, × 1.5
    vi.advanceTimersByTime(4000);
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.teams[0].reward - before).toBeGreaterThanOrEqual(6);
  });

  it("a cleric prays on its wrong lock and its 重答 keeps the turn", () => {
    vi.useFakeTimers();
    const { room, ids, conns, q, use, lockWrong } = game("cleric");
    use();
    expect(err(conns[0])).toMatch(/cannot pray/); // nothing locked wrong yet
    lockWrong();
    expect(lastBroadcast(room).view.awaitingPrayer).toBe(ids[0]);
    use();
    expect(room.game!.pendingWrong).toMatchObject({ teamId: ids[0], prayed: true });
    send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: q, choice: "retry" });
    expect(currentTurnTeamId(room.game!)).toBe(ids[0]);
    expect(room.game!.teams[0]).toMatchObject({ currentQuestionId: q, abilityUses: 1 });
  });

  it("a cleric's wrong boss lock waits for 祈禱 instead of the beat; praying rotates the question and keeps the turn", () => {
    vi.useFakeTimers();
    const { room, ids, use, lockWrong } = game("cleric", true);
    lockWrong();
    vi.advanceTimersByTime(10_000);
    expect(room.game!.pendingWrong).toMatchObject({ teamId: ids[0] });
    expect(lastBroadcast(room).view.awaitingPrayer).toBe(ids[0]);
    use();
    expect(room.game!.pendingWrong).toBeNull();
    expect(room.game!.boss.currentQuestionId).toBe("boss-mc2");
    expect(currentTurnTeamId(room.game!)).toBe(ids[0]);
  });

  it("a cleric's 不用 in the boss room resolves the miss as usual, and a cleric with no uses gets the beat", () => {
    vi.useFakeTimers();
    const { room, ids, conns, lockWrong } = game("cleric", true);
    lockWrong();
    send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "boss-mc1", choice: "retry" });
    expect(room.game!.pendingWrong).toBeNull();
    expect(currentTurnTeamId(room.game!)).toBe(ids[1]);

    const spent = game("cleric", true);
    spent.room.game = { ...spent.room.game!, teams: spent.room.game!.teams.map((t, i) => (i === 0 ? { ...t, abilityUses: 0 } : t)) };
    spent.lockWrong();
    vi.advanceTimersByTime(2000);
    expect(spent.room.game!.pendingWrong).toBeNull();
    expect(currentTurnTeamId(spent.room.game!)).toBe(spent.ids[1]);
  });
  it("a cleric's second wrong boss lock in its kept turn gets the beat", () => {
    vi.useFakeTimers();
    const { room, ids, conns, use, lockWrong } = game("cleric", true);
    lockWrong();
    use(); // pray: rotates to a new boss question, keeps the turn
    const q2 = room.game!.boss.currentQuestionId!;
    const wrong = room.game!.optionOrder[q2].indexOf(0);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: q2, optionIndex: wrong });
    send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: q2 });
    reveal(room);
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).view.awaitingPrayer).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(room.game!.pendingWrong).toBeNull();
    expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
  });

  it("a cleric's prayer for another question is refused without spending", () => {
    vi.useFakeTimers();
    const { room, conns, lockWrong } = game("cleric");
    lockWrong();
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t1" });
    expect(err(conns[0])).toBe("stale_question");
    expect(room.game!.teams[0].abilityUses).toBe(2);
    expect(room.game!.pendingWrong?.prayed).toBeUndefined();
  });
});

describe("cleric on a fill-in question: 祈禱 / 重答 / 逃跑 after the host's 答錯 (#106)", () => {
  afterEach(() => vi.useRealTimers());
  const text = (id: string) => ({ kind: "text" as const, id, content: { kind: "text" as const, value: "？" }, answer: "台北市" });
  const bank = parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [text("r0-t1"), text("r0-t2"), { kind: "multipleChoice", id: "r0-mc1", content: { kind: "text", value: "？" }, options: ["A", "B"], correctIndex: 1 }] }],
    boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [text("boss-t1"), text("boss-t2")] },
  });
  const err = (conn: Conn) => lastSentTo(conn as never)?.detail ?? lastSentTo(conn as never)?.error;

  /** Team 0 is a cleric facing r0-t1 (or the boss's boss-t1), with 「台中」 sent; team 1 has no class. */
  function game(boss = false) {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, 2);
    send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "cleric" });
    send(room, hostConn, { type: "HOST_START" });
    if (boss) {
      send(room, hostConn, { type: "HOST_SEND_TO_BOSS", teamId: ids[0] });
      room.game = { ...room.game!, boss: { ...room.game!.boss, currentQuestionId: "boss-t1" } };
    } else room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "r0-t1" } : t)) };
    const q = boss ? "boss-t1" : "r0-t1";
    passChecks(room);
    send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "台中" });
    const host = (fleeChoice: "team" | "pray" | "retry" | "flee", eventId?: number) =>
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: q, correct: false, fleeChoice, ...(eventId !== undefined ? { eventId } : {}) });
    return { room, hostConn, ids, conns, q, host };
  }

  // Value: protects=the host's 答錯 on a cleric's fill-in waits for the team, and the phone's 祈禱 then keeps the turn on the
  // same question with an empty answer (AC8); fails_when=the 答錯 settles at once, or 祈禱 passes the turn; seam=room;
  // no_claim=how the phone draws the buttons (e2e)
  it("the host's 答錯 waits for the cleric; its 祈禱 keeps the turn on the same question, answer cleared", () => {
    const { room, ids, conns, q, host } = game();
    const before = lastBroadcast(room).eventId;
    expect(lastBroadcast(room).view.teams[0].mayPray).toBe(true);
    expect(lastBroadcast(room).view.teams[1].mayPray).toBeUndefined();
    host("team");
    expect(room.game!.pendingWrong).toEqual({ teamId: ids[0], questionId: q, optionIndex: null });
    expect(lastBroadcast(room).view.awaitingPrayer).toBe(ids[0]);
    expect(lastBroadcast(room).view.teams[0].typedAnswer).toBe("台中");
    expect(lastBroadcast(room).eventId).toBe(before);
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: q });
    expect(room.game!.pendingWrong).toBeNull();
    expect(currentTurnTeamId(room.game!)).toBe(ids[0]);
    expect(room.game!.teams[0]).toMatchObject({ currentQuestionId: q, abilityUses: 1, typedAnswer: undefined });
    // Prayed this turn: a second 答錯 settles as usual.
    expect(lastBroadcast(room).view.teams[0].mayPray).toBeUndefined();
  });

  // Value (ship review): protects=逃跑 from a non-boss wait, by the phone or the host, passes the turn, deals the cleric a new
  // question and spends nothing; fails_when=逃跑 is refused or treated as 祈禱 outside the boss room; seam=room; no_claim=difficulty
  it("逃跑 from a non-boss wait, by the phone or the host, passes the turn and spends nothing", () => {
    for (const by of ["phone", "host"] as const) {
      const { room, ids, conns, q, host } = game();
      host("team");
      if (by === "phone") send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: q, choice: "flee" });
      else host("flee");
      expect(room.game!.pendingWrong).toBeNull();
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
      expect(room.game!.teams[0].abilityUses).toBe(2);
      expect(room.game!.teams[0].currentQuestionId).not.toBe(q);
    }
  });

  // Value: protects=the host can pick 祈禱 for a team that does not, with the eventId it judged from, and 重答 passes the turn
  // without spending (AC9); fails_when=the host's 祈禱 is dropped as stale, or 重答 spends a use; seam=room; no_claim=none
  it("the host can pick 祈禱 for the team with the same eventId, or 重答, which spends nothing", () => {
    const a = game();
    const eventId = lastBroadcast(a.room).eventId;
    a.host("team", eventId);
    a.host("pray", eventId);
    expect(currentTurnTeamId(a.room.game!)).toBe(a.ids[0]);
    expect(a.room.game!.teams[0].abilityUses).toBe(1);

    const b = game();
    b.host("team");
    b.host("retry");
    expect(b.room.game!.pendingWrong).toBeNull();
    expect(currentTurnTeamId(b.room.game!)).toBe(b.ids[1]);
    expect(b.room.game!.teams[0]).toMatchObject({ currentQuestionId: b.q, abilityUses: 2 });
  });

  // Value: protects=the first press of the wait wins and a late one changes nothing (AC10); fails_when=the host's 祈禱 after the
  // phone's 重答 spends a use or takes the turn back; seam=room; no_claim=none
  it("the first press wins: the host's 祈禱 after the phone's 重答 is refused", () => {
    const { room, ids, conns, q, host, hostConn } = game();
    host("team");
    send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: q, choice: "retry" });
    host("pray");
    expect(err(hostConn)).toBe("no_wrong_answer");
    expect(room.game!.teams[0].abilityUses).toBe(2);
    expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
  });

  // Value: protects=a wait only starts for a cleric that may pray on a fill-in, and 祈禱 only with a wait (AC12); fails_when=a
  // "team" on multiple choice or for a spent cleric pins the turn, or "pray" spends without a wait; seam=room; no_claim=none
  it("refuses a wait on multiple choice or for a cleric with no uses, and 祈禱 with no wait", () => {
    const { room, ids, hostConn, host } = game();
    host("pray");
    expect(err(hostConn)).toBe("no_wrong_answer");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, abilityUses: 0 } : t)) };
    host("team");
    expect(err(hostConn)).toBe("cannot_pray");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, abilityUses: 2, currentQuestionId: "r0-mc1" } : t)) };
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-mc1", correct: false, fleeChoice: "team" });
    expect(err(hostConn)).toBe("not_text");
    expect(room.game!.pendingWrong).toBeNull();
    expect(room.game!.teams[0].abilityUses).toBe(2);
  });

  // Value: protects=in the boss room the wait has no beat, 祈禱 and 重答 keep the shared question and 逃跑 rotates it (AC11,
  // eng review D2=A); fails_when=armBossMiss settles the wait, or the MC-only flee→retry override swallows 逃跑; seam=room;
  // no_claim=the boss's hp (a wrong answer never hits)
  it("boss room: the wait outlasts the beat; 祈禱 and 重答 keep the question, 逃跑 rotates it", () => {
    vi.useFakeTimers();
    const pray = game(true);
    pray.host("team");
    vi.advanceTimersByTime(10_000);
    expect(pray.room.game!.pendingWrong).toMatchObject({ teamId: pray.ids[0], optionIndex: null });
    send(pray.room, pray.conns[0], { type: "TEAM_USE_ABILITY", questionId: "boss-t1" });
    expect(pray.room.game!.boss.currentQuestionId).toBe("boss-t1");
    expect(currentTurnTeamId(pray.room.game!)).toBe(pray.ids[0]);

    const retry = game(true);
    retry.host("team");
    send(retry.room, retry.conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "boss-t1", choice: "retry" });
    expect(retry.room.game!.boss.currentQuestionId).toBe("boss-t1");
    expect(currentTurnTeamId(retry.room.game!)).toBe(retry.ids[1]);

    const flee = game(true);
    flee.host("team");
    send(flee.room, flee.conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "boss-t1", choice: "flee" });
    expect(flee.room.game!.boss.currentQuestionId).toBe("boss-t2");
    expect(currentTurnTeamId(flee.room.game!)).toBe(flee.ids[1]);
  });
});

describe("fill-in: TEAM_SUBMIT_TEXT (#104)", () => {
  afterEach(() => vi.useRealTimers());
  function game(warrior = false) {
    let r = 0;
    const room = new DungeonRoom(makeRoom() as any, () => r);
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, 2);
    if (warrior) send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "warrior" });
    send(room, hostConn, { type: "HOST_START" });
    const q = () => room.game!.teams[0].currentQuestionId;
    const submit = (text: string, conn = conns[0]) => (passChecks(room), send(room, conn, { type: "TEAM_SUBMIT_TEXT", questionId: q(), text }));
    const rollFor = (value: number) => {
      r = (value - 1) / 20;
      passChecks(room);
      send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: q() });
    };
    return { room, hostConn, ids, conns, q, submit, rollFor };
  }
  const err = (conn: Conn) => lastSentTo(conn as never)?.detail;

  // Value: protects=the host page and TV get the cleaned answer in one STATE, without a narration bump (AC1);
  // fails_when=quotes are stripped, 41 characters are kept, or eventSeq moves (spinner never stops);
  // no_claim=the pages' rendering (e2e).
  it("broadcasts the cleaned answer, 40 characters at most, without bumping eventSeq", () => {
    const { room, submit } = game();
    const seq = seqOf(room);
    submit(`  Don't ${"字".repeat(40)}`);
    const sent = lastBroadcast(room).view.teams[0].typedAnswer;
    expect(Array.from(sent)).toHaveLength(40);
    expect(sent.startsWith("Don't 字")).toBe(true);
    expect(seqOf(room)).toBe(seq);
  });

  // Value: protects=blank, off-turn, repeated and mid-reveal sends change nothing and say why (AC2, AC3, AC7a);
  // fails_when=any of them writes typedAnswer or answers with the wrong detail; no_claim=multipleChoice (next test).
  it("refuses blank text, another team, a second send and a send during a reveal", () => {
    const { room, hostConn, ids, conns, q, submit } = game();
    submit(" \t ");
    expect(err(conns[0])).toBe("invalid_text");
    passChecks(room);
    send(room, conns[1], { type: "TEAM_SUBMIT_TEXT", questionId: room.game!.teams[1].currentQuestionId, text: "x" });
    expect(lastSentTo(conns[1])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[1].typedAnswer).toBeUndefined();
    passChecks(room);
    send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: "no-such-q", text: "x" });
    expect(err(conns[0])).toBe("not_text_question");
    submit("first");
    submit("second");
    expect(err(conns[0])).toBe("already_submitted");
    expect(room.game!.teams[0].typedAnswer).toBe("first");
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: q(), correct: true });
    expect(room.game!.teams[0].typedAnswer).toBeUndefined();
    passChecks(room);
    send(room, conns[1], { type: "TEAM_SUBMIT_TEXT", questionId: room.game!.teams[1].currentQuestionId, text: "x" });
    expect(err(conns[1])).toBe("reveal_pending");
  });

  // Value: protects=a send typed before the host judged that attempt never fills the retry of the same question;
  // fails_when=the eventId check goes and the late send blocks the real one with already_submitted;
  // no_claim=the phone stamping eventId (play page; e2e/fill-in.spec.ts).
  it("drops a send stamped with an older eventId; the current one and an unstamped one land", () => {
    const { room, hostConn, ids, conns, q, submit } = game();
    const before = seqOf(room);
    const first = q();
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: first, correct: false, fleeChoice: "retry" });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[1], questionId: room.game!.teams[1].currentQuestionId, correct: false, fleeChoice: "retry" });
    expect(room.game!.currentTurnIndex).toBe(0);
    expect(q()).toBe(first);
    passChecks(room);
    send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: first, text: "late", eventId: before });
    expect(err(conns[0])).toBe("stale_event");
    expect(room.game!.teams[0].typedAnswer).toBeUndefined();
    passChecks(room);
    send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: first, text: "now", eventId: seqOf(room) });
    expect(room.game!.teams[0].typedAnswer).toBe("now");
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: first, correct: false, fleeChoice: "retry" });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[1], questionId: room.game!.teams[1].currentQuestionId, correct: false, fleeChoice: "retry" });
    submit("old build");
    expect(room.game!.teams[0].typedAnswer).toBe("old build");
  });

  // Value: protects=a multipleChoice question cannot get a typed answer (AC3); fails_when=the kind check goes;
  // no_claim=the phone never shows the box there (play page).
  it("refuses a multipleChoice question", () => {
    const mcBank = parseBank({
      rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [{ kind: "multipleChoice", id: "r0-mc1", content: { kind: "text", value: "？" }, options: ["a", "b"], correctIndex: 0 }] }],
      boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
    });
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: mcBank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { conns } = joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    passChecks(room);
    send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: "r0-mc1", text: "a" });
    expect(err(conns[0])).toBe("not_text_question");
  });

  // Value: protects=a warrior cannot roll on a sent answer, nor send during its roll (AC6, AC7a);
  // fails_when=the roll spends a use after the host saw the text, or text lands during the beat;
  // no_claim=the thief (game-state test covers armSneak).
  it("refuses the warrior's roll after a send, and a send during the roll", () => {
    vi.useFakeTimers();
    const sent = game(true);
    sent.submit("x");
    sent.rollFor(20);
    expect(err(sent.conns[0])).toBe("answer_submitted");
    expect(sent.room.game!.teams[0].abilityUses).toBe(4);
    const rolling = game(true);
    rolling.rollFor(20);
    rolling.submit("x");
    expect(err(rolling.conns[0])).toBe("roll_pending");
    expect(rolling.room.game!.teams[0].typedAnswer).toBeUndefined();
  });
});

describe("monster dishes (docs/designs/monster-cuisine.md)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const states = (room: DungeonRoom) => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE");
  /** A room on `bank` whose narrator records every event it is asked to tell. */
  function cookRoom(bank: Bank = BANK, classId?: ClassId) {
    const events: any[] = [];
    const spy = { name: "spy", narrate: async (e: any) => (events.push(e), "一行") };
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank, provider: spy, holdMs: 30, epilogueDelayMs: 0 });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, 1);
    if (classId) send(room, conns[0], { type: "TEAM_PICK_CLASS", classId });
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids, events };
  }
  const ROOM0_DISH = catalogMonster(BANK.rooms[0].monster).dish.name;
  /** The bank with one fill-in answer (not r0-q1's) renamed to room 0's dish, so the dish names an answer. */
  const withAnswerAsRoom0Dish = (): Bank => {
    const [d, i] = DIFFICULTIES.flatMap((d) => BANK.pools[d].map((q, i) => [d, i, q] as const)).find(([, , q]) => q.kind === "text" && q.id !== "r0-q1")!;
    return { ...BANK, pools: { ...BANK.pools, [d]: BANK.pools[d].map((q, j) => (j === i ? { ...q, answer: ROOM0_DISH } : q)) } };
  };

  it("a correct answer reveals the room monster's dish with the points it earned, and STATE says 飽足感", async () => {
    const { room, hostConn, ids, events } = cookRoom();
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    await flush();
    const last = states(room).at(-1);
    expect(last.cuisine).toBe(true);
    const m = catalogMonster(BANK.rooms[0].monster);
    expect(last.reveal.dish).toEqual({ ...m.dish, points: 10, monster: { id: m.id, name: m.name, sprite: m.sprite, hue: m.hue }, room: 0, teamId: ids[0] });
    expect(last.reveal.served).toBeUndefined();
    // The narrator hears that it will be cooked, never what into (cooking I1): the dish line waits for 上菜.
    const told = events.find((e) => e.type === "correct");
    expect(told.cooked).toBe(true);
    expect(JSON.stringify(told)).not.toContain(m.dish.name);
  });

  // Value: protects=the chef's share reaching the dish card (chef design D5); fails_when=the room drops chefBonus.
  it("a chef's dish carries its share of the points", async () => {
    const { room, hostConn, ids } = cookRoom(BANK, "chef");
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    await flush();
    expect(states(room).at(-1).reveal.dish).toMatchObject({ points: 12, chefBonus: 2 }); // pregate-literal: WARRIOR_TARGET=12 not the warrior target
  });

  it("a team with no class gets no chefBonus on its dish", async () => {
    const { room, hostConn, ids } = cookRoom();
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    await flush();
    expect(states(room).at(-1).reveal.dish).not.toHaveProperty("chefBonus");
  });

  describe("🍲 上菜 (HOST_SERVE, cooking R5/I2)", () => {
    function served(now: { t: number }) {
      const events: any[] = [];
      const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: BANK, provider: { name: "spy", narrate: async (e: any) => (events.push(e), "一行") }, holdMs: 30, now: () => now.t });
      const hostConn = makeConn("host-conn");
      room.onConnect(hostConn);
      claim(room, hostConn);
      const { ids } = joinTeams(room, hostConn, 1);
      send(room, hostConn, { type: "HOST_START" });
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
      return { room, hostConn };
    }

    it("下一題 does nothing until the dish is served and has been up for SERVE_HOLD_MS", () => {
      const now = { t: 1000 };
      const { room, hostConn } = served(now);
      const eventId = seqOf(room);
      send(room, hostConn, { type: "HOST_NEXT", eventId });
      expect(states(room).at(-1).reveal).not.toBeNull();
      send(room, hostConn, { type: "HOST_SERVE", eventId });
      const after = states(room).at(-1);
      expect(after.reveal.served).toBe(true);
      expect(after.cue).toBe("cook");
      now.t += SERVE_HOLD_MS - 1;
      send(room, hostConn, { type: "HOST_NEXT", eventId });
      expect(states(room).at(-1).reveal).not.toBeNull();
      now.t += 1;
      send(room, hostConn, { type: "HOST_NEXT", eventId });
      expect(states(room).at(-1).reveal).toBeNull();
    });

    it("a second press, a stale eventId or a non-host serves nothing more", () => {
      const now = { t: 0 };
      const { room, hostConn } = served(now);
      const eventId = seqOf(room);
      const stranger = makeConn("stranger");
      room.onConnect(stranger);
      send(room, stranger, { type: "HOST_SERVE", eventId });
      send(room, hostConn, { type: "HOST_SERVE", eventId: eventId - 1 });
      expect(states(room).at(-1).reveal.served).toBeUndefined();
      send(room, hostConn, { type: "HOST_SERVE", eventId });
      const count = states(room).length;
      const seq = states(room).at(-1).cueSeq;
      now.t += 1000;
      send(room, hostConn, { type: "HOST_SERVE", eventId }); // a second host device: the hold does not restart
      expect(states(room)).toHaveLength(count);
      now.t += SERVE_HOLD_MS - 1000;
      send(room, hostConn, { type: "HOST_NEXT", eventId });
      expect(states(room).at(-1).reveal).toBeNull();
      expect(states(room).at(-1).cueSeq).toBe(seq);
    });
  });

  // Value: protects=with randomMonsters every reader uses the drawn monsters (question, dish served, boss look, boss dish), and a save naming no catalog boss falls back to the bank's; fails_when=any call site reads bank.rooms[].monster or bank.boss.monster again, or bossId trusts a bad save; why_new=owner 2026-11-07 (每場隨機抽怪); seam=none; no_claim=rendering
  it("a randomMonsters game uses the drawn monsters everywhere, not the bank's", () => {
    // The constant rng draws the catalog's first boss (dragon), so the bank names another to tell them apart.
    const bank: Bank = { ...BANK, randomMonsters: true, boss: { ...BANK.boss, monster: "kraken" } };
    const { room, hostConn } = cookRoom(bank);
    const drawn = catalogMonster(room.game!.rooms[0].monsterId!);
    expect(room.game!.bossMonsterId).toBe("dragon");
    expect((room as any).bossLook().id).toBe("dragon");
    expect(room.game!.boss.dish).toBe(catalogMonster("dragon").dish.name);
    expect(states(room).at(-1).question.monster.id).toBe(drawn.id);
    // Every bank room names another monster from here on, so a dish read from the bank would differ.
    const other = MONSTERS.find((m) => !m.boss && m.id !== drawn.id)!.id;
    (room as any).bank = { ...bank, rooms: bank.rooms.map((r) => ({ ...r, monster: other })) };
    const t = room.game!.teams[0];
    send(room, hostConn, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true });
    expect(states(room).at(-1).reveal.dish.name).toBe(drawn.dish.name);
    room.game = { ...room.game!, bossMonsterId: "not-a-boss" };
    expect((room as any).bossLook().id).toBe("kraken");
  });

  // Value: protects=the room passes this game's defeats into STATE: the slime's second appearance (room 3) wears a variant and the reveal keeps the plain look it was defeated in; fails_when=currentQuestion builds the question without the game's defeats or seed; why_new=new wiring (monster-catalog.md §3); seam=none; no_claim=rendering
  it("a room monster met again wears its next variant on STATE", () => {
    // The shipped bank has eight different monsters, so repeat three here: room 3 meets room 0's again.
    const bank: Bank = { ...BANK, rooms: BANK.rooms.map((r, i) => ({ ...r, monster: ["slime-soft", "ghost-shy", "ghost-cry"][i % 3] })) };
    const { room, hostConn } = cookRoom(bank);
    const slime = catalogMonster(bank.rooms[0].monster);
    for (let i = 0; i < 3; i++) {
      if (i > 0) serveNext(room, hostConn, seqOf(room));
      const t = room.game!.teams[0];
      send(room, hostConn, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true });
    }
    expect(states(room).at(-1).reveal.dish.monster).toEqual({ id: "ghost-cry", name: "愛哭幽靈", sprite: "ghost-cry", hue: 0 });
    serveNext(room, hostConn, seqOf(room));
    expect(bank.rooms[3].monster).toBe(slime.id);
    const v = variantOf(room.game!.variantSeed!, slime, 1)!;
    expect(states(room).at(-1).question.monster).toEqual({ id: slime.id, name: v.title + slime.name, sprite: slime.sprite, hue: v.hueShift, accessory: v.accessory });
  });

  // Value: protects=STATE draws the team's monster from the count it walked in with, not from defeats other teams made since, and falls back to the game-wide count for a save without one; fails_when=currentQuestion reads only game.defeats, or ignores it when metDefeats is absent; why_new=owner 2026-11-07 (look fixed per room); seam=none; no_claim=rendering
  it("keeps a team's monster as it walked in, whatever other teams defeat", () => {
    const { room } = cookRoom();
    const slime = catalogMonster(BANK.rooms[0].monster);
    room.game = { ...room.game!, defeats: { [slime.id]: 2 } };
    (room as any).broadcastState();
    expect(states(room).at(-1).question.monster).toEqual({ id: slime.id, name: slime.name, sprite: slime.sprite, hue: slime.hue });
    room.game = { ...room.game!, teams: room.game!.teams.map((t) => ({ ...t, metDefeats: undefined })) };
    (room as any).broadcastState();
    expect(states(room).at(-1).question.monster.accessory).toBe(variantOf(room.game!.variantSeed!, slime, 2)!.accessory);
  });

  // Value: protects=a reveal with no dish can't be served (no STATE, no cook cue), the case a game saved before dishes still hits; fails_when=handleHostServe's no-dish guard goes; why_new=replaces the retired "bank with no dishes" test, since every catalog monster has a dish; seam=none; no_claim=the TV's frames
  it("a wrong answer reveals no dish, and 🍲 上菜 on it does nothing", () => {
    const { room, hostConn, ids } = cookRoom();
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: false });
    expect(states(room).at(-1).reveal).toBeNull();
    expect(room.game!.teams[0].dishes).toBeUndefined();
    const count = states(room).length;
    send(room, hostConn, { type: "HOST_SERVE", eventId: seqOf(room) });
    expect(states(room)).toHaveLength(count);
    expect(states(room).at(-1).cue).not.toBe("cook");
  });

  it("a dish named after a bank answer is shown on screen but never told to the narrator", async () => {
    const answer = ROOM0_DISH;
    const { room, hostConn, ids, events } = cookRoom(withAnswerAsRoom0Dish());
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    await flush();
    expect(states(room).at(-1).reveal.dish.name).toBe(answer);
    expect(JSON.stringify(events.find((e) => e.type === "correct"))).not.toContain(answer);
  });

  // Review finding (coverage audit, 2026-10-31): the boss branch of the dish lookup and the epilogue filter had no room-level test.
  it("the killing blow serves the boss's dish, and the epilogue lists the team's dishes without one naming an answer", async () => {
    const answer = ROOM0_DISH;
    const { room, hostConn, events } = cookRoom(withAnswerAsRoom0Dish());
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) {
      const g = room.game!;
      const t = g.teams[0];
      serveNext(room, hostConn, seqOf(room));
      send(room, hostConn, { type: "HOST_JUDGE", teamId: t.id, questionId: t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId, correct: true });
      landKill(room);
    }
    await new Promise((r) => setTimeout(r, 50));
    const boss = catalogMonster(BANK.boss.monster).dish;
    expect(states(room).at(-1).reveal.dish).toMatchObject({ name: boss.name, part: boss.part });
    expect(states(room).at(-1).reveal.dish).toMatchObject({ room: null, monster: { name: catalogMonster(BANK.boss.monster).name } });
    expect(events.find((e) => e.type === "boss-kill")?.cooked).toBe(true);
    const epilogue = events.find((e) => e.type === "epilogue");
    expect(epilogue.ranking[0].dishes).toContain(boss.name);
    expect(epilogue.ranking[0].dishes).not.toContain(answer);
    expect(room.game!.teams[0].dishes).toContain(answer); // eaten all the same, just never told
  });

  it("after the boss kill ends the game, 上菜 and 下一題 change nothing: the finished screen cooks on its own (cooking R8)", () => {
    const { room, hostConn } = cookRoom();
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) {
      const g = room.game!;
      const t = g.teams[0];
      serveNext(room, hostConn, seqOf(room));
      send(room, hostConn, { type: "HOST_JUDGE", teamId: t.id, questionId: t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId, correct: true });
      landKill(room);
    }
    expect(room.game!.phase).toBe("finished");
    const count = states(room).length;
    const eventId = seqOf(room);
    send(room, hostConn, { type: "HOST_SERVE", eventId });
    (room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(room, hostConn, { type: "HOST_NEXT", eventId });
    expect(states(room)).toHaveLength(count);
    expect(states(room).at(-1).reveal.dish).toMatchObject({ room: null });
    expect(states(room).at(-1).reveal.served).toBeUndefined();
  });
});

describe("host controls: HOST_END_GAME, HOST_REMOVE_TEAM, HOST_RENAME_TEAM", () => {
  const broadcasts = (room: DungeonRoom) => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));

  it("結束冒險 ends a game in play, ranked by reward, with no final blow and an epilogue that keeps the boss alive", async () => {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { epilogueDelayMs: 0, holdMs: 10 });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids } = joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    const first = currentTurnTeamId(room.game!)!;
    const q = room.game!.teams.find((t) => t.id === first)!.currentQuestionId;
    send(room, hostConn, { type: "HOST_JUDGE", teamId: first, questionId: q, correct: true, fleeChoice: "retry" });
    send(room, hostConn, { type: "HOST_END_GAME" });
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.winners).toEqual([first]);
    expect(room.game!.boss.killedByTeamId).toBeNull();
    const all = broadcasts(room);
    expect(all.some((m) => m.type === "GAME_OVER" && m.winners[0] === first)).toBe(true);
    // The reveal from the judgment just before is dropped: the podium comes up at once.
    expect(all.filter((m) => m.type === "STATE").at(-1).reveal).toBeNull();
    await vi.waitFor(() => expect(broadcasts(room).some((m) => m.type === "EPILOGUE")).toBe(true));
    expect(ids).toContain(first);
    // Once over, it cannot be ended again.
    send(room, hostConn, { type: "HOST_END_GAME" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "no_active_game" });
  });

  // Regression: a long epilogue grew the narrator box over the podium's 2nd and 3rd places (/qa on production,
  // 2026-11-08). It is now split into pages that the host turns.
  it("the host turns a long epilogue's pages one at a time; a player cannot, and 回到大廳 starts over at page 1", async () => {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { epilogueDelayMs: 0, holdMs: 10 });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { conns } = joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    send(room, hostConn, { type: "HOST_END_GAME" });
    await vi.waitFor(() => expect(broadcasts(room).some((m) => m.type === "EPILOGUE")).toBe(true));
    const lastState = () => broadcasts(room).filter((m) => m.type === "STATE").at(-1);
    (room as any).epilogue = "甲".repeat(100) + "。" + "乙".repeat(100) + "。"; // two pages
    send(room, hostConn, { type: "HOST_EPILOGUE_PAGE", page: 1 });
    expect(lastState().epiloguePage).toEqual({ page: 1, of: 2 });
    send(room, hostConn, { type: "HOST_EPILOGUE_PAGE", page: 2 }); // past the last page: dropped
    send(room, hostConn, { type: "HOST_EPILOGUE_PAGE", page: 3 });
    expect(lastState().epiloguePage).toEqual({ page: 1, of: 2 });
    send(room, conns[0], { type: "HOST_EPILOGUE_PAGE", page: 0 }); // a phone is not the host
    expect(lastState().epiloguePage).toEqual({ page: 1, of: 2 });
    send(room, hostConn, { type: "HOST_EPILOGUE_PAGE", page: 0 });
    expect(lastState().epiloguePage).toEqual({ page: 0, of: 2 });
    send(room, hostConn, { type: "HOST_EPILOGUE_PAGE", page: 1 });
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    expect((room as any).epiloguePage).toBe(0);
  });

  // Value: protects=every finished game reaches the owner's log, and a failing store never breaks the room;
  // fails_when=logGame is not called on 結束冒險, or its rejection escapes
  it("結束冒險 hands the game's log over once, and a store that fails leaves the room playing on", async () => {
    const logGame = vi.fn(() => Promise.reject(new Error("bank DO down")));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const room = new DungeonRoom({ ...(makeRoom() as any), logGame }, () => 0, { epilogueDelayMs: 0, holdMs: 10 });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    const first = currentTurnTeamId(room.game!)!;
    const q = room.game!.teams.find((t) => t.id === first)!.currentQuestionId;
    send(room, hostConn, { type: "HOST_JUDGE", teamId: first, questionId: q, correct: true, fleeChoice: "retry" });
    send(room, hostConn, { type: "HOST_END_GAME" });
    expect(logGame).toHaveBeenCalledTimes(1);
    expect(logGame.mock.calls[0]).toMatchObject([{ endedBy: "host", rounds: 1, teams: [{ name: "Team 0" }, { name: "Team 1" }] }]);
    expect((logGame.mock.calls[0] as unknown[])[0]).toMatchObject({ startedAt: expect.any(String) });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("game_log_failed")));
    await vi.waitFor(() => expect(broadcasts(room).some((m) => m.type === "EPILOGUE")).toBe(true));
    error.mockRestore();
  });

  // Value: protects=starting and ending at once cannot fill the owner's log with empty games;
  // fails_when=a game with no turn played is logged
  it("結束冒險 before any turn is played logs nothing", () => {
    const logGame = vi.fn();
    const room = new DungeonRoom({ ...(makeRoom() as any), logGame }, () => 0, { epilogueDelayMs: 0, holdMs: 10 });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    send(room, hostConn, { type: "HOST_END_GAME" });
    expect(room.game!.phase).toBe("finished");
    expect(logGame).not.toHaveBeenCalled();
  });

  it("結束冒險 is host-only and needs a game", () => {
    const { room, hostConn } = makeRoomWithHost();
    send(room, hostConn, { type: "HOST_END_GAME" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "no_active_game" });
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    const other = makeConn("not-host");
    send(room, other, { type: "HOST_END_GAME" });
    expect(lastSentTo(other)).toMatchObject({ type: "ERROR", error: "not_host" });
    expect(room.game!.phase).toBe("playing");
  });

  it("移除 takes a lobby team out, tells its phone, and lets a fresh JOIN from that phone back in", () => {
    const { room, hostConn } = makeRoomWithHost();
    const phone = makeConn("phone");
    room.onConnect(phone);
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "加錯的" });
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_REMOVE_TEAM", teamId: T1 });
    expect(lastSentTo(phone)).toMatchObject({ type: "ERROR", error: "team_removed" });
    expect(lastBroadcast(room)).toMatchObject({ type: "LOBBY" });
    expect(lastBroadcast(room).teams.map((t: { id: string }) => t.id)).toEqual([T2]);
    // Its old key is forgotten too, so going home and joining again is a new team, with any key.
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: KEY2, teamName: "重新加入" });
    expect(lastBroadcast(room).teams.map((t: { name: string }) => t.name)).toEqual(["Team 1", "重新加入"]);
  });

  it("a removed phone's automatic reconnect is turned away, but opening the room again joins", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 2);
    // The phone was asleep when the host removed it, so no team_removed reached it.
    send(room, hostConn, { type: "HOST_REMOVE_TEAM", teamId: T1 });
    const woke = makeConn("woke");
    room.onConnect(woke);
    send(room, woke, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Team 0", resume: true });
    expect(lastSentTo(woke)).toMatchObject({ type: "ERROR", error: "team_removed" });
    expect(lastBroadcast(room).teams.map((t: { id: string }) => t.id)).toEqual([T2]);
    send(room, woke, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "Team 0" });
    expect(lastBroadcast(room).teams.map((t: { id: string }) => t.id)).toEqual([T2, T1]);
  });

  it("改名 renames a lobby team, refusing an empty name and another team's name", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_RENAME_TEAM", teamId: T1, teamName: "  紅隊  " });
    expect(lastBroadcast(room).teams[0].name).toBe("紅隊");
    send(room, hostConn, { type: "HOST_RENAME_TEAM", teamId: T2, teamName: "紅隊" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_name", detail: "duplicate_name" });
    send(room, hostConn, { type: "HOST_RENAME_TEAM", teamId: T2, teamName: "   " });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_name" });
    send(room, hostConn, { type: "HOST_RENAME_TEAM", teamId: T3, teamName: "藍隊" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "unknown_team" });
    expect(lastBroadcast(room).teams[1].name).toBe("Team 1");
  });

  it("移除 and 改名 are host-only and lobby-only", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    const other = makeConn("not-host");
    send(room, other, { type: "HOST_REMOVE_TEAM", teamId: T1 });
    expect(lastSentTo(other)).toMatchObject({ type: "ERROR", error: "not_host" });
    send(room, other, { type: "HOST_RENAME_TEAM", teamId: T1, teamName: "x" });
    expect(lastSentTo(other)).toMatchObject({ type: "ERROR", error: "not_host" });
    send(room, hostConn, { type: "HOST_START" });
    send(room, hostConn, { type: "HOST_REMOVE_TEAM", teamId: T1 });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "game_already_started" });
    send(room, hostConn, { type: "HOST_RENAME_TEAM", teamId: T1, teamName: "x" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "game_already_started" });
    expect(room.game!.teams).toHaveLength(1);
  });
});

describe("HOST_BACK_TO_LOBBY (回到大廳)", () => {
  const broadcasts = (room: DungeonRoom) => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));

  function finished() {
    const room = new DungeonRoom(makeRoom() as any, () => 0, { epilogueDelayMs: 0, holdMs: 10 });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const phone = makeConn("phone");
    room.onConnect(phone);
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "甲隊" });
    send(room, phone, { type: "TEAM_PICK_CLASS", classId: "mage" });
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    const team = currentTurnTeamId(room.game!)!;
    const q = room.game!.teams.find((t) => t.id === team)!.currentQuestionId;
    send(room, hostConn, { type: "HOST_JUDGE", teamId: team, questionId: q, correct: true, fleeChoice: "retry" });
    send(room, hostConn, { type: "HOST_END_GAME" });
    return { room, hostConn, phone, answered: q };
  }

  it("brings a finished game back to the lobby with the same teams and classes, and another game can start", () => {
    const { room, hostConn, answered } = finished();
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    expect(room.game).toBeNull();
    const lobby = lastBroadcast(room);
    expect(lobby).toMatchObject({ type: "LOBBY" });
    expect(lobby.teams).toEqual([{ id: T1, name: "甲隊", classId: "mage" }, { id: T2, name: "Team 1" }]);
    send(room, hostConn, { type: "HOST_START" });
    expect(room.game!.phase).toBe("playing");
    expect(room.game!.teams.every((t) => t.reward === 0 && t.roomIndex === 0)).toBe(true);
    // The question whose answer the first game showed is not dealt again while others are left.
    expect(room.game!.teams.map((t) => t.currentQuestionId)).not.toContain(answered);
  });

  it("is host-only and only after the game is over", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "game_not_over" });
    send(room, hostConn, { type: "HOST_START" });
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "game_not_over" });
    send(room, hostConn, { type: "HOST_END_GAME" });
    const other = makeConn("not-host");
    send(room, other, { type: "HOST_BACK_TO_LOBBY" });
    expect(lastSentTo(other)).toMatchObject({ type: "ERROR", error: "not_host" });
    expect(room.game!.phase).toBe("finished");
  });

  it("a queued 下一句 still riding a slow line when the game ends is not said in the next game", async () => {
    const pending: ((line: string) => void)[] = [];
    const slow = { name: "slow", narrate: () => new Promise<string>((resolve) => pending.push(resolve)) };
    const room = new DungeonRoom(makeRoom() as any, () => 0, { epilogueDelayMs: 0, holdMs: 5000, provider: slow });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    const team = currentTurnTeamId(room.game!)!;
    const q = room.game!.teams.find((t) => t.id === team)!.currentQuestionId;
    send(room, hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: team, questionId: q, correct: true, fleeChoice: "retry" }); // carries the line, still out
    send(room, hostConn, { type: "HOST_END_GAME" });
    await new Promise((r) => setTimeout(r, 0));
    pending[1]?.("晚到的一行");
    await new Promise((r) => setTimeout(r, 0));
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    expect((room as unknown as { nextLine: unknown }).nextLine).toBeNull();
    expect(lastSentTo(hostConn)).toMatchObject({ type: "HOST_NEXT_LINE_STATE", line: "" });
  });

  it("a late epilogue from the game just left never reaches the lobby, nor a newcomer", async () => {
    const { room, hostConn } = finished();
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    await new Promise((r) => setTimeout(r, 50));
    expect(broadcasts(room).filter((m) => m.type === "EPILOGUE")).toHaveLength(0);
    const late = makeConn("late");
    room.onConnect(late);
    const msgs = (late.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs.map((m) => m.type)).toEqual(["LOBBY"]);
  });

  it("the phones still belong to their teams: a class pick in the new lobby counts", () => {
    const { room, hostConn, phone } = finished();
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    send(room, phone, { type: "TEAM_PICK_CLASS", classId: "warrior" });
    expect(lastBroadcast(room).teams[0]).toMatchObject({ id: T1, classId: "warrior" });
  });
});

describe("team handoff: HOST_HANDOFF, TEAM_CLAIM (docs/designs/team-handoff.md)", () => {
  /** A game with two teams, T1's phone gone, and a clock the test moves. */
  function gameWithLostPhone() {
    const clock = { t: 1_000 };
    const room = new DungeonRoom(makeRoom() as any, () => 0, { now: () => clock.t });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { conns } = joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_START" });
    room.onClose(conns[0]);
    const fresh = makeConn("new-phone");
    room.onConnect(fresh);
    return { room, hostConn, fresh, clock };
  }
  const codeFor = (room: DungeonRoom, hostConn: ReturnType<typeof makeConn>, teamId: string) => {
    send(room, hostConn, { type: "HOST_HANDOFF", teamId });
    return lastSentTo(hostConn).code as string;
  };

  // Value: protects=a team whose phone died gets back into the game on a new phone; fails_when=the claim does not
  // hand over the team's id and key, or the JOIN with them does not bind and set the team online; why_new=no
  // recovery path existed; seam=none
  it("hands the team to a new phone: the code goes to the host only, and a JOIN with the claimed id plays as the team", () => {
    const { room, hostConn, fresh } = gameWithLostPhone();
    send(room, fresh, { type: "JOIN", teamId: T3, teamKey: KEY2, teamName: "x" });
    expect(lastSentTo(fresh)).toMatchObject({ type: "ERROR", error: "game_already_started" });
    const code = codeFor(room, hostConn, T1);
    expect(code).toMatch(/^\d{4}$/);
    expect(JSON.stringify((room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(`"code":"${code}"`);
    send(room, fresh, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(fresh)).toEqual({ type: "TEAM_CLAIMED", teamId: T1, teamKey: KEY });
    send(room, fresh, { type: "JOIN", teamId: T1, teamKey: KEY, teamName: "x" });
    expect(lastBroadcast(room).view.teams.find((t: any) => t.id === T1).online).toBe(true);
    // One use: the same code again is refused.
    const other = makeConn("other-phone");
    send(room, other, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(other)).toMatchObject({ type: "ERROR", error: "bad_code" });
  });

  // Value: protects=a code cannot be used late or after a newer one; fails_when=expiry, replacement or the host check
  // is dropped; why_new=new security boundary; seam=none
  it("refuses an expired or replaced code, and only a host may ask for a code", () => {
    const { room, hostConn, fresh, clock } = gameWithLostPhone();
    send(room, fresh, { type: "HOST_HANDOFF", teamId: T1 });
    expect(lastSentTo(fresh)).toMatchObject({ type: "ERROR", error: "not_host" });
    send(room, hostConn, { type: "HOST_HANDOFF", teamId: T3 });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "unknown_team" });

    let code = codeFor(room, hostConn, T1);
    clock.t += 5 * 60 * 1000;
    send(room, fresh, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(fresh)).toMatchObject({ type: "ERROR", error: "bad_code" });

    // A new code for the team replaces the old one.
    const first = codeFor(room, hostConn, T1);
    code = codeFor(room, hostConn, T1);
    if (first !== code) {
      send(room, fresh, { type: "TEAM_CLAIM", code: first });
      expect(lastSentTo(fresh)).toMatchObject({ type: "ERROR", error: "bad_code" });
    }
    send(room, fresh, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(fresh)).toMatchObject({ type: "TEAM_CLAIMED", teamId: T1 });
  });

  // Value: protects=4 digits cannot be brute-forced (D4); fails_when=the burn after 5 wrong claims is dropped, or a
  // claim made while no code is live uses up a later code's guesses; why_new=new security boundary; seam=none
  it("burns live codes on the 5th wrong claim; claims made while no code is live do not count", () => {
    const { room, hostConn, fresh } = gameWithLostPhone();
    for (let i = 0; i < 3; i++) send(room, fresh, { type: "TEAM_CLAIM", code: "0000" });
    let code = codeFor(room, hostConn, T1);
    const wrong = code === "0000" ? "0001" : "0000";
    for (let i = 0; i < 4; i++) send(room, fresh, { type: "TEAM_CLAIM", code: wrong });
    send(room, fresh, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(fresh)).toMatchObject({ type: "TEAM_CLAIMED", teamId: T1 });
    code = codeFor(room, hostConn, T2);
    for (let i = 0; i < 5; i++) send(room, fresh, { type: "TEAM_CLAIM", code: code === "0000" ? "0001" : "0000" });
    send(room, fresh, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(fresh)).toMatchObject({ type: "ERROR", error: "bad_code" });
  });

  // Value: protects=an expired code's wrong guesses do not burn the next code, and a playing phone cannot claim a second
  // team (its first would stay marked online); fails_when=expired codes are not pruned, or a bound connection may claim;
  // why_new=/review pass 2; seam=injected clock
  it("forgets an expired code's wrong guesses, and refuses a claim from a phone already in a team", () => {
    const { room, hostConn, fresh, clock } = gameWithLostPhone();
    let code = codeFor(room, hostConn, T1);
    const wrongFor = (c: string) => (c === "0000" ? "0001" : "0000");
    for (let i = 0; i < 4; i++) send(room, fresh, { type: "TEAM_CLAIM", code: wrongFor(code) });
    clock.t += 5 * 60 * 1000;
    code = codeFor(room, hostConn, T1);
    send(room, fresh, { type: "TEAM_CLAIM", code: wrongFor(code) });
    send(room, fresh, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(fresh)).toMatchObject({ type: "TEAM_CLAIMED", teamId: T1 });

    const playing = makeConn("t2-phone");
    send(room, playing, { type: "JOIN", teamId: T2, teamKey: KEY, teamName: "x" });
    code = codeFor(room, hostConn, T1);
    send(room, playing, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(playing)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "already_in_team" });
  });

  // Value: protects=a handoff code dies with its game; fails_when=handleBackToLobby stops clearing handoffs, so an old
  // code claims a team in the next game; why_new=no test ends a game with a live code; seam=none; no_claim=none beyond protects
  it("a code from a finished game is refused in the next game", () => {
    const { room, hostConn, fresh } = gameWithLostPhone();
    const code = codeFor(room, hostConn, T1);
    send(room, hostConn, { type: "HOST_END_GAME" });
    send(room, hostConn, { type: "HOST_BACK_TO_LOBBY" });
    send(room, hostConn, { type: "HOST_START" });
    send(room, fresh, { type: "TEAM_CLAIM", code });
    expect(lastSentTo(fresh)).toMatchObject({ type: "ERROR", error: "bad_code" });
  });

  it("answers no_active_game in the lobby", () => {
    const { room, hostConn } = makeRoomWithHost();
    joinTeams(room, hostConn, 2);
    send(room, hostConn, { type: "HOST_HANDOFF", teamId: T1 });
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "no_active_game" });
  });
});

// Value: protects=the sort question's room flow: items go out shuffled and never in the answer's order, a lock is
// judged on 公布答案 only when all four places are right, a wrong lock shows which places are right but not the answer,
// the host cannot press 答對, and the mage names the first item; fails_when=the order leaks before the answer, a
// partial order scores, wrongSlots is wrong or missing, or a wrong order can be locked twice; seam=none;
// no_claim=the phone's drag (pointer events, e2e)
describe("sort questions", () => {
  afterEach(() => vi.useRealTimers());
  const sortBank = parseBank({
    rooms: [
      {
        monster: "slime-soft",
        baseDifficulty: 1, reward: 10,
        questions: [{ kind: "sort", id: "r0-s1", content: { kind: "text", value: "依字母排" }, items: ["A", "B", "C", "D"] }],
      },
    ],
    boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
  });
  // rng 0 keeps the bank order, which a sort question never shows: it is reversed, D C B A.
  const RIGHT = sortCode([3, 2, 1, 0]);
  const HALF = sortCode([3, 2, 0, 1]); // A B right, then D C

  function sortGame(classId?: string, die?: number) {
    vi.useFakeTimers();
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: sortBank, fixedDie: die });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { conns } = joinTeams(room, hostConn, 1);
    if (classId) send(room, conns[0], { type: "TEAM_PICK_CLASS", classId });
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, conns };
  }
  const lockOrder = (room: DungeonRoom, conn: ReturnType<typeof makeConn>, code: number) => {
    send(room, conn, { type: "TEAM_SELECT_OPTION", questionId: "r0-s1", optionIndex: code });
    send(room, conn, { type: "TEAM_LOCK_OPTION", questionId: "r0-s1", optionIndex: code });
    reveal(room);
    vi.advanceTimersByTime(2000);
  };

  it("sends the items shuffled, without the answer", () => {
    const { room } = sortGame();
    const state = lastBroadcast(room);
    expect(state.question.items).toEqual(["D", "C", "B", "A"]);
    expect(JSON.stringify(state)).not.toContain("A → B");
  });

  it("a wrong order shows which places are right, never the answer, and cannot be locked again", () => {
    const { room, conns } = sortGame();
    lockOrder(room, conns[0], HALF);
    expect(room.game!.pendingWrong).toMatchObject({ teamId: T1, optionIndex: HALF });
    const state = lastBroadcast(room);
    expect(state.wrongSlots).toEqual([true, true, false, false]);
    expect(state.reveal).toBeNull();
    send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "r0-s1", choice: "retry" });
    expect(lastBroadcast(room).wrongSlots).toBeUndefined();
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-s1", optionIndex: HALF });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
  });

  it("the right order rolls the crit die, then scores and reveals the order", () => {
    const { room, conns } = sortGame();
    lockOrder(room, conns[0], RIGHT);
    expect((room as any).pendingRoll).toMatchObject({ kind: "crit" });
    vi.advanceTimersByTime(2000);
    expect(room.game!.teams[0].reward).toBeGreaterThan(0);
    expect(lastBroadcast(room).reveal).toMatchObject({ answer: "A → B → C → D", sorted: { items: ["A", "B", "C", "D"], teamId: T1 } });
  });

  it("refuses an order code out of range and the host's 答對", () => {
    const { room, hostConn, conns } = sortGame();
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: "r0-s1", optionIndex: 24 });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: T1, questionId: "r0-s1", correct: true });
    expect(lastSentTo(hostConn)).toMatchObject({ detail: "auto_judged" });
  });

  it("a flee after a wrong order clears the marks and reveals nothing", () => {
    const { room, conns } = sortGame();
    lockOrder(room, conns[0], HALF);
    send(room, conns[0], { type: "TEAM_WRONG_CHOICE", questionId: "r0-s1", choice: "flee" });
    expect(room.game!.pendingWrong).toBeFalsy();
    const state = lastBroadcast(room);
    expect(state.wrongSlots).toBeUndefined();
    expect(state.reveal?.sorted).toBeUndefined();
  });

  it("a cleric's prayer keeps the marks up and the turn", () => {
    const { room, conns } = sortGame("cleric");
    lockOrder(room, conns[0], HALF);
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-s1" });
    expect(room.game!.pendingWrong).toMatchObject({ prayed: true });
    expect(lastBroadcast(room).wrongSlots).toEqual([true, true, false, false]);
  });

  it("a warrior's 20 answers it, crits and reveals the order", () => {
    const { room, conns } = sortGame("warrior", 20);
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-s1" });
    expect((room as any).pendingRoll).toMatchObject({ kind: "warrior", value: 20 });
    vi.advanceTimersByTime(2000);
    expect(room.game!.teams[0].reward).toBe(15); // 10, plus half for the 20 (critable like multiple choice)
    expect(lastBroadcast(room).reveal).toMatchObject({ sorted: { items: ["A", "B", "C", "D"], teamId: T1 } });
  });

  it("the mage names the first item", () => {
    const { room, conns } = sortGame("mage");
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-s1" });
    expect(room.game!.mageHints?.["r0-s1"]).toBe("A");
  });
});
