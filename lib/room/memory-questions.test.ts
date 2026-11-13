// 記憶題 in the room (docs/designs/memory-questions.md): while the media plays only the media goes out and nobody
// answers; when it ends (clip end, image seconds, or the host's ⏭) the media is gone and the question appears, once
// per question, across restarts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const [A] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const KEY = "11111111-2222-3333-4444-555555555555";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const memVideo = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "youtube", value: "dQw4w9WgXcQ", end: 10 }, prompt: "影片裡有幾隻貓？", options: ["1", "2", "3"], correctIndex: 1, memory: true });
const memAudio = (id: string) => ({ kind: "sort", id, content: { kind: "audio", value: KEY }, prompt: "照出現順序排", items: ["甲", "乙", "丙", "丁"], memory: true });
const memImage = (id: string, seconds = 10) => ({ kind: "multipleChoice", id, content: { kind: "image", value: KEY }, prompt: "圖裡有幾隻貓？", options: ["1", "2", "3"], correctIndex: 1, memory: true, memorySeconds: seconds });
const memText = (id: string) => ({ kind: "text", id, content: { kind: "image", value: KEY }, prompt: "圖裡的貓叫什麼？", answer: "咪咪", memory: true, memorySeconds: 5 });
const bank = (first: object, second: object = text("r2")) =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [first, second, text("r3"), text("r4")] }],
    boss: { monster: "dragon", maxHp: 1, questions: [text("b1")] },
  });

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));
const screenKeyOf = (room: DungeonRoom) => (room as unknown as { screenKey: string }).screenKey;

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage & { data: Map<string, unknown> };
}

function makeRoom(storage: RoomStorage, b: ReturnType<typeof bank>) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: b, epilogueDelayMs: 0 });
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  return { room, io, storage, state };
}

/** Two teams (甲 mage, 乙), a host and a keyed big screen; A is on turn with the bank's first question. */
function started(b: ReturnType<typeof bank>, fields: object = {}) {
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
  send(g.room, phones[0], { type: "TEAM_PICK_CLASS", classId: "mage" });
  send(g.room, host, { type: "HOST_START", aiNarration: false, ...fields });
  const screen = makeConn("screen");
  g.room.onConnect(screen);
  send(g.room, screen, { type: "SCREEN_HELLO", key: screenKeyOf(g.room) });
  const lastError = (conn: Conn) => msgs((conn as unknown as { send: ReturnType<typeof vi.fn> }).send.mock.calls).findLast((m) => m.type === "ERROR");
  const hostAnswer = () => msgs((host as unknown as { send: ReturnType<typeof vi.fn> }).send.mock.calls).findLast((m) => m.type === "HOST_ANSWER");
  const judge = (correct: boolean) => {
    const s = g.state();
    send(g.room, host, { type: "HOST_JUDGE", teamId: s.view.currentTurnTeamId, questionId: s.question.id, correct, fleeChoice: "retry", eventId: s.eventId });
  };
  return { ...g, host, phones, screen, lastError, hostAnswer, judge };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("記憶題 with a clip", () => {
  // Value: protects=owner decisions 1–2 (hidden while the clip plays; gone after, no replay); fails_when=STATE carries
  // the prompt/options during the clip, or the clip (and its ▶) survives the end.
  it("hides the question while the clip plays, then shows it as text with no video and refuses ▶", () => {
    const g = started(bank(memVideo("m1")), { answerSeconds: 30 });
    const q = g.state().question;
    expect(q).toMatchObject({ id: "m1", memorize: true, content: { kind: "youtube" } });
    expect(q.prompt).toBeUndefined();
    expect(q.options).toBeUndefined();
    // The count waits for the media to end; the host has the whole question.
    expect(g.state().answerClock).toEqual({ left: null });
    expect(g.hostAnswer().question).toMatchObject({ id: "m1", memorize: true, prompt: "影片裡有幾隻貓？", options: ["1", "2", "3"] });
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "m1", action: "play" });
    expect(g.state().media).toMatchObject({ questionId: "m1", state: "playing" });
    send(g.room, g.screen, { type: "SCREEN_CLIP_ENDED", questionId: "m1" });
    const after = g.state().question;
    expect(after).toMatchObject({ id: "m1", content: { kind: "text", value: "影片裡有幾隻貓？" }, options: ["1", "2", "3"] });
    expect(after.memorize).toBeUndefined();
    expect(g.state().answerClock).toEqual({ left: 30000 });
    expect(g.state().media).toBeUndefined();
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "m1", action: "restart" });
    expect(g.state().media).toBeUndefined();
  });

  // Value: protects=no answer, ability or hint during the phase; fails_when=a stale phone locks, or a mage learns an option.
  it("refuses phone answers and abilities while memorizing, and takes them after", () => {
    const g = started(bank(memVideo("m1")));
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "m1", optionIndex: 1 });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "memorizing" });
    send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "m1" });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "memorizing" });
    send(g.room, g.phones[0], { type: "TEAM_USE_ABILITY", questionId: "m1" });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "memorizing" });
    expect(g.room.game!.eliminated.m1 ?? []).toEqual([]);
    send(g.room, g.screen, { type: "SCREEN_CLIP_ENDED", questionId: "m1" });
    send(g.room, g.phones[0], { type: "TEAM_USE_ABILITY", questionId: "m1" });
    expect(g.room.game!.eliminated.m1?.length).toBe(1);
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "m1", optionIndex: 1 });
    expect(g.room.game!.teams.find((t) => t.id === A)?.currentSelection).toBe(1);
  });

  // Value: protects=the media ends once per question; fails_when=another clip's end re-opens a done memory question (replay).
  it("stays done when another question's clip ends later (per-question memory)", () => {
    const g = started(bank(memVideo("m1"), { kind: "text", id: "v2", content: { kind: "youtube", value: "dQw4w9WgXcQ" }, prompt: "這首歌？", answer: "歌" }));
    send(g.room, g.screen, { type: "SCREEN_CLIP_ENDED", questionId: "m1" });
    g.judge(false); // A misses: B's turn on its own clip question
    expect(g.state().question.id).toBe("v2");
    send(g.room, g.phones[1], { type: "TEAM_ROLL_CHECK", questionId: "v2", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    send(g.room, g.screen, { type: "SCREEN_CLIP_ENDED", questionId: "v2" });
    g.judge(false);
    expect(g.state().question).toMatchObject({ id: "m1", content: { kind: "text", value: "影片裡有幾隻貓？" } });
  });

  it("an uploaded audio clip ends its memory phase on the big screen's report too", () => {
    const g = started(bank(memAudio("a1")));
    expect(g.state().question).toMatchObject({ id: "a1", memorize: true, content: { kind: "youtube", audioOnly: true } });
    expect(g.state().question.items).toBeUndefined();
    send(g.room, g.screen, { type: "SCREEN_CLIP_ENDED", questionId: "a1" });
    expect(g.state().question).toMatchObject({ content: { kind: "text", value: "照出現順序排" } });
    expect(g.state().question.items).toHaveLength(4);
  });

  it("the host's ⏭ ends it at once; a second press is a no-op and a wrong id is stale", () => {
    const g = started(bank(memVideo("m1")));
    send(g.room, g.host, { type: "HOST_MEMORY_DONE", questionId: "zzz" });
    expect(g.lastError(g.host)).toMatchObject({ detail: "stale_question" });
    send(g.room, g.host, { type: "HOST_MEMORY_DONE", questionId: "m1" });
    expect(g.state().question.memorize).toBeUndefined();
    const errors = msgs((g.host as unknown as { send: ReturnType<typeof vi.fn> }).send.mock.calls).filter((m) => m.type === "ERROR").length;
    send(g.room, g.host, { type: "HOST_MEMORY_DONE", questionId: "m1" });
    expect(msgs((g.host as unknown as { send: ReturnType<typeof vi.fn> }).send.mock.calls).filter((m) => m.type === "ERROR").length).toBe(errors);
  });

  it("a phone cannot press ⏭", () => {
    const g = started(bank(memVideo("m1")));
    send(g.room, g.phones[0], { type: "HOST_MEMORY_DONE", questionId: "m1" });
    expect(g.state().question.memorize).toBe(true);
  });

  it("the oracle is closed while the clip plays and open after", () => {
    const g = started(bank(memVideo("m1")));
    send(g.room, g.host, { type: "HOST_ANTI_CHEAT", on: true });
    send(g.room, g.phones[0], { type: "TEAM_ORACLE", questionId: "m1" });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "not_now" });
    const errors = msgs(g.phones[0].send.mock.calls).filter((m) => m.type === "ERROR").length;
    send(g.room, g.screen, { type: "SCREEN_CLIP_ENDED", questionId: "m1" });
    send(g.room, g.phones[0], { type: "TEAM_ORACLE", questionId: "m1" });
    expect(msgs(g.phones[0].send.mock.calls).filter((m) => m.type === "ERROR").length).toBe(errors);
  });

  // Value: protects=the reveal payoff; fails_when=the reveal of a memory question shows no question or media.
  it("the reveal carries the whole question with its media", () => {
    const g = started(bank(memText("t1")));
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(7000);
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "t1", text: "咪咪" });
    g.judge(true);
    expect(g.state().reveal.asked).toMatchObject({ content: { kind: "image" }, prompt: "圖裡的貓叫什麼？" });
  });
});

describe("記憶題 with an image", () => {
  it("shows the image for its seconds, then hides it and shows the question; the count starts then", () => {
    const g = started(bank(memImage("i1", 5)), { answerSeconds: 30 });
    expect(g.state().question).toMatchObject({ id: "i1", memorize: true, memoryLeft: 5000, content: { kind: "image" } });
    expect(g.state().answerClock).toEqual({ left: null });
    vi.advanceTimersByTime(4999);
    expect(g.state().question.memorize).toBe(true);
    vi.advanceTimersByTime(1);
    expect(g.state().question).toMatchObject({ content: { kind: "text", value: "圖裡有幾隻貓？" }, options: ["1", "2", "3"] });
    expect(g.state().answerClock).toEqual({ left: 30000 });
  });

  it("a fill-in is check first, then the image, then the question", () => {
    const g = started(bank(memText("t1")));
    expect(g.state().question).toMatchObject({ checkFirst: true, content: { kind: "text", value: "" } });
    vi.advanceTimersByTime(30000); // no seconds run before the check
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    expect(g.state().question).toMatchObject({ memorize: true, memoryLeft: 5000, content: { kind: "image" } });
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "t1", text: "咪咪" });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "memorizing" });
    vi.advanceTimersByTime(5000);
    expect(g.state().question).toMatchObject({ content: { kind: "text", value: "圖裡的貓叫什麼？" } });
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "t1", text: "咪咪" });
    expect(g.room.game!.teams.find((t) => t.id === A)?.typedAnswer).toBe("咪咪");
  });

  it("the host's ⏭ cuts an image short, and its old deadline sends nothing back", () => {
    const g = started(bank(memImage("i1", 10)));
    vi.advanceTimersByTime(3000);
    send(g.room, g.host, { type: "HOST_MEMORY_DONE", questionId: "i1" });
    expect(g.state().question).toMatchObject({ content: { kind: "text" } });
    const sent = g.io.broadcast.mock.calls.length;
    vi.advanceTimersByTime(10000);
    expect(g.io.broadcast.mock.calls.length).toBe(sent);
  });

  // Value: protects=a stuck big screen; fails_when=a reconnect's lone snapshot past the deadline cancels the timer
  // whose STATE would tell every other screen the image ended.
  it("a reconnect just past the deadline still lets the timer tell everyone", () => {
    const g = started(bank(memImage("i1", 5)));
    vi.setSystemTime(Date.now() + 5000); // the clock moves, the timer has not fired yet
    g.room.onConnect(makeConn("late"));
    vi.advanceTimersByTime(5000);
    expect(g.state().question).toMatchObject({ content: { kind: "text" } });
  });

  // Value: protects=an idle room; fails_when=a deadline with no question in play re-arms its timer at 0 forever.
  it("an image whose game ended does not keep the room busy", () => {
    const g = started(bank(memImage("i1", 5)));
    send(g.room, g.host, { type: "HOST_END_GAME" });
    vi.advanceTimersByTime(6000);
    const sent = g.io.broadcast.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(g.io.broadcast.mock.calls.length).toBe(sent);
  });

  // Value: protects=the memory test; fails_when=a team on turn closes its phone and gets the image's full seconds again.
  it("the turn's phone going offline keeps the image's deadline: back soon, only the seconds left; back late, the question", () => {
    const g = started(bank(memImage("i1", 10)));
    const rejoin = () => {
      const back = makeConn("back");
      g.room.onConnect(back);
      send(g.room, back, { type: "JOIN", teamId: A, teamKey: "team-key-0123456789abcde0", teamName: "甲隊", resume: true });
      return back;
    };
    vi.advanceTimersByTime(3000);
    g.room.onClose(g.phones[0]);
    expect(g.state().view.currentTurnTeamId).not.toBe(A);
    const back = rejoin();
    expect(g.state().question).toMatchObject({ id: "i1", memorize: true, memoryLeft: 7000 });
    g.room.onClose(back);
    vi.advanceTimersByTime(8000);
    rejoin();
    expect(g.state().question).toMatchObject({ id: "i1", content: { kind: "text" } });
  });

  // Value: protects=the next team's image; fails_when=the turn moving off one image leaves the next image with no clock.
  it("the turn moving from one image to another starts the next one's seconds", () => {
    const g = started(bank(memImage("i1", 10), memImage("i2", 5)));
    vi.advanceTimersByTime(3000);
    g.room.onClose(g.phones[0]);
    expect(g.state().question).toMatchObject({ id: "i2", memorize: true, memoryLeft: 5000 });
    vi.advanceTimersByTime(5000);
    expect(g.state().question).toMatchObject({ id: "i2", content: { kind: "text" } });
  });

  it("a phone action just after the deadline is taken, before the timer's STATE", () => {
    const g = started(bank(memImage("i1", 5)));
    vi.setSystemTime(Date.now() + 5000); // the clock moves, the timer has not fired yet
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "i1", optionIndex: 1 });
    expect(g.room.game!.teams.find((t) => t.id === A)?.currentSelection).toBe(1);
  });

  it("a restart keeps the remaining seconds and a done question stays done", async () => {
    const g = started(bank(memImage("i1", 10)));
    vi.advanceTimersByTime(4000);
    send(g.room, g.phones[1], { type: "TEAM_SELECT_OPTION", questionId: "x", optionIndex: 0 }); // any message saves
    const second = makeRoom(g.storage, bank(memImage("i1", 10)));
    expect(await second.room.restore()).toBe("restored");
    const screen = makeConn("tv");
    second.room.onConnect(screen);
    const phone = makeConn("again");
    second.room.onConnect(phone);
    send(second.room, phone, { type: "JOIN", teamId: A, teamKey: "team-key-0123456789abcde0", teamName: "甲隊", resume: true });
    expect(second.state().question).toMatchObject({ memorize: true, memoryLeft: 6000 });
    vi.advanceTimersByTime(6000); // the restored timer fires on its own
    expect(second.state().question).toMatchObject({ content: { kind: "text", value: "圖裡有幾隻貓？" } });
    send(second.room, screen, { type: "SCREEN_HELLO" }); // saves
    const third = makeRoom(second.storage, bank(memImage("i1", 10)));
    expect(await third.room.restore()).toBe("restored");
    const back = makeConn("back");
    third.room.onConnect(back);
    send(third.room, back, { type: "JOIN", teamId: A, teamKey: "team-key-0123456789abcde0", teamName: "甲隊", resume: true });
    expect(third.state().question).toMatchObject({ id: "i1", content: { kind: "text" } });
  });

  // Value: protects=no hint over the media; fails_when=a hint for the held question shows during the phase.
  it("holds a mage hint on the question while its media plays", () => {
    const g = started(bank(memText("t1")));
    g.room.game = { ...g.room.game!, mageHints: { t1: "咪" } };
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    expect(g.state().question.memorize).toBe(true);
    expect(g.state().view.mageHints.t1).toBeUndefined();
    vi.advanceTimersByTime(5000);
    expect(g.state().view.mageHints.t1).toBe("咪");
  });
});
