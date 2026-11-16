// STATE.hostAway (host-offline banner): once the last host page has been gone for HOST_AWAY_GRACE_MS during a game, the
// big screen and the phones show 主持人重新連線中. A quick reconnect shows nothing; the host's HOST_CLAIM clears it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DungeonRoom, HOST_AWAY_GRACE_MS } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";

const T1 = "00000000-0000-0000-0000-000000000001";
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);

function memoryStorage(): RoomStorage {
  const data = new Map<string, unknown>();
  return { get: async (k) => structuredClone(data.get(k)), put: (k, v) => void data.set(k, structuredClone(v)) };
}

const bank = () =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("q1"), text("q2")] }],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] },
  });

function setup({ start = true, storage }: { start?: boolean; storage?: RoomStorage } = {}) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phone = makeConn("phone");
  room.onConnect(phone);
  send(room, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcde0", teamName: "烤肉小隊" });
  if (start) send(room, host, { type: "HOST_START", aiNarration: false });
  const states = () => io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).filter((m) => m.type === "STATE");
  const away = () => states().at(-1)?.hostAway === true;
  return { room, io, host, phone, states, away };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("STATE.hostAway", () => {
  it("shows after the grace once the host page is gone, and the host's HOST_CLAIM clears it with a broadcast", () => {
    const g = setup();
    expect(g.away()).toBe(false);
    g.room.onClose(g.host);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS - 1);
    expect(g.away()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(g.away()).toBe(true);
    const back = makeConn("host2");
    g.room.onConnect(back);
    const before = g.states().length;
    send(g.room, back, { type: "HOST_CLAIM", token: TOKEN });
    expect(g.states().length).toBe(before + 1);
    expect(g.away()).toBe(false);
  });

  it("a reconnect inside the grace shows nothing, also when the new socket reuses the host's id", () => {
    const g = setup();
    g.room.onClose(g.host);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS / 2);
    const back = makeConn("host");
    g.room.onConnect(back);
    send(g.room, back, { type: "HOST_CLAIM", token: TOKEN });
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS * 2);
    expect(g.states().some((s) => s.hostAway)).toBe(false);

    // A reload: the new socket takes the old id before the old one closes. It re-claims on open.
    const reload = makeConn("host");
    g.room.onConnect(reload);
    g.room.onClose(back); // the old socket's late close is ignored
    send(g.room, reload, { type: "HOST_CLAIM", token: TOKEN });
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS * 2);
    expect(g.states().some((s) => s.hostAway)).toBe(false);
  });

  it("a second host device keeps the host there; a wrong token does not clear it", () => {
    const g = setup();
    const tablet = makeConn("tablet");
    g.room.onConnect(tablet);
    send(g.room, tablet, { type: "HOST_CLAIM", token: TOKEN });
    g.room.onClose(g.host);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS * 2);
    expect(g.away()).toBe(false);
    g.room.onClose(tablet);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS);
    expect(g.away()).toBe(true);
    const stranger = makeConn("stranger");
    g.room.onConnect(stranger);
    send(g.room, stranger, { type: "HOST_CLAIM", token: "wrong-token-0123456789abcdef" });
    expect(g.away()).toBe(true);
  });

  it("phones and screens reconnecting start nothing; a lobby never sets it", () => {
    const g = setup();
    g.room.onConnect(makeConn("phone")); // a phone's reconnect under its old id
    g.room.onClose(g.phone);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS * 2);
    expect(g.states().some((s) => s.hostAway)).toBe(false);

    const lobby = setup({ start: false });
    lobby.room.onClose(lobby.host);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS * 2);
    expect(lobby.io.broadcast.mock.calls.some((c) => JSON.parse(c[0] as string).hostAway)).toBe(false);
  });

  it("the flip runs no game step: no new eventId, no narration line", () => {
    const g = setup();
    const before = g.states().at(-1);
    const narrations = () => g.io.broadcast.mock.calls.filter((c) => JSON.parse(c[0] as string).type === "NARRATION").length;
    const lines = narrations();
    g.room.onClose(g.host);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS);
    expect(g.states().at(-1).eventId).toBe(before.eventId);
    expect(narrations()).toBe(lines);
  });

  it("not over a finished game the host already ended", () => {
    const g = setup();
    send(g.room, g.host, { type: "HOST_END_GAME" });
    expect(g.states().at(-1).phase).toBe("finished");
    g.room.onClose(g.host);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS);
    expect(g.away()).toBe(false);
  });

  it("shows over a finished game whose podium still waits on the host (manual pacing)", () => {
    const g = setup();
    send(g.room, g.host, { type: "HOST_PACING", mode: "manual" });
    send(g.room, g.host, { type: "HOST_END_GAME" });
    expect(g.states().at(-1).hold?.kind).toBe("podium");
    g.room.onClose(g.host);
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS);
    expect(g.away()).toBe(true);
  });

  it("after a restart with nobody back, the banner shows after the grace; a host who comes back clears it", async () => {
    const storage = memoryStorage();
    setup({ storage });
    const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
    const room = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
    expect(await room.restore()).toBe("restored");
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS);
    // Nobody connected yet: nothing is broadcast, and the first page to connect gets it in its own STATE.
    expect(io.broadcast).not.toHaveBeenCalled();
    const tv = makeConn("tv");
    room.onConnect(tv);
    expect(JSON.parse(tv.send.mock.calls[0][0] as string).hostAway).toBe(true);
    const last = () => io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).filter((m) => m.type === "STATE").at(-1);
    const host = makeConn("host");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    expect(last()?.hostAway).toBeUndefined();
  });

  it("a room that expires or resets drops the waiting timer", () => {
    const g = setup();
    g.room.onClose(g.host);
    const internals = g.room as unknown as { clearAnswerTimers(): void; hostAwayTimer: unknown; hostAway: boolean };
    internals.clearAnswerTimers();
    expect(internals.hostAwayTimer).toBeNull();
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS * 2);
    expect(internals.hostAway).toBe(false);
  });
});
