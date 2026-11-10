/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DungeonRoom, LOST_CRIT_GAP_MS } from "./dungeon-room";
import { BANK_KEY, SCHEMA_VERSION, SNAPSHOT_KEY } from "./snapshot";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { BANK } from "../question-bank-data";
import { FINISH_PODIUM_MS } from "../protocol";
import type { Beat } from "../podium";
import type { NarrationEvent } from "../narration/events";
import { checkKey, currentTurnTeamId, getSpectatorView } from "../game-state";
// Room tests judge turns with HOST_JUDGE, so they play the bundled bank as text questions.
vi.mock("../question-bank-data", async (actual) => {
  const { asTextBank } = await import("../text-bank");
  return { BANK: asTextBank((await actual<typeof import("../question-bank-data")>()).BANK) };
});

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

/** A /screen socket, announced the way the page does on open. */
function screenOf(room: DungeonRoom) {
  const conn = makeConn("screen");
  room.onConnect(conn);
  send(room, conn, { type: "SCREEN_HELLO", key: (room as unknown as { screenKey: string }).screenKey });
  return conn;
}

function makeRoom(storage: RoomStorage, opts: ConstructorParameters<typeof DungeonRoom>[2] = {}, log: string[] = []) {
  const io: RoomIO & { broadcast: ReturnType<typeof vi.fn> } = {
    broadcast: vi.fn(() => void log.push("broadcast")),
    storage,
  };
  return { room: new DungeonRoom(io, () => 0, { epilogueDelayMs: 0, ...opts }), io };
}

const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
/** 上菜 then 下一題 (monster-cuisine.md cooking I2), skipping the cooking's hold a real host waits out. */
function serveNext(room: DungeonRoom, conn: Conn, eventId: number) {
  send(room, conn, { type: "HOST_SERVE", eventId });
  (room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(room, conn, { type: "HOST_NEXT", eventId });
}

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
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

  it("the screen key comes back, so the big screen link the host already opened still gets videos; a save from before the key gets one", async () => {
    const storage = memoryStorage();
    const keyAfterClaim = (room: DungeonRoom): string => {
      const host = makeConn("host");
      send(room, host, { type: "HOST_CLAIM", token: TOKEN });
      return lastOf(host, "HOST_OK").screenKey;
    };
    const key = keyAfterClaim(makeRoom(storage).room);
    expect((storage.data.get(SNAPSHOT_KEY) as any).screenKey).toBe(key);
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    expect(keyAfterClaim(second)).toBe(key);

    // A save an older Worker wrote, and one whose key is damaged: the room makes a key, saves it, and keeps it.
    for (const damaged of [undefined, "", 7]) {
      const old = { ...(storage.data.get(SNAPSHOT_KEY) as any), screenKey: damaged };
      if (damaged === undefined) delete old.screenKey;
      storage.data.set(SNAPSHOT_KEY, old);
      const third = makeRoom(storage).room;
      expect(await third.restore()).toBe("restored");
      const made = keyAfterClaim(third);
      expect(made).toMatch(/^[0-9a-f]{8}-[0-9a-f-]+$/);
      expect(made).not.toBe(key);
      const fourth = makeRoom(storage).room;
      expect(await fourth.restore()).toBe("restored");
      expect(keyAfterClaim(fourth)).toBe(made);
    }
  });

  it("the join password comes back: a stranger still cannot join the lobby after a restart", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage).room;
    const host = makeConn("host");
    send(first, host, { type: "HOST_CLAIM", token: TOKEN });
    send(first, host, { type: "HOST_SET_PASSWORD", password: "dragon" });
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    const stranger = makeConn("stranger");
    send(second, stranger, { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    expect(lastOf(stranger, "ERROR")).toMatchObject({ error: "bad_password" });
  });

  // Value: protects=a junk or refused message does not serialize the whole room (bank included) on the single-threaded
  // room; fails_when=an ERROR reply saves the room first
  it("an ERROR reply does not serialize the room to save it", () => {
    const { room } = makeRoom(memoryStorage());
    const stranger = makeConn("stranger");
    room.onConnect(stranger);
    const snapshots = vi.spyOn(room as any, "persistedState");
    for (let i = 0; i < 5; i++) {
      room.onMessage("{}", stranger);
      send(room, stranger, { type: "HOST_START" });
    }
    expect(lastOf(stranger, "ERROR")).toMatchObject({ error: "not_host" });
    expect(snapshots).not.toHaveBeenCalled();
  });

  // Value: protects=the big screen keeps the epilogue page the host turned to across a restart; fails_when=the page is
  // not saved, or a save whose page is past the last one is restored as is (a blank TV page)
  it("the epilogue page the host turned to comes back after a restart, and a page past the last one starts over", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage).room;
    const host = makeConn("host");
    send(first, host, { type: "HOST_CLAIM", token: TOKEN });
    (first as any).epilogue = "甲".repeat(100) + "。" + "乙".repeat(100) + "。"; // two pages
    (first as any).epiloguePage = 1;
    send(first, host, { type: "HOST_CLAIM", token: TOKEN }); // any message saves the change
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    expect((second as any).epiloguePage).toBe(1);
    (storage.data.get(SNAPSHOT_KEY) as any).epiloguePage = 5;
    const third = makeRoom(storage).room;
    expect(await third.restore()).toBe("restored");
    expect((third as any).epiloguePage).toBe(0);
  });

  it("after 回到大廳 a restart still deals the first game's shown answers last", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage).room;
    const host = makeConn("host");
    send(first, host, { type: "HOST_CLAIM", token: TOKEN });
    send(first, makeConn("p1"), { type: "JOIN", teamId: T1, teamKey: TEAM_KEY, teamName: "甲隊" });
    send(first, host, { type: "HOST_START" });
    const q = first.game!.teams[0].currentQuestionId;
    send(first, host, { type: "HOST_JUDGE", teamId: T1, questionId: q, correct: true, fleeChoice: "retry" });
    send(first, host, { type: "HOST_END_GAME" });
    send(first, host, { type: "HOST_BACK_TO_LOBBY" });
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    const host2 = makeConn("host2");
    send(second, host2, { type: "HOST_CLAIM", token: TOKEN });
    send(second, host2, { type: "HOST_START" });
    expect(second.game!.teams[0].currentQuestionId).not.toBe(q);
  });

  it("the host's queued next line comes back, and the host page is told about it", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage).room;
    const host = makeConn("host");
    send(first, host, { type: "HOST_CLAIM", token: TOKEN });
    send(first, host, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    const back = makeConn("host2");
    send(second, back, { type: "HOST_CLAIM", token: TOKEN });
    expect(lastOf(back, "HOST_NEXT_LINE_STATE")).toEqual({ type: "HOST_NEXT_LINE_STATE", line: "珍珠能吃嗎" });
  });

  it("a used next line is cleared in the same save as the narration that said it, so a restart cannot replay it", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage, { holdMs: 20 }).room;
    const { host } = startedGame(first);
    send(first, host, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
    judgeCorrect(first, host, T1);
    await new Promise((r) => setTimeout(r, 40));
    const saved = storage.data.get(SNAPSHOT_KEY) as any;
    expect(saved.lastNarration.lines[1]).toBe("珍珠能吃嗎");
    expect(saved.nextLine).toBeNull();
  });

  // /review: saved mid ending narration, the line would sit in a finished game's save forever.
  it("a finished game saved with a queued line comes back without it", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage).room;
    const { host } = startedGame(first);
    send(first, host, { type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
    const saved = storage.data.get(SNAPSHOT_KEY) as any;
    storage.data.set(SNAPSHOT_KEY, { ...saved, game: { ...saved.game, phase: "finished", winners: [] } });
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    const back = makeConn("host2");
    send(second, back, { type: "HOST_CLAIM", token: TOKEN });
    expect(lastOf(back, "HOST_NEXT_LINE_STATE")).toEqual({ type: "HOST_NEXT_LINE_STATE", line: "" });
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

  // Value: protects=the defeat counts, each team's count at room entry and the variant seed survive a restart, so a reloaded big screen shows the same hats; fails_when=either field is dropped on save or restore; why_new=new GameState fields (monster-catalog.md §3); seam=none; no_claim=a real Durable Object
  it("a game's monster defeats and variant seed come back after a restart", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage).room;
    const { host } = startedGame(first);
    judgeCorrect(first, host, T1);
    expect(first.game!.defeats).toEqual({ [BANK.rooms[0].monster]: 1 });
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    expect(second.game!.defeats).toEqual(first.game!.defeats);
    expect(second.game!.variantSeed).toBe(first.game!.variantSeed);
    expect(second.game!.teams.map((t) => t.metDefeats)).toEqual(first.game!.teams.map((t) => t.metDefeats));
  });

  // Value: protects=a save from before the catalog (no defeats, no seed) still restores and plays; fails_when=a missing field fails the restore; why_new=new optional fields; seam=none; no_claim=a real Durable Object
  it("a save from before monster defeats restores and plays on", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const snap = storage.data.get(SNAPSHOT_KEY) as any;
    delete snap.game.defeats;
    delete snap.game.variantSeed;
    const second = makeRoom(storage).room;
    expect(await second.restore()).toBe("restored");
    expect(second.game!.defeats).toBeUndefined();
    expect(second.game!.variantSeed).toBeUndefined();
  });

  // The branch choice was removed in v0.31.3.0, but a save from before keeps it on every team.
  it("a save whose teams still carry branchChoices restores and plays on", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    for (const t of saved.game.teams) t.branchChoices = { 1: "fight" };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    const host2 = makeConn("host2");
    send(second.room, host2, { type: "HOST_CLAIM", token: TOKEN });
    rejoin(second.room, T1, TEAM_KEY, "a-again");
    rejoin(second.room, T2, TEAM_KEY + "2", "b-again");
    send(second.room, host2, { type: "HOST_CLAIM", token: TOKEN });
    const t0 = second.room.game!.turnOrder[0];
    judgeCorrect(second.room, host2 as any, t0);
    expect(lastOf(host2, "ERROR")).toBeUndefined();
    expect(second.room.game!.teams.find((t) => t.id === t0)!.score).toBe(1);
    expect(getSpectatorView(second.room.game!).teams[0]).not.toHaveProperty("branchChoices");
  });

  it("a saved shuffled option order comes back unchanged after a restart", async () => {
    // Picks, locks and eliminated are shown indexes, so a restore that drops or resets optionOrder
    // would judge every multipleChoice lock against bank order (testing review, /ship).
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    saved.game.optionOrder = { "some-mc": [2, 0, 3, 1] };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    expect(second.room.game!.optionOrder).toEqual({ "some-mc": [2, 0, 3, 1] });
  });

  it("a wrong answer awaiting its choice survives a restart", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const t0 = saved.game.turnOrder[0];
    const q = saved.game.teams.find((t: any) => t.id === t0).currentQuestionId;
    saved.game.pendingWrong = { teamId: t0, questionId: q, optionIndex: 1 };
    saved.game.eliminated = { [q]: [1] };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    expect(second.room.game!.pendingWrong).toEqual({ teamId: t0, questionId: q, optionIndex: 1 });
    expect(second.room.game!.eliminated).toEqual({ [q]: [1] });
  });

  // Value: protects=a cleric's fill-in wait (optionIndex null) survives a restart (#106 AC13); fails_when=restore drops it
  // and the team loses its 祈禱; seam=snapshot round trip; no_claim=the wait's buttons
  it("a cleric's fill-in wait survives a restart", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const t0 = saved.game.turnOrder[0];
    const q = saved.game.teams.find((t: any) => t.id === t0).currentQuestionId;
    saved.game.pendingWrong = { teamId: t0, questionId: q, optionIndex: null };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    expect(second.room.game!.pendingWrong).toEqual({ teamId: t0, questionId: q, optionIndex: null });
  });

  // Value: protects=a mage's fill-in hint survives a restart, and a save from before #106 (no mageHints) still restores;
  // fails_when=the hint is dropped on restore, or reading an old save throws; seam=snapshot round trip; no_claim=rendering
  it("a mage's fill-in hint survives a restart, and a save without mageHints restores with none", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    expect(saved.game.mageHints).toBeUndefined(); // what a pre-#106 save looks like
    storage.data.set(SNAPSHOT_KEY, saved);
    const old = makeRoom(storage);
    expect(await old.room.restore()).toBe("restored");
    expect(getSpectatorView(old.room.game!).mageHints).toEqual({});

    saved.game.mageHints = { q1: "萬" };
    storage.data.set(SNAPSHOT_KEY, saved);
    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    expect(second.room.game!.mageHints).toEqual({ q1: "萬" });
  });

  // Value: protects=a typed answer waiting for the host survives a restart and keeps its team on turn (AC7);
  // fails_when=the field is dropped on save or restore; no_claim=old saves (they have no field: the view reads null).
  it("a typed answer waiting for the host survives a restart, and its team keeps the turn", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const first = makeRoom(storage);
    await first.room.restore();
    const t0 = first.room.game!.turnOrder[0];
    const conn = t0 === T1 ? rejoin(first.room, T1, TEAM_KEY, "a2") : rejoin(first.room, T2, TEAM_KEY + "2", "b2");
    // The persuasion check comes first (dnd design R6); its record is saved with the game, so a restart cannot reroll it.
    const key = checkKey(first.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId, t0);
    first.room.game = { ...first.room.game!, checks: { [key]: { value: 3, bonus: 0, dc: 8, passed: false } } };
    send(first.room, conn, { type: "TEAM_SUBMIT_TEXT", questionId: first.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId, text: "Don't" });

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    expect(second.room.game!.teams.find((t) => t.id === t0)!.typedAnswer).toBe("Don't");
    expect(currentTurnTeamId(second.room.game!)).toBe(t0); // every phone is offline after a restart
    expect(second.room.game!.checks?.[key]).toMatchObject({ value: 3, passed: false });
  });

  // Value: protects=a natural 20 whose beat a restart cut off still wins (dnd design R7); fails_when=restore ignores
  // the saved record, so the team keeps a question it already won; no_claim=the narration of that win.
  it("a natural 20 cut off by a restart wins once the room is back", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const t0 = saved.game.turnOrder[saved.game.currentTurnIndex];
    const team = saved.game.teams.find((t: any) => t.id === t0);
    const q = team.currentQuestionId;
    saved.game.checks = { [checkKey(q, t0)]: { value: 20, bonus: 0, dc: 8, passed: true } };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    // Every phone is offline after a restart: the win waits for one to come back.
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).toBe(q);
    if (t0 === T1) rejoin(second.room, T1, TEAM_KEY, "a2");
    else rejoin(second.room, T2, TEAM_KEY + "2", "b2");
    const after = second.room.game!.teams.find((t) => t.id === t0)!;
    expect(after.score).toBeGreaterThan(team.score);
    expect(after.currentQuestionId).not.toBe(q);
    // Saved after the win: another restart and rejoin do not win it again.
    const third = makeRoom(storage);
    await third.room.restore();
    if (t0 === T1) rejoin(third.room, T1, TEAM_KEY, "a3");
    else rejoin(third.room, T2, TEAM_KEY + "2", "b3");
    expect(third.room.game!.teams.find((t) => t.id === t0)!.score).toBe(after.score);
  });

  // Value: protects=a natural 20 whose win already failed is not applied after a restart, nor after 回到大廳 (TODOS
  // 說服檢定 1, 2); fails_when=lostCritOf ignores `dropped`, or applyLostCrit keeps it outside play.
  it("a dropped natural 20 does not win after a restart, and a lost one is forgotten outside play", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const t0 = saved.game.turnOrder[saved.game.currentTurnIndex];
    const q = saved.game.teams.find((t: any) => t.id === t0).currentQuestionId;
    saved.game.checks = { [checkKey(q, t0)]: { value: 20, bonus: 0, dc: 8, passed: true, dropped: true } };
    storage.data.set(SNAPSHOT_KEY, saved);
    const second = makeRoom(storage);
    await second.room.restore();
    expect((second.room as any).lostCrit).toBeNull();

    const r = second.room as any;
    r.lostCrit = { teamId: t0, questionId: q };
    r.game = { ...r.game, phase: "finished" };
    r.broadcastState();
    expect(r.lostCrit).toBeNull();
  });

  // Value: protects=a lost natural 20 that is the killing blow plays the 4d20 beat once the room is back (kill-roll.md);
  // fails_when=applyLostCrit judges the kill outside judgeNow's deferral, or the kill is lost; no_claim=the dice values
  it("a lost natural 20 that kills the boss rolls the 4d20 beat once the room is back", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const t0 = saved.game.turnOrder[saved.game.currentTurnIndex];
    saved.game.teams = saved.game.teams.map((t: any) => ({ ...t, inBoss: true }));
    saved.game.boss = { ...saved.game.boss, hp: 1, phaseIndex: saved.game.boss.phases.length - 1 };
    const q = saved.game.boss.currentQuestionId;
    saved.game.checks = { [checkKey(q, t0)]: { value: 20, bonus: 0, dc: 8, passed: true } };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    expect(await second.room.restore()).toBe("restored");
    if (t0 === T1) rejoin(second.room, T1, TEAM_KEY, "a2");
    else rejoin(second.room, T2, TEAM_KEY + "2", "b2");
    expect((second.room as any).pendingRoll).toMatchObject({ teamId: t0, kind: "kill" });
    expect(second.room.game!.phase).toBe("playing");
    vi.advanceTimersByTime(4000);
    expect(second.room.game!.phase).toBe("finished");
    expect(second.room.game!.boss.killedByTeamId).toBe(t0);
    vi.useRealTimers();
  });

  // Value: protects=the lost natural 20 survives another team playing first (review finding); fails_when=only the
  // crit team's own rejoin applies it; no_claim=more than two teams.
  it("a lost natural 20 still wins when another team's phone comes back and plays first", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const t0 = saved.game.turnOrder[saved.game.currentTurnIndex];
    const other = t0 === T1 ? T2 : T1;
    const q = saved.game.teams.find((t: any) => t.id === t0).currentQuestionId;
    saved.game.checks = { [checkKey(q, t0)]: { value: 20, bonus: 0, dc: 8, passed: true } };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    await second.room.restore();
    const host = makeConn("host2");
    send(second.room, host, { type: "HOST_CLAIM", token: TOKEN });
    if (other === T1) rejoin(second.room, T1, TEAM_KEY, "a2");
    else rejoin(second.room, T2, TEAM_KEY + "2", "b2");
    expect(currentTurnTeamId(second.room.game!)).toBe(other);
    send(second.room, host, { type: "HOST_CLAIM", token: TOKEN }); // asks again now that someone is on turn
    judgeCorrect(second.room, host, other);
    expect(currentTurnTeamId(second.room.game!)).toBe(other); // the crit team's phone is still away
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).toBe(q);
    if (t0 === T1) rejoin(second.room, T1, TEAM_KEY, "a3");
    else rejoin(second.room, T2, TEAM_KEY + "2", "b3");
    // The turn passed it while its phone was away: it wins when the turn order reaches it again.
    serveNext(second.room, host, (second.room as any).eventSeq);
    send(second.room, host, { type: "HOST_CLAIM", token: TOKEN });
    judgeCorrect(second.room, host, other);
    // The turn now reaches the crit team, but the win waits for the answer reveal to close (nobody plays under it).
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).toBe(q);
    serveNext(second.room, host, (second.room as any).eventSeq);
    vi.advanceTimersByTime(LOST_CRIT_GAP_MS); // the reveal's 答對 cue was a moment ago in this test
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).not.toBe(q);
    vi.useRealTimers();
  });

  // Value: protects=a lost natural 20 never judges inside another judgment (fix-check finding); fails_when=it runs
  // from that judgment's own STATE, ahead of its narration and phase card.
  // Value: protects=the 答錯's cue and story are not cut off by the lost natural 20's (TODOS 說服檢定 3); fails_when=it
  // judges at once, in the same handler.
  it("a wrong answer that passes the turn to the crit team finishes before the lost natural 20 wins", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const t0 = saved.game.turnOrder[(saved.game.currentTurnIndex + 1) % 2];
    const other = t0 === T1 ? T2 : T1;
    const q = saved.game.teams.find((t: any) => t.id === t0).currentQuestionId;
    saved.game.checks = { [checkKey(q, t0)]: { value: 20, bonus: 0, dc: 8, passed: true } };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    await second.room.restore();
    const host = makeConn("host2");
    send(second.room, host, { type: "HOST_CLAIM", token: TOKEN });
    rejoin(second.room, T1, TEAM_KEY, "a2");
    rejoin(second.room, T2, TEAM_KEY + "2", "b2");
    expect(currentTurnTeamId(second.room.game!)).toBe(other);
    send(second.room, host, { type: "HOST_CLAIM", token: TOKEN });
    const seq = (second.room as any).eventSeq;
    send(second.room, host, { type: "HOST_JUDGE", teamId: other, questionId: lastOf(host, "HOST_ANSWER").questionId, correct: false, fleeChoice: "flee" });
    // The 答錯's cue plays and its story starts first; the natural 20 waits a beat.
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).toBe(q);
    expect((second.room as any).cue).toBe("flee");
    vi.advanceTimersByTime(LOST_CRIT_GAP_MS);
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).not.toBe(q);
    // The wrong answer's STATE goes out first, then the natural 20's, each with its own event.
    const ids = second.io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).filter((m) => m.type === "STATE" && m.eventId > seq).map((m) => m.eventId);
    expect(ids[0]).toBe(seq + 1);
    expect(ids.at(-1)).toBe(seq + 2);
    vi.useRealTimers();
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
    expect(second.room.game!.teams[1]!.id).toBe(T2); // the valid team is untouched
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

  it("the multi-segment narration (lines[]) survives a restart and is replayed whole to a late connection", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage, { holdMs: 10 });
    const { host } = startedGame(first.room);
    judgeCorrect(first.room, host, T1); // a judgment with a next team: lines has result + atmosphere + transition
    await new Promise((r) => setTimeout(r, 30)); // the runner writes lastNarration asynchronously
    const savedLines = (storage.data.get(SNAPSHOT_KEY) as any).lastNarration.lines;
    expect(savedLines.length).toBeGreaterThanOrEqual(2); // not the old single `line`/`then` shape

    const second = makeRoom(storage);
    await second.room.restore();
    const late = makeConn("late");
    second.room.onConnect(late);
    const replayed = lastOf(late, "NARRATION");
    expect(replayed.lines).toEqual(savedLines);
    expect(replayed).not.toHaveProperty("line");
    expect(replayed).not.toHaveProperty("then");
  });

  // Value: protects=the big screen's reading progress and the edit revision survive a restart (host-narration-edit.md D14);
  // fails_when=a restored room forgets `done` (every read line editable again), forgets `rev` (an old report locks new
  // text), or a save from before them does not restore at all.
  it("reading progress is saved even with no host page connected", async () => {
    // Value: protects=a read line stays locked after a restart while the host's phone sleeps (D14); fails_when=
    // handleNarrationProgress saves only through sendTo to host pages, so with none connected nothing is written.
    const storage = memoryStorage();
    const first = makeRoom(storage, { holdMs: 10 });
    const { host } = startedGame(first.room);
    judgeCorrect(first.room, host, T1);
    await new Promise((r) => setTimeout(r, 30));
    const eventId = (storage.data.get(SNAPSHOT_KEY) as any).lastNarration.eventId;
    first.room.onClose(host);
    send(first.room, screenOf(first.room), { type: "SCREEN_NARRATION_PROGRESS", eventId, rev: 0, done: 2 });
    expect((storage.data.get(SNAPSHOT_KEY) as any).lastNarration).toMatchObject({ eventId, done: 2 });
  });

  it("reading progress and the edit revision survive a restart; an older save without them restores as 0", async () => {
    const storage = memoryStorage();
    const first = makeRoom(storage, { holdMs: 10 });
    const { host } = startedGame(first.room);
    judgeCorrect(first.room, host, T1);
    await new Promise((r) => setTimeout(r, 30));
    const eventId = (storage.data.get(SNAPSHOT_KEY) as any).lastNarration.eventId;
    send(first.room, host, { type: "HOST_EDIT_NARRATION", eventId, rev: 0, index: 1, line: "改過的第二句" });
    send(first.room, screenOf(first.room), { type: "SCREEN_NARRATION_PROGRESS", eventId, rev: 1, done: 1 });
    expect((storage.data.get(SNAPSHOT_KEY) as any).lastNarration).toMatchObject({ eventId, rev: 1, done: 1 });

    const second = makeRoom(storage);
    await second.room.restore();
    const host2 = makeConn("host2");
    second.room.onConnect(host2);
    send(second.room, host2, { type: "HOST_CLAIM", token: TOKEN });
    expect(lastOf(host2, "NARRATION")).toMatchObject({ eventId, rev: 1 });
    expect(lastOf(host2, "HOST_NARRATION_PROGRESS")).toEqual({ type: "HOST_NARRATION_PROGRESS", eventId, done: 1 });
    send(second.room, host2, { type: "HOST_EDIT_NARRATION", eventId, rev: 1, index: 0, line: "太晚了" });
    expect(lastOf(host2, "ERROR")).toMatchObject({ detail: "line_read" });

    const old = structuredClone(storage.data.get(SNAPSHOT_KEY) as any);
    delete old.lastNarration.rev;
    delete old.lastNarration.done;
    storage.data.set(SNAPSHOT_KEY, old);
    const third = makeRoom(storage);
    expect(await third.room.restore()).toBe("restored");
    const host3 = makeConn("host3");
    third.room.onConnect(host3);
    send(third.room, host3, { type: "HOST_CLAIM", token: TOKEN });
    expect(lastOf(host3, "HOST_NARRATION_PROGRESS")).toMatchObject({ done: 0 });
  });

  it("the game keeps the bank it started with, not the bundled one", async () => {
    const custom = structuredClone(BANK);
    custom.pools[1][0].content.value = "自訂題庫的第一題";
    const storage = memoryStorage();
    const first = makeRoom(storage, { bank: custom }).room;
    startedGame(first);

    const second = makeRoom(storage).room; // built with the bundled bank
    await second.restore();
    rejoin(second, T1, TEAM_KEY, "a-again");
    second.game = { ...second.game!, checks: { [checkKey(second.game!.teams[0].currentQuestionId, T1)]: { value: 10, bonus: 0, dc: 8, passed: true } } };
    const screen = makeConn("screen");
    second.onConnect(screen);
    expect(lastOf(screen, "STATE").question.content).toEqual({ kind: "text", value: "自訂題庫的第一題" });
  });

  // Value: protects=the bank is not rewritten by every message's save; fails_when=persist() puts BANK_KEY on each change
  // or the snapshot embeds the bank again; seam=storage keys; no_claim=Cloudflare's write batching
  it("the bank is saved under its own key once, and a normal message's save does not write it again", () => {
    const storage = memoryStorage();
    const keys: string[] = [];
    const put = storage.put;
    storage.put = (k, v) => {
      keys.push(k);
      return put(k, v);
    };
    const { room } = makeRoom(storage);
    const { host } = startedGame(room);
    expect(keys.filter((k) => k === BANK_KEY)).toHaveLength(1);
    expect(storage.data.get(SNAPSHOT_KEY)).not.toHaveProperty("bank");
    const before = keys.length;
    judgeCorrect(room, host, T1);
    expect(keys.slice(before)).toEqual([SNAPSHOT_KEY]);
  });

  // Value: protects=a failed bank write is retried, not believed saved; fails_when=persist()'s failure path keeps
  // savedBank, so later saves skip BANK_KEY and a restart discards the room; seam=storage keys; no_claim=Cloudflare's write batching
  it("a failed bank write is retried on the next save, so the room still restores", async () => {
    const storage = memoryStorage();
    const { room } = makeRoom(storage);
    storage.failNext = true; // the first save's first put is the bank
    startedGame(room);
    expect(storage.data.get(BANK_KEY)).toBeDefined();
    expect(await makeRoom(storage).room.restore()).toBe("restored");
  });

  // Value: protects=a live room saved before BANK_KEY keeps its bank across the deploy; fails_when=restore reads only
  // BANK_KEY, or the next save drops the bank before writing its key; seam=storage keys; no_claim=a rollback
  it("an old save with the bank inside the snapshot restores, and the next save moves the bank to its own key", async () => {
    const custom = structuredClone(BANK);
    custom.pools[1][0].content.value = "自訂題庫的第一題";
    const storage = memoryStorage();
    startedGame(makeRoom(storage, { bank: custom }).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    saved.bank = storage.data.get(BANK_KEY);
    storage.data.set(SNAPSHOT_KEY, saved);
    storage.data.delete(BANK_KEY); // what a room saved before BANK_KEY looks like

    const second = makeRoom(storage).room; // built with the bundled bank
    expect(await second.restore()).toBe("restored");
    rejoin(second, T1, TEAM_KEY, "a-again");
    second.game = { ...second.game!, checks: { [checkKey(second.game!.teams[0].currentQuestionId, T1)]: { value: 10, bonus: 0, dc: 8, passed: true } } };
    const screen = makeConn("screen");
    second.onConnect(screen);
    expect(lastOf(screen, "STATE").question.content).toEqual({ kind: "text", value: "自訂題庫的第一題" });
    const host2 = makeConn("host2");
    send(second, host2, { type: "HOST_CLAIM", token: TOKEN });
    send(second, host2, { type: "HOST_SET_PASSWORD", password: "x" }); // any later save
    expect(storage.data.get(BANK_KEY)).toEqual(saved.bank);
    expect(storage.data.get(SNAPSHOT_KEY)).not.toHaveProperty("bank");
  });

  it("a snapshot with no bank inside it or under its own key is discarded", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    storage.data.delete(BANK_KEY);
    expect(await makeRoom(storage).room.restore()).toBe("discarded");
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

// Value: protects=the room owns the reveal's clock: it waits for the lines, starts the first beat after the lead, and a
// reconnect or a restart picks the reveal up where it is instead of replaying it (podium-reveal.md D7, eng D20);
// fails_when=elapsedMs is not measured from the saved start, the start is lost on restart, or an old save hangs on
// 名次揭曉中…; why_new=new; seam=opts.now (already the room's clock); no_claim=the screen's drawing (screen tests, e2e)
describe("the podium reveal (podium-reveal.md eng D20)", () => {
  const broadcasts = (io: { broadcast: ReturnType<typeof vi.fn> }) => io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string));
  const lastState = (io: { broadcast: ReturnType<typeof vi.fn> }) => broadcasts(io).findLast((m) => m.type === "STATE");

  function ended(storage: ReturnType<typeof memoryStorage>, clock: () => number) {
    const { room, io } = makeRoom(storage, { now: clock, epilogueDelayMs: 4000, holdMs: 5 });
    const { host } = startedGame(room);
    judgeCorrect(room, host, room.game!.turnOrder[0]);
    send(room, host, { type: "HOST_END_GAME" });
    return { room, io, host };
  }

  it("waits for the lines, then runs on the room's clock; a reconnect and a restart pick it up where it is", async () => {
    let now = 1_000_000;
    const storage = memoryStorage();
    const { room, io } = ended(storage, () => now);
    expect(lastState(io).podium).toEqual({ ranking: room.game!.ranking, beats: null, elapsedMs: 0 });
    await vi.waitFor(() => expect(lastState(io).podium.beats).not.toBeNull());
    const podium = lastState(io).podium;
    // The first beat waits out the lead (the last line read) from when the game finished.
    expect(podium.elapsedMs).toBe(-4000);
    // The titles first (podium-titles.md), every team named at least once, then the places.
    const kinds = podium.beats.map((b: { kind: string; place?: number }) => (b.kind === "place" ? `place ${b.place}` : b.kind));
    expect(kinds.slice(-2)).toEqual(["place 2", "place 1"]);
    expect(kinds.slice(0, -2).every((k: string) => k === "award")).toBe(true);
    const named = new Set(podium.beats.flatMap((b: { kind: string; teamIds?: string[] }) => b.teamIds ?? []));
    expect(named).toEqual(new Set(room.game!.teams.map((t) => t.id)));
    expect(broadcasts(io).filter((m) => m.type === "EPILOGUE")).toHaveLength(1);

    now += 6000;
    const screen = makeConn("screen");
    room.onConnect(screen);
    expect(lastOf(screen, "STATE").podium.elapsedMs).toBe(2000);

    const second = makeRoom(storage, { now: () => now }).room;
    expect(await second.restore()).toBe("restored");
    const again = makeConn("again");
    second.onConnect(again);
    expect(lastOf(again, "STATE").podium).toEqual({ ...podium, elapsedMs: 2000 });
    expect(sent(again).filter((m) => m.type === "EPILOGUE")).toEqual([{ type: "EPILOGUE", text: lastOf(screen, "EPILOGUE").text, replay: true }]);
  });

  it("a restart before the lines came in asks again, and the first beat still counts from the finish", async () => {
    let now = 1_000_000;
    const storage = memoryStorage();
    ended(storage, () => now);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    storage.data.set(SNAPSHOT_KEY, { ...saved, epilogue: null, podium: null });
    now += 1000;
    const { room, io } = makeRoom(storage, { now: () => now, epilogueDelayMs: 4000, holdMs: 5 });
    expect(await room.restore()).toBe("restored");
    await vi.waitFor(() => expect(lastState(io)?.podium.beats).toBeTruthy());
    expect(lastState(io).podium.elapsedMs).toBe(-3000);
  });

  /** Two teams answer everything until the boss falls; its dish cooks on screen first (the default bank has dishes). */
  function killedBoss(storage: ReturnType<typeof memoryStorage>, clock: () => number) {
    const { room, io } = makeRoom(storage, { now: clock, epilogueDelayMs: 4000, holdMs: 5 });
    const { host } = startedGame(room);
    for (let i = 0; i < 400 && room.game!.phase === "playing"; i++) {
      const g = room.game!;
      const t = g.teams.find((x) => x.id === currentTurnTeamId(g))!;
      serveNext(room, host, (room as unknown as { eventSeq: number }).eventSeq);
      send(room, host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId, correct: true });
      const r = room as unknown as { pendingRoll?: { kind: string }; resolveRoll: () => void };
      if (r.pendingRoll?.kind === "kill") r.resolveRoll(); // the kill's 4d20 land at once (and drop the beat's timer)
    }
    expect(room.game!.phase).toBe("finished");
    return { room, io };
  }

  // Value: protects=after a boss kill with a dish the first call waits for the cooking, even across a restart mid-cooking
  // (cooking R8, /review D25-3); fails_when=the lead is read from the unsaved reveal again, or set after the STATE is
  // saved; why_new=only 結束冒險 (no dish) was covered; seam=fake clock; no_claim=the screen's own cooking frames
  it("a boss kill's first call waits for the boss to cook, and a restart mid-cooking still waits", async () => {
    let now = 1_000_000;
    const storage = memoryStorage();
    const { io } = killedBoss(storage, () => now);
    await vi.waitFor(() => expect(lastState(io).podium.beats).not.toBeNull());
    expect(lastState(io).podium.elapsedMs).toBe(-FINISH_PODIUM_MS);

    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    storage.data.set(SNAPSHOT_KEY, { ...saved, epilogue: null, podium: null }); // the lines were not in yet
    now += 1000;
    const second = makeRoom(storage, { now: () => now, epilogueDelayMs: 4000, holdMs: 5 });
    expect(await second.room.restore()).toBe("restored");
    await vi.waitFor(() => expect(lastState(second.io)?.podium.beats).toBeTruthy());
    expect(lastState(second.io).podium.elapsedMs).toBe(-(FINISH_PODIUM_MS - 1000));
  });

  // Value: protects=an epilogue that throws still lets the places be called, on scripted lines (/review pass 2);
  // fails_when=the failure only logs and podiumView waits for lines forever; why_new=before the reveal a failed epilogue
  // lost only the story; seam=the runner made to reject; no_claim=what makes it throw
  it("an epilogue that throws runs the reveal on scripted calls", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = memoryStorage();
    const { room, io } = makeRoom(storage, { now: () => 0, epilogueDelayMs: 4000, holdMs: 5 });
    (room as unknown as { runner: { run: () => Promise<void> } }).runner.run = () => Promise.reject(new Error("boom"));
    const { host } = startedGame(room);
    judgeCorrect(room, host, room.game!.turnOrder[0]);
    send(room, host, { type: "HOST_END_GAME" });
    await vi.waitFor(() => expect(lastState(io).podium.beats).not.toBeNull());
    const beats = lastState(io).podium.beats as Beat[];
    expect(beats.flatMap((b) => (b.kind === "place" ? [b.line] : []))).toEqual(["第二名是……乙隊！", "第一名是……甲隊！"]);
    // Every consolation is the 🛡️ fallback: no AI title came in.
    const untitled = beats.filter((b) => b.kind === "award" && b.title === "堅持到最後的冒險者");
    expect(untitled.length).toBeGreaterThan(0);
    expect(beats.filter((b) => b.kind === "award" && (b.icon === "🌟" || b.icon === "🛡️"))).toEqual(untitled);
    expect(lastState(io).podium.elapsedMs).toBe(-4000);

    // A restart asks for the story again (it never came): the reveal under way keeps its clock, not start over.
    const second = makeRoom(storage, { now: () => 10_000, epilogueDelayMs: 4000, holdMs: 5 });
    expect(await second.room.restore()).toBe("restored");
    await vi.waitFor(() => expect(broadcasts(second.io).some((m) => m.type === "EPILOGUE")).toBe(true));
    expect(lastState(second.io).podium.elapsedMs).toBe(10_000 - 4000);
  });

  // Value: protects=the AI's titles land with the calls in one emit and never change after (podium-titles.md eng E2);
  // fails_when=a later epilogue emit (a retry) rewrites the titles under a reveal already running, or the titles and
  // the calls are split at the wrong segment; why_new=new; seam=opts.provider; no_claim=a real model's lines
  it("the AI's titles are saved with the calls in one emit, and a later emit changes no beat", async () => {
    let call = 0;
    let epilogue: NarrationEvent | undefined;
    const provider = {
      name: "llm",
      narrate: async (e: NarrationEvent) => {
        if (e.type !== "epilogue") return "旁白";
        epilogue = e;
        const n = (e.titles ?? []).length;
        return [...Array.from({ length: n }, () => (call === 0 ? "書呆子｜一直在想答案" : "換掉了｜不該出現")), "x", "x", "字".repeat(30)].join("\n");
      },
    };
    const storage = memoryStorage();
    const { room, io } = makeRoom(storage, { now: () => 0, epilogueDelayMs: 4000, holdMs: 5, provider });
    const { host } = startedGame(room);
    judgeCorrect(room, host, room.game!.turnOrder[0]);
    send(room, host, { type: "HOST_END_GAME" });
    await vi.waitFor(() => expect(lastState(io).podium.beats).not.toBeNull());
    const before = lastState(io).podium.beats as Beat[];
    expect(epilogue?.type === "epilogue" && epilogue.titles?.length).toBeGreaterThan(0);
    expect(before.filter((b) => b.kind === "award" && b.icon === "🌟").map((b) => b.kind === "award" && b.title)).toEqual(
      Array((epilogue as { titles: unknown[] }).titles.length).fill("書呆子"),
    );
    const saved = storage.data.get(SNAPSHOT_KEY) as { podium: { lines: string[]; titles: string[] } };
    expect(saved.podium.titles).toEqual(Array((epilogue as { titles: unknown[] }).titles.length).fill("書呆子｜一直在想答案"));
    expect(saved.podium.lines).toHaveLength(2);
    call = 1;
    await (room as unknown as { runner: { run: (id: number, e: NarrationEvent) => Promise<void> } }).runner.run(99, epilogue!);
    expect(lastState(io).podium.beats).toEqual(before);
  });

  // Value: protects=a damaged saved reveal shows the full podium instead of 名次揭曉中… forever (/review D25-2);
  // fails_when=podiumView waits for lines whenever the podium is missing, though the story is in and nobody asks again;
  // why_new=the snapshot test only checked parsing; seam=storage edit; no_claim=what corrupts a save
  it("a damaged saved reveal with its story in shows the full podium", async () => {
    const storage = memoryStorage();
    const { io } = ended(storage, () => 0);
    await vi.waitFor(() => expect(lastState(io).podium.beats).not.toBeNull());
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    storage.data.set(SNAPSHOT_KEY, { ...saved, podium: { lines: "bad", at: 1 } });
    const { room } = makeRoom(storage);
    expect(await room.restore()).toBe("restored");
    const screen = makeConn("screen");
    room.onConnect(screen);
    expect(lastOf(screen, "STATE")).not.toHaveProperty("podium");
    expect(lastOf(screen, "EPILOGUE")).toMatchObject({ replay: true });
  });

  // Value: protects=a save from before titles (the crit king's line first, no titles) still calls each place right and
  // gives every untitled team the 🛡️ fallback; damaged titles are dropped, not the reveal (podium-titles.md eng 1);
  // fails_when=the old crit line is read as third/second place, or a bad titles field loses the podium; why_new=new field
  it("a save from before titles keeps its calls on their places, and every consolation is the fallback", async () => {
    const storage = memoryStorage();
    const { io } = ended(storage, () => 0);
    await vi.waitFor(() => expect(lastState(io).podium.beats).not.toBeNull());
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    for (const titles of [undefined, [1, 2]]) {
      storage.data.set(SNAPSHOT_KEY, { ...saved, podium: { lines: ["本場大成功王是……甲隊！", "二", "一"], ...(titles ? { titles } : {}), at: 0 } });
      const { room } = makeRoom(storage);
      expect(await room.restore()).toBe("restored");
      const screen = makeConn("screen");
      room.onConnect(screen);
      const beats = lastOf(screen, "STATE").podium.beats as Beat[];
      expect(beats.flatMap((b) => (b.kind === "place" ? [b.line] : []))).toEqual(["二", "一"]);
      expect(beats.filter((b) => b.kind === "award" && b.icon === "🌟")).toEqual([]);
    }
  });

  it("a game finished before the reveal has no podium: the screen shows the full podium", async () => {
    const storage = memoryStorage();
    ended(storage, () => 0);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    delete saved.game.ranking;
    delete saved.game.tieRolls;
    delete saved.podium;
    delete saved.revealFrom;
    storage.data.set(SNAPSHOT_KEY, { ...saved, epilogue: "舊的後記" });
    const { room } = makeRoom(storage);
    expect(await room.restore()).toBe("restored");
    const screen = makeConn("screen");
    room.onConnect(screen);
    expect(lastOf(screen, "STATE")).not.toHaveProperty("podium");
    expect(lastOf(screen, "EPILOGUE")).toMatchObject({ text: "舊的後記", replay: true });
  });
});
