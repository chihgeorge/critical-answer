// The room side of 開場點亮音效 (docs/designs/immersion.md PR0): each keyed big screen reports SCREEN_SOUND, and STATE
// tells the host pages `screenSound`: "ready" when any screen is ready, "muted" when none is, "none" with no screen.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { parseBank } from "../question-bank";

const T1 = "00000000-0000-0000-0000-000000000001";
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function game() {
  const bank = parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("q1"), text("q2")] }],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] },
  });
  const io = { broadcast: vi.fn() } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phone = makeConn("phone");
  room.onConnect(phone);
  send(room, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcde0", teamName: "烤肉小隊" });
  send(room, host, { type: "HOST_START", aiNarration: false });
  /** Every STATE the host page received, broadcast or sent to it alone, in order. */
  const states = () => {
    const sent = (m: ReturnType<typeof vi.fn>) => m.mock.calls.map((c, i) => [m.mock.invocationCallOrder[i], c[0]] as const);
    const all = [...sent(io.broadcast), ...sent(host.send)].sort((a, b) => a[0] - b[0]);
    return msgs(all.map(([, raw]) => [raw])).filter((m) => m.type === "STATE");
  };
  const sound = () => states().at(-1).screenSound;
  const key = (room as unknown as { screenKey: string }).screenKey;
  /** A /screen page opened from the host's big screen link (or by the room code, with no key). */
  function screen(id: string, keyed = true) {
    const conn = makeConn(id);
    room.onConnect(conn);
    send(room, conn, { type: "SCREEN_HELLO", ...(keyed ? { key } : {}) });
    return conn;
  }
  return { room, io, host, phone, states, sound, screen };
}

describe("SCREEN_SOUND and STATE.screenSound", () => {
  it("no keyed screen is none; a keyed screen that has not reported is muted; a ready report makes it ready", () => {
    const g = game();
    expect(g.sound()).toBe("none");
    const tv = g.screen("tv");
    send(g.room, tv, { type: "SCREEN_SOUND", ready: false });
    expect(g.sound()).toBe("muted");
    send(g.room, tv, { type: "SCREEN_SOUND", ready: true });
    expect(g.sound()).toBe("ready");
    send(g.room, tv, { type: "SCREEN_SOUND", ready: false });
    expect(g.sound()).toBe("muted");
  });

  it("is taken only from a keyed big screen: never from a phone, a host page, or a screen without the key", () => {
    const g = game();
    const bare = g.screen("bare", false);
    for (const conn of [g.phone, g.host, bare]) send(g.room, conn, { type: "SCREEN_SOUND", ready: true });
    expect(g.sound()).toBe("none");
    const tv = g.screen("tv");
    send(g.room, tv, { type: "SCREEN_SOUND", ready: false });
    for (const conn of [g.phone, g.host, bare]) send(g.room, conn, { type: "SCREEN_SOUND", ready: true });
    expect(g.sound()).toBe("muted");
  });

  it("with two screens, any one ready is ready", () => {
    const g = game();
    const a = g.screen("a");
    const b = g.screen("b");
    send(g.room, a, { type: "SCREEN_SOUND", ready: false });
    send(g.room, b, { type: "SCREEN_SOUND", ready: true });
    expect(g.sound()).toBe("ready");
    send(g.room, a, { type: "SCREEN_SOUND", ready: true });
    send(g.room, b, { type: "SCREEN_SOUND", ready: false });
    expect(g.sound()).toBe("ready");
  });

  it("a disconnect removes the screen's report and tells the host pages at once", () => {
    const g = game();
    const a = g.screen("a");
    const b = g.screen("b");
    send(g.room, a, { type: "SCREEN_SOUND", ready: true });
    send(g.room, b, { type: "SCREEN_SOUND", ready: false });
    expect(g.sound()).toBe("ready");
    g.room.onClose(a);
    expect(g.sound()).toBe("muted");
    g.room.onClose(b);
    expect(g.sound()).toBe("none");
  });

  it("a reconnect that replaces the socket forgets the old report until the new socket reports", () => {
    const g = game();
    send(g.room, g.screen("tv"), { type: "SCREEN_SOUND", ready: true });
    expect(g.sound()).toBe("ready");
    const again = g.screen("tv");
    expect(g.sound()).toBe("muted");
    send(g.room, again, { type: "SCREEN_SOUND", ready: true });
    expect(g.sound()).toBe("ready");
  });

  it("a hello without the key drops the screen's report", () => {
    const g = game();
    const tv = g.screen("tv");
    send(g.room, tv, { type: "SCREEN_SOUND", ready: true });
    send(g.room, tv, { type: "SCREEN_HELLO" });
    expect(g.sound()).toBe("none");
  });

  it("an unchanged report sends no STATE and does not count as activity", () => {
    const g = game();
    const tv = g.screen("tv");
    send(g.room, tv, { type: "SCREEN_SOUND", ready: true });
    const count = g.states().length;
    const activity = (g.room as unknown as { lastActivityAt: number | null }).lastActivityAt;
    send(g.room, tv, { type: "SCREEN_SOUND", ready: true });
    expect(g.states()).toHaveLength(count);
    expect((g.room as unknown as { lastActivityAt: number | null }).lastActivityAt).toBe(activity);
  });

  it("a change goes to the host pages only: no broadcast, nothing to the phones", () => {
    const g = game();
    const broadcasts = g.io.broadcast.mock.calls.length;
    const phoneMsgs = g.phone.send.mock.calls.length;
    send(g.room, g.screen("tv"), { type: "SCREEN_SOUND", ready: true });
    expect(g.sound()).toBe("ready");
    expect(g.io.broadcast.mock.calls.length).toBe(broadcasts);
    expect(g.phone.send.mock.calls.length).toBe(phoneMsgs);
  });

  it("a room reset forgets every report", () => {
    const g = game();
    send(g.room, g.screen("tv"), { type: "SCREEN_SOUND", ready: true });
    expect((g.room as unknown as { screenSoundReady: Map<string, boolean> }).screenSoundReady.size).toBe(1);
    (g.room as unknown as { reset(): void }).reset();
    expect((g.room as unknown as { screenSoundReady: Map<string, boolean> }).screenSoundReady.size).toBe(0);
  });
});
