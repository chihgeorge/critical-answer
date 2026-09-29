/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import { CLOSE_EXPIRED, CLOSE_IDLE } from "./close-codes";
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
  const s: RoomStorage & { data: Map<string, unknown>; alarms: number[]; deleted: string[]; puts: number; failAlarm: boolean; failDeleteAll: boolean } = {
    data,
    alarms: [],
    deleted: [],
    puts: 0,
    failAlarm: false,
    failDeleteAll: false,
    get: async (k) => structuredClone(data.get(k)),
    put(k, v) {
      s.puts++;
      data.set(k, structuredClone(v));
    },
    setAlarm(at) {
      if (s.failAlarm) throw new Error("alarm store down");
      s.alarms.push(at);
    },
    deleteAlarm() {
      s.deleted.push("alarm");
    },
    deleteAll() {
      if (s.failDeleteAll) {
        s.failDeleteAll = false;
        throw new Error("storage down");
      }
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
  it("a screen that never sends a message still gets the room a baseline: it rests after the idle time", async () => {
    const { room, storage, closeAll, clock } = setup();
    room.onConnect(conn("screen-only")); // /screen never sends anything, ever
    expect(storage.alarms).toEqual([clock.t + IDLE]); // primed exactly like a real message would
    clock.t += IDLE;
    await room.onAlarm();
    expect(closeAll).toHaveBeenCalledWith(CLOSE_IDLE, "idle");
  });

  it("a screen that keeps reconnecting after resting does not postpone resting forever", async () => {
    const { room, storage, clock } = setup();
    room.onConnect(conn("screen-1"));
    const primedAt = storage.alarms[0];
    clock.t += 10 * MIN;
    room.onConnect(conn("screen-2")); // reconnected (e.g. after a network blip), still nobody playing
    expect(storage.alarms.at(-1)).toBe(primedAt); // the baseline is not re-primed by a second connection
  });

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

  it("an automatic reconnect's re-identification (resume) is not activity, so it can't keep the room awake", async () => {
    const { room, closeAll, clock } = setup();
    const host = conn("h");
    const phone = conn("a");
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    clock.t += IDLE - MIN;
    // Both pages reconnect by themselves (a network blip) and say who they are again.
    send(room, conn("h2"), { type: "HOST_CLAIM", token: TOKEN, resume: true });
    send(room, conn("a2"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊", resume: true });
    clock.t += MIN;
    await room.onAlarm();
    expect(closeAll).toHaveBeenCalledWith(CLOSE_IDLE, "idle");
  });

  it("an automatic reconnect still gets its identity back (resume only affects the idle clock)", () => {
    const { room } = setup();
    send(room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    const back = conn("h2");
    send(room, back, { type: "HOST_CLAIM", token: TOKEN, resume: true });
    expect(lastOf(back, "HOST_OK")).toBeDefined();
  });

  it("an alarm firing on a room nobody has ever touched does nothing (no activity time to check against)", async () => {
    const { room, storage, closeAll } = setup();
    await room.onAlarm();
    expect(closeAll).not.toHaveBeenCalled();
    expect(storage.puts).toBe(0);
  });

  it("a message that is not valid is not activity either", async () => {
    const { room, storage } = setup();
    room.onMessage("not json", conn("x"));
    expect(storage.alarms).toEqual([]);
  });

  const lastActivityAt = (storage: ReturnType<typeof fakeStorage>) => (storage.data.get(SNAPSHOT_KEY) as any)?.lastActivityAt;

  it("a rejected message is not activity: a stranger guessing keys cannot keep a room from resting", () => {
    const { room, storage, clock } = setup();
    send(room, conn("h"), { type: "HOST_CLAIM", token: TOKEN }); // real activity
    const before = lastActivityAt(storage);
    clock.t += 5 * MIN;
    send(room, conn("stranger"), { type: "HOST_CLAIM", token: "wrong-token-0123456789abcdef" });
    expect(lastActivityAt(storage)).toBe(before);
  });

  it("a request for a not-yet-started game (no_active_game) is not activity", () => {
    const { room, storage, clock } = setup();
    send(room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    const before = lastActivityAt(storage);
    clock.t += 5 * MIN;
    send(room, conn("intruder"), { type: "HOST_JUDGE", teamId: T1, questionId: "x", correct: true });
    expect(lastActivityAt(storage)).toBe(before);
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
    send(room, host, { type: "HOST_CLAIM", token: TOKEN }); // someone is still here (an accepted reclaim)
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
    // Its own code, not the idle one: the pages must say the game is gone, not "still saved".
    expect(closeAll).toHaveBeenLastCalledWith(CLOSE_EXPIRED, "expired");
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

describe("onAlarm waits for its own rescheduled alarm to be durable", () => {
  it("does not resolve until the platform confirms the new alarm is set", async () => {
    // Unlike onMessage (whose fire-and-forget write is protected by a send/broadcast right after it),
    // onAlarm's own return is what tells the platform this alarm was handled — so if it resolved before
    // setAlarm's write landed, the object could be evicted and the rescheduled alarm silently lost.
    const { room, storage, clock } = setup();
    send(room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    let releaseSetAlarm: () => void = () => {};
    const gate = new Promise<void>((res) => (releaseSetAlarm = res));
    let setAlarmCalled = false;
    const realSetAlarm = storage.setAlarm!.bind(storage);
    storage.setAlarm = async (at: number) => {
      setAlarmCalled = true;
      await gate;
      return realSetAlarm(at);
    };
    clock.t += IDLE - MIN; // not yet due: onAlarm's "check again later" branch reschedules
    const alarmDone = room.onAlarm();
    let resolved = false;
    void alarmDone.then(() => (resolved = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(setAlarmCalled).toBe(true);
    expect(resolved).toBe(false); // still waiting on the gated write
    releaseSetAlarm();
    await alarmDone;
    expect(resolved).toBe(true);
  });
});

describe("the window while expire() is clearing storage", () => {
  it("a connection that arrives mid-expire is refused, not resurrected into the wiped room", async () => {
    const { room, storage, clock } = setup();
    startedGame(room);
    clock.t += EXPIRE;
    // A slow deleteAll lets us open a connection while expire() is still in flight.
    let releaseDelete: () => void = () => {};
    const gate = new Promise<void>((res) => (releaseDelete = res));
    const realDeleteAll = storage.deleteAll!.bind(storage);
    storage.deleteAll = async () => {
      await gate;
      return realDeleteAll();
    };
    const alarmDone = room.onAlarm();
    await new Promise((r) => setTimeout(r, 0)); // let expire() reach the slow deleteAll
    const sneaky = conn("sneaky");
    room.onConnect(sneaky);
    expect(sneaky.close).toHaveBeenCalled(); // refused outright, not queued behind the wipe
    releaseDelete();
    await alarmDone;
    expect(storage.data.size).toBe(0); // the sneaky connection wrote nothing back
  });
});

describe("when the platform misbehaves", () => {
  it("a failing setAlarm is logged by name and does not stop the room from working", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { room, storage } = setup();
    storage.failAlarm = true;
    const host = conn("h");
    expect(() => send(room, host, { type: "HOST_CLAIM", token: TOKEN })).not.toThrow();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('"event":"alarm_failed"'));
    expect(lastOf(host, "HOST_OK")).toBeTruthy(); // the host still got in
  });

  it("if clearing storage fails, the room is not reset, and the alarm's retry finishes the job", async () => {
    const { room, storage, clock } = setup();
    startedGame(room);
    clock.t += EXPIRE;
    storage.failDeleteAll = true;
    await expect(room.onAlarm()).rejects.toThrow("storage down"); // the platform retries an alarm that throws
    expect(room.game).not.toBeNull(); // still the old room, still saved: nothing half-forgotten
    expect(storage.data.size).toBeGreaterThan(0);
    await room.onAlarm(); // the retry
    expect(room.game).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("a forgotten room is exactly a room nobody used, apart from its epoch (nothing was left out of the reset)", async () => {
    const fresh = (setup().room as any).persistedState();
    const used = setup();
    startedGame(used.room);
    used.room.onMessage(JSON.stringify({ type: "HOST_SET_NOTES", notes: "武俠風" }), conn("h2"));
    used.clock.t += EXPIRE;
    await used.room.onAlarm();
    const after = (used.room as any).persistedState();
    expect({ ...after, roomEpoch: "-" }).toEqual({ ...fresh, roomEpoch: "-" });
    expect(after.roomEpoch).not.toBe(fresh.roomEpoch);
  });
});

describe("after a restart", () => {
  it("with a short idle time (as e2e/lifecycle.spec.ts configures), a restart right after activity does not expire an active game", async () => {
    // Codex outside review: a fixed one-minute rounding would make this indistinguishable from 59s of
    // silence at short configured durations, wiping an active game on restart. Granularity must scale down.
    const shortIdle = 2000; // matches e2e/lifecycle.spec.ts's ROOM_IDLE_MS
    const shortExpire = 6000;
    const a = setup();
    const aRoom = new (a.room.constructor as any)(a.io, () => 0, { idleMs: shortIdle, expireMs: shortExpire, now: () => a.clock.t });
    send(aRoom, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    const savedAt = (a.storage.data.get(SNAPSHOT_KEY) as any).lastActivityAt;
    expect(a.clock.t - savedAt).toBeLessThan(100); // rounding error stays small relative to a 2s window

    const b = setup(a.clock.t + 500); // "restarted" half a second later
    const bRoom = new (a.room.constructor as any)(b.io, () => 0, { idleMs: shortIdle, expireMs: shortExpire, now: () => b.clock.t });
    b.storage.data.set(SNAPSHOT_KEY, a.storage.data.get(SNAPSHOT_KEY));
    expect(await bRoom.restore()).toBe("restored");
    await bRoom.onAlarm(); // due at savedAt + shortIdle, which has not arrived yet
    expect(b.io.closeAll).not.toHaveBeenCalled(); // must not be treated as already idle
  });

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

  it("a room that was already past its expiry when it restarted is due at once, and forgotten by that alarm", async () => {
    const a = setup();
    send(a.room, conn("h"), { type: "HOST_CLAIM", token: TOKEN });
    const b = setup(a.clock.t + EXPIRE + 5 * MIN);
    b.storage.data.set(SNAPSHOT_KEY, a.storage.data.get(SNAPSHOT_KEY));
    await b.room.restore();
    expect(b.storage.alarms).toEqual([b.clock.t]); // not in the past, not a day away: now
    await b.room.onAlarm();
    expect(b.storage.data.size).toBe(0);
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
