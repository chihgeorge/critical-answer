// 每題作答倒數 in the room (docs/designs/answer-countdown.md): the room holds the deadline, STATE carries `left`,
// an answer waiting for the host stops it, 重答 and new turns start it again, a video waits for its clip, and a
// restart keeps the remaining time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { nextAnswerClock } from "../answer-clock";
import { SERVE_HOLD_MS, parseClientMessage } from "../protocol";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const [A, B] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const mc = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "text", value: `題目 ${id}` }, options: ["甲", "乙", "丙", "丁"], correctIndex: 0 });
const video = (id: string) => ({ kind: "text", id, content: { kind: "youtube", value: "dQw4w9WgXcQ" }, prompt: "這首歌是？", answer: `答案 ${id}` });
const bank = (first: object = text("r1")) =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [first, text("r2"), text("r3"), text("r4")] }],
    boss: { monster: "dragon", maxHp: 1, questions: [text("b1")] },
  });

/** The room's screen key, as the big screen link on the host page carries it (docs/designs/screen-video-key.md). */
const screenKeyOf = (room: DungeonRoom) => (room as unknown as { screenKey: string }).screenKey;
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage & { data: Map<string, unknown> };
}

function makeRoom(storage = memoryStorage(), b = bank()) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: b, epilogueDelayMs: 0 });
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  return { room, io, storage, state };
}

/** Two teams (甲 乙) and a host; `fields` go on HOST_START. */
function started(fields: object = { answerSeconds: 60 }, b = bank()) {
  const g = makeRoom(memoryStorage(), b);
  const host = makeConn("host");
  g.room.onConnect(host);
  send(g.room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const conn = makeConn(`p${i}`);
    g.room.onConnect(conn);
    send(g.room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊"][i] });
    return conn;
  });
  send(g.room, host, { type: "HOST_START", aiNarration: false, ...fields });
  const judge = (correct: boolean, fleeChoice: "retry" | "flee" = "retry") => {
    const s = g.state();
    send(g.room, host, { type: "HOST_JUDGE", teamId: s.view.currentTurnTeamId, questionId: s.question.id, correct, fleeChoice, eventId: s.eventId });
  };
  return { ...g, host, phones, judge, peek: () => peek(g.room) };
}

/** The STATE a big screen connecting now gets: the room's figure at this moment, with no other message needed. */
let peeks = 0;
function peek(room: DungeonRoom) {
  const conn = makeConn(`screen-${peeks++}`);
  room.onConnect(conn);
  return msgs(conn.send.mock.calls).findLast((m) => m.type === "STATE");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("nextAnswerClock", () => {
  it("starts a full count for a new turn, keeps the deadline for the same one, and clears with nobody answering", () => {
    const c = nextAnswerClock(null, "a:q1", 1000, 60000);
    expect(c).toEqual({ key: "a:q1", endsAt: 61000 });
    expect(nextAnswerClock(c, "a:q1", 50000, 60000)).toBe(c);
    expect(nextAnswerClock(c, "b:q2", 50000, 60000)).toEqual({ key: "b:q2", endsAt: 110000 });
    expect(nextAnswerClock(c, null, 50000, 60000)).toBeNull();
    expect(nextAnswerClock(null, "a:q1", 0, 0)).toBeNull();
  });
});

describe("HOST_START answerSeconds", () => {
  it("takes only the lobby's choices", () => {
    expect(parseClientMessage(({ type: "HOST_START", answerSeconds: 45 }))).toMatchObject({ answerSeconds: 45 });
    expect(parseClientMessage(({ type: "HOST_START", answerSeconds: 0 }))).not.toHaveProperty("answerSeconds");
    expect(parseClientMessage(({ type: "HOST_START", answerSeconds: 7 }))).toBeNull();
    expect(parseClientMessage(({ type: "HOST_START", answerSeconds: "60" }))).toBeNull();
    expect(parseClientMessage(({ type: "SCREEN_CLIP_ENDED", questionId: "" }))).toBeNull();
    expect(parseClientMessage(({ type: "SCREEN_CLIP_ENDED", questionId: 5 }))).toBeNull();
    expect(parseClientMessage(({ type: "SCREEN_CLIP_ENDED", questionId: "q1" }))).toEqual({ type: "SCREEN_CLIP_ENDED", questionId: "q1" });
  });
});

describe("每題作答倒數 in the room", () => {
  it("is off without answerSeconds", () => {
    const g = started({});
    expect(g.state().question).not.toBeNull();
    expect(g.state().answerClock).toBeUndefined();
  });

  it("sets the deadline when the question is up, counts down, and does nothing at 0 but say so", () => {
    const g = started();
    expect(g.state().answerClock).toEqual({ left: 60000 });
    vi.advanceTimersByTime(20000);
    expect(g.peek().answerClock).toEqual({ left: 40000 });
    vi.advanceTimersByTime(60000);
    const late = g.peek();
    // Expiry is only a nudge (D1): still the same team's turn, nothing judged.
    expect(late.answerClock).toEqual({ left: 0 });
    expect(late.view.currentTurnTeamId).toBe(A);
    expect(late.eventId).toBe(g.state().eventId);
  });

  it("stops once the team sends its answer, and the next team gets a full count", () => {
    const g = started();
    vi.advanceTimersByTime(10000);
    // A fill-in rolls its persuasion check first; the check's beat does not stop the count.
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: g.state().question.id, eventId: g.state().eventId });
    expect(g.state().pendingRoll).toMatchObject({ kind: "check" });
    expect(g.state().answerClock).toEqual({ left: 50000 });
    vi.advanceTimersByTime(5000);
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: g.state().question.id, text: "玉山" });
    expect(g.state().view.teams[0].typedAnswer).toBe("玉山");
    expect(g.state().answerClock).toBeUndefined();
    vi.advanceTimersByTime(30000);
    g.judge(true);
    // The answer reveal is up: nobody is answering until the host's 下一題.
    expect(g.state().reveal).not.toBeNull();
    expect(g.state().answerClock).toBeUndefined();
    send(g.room, g.host, { type: "HOST_SERVE", eventId: g.state().eventId });
    vi.advanceTimersByTime(SERVE_HOLD_MS);
    send(g.room, g.host, { type: "HOST_NEXT", eventId: g.state().eventId });
    expect(g.state().view.currentTurnTeamId).toBe(B);
    expect(g.state().answerClock).toEqual({ left: 60000 });
  });

  it("a wrong answer stops it; the team's next go at the question starts a full count again", () => {
    const g = started();
    vi.advanceTimersByTime(25000);
    g.judge(false, "retry");
    // Turn passes on: the other team answers its own question with a fresh count.
    expect(g.state().view.currentTurnTeamId).toBe(B);
    expect(g.state().answerClock).toEqual({ left: 60000 });
    vi.advanceTimersByTime(5000);
    g.judge(false, "retry");
    expect(g.state().view.currentTurnTeamId).toBe(A);
    expect(g.state().answerClock).toEqual({ left: 60000 });
  });

  it("does not run during the how-to-play intro or 擲先攻; the first question then gets the full time", () => {
    const g = started({ answerSeconds: 45, intro: true, initiative: true });
    expect(g.state().intro).toBeDefined();
    expect(g.state().answerClock).toBeUndefined();
    for (let page = 2; page <= 5; page++) send(g.room, g.host, { type: "HOST_INTRO", page });
    expect(g.state().initiative).toBeDefined();
    expect(g.state().answerClock).toBeUndefined();
    vi.advanceTimersByTime(10000);
    send(g.room, g.host, { type: "HOST_ROLL_INITIATIVE" });
    vi.advanceTimersByTime(30000); // the order holds, then the first question
    expect(g.state().initiative).toBeUndefined();
    expect(g.state().question).not.toBeNull();
    expect(g.state().answerClock).toEqual({ left: 45000 });
  });

  it("a locked choice stops it while it waits for 公布答案", () => {
    const g = started({ answerSeconds: 30 }, bank(mc("m1")));
    expect(g.state().question.id).toBe("m1");
    vi.advanceTimersByTime(7000);
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "m1", optionIndex: 1 });
    expect(g.state().answerClock).toEqual({ left: 23000 }); // picking is not answering yet
    send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "m1", optionIndex: 1 });
    expect(g.state().pendingLock).not.toBeNull();
    expect(g.state().answerClock).toBeUndefined();
  });

  it("a restart keeps the remaining time", async () => {
    const g = started();
    vi.advanceTimersByTime(15000);
    send(g.room, g.phones[1], { type: "TEAM_SELECT_OPTION", questionId: "x", optionIndex: 0 }); // any message saves
    const second = makeRoom(g.storage);
    expect(await second.room.restore()).toBe("restored");
    vi.advanceTimersByTime(5000);
    // Every phone is offline after a restart: the count is held, not dropped, until the turn's team is back.
    expect(peek(second.room).answerClock).toBeUndefined();
    const phone = makeConn("again");
    second.room.onConnect(phone);
    send(second.room, phone, { type: "JOIN", teamId: A, teamKey: "team-key-0123456789abcde0", teamName: "甲隊", resume: true });
    expect(peek(second.room).view.currentTurnTeamId).toBe(A);
    expect(peek(second.room).answerClock).toEqual({ left: 40000 });
  });

  it("an offline team is skipped with a fresh count for the next; with every phone offline the count is held", () => {
    const g = started();
    vi.advanceTimersByTime(10000);
    g.room.onClose(g.phones[0]);
    expect(g.state().view.currentTurnTeamId).toBe(B);
    expect(g.state().answerClock).toEqual({ left: 60000 });
    vi.advanceTimersByTime(10000);
    g.room.onClose(g.phones[1]);
    expect(g.state().view.currentTurnTeamId).toBeNull();
    expect(g.state().answerClock).toBeUndefined();
    vi.advanceTimersByTime(10000);
    const phone = makeConn("again");
    g.room.onConnect(phone);
    send(g.room, phone, { type: "JOIN", teamId: B, teamKey: "team-key-0123456789abcde1", teamName: "乙隊", resume: true });
    expect(g.state().view.currentTurnTeamId).toBe(B);
    expect(g.state().answerClock).toEqual({ left: 40000 });
  });
});

describe("每題作答倒數 on a video question (D4)", () => {
  it("a clip that ends while the answer waits still counts: 重答 starts the clock without waiting again", () => {
    const g = started({ answerSeconds: 30 }, bank(video("v1")));
    const screen = makeConn("screen");
    g.room.onConnect(screen);
    send(g.room, screen, { type: "SCREEN_HELLO", key: screenKeyOf(g.room) });
    // The team answers before the clip ends; the host judges it wrong while the clip is still playing.
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "v1", eventId: g.state().eventId });
    vi.advanceTimersByTime(5000);
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "v1", text: "猜一首" });
    send(g.room, screen, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().answerClock).toBeUndefined();
    g.judge(false, "retry");
    // B's turn: its own question, a text one, counts at once.
    expect(g.state().view.currentTurnTeamId).toBe(B);
    g.judge(false, "retry");
    expect(g.state().view.currentTurnTeamId).toBe(A);
    expect(g.state().question.id).toBe("v1");
    expect(g.state().answerClock).toEqual({ left: 30000 });
  });

  it("waits for the big screen's clip end; a phone or the host cannot start it, and a second report does nothing", () => {
    const g = started({ answerSeconds: 30 }, bank(video("v1")));
    expect(g.state().question.id).toBe("v1");
    expect(g.state().answerClock).toEqual({ left: null });
    send(g.room, g.phones[0], { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    send(g.room, g.host, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().answerClock).toEqual({ left: null });
    const screen = makeConn("screen");
    g.room.onConnect(screen);
    // A socket that never announced itself as a screen (a player's devtools) cannot start it either.
    send(g.room, screen, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().answerClock).toEqual({ left: null });
    // Nor one that announced itself with no screen key, or a wrong one: the room code alone is on the TV.
    for (const hello of [{}, { key: "" }, { key: "not-the-key" }]) {
      send(g.room, screen, { type: "SCREEN_HELLO", ...hello });
      send(g.room, screen, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
      expect(g.state().answerClock).toEqual({ left: null });
    }
    send(g.room, screen, { type: "SCREEN_HELLO", key: screenKeyOf(g.room) });
    send(g.room, screen, { type: "SCREEN_CLIP_ENDED", questionId: "other" });
    expect(g.state().answerClock).toEqual({ left: null });
    vi.advanceTimersByTime(4000);
    send(g.room, screen, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().answerClock).toEqual({ left: 30000 });
    vi.advanceTimersByTime(10000);
    send(g.room, screen, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().answerClock).toEqual({ left: 30000 }); // no new STATE: the last one still stands
    expect(g.peek().answerClock).toEqual({ left: 20000 });
  });
});

// partysocket keeps one connection id (_pk) for every reconnect, so the server can see the new socket before the old
// one's close. Value: protects=a Wi-Fi blip on the TV leaves video questions waiting forever for a clip end the room
// now ignores; fails_when=onClose unregisters a socket that already replaced the closed one under the same id.
describe("connections that come back under the same id", () => {
  it("an old socket's late close leaves the reconnected TV and host in place", () => {
    const g = started({ answerSeconds: 30 }, bank(video("v1")));
    const oldTv = makeConn("tv");
    g.room.onConnect(oldTv);
    send(g.room, oldTv, { type: "SCREEN_HELLO", key: screenKeyOf(g.room) });
    const tv = makeConn("tv");
    g.room.onConnect(tv);
    send(g.room, tv, { type: "SCREEN_HELLO", key: screenKeyOf(g.room) });
    const host = makeConn("host");
    g.room.onConnect(host);
    send(g.room, host, { type: "HOST_CLAIM", token: TOKEN });
    expect(oldTv.close).toHaveBeenCalled(); // one socket per id: the newcomer replaces the old one
    expect(g.host.close).toHaveBeenCalled();
    g.room.onClose(oldTv);
    g.room.onClose(g.host);
    send(g.room, host, { type: "HOST_AI_LIMIT", limit: 5 });
    expect(msgs(host.send.mock.calls).some((m) => m.error === "not_host")).toBe(false);
    vi.advanceTimersByTime(4000);
    send(g.room, tv, { type: "SCREEN_CLIP_ENDED", questionId: "v1" });
    expect(g.state().answerClock).toEqual({ left: 30000 });
  });

  // Value: protects=a full room making space mid-game never costs a team its online mark or its turn;
  // fails_when=closing a team's older spare socket runs the disconnect path as if the team left.
  it("a full room closing a team's older socket mid-game keeps the team online and on turn", () => {
    const g = started();
    const onTurn = g.state().view.currentTurnTeamId;
    const i = IDS.indexOf(onTurn);
    const twin = makeConn("twin");
    g.room.onConnect(twin);
    send(g.room, twin, { type: "JOIN", teamId: onTurn, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊"][i] });
    for (let n = 0; n < 56; n++) g.room.onConnect(makeConn(`junk${n}`)); // host, 2 phones, twin + 56 = 60
    g.room.onConnect(makeConn("late"));
    expect(g.phones[i].close).toHaveBeenCalled(); // the team's older socket was the oldest spare
    expect(g.room.game!.teams.find((t) => t.id === onTurn)!.online).toBe(true);
    expect(g.state().view.currentTurnTeamId).toBe(onTurn);
  });
});
