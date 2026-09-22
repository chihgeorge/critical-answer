/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import { CLOSE_IDLE } from "./close-codes";
import { SNAPSHOT_KEY } from "./snapshot";
import type { Conn, RoomIO, RoomStorage } from "./io";

const T1 = "00000000-0000-0000-0000-000000000001";
const TEAM_KEY = "team-key-0123456789abcdef";
const TOKEN = "host-token-0123456789abcdef";
const MIN = 60_000;
const IDLE = 120 * MIN;
const EXPIRE = 24 * 60 * MIN;

/** Storage with an alarm, like a Durable Object's: the test decides when it "rings" by calling onAlarm. */
function fakeStorage() {
  const data = new Map<string, unknown>();
  const s: RoomStorage & { data: Map<string, unknown>; alarms: number[]; deleted: string[]; puts: number } = {
    data,
    alarms: [],
    deleted: [],
    puts: 0,
    get: async (k) => structuredClone(data.get(k)),
    put(k, v) {
      s.puts++;
      data.set(k, structuredClone(v));
    },
    setAlarm(at) {
      s.alarms.push(at);
    },
    deleteAlarm() {
      s.deleted.push("alarm");
    },
    deleteAll() {
      s.deleted.push("all");
      data.clear();
    },
  };
  return s;
}

function setup(start = 1_000_000_000_000) {
  const clock = { t: start };
  const storage = fakeStorage();
  const closeAll = vi.fn();
  const io = { broadcast: vi.fn(), storage, closeAll } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { idleMs: IDLE, expireMs: EXPIRE, now: () => clock.t, epilogueDelayMs: 0 });
  return { room, storage, closeAll, clock, io };
}

const conn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, c: Conn, msg: object) => room.onMessage(JSON.stringify(msg), c);
const lastOf = (c: { send: ReturnType<typeof vi.fn> }, type: string) =>
  c.send.mock.calls.map((x) => JSON.parse(x[0] as string)).findLast((m) => m.type === type);

function startedGame(room: DungeonRoom) {
  const host = conn("host");
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  send(room, conn("a"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
  send(room, host, { type: "HOST_START", aiNarration: false });
  return host;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("what counts as activity", () => {
  it("the first message sets the alarm for one idle period from now", () => {
    const { room, storage, clock } = setup();
    send(room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    expect(storage.alarms).toEqual([clock.t + IDLE]);
  });

  it("later messages do not touch the alarm while it is already sooner than they would need", () => {
    const { room, storage, clock } = setup();
    const host = conn("h");
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    clock.t += 10 * MIN;
    send(room, conn("a"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    clock.t += 10 * MIN;
    send(room, host, { type: "HOST_START", aiNarration: false });
    expect(storage.alarms).toHaveLength(1);
  });

  it("a transcript download is not activity: it does not extend the room's life", async () => {
    const { room, storage, clock, closeAll } = setup();
    const host = conn("h");
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    clock.t += IDLE - MIN;
    send(room, host, { type: "HOST_GET_TRANSCRIPT" });
    clock.t += MIN;
    await room.onAlarm();
    expect(closeAll).toHaveBeenCalledWith(CLOSE_IDLE, "idle");
    expect(storage.alarms.at(-1)).toBe(clock.t - IDLE + EXPIRE); // next check at the expiry, dated from the real last activity
  });

  it("a message that is not valid is not activity either", async () => {
    const { room, storage } = setup();
    room.onMessage("not json", conn("x"));
    expect(storage.alarms).toEqual([]);
  });
});

describe("idle for two hours", () => {
  it("closes every connection with the idle code and keeps the game", async () => {
    const { room, storage, closeAll, clock } = setup();
    startedGame(room);
    const scores = JSON.stringify(room.game!.teams.map((t) => [t.id, t.score]));
    const epoch = (storage.data.get(SNAPSHOT_KEY) as any).roomEpoch;
    clock.t += IDLE;
    await room.onAlarm();
    expect(closeAll).toHaveBeenCalledWith(CLOSE_IDLE, "idle");
    expect(JSON.stringify(room.game!.teams.map((t) => [t.id, t.score]))).toBe(scores);
    expect((storage.data.get(SNAPSHOT_KEY) as any).hostToken).toBe(TOKEN);
    expect((storage.data.get(SNAPSHOT_KEY) as any).roomEpoch).toBe(epoch);
    expect(storage.deleted).toEqual([]);
  });

  it("logs the close by name", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { room, clock } = setup();
    send(room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    clock.t += IDLE;
    await room.onAlarm();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"room_idle_closed"'));
  });

  it("an alarm that rings early (activity happened since) only checks again later, and closes nothing", async () => {
    const { room, storage, closeAll, clock } = setup();
    const host = conn("h");
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    clock.t += IDLE - MIN;
    send(room, host, { type: "HOST_START", aiNarration: false }); // someone is still here
    clock.t += MIN;
    await room.onAlarm();
    expect(closeAll).not.toHaveBeenCalled();
    expect(storage.alarms.at(-1)).toBe(clock.t - MIN + IDLE);
  });

  it("someone reconnecting after the idle close starts a fresh idle period, not the 24 hour one", async () => {
    const { room, storage, clock } = setup();
    const host = conn("h");
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    clock.t += IDLE;
    await room.onAlarm(); // now waiting for the 24 hour expiry
    clock.t += 5 * MIN;
    send(room, host, { type: "HOST_CLAIM", token: TOKEN }); // the host clicks reconnect
    expect(storage.alarms.at(-1)).toBe(clock.t + IDLE);
  });
});

describe("idle for a day", () => {
  it("forgets the room: storage cleared, a new epoch, nobody holds the host seat any more", async () => {
    const { room, storage, closeAll, clock } = setup();
    startedGame(room);
    const oldEpoch = (storage.data.get(SNAPSHOT_KEY) as any).roomEpoch;
    clock.t += IDLE;
    await room.onAlarm();
    clock.t += EXPIRE - IDLE;
    await room.onAlarm();
    expect(closeAll).toHaveBeenLastCalledWith(CLOSE_IDLE, "expired");
    expect(storage.deleted).toEqual(["alarm", "all"]);
    expect(storage.data.size).toBe(0);
    expect(room.game).toBeNull();

    // The code is free: a brand new host claims it, and the room saves itself again from scratch.
    const newHost = conn("new-host");
    send(room, newHost, { type: "HOST_CLAIM", token: "another-token-0123456789abcd" });
    expect(lastOf(newHost, "HOST_OK")).toBeTruthy();
    const saved = storage.data.get(SNAPSHOT_KEY) as any;
    expect(saved.hostToken).toBe("another-token-0123456789abcd");
    expect(saved.roomEpoch).not.toBe(oldEpoch);
    expect(saved.game).toBeNull();
    expect(saved.teamKeys).toEqual([]);
  });

  it("logs the expiry by name", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { room, clock } = setup();
    send(room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    clock.t += EXPIRE;
    await room.onAlarm();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"room_expired"'));
  });

  it("an old team key does not work in the recycled room", async () => {
    const { room, clock, io } = setup();
    startedGame(room);
    clock.t += EXPIRE;
    await room.onAlarm();
    send(room, conn("phone"), { type: "JOIN", teamId: T1, teamKey: "a-different-key-0123456789abc", teamName: "新隊" });
    // A new team joining an empty lobby, not the old game's team: the old key is gone and so is the game.
    const lobby = io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).findLast((m) => m.type === "LOBBY");
    expect(lobby.teams).toEqual([{ id: T1, name: "新隊" }]);
    expect(room.game).toBeNull();
  });
});

describe("after a restart", () => {
  it("the alarm is set again from the saved last activity", async () => {
    const a = setup();
    send(a.room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    const savedAt = (a.storage.data.get(SNAPSHOT_KEY) as any).lastActivityAt;
    expect(savedAt).toBe(Math.floor(a.clock.t / MIN) * MIN); // to the minute

    const b = setup(a.clock.t + 30 * MIN);
    b.storage.data.set(SNAPSHOT_KEY, a.storage.data.get(SNAPSHOT_KEY));
    expect(await b.room.restore()).toBe("restored");
    expect(b.storage.alarms).toEqual([savedAt + IDLE]);
  });

  it("a room that was already idle when it restarted is set to expire, not to idle again", async () => {
    const a = setup();
    send(a.room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    const savedAt = (a.storage.data.get(SNAPSHOT_KEY) as any).lastActivityAt;
    const b = setup(a.clock.t + IDLE + 10 * MIN);
    b.storage.data.set(SNAPSHOT_KEY, a.storage.data.get(SNAPSHOT_KEY));
    await b.room.restore();
    expect(b.storage.alarms).toEqual([savedAt + EXPIRE]);
  });

  it("a save from before activity was tracked counts as active now, so it is never expired by surprise", async () => {
    const a = setup();
    send(a.room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    const legacy = structuredClone(a.storage.data.get(SNAPSHOT_KEY)) as any;
    delete legacy.lastActivityAt;
    const b = setup(a.clock.t + 3 * 24 * 60 * MIN);
    b.storage.data.set(SNAPSHOT_KEY, legacy);
    await b.room.restore();
    expect(b.storage.alarms).toEqual([b.clock.t + IDLE]);
  });

  it("messages inside the same minute do not make more writes", () => {
    const { room, storage, clock } = setup();
    const host = conn("h");
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    send(room, conn("a"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    const before = storage.puts;
    clock.t += 5_000;
    send(room, host, { type: "HOST_SET_NOTES", notes: "" }); // activity, but the saved state is identical to the minute
    expect(storage.puts).toBe(before);
  });
});
