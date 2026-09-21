/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { BANK, bossQuestionIds, roomTemplates } from "../question-bank";
import { currentTurnTeamId } from "../game-state";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const T3 = "00000000-0000-0000-0000-000000000003";
const BAD_ID = "not-a-uuid";
/** A team's secret: only the client that created the team knows it. */
const KEY = "team-key-0123456789abcdef";
const KEY2 = "another-key-0123456789abcd";

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
    expect(lastSentTo(conn)).toEqual({ type: "HOST_OK", aiAvailable: false }); // no API key in the test room
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
    expect(room.game!.boss.questionIds).toEqual(bossQuestionIds(BANK));
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
    const state = lastBroadcast(room);
    expect(state.type).toBe("STATE");
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

  it("broadcasts GAME_OVER once the boss dies", () => {
    const { room, hostConn, ids } = startedGame(1);
    // Answer whatever question is current (room deal or boss) correctly until the game ends.
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) {
      const g = room.game!;
      const t = g.teams[0];
      const qid = t.score >= g.config.bossThreshold ? g.boss.currentQuestionId : t.currentQuestionId;
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: qid, correct: true });
    }
    expect(room.game!.phase).toBe("finished");
    const broadcastCalls = (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0]));
    expect(broadcastCalls.some((m) => m.type === "GAME_OVER")).toBe(true);
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
    expect(typeof state.question.text).toBe("string");
    expect(state.question).not.toHaveProperty("answer");
  });

  it("sends the answer only to host connections, on start and after every judgment", () => {
    const { room, hostConn, ids, conns } = started();
    expect(sent(hostConn).findLast((m) => m.type === "HOST_ANSWER")).toMatchObject({ questionId: "r0-q1", answer: "台北 101" });
    send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: "r0-q1", correct: true });
    // Turn passes to team 2, whose question is r0-q2.
    expect(sent(hostConn).findLast((m) => m.type === "HOST_ANSWER")).toMatchObject({ questionId: "r0-q2", answer: "115 年" });
    for (const c of conns) expect(sent(c).some((m) => m.type === "HOST_ANSWER")).toBe(false);
  });

  it("a host that claims mid-game gets the current answer at once", () => {
    const { room } = started();
    const second = makeConn("host-phone");
    claim(room, second);
    expect(sent(second).map((m) => m.type)).toEqual(["HOST_OK", "HOST_ANSWER"]);
  });

  it("never puts any bank answer into a broadcast or a player message across a full game", () => {
    const { room, hostConn, conns } = started(2);
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) {
      const g = room.game!;
      const teamId = g.turnOrder[g.currentTurnIndex];
      const t = g.teams.find((x) => x.id === teamId)!;
      const qid = t.score >= g.config.bossThreshold ? g.boss.currentQuestionId : t.currentQuestionId;
      send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
    }
    expect(room.game!.phase).toBe("finished");
    const public_ = JSON.stringify([...broadcasts(room), ...conns.flatMap(sent)]);
    for (const r of BANK.rooms) for (const q of [...r.questions]) expect(public_).not.toContain(`"answer":"${q.answer}"`);
    for (const q of BANK.boss.questions) expect(public_).not.toContain(`"answer":"${q.answer}"`);
    expect(public_).not.toContain("HOST_ANSWER");
  });

  it("in the boss room the public question is flagged as boss", () => {
    const { room, hostConn, ids } = started(1);
    for (let i = 0; i < 100 && room.game!.teams[0].score < 15; i++) {
      const t = room.game!.teams[0];
      send(room, hostConn, { type: "HOST_JUDGE", teamId: ids[0], questionId: t.currentQuestionId, correct: true });
    }
    const state = broadcasts(room).findLast((m) => m.type === "STATE");
    expect(state.question).toMatchObject({ boss: true, monster: { sprite: "dragon" } });
  });

  it("dealing follows the injected rng", () => {
    const room = new DungeonRoom(makeRoom() as any, () => 0.99);
    const host = makeConn("h");
    claim(room, host);
    joinTeams(room, host, 1);
    send(room, host, { type: "HOST_START" });
    expect(room.game!.teams[0].currentQuestionId).toBe("r0-q8");
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
    const qid = t.score >= g.config.bossThreshold ? g.boss.currentQuestionId : t.currentQuestionId;
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
    // STATE for the judgment is out synchronously, before any narration for it.
    expect(all(room).at(-1)).toMatchObject({ type: "STATE", eventId: 2 });
    await flush();
    judgeCorrect(room, hostConn);
    await flush();
    const narr = all(room).filter((m) => m.type === "NARRATION");
    expect(narr.map((m) => m.eventId)).toEqual([1, 2, 3]);
    for (const n of narr) expect(n.line.length).toBeGreaterThan(0);
  });

  it("names the team that was judged in the line", async () => {
    const { room, hostConn } = start();
    await flush();
    judgeCorrect(room, hostConn);
    await flush();
    const last = all(room).filter((m) => m.type === "NARRATION").at(-1);
    expect(last.line).toContain("Team 0");
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
    expect(narr[0].line).not.toBe("太慢的一行");
    await sleep(250);
    expect(all(room).filter((m) => m.type === "NARRATION")).toHaveLength(1); // late answer sends nothing
    expect(hostConn).toBeDefined();
  });

  it("uses the provider's line when it answers in time", async () => {
    const quick = { name: "quick", narrate: async () => "提供者的一行" };
    const { room } = start(2, { holdMs: 50, epilogueDelayMs: 0, provider: quick });
    await flush();
    expect(all(room).find((m) => m.type === "NARRATION").line).toBe("提供者的一行");
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
      const score = room.game!.teams[0].score;
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
      expect(t.entries[1].scores).toEqual({ "Team 0": 1, "Team 1": 0 });
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

  /** A room with (or without) an API key and a fake fetch that records every request. */
  function llmRoom(fetchImpl: (req: { model: string; system: string; user: string }) => Response | Promise<Response>, opts: { key?: string | null; epilogueHoldMs?: number } = {}) {
    const calls: { model: string; system: string; user: string }[] = [];
    const fake = async (_url: unknown, init?: RequestInit) => {
      const b = JSON.parse(init!.body as string);
      const req = { model: b.model, system: b.system, user: b.messages[0].content };
      calls.push(req);
      return fetchImpl(req);
    };
    const roomMock = makeRoom() as any;
    roomMock.env = opts.key === null ? {} : { ANTHROPIC_API_KEY: opts.key ?? "sk-test" };
    const room = new DungeonRoom(roomMock, () => 0, { holdMs: 200, epilogueDelayMs: 0, epilogueHoldMs: opts.epilogueHoldMs ?? 200, fetch: fake as unknown as typeof fetch });
    const hostConn = makeConn("host-conn");
    room.onConnect(hostConn);
    claim(room, hostConn);
    return { room, hostConn, calls };
  }
  function begin(r: ReturnType<typeof llmRoom>, ai?: boolean, teams = 2) {
    joinTeams(r.room, r.hostConn, teams);
    send(r.room, r.hostConn, ai === undefined ? { type: "HOST_START" } : { type: "HOST_START", aiNarration: ai });
  }
  function judge(room: DungeonRoom, hostConn: ReturnType<typeof makeConn>) {
    const g = room.game!;
    const teamId = g.turnOrder[g.currentTurnIndex];
    const t = g.teams.find((x) => x.id === teamId)!;
    const qid = t.score >= g.config.bossThreshold ? g.boss.currentQuestionId : t.currentQuestionId;
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct: true });
  }
  const narrations = (room: DungeonRoom) => all(room).filter((m) => m.type === "NARRATION");
  const transcript = (room: DungeonRoom, hostConn: ReturnType<typeof makeConn>) => {
    send(room, hostConn, { type: "HOST_GET_TRANSCRIPT" });
    return sentMsgs(hostConn).findLast((m) => m.type === "TRANSCRIPT").entries;
  };

  it("tells the host whether an API key is configured", () => {
    const withKey = llmRoom(() => textReply("x"));
    expect(sentMsgs(withKey.hostConn).find((m) => m.type === "HOST_OK").aiAvailable).toBe(true);
    const noKey = llmRoom(() => textReply("x"), { key: null });
    expect(sentMsgs(noKey.hostConn).find((m) => m.type === "HOST_OK").aiAvailable).toBe(false);
  });

  it("uses the LLM line when AI narration is on and a key exists", async () => {
    const r = llmRoom(() => textReply("地城主親自開口了！"));
    begin(r);
    await sleep(30);
    expect(narrations(r.room)[0].line).toBe("地城主親自開口了！");
    expect(r.calls[0].model).toBe("claude-haiku-4-5");
    expect(transcript(r.room, r.hostConn)[0]).toMatchObject({ provider: "llm" });
  });

  it("makes no LLM call when the host turns AI narration off, or when there is no key", async () => {
    const off = llmRoom(() => textReply("不該出現"));
    begin(off, false);
    judge(off.room, off.hostConn);
    await sleep(30);
    expect(off.calls).toHaveLength(0);
    expect(narrations(off.room).every((n) => n.line !== "不該出現")).toBe(true);
    const noKey = llmRoom(() => textReply("不該出現"), { key: null });
    begin(noKey, true);
    await sleep(30);
    expect(noKey.calls).toHaveLength(0);
  });

  it("falls back to the scripted line on an LLM failure and still sends exactly one NARRATION", async () => {
    const r = llmRoom(() => json({ error: {} }, 500));
    begin(r);
    await sleep(30);
    expect(narrations(r.room)).toHaveLength(1);
    expect(transcript(r.room, r.hostConn)[0]).toMatchObject({ provider: "scripted", fallbackReason: "upstream" });
  });

  it("rejects an LLM line that repeats a bank answer and uses the scripted line", async () => {
    const r = llmRoom(() => textReply("其實它叫新高山啦"));
    begin(r);
    await sleep(30);
    expect(narrations(r.room)[0].line).not.toContain("新高山");
    expect(transcript(r.room, r.hostConn)[0]).toMatchObject({ fallbackReason: "invalid_output" });
  });

  it("stops calling the LLM after a 401 (breaker) and records the trip", async () => {
    const r = llmRoom(() => json({ error: {} }, 401));
    begin(r);
    await sleep(30);
    judge(r.room, r.hostConn);
    judge(r.room, r.hostConn);
    await sleep(30);
    expect(r.calls).toHaveLength(1); // start only; later events never reached the API
    const t = transcript(r.room, r.hostConn);
    expect(t.some((e: any) => e.kind === "breaker")).toBe(true);
    expect(t.filter((e: any) => e.fallbackReason === "breaker_open").length).toBeGreaterThanOrEqual(2);
    expect(narrations(r.room)).toHaveLength(3); // still exactly one per event
  });

  it("opens the breaker after three failures in a row", async () => {
    const r = llmRoom(() => json({ error: {} }, 500));
    begin(r);
    for (let i = 0; i < 4; i++) { judge(r.room, r.hostConn); await sleep(20); }
    await sleep(30);
    expect(r.calls).toHaveLength(3);
  });

  describe("director", () => {
    it("host notes go into every later LLM call; non-hosts cannot set them", async () => {
      const r = llmRoom(() => textReply("行"));
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

    it("strips markup from notes and records them in the transcript", () => {
      const r = llmRoom(() => textReply("行"));
      send(r.room, r.hostConn, { type: "HOST_SET_NOTES", notes: "<b>活潑</b>一點" });
      expect(transcript(r.room, r.hostConn).at(-1)).toMatchObject({ kind: "notes", text: "b活潑/b一點" });
    });

    it("host edit replaces the line on screen under the same eventId, and is marked host in the transcript", async () => {
      const r = llmRoom(() => textReply("原本的一句"));
      begin(r);
      await sleep(30);
      const first = narrations(r.room).at(-1);
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", line: "主持人改寫的一句" });
      const edited = narrations(r.room).at(-1);
      expect(edited).toMatchObject({ eventId: first.eventId, line: "主持人改寫的一句" });
      expect(transcript(r.room, r.hostConn).at(-1)).toMatchObject({ kind: "edit", text: "主持人改寫的一句", eventId: first.eventId });
      const late = makeConn("late");
      r.room.onConnect(late);
      expect(sentMsgs(late).find((m) => m.type === "NARRATION").line).toBe("主持人改寫的一句");
    });

    it("rejects an edit from a non-host, an edit with no line on screen, and an empty edit", async () => {
      const r = llmRoom(() => textReply("行"));
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", line: "太早了" });
      expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ type: "ERROR", error: "invalid_action", detail: "no_narration" });
      begin(r);
      await sleep(30);
      const intruder = makeConn("nope");
      send(r.room, intruder, { type: "HOST_EDIT_NARRATION", line: "改" });
      expect(sentMsgs(intruder).at(-1)).toMatchObject({ error: "not_host" });
      send(r.room, r.hostConn, { type: "HOST_EDIT_NARRATION", line: "   " });
      expect(sentMsgs(r.hostConn).at(-1)).toMatchObject({ error: "invalid_action" });
      expect(narrations(r.room).at(-1).line).toBe("行");
    });

    it("feeds the last five edited lines back as style examples", async () => {
      const r = llmRoom(() => textReply("行"));
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
    async function finish(r: ReturnType<typeof llmRoom>) {
      begin(r, undefined, 1);
      for (let i = 0; i < 200 && r.room.game!.phase === "playing"; i++) judge(r.room, r.hostConn);
      await sleep(60);
    }

    it("is written by the bigger model, sent once, and the scripted one is not used", async () => {
      const r = llmRoom((req) => textReply(req.model === "claude-sonnet-5" ? "漫長的一夜，Team 0 走出了地城。" : "行"));
      await finish(r);
      const epi = all(r.room).filter((m) => m.type === "EPILOGUE");
      expect(epi).toHaveLength(1);
      expect(epi[0].text).toBe("漫長的一夜，Team 0 走出了地城。");
      expect(r.calls.some((c) => c.model === "claude-sonnet-5" && c.user.includes("排名"))).toBe(true);
    });

    it("falls back to the program-built epilogue when the LLM fails", async () => {
      const r = llmRoom((req) => (req.model === "claude-sonnet-5" ? json({ error: {} }, 500) : textReply("行")));
      await finish(r);
      const epi = all(r.room).filter((m) => m.type === "EPILOGUE");
      expect(epi).toHaveLength(1);
      expect(epi[0].text).toContain("Team 0");
      expect(epi[0].text).toContain(String(r.room.game!.teams[0].score));
    });

    it("waits for the LLM up to the epilogue hold, then falls back once", async () => {
      const r = llmRoom(async (req) => (req.model === "claude-sonnet-5" ? (await sleep(300), textReply("太慢了")) : textReply("行")), { epilogueHoldMs: 40 });
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
    const qid = t.score >= g.config.bossThreshold ? g.boss.currentQuestionId : t.currentQuestionId;
    send(room, hostConn, { type: "HOST_JUDGE", teamId, questionId: qid, correct });
  }

  it("the opening narration is followed by a line about the first team on turn", async () => {
    const { room } = begin();
    await flush();
    expect(narrs(room)[0].then).toContain("Team 0");
  });

  it("a judgment's narration carries a follow-up that names the team now on turn and its monster", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn); // Team 0 answers; Team 1 is next, still in the first room
    await flush();
    const n = narrs(room).at(-1);
    expect(n.line).toContain("Team 0");
    expect(n.then).toContain("Team 1");
    expect(n.then).toContain("軟趴趴史萊姆");
  });

  it("names the right team after a wrong answer too (turn still passes)", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn, false);
    await flush();
    expect(narrs(room).at(-1).then).toContain("Team 1");
  });

  it("the killing blow has no follow-up: nobody is next", async () => {
    const { room, hostConn } = begin(1);
    for (let i = 0; i < 200 && room.game!.phase === "playing"; i++) judge(room, hostConn);
    await sleep(40);
    const kill = narrs(room).filter((m) => m.line).at(-1);
    expect(kill.then).toBeUndefined();
  });

  it("replays the follow-up to a late connection, and a host edit keeps it", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn);
    await flush();
    send(room, hostConn, { type: "HOST_EDIT_NARRATION", line: "主持人改的結果句" });
    const edited = narrs(room).at(-1);
    expect(edited.line).toBe("主持人改的結果句");
    expect(edited.then).toContain("Team 1");
    const late = makeConn("late");
    room.onConnect(late);
    expect(sentMsgs(late).find((m) => m.type === "NARRATION")).toMatchObject({ line: "主持人改的結果句", then: expect.stringContaining("Team 1") });
  });

  it("records the follow-up and who wrote it in the transcript", async () => {
    const { room, hostConn } = begin();
    await flush();
    judge(room, hostConn);
    await flush();
    send(room, hostConn, { type: "HOST_GET_TRANSCRIPT" });
    const t = sentMsgs(hostConn).findLast((m) => m.type === "TRANSCRIPT").entries;
    expect(t.at(-1)).toMatchObject({ thenSource: "scripted" });
    expect(t.at(-1).then).toContain("Team 1");
  });

  it("uses the model's own second line when it writes one", async () => {
    const two = { name: "llm", narrate: async () => "結果句在這裡！\n輪到 Team 1，準備好了嗎？" };
    const { room } = begin(2, { holdMs: 50, epilogueDelayMs: 0, provider: two });
    await sleep(40);
    expect(narrs(room)[0]).toMatchObject({ line: "結果句在這裡！", then: "輪到 Team 1，準備好了嗎？" });
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
