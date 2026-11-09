// The room side of a buzzer boss phase (docs/designs/boss-buzzer.md): the phase card pulls every team in, the
// host's first ▶ opens buzzing, the first TEAM_BUZZ wins and stops the music, a wrong answer shuts that team out
// and resumes the music, and 沒人答對，換下一題 moves on.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"];
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const video = (id: string) => ({ kind: "text", id, content: { kind: "youtube", value: "dQw4w9WgXcQ", audioOnly: true, start: 5, end: 20 }, answer: `答案 ${id}` });

const bank = (q: (id: string) => object = video) =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("r1"), text("r2"), text("r3")] }],
    boss: {
      monster: "dragon",
      phases: [
        { maxHp: 1, questions: [text("p1-a")] },
        { name: "最終決戰", rule: "聽前奏搶答", maxHp: 2, buzzer: true, questions: [q("b-a"), q("b-b"), q("b-c")] },
      ],
    },
  });

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage(): RoomStorage {
  const data = new Map<string, unknown>();
  return { get: async (k) => structuredClone(data.get(k)), put: (k, v) => void data.set(k, structuredClone(v)) } as RoomStorage;
}

/** Three teams, the first sent to the boss room; it clears phase 1 and the host opens the buzzer phase's card, then its question. */
function buzzerGame(q?: (id: string) => object, storage: RoomStorage = memoryStorage()) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: bank(q), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const c = makeConn(`phone-${i}`);
    room.onConnect(c);
    send(room, c, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: `隊${i}` });
    return c;
  });
  send(room, host, { type: "HOST_START", aiNarration: false });
  send(room, host, { type: "HOST_SEND_TO_BOSS", teamId: IDS[0] });
  room.game = { ...room.game!, currentTurnIndex: 0 };
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  const next = () => {
    send(room, host, { type: "HOST_SERVE", eventId: state().eventId });
    (room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(room, host, { type: "HOST_NEXT", eventId: state().eventId });
  };
  const judge = (teamId: string, correct: boolean) =>
    send(room, host, { type: "HOST_JUDGE", teamId, questionId: room.game!.boss.currentQuestionId, correct, fleeChoice: "retry", eventId: state().eventId });
  const buzz = (i: number, questionId = room.game!.boss.currentQuestionId) => send(room, phones[i], { type: "TEAM_BUZZ", questionId });
  const lastError = (conn: { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).findLast((m) => m.type === "ERROR");
  judge(IDS[0], true); // phase 1's only HP
  next(); // the phase card
  next(); // the buzzer phase's first question
  return { room, host, phones, state, judge, buzz, lastError, next };
}

describe("buzzer boss phase in the room", () => {
  it("the phase card pulls every team into the boss room; STATE carries the buzz and no one is on turn", () => {
    const g = buzzerGame();
    expect(g.room.game!.teams.every((t) => t.inBoss)).toBe(true);
    expect(g.state()).toMatchObject({ question: { id: "b-a" }, view: { buzz: { questionId: "b-a", out: [] } } });
  });

  it("a video question opens on the host's first ▶; the first buzz wins, stops the music and plays the buzz cue", () => {
    const g = buzzerGame();
    g.buzz(1);
    expect(g.lastError(g.phones[1])).toMatchObject({ detail: "buzz_closed" });
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    expect(g.state().view.buzz).toMatchObject({ open: true });
    g.buzz(2);
    g.buzz(1);
    expect(g.lastError(g.phones[1])).toMatchObject({ detail: "buzz_taken" });
    expect(g.state()).toMatchObject({ cue: "buzz", media: { state: "paused" }, view: { buzz: { teamId: IDS[2] }, currentTurnTeamId: IDS[2] } });
  });

  it("a wrong buzz shuts the team out and resumes the music; a right one hits the boss and shows the answer", () => {
    const g = buzzerGame();
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    g.judge(IDS[1], false);
    expect(g.state()).toMatchObject({ media: { state: "playing" }, view: { buzz: { questionId: "b-a", out: [IDS[1]] } } });
    g.buzz(1);
    expect(g.lastError(g.phones[1])).toMatchObject({ detail: "buzz_out" });
    g.buzz(0);
    g.judge(IDS[0], true);
    expect(g.state()).toMatchObject({ cue: "boss-hit", reveal: { questionId: "b-a" }, view: { bossHp: 1 } });
    expect(g.room.game!.teams.find((t) => t.id === IDS[0])!.reward).toBe(20); // a phase-1 hit and this one
  });

  it("沒人答對，換下一題 moves to a new question, refuses a stale id, and drops a 答對 pressed for the old question", () => {
    const g = buzzerGame(text);
    send(g.room, g.host, { type: "HOST_BUZZ_SKIP", questionId: "b-c" });
    expect(g.lastError(g.host)).toMatchObject({ detail: "stale_question" });
    send(g.room, g.host, { type: "HOST_BUZZ_SKIP", questionId: "b-a" });
    expect(g.state()).toMatchObject({ question: { id: "b-b" } });
    expect(g.room.game!.revealedQuestionIds).not.toContain("b-a");
    // A 答對 for the old question, pressed as the skip landed, is refused.
    const hp = g.room.game!.boss.hp;
    g.buzz(0);
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: IDS[0], questionId: "b-a", correct: true, fleeChoice: "retry", eventId: g.state().eventId });
    expect(g.room.game!.boss.hp).toBe(hp);
    // A phone may not skip.
    send(g.room, g.phones[0], { type: "HOST_BUZZ_SKIP", questionId: "b-b" });
    expect(g.state().question.id).toBe("b-b");
  });

  it("a text question is open at once; a buzzing phone that drops lets go of the buzz", () => {
    const g = buzzerGame(text);
    g.buzz(0);
    expect(g.state().view.buzz).toMatchObject({ teamId: IDS[0] });
    g.room.onClose(g.phones[0]);
    expect(g.state().view.buzz.teamId).toBeUndefined();
    g.buzz(1);
    expect(g.state().view.buzz).toMatchObject({ teamId: IDS[1], out: [] });
  });

  it("the buzzing phone drops: the music it stopped plays on; a pause the host chose stays through a wrong buzz", () => {
    const g = buzzerGame();
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    g.room.onClose(g.phones[1]);
    expect(g.state()).toMatchObject({ media: { state: "playing" }, view: { buzz: { out: [] } } });
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "pause" });
    g.buzz(2);
    g.judge(IDS[2], false);
    expect(g.state()).toMatchObject({ media: { state: "paused" }, view: { buzz: { out: [IDS[2]] } } });
  });

  it("a ▶ pressed while the phase card is up does not open buzzing (the card shows no video)", () => {
    const g = buzzerGame();
    g.room.game = { ...g.room.game!, buzz: { questionId: "b-a", out: [] } };
    (g.room as unknown as { phaseCard: boolean }).phaseCard = true;
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    expect(g.room.game!.buzz?.open).toBeUndefined();
  });

  it("a pause the host presses after a buzz stays through the wrong answer", () => {
    const g = buzzerGame();
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "pause" });
    g.judge(IDS[1], false);
    expect(g.state()).toMatchObject({ media: { state: "paused" }, view: { buzz: { out: [IDS[1]] } } });
  });

  it("no answer countdown runs in a buzzer phase, before or after a buzz (answer-countdown.md vs boss-buzzer.md)", () => {
    const g = buzzerGame(text);
    (g.room as unknown as { answerSeconds: number }).answerSeconds = 60;
    send(g.room, g.host, { type: "HOST_BUZZ_SKIP", questionId: "b-a" });
    expect(g.state().answerClock).toBeUndefined();
    g.buzz(0);
    expect(g.state().answerClock).toBeUndefined();
  });

  it("a buzzing team cannot roll a persuasion check, and the host cannot skip a question a team is answering", () => {
    const g = buzzerGame(text);
    g.buzz(0);
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "b-a", eventId: g.state().eventId });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "buzzer_phase" });
    expect((g.room as unknown as { pendingRoll: unknown }).pendingRoll).toBeNull();
    send(g.room, g.host, { type: "HOST_BUZZ_SKIP", questionId: "b-a" });
    expect(g.lastError(g.host)).toMatchObject({ detail: "buzz_taken" });
    expect(g.state().question.id).toBe("b-a");
  });

  // Value: protects=a buzz sent while a reveal is up is refused, so it cannot take the next question early; fails_when=the paused() guard in handleTeamBuzz is dropped; why_new=review gap, no test sends TEAM_BUZZ mid-reveal; seam=none; no_claim=roll/lock pending refusals (same guard line, not driven)
  it("a buzz sent while the answer is still on show is refused and holds nothing", () => {
    const g = buzzerGame(text);
    g.buzz(0);
    g.judge(IDS[0], true); // the reveal is up; the next question's id is already current
    g.buzz(1);
    expect(g.lastError(g.phones[1])).toMatchObject({ detail: "reveal_pending" });
    expect(g.room.game!.buzz?.teamId).toBeUndefined();
  });

  // Value: protects=a laptop 逃跑 on a wrong buzz only shuts the team out; fails_when=the buzzer-phase fleeChoice override is removed; why_new=the room tests judge with retry only; seam=none; no_claim=the host key binding (not driven)
  it("a wrong buzz judged with 逃跑 still only shuts the team out", () => {
    const g = buzzerGame(text);
    g.buzz(1);
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: IDS[1], questionId: "b-a", correct: false, fleeChoice: "flee", eventId: g.state().eventId });
    expect(g.room.game!.buzz).toEqual({ questionId: "b-a", out: [IDS[1]] });
    expect(g.room.game!.boss.currentQuestionId).toBe("b-a");
  });

  // Value: protects=two right buzzes through the room empty the last phase and kill the boss; fails_when=a buzz-phase hit stops reaching the kill path in the room; why_new=the kill is tested only in game-state; seam=none; no_claim=the epilogue after the kill
  it("the last right buzz of the final phase kills the boss", () => {
    const g = buzzerGame(text);
    g.buzz(0);
    g.judge(IDS[0], true);
    g.next();
    g.buzz(2);
    vi.useFakeTimers();
    try {
      g.judge(IDS[2], true);
      expect(g.room.game!.phase).toBe("playing"); // the kill's 4d20 beat comes first
      vi.advanceTimersByTime(10000);
    } finally {
      vi.useRealTimers();
    }
    expect(g.room.game!.phase).toBe("finished");
    expect(g.state()).toMatchObject({ cue: "boss-kill" });
  });

  it("a buzzing phone that drops during the kill dice still takes the kill (onClose keeps a kill beat's team)", () => {
    const g = buzzerGame(text);
    g.buzz(0);
    g.judge(IDS[0], true);
    g.next();
    g.buzz(2);
    vi.useFakeTimers();
    try {
      g.judge(IDS[2], true);
      g.room.onClose(g.phones[2]);
      g.buzz(1);
      vi.advanceTimersByTime(10000);
    } finally {
      vi.useRealTimers();
    }
    expect(g.room.game!.phase).toBe("finished");
    expect(g.state()).toMatchObject({ view: { bossKilledBy: IDS[2] } });
  });

  it("everyone missing the song reopens the same one to all; the music waits for the host's ▶ (boss-music-buzzer.md M1)", () => {
    const g = buzzerGame();
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    for (const i of [0, 1, 2]) {
      g.buzz(i);
      g.judge(IDS[i], false);
    }
    expect(g.state()).toMatchObject({ question: { id: "b-a" }, media: { state: "paused" }, view: { buzz: { questionId: "b-a", open: true, out: [] } } });
    g.buzz(1);
    expect(g.state().view.buzz.teamId).toBe(IDS[1]);
  });

  it("the team that buzzed may type its answer for the host; nobody else may (boss-music-buzzer.md M2)", () => {
    const g = buzzerGame(text);
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "b-a", text: "早到", eventId: g.state().eventId });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "no_buzz" });
    g.buzz(1);
    send(g.room, g.phones[1], { type: "TEAM_SUBMIT_TEXT", questionId: "b-a", text: " 麻辣鮮師 ", eventId: g.state().eventId });
    expect(g.state().view.teams[1].typedAnswer).toBe("麻辣鮮師");
  });

  it("a video the big screen cannot play: the host is told, and 現場放歌 opens buzzing without it (boss-music-buzzer.md M4)", () => {
    const g = buzzerGame();
    const screen = makeConn("screen");
    g.room.onConnect(screen);
    send(g.room, screen, { type: "SCREEN_HELLO" });
    send(g.room, g.phones[0], { type: "SCREEN_CLIP_ERROR", questionId: "b-a" });
    expect(g.state().clipError).toBeUndefined();
    send(g.room, screen, { type: "SCREEN_CLIP_ERROR", questionId: "b-a" });
    expect(g.state().clipError).toBe(true);
    send(g.room, g.phones[0], { type: "HOST_BUZZ_OPEN", questionId: "b-a" });
    expect(g.state().view.buzz.open).toBeUndefined();
    send(g.room, g.host, { type: "HOST_BUZZ_OPEN", questionId: "b-a" });
    expect(g.state()).toMatchObject({ clipError: true, view: { buzz: { open: true } } });
    expect(g.state().media).toBeUndefined();
    send(g.room, g.host, { type: "HOST_BUZZ_OPEN", questionId: "b-c" });
    expect(g.lastError(g.host)).toMatchObject({ detail: "stale_question" });
    // A ▶ makes the screen try again, so the warning goes until it fails again.
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    expect(g.state().clipError).toBeUndefined();
  });

  it("the buzz winner picks the next song's category until the host's ▶ (boss-music-buzzer.md M5)", () => {
    const cat = (id: string) => ({ ...video(id), category: id === "b-c" ? "遊戲" : "動漫" });
    const g = buzzerGame(cat);
    expect(g.state().buzzCategories).toBeUndefined();
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    g.judge(IDS[1], true);
    expect(g.state()).toMatchObject({ buzzCategories: ["動漫", "遊戲"], view: { buzz: { questionId: "b-b", picker: IDS[1] } } });
    send(g.room, g.phones[0], { type: "TEAM_PICK_CATEGORY", category: "遊戲" });
    expect(g.lastError(g.phones[0])).toMatchObject({ detail: "not_picker" });
    send(g.room, g.phones[1], { type: "TEAM_PICK_CATEGORY", category: "遊戲" });
    expect(g.state()).toMatchObject({ question: { id: "b-c" }, view: { buzz: { category: "遊戲" } } });
    // 現場放歌 cannot open the next song while the answer is still on show.
    send(g.room, g.host, { type: "HOST_BUZZ_OPEN", questionId: "b-c" });
    expect(g.lastError(g.host)).toMatchObject({ detail: "stale_question" });
    expect(g.room.game!.buzz?.open).toBeUndefined();
    g.next();
    send(g.room, g.phones[1], { type: "TEAM_PICK_CATEGORY", category: "動漫" });
    expect(g.state().question.id).toBe("b-b");
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-b", action: "play" });
    expect(g.state().buzzCategories).toBeUndefined();
    send(g.room, g.phones[1], { type: "TEAM_PICK_CATEGORY", category: "遊戲" });
    expect(g.lastError(g.phones[1])).toMatchObject({ detail: "too_late" });
  });

  // multi-field.md: a music question with fields, judged one by one.
  const fielded = (id: string) => ({ ...video(id), answer: undefined, fields: [{ label: "歌名", answer: `歌 ${id}` }, { label: "歌手", answer: `人 ${id}` }] });

  it("a music question with fields: one box each, blanks allowed, at least one filled (multi-field.md F4)", () => {
    const g = buzzerGame(fielded);
    expect(g.state().question.fields).toEqual(["歌名", "歌手"]);
    expect(JSON.stringify(g.state().question)).not.toContain("歌 b-a");
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    const submit = (fields?: string[]) => send(g.room, g.phones[1], { type: "TEAM_SUBMIT_TEXT", questionId: "b-a", text: "x", eventId: g.state().eventId, ...(fields ? { fields } : {}) });
    submit();
    expect(g.lastError(g.phones[1])).toMatchObject({ detail: "fields_mismatch" });
    submit([" ", ""]);
    expect(g.lastError(g.phones[1])).toMatchObject({ detail: "invalid_text" });
    submit([" 晴天 ", ""]);
    expect(g.state().view.teams[1]).toMatchObject({ typedAnswer: "晴天／—", typedFields: ["晴天", ""] });
  });

  it("half the fields right is a hit scaled by half; the reveal marks each field (multi-field.md F6, F7)", () => {
    const g = buzzerGame(fielded);
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    const judge = (fields: boolean[]) => send(g.room, g.host, { type: "HOST_JUDGE", teamId: IDS[1], questionId: "b-a", correct: fields.some(Boolean), fields, eventId: g.state().eventId });
    judge([true, false, true]);
    expect(g.lastError(g.host)).toMatchObject({ detail: "fields_mismatch" });
    // No 最後衝刺 blessing on top, so the sum is the plain hit reward.
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t) => ({ ...t, boon: undefined })) };
    const before = g.room.game!.teams[1].reward;
    judge([true, false]);
    const s = g.state();
    // 1 HP × ½ rounds up to 1; the 10-point hit reward × ½ is 5.
    expect(s.view.bossHp).toBe(1);
    expect(g.room.game!.teams[1].reward - before).toBe(5);
    expect(s.reveal).toMatchObject({ answer: "歌 b-a／人 b-a", fields: [{ label: "歌名", answer: "歌 b-a", right: true }, { label: "歌手", answer: "人 b-a", right: false }] });
    // A partial answer still earns the category pick (F6).
    expect(s.view.buzz).toMatchObject({ picker: IDS[1] });
  });

  it("every field wrong is a wrong buzz: the team is shut out (multi-field.md F6)", () => {
    const g = buzzerGame(fielded);
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: IDS[1], questionId: "b-a", correct: false, fleeChoice: "retry", fields: [false, false], eventId: g.state().eventId });
    expect(g.state()).toMatchObject({ reveal: null, view: { buzz: { out: [IDS[1]] } } });
  });

  it("a plain 答對 on a question with fields is every field right", () => {
    const g = buzzerGame(fielded);
    send(g.room, g.host, { type: "HOST_MEDIA", questionId: "b-a", action: "play" });
    g.buzz(1);
    g.judge(IDS[1], true);
    expect(g.state().reveal.fields.map((f: { right: boolean }) => f.right)).toEqual([true, true]);
  });

  it("the buzz is saved: a restarted room keeps who is shut out", async () => {
    const storage = memoryStorage();
    const g = buzzerGame(text, storage);
    g.buzz(1);
    g.judge(IDS[1], false);
    const io = { broadcast: vi.fn(), storage } as unknown as RoomIO;
    const second = new DungeonRoom(io, () => 0, { bank: bank(text), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    expect(second.game!.buzz).toEqual({ questionId: "b-a", out: [IDS[1]] });
  });
});
