// 🎯 校正喇叭 (docs/designs/tap-calibrate.md): in the lobby one sound-ready big screen beeps, the joined phones tap
// along, and the host pages get the suggested latency; only the host's 套用 (HOST_TAP_LATENCY) writes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { parseBank } from "../question-bank";
import { parseClientMessage } from "../protocol";
import { CALIBRATE_BEATS, CALIBRATE_GAP_MS, CALIBRATE_LEAD_MS, CALIBRATE_TAIL_MS } from "../tap-clock";

const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({
  kind: "text",
  id,
  content: { kind: "text", value: `題目 ${id}` },
  answer: `答案 ${id}`,
});
const conn = (id: string) =>
  ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & {
    send: ReturnType<typeof vi.fn>;
  };
const sent = (c: { send: ReturnType<typeof vi.fn> }) => c.send.mock.calls.map(([m]) => JSON.parse(m as string));
const of = (c: { send: ReturnType<typeof vi.fn> }, type: string) => sent(c).filter((m) => m.type === type);
const errors = (c: { send: ReturnType<typeof vi.fn> }) => of(c, "ERROR").map((m) => m.detail ?? m.error);
/** The whole test, from the press to the close. */
const WHOLE = CALIBRATE_LEAD_MS + (CALIBRATE_BEATS - 1) * CALIBRATE_GAP_MS + CALIBRATE_TAIL_MS;

let now = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  now = 1_000_000;
});
afterEach(() => vi.useRealTimers());

function setup() {
  const bank = parseBank({
    rooms: [
      {
        monster: "slime-soft",
        baseDifficulty: 1,
        questions: [text("q1"), text("q2")],
      },
    ],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] },
  });
  const io = { broadcast: vi.fn() } as unknown as RoomIO & {
    broadcast: ReturnType<typeof vi.fn>;
  };
  const room = new DungeonRoom(io, () => 0, {
    bank,
    epilogueDelayMs: 0,
    now: () => now,
  });
  const send = (c: Conn, msg: object) => room.onMessage(JSON.stringify(msg), c);
  const host = conn("host");
  room.onConnect(host);
  send(host, { type: "HOST_CLAIM", token: TOKEN });
  const key = (room as unknown as { screenKey: string }).screenKey;
  const screen = (id: string, ready: boolean) => {
    const c = conn(id);
    room.onConnect(c);
    send(c, { type: "SCREEN_HELLO", key });
    send(c, { type: "SCREEN_SOUND", ready });
    return c;
  };
  const phone = (id: string, n: number) => {
    const c = conn(id);
    room.onConnect(c);
    send(c, {
      type: "JOIN",
      teamId: `00000000-0000-0000-0000-00000000000${n}`,
      teamKey: `team-key-0123456789abcde${n}`,
      teamName: `隊${n}`,
    });
    return c;
  };
  /** The last LOBBY anyone got (broadcast or sent to one). */
  const lobby = () => [...io.broadcast.mock.calls.map(([m]) => JSON.parse(m as string)), ...sent(host)].filter((m) => m.type === "LOBBY").at(-1);
  const lastBroadcastLobby = () =>
    io.broadcast.mock.calls
      .map(([m]) => JSON.parse(m as string))
      .filter((m) => m.type === "LOBBY")
      .at(-1);
  return { room, io, send, host, screen, phone, lobby, lastBroadcastLobby };
}

/** `c` taps every beat of `run`, `late` ms after it, each arriving 50 ms after the press. */
function tapAlong(g: ReturnType<typeof setup>, c: Conn, run: { run: number; startAt: number }, late: number) {
  for (let k = 0; k < CALIBRATE_BEATS; k++) {
    const at = run.startAt + k * CALIBRATE_GAP_MS + late;
    now = at + 50;
    g.send(c, { type: "CALIBRATE_TAP", run: run.run, at });
  }
}

describe("HOST_TAP_CALIBRATE", () => {
  it("parses: no fields; CALIBRATE_TAP needs a whole run and a finite at", () => {
    expect(parseClientMessage({ type: "HOST_TAP_CALIBRATE" })).toEqual({
      type: "HOST_TAP_CALIBRATE",
    });
    expect(parseClientMessage({ type: "CALIBRATE_TAP", run: 3, at: 12.5 })).toEqual({ type: "CALIBRATE_TAP", run: 3, at: 12.5 });
    expect(parseClientMessage({ type: "CALIBRATE_TAP", run: 1.5, at: 1 })).toBeNull();
    expect(parseClientMessage({ type: "CALIBRATE_TAP", run: 1, at: "x" })).toBeNull();
  });

  it("refuses a player, a room with no screen, a muted screen, and a game under way", () => {
    const g = setup();
    const p = g.phone("p1", 1);
    g.send(p, { type: "HOST_TAP_CALIBRATE" });
    expect(g.lobby().calibrate).toBeUndefined();
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    g.screen("tv", false);
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    expect(errors(g.host)).toEqual(["no_screen", "screen_muted"]);
    g.send(g.host, { type: "HOST_START", aiNarration: false });
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    expect(errors(g.host).at(-1)).toBe("game_already_started");
  });

  it("starts: one ready screen gets the beeps, every page gets LOBBY calibrate; a second press is refused", () => {
    const g = setup();
    const muted = g.screen("tv-muted", false);
    const tv = g.screen("tv", true);
    const tv2 = g.screen("tv2", true);
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    const run = g.lastBroadcastLobby().calibrate;
    expect(run).toEqual({
      run: expect.any(Number),
      startAt: now + CALIBRATE_LEAD_MS,
      beats: CALIBRATE_BEATS,
      gapMs: CALIBRATE_GAP_MS,
    });
    expect(of(tv, "SCREEN_CALIBRATE")).toEqual([{ type: "SCREEN_CALIBRATE", run }]);
    expect(of(tv2, "SCREEN_CALIBRATE")).toEqual([]);
    expect(of(muted, "SCREEN_CALIBRATE")).toEqual([]);
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    expect(errors(g.host)).toEqual(["calibrating"]);
    // 大螢幕試播影音 would play clips over the beeps.
    g.send(g.host, { type: "HOST_SCREEN_TEST" });
    expect(errors(g.host)).toEqual(["calibrating", "calibrating"]);
  });

  it("closes with the median of every joined phone's taps; only 套用 writes the latency", () => {
    const g = setup();
    g.screen("tv", true);
    const a = g.phone("pa", 1);
    const b = g.phone("pb", 2);
    const stranger = conn("stranger");
    g.room.onConnect(stranger);
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    const run = g.lastBroadcastLobby().calibrate;
    const start = now;
    tapAlong(g, a, run, 150);
    tapAlong(g, b, run, 250);
    tapAlong(g, stranger, run, 900); // not joined: never counts
    g.send(a, {
      type: "CALIBRATE_TAP",
      run: run.run - 1,
      at: run.startAt + 5000,
    }); // an old run's
    now = start + WHOLE;
    vi.advanceTimersByTime(WHOLE);
    expect(of(g.host, "TAP_CALIBRATE_RESULT")).toEqual([
      {
        type: "TAP_CALIBRATE_RESULT",
        run: run.run,
        ms: 200,
        taps: 12,
        phones: 2,
      },
    ]);
    expect(g.lastBroadcastLobby().calibrate).toBeUndefined();
    expect(g.lastBroadcastLobby().tapLatency).toBeUndefined();
    g.send(g.host, { type: "HOST_TAP_LATENCY", ms: 200 });
    expect(g.lastBroadcastLobby().tapLatency).toBe(200);
  });

  it("too few taps gives ms null; a tap stamped long before it arrives is dropped", () => {
    const g = setup();
    g.screen("tv", true);
    const a = g.phone("pa", 1);
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    const run = g.lastBroadcastLobby().calibrate;
    const start = now;
    for (let k = 2; k < CALIBRATE_BEATS; k++) {
      const at = run.startAt + k * CALIBRATE_GAP_MS + 100;
      now = at + (k === 7 ? 1500 : 30); // the last one is 1.5 s late on the wire: tap_late
      g.send(a, { type: "CALIBRATE_TAP", run: run.run, at });
    }
    now = start + WHOLE;
    vi.advanceTimersByTime(WHOLE);
    expect(of(g.host, "TAP_CALIBRATE_RESULT")[0]).toMatchObject({
      ms: null,
      taps: 5,
      phones: 1,
    });
  });

  it("a game started meanwhile drops the result; CALIBRATE_TAP is not activity", () => {
    const g = setup();
    g.screen("tv", true);
    const a = g.phone("pa", 1);
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    const run = g.lastBroadcastLobby().calibrate;
    const before = (g.room as unknown as { lastActivityAt: number }).lastActivityAt;
    now += 4000;
    g.send(a, { type: "CALIBRATE_TAP", run: run.run, at: now });
    expect((g.room as unknown as { lastActivityAt: number }).lastActivityAt).toBe(before);
    g.send(g.host, { type: "HOST_START", aiNarration: false });
    vi.advanceTimersByTime(WHOLE);
    expect(of(g.host, "TAP_CALIBRATE_RESULT")).toEqual([]);
  });

  it("a finished 大螢幕試播影音 does not block it, a running one does", () => {
    const g = setup();
    g.screen("tv", true);
    const r = g.room as unknown as {
      screenTest: {
        errors: (string | null | undefined)[];
        list: unknown[];
      } | null;
    };
    r.screenTest = { errors: [null], list: [{}, {}] } as never;
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    expect(errors(g.host)).toEqual(["screen_testing"]);
    r.screenTest = { errors: [null, "blocked"], list: [{}, {}] } as never;
    g.send(g.host, { type: "HOST_TAP_CALIBRATE" });
    expect(errors(g.host)).toEqual(["screen_testing"]);
    expect(g.lastBroadcastLobby().calibrate).toBeDefined();
  });
});
