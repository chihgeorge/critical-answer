/* eslint-disable @typescript-eslint/no-explicit-any */
// The room side of YouTube questions (docs/designs/youtube-questions.md): the host's ▶ ⏸ ⟲ become STATE
// `media`, only for the video the big screen shows now, kept in memory only (D6).
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { parseBank } from "../question-bank";
import { checkKey } from "../game-state";

const T1 = "00000000-0000-0000-0000-000000000001";
const TOKEN = "host-token-0123456789abcdef";
const VIDEO = "dQw4w9WgXcQ";
const video = (id: string, extra: object = {}) => ({ kind: "text", id, content: { kind: "youtube", value: VIDEO, audioOnly: true, start: 5, end: 20 }, answer: `答案 ${id}`, ...extra });
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });

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

function game(questions: object[]) {
  const bank = parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions }],
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
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  const media = (action: string, questionId = state().question?.id ?? state().reveal?.questionId, conn: Conn = host) =>
    send(room, conn, { type: "HOST_MEDIA", questionId, action });
  /** Answers the question in play correctly; a fill-in question passes its persuasion check first. */
  const correct = () => {
    const g = room.game!;
    const qid = g.teams[0].currentQuestionId;
    room.game = { ...g, checks: { ...g.checks, [checkKey(qid, T1)]: { value: 10, bonus: 0, dc: 8, passed: true } } };
    send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: qid, correct: true, fleeChoice: "retry", eventId: state().eventId });
  };
  return { room, host, phone, state, media, correct };
}

describe("HOST_MEDIA", () => {
  it("play, pause and restart become STATE media; restart bumps seq, every press bumps press", () => {
    const g = game([video("v1"), video("v2")]);
    const id = g.state().question.id;
    expect(g.state().media).toBeUndefined();
    g.media("play");
    expect(g.state().media).toEqual({ questionId: id, state: "playing", seq: 0, press: 1 });
    g.media("pause");
    expect(g.state().media).toEqual({ questionId: id, state: "paused", seq: 0, press: 2 });
    g.media("restart");
    expect(g.state().media).toEqual({ questionId: id, state: "playing", seq: 1, press: 3 });
    // A second ▶ keeps state and seq but is a new press: the screen replays a clip that already ended.
    g.media("play");
    expect(g.state().media).toEqual({ questionId: id, state: "playing", seq: 1, press: 4 });
  });

  it("ignores a phone, another question's id, and a question that is not a video", () => {
    const g = game([video("v1"), video("v2")]);
    const id = g.state().question.id;
    const before = g.state();
    g.media("play", id, g.phone);
    g.media("play", id === "v1" ? "v2" : "v1");
    expect(g.state()).toEqual(before);

    const t = game([text("t1"), text("t2")]);
    const textBefore = t.state();
    t.media("play");
    expect(t.state()).toEqual(textBefore);
  });

  it("pauses on a correct answer and stays for the reveal, which shows the video (D17)", () => {
    const g = game([video("v1"), video("v2")]);
    const id = g.state().question.id;
    g.media("play");
    g.correct();
    expect(g.state().reveal.questionId).toBe(id);
    expect(g.state().reveal.video).toEqual({ kind: "youtube", videoId: VIDEO, audioOnly: true, start: 5, end: 20 });
    expect(g.state().media).toEqual({ questionId: id, state: "paused", seq: 0, press: 1 });
    g.media("play", id);
    expect(g.state().media.state).toBe("playing");
    // 下一題 closes the reveal: the answered question's command goes with it.
    serveNext(g.room, g.host, g.state().eventId);
    expect(g.state().media).toBeUndefined();
  });

  it("🍲 上菜 pauses the reveal's video before the cooking (cooking I9)", () => {
    const g = game([video("v1"), video("v2")]);
    const id = g.state().question.id;
    g.correct();
    g.media("play", id);
    expect(g.state().media.state).toBe("playing");
    send(g.room, g.host, { type: "HOST_SERVE", eventId: g.state().eventId });
    expect(g.state().reveal.served).toBe(true);
    expect(g.state().media).toMatchObject({ questionId: id, state: "paused" });
  });

  it("refuses the reveal's video when a video explanation takes its place", () => {
    const g = game([
      video("v1", { explanation: { kind: "youtube", value: VIDEO } }),
      video("v2", { explanation: { kind: "youtube", value: VIDEO } }),
    ]);
    g.correct();
    const before = g.state();
    expect(before.reveal.video).toBeUndefined();
    g.media("play", before.reveal.questionId);
    expect(g.state()).toEqual(before);
  });

  it("drops the command once the question changes, so a question that comes round again starts paused", () => {
    const g = game([video("v1"), video("v2")]);
    g.media("play");
    const room = g.room as any;
    room.media = { ...room.media, questionId: "elsewhere" };
    room.broadcastState();
    expect(g.state().media).toBeUndefined();
    expect(room.media).toBeNull();
  });

  it("parses only play, pause and restart", () => {
    const g = game([video("v1"), video("v2")]);
    const before = g.state();
    g.media("stop");
    expect(g.state()).toEqual(before);
  });
});
