/* eslint-disable @typescript-eslint/no-explicit-any */
// The room side of the how-to-play intro (docs/designs/how-to-play.md, eng D2–D5): four pages the host
// turns one at a time, with the first question, the start cue and the start narration held until page 5.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import { SNAPSHOT_KEY } from "./snapshot";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";

const T1 = "00000000-0000-0000-0000-000000000001";
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = () =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("r1"), text("r2")] }],
    boss: { monster: "dragon", maxHp: 1, questions: [text("b1")] },
  });

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
/** 上菜 then 下一題 (monster-cuisine.md cooking I2), skipping the cooking's hold a real host waits out. */
function serveNext(room: DungeonRoom, conn: Conn, eventId: number) {
  send(room, conn, { type: "HOST_SERVE", eventId });
  (room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(room, conn, { type: "HOST_NEXT", eventId });
}

const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));
const tick = () => new Promise((r) => setTimeout(r, 0));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage & { data: Map<string, unknown> };
}

/** A room with one team in the lobby; `start` sends HOST_START with the given fields. */
function lobby(storage?: RoomStorage) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phone = makeConn("phone");
  room.onConnect(phone);
  send(room, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcde0", teamName: "烤肉小隊" });
  const all = () => msgs(io.broadcast.mock.calls);
  const state = () => all().findLast((m) => m.type === "STATE");
  const lobbyMsg = () => all().findLast((m) => m.type === "LOBBY");
  const narrations = () => all().filter((m) => m.type === "NARRATION");
  const start = (fields: object) => send(room, host, { type: "HOST_START", aiNarration: false, ...fields });
  const page = (n: number) => send(room, host, { type: "HOST_INTRO", page: n });
  return { room, io, host, phone, state, lobbyMsg, narrations, start, page };
}

describe("how-to-play intro in the room", () => {
  it("a HOST_START without the intro field starts as before: question, start cue and narration at once (D2)", async () => {
    const g = lobby();
    g.start({});
    await tick();
    expect(g.state()).toMatchObject({ cue: "start", eventId: 1 });
    expect(g.state().question).not.toBeNull();
    expect(g.state().intro).toBeUndefined();
    expect(g.narrations()).toHaveLength(1);
  });

  it("intro: true opens page 1 with no question, no cue and no narration (D3)", async () => {
    const g = lobby();
    g.start({ intro: true });
    await tick();
    expect(g.state()).toMatchObject({ intro: { page: 1 }, question: null, eventId: 0 });
    expect(g.state().cue).toBeUndefined();
    expect(g.narrations()).toHaveLength(0);
  });

  it("turns one page per message: a double tap or a jump of two is dropped (D4)", () => {
    const g = lobby();
    g.start({ intro: true });
    g.page(2);
    g.page(2); // double tap
    expect(g.state().intro).toEqual({ page: 2 });
    g.page(4); // two ahead
    expect(g.state().intro).toEqual({ page: 2 });
    g.page(1); // back one
    expect(g.state().intro).toEqual({ page: 1 });
  });

  it("page 5 ends the intro and only then deals the first question with the start cue and narration (D3)", async () => {
    const g = lobby();
    g.start({ intro: true });
    for (const n of [2, 3, 4]) g.page(n);
    await tick();
    expect(g.narrations()).toHaveLength(0);
    g.page(5);
    await tick();
    expect(g.state()).toMatchObject({ cue: "start", eventId: 1 });
    expect(g.state().intro).toBeUndefined();
    expect(g.state().question).not.toBeNull();
    expect(g.narrations()).toHaveLength(1);
  });

  it("holds the team and the host's judging while the intro shows", () => {
    const g = lobby();
    g.start({ intro: true });
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: T1, questionId: g.room.game!.teams[0].currentQuestionId, correct: true, eventId: 0 });
    expect(msgs(g.host.send.mock.calls).at(-1)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    serveNext(g.room, g.host, 0); // 下一題 does not end the intro
    expect(g.state().intro).toEqual({ page: 1 });
  });

  it("on page 4: back one works, and a double-tapped page 5 starts the game once", async () => {
    const g = lobby();
    g.start({ intro: true });
    for (const n of [2, 3, 4]) g.page(n);
    g.page(3);
    expect(g.state().intro).toEqual({ page: 3 });
    g.page(4);
    g.page(5);
    g.page(5); // double tap: the intro is over
    await tick();
    expect(g.state()).toMatchObject({ cue: "start", eventId: 1 });
    expect(g.narrations()).toHaveLength(1);
  });

  it("a start without the intro clears a page left over in the room", async () => {
    const g = lobby();
    (g.room as any).intro = 3; // e.g. an inconsistent save
    g.start({});
    await tick();
    expect(g.state().intro).toBeUndefined();
    expect(g.state().question).not.toBeNull();
  });

  it("結束冒險 on page 4 drops the intro", () => {
    const g = lobby();
    g.start({ intro: true });
    for (const n of [2, 3, 4]) g.page(n);
    send(g.room, g.host, { type: "HOST_END_GAME" });
    expect(g.state()).toMatchObject({ phase: "finished" });
    expect(g.state().intro).toBeUndefined();
  });

  it("a HOST_INTRO with no intro showing does nothing, and only the host may send one", () => {
    const g = lobby();
    g.start({});
    const before = g.io.broadcast.mock.calls.length;
    g.page(2);
    expect(g.io.broadcast.mock.calls.length).toBe(before);
    const h = lobby();
    h.start({ intro: true });
    send(h.room, h.phone, { type: "HOST_INTRO", page: 2 });
    expect(h.state().intro).toEqual({ page: 1 });
  });

  it("結束冒險 during the intro drops it", () => {
    const g = lobby();
    g.start({ intro: true });
    send(g.room, g.host, { type: "HOST_END_GAME" });
    expect(g.state()).toMatchObject({ phase: "finished" });
    expect(g.state().intro).toBeUndefined();
  });

  it("LOBBY says replay only after a game that showed a question (D5)", () => {
    const g = lobby();
    expect(g.lobbyMsg().replay).toBeUndefined();
    // Ended during the intro, nothing shown: still a first game.
    g.start({ intro: true });
    send(g.room, g.host, { type: "HOST_END_GAME" });
    send(g.room, g.host, { type: "HOST_BACK_TO_LOBBY" });
    expect(g.lobbyMsg().replay).toBeUndefined();
    // A game with an answer shown.
    g.start({});
    const s = g.state();
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: T1, questionId: g.room.game!.teams[0].currentQuestionId, correct: true, eventId: s.eventId });
    send(g.room, g.host, { type: "HOST_END_GAME" });
    send(g.room, g.host, { type: "HOST_BACK_TO_LOBBY" });
    expect(g.lobbyMsg().replay).toBe(true);
  });

  it("a restart shows the same page, and a save from before the intro has none (D9)", async () => {
    const storage = memoryStorage();
    const g = lobby(storage);
    g.start({ intro: true });
    g.page(2);
    g.page(3);
    const restored = async () => {
      const io = { broadcast: vi.fn(), storage } as unknown as RoomIO;
      const room = new DungeonRoom(io, () => 0, { epilogueDelayMs: 0 });
      expect(await room.restore()).toBe("restored");
      const screen = makeConn("screen");
      room.onConnect(screen);
      return msgs(screen.send.mock.calls).findLast((m) => m.type === "STATE");
    };
    expect(await restored()).toMatchObject({ intro: { page: 3 }, question: null });

    const old = storage.data.get(SNAPSHOT_KEY) as any;
    delete old.intro;
    storage.data.set(SNAPSHOT_KEY, old);
    expect((await restored()).intro).toBeUndefined();
  });
});
