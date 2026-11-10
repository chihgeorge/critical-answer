// 抓包與神諭 in the room (docs/designs/anti-ai-cheating.md): the switch, the answering window, catch_pending, the
// rulings, the countdown, 改判答對, the trust boundary and a restart with a catch open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { CATCH_PAY } from "../game-state";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"];
const [A, B, C] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const mc = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "text", value: `題目 ${id}` }, options: ["甲", "乙", "丙"], correctIndex: 0 });
const bank = (qs: object[]) =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: qs }],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] },
  });
const MCS = ["m1", "m2", "m3", "m4", "m5", "m6"].map(mc);
const TEXTS = ["t1", "t2", "t3", "t4", "t5", "t6"].map(text);

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage;
}

/** Three teams (甲 on turn) and a host, the switch on unless `off`. */
function started({ qs = MCS, off = false, start = {}, storage = memoryStorage(), rng = () => 0 }: { qs?: object[]; off?: boolean; start?: object; storage?: RoomStorage; rng?: () => number } = {}) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, rng, { bank: bank(qs), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const conn = makeConn(`p${i}`);
    room.onConnect(conn);
    send(room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊", "丙隊"][i] });
    return conn;
  });
  send(room, host, { type: "HOST_START", aiNarration: false, ...start });
  if (!off) send(room, host, { type: "HOST_ANTI_CHEAT", on: true });
  const all = () => msgs(io.broadcast.mock.calls);
  const state = () => all().findLast((m) => m.type === "STATE");
  const lastTo = (conn: Conn & { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).at(-1);
  const qid = () => state().question.id;
  const catchBy = (i: number, questionId = qid()) => send(room, phones[i], { type: "TEAM_CATCH", questionId });
  const rule = (upheld: boolean) => send(room, host, { type: "HOST_RULE_CATCH", upheld });
  /** Team `i` (on turn) locks a wrong option, the host reveals it, and it retries: the next team is on turn. */
  const miss = (i: number) => {
    const q = qid();
    send(room, phones[i], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q].indexOf(1) });
    send(room, phones[i], { type: "TEAM_LOCK_OPTION", questionId: q });
    send(room, host, { type: "HOST_REVEAL", teamId: IDS[i], questionId: q });
    vi.advanceTimersByTime(2000);
    send(room, phones[i], { type: "TEAM_WRONG_CHOICE", questionId: q, choice: "retry" });
  };
  return { room, io, host, phones, all, state, lastTo, qid, catchBy, rule, miss };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the switch", () => {
  it("is host only, says its rules once, and shows in STATE", () => {
    const g = started({ off: true });
    expect(g.state().view.antiCheat).toBeUndefined();
    send(g.room, g.phones[0], { type: "HOST_ANTI_CHEAT", on: true });
    expect(g.lastTo(g.phones[0])).toMatchObject({ error: "not_host" });
    send(g.room, g.host, { type: "HOST_ANTI_CHEAT", on: true });
    expect(g.state().view.antiCheat).toMatchObject({ on: true, onCount: 1 });
    expect(g.state().view.teams[1]).toMatchObject({ oracleLeft: 1, catchesLeft: 2 });
  });

  it("off with a catch open calls it off and refunds the reporter", () => {
    const g = started();
    g.catchBy(1);
    send(g.room, g.host, { type: "HOST_ANTI_CHEAT", on: false });
    expect(g.state().view.antiCheat.openCatch).toBeUndefined();
    expect(g.state().view.teams[1].catchesLeft).toBe(2);
  });
});

describe("the answering window", () => {
  it("refuses a catch and the oracle while the previous answer's reveal is up", () => {
    const g = started({ qs: TEXTS });
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: "t1", correct: true, eventId: g.state().eventId });
    expect(g.state().reveal).toBeTruthy();
    g.catchBy(2, g.room.game!.teams[1].currentQuestionId);
    expect(g.lastTo(g.phones[2])).toMatchObject({ detail: "not_now" });
    send(g.room, g.phones[1], { type: "TEAM_ORACLE", questionId: g.room.game!.teams[1].currentQuestionId });
    expect(g.lastTo(g.phones[1])).toMatchObject({ detail: "not_now" });
  });

  it("refuses both before a fill-in's persuasion check; lets a catch in while a typed answer waits, not the oracle", () => {
    const g = started({ qs: TEXTS });
    g.catchBy(1, "t1");
    expect(g.lastTo(g.phones[1])).toMatchObject({ detail: "not_now" });
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "t1", text: "答", eventId: g.state().eventId });
    send(g.room, g.phones[0], { type: "TEAM_ORACLE", questionId: "t1" });
    expect(g.lastTo(g.phones[0])).toMatchObject({ detail: "not_now" });
    g.catchBy(1, "t1");
    expect(g.state().view.antiCheat.openCatch).toMatchObject({ by: B, teamId: A });
  });

  // Value: protects=a locked multipleChoice answer can't be caught or oracled (spec: 已鎖定 不能按); fails_when=antiCheatWindow drops its
  // pendingLock check (askOracle has no lock check of its own); why_new=window tests cover reveal, check and typed only; seam=none;
  // no_claim=the phone hiding its buttons (room messages only)
  it("refuses a catch and the oracle once a multipleChoice answer is locked", () => {
    const g = started();
    const q = g.qid();
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: 0 });
    send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: q });
    g.catchBy(1, q);
    expect(g.lastTo(g.phones[1])).toMatchObject({ detail: "not_now" });
    send(g.room, g.phones[0], { type: "TEAM_ORACLE", questionId: q });
    expect(g.lastTo(g.phones[0])).toMatchObject({ detail: "not_now" });
    expect(g.state().view.teams[0].oracleLeft).toBe(1);
    expect(g.state().view.antiCheat.openCatch).toBeUndefined();
  });

  it("the oracle tags the question for every screen and the owl says so", () => {
    const g = started();
    send(g.room, g.phones[0], { type: "TEAM_ORACLE", questionId: g.qid() });
    expect(g.state().view.teams[0]).toMatchObject({ oracle: true, oracleLeft: 0 });
    g.catchBy(1);
    expect(g.lastTo(g.phones[1])).toMatchObject({ detail: "oracle_question" });
  });
});

describe("the trust boundary", () => {
  it("takes the reporter from the connection, the accused from the turn; refuses self, stale, non-team and waiting teams", () => {
    const g = started();
    g.catchBy(0);
    expect(g.lastTo(g.phones[0])).toMatchObject({ detail: "self_catch" });
    g.catchBy(1, "m9");
    expect(g.lastTo(g.phones[1])).toMatchObject({ detail: "stale_question" });
    send(g.room, g.host, { type: "TEAM_CATCH", questionId: g.qid() });
    expect(g.lastTo(g.host)).toMatchObject({ error: "unknown_team" });
    const late = makeConn("late");
    g.room.onConnect(late);
    send(g.room, late, { type: "JOIN", teamId: "00000000-0000-0000-0000-000000000009", teamKey: "team-key-0123456789abcdef9", teamName: "晚到" });
    send(g.room, late, { type: "TEAM_CATCH", questionId: g.qid() });
    expect(g.lastTo(late)).toMatchObject({ error: "unknown_team" });
    send(g.room, g.phones[1], { type: "HOST_RULE_CATCH", upheld: true });
    expect(g.lastTo(g.phones[1])).toMatchObject({ error: "not_host" });
    expect(g.state().view.antiCheat.openCatch).toBeUndefined();
  });
});

describe("an open catch", () => {
  it("rejects every move on the accused turn with catch_pending; the switch and the ruling still work", () => {
    const g = started({ qs: TEXTS });
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    g.catchBy(1, "t1");
    const eventId = g.state().eventId;
    const tries: [Conn & { send: ReturnType<typeof vi.fn> }, object][] = [
      [g.host, { type: "HOST_JUDGE", teamId: A, questionId: "t1", correct: true, eventId }],
      [g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "t1", text: "答", eventId }],
      [g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "t1" }],
      [g.phones[0], { type: "TEAM_USE_ABILITY", questionId: "t1" }],
      [g.phones[0], { type: "TEAM_DRINK_POTION", questionId: "t1", eventId }],
      [g.phones[0], { type: "TEAM_ORACLE", questionId: "t1" }],
      [g.phones[2], { type: "TEAM_CATCH", questionId: "t1" }],
      [g.host, { type: "HOST_NEXT", eventId }],
      [g.host, { type: "HOST_STEP", eventId, step: 1 }],
    ];
    for (const [conn, msg] of tries) {
      send(g.room, conn, msg);
      expect(g.lastTo(conn), JSON.stringify(msg)).toMatchObject({ error: "invalid_action", detail: "catch_pending" });
    }
    g.rule(false);
    expect(g.state().view.antiCheat.openCatch).toBeUndefined();
  });

  it("stops the countdown; 冤枉 starts it again from full", () => {
    const g = started({ start: { answerSeconds: 30 } });
    vi.advanceTimersByTime(10_000);
    g.catchBy(1);
    expect(g.state().answerClock).toBeUndefined();
    vi.advanceTimersByTime(5_000);
    g.rule(false);
    expect(g.state().answerClock.left).toBe(30_000);
  });

  it("survives a restart: the ruling card's catch is back and the accused keeps the turn offline", async () => {
    const storage = memoryStorage();
    const g = started({ storage });
    g.catchBy(1);
    const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
    const second = new DungeonRoom(io, () => 0, { bank: bank(MCS), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    const screen = makeConn("screen");
    second.onConnect(screen);
    const s = msgs(screen.send.mock.calls).findLast((m) => m.type === "STATE");
    expect(s.view.antiCheat.openCatch).toMatchObject({ by: B, teamId: A });
    expect(s.view.currentTurnTeamId).toBe(A);
  });
});

describe("the rulings", () => {
  it("成立 reveals the answer with the catch, pays −10 / +15, narrates its own line and passes the turn", () => {
    const g = started();
    const q = g.qid();
    const before = g.state().eventId;
    g.catchBy(1);
    g.rule(true);
    const s = g.state();
    expect(s.eventId).toBe(before + 1);
    expect(s.reveal).toMatchObject({ questionId: q, caught: { teamId: A, by: B } });
    expect(s.reveal.answer).toBeTruthy();
    expect(s.reveal.scored).toBeUndefined();
    expect(s.view.teams[1].reward).toBe(CATCH_PAY.bounty);
    expect(s.view.currentTurnTeamId).toBe(B);
    expect(g.room.game!.revealedQuestionIds).toContain(q);
    expect(g.room.game!.teams[0].flees).toBeUndefined();
  });

  it("冤枉 gives the accused a potion and the owl says so; a second ruling finds no catch", () => {
    const g = started();
    g.catchBy(1);
    g.rule(false);
    expect(g.state().view.teams[0].item).toBe("luckyPotion");
    expect(g.state().view.currentTurnTeamId).toBe(A);
    g.rule(false);
    expect(g.lastTo(g.host)).toMatchObject({ detail: "no_catch" });
  });

  // Value: protects=冤枉 on an accused already holding a potion pays +10 and the owl says +10, not a potion; fails_when=the room's
  // potion ternary is inverted or dismissCatch's flag ignored; why_new=room tests only cover the potion case; seam=none;
  // no_claim=the TV rendering of the line (narration messages only)
  it("冤枉 on an accused holding a potion pays +10 and the owl says so", async () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_GIVE_ITEM", teamId: A });
    const before = g.state().view.teams[0].reward;
    g.catchBy(1);
    g.rule(false);
    expect(g.state().view.teams[0].reward).toBe(before + CATCH_PAY.wronged);
    await vi.advanceTimersByTimeAsync(5_000);
    const said = g.all().filter((m) => m.type === "NARRATION").flatMap((m) => m.lines as string[]).join("\n");
    expect(said).toContain(`🛡️ 甲隊是冤枉的！乙隊扣 ${CATCH_PAY.falseReport} 分，甲隊加 ${CATCH_PAY.wronged} 分`);
  });

  it("an open 改判答對 is cleared by the catch: key 0 does nothing after 成立", () => {
    const g = started({ qs: TEXTS });
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: "t1", correct: false, fleeChoice: "retry", eventId: g.state().eventId });
    vi.advanceTimersByTime(10_000);
    expect(g.state().undoWrong).toMatchObject({ teamId: A, questionId: "t1" });
    send(g.room, g.phones[1], { type: "TEAM_ROLL_CHECK", questionId: "t2", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    g.catchBy(2, "t2");
    expect(g.state().undoWrong).toBeUndefined();
    g.rule(true);
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: A, questionId: "t1", eventId: g.state().eventId });
    expect(g.lastTo(g.host)).toMatchObject({ detail: "no_undo" });
  });

  it("a catch on the 下輪再答 turn is allowed again", () => {
    const g = started();
    const q = g.qid();
    g.catchBy(1);
    g.rule(false);
    g.catchBy(2);
    expect(g.lastTo(g.phones[2])).toMatchObject({ detail: "already_caught" });
    g.miss(0);
    g.miss(1);
    g.miss(2);
    expect(g.state().view.currentTurnTeamId).toBe(A);
    expect(g.qid()).toBe(q);
    expect(g.state().view.antiCheat.caught).toBeUndefined();
    g.catchBy(2);
    expect(g.state().view.antiCheat.openCatch).toMatchObject({ by: C, teamId: A, questionId: q });
  });
});

describe("review follow-ups", () => {
  const lines = (g: ReturnType<typeof started>) => g.all().filter((m) => m.type === "NARRATION").flatMap((m) => m.lines as string[]).join("\n");

  it("the owl reads the rules at switch-on, the catch line on 成立 (never a plain flee), and the 冤枉 line", async () => {
    const g = started();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lines(g)).toContain("有人在問 AI");
    g.catchBy(1);
    g.rule(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lines(g)).toMatch(/🚨[^\n]*甲隊|甲隊[^\n]*🚨/);
    send(g.room, g.host, { type: "HOST_NEXT", eventId: g.state().eventId });
    await vi.advanceTimersByTimeAsync(5_000);
    g.catchBy(2);
    expect(g.state().view.antiCheat.openCatch).toMatchObject({ by: C, teamId: B });
    g.rule(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lines(g)).toContain("🛡️ 乙隊是冤枉的");
  });

  it("refuses a catch while a restored natural 20 waits to judge the turn", () => {
    const g = started();
    (g.room as unknown as { lostCrit: object }).lostCrit = { teamId: A, questionId: g.qid() };
    g.catchBy(1);
    expect(g.lastTo(g.phones[1])).toMatchObject({ detail: "not_now" });
  });

  it("改判答對 keeps an oracle asked since, and switching on keeps 改判答對 open", () => {
    const g = started({ qs: TEXTS, off: true });
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: "t1", correct: false, fleeChoice: "retry", eventId: g.state().eventId });
    vi.advanceTimersByTime(10_000);
    send(g.room, g.host, { type: "HOST_ANTI_CHEAT", on: true });
    expect(g.state().undoWrong).toMatchObject({ teamId: A, questionId: "t1" });
    send(g.room, g.phones[1], { type: "TEAM_ROLL_CHECK", questionId: "t2", eventId: g.state().eventId });
    vi.advanceTimersByTime(2000);
    send(g.room, g.phones[1], { type: "TEAM_ORACLE", questionId: "t2" });
    expect(g.state().view.teams[1]).toMatchObject({ oracle: true, oracleLeft: 0 });
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: A, questionId: "t1", eventId: g.state().eventId });
    expect(g.state().view.antiCheat).toMatchObject({ on: true });
    expect(g.room.game!.teams[1]).toMatchObject({ oracleLeft: 0, oracleQ: "t2" });
  });

  it("改判答對 after a flee brings back the team's own oracle, so the reward stays halved", () => {
    const score = (oracle: boolean) => {
      // A mid roll: a 1 would halve the reward on its own.
      const g = started({ qs: TEXTS, rng: () => 0.5 });
      const teamId = g.state().view.currentTurnTeamId;
      const i = IDS.indexOf(teamId);
      const questionId = g.qid();
      send(g.room, g.phones[i], { type: "TEAM_ROLL_CHECK", questionId, eventId: g.state().eventId });
      vi.advanceTimersByTime(2000);
      if (oracle) send(g.room, g.phones[i], { type: "TEAM_ORACLE", questionId });
      send(g.room, g.host, { type: "HOST_JUDGE", teamId, questionId, correct: false, fleeChoice: "flee", eventId: g.state().eventId });
      expect(g.state().undoWrong).toMatchObject({ teamId, questionId });
      send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId, questionId, eventId: g.state().eventId });
      expect(g.room.game!.teams[i]).toMatchObject({ oracleLeft: oracle ? 0 : 1, oracleQ: undefined });
      return g.room.game!.teams[i].reward;
    };
    const full = score(false);
    expect(full).toBeGreaterThan(1);
    expect(score(true)).toBe(Math.round(full / 2));
  });

  it("a restart drops a saved catch whose question is no longer the accused's, refunding the reporter", async () => {
    const storage = memoryStorage();
    const g = started({ storage });
    g.catchBy(1);
    const saved = (await storage.get("room")) as { game: { antiCheat: { openCatch: { questionId: string } } } };
    saved.game.antiCheat.openCatch.questionId = "gone";
    storage.put("room", saved);
    const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
    const second = new DungeonRoom(io, () => 0, { bank: bank(MCS), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    expect(second.game!.antiCheat!.openCatch).toBeUndefined();
    expect(second.game!.teams[1].catchesLeft).toBe(2);
  });
});
