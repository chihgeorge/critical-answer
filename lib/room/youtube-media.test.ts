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
const video = (id: string, extra: object = {}) => ({ kind: "text", id, content: { kind: "youtube", value: VIDEO, audioOnly: true, start: 5, end: 20 }, answer: `答案 ${id}`, ...extra }); // pregate-literal: MAX_BOSS_HP=20 not the HP cap
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

function game(questions: object[], roll = true) {
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
  /** Check first, question after: a fill-in's video is up only once its team's persuasion check's beat has ended. */
  const check = () => {
    send(room, phone, { type: "TEAM_ROLL_CHECK", questionId: state().question.id, eventId: state().eventId });
    (room as unknown as { resolveRoll(): void }).resolveRoll();
  };
  if (roll) check();
  const media = (action: string, questionId = state().question?.id ?? state().reveal?.questionId, conn: Conn = host) =>
    send(room, conn, { type: "HOST_MEDIA", questionId, action });
  /** Answers the question in play correctly; a fill-in question passes its persuasion check first. */
  const correct = () => {
    const g = room.game!;
    const qid = g.teams[0].currentQuestionId;
    room.game = { ...g, checks: { ...g.checks, [checkKey(qid, T1)]: { value: 10, bonus: 0, dc: 8, passed: true } } };
    send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: qid, correct: true, fleeChoice: "retry", eventId: state().eventId });
  };
  return { room, io, host, phone, state, media, correct, check };
}

// Value: protects=check first, question after: a fill-in's prompt, field labels and video never reach a phone or the TV
// before its check; fails_when=shownQuestion() spreads the question instead of picking id, difficulty, boss and monster.
describe("check first, question after", () => {
  it("STATE holds back a fill-in's prompt and video until its check is done", () => {
    const g = game([video("v1", { prompt: "這首歌是？" })], false);
    expect(Object.keys(g.state().question).sort()).toEqual(["boss", "checkFirst", "content", "difficulty", "id", "monster"]);
    expect(JSON.stringify(g.io.broadcast.mock.calls)).not.toContain("這首歌是？");
    expect(JSON.stringify(g.phone.send.mock.calls)).not.toContain("這首歌是？");
    // A first character an earlier team's mage got on the same (shared boss) question waits with the question.
    // So does the character an earlier team's own check earned (a team that has since left the room's teams list never matters).
    const T2 = "00000000-0000-0000-0000-000000000002";
    const other = makeConn("other");
    g.room.game = { ...g.room.game!, mageHints: { v1: "答" }, teams: [...g.room.game!.teams, { ...g.room.game!.teams[0], id: T2, name: "乙隊", online: false }], checks: { [checkKey("v1", T2)]: { value: 12, bonus: 0, dc: 8, passed: true, hint: "答" } } };
    g.room.onConnect(other);
    const held = msgs(other.send.mock.calls).findLast((m) => m.type === "STATE");
    expect(held.view.mageHints).toEqual({});
    expect(JSON.stringify(held.view.checks)).not.toContain("答");
    g.check();
    expect(g.state().view.mageHints).toEqual({ v1: "答" });
    expect(g.state().question.prompt).toBe("這首歌是？");
    expect(g.state().question.content.kind).toBe("youtube");
  });
});

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
    expect(g.state().reveal.video).toEqual({ kind: "youtube", audioOnly: true });
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

// docs/designs/screen-video-key.md: a video's YouTube title is the answer to a music question, so its id goes only to
// the host pages and to a big screen that sent the room's screen key, never in STATE.
describe("the screen key", () => {
  const sentTo = (conn: { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls);
  const videoOf = (conn: { send: ReturnType<typeof vi.fn> }) => sentTo(conn).findLast((m) => m.type === "SCREEN_VIDEO");
  const keyOf = (host: { send: ReturnType<typeof vi.fn> }): string => sentTo(host).find((m) => m.type === "HOST_OK").screenKey;
  /** A /screen page: SCREEN_HELLO on open, with the key its link carried. */
  function screen(room: DungeonRoom, id: string, key?: string) {
    const conn = makeConn(id);
    room.onConnect(conn);
    send(room, conn, { type: "SCREEN_HELLO", ...(key === undefined ? {} : { key }) });
    return conn;
  }
  const FULL = { kind: "youtube", videoId: VIDEO, audioOnly: true, start: 5, end: 20 }; // pregate-literal: MAX_BOSS_HP=20 not the HP cap

  it("a phone, a big screen with no key and one with a wrong key never get the video id: not with the question, the ▶ or the reveal", () => {
    const g = game([video("v1"), video("v2")]);
    const key = keyOf(g.host);
    expect(key.length).toBeGreaterThanOrEqual(32);
    const bare = screen(g.room, "bare");
    const wrong = screen(g.room, "wrong", `${key.slice(0, -1)}${key.endsWith("0") ? "1" : "0"}`);
    const empty = screen(g.room, "empty", "");
    expect(g.state().question.content).toEqual({ kind: "youtube", audioOnly: true });
    g.media("play");
    g.media("restart");
    g.media("pause");
    g.correct();
    expect(g.state().reveal.video).toEqual({ kind: "youtube", audioOnly: true });
    g.media("play", g.state().reveal.questionId);
    // A socket that connects during the reveal, and a phone that sends the host's kind of hello with no key.
    const late = makeConn("late");
    g.room.onConnect(late);
    send(g.room, g.phone, { type: "SCREEN_HELLO" });
    serveNext(g.room, g.host, g.state().eventId);
    g.check();
    expect(g.state().question.content.kind).toBe("youtube");
    for (const conn of [bare, wrong, empty, late]) expect(sentTo(conn).some((m) => m.type === "STATE")).toBe(true);
    for (const conn of [g.phone, bare, wrong, empty, late]) expect(JSON.stringify(sentTo(conn))).not.toContain(VIDEO);
    // Nothing that goes to every socket carries it either.
    expect(JSON.stringify(g.io.broadcast.mock.calls)).not.toContain(VIDEO);
  });

  it("the host and a big screen with the key get it: on hello, with each question, and for the reveal", () => {
    const g = game([video("v1"), video("v2")]);
    const id = g.state().question.id;
    expect(videoOf(g.host)).toEqual({ type: "SCREEN_VIDEO", questionId: id, video: FULL });
    const keyed = screen(g.room, "keyed", keyOf(g.host));
    expect(videoOf(keyed)).toEqual({ type: "SCREEN_VIDEO", questionId: id, video: FULL });
    // It comes before the STATE it belongs to, so the screen never has the question without its video.
    keyed.send.mockClear();
    g.io.broadcast.mockImplementationOnce(() => expect(videoOf(keyed)).toBeDefined());
    g.correct();
    expect(g.state().reveal.video).toBeDefined();
    expect(videoOf(keyed)).toEqual({ type: "SCREEN_VIDEO", questionId: id, video: FULL });
    serveNext(g.room, g.host, g.state().eventId);
    const next = g.state().question.id;
    expect(next).not.toBe(id);
    // Check first, question after: the next video's id goes out only once its team's check is done, and ▶ waits too.
    expect(g.state().question).toMatchObject({ checkFirst: true, content: { kind: "text", value: "" } });
    for (const conn of [g.host, keyed]) expect(videoOf(conn).questionId).toBe(id);
    g.media("play", next);
    expect(g.state().media).toBeUndefined();
    g.check();
    for (const conn of [g.host, keyed]) expect(videoOf(conn)).toEqual({ type: "SCREEN_VIDEO", questionId: next, video: FULL });
    // A host page that reloads gets the key again, and the video on show.
    const reloaded = makeConn("host-2");
    g.room.onConnect(reloaded);
    send(g.room, reloaded, { type: "HOST_CLAIM", token: TOKEN });
    expect(keyOf(reloaded)).toBe(keyOf(g.host));
    expect(videoOf(reloaded)).toEqual({ type: "SCREEN_VIDEO", questionId: next, video: FULL });
  });

  it("the key is proved per socket: a reconnect under the same id, or a later hello without it, gets no more videos", () => {
    const g = game([video("v1"), video("v2")]);
    const key = keyOf(g.host);
    const keyed = screen(g.room, "tv", key);
    expect(videoOf(keyed)).toBeDefined();
    // Someone else's socket takes the id (ids come from the client).
    const taken = makeConn("tv");
    g.room.onConnect(taken);
    send(g.room, taken, { type: "SCREEN_HELLO" });
    const again = screen(g.room, "tv-2", key);
    send(g.room, again, { type: "SCREEN_HELLO", key: "not-the-key" });
    again.send.mockClear();
    g.correct();
    expect(videoOf(taken)).toBeUndefined();
    expect(videoOf(again)).toBeUndefined();
    // A closed screen is forgotten.
    const closed = screen(g.room, "tv-3", key);
    g.room.onClose(closed);
    closed.send.mockClear();
    serveNext(g.room, g.host, g.state().eventId);
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("sends nothing for a question that is not a video", () => {
    const t = game([text("t1"), text("t2")]);
    const keyed = screen(t.room, "keyed", keyOf(t.host));
    t.correct();
    for (const conn of [t.host, keyed]) expect(videoOf(conn)).toBeUndefined();
  });

  it("sends no SCREEN_VIDEO for a reveal whose video explanation takes the video's place", () => {
    const g = game([video("v1", { explanation: { kind: "youtube", value: VIDEO } }), video("v2", { explanation: { kind: "youtube", value: VIDEO } })]);
    const keyed = screen(g.room, "keyed", keyOf(g.host));
    keyed.send.mockClear();
    g.host.send.mockClear();
    g.correct();
    expect(g.state().reveal.video).toBeUndefined();
    for (const conn of [g.host, keyed]) expect(videoOf(conn)).toBeUndefined();
  });

  // Value: protects=an Instagram explanation's shortcode reaches only the host and a keyed screen, and ▶ ⏸ ⟲ work on it (instagram-explanations.md); fails_when=the shortcode rides on STATE, or SCREEN_VIDEO sends the question's video instead; seam=none; no_claim=the embed itself
  it("an Instagram explanation: STATE says only that it is one; the host and a keyed screen get its shortcode; ▶ works on it", () => {
    const SHORT = "DPPHHjlkTgr";
    const explanation = { kind: "instagram", value: SHORT, end: 30 };
    const g = game([video("v1", { explanation }), video("v2", { explanation })]);
    const keyed = screen(g.room, "keyed", keyOf(g.host));
    const bare = screen(g.room, "bare");
    g.correct();
    const reveal = g.state().reveal;
    expect(reveal.explanation).toEqual({ kind: "instagram" });
    expect(reveal.video).toBeUndefined();
    for (const conn of [g.host, keyed]) expect(videoOf(conn)).toEqual({ type: "SCREEN_VIDEO", questionId: reveal.questionId, video: { kind: "instagram", shortcode: SHORT, end: 30 } });
    g.media("play", reveal.questionId);
    expect(g.state().media).toMatchObject({ questionId: reveal.questionId, state: "playing" });
    for (const conn of [g.phone, bare]) expect(JSON.stringify(sentTo(conn))).not.toContain(SHORT);
    expect(JSON.stringify(g.io.broadcast.mock.calls)).not.toContain(SHORT);
  });

  it("tells a big screen whether its key was taken, so it can say it will play no video", () => {
    const g = game([video("v1"), video("v2")]);
    const ack = (conn: { send: ReturnType<typeof vi.fn> }) => sentTo(conn).findLast((m) => m.type === "SCREEN_KEY");
    expect(ack(screen(g.room, "keyed", keyOf(g.host)))).toEqual({ type: "SCREEN_KEY", ok: true });
    expect(ack(screen(g.room, "bare"))).toEqual({ type: "SCREEN_KEY", ok: false });
    expect(ack(screen(g.room, "wrong", "not-the-key"))).toEqual({ type: "SCREEN_KEY", ok: false });
    // The key itself never goes to a screen, and never to everyone.
    expect(JSON.stringify([sentTo(g.phone), g.io.broadcast.mock.calls])).not.toContain(keyOf(g.host));
  });

  it("drops a key that is not a short string instead of comparing it", () => {
    const g = game([video("v1"), video("v2")]);
    for (const [i, key] of ["x".repeat(65), 7, null, { length: 1 }].entries()) {
      const conn = screen(g.room, `odd-${i}`, key as string);
      expect(videoOf(conn)).toBeUndefined();
    }
  });
});
