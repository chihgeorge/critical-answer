// ⚙ 更多 › 修正's 設定 (an exact reward) and 改判 (a past judgment's reward points flipped) (docs/hosting.md).
// Host only, the same holds as 修正, no line on the big screen, every press kept in the game log and the transcript.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { gameLog } from "../game-log";
import { parseClientMessage } from "../protocol";
import { chefShare, type GameState } from "../game-state";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const [A, B] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = () =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [text("r1"), text("r2"), text("r3"), text("r4"), text("r5")] }],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1"), text("b2")] },
  });

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage;
}

/** Two teams (甲 a thief, 乙 a chef by default) and a host. */
function started(classes: (string | null)[] = ["thief", "chef"], storage = memoryStorage()) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const conn = makeConn(`p${i}`);
    room.onConnect(conn);
    send(room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊"][i] });
    if (classes[i]) send(room, conn, { type: "TEAM_PICK_CLASS", classId: classes[i] });
    return conn;
  });
  send(room, host, { type: "HOST_START", aiNarration: false });
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  const team = (id: string) => room.game!.teams.find((t) => t.id === id)!;
  const lastTo = (conn: Conn & { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).at(-1);
  const setScore = (teamId: string, score: unknown, conn: Conn = host) => send(room, conn, { type: "HOST_SET_SCORE", teamId, score });
  const ledger = () => room.game!.judgments ?? [];
  const rejudge = (index: number, correct: boolean, conn: Conn = host) => {
    const j = ledger()[index];
    send(room, conn, { type: "HOST_REJUDGE", index, teamId: j?.teamId ?? A, questionId: j?.questionId ?? "r1", correct });
  };
  /** The team on turn answers its question; the host judges it (and closes a correct one's reveal). */
  const judge = (correct: boolean, fleeChoice = "retry") => {
    const g = room.game!;
    const teamId = g.turnOrder[g.currentTurnIndex];
    const questionId = team(teamId).currentQuestionId;
    send(room, phones[IDS.indexOf(teamId)], { type: "TEAM_SUBMIT_TEXT", questionId, text: "猜", eventId: state().eventId });
    send(room, host, { type: "HOST_JUDGE", teamId, questionId, correct, fleeChoice, eventId: state().eventId });
    vi.advanceTimersByTime(10_000);
    if (correct) send(room, host, { type: "HOST_SERVE", eventId: state().eventId });
    vi.advanceTimersByTime(30_000);
    if (correct) send(room, host, { type: "HOST_NEXT", eventId: state().eventId });
    vi.advanceTimersByTime(10_000);
    return { teamId, questionId };
  };
  const setReward = (teamId: string, reward: number) => {
    room.game = { ...room.game!, teams: room.game!.teams.map((t) => (t.id === teamId ? { ...t, reward } : t)) };
  };
  const transcript = () => {
    send(room, host, { type: "HOST_GET_TRANSCRIPT" });
    return (lastTo(host).entries as { kind?: string; text?: string }[]).filter((e) => e.kind === "fix").map((e) => e.text);
  };
  const picks = (conn: Conn & { send: ReturnType<typeof vi.fn> } = host) => msgs(conn.send.mock.calls).findLast((m) => m.type === "HOST_PICKS");
  return { room, io, host, phones, state, team, lastTo, setScore, rejudge, judge, ledger, setReward, transcript, picks, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parsing", () => {
  it("HOST_SET_SCORE takes an integer 0..9999 only", () => {
    expect(parseClientMessage({ type: "HOST_SET_SCORE", teamId: A, score: 0 })).toEqual({ type: "HOST_SET_SCORE", teamId: A, score: 0 });
    expect(parseClientMessage({ type: "HOST_SET_SCORE", teamId: A, score: 9999 })).toMatchObject({ score: 9999 });
    for (const score of [-1, 10000, 2.5, "20", null, Number.NaN]) expect(parseClientMessage({ type: "HOST_SET_SCORE", teamId: A, score })).toBeNull();
    expect(parseClientMessage({ type: "HOST_SET_SCORE", score: 3 })).toBeNull();
  });

  it("HOST_REJUDGE needs an index ≥ 0, both ids and a boolean verdict; HOST_FIX still has no set", () => {
    const ok = { type: "HOST_REJUDGE", index: 0, teamId: A, questionId: "r1", correct: false };
    expect(parseClientMessage(ok)).toEqual(ok);
    for (const bad of [{ index: -1 }, { index: 1.5 }, { index: "0" }, { correct: "false" }, { correct: undefined }, { teamId: undefined }, { questionId: 7 }]) {
      expect(parseClientMessage({ ...ok, ...bad })).toBeNull();
    }
    expect(parseClientMessage({ type: "HOST_FIX", teamId: A, fix: "set" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_FIX", teamId: A, fix: "rejudge" })).toBeNull();
  });
});

describe("設定", () => {
  it("a phone or a big screen gets not_host for both messages and changes nothing", () => {
    const g = started();
    g.judge(true);
    const screen = makeConn("screen");
    g.room.onConnect(screen);
    send(g.room, screen, { type: "SCREEN_HELLO" });
    for (const conn of [g.phones[0], screen]) {
      g.setScore(A, 50, conn);
      expect(g.lastTo(conn)).toMatchObject({ type: "ERROR", error: "not_host" });
      g.rejudge(0, false, conn);
      expect(g.lastTo(conn)).toMatchObject({ type: "ERROR", error: "not_host" });
    }
    expect(g.team(A).reward).toBe(10);
    expect(g.ledger()[0].correct).toBe(true);
  });

  it("sets the reward exactly, leaves progress alone, refuses the same value, and logs it", () => {
    const g = started();
    const before = g.state().eventId;
    g.setScore(A, 20);
    expect(g.state().view.teams.find((t: { id: string }) => t.id === A)).toMatchObject({ reward: 20, score: 0 });
    g.setScore(A, 20);
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action", detail: "at_limit" });
    g.setScore(A, 0);
    expect(g.team(A).fixes).toEqual([
      { fix: "set", from: 0, to: 20 },
      { fix: "set", from: 20, to: 0 },
    ]);
    expect(g.state().eventId).toBe(before);
    expect(gameLog(g.room.game!, 0).teams.find((t) => t.name === "甲隊")!.fixes).toHaveLength(2);
    expect(g.transcript()).toEqual(["甲隊 set 0→20", "甲隊 set 20→0"]);
  });

  it("stacks with ±5", () => {
    const g = started();
    g.setScore(A, 7);
    send(g.room, g.host, { type: "HOST_FIX", teamId: A, fix: "score-" });
    expect(g.team(A).reward).toBe(2);
    send(g.room, g.host, { type: "HOST_FIX", teamId: A, fix: "score+" });
    g.setScore(A, 100);
    expect(g.team(A).reward).toBe(100);
  });
});

describe("the 改判 ledger", () => {
  it("records each judgment with N fixed at judge time; the host alone learns it", () => {
    const g = started();
    g.judge(true); // 甲 (thief) right: +10
    g.judge(false); // 乙 (chef) wrong
    expect(g.ledger()).toEqual([
      { teamId: A, questionId: expect.any(String), correct: true, points: 10 },
      { teamId: B, questionId: expect.any(String), correct: false, points: 10 + chefShare(10) },
    ]);
    expect(g.team(A).reward).toBe(10);
    expect(g.picks().judged).toEqual(g.ledger().map((j, index) => ({ ...j, index })));
    for (const p of g.phones) expect(msgs(p.send.mock.calls).some((m) => m.type === "HOST_PICKS")).toBe(false);
    expect(JSON.stringify(g.state())).not.toContain("judgments");
    expect(JSON.stringify(msgs(g.io.broadcast.mock.calls))).not.toContain("judged");
  });

  it("a cleric's wait adds no entry itself; its 重答 adds one 答錯", () => {
    const g = started(["cleric", "chef"]);
    const q = g.team(A).currentQuestionId;
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "猜", eventId: g.state().eventId });
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: q, correct: false, fleeChoice: "team", eventId: g.state().eventId });
    expect(g.room.game!.pendingWrong).toMatchObject({ teamId: A });
    expect(g.ledger()).toEqual([]);
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: q, correct: false, fleeChoice: "retry", eventId: g.state().eventId });
    expect(g.ledger()).toEqual([{ teamId: A, questionId: q, correct: false, points: 10 }]);
  });

  it("the host's 祈禱 for a cleric adds one 答錯 entry, like its 重答", () => {
    const g = started(["cleric", "chef"]);
    const q = g.team(A).currentQuestionId;
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "猜", eventId: g.state().eventId });
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: q, correct: false, fleeChoice: "team", eventId: g.state().eventId });
    const uses = g.team(A).abilityUses;
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: q, correct: false, fleeChoice: "pray", eventId: g.state().eventId });
    expect(g.team(A).abilityUses).toBe(uses - 1); // the prayer was spent
    expect(g.ledger()).toEqual([{ teamId: A, questionId: q, correct: false, points: 10 }]);
  });

  it("an upheld 🚨 catch adds no entry", () => {
    const g = started([null, null]);
    send(g.room, g.host, { type: "HOST_ANTI_CHEAT", on: true });
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: g.team(A).currentQuestionId, eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    send(g.room, g.phones[1], { type: "TEAM_CATCH", questionId: g.team(A).currentQuestionId });
    send(g.room, g.host, { type: "HOST_RULE_CATCH", upheld: true });
    expect(g.state().reveal).toMatchObject({ caught: { teamId: A, by: B } });
    expect(g.ledger()).toEqual([]);
  });

  it("a killing blow adds one entry, its 4d20 in N; a wrong boss answer's N is the boss's hitReward", () => {
    const g = started([null, null]);
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    const judgeNow = (g.room as unknown as { judgeNow: (...a: unknown[]) => void }).judgeNow.bind(g.room);
    const bossQ = () => g.room.game!.boss.currentQuestionId;
    judgeNow(A, bossQ(), false, "retry");
    expect(g.ledger().at(-1)).toEqual({ teamId: A, questionId: expect.any(String), correct: false, points: g.room.game!.boss.hitReward });
    g.room.game = { ...g.room.game!, boss: { ...g.room.game!.boss, hp: 1 }, currentTurnIndex: g.room.game!.turnOrder.indexOf(A) };
    const before = g.team(A).reward;
    judgeNow(A, bossQ(), true, "retry", undefined, [5, 5, 5, 5]);
    expect(g.ledger()).toHaveLength(2);
    expect(g.ledger()[1]).toMatchObject({ correct: true, points: g.team(A).reward - before });
    expect(g.ledger()[1].points).toBeGreaterThanOrEqual(20);
  });
});

describe("改判", () => {
  it("correct→wrong takes N, wrong→correct gives it back, each press logged; a double press is at_limit", () => {
    const g = started();
    g.judge(true);
    g.rejudge(0, false);
    expect(g.team(A).reward).toBe(0);
    expect(g.ledger()[0]).toMatchObject({ correct: false, flipped: true, taken: 10 });
    g.rejudge(0, false);
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action", detail: "at_limit" });
    g.rejudge(0, true);
    expect(g.team(A).reward).toBe(10);
    expect(g.ledger()[0]).toEqual({ teamId: A, questionId: expect.any(String), correct: true, points: 10 });
    expect(g.team(A).fixes).toEqual([
      { fix: "rejudge", from: 10, to: 0, judgment: 1 },
      { fix: "rejudge", from: 0, to: 10, judgment: 1 },
    ]);
    expect(g.transcript()).toEqual(["甲隊 rejudge #1 答對→答錯 10→0", "甲隊 rejudge #1 答錯→答對 0→10"]);
    expect(g.team(A).score).toBeGreaterThan(0); // progress untouched
  });

  it("a wrong judgment flipped to correct gives N; the 0 floor never mints points over any cycle", () => {
    const g = started();
    g.judge(false); // 甲 wrong: N = 10
    g.rejudge(0, true);
    expect(g.team(A).reward).toBe(10);
    g.setReward(A, 0);
    g.rejudge(0, false); // takes min(10, 0) = 0
    expect(g.team(A).reward).toBe(0);
    g.rejudge(0, true); // gives back 0, and the next 改成答錯 starts from N again
    expect(g.team(A).reward).toBe(0);
    g.setReward(A, 7);
    g.rejudge(0, false); // takes min(10, 7) = 7
    expect(g.team(A).reward).toBe(0);
    g.rejudge(0, true);
    expect(g.team(A).reward).toBe(7);
    g.setReward(A, 3);
    g.judge(true); // 乙's turn: 乙 right
    const b = g.ledger().length - 1;
    g.setReward(B, 4);
    g.rejudge(b, false);
    expect(g.team(B).reward).toBe(0);
    g.rejudge(b, true);
    expect(g.team(B).reward).toBe(4);
  });

  it("refuses a press from an older list (another team or question at that index) and an index out of range", () => {
    const g = started();
    g.judge(true);
    const j = g.ledger()[0];
    send(g.room, g.host, { type: "HOST_REJUDGE", index: 0, teamId: B, questionId: j.questionId, correct: false });
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action", detail: "stale" });
    send(g.room, g.host, { type: "HOST_REJUDGE", index: 0, teamId: A, questionId: "r9", correct: false });
    expect(g.lastTo(g.host)).toMatchObject({ detail: "stale" });
    send(g.room, g.host, { type: "HOST_REJUDGE", index: 5, teamId: A, questionId: j.questionId, correct: false });
    expect(g.lastTo(g.host)).toMatchObject({ detail: "stale" });
    expect(g.team(A).reward).toBe(10);
  });

  it("waits while the team's lock, roll or wrong answer is pending, any door beat runs, or a fortune is open; refused with no game or after it", () => {
    const g = started();
    g.judge(true);
    const room = g.room as unknown as { pendingRoll: unknown; pendingLock: unknown; forkBeat: unknown; fortuneActive: () => boolean };
    for (const [slot, value] of [["pendingRoll", { teamId: A }], ["pendingLock", { teamId: A }], ["forkBeat", { teamId: B }]] as const) {
      room[slot] = value;
      g.setScore(A, 50);
      expect(g.lastTo(g.host)).toMatchObject({ detail: "lock_pending" });
      g.rejudge(0, false);
      expect(g.lastTo(g.host)).toMatchObject({ detail: "lock_pending" });
      room[slot] = null;
    }
    room.fortuneActive = () => true;
    g.setScore(A, 50);
    expect(g.lastTo(g.host)).toMatchObject({ detail: "paused" });
    g.rejudge(0, false);
    expect(g.lastTo(g.host)).toMatchObject({ detail: "paused" });
    room.fortuneActive = () => false;
    send(g.room, g.host, { type: "HOST_END_GAME" });
    g.setScore(A, 50);
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action" });
    // Value: protects=改判 after the game ends moves no reward; fails_when=hostRejudge's not_playing guard is dropped.
    g.rejudge(0, false);
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action" });
    expect(g.team(A).reward).toBe(10);

    const io = { broadcast: vi.fn(), storage: memoryStorage() } as unknown as RoomIO;
    const empty = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
    const host = makeConn("host");
    empty.onConnect(host);
    send(empty, host, { type: "HOST_CLAIM", token: TOKEN });
    send(empty, host, { type: "HOST_SET_SCORE", teamId: A, score: 5 });
    expect(msgs(host.send.mock.calls).at(-1)).toMatchObject({ error: "no_active_game" });
  });

  it("a set or a rejudge closes 改判答對", () => {
    for (const press of ["set", "rejudge"] as const) {
      const g = started();
      g.judge(true);
      const { teamId, questionId } = g.judge(false); // 乙 wrong: undoable
      expect(g.state().undoWrong).toMatchObject({ teamId });
      if (press === "set") g.setScore(A, 3);
      else g.rejudge(0, false);
      expect(g.state().undoWrong).toBeUndefined();
      send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId, questionId, eventId: g.state().eventId });
      expect(g.ledger()[1].correct).toBe(false);
    }
  });

  it("改判答對 while still open swaps the 答錯 entry for one 答對 entry: never both", () => {
    const g = started();
    g.judge(true);
    const { teamId, questionId } = g.judge(false); // 乙 wrong: undoable
    const before = g.team(B).reward;
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId, questionId, eventId: g.state().eventId });
    const mine = g.ledger().filter((j) => j.teamId === teamId && j.questionId === questionId);
    expect(mine).toEqual([{ teamId, questionId, correct: true, points: g.team(B).reward - before }]);
    expect(g.ledger()).toHaveLength(2);
  });

  it("the ledger and its flips survive a restart; a malformed saved list reads as empty", async () => {
    const g = started();
    g.judge(true);
    g.rejudge(0, false);
    const restart = async (storage: RoomStorage) => {
      const second = new DungeonRoom({ broadcast: vi.fn(), storage } as unknown as RoomIO, () => 0, { bank: bank(), epilogueDelayMs: 0 });
      expect(await second.restore()).toBe("restored");
      return second.game!;
    };
    expect((await restart(g.storage)).judgments).toEqual(g.ledger());
    const bad = started();
    bad.judge(true);
    bad.room.game = { ...bad.room.game!, judgments: [{ teamId: A } as unknown as NonNullable<GameState["judgments"]>[number]] };
    bad.setScore(A, 1); // saves
    expect((await restart(bad.storage)).judgments).toEqual([]);
    const badTaken = started();
    badTaken.judge(true);
    badTaken.room.game = { ...badTaken.room.game!, judgments: [{ ...badTaken.ledger()[0], taken: "3" } as unknown as NonNullable<GameState["judgments"]>[number]] };
    badTaken.setScore(A, 1);
    expect((await restart(badTaken.storage)).judgments).toEqual([]);
  });
});
