/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { answerText, bossPhaseStates, findQuestion, parseBank, roomTemplates, type Bank } from "../question-bank";
import { BANK } from "../question-bank-data";
// Room tests judge turns with HOST_JUDGE, so they play the bundled bank as text questions.
vi.mock("../question-bank-data", async (actual) => {
  const { asTextBank } = await import("../text-bank");
  return { BANK: asTextBank((await actual<typeof import("../question-bank-data")>()).BANK) };
});
import { currentTurnTeamId } from "../game-state";
import { EPILOGUE_MODEL } from "../narration/llm";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const T3 = "00000000-0000-0000-0000-000000000003";
const BAD_ID = "not-a-uuid";
/** A team's secret: only the client that created the team knows it. */
const KEY = "team-key-0123456789abcdef";
const KEY2 = "another-key-0123456789abcd";
/** A host's pasted Anthropic key (fake, but in the right format). */
const HOST_KEY = "sk-ant-test-HOSTKEY-0123456789abcdefWXYZ";

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

function send(room: DungeonRoom, conn: ReturnType<typeof makeConn>, msg: object) {
  room.onMessage(JSON.stringify(msg), conn);
}

function lastBroadcast(room: DungeonRoom) {
  const mock = room.room.broadcast as ReturnType<typeof vi.fn>;
  const last = mock.mock.calls.at(-1)?.[0];
  return last ? JSON.parse(last) : null;
}

/** The room's current eventSeq — what a real host echoes back in HOST_NEXT (the eventId of the STATE it saw). */
const seqOf = (room: DungeonRoom) => (room as unknown as { eventSeq: number }).eventSeq;

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
    joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    expect(room.game).toBeNull();
    expect(lastSentTo(hostConn)).toMatchObject({ type: "ERROR", error: "not_host" });
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
      send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: qid, correct: true });
    }
    expect(room.game!.phase).toBe("finished");
    const broadcastCalls = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
    expect(broadcastCalls.some((m) => m.type === "GAME_OVER")).toBe(true);
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
      rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, reward: 10, questions: [{ kind: "text", id: "r0-q1", content: { kind: "text", value: "？" }, answer: "x" }] }],
      boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, hitReward: 25, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
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
          monster: { name: "史萊姆", sprite: "slime", hue: 0 },
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
      boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, hitReward: 10, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
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
      send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: room.game!.teams[0].currentQuestionId, correct: true });
    }
    const bossQid = room.game!.boss.currentQuestionId;
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) });
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
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) });
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
    send(room, hostConn, { type: "HOST_NEXT", eventId: firstRevealEvent });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: room.game!.teams[0].currentQuestionId, correct: true });
    const second = revealOf(room);
    send(room, hostConn, { type: "HOST_NEXT", eventId: firstRevealEvent }); // a second device's late tap
    expect(revealOf(room)).toEqual(second);
    expect(second).not.toBeNull();
  });

  it("HOST_NEXT from a non-host is rejected and leaves the reveal up", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    const stranger = makeConn("stranger");
    room.onConnect(stranger);
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
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: next, correct: false, fleeChoice: "retry" });
    expect(revealOf(room)).toBeNull();
  });

  it("HOST_NEXT with nothing revealed is a no-op (no extra STATE)", () => {
    const { room, hostConn } = startedGame(1);
    const before = broadcastsOf(room).length;
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) });
    expect(broadcastsOf(room).length).toBe(before);
  });
});

describe("TEAM_BRANCH_CHOICE", () => {
  function startedGame(teamCount = 2) {
    const { room, hostConn } = makeRoomWithHost();
    const { ids, conns } = joinTeams(room, hostConn, teamCount);
    send(room, hostConn, { type: "HOST_START" });
    return { room, hostConn, ids, conns };
  }

  it("rejects a connection that never joined any team", () => {
    const { room } = startedGame(1);
    const spectator = makeConn("spectator-conn");
    send(room, spectator, { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight" });
    expect(lastSentTo(spectator)).toMatchObject({ type: "ERROR", error: "unknown_team" });
  });

  it("rejects when there's no active game", () => {
    const { room, hostConn } = makeRoomWithHost();
    const { conns } = joinTeams(room, hostConn, 1);
    send(room, conns[0], { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight" });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "no_active_game" });
  });

  it("ignores a spoofed teamId in the payload — the sender's own team (via connTeam) is always used", () => {
    const { room, hostConn, ids, conns } = startedGame(2);
    // ids[0] answers incorrectly (stays at room 0, turn passes on); ids[1] then answers
    // correctly and enters room 1. Net: ids[0] at room 0, ids[1] at room 1.
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: false });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[1], questionId: "r0-q1", correct: true });
    // conns[0] (team ids[0], still at room 0) tries to claim ids[1]'s already-entered room via a spoofed teamId.
    send(room, conns[0], { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight", teamId: ids[1] } as never);
    // Rejected as ids[0]'s own (unreached) room, not applied to ids[1].
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams.find((t) => t.id === ids[1])!.branchChoices).toEqual({});
  });

  it("full flow: room advance, then a valid branch choice sticks and is visible in STATE", () => {
    const { room, hostConn, ids, conns } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true }); // roomIndex 0 -> 1
    send(room, conns[0], { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "negotiate" });
    const state = lastBroadcast(room);
    expect(state.type).toBe("STATE");
    expect(state.view.teams[0].branchChoices).toEqual({ 1: "negotiate" });
  });

  it("a second team cannot choose on behalf of the first — each connection only ever affects its own team", () => {
    const { room, hostConn, ids, conns } = startedGame(2);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true }); // team 0 enters room 1
    send(room, conns[1], { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight" }); // team 1 hasn't entered room 1
    expect(lastSentTo(conns[1])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[0].branchChoices).toEqual({});
  });

  it("rejects a resubmission for an already-decided room without overwriting the first choice", () => {
    const { room, hostConn, ids, conns } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    send(room, conns[0], { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight" });
    send(room, conns[0], { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "negotiate" });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[0].branchChoices).toEqual({ 1: "fight" });
  });

  it("does not block the team's next turn — HOST_JUDGE for that team still succeeds with the choice still pending", () => {
    const { room, hostConn, ids } = startedGame(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true }); // enters room 1, never chooses
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: room.game!.teams[0].currentQuestionId, correct: true });
    expect(room.game!.teams[0].roomIndex).toBeGreaterThanOrEqual(1);
    expect(room.game!.teams[0].branchChoices).toEqual({}); // still unanswered, and nothing broke
  });

  it("the recorded outcome always comes from the client's own message, never from the LLM/narration provider (design doc Next Steps #3)", async () => {
    // A "malicious" provider that tries to narrate a DIFFERENT branch choice than what the
    // client actually sent. If anything downstream ever consulted the provider's output to
    // decide (or override) a branch outcome, this would leak "negotiate" into a "fight" pick.
    const flush = () => new Promise((r) => setTimeout(r, 30));
    const malicious = { name: "malicious", narrate: async () => "negotiate" };
    const narrateSpy = vi.spyOn(malicious, "narrate");
    const room = new DungeonRoom(makeRoom() as any, () => 0, { provider: malicious, holdMs: 20 });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { ids, conns } = joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true }); // enters room 1
    await flush(); // drain HOST_JUDGE's own in-flight room-advance narration before counting calls
    const callsBeforeBranchChoice = narrateSpy.mock.calls.length; // 1: HOST_JUDGE's own room-advance narration
    send(room, conns[0], { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight" });
    await flush(); // drain any narrate() call TEAM_BRANCH_CHOICE might have triggered, sync or async

    expect(room.game!.teams[0].branchChoices).toEqual({ 1: "fight" }); // exactly what the client sent, not "negotiate"
    // handleTeamBranchChoice never calls narrate() at all — recordBranchChoice is a pure,
    // synchronous GameState transform with no LLM/provider dependency in its call path.
    expect(narrateSpy.mock.calls.length).toBe(callsBeforeBranchChoice);
  });
});

describe("TEAM_SELECT_OPTION", () => {
  // A minimal bank with one multipleChoice question so the success path (and the live
  // options.length bounds check) can be exercised without touching the shipped bank.
  const mcBank = parseBank({
    rooms: [
      {
        monster: { name: "史萊姆", sprite: "slime", hue: 0 },
        baseDifficulty: 1, reward: 10,
        questions: [{ kind: "multipleChoice", id: "r0-mc1", content: { kind: "text", value: "選哪個？" }, options: ["A", "B", "C"], correctIndex: 1 }],
      },
    ],
    boss: {
      monster: { name: "龍", sprite: "dragon", hue: 0 },
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
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    const next = room.game!.teams[0].currentQuestionId; // the room's only question, redealt
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: next, optionIndex: 0 });
    expect(lastSentTo(conns[0])).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "reveal_pending" });
    expect(room.game!.teams[0].currentSelection).toBeNull();
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) });
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
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    expect(room.game!.teams[0].reward).toBe(10);
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

  describe("phone answering: lock, beat, wrong choice, auto-advance (phone-answering.md)", () => {
    // A failed assertion must not leave fake timers on for the rest of the file.
    afterEach(() => vi.useRealTimers());
    const pick = (room: DungeonRoom, conn: Conn, i: number) => send(room, conn, { type: "TEAM_SELECT_OPTION", questionId: "r0-mc1", optionIndex: i });
    const lock = (room: DungeonRoom, conn: Conn) => send(room, conn, { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
    const err = (conn: Conn) => lastSentTo(conn as never)?.detail;

    it("rejects a lock with no pick, off turn, or on a stale question (E11)", () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(2);
      lock(room, conns[0]);
      expect(err(conns[0])).toBe("no_selection");
      send(room, conns[1], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1" });
      expect(err(conns[1])).toBe("not_your_turn");
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "boss-mc1" });
      expect(err(conns[0])).toBe("stale_question");
      vi.useRealTimers();
    });

    it("rejects a lock whose index is not the room's current pick: another phone on the team changed it", () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(1);
      pick(room, conns[0], 1);
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1", optionIndex: 2 });
      expect(err(conns[0])).toBe("selection_changed");
      expect((room as any).pendingLock).toBeNull();
      send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: "r0-mc1", optionIndex: 1 });
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
      send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) });
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
      vi.advanceTimersByTime(2000);
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "boss-mc1", correct: false, fleeChoice: "flee" });
      const last = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE").at(-1);
      expect(last.cue).toBe("retry");
      expect(room.game!.boss.currentQuestionId).not.toBe("boss-mc1");
      vi.useRealTimers();
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

    it("a lock whose team went offline during the beat is dropped (E9)", () => {
      vi.useFakeTimers();
      const { room, ids, conns } = startedMcGame(2);
      pick(room, conns[0], 1);
      lock(room, conns[0]);
      room.onClose(conns[0]);
      vi.advanceTimersByTime(2000);
      expect(room.game!.teams[0].score).toBe(0);
      expect(lastBroadcast(room).pendingLock).toBeNull();
      expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
      vi.useRealTimers();
    });

    const revealOpen = (room: DungeonRoom) => (room as unknown as { reveal: unknown }).reveal !== null;
    /** E4's estimate for the narration now on screen, in ms after it arrived. */
    const speech = (room: DungeonRoom) => ((room as unknown as { lastNarration: { lines: string[] } }).lastNarration.lines.join("").length / 4) * 1000 + 1000;

    it("auto-advances a correct reveal once the voice is done, at least 8 s and at most 15 s after it (E3, E4)", async () => {
      vi.useFakeTimers();
      const { room, conns } = startedMcGame(1);
      pick(room, conns[0], 1);
      lock(room, conns[0]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(revealOpen(room)).toBe(true);
      const due = Math.min(15_000, Math.max(8000, speech(room)));
      await vi.advanceTimersByTimeAsync(due - 10);
      expect(revealOpen(room)).toBe(true);
      await vi.advanceTimersByTimeAsync(20);
      expect(revealOpen(room)).toBe(false);
      vi.useRealTimers();
    });

    it("a host edit re-counts the voice but keeps the 15 s cap; HOST_NEXT cancels the timer (E12, R2-4)", async () => {
      vi.useFakeTimers();
      const { room, hostConn, conns } = startedMcGame(1);
      pick(room, conns[0], 1);
      lock(room, conns[0]);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(7000);
      send(room, hostConn, { type: "HOST_EDIT_NARRATION", line: "長".repeat(40) });
      const due = Math.min(15_000, Math.max(8000, 7000 + speech(room)));
      expect(due).toBeGreaterThan(8000);
      await vi.advanceTimersByTimeAsync(due - 7000 - 10);
      expect(revealOpen(room)).toBe(true);
      await vi.advanceTimersByTimeAsync(20);
      expect(revealOpen(room)).toBe(false);

      const second = startedMcGame(1);
      pick(second.room, second.conns[0], 1);
      lock(second.room, second.conns[0]);
      await vi.advanceTimersByTimeAsync(2000);
      send(second.room, second.hostConn, { type: "HOST_NEXT", eventId: seqOf(second.room) });
      const after = (second.room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect((second.room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.length).toBe(after);
      vi.useRealTimers();
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
      vi.advanceTimersByTime(2000);
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
      send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
      send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
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
      send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
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
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
  }

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
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
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
    it("host notes go into every later LLM call; non-hosts cannot set them", async () => {
      const r = await llmRoom(() => textReply("行"));
      begin(r);
      await sleep(30);
      send(r.room, r.hostConn, { type: "HOST_SET_NOTES", notes: "用武俠口吻，紅隊是一群恐龍" });
      judge(r.room, r.hostConn);
      await sleep(30);
      expect(r.calls.at(-1)!.system).toContain("用武俠口吻，紅隊是一群恐龍");
      const intruder = makeConn("nope");
      send(r.room, intruder, { type: "HOST_SET_NOTES", notes: "駭進來" });
      expect(sentMsgs(intruder).at(-1)).toMatchObject({ type: "ERROR", error: "not_host" });
      judge(r.room, r.hostConn);
      await sleep(30);
      expect(r.calls.at(-1)!.system).not.toContain("駭進來");
    });

    it("strips markup from notes and records them in the transcript", async () => {
      const r = await llmRoom(() => textReply("行"));
      send(r.room, r.hostConn, { type: "HOST_SET_NOTES", notes: "<b>活潑</b>一點" });
      expect(transcript(r.room, r.hostConn).at(-1)).toMatchObject({ kind: "notes", text: "b活潑/b一點" });
    });

    it("host edit replaces the line on screen under the same eventId, and is marked host in the transcript", async () => {
      const r = await llmRoom(() => textReply("原本的一句"));
      begin(r);
      await sleep(30);
      const first = narrations(r.room).at(-1);
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", line: "主持人改寫的一句" });
      const edited = narrations(r.room).at(-1);
      expect(edited).toMatchObject({ eventId: first.eventId, lines: ["主持人改寫的一句", ...first.lines.slice(1)] });
      expect(transcript(r.room, r.hostConn).at(-1)).toMatchObject({ kind: "edit", text: "主持人改寫的一句", eventId: first.eventId });
      const late = makeConn("late");
      r.room.onConnect(late);
      expect(sentMsgs(late).find((m) => m.type === "NARRATION").lines[0]).toBe("主持人改寫的一句");
    });

    it("rejects an edit from a non-host, an edit with no line on screen, and an empty edit", async () => {
      const r = await llmRoom(() => textReply("行"));
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", line: "太早了" });
      expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "no_narration" });
      begin(r);
      await sleep(30);
      const intruder = makeConn("nope");
      send(r.room, intruder, { type: "HOST_EDIT_NARRATION", line: "改" });
      expect(sentMsgs(intruder).at(-1)).toMatchObject({ error: "not_host" });
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", line: "   " });
      expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ error: "invalid_action" });
      expect(narrations(r.room).at(-1).lines[0]).toBe("行");
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

      it("a narration the room drops as stale does not use up the line", async () => {
        const releases: (() => void)[] = [];
        const r = await llmRoom(() => new Promise<Response>((res) => releases.push(() => res(textReply("結果\n氣氛\n換人")))));
        begin(r);
        releases.shift()!();
        await sleep(30);
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
        judge(r.room, r.hostConn); // narration 1 carries the line and waits
        judge(r.room, r.hostConn); // narration 2 also carries it
        releases[1]();
        await sleep(10);
        releases[0](); // narration 1 lands after 2: dropped as stale
        await sleep(30);
        expect(narrations(r.room).at(-1).lines[1]).toBe("珍珠能吃嗎");
        expect(states(r.hostConn).at(-1)).toBe("");
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
        expect(states(r.hostConn).at(-1)).toBe("");
        send(r.room, r.hostConn, { type: "HOST_NEXT_LINE", line: "太晚了" });
        expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "game_over" });
      });
    });

    it("feeds the last five edited lines back as style examples", async () => {
      const r = await llmRoom(() => textReply("行"));
      begin(r);
      await sleep(30);
      for (let i = 1; i <= 6; i++) send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", line: `改寫第${i}句` });
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
      const r = await llmRoom((req) => textReply(req.model === EPILOGUE_MODEL ? "漫長的一夜，Team 0 走出了地城。" : "行"));
      await finish(r);
      const epi = all(r.room).filter((m) => m.type === "EPILOGUE");
      expect(epi).toHaveLength(1);
      expect(epi[0].text).toBe("漫長的一夜，Team 0 走出了地城。");
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
    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) }); // close the previous reveal (D7); no-op if none
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct });
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
    send(room, hostConn, { type: "HOST_EDIT_NARRATION", line: "主持人改的結果句" });
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

  it("caps the connections to one room", () => {
    const room = new DungeonRoom(makeRoom() as any, () => 0);
    const conns = Array.from({ length: 61 }, (_, i) => makeConn(`c${i}`));
    conns.forEach((c) => room.onConnect(c));
    expect((conns[59].close as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((conns[60].close as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    room.onClose(conns[0]);
    const next = makeConn("after-a-slot-frees");
    room.onConnect(next);
    expect((next.close as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
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
        monster: { name: "史萊姆", sprite: "slime", hue: 0 },
        baseDifficulty: 1, reward: 10,
        questions: [{ kind: "text", id: "r0-img1", content: { kind: "image", value: "55555555-5555-5555-5555-555555555555" }, answer: "松鼠" }],
      },
    ],
    boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, hitReward: 10, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
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

    send(room, hostConn, { type: "HOST_NEXT", eventId: seqOf(room) });
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
    expect(room.game!.teams.map((t) => [t.classId, t.abilityUses])).toEqual([["warrior", 2], [undefined, 2]]);
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

  it("spends the use at the roll, holds a 12 for 2 s (host judging and a second roll refused), then judges it correct", () => {
    vi.useFakeTimers();
    const { room, hostConn, conns, roll } = warriorGame();
    const q = room.game!.teams[0].currentQuestionId;
    const seq = seqOf(room);
    roll(12);
    const held = lastBroadcast(room);
    expect(held.pendingRoll).toMatchObject({ questionId: q, value: 12 });
    expect(held.view.teams[0].abilityUses).toBe(1);
    send(room, hostConn, { type: "HOST_JUDGE", teamId: room.game!.teams[0].id, questionId: q, correct: true, eventId: seq });
    expect(err(hostConn)).toBe("roll_pending");
    roll(12);
    expect(err(conns[0])).toBe("answer_pending");
    vi.advanceTimersByTime(2000);
    const out = lastBroadcast(room);
    expect(out.pendingRoll).toBeNull();
    expect(out.reveal).toMatchObject({ questionId: q });
    expect(room.game!.teams[0]).toMatchObject({ abilityUses: 1, roomIndex: 1 });
    expect(seqOf(room)).toBe(seq + 1);
  });

  it("an 11 is a retry: same question, the turn passes, one use spent", () => {
    vi.useFakeTimers();
    const { room, ids, roll } = warriorGame();
    const q = room.game!.teams[0].currentQuestionId;
    roll(11);
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).reveal).toBeNull();
    expect(room.game!.teams[0]).toMatchObject({ abilityUses: 1, currentQuestionId: q, roomIndex: 0 });
    expect(currentTurnTeamId(room.game!)).toBe(ids[1]);
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
    expect(room.game!.teams[0]).toMatchObject({ abilityUses: 1, roomIndex: 0 });
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
    roll(12);
    send(room, conns[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: 0 });
    expect(err(conns[0])).toBe("answer_pending");
    send(room, conns[0], { type: "TEAM_LOCK_OPTION", questionId: q });
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
    roll(12);
    vi.advanceTimersByTime(2000);
    expect(lastBroadcast(room).reveal).not.toBeNull();
    roll(12);
    expect(err(conns[0])).toBe("reveal_pending");
  });

  // Value: protects=a room that expires during a roll's beat comes back usable: the next game's host can judge;
  // fails_when=clearAnswerTimers stops clearing pendingRoll, so every later judge says roll_pending; why_new=the
  // expiry test above covers a lock's beat only; seam=none; no_claim=real Durable Object storage (mock RoomIO)
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
    expect(room.game!.teams[0].abilityUses).toBe(2);
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, abilityUses: 0 } : t)) };
    roll(20);
    expect(err(conns[0])).toMatch(/no ability uses/);
    expect((room as any).pendingRoll).toBeNull();
  });
});

describe("class abilities: mage, cleric and thief in the room (class-abilities.md PR 2)", () => {
  afterEach(() => vi.useRealTimers());
  const mc = (id: string) => ({ kind: "multipleChoice" as const, id, content: { kind: "text" as const, value: "選哪個？" }, options: ["A", "B", "C", "D"], correctIndex: 1 });
  const bank = parseBank({
    rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, reward: 10, questions: [mc("r0-mc1"), { kind: "text", id: "r0-t1", content: { kind: "text", value: "？" }, answer: "a" }, { kind: "text", id: "r0-t2", content: { kind: "text", value: "？" }, answer: "〈萬家福〉" }] }],
    boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, hitReward: 10, questions: [mc("boss-mc1"), mc("boss-mc2")] },
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
    expect(room.game!.teams[0].abilityUses).toBe(1);
    use();
    expect(err(conns[0])).toBe("no_option_to_remove");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "r0-t1" } : t)) };
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t1" });
    expect(err(conns[0])).toBe("no_hint");
    expect(room.game!.teams[0].abilityUses).toBe(1);
  });

  // Value: protects=the mage on a fill-in question shows the answer's first character to every screen and
  // spends a use, once per question (#106); fails_when=the room still refuses fill-in, or a second cast spends;
  // seam=room → game-state mageHint; no_claim=how each page renders it (e2e)
  it("the mage shows a fill-in answer's first character to everyone, once per question", () => {
    const { room, conns } = game("mage");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "r0-t2" } : t)) };
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t2" });
    expect(lastBroadcast(room).view.mageHints).toEqual({ "r0-t2": "萬" });
    expect(room.game!.teams[0].abilityUses).toBe(1);
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "r0-t2" });
    expect(err(conns[0])).toBe("hint_shown");
    expect(room.game!.teams[0].abilityUses).toBe(1);
  });

  // Value: protects=a mage cast on a question id the bank lacks is refused as stale and spends nothing (/review);
  // fails_when=mageHint or mageEliminate runs on a missing question, or the error names the wrong cause; seam=room; no_claim=none
  it("the mage is refused on a question id the bank lacks, without spending", () => {
    const { room, conns } = game("mage");
    room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "nope" } : t)) };
    send(room, conns[0], { type: "TEAM_USE_ABILITY", questionId: "nope" });
    expect(err(conns[0])).toBe("stale_question");
    expect(room.game!.teams[0].abilityUses).toBe(2);
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
    rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, reward: 10, questions: [text("r0-t1"), text("r0-t2"), { kind: "multipleChoice", id: "r0-mc1", content: { kind: "text", value: "？" }, options: ["A", "B"], correctIndex: 1 }] }],
    boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, hitReward: 10, questions: [text("boss-t1"), text("boss-t2")] },
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
    const submit = (text: string, conn = conns[0]) => send(room, conn, { type: "TEAM_SUBMIT_TEXT", questionId: q(), text });
    const rollFor = (value: number) => {
      r = (value - 1) / 20;
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
    send(room, conns[1], { type: "TEAM_SUBMIT_TEXT", questionId: room.game!.teams[1].currentQuestionId, text: "x" });
    expect(lastSentTo(conns[1])).toMatchObject({ type: "ERROR", error: "invalid_action" });
    expect(room.game!.teams[1].typedAnswer).toBeUndefined();
    send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: "no-such-q", text: "x" });
    expect(err(conns[0])).toBe("not_text_question");
    submit("first");
    submit("second");
    expect(err(conns[0])).toBe("already_submitted");
    expect(room.game!.teams[0].typedAnswer).toBe("first");
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: q(), correct: true });
    expect(room.game!.teams[0].typedAnswer).toBeUndefined();
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
    send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: first, text: "late", eventId: before });
    expect(err(conns[0])).toBe("stale_event");
    expect(room.game!.teams[0].typedAnswer).toBeUndefined();
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
      rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, reward: 10, questions: [{ kind: "multipleChoice", id: "r0-mc1", content: { kind: "text", value: "？" }, options: ["a", "b"], correctIndex: 0 }] }],
      boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, hitReward: 10, questions: [{ kind: "text", id: "boss-q1", content: { kind: "text", value: "？" }, answer: "x" }] },
    });
    const room = new DungeonRoom(makeRoom() as any, () => 0, { bank: mcBank });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    const { conns } = joinTeams(room, hostConn, 1);
    send(room, hostConn, { type: "HOST_START" });
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
    expect(sent.room.game!.teams[0].abilityUses).toBe(2);
    const rolling = game(true);
    rolling.rollFor(20);
    rolling.submit("x");
    expect(err(rolling.conns[0])).toBe("roll_pending");
    expect(rolling.room.game!.teams[0].typedAnswer).toBeUndefined();
  });
});
