// The room side of the host's pads (docs/designs/immersion.md PR2): HOST_EFFECT from a host page is relayed to keyed big
// screens as SCREEN_EFFECT, at most once per HOST_FX_WINDOW_MS per room, never while `clipPlaying`.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { parseBank } from "../question-bank";
import { checkKey } from "../game-state";
import { HOST_FX_COOLDOWN_MS, HOST_FX_WINDOW_MS } from "../protocol";

const T1 = "00000000-0000-0000-0000-000000000001";
const TOKEN = "host-token-0123456789abcdef";
const video = (id: string) => ({ kind: "text", id, content: { kind: "youtube", value: "dQw4w9WgXcQ", audioOnly: true, start: 5, end: 20 }, answer: `答案 ${id}` }); // pregate-literal: MAX_BOSS_HP=20 not the HP cap
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));
const effects = (conn: Conn & { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).filter((m) => m.type === "SCREEN_EFFECT");
const errors = (conn: Conn & { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).filter((m) => m.type === "ERROR");

function room(questions: object[] = [text("q1")], answerSeconds?: number) {
  const bank = parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions }],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] },
  });
  const io = { broadcast: vi.fn() } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const clock = { now: 10_000 };
  const r = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0, now: () => clock.now });
  const host = makeConn("host");
  r.onConnect(host);
  send(r, host, { type: "HOST_CLAIM", token: TOKEN });
  const phone = makeConn("phone");
  r.onConnect(phone);
  send(r, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcde0", teamName: "烤肉小隊" });
  const key = (r as unknown as { screenKey: string }).screenKey;
  function screen(id: string, keyed = true) {
    const conn = makeConn(id);
    r.onConnect(conn);
    send(r, conn, { type: "SCREEN_HELLO", ...(keyed ? { key } : {}) });
    return conn;
  }
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  /** Starts the game and shows its first question (a fill-in passes its persuasion check first). */
  function start() {
    send(r, host, { type: "HOST_START", aiNarration: false, ...(answerSeconds ? { answerSeconds } : {}) });
    send(r, phone, { type: "TEAM_ROLL_CHECK", questionId: state().question.id, eventId: state().eventId });
    (r as unknown as { resolveRoll(): void }).resolveRoll();
    const g = r.game!;
    r.game = { ...g, checks: { ...g.checks, [checkKey(state().question.id, T1)]: { value: 10, bonus: 0, dc: 8, passed: true } } };
  }
  const media = (action: string, questionId: string = state().question.id) => send(r, host, { type: "HOST_MEDIA", questionId, action });
  return { room: r, io, host, phone, screen, state, start, media, clock };
}

describe("HOST_EFFECT", () => {
  it("reaches keyed big screens only, in the lobby too (the host's sound check)", () => {
    const g = room();
    const tv = g.screen("tv");
    const bare = g.screen("bare", false);
    send(g.room, g.host, { type: "HOST_EFFECT", effect: "thunder" });
    expect(effects(tv)).toEqual([{ type: "SCREEN_EFFECT", effect: "thunder" }]);
    for (const conn of [bare, g.phone, g.host]) expect(effects(conn)).toEqual([]);
    expect(msgs(g.io.broadcast.mock.calls).some((m) => m.type === "SCREEN_EFFECT")).toBe(false);
  });

  it("from a phone, a keyed screen or an unkeyed screen relays nothing and gets not_host", () => {
    const g = room();
    const tv = g.screen("tv");
    const bare = g.screen("bare", false);
    for (const conn of [g.phone, tv, bare]) {
      send(g.room, conn, { type: "HOST_EFFECT", effect: "growl" });
      expect(errors(conn).at(-1)).toMatchObject({ error: "not_host" });
    }
    expect(effects(tv)).toEqual([]);
  });

  it("a bad effect is a malformed message", () => {
    const g = room();
    send(g.room, g.host, { type: "HOST_EFFECT", effect: "dim" });
    send(g.room, g.host, { type: "HOST_EFFECT" });
    expect(errors(g.host)).toEqual([
      { type: "ERROR", error: "invalid_action", detail: "bad_message" },
      { type: "ERROR", error: "invalid_action", detail: "bad_message" },
    ]);
  });

  it("takes one press per second for the whole room: extras are dropped with no reply and are not activity", () => {
    const g = room();
    const tv = g.screen("tv");
    const host2 = makeConn("host2");
    g.room.onConnect(host2);
    send(g.room, host2, { type: "HOST_CLAIM", token: TOKEN });
    send(g.room, g.host, { type: "HOST_EFFECT", effect: "thunder" });
    const active = (g.room as unknown as { lastActivityAt: number }).lastActivityAt;
    g.clock.now += HOST_FX_WINDOW_MS - 1;
    // Thunder and growl share the limit, and so do two host devices.
    send(g.room, g.host, { type: "HOST_EFFECT", effect: "growl" });
    send(g.room, host2, { type: "HOST_EFFECT", effect: "thunder" });
    expect(effects(tv)).toHaveLength(1);
    expect(errors(g.host)).toEqual([]);
    expect(errors(host2)).toEqual([]);
    expect((g.room as unknown as { lastActivityAt: number }).lastActivityAt).toBe(active);
    g.clock.now += 1;
    send(g.room, host2, { type: "HOST_EFFECT", effect: "growl" });
    expect(effects(tv)).toEqual([
      { type: "SCREEN_EFFECT", effect: "thunder" },
      { type: "SCREEN_EFFECT", effect: "growl" },
    ]);
  });

  it("the host page's cooldown is longer than the room's window, so jitter never drops a device's next press", () => {
    expect(HOST_FX_COOLDOWN_MS).toBeGreaterThan(HOST_FX_WINDOW_MS);
  });
});

describe("STATE.clipPlaying", () => {
  it("is set from the host's ▶ until ⏸, and a press meanwhile is dropped", () => {
    const g = room([video("v1")]);
    const tv = g.screen("tv");
    g.start();
    expect(g.state().clipPlaying).toBeUndefined(); // shown, still paused
    g.media("play");
    expect(g.state().clipPlaying).toBe(true);
    send(g.room, g.host, { type: "HOST_EFFECT", effect: "thunder" });
    expect(effects(tv)).toEqual([]);
    expect(errors(g.host)).toEqual([]);
    g.media("pause");
    expect(g.state().clipPlaying).toBeUndefined();
    send(g.room, g.host, { type: "HOST_EFFECT", effect: "thunder" });
    expect(effects(tv)).toHaveLength(1);
  });

  it("ends with the screen's SCREEN_CLIP_ENDED, with the answer countdown off too", () => {
    const g = room([video("v1")]);
    const tv = g.screen("tv");
    g.start();
    g.media("play");
    // Only a keyed screen's report counts.
    for (const conn of [g.phone, g.screen("bare", false)]) send(g.room, conn, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().clipPlaying).toBe(true);
    send(g.room, tv, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().clipPlaying).toBeUndefined();
  });

  it("ends with the screen's SCREEN_CLIP_ENDED with the countdown on, which then starts counting", () => {
    const g = room([video("v1")], 30);
    const tv = g.screen("tv");
    g.start();
    g.media("play");
    expect(g.state().answerClock).toEqual({ left: null });
    send(g.room, tv, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().clipPlaying).toBeUndefined();
    expect(g.state().answerClock.left).toBeGreaterThan(0);
  });

  it("ends with the screen's SCREEN_CLIP_ERROR", () => {
    const g = room([video("v1")]);
    const tv = g.screen("tv");
    g.start();
    g.media("play");
    send(g.room, tv, { type: "SCREEN_CLIP_ERROR", questionId: "v1" });
    expect(g.state().clipPlaying).toBeUndefined();
  });

  it("is set again when the host replays a clip that already ended, until that play ends too", () => {
    const g = room([video("v1")]);
    const tv = g.screen("tv");
    g.start();
    g.media("play");
    send(g.room, tv, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().clipPlaying).toBeUndefined();
    g.media("restart");
    expect(g.state().clipPlaying).toBe(true);
    send(g.room, tv, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().clipPlaying).toBeUndefined();
  });

  it("is never set during a reveal, whose clip reports no end", () => {
    const g = room([video("v1"), text("q2")]);
    g.start();
    g.media("play");
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: T1, questionId: "v1", correct: true, fleeChoice: "retry", eventId: g.state().eventId });
    expect(g.state().reveal?.questionId).toBe("v1");
    g.media("play", "v1");
    expect(g.state().media).toMatchObject({ questionId: "v1", state: "playing" });
    expect(g.state().clipPlaying).toBeUndefined();
  });

  it("is never set for a question without a video", () => {
    const g = room([text("q1")]);
    g.start();
    expect(g.state().clipPlaying).toBeUndefined();
  });
});
