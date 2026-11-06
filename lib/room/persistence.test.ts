/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import { BANK_KEY, SCHEMA_VERSION, SNAPSHOT_KEY } from "./snapshot";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { BANK } from "../question-bank-data";
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

  // Value: protects=the lost natural 20 survives another team playing first (review finding); fails_when=only the
  // crit team's own rejoin applies it; no_claim=more than two teams.
  it("a lost natural 20 still wins when another team's phone comes back and plays first", async () => {
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
    send(second.room, host, { type: "HOST_NEXT", eventId: (second.room as any).eventSeq });
    send(second.room, host, { type: "HOST_CLAIM", token: TOKEN });
    judgeCorrect(second.room, host, other);
    // The turn now reaches the crit team, but the win waits for the answer reveal to close (nobody plays under it).
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).toBe(q);
    send(second.room, host, { type: "HOST_NEXT", eventId: (second.room as any).eventSeq });
    expect(second.room.game!.teams.find((t) => t.id === t0)!.currentQuestionId).not.toBe(q);
  });

  // Value: protects=a check rolled under v0.35.0.0's `q:t` key still counts after the deploy; fails_when=restore keeps
  // the old key, so the team may roll again and the record is never dropped.
  it("a check saved under the old question:team key is read back under the new key", async () => {
    const storage = memoryStorage();
    startedGame(makeRoom(storage).room);
    const saved = structuredClone(storage.data.get(SNAPSHOT_KEY)) as any;
    const q = saved.game.teams.find((t: any) => t.id === T1).currentQuestionId;
    saved.game.checks = { [`${q}:${T1}`]: { value: 3, bonus: 0, dc: 8, passed: false } };
    storage.data.set(SNAPSHOT_KEY, saved);

    const second = makeRoom(storage);
    await second.room.restore();
    expect(second.room.game!.checks).toEqual({ [checkKey(q, T1)]: { value: 3, bonus: 0, dc: 8, passed: false } });
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

  it("the game keeps the bank it started with, not the bundled one", async () => {
    const custom = structuredClone(BANK);
    custom.pools[1][0].content.value = "自訂題庫的第一題";
    const storage = memoryStorage();
    const first = makeRoom(storage, { bank: custom }).room;
    startedGame(first);

    const second = makeRoom(storage).room; // built with the bundled bank
    await second.restore();
    rejoin(second, T1, TEAM_KEY, "a-again");
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
    const screen = makeConn("screen");
    second.onConnect(screen);
    expect(lastOf(screen, "STATE").question.content).toEqual({ kind: "text", value: "自訂題庫的第一題" });
    const host2 = makeConn("host2");
    send(second, host2, { type: "HOST_CLAIM", token: TOKEN });
    send(second, host2, { type: "HOST_SET_NOTES", notes: "x" }); // any later save
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
