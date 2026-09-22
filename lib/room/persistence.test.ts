/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import { SCHEMA_VERSION, SNAPSHOT_KEY } from "./snapshot";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { BANK } from "../question-bank";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TEAM_KEY = "team-key-0123456789abcdef";
const TOKEN = "host-token-0123456789abcdef";

/** In-memory stand-in for a Durable Object's storage. It records every call in `log`, in order. */
function memoryStorage(log: string[] = []) {
  const data = new Map<string, unknown>();
  const storage: RoomStorage & { data: Map<string, unknown>; puts: number; failNext: boolean } = {
    data,
    puts: 0,
    failNext: false,
    get: async (k) => structuredClone(data.get(k)),
    put(k, v) {
      log.push("put");
      if (storage.failNext) {
        storage.failNext = false;
        throw new Error("disk full");
      }
      storage.puts++;
      data.set(k, structuredClone(v));
    },
  };
  return storage;
}

function makeConn(id: string, log: string[] = []) {
  return { id, send: vi.fn(() => void log.push("send")), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}

function makeRoom(storage: RoomStorage, opts: ConstructorParameters<typeof DungeonRoom>[2] = {}, log: string[] = []) {
  const io: RoomIO & { broadcast: ReturnType<typeof vi.fn> } = {
    broadcast: vi.fn(() => void log.push("broadcast")),
    storage,
  };
  return { room: new DungeonRoom(io, () => 0, { epilogueDelayMs: 0, ...opts }), io };
}

const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const sent = (conn: { send: ReturnType<typeof vi.fn> }) => conn.send.mock.calls.map((c) => JSON.parse(c[0] as string));
const lastOf = (conn: { send: ReturnType<typeof vi.fn> }, type: string) => sent(conn).findLast((m) => m.type === type);

/** A host and two teams in the lobby, then the game started; returns the connections. */
function startedGame(room: DungeonRoom) {
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const a = makeConn("a");
  const b = makeConn("b");
  send(room, a, { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
  send(room, b, { type: "JOIN", teamId: T2, teamKey: TEAM_KEY + "2", teamName: "乙隊" });
  send(room, host, { type: "HOST_START", aiNarration: false });
  return { host, a, b };
}

/** A phone comes back after a restart: it sends JOIN with its saved key when its socket opens. */
const rejoin = (room: DungeonRoom, id: string, key: string, connId: string) => {
  const conn = makeConn(connId);
  send(room, conn, { type: "JOIN", teamId: id, teamKey: key, teamName: "x" });
  return conn;
};

const judgeCorrect = (room: DungeonRoom, host: Conn & { send: ReturnType<typeof vi.fn> }, teamId: string) => {
  const q = lastOf(host, "HOST_ANSWER");
  send(room, host, { type: "HOST_JUDGE", teamId, questionId: q.questionId, correct: true });
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("saving", () => {
  it("saves before the first message goes out, never after", () => {
    const log: string[] = [];
    const { room } = makeRoom(memoryStorage(log), {}, log);
    const host = makeConn("host", log);
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    expect(log.indexOf("put")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("put")).toBeLessThan(log.findIndex((e) => e === "send" || e === "broadcast"));
  });

  it("saves a state change before it is broadcast", () => {
    const log: string[] = [];
    const storage = memoryStorage(log);
    const { room } = makeRoom(storage, {}, log);
    const { host, a } = startedGame(room);
    log.length = 0;
    judgeCorrect(room, host, T1);
    void a;
    expect(log[0]).toBe("put"); // the judgment is saved first
    expect(log).toContain("broadcast");
    expect((storage.data.get(SNAPSHOT_KEY) as any).game.teams.find((t: any) => t.id === T1).score).toBe(1);
  });

  it("does not write again when nothing changed", () => {
    const storage = memoryStorage();
    const { room } = makeRoom(storage);
    const { host } = startedGame(room);
    const before = storage.puts;
    room.onConnect(makeConn("late-screen")); // a screen joins: it is sent the state, the state is the same
    send(room, host, { type: "HOST_GET_TRANSCRIPT" });
    expect(storage.puts).toBe(before);
  });

  it("a team going offline or online alone is not a change worth writing", () => {
    const storage = memoryStorage();
    const { room } = makeRoom(storage);
    const { a } = startedGame(room);
    const before = storage.puts;
    room.onClose(a);
    send(room, makeConn("a2"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    expect(storage.puts).toBe(before);
  });

  it("a write that fails is logged by name, does not crash the room, and is retried on the next message", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = memoryStorage();
    const { room } = makeRoom(storage);
    const host = makeConn("host");
    room.onConnect(host);
    storage.failNext = true;
    expect(() => send(room, host, { type: "HOST_CLAIM", token: TOKEN })).not.toThrow();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('"event":"persist_failed"'));
    send(room, makeConn("p"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    expect(storage.puts).toBeGreaterThan(0); // saved on the next message, including the host token
    expect((storage.data.get(SNAPSHOT_KEY) as any).hostToken).toBe(TOKEN);
  });

  it("never saves who is connected, the transcript, or an API key", () => {
    const storage = memoryStorage();
    const { room } = makeRoom(storage);
    startedGame(room);
    const json = JSON.stringify(storage.data.get(SNAPSHOT_KEY));
    expect(json).not.toContain("transcript");
    expect(json).not.toMatch(/ANTHROPIC|sk-ant/);
    expect((storage.data.get(SNAPSHOT_KEY) as any).game.teams.every((t: any) => t.online === false)).toBe(true);
  });
});

describe("restoring after a restart", () => {
  it("a room with nothing saved reports 'none' and is a fresh lobby", async () => {
    const { room } = makeRoom(memoryStorage());
    expect(await room.restore()).toBe("none");
    expect(room.game).toBeNull();
  });

  it("a game in progress comes back: same scores, same turn, same room epoch", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage).room;
    const { host } = startedGame(first);
    judgeCorrect(first, host, T1);
    const epoch = (storage.data.get(SNAPSHOT_KEY) as any).roomEpoch;

    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    expect(second.game!.teams.map((t) => [t.id, t.score])).toEqual(first.game!.teams.map((t) => [t.id, t.score]));
    expect(second.game!.currentTurnIndex).toBe(first.game!.currentTurnIndex);
    expect(second.game!.usedQuestionIds).toEqual(first.game!.usedQuestionIds);
    // A new connection is told the same epoch, so no client shows a false "game reset".
    const screen = makeConn("screen");
    second.onConnect(screen);
    expect(lastOf(screen, "STATE").roomEpoch).toBe(epoch);
  });

  it("a save from before branchChoices existed restores with it backfilled, not crashing on the next read", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    for (const t of saved.game.teams) delete t.branchChoices; // simulate a pre-DM-branching save
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    expect(second.room.game!.teams.every((t) => t.branchChoices !== undefined)).toBe(true);
    expect(second.room.game!.teams.map((t) => t.branchChoices)).toEqual([{}, {}]);
  });

  it("a save from before currentSelection existed restores with it backfilled to null, not crashing on the next read", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    for (const t of saved.game.teams) delete t.currentSelection; // simulate a pre-multipleChoice save
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    expect(second.room.game!.teams.every((t) => t.currentSelection === null)).toBe(true);
  });

  it("a corrupt snapshot with a null team entry doesn't crash restore (adversarial review, 2026-09-21)", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    saved.game.teams[0] = null; // snapshot.ts's shallow validation lets this through
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored"); // must not throw
    expect(second.room.game!.teams[0]).toBeNull(); // left as-is, not crashed on
    expect(second.room.game!.teams[1]!.branchChoices).toEqual({}); // the valid team still backfills fine
  });

  it("every team is offline until its phone rejoins", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const second = makeRoom(storage).room;
    await second.restore();
    expect(second.game!.teams.every((t) => !t.online)).toBe(true);
    send(second, makeConn("a-again"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    expect(second.game!.teams.find((t) => t.id === T1)!.online).toBe(true);
    expect(second.game!.teams.find((t) => t.id === T2)!.online).toBe(false);
  });

  it("team secrets survive: the right key gets back in, a stranger with only the public id does not", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const second = makeRoom(storage).room;
    await second.restore();
    const thief = makeConn("thief");
    send(second, thief, { type: "JOIN", teamId: T1, teamKey: "wrong-key-0123456789abcdef", teamName: "甲隊" });
    expect(lastOf(thief, "ERROR")).toMatchObject({ error: "bad_token" });
    expect(second.game!.teams.find((t) => t.id === T1)!.online).toBe(false);
  });

  it("the host token survives: the host gets back in, a newcomer cannot take the room over", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const second = makeRoom(storage).room;
    await second.restore();
    const intruder = makeConn("intruder");
    send(second, intruder, { type: "HOST_CLAIM", token: "another-token-0123456789abcd" });
    expect(lastOf(intruder, "ERROR")).toMatchObject({ error: "bad_token" });
    const host = makeConn("host-again");
    send(second, host, { type: "HOST_CLAIM", token: TOKEN });
    expect(lastOf(host, "HOST_OK")).toBeTruthy();
    rejoin(second, T1, TEAM_KEY, "a-again");
    send(second, host, { type: "HOST_CLAIM", token: TOKEN }); // a phone came back: the host is sent the answer again
    expect(lastOf(host, "HOST_ANSWER")).toBeTruthy();
  });

  it("nobody is on turn until a phone rejoins, then the turn and its question appear", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const second = makeRoom(storage).room;
    await second.restore();
    const screen = makeConn("screen");
    second.onConnect(screen);
    expect(lastOf(screen, "STATE").question).toBeNull(); // every team is offline, so no turn is in play
    rejoin(second, T2, TEAM_KEY + "2", "b-again");
    const state = second.game!;
    expect(state.turnOrder[state.currentTurnIndex]).toBeDefined();
    const after = makeConn("screen2");
    second.onConnect(after);
    expect(lastOf(after, "STATE").question).not.toBeNull();
  });

  it("the event counter continues, so narration ids never repeat", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage);
    const { host } = startedGame(first.room);
    judgeCorrect(first.room, host, T1);
    const seq = (storage.data.get(SNAPSHOT_KEY) as any).eventSeq;

    const second = makeRoom(storage);
    await second.room.restore();
    const host2 = makeConn("host2");
    send(second.room, host2, { type: "HOST_CLAIM", token: TOKEN });
    rejoin(second.room, T1, TEAM_KEY, "a-again");
    rejoin(second.room, T2, TEAM_KEY + "2", "b-again");
    send(second.room, host2, { type: "HOST_CLAIM", token: TOKEN }); // asks again now that someone is on turn
    const q = lastOf(host2, "HOST_ANSWER");
    const teamOnTurn = second.room.game!.turnOrder[second.room.game!.currentTurnIndex];
    send(second.room, host2, { type: "HOST_JUDGE", teamId: teamOnTurn, questionId: q.questionId, correct: true });
    const state = second.io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).findLast((m) => m.type === "STATE");
    expect(state.eventId).toBe(seq + 1);
  });

  it("the game keeps the bank it started with, not the bundled one", async () => {
    const custom = structuredClone(BANK);
    custom.rooms[0].questions[0].text = "自訂題庫的第一題";
    const storage = memoryStorage();
    const first = makeRoom(storage, { bank: custom }).room;
    startedGame(first);

    const second = makeRoom(storage).room; // built with the bundled bank
    await second.restore();
    rejoin(second, T1, TEAM_KEY, "a-again");
    const screen = makeConn("screen");
    second.onConnect(screen);
    expect(lastOf(screen, "STATE").question.text).toBe("自訂題庫的第一題");
  });

  it("a finished game whose epilogue was lost asks for it again", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    saved.game.phase = "finished";
    saved.game.winners = [T1];
    saved.epilogue = null;
    saved.epilogueRequested = true; // it had been asked for, and the promise died with the object
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    await second.room.restore();
    await vi.waitFor(() => {
      const types = second.io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string).type);
      expect(types).toContain("EPILOGUE");
    });
  });

  it("a finished game whose epilogue was saved does not write a second one", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    saved.game.phase = "finished";
    saved.game.winners = [T1];
    saved.epilogue = "已經寫好的後記";
    saved.epilogueRequested = true;
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    await second.room.restore();
    await new Promise((r) => setTimeout(r, 50));
    const types = second.io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string).type);
    expect(types).not.toContain("EPILOGUE");
    const late = makeConn("late");
    second.room.onConnect(late);
    expect(lastOf(late, "EPILOGUE")).toMatchObject({ text: "已經寫好的後記" });
  });
});

describe("saved data that cannot be used", () => {
  const cases: [string, unknown][] = [
    ["an unknown schema version", { schemaVersion: SCHEMA_VERSION + 1 }],
    ["something that is not a snapshot", "garbage"],
    ["a snapshot missing its fields", { schemaVersion: SCHEMA_VERSION }],
  ];

  for (const [name, bad] of cases) {
    it(`${name}: the room starts fresh under a NEW epoch instead of guessing`, async () => {
      const storage = memoryStorage();
      const first = makeRoom(storage).room;
      startedGame(first);
      const oldEpoch = (storage.data.get(SNAPSHOT_KEY) as any).roomEpoch;
      storage.data.set(SNAPSHOT_KEY, bad);

      const second = makeRoom(storage).room;
      expect(await second.restore()).toBe("discarded");
      expect(second.game).toBeNull();
      const screen = makeConn("screen");
      second.onConnect(screen);
      expect(lastOf(screen, "LOBBY").roomEpoch).not.toBe(oldEpoch);
    });
  }

  it("logs the discard by name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = memoryStorage();
    storage.data.set(SNAPSHOT_KEY, { schemaVersion: 0 });
    await makeRoom(storage).room.restore();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"state_discarded"'));
  });
});
