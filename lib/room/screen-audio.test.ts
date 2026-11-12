// The room side of ⚙ 更多's sound switches (docs/designs/immersion.md PR3): only a host page may set `screenAudio`; the
// room saves it and sends it in LOBBY and STATE, so a big screen applies it on connect and on reconnect.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { parseClientMessage } from "../protocol";

const T1 = "00000000-0000-0000-0000-000000000001";
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = parseBank({ rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("q1")] }], boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] } });
const OFF = { music: true, voice: false, ambience: false };

type Spy = ReturnType<typeof vi.fn>;
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: Spy };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const sent = (conn: Conn & { send: Spy }) => conn.send.mock.calls.map((c) => JSON.parse(c[0] as string));
const last = (conn: Conn & { send: Spy }, type: string) => sent(conn).filter((m) => m.type === type).at(-1);

function memoryStorage(): RoomStorage {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), delete: async (k: string) => data.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } as never;
}

function room(storage?: RoomStorage) {
  const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), ...(storage ? { storage } : {}) } as unknown as RoomIO & { broadcast: Spy };
  const r = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0 });
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
  const broadcastOf = (type: string) => io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).filter((m) => m.type === type).at(-1);
  return { room: r, io, host, phone, screen, broadcastOf };
}

describe("HOST_SCREEN_AUDIO", () => {
  it("parses three booleans only", () => {
    expect(parseClientMessage({ type: "HOST_SCREEN_AUDIO", audio: { ...OFF, x: 1 }, y: 2 })).toEqual({ type: "HOST_SCREEN_AUDIO", audio: OFF });
    for (const audio of [undefined, null, {}, { music: true, voice: true }, { music: 1, voice: true, ambience: true }]) {
      expect(parseClientMessage({ type: "HOST_SCREEN_AUDIO", audio })).toBeNull();
    }
  });

  it("all on by default: LOBBY and STATE carry no screenAudio, as from an older server", () => {
    const g = room();
    expect(g.broadcastOf("LOBBY")).not.toHaveProperty("screenAudio");
    send(g.room, g.host, { type: "HOST_START", aiNarration: false });
    expect(g.broadcastOf("STATE")).not.toHaveProperty("screenAudio");
  });

  it("from a phone, a keyed screen or an unkeyed screen changes nothing and gets not_host", () => {
    const g = room();
    const tv = g.screen("tv");
    const bare = g.screen("bare", false);
    const before = g.io.broadcast.mock.calls.length;
    for (const conn of [g.phone, tv, bare]) {
      send(g.room, conn, { type: "HOST_SCREEN_AUDIO", audio: OFF });
      expect(last(conn, "ERROR")).toMatchObject({ error: "not_host" });
    }
    expect(g.io.broadcast.mock.calls.length).toBe(before);
    expect(g.broadcastOf("LOBBY")).not.toHaveProperty("screenAudio");
  });

  it("the host's setting reaches every page, in the lobby and in a game, and a screen gets it on connect", () => {
    const g = room();
    send(g.room, g.host, { type: "HOST_SCREEN_AUDIO", audio: OFF });
    expect(g.broadcastOf("LOBBY")).toMatchObject({ screenAudio: OFF });
    send(g.room, g.host, { type: "HOST_START", aiNarration: false });
    expect(g.broadcastOf("STATE")).toMatchObject({ screenAudio: OFF });
    // A screen that (re)connects mid-game applies it from its first STATE.
    const tv = g.screen("tv");
    expect(last(tv, "STATE")).toMatchObject({ screenAudio: OFF });
    // Back to all on: the field goes away.
    send(g.room, g.host, { type: "HOST_SCREEN_AUDIO", audio: { music: true, voice: true, ambience: true } });
    expect(g.broadcastOf("STATE")).not.toHaveProperty("screenAudio");
  });

  it("the same setting again sends nothing", () => {
    const g = room();
    send(g.room, g.host, { type: "HOST_SCREEN_AUDIO", audio: OFF });
    const before = g.io.broadcast.mock.calls.length;
    send(g.room, g.host, { type: "HOST_SCREEN_AUDIO", audio: OFF });
    expect(g.io.broadcast.mock.calls.length).toBe(before);
  });

  it("is saved: after a restart a screen connecting gets it", async () => {
    const storage = memoryStorage();
    const g = room(storage);
    send(g.room, g.host, { type: "HOST_START", aiNarration: false });
    send(g.room, g.host, { type: "HOST_SCREEN_AUDIO", audio: { music: false, voice: true, ambience: true } });
    await Promise.resolve();
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), storage } as unknown as RoomIO;
    const r = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0 });
    expect(await r.restore()).toBe("restored");
    const tv = makeConn("tv2");
    r.onConnect(tv);
    expect(last(tv, "STATE")).toMatchObject({ screenAudio: { music: false, voice: true, ambience: true } });
  });
});
