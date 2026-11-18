// 群眾預測 (docs/designs/crowd-prediction.md): a waiting team locks 會答對 / 會答錯 on the team answering a room question.
// Final, hidden until the judgment, resolved with the 改判 ledger entry, never saved while open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { checkKey, currentTurnTeamId, InvalidActionError } from "../game-state";
import { parseClientMessage } from "../protocol";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"];
const [A, B, C] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const mc = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "text", value: `題目 ${id}` }, options: ["甲", "乙", "丙"], correctIndex: 0 });
const MCS = ["m1", "m2", "m3", "m4", "m5", "m6"].map(mc);
const TEXTS = ["t1", "t2", "t3", "t4", "t5", "t6"].map(text);
const bank = (qs: object[]) =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: qs }],
    // Phase 2 is a buzzer phase (boss-buzzer.md), where every team answers at once.
    boss: { monster: "dragon", phases: [{ maxHp: 1, questions: [text("b1")] }, { name: "搶答", rule: "搶答", maxHp: 2, buzzer: true, questions: [text("z1"), text("z2")] }] },
  });

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage;
}

/** Three teams (甲 on turn) and a host; `start` null stays in the lobby. */
function started({ qs = MCS, classes = [], start = {}, storage = memoryStorage() }: { qs?: object[]; classes?: (string | null)[]; start?: object | null; storage?: RoomStorage } = {}) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const put = vi.spyOn(storage, "put");
  const room = new DungeonRoom(io, () => 0, { bank: bank(qs), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const conn = makeConn(`p${i}`);
    room.onConnect(conn);
    send(room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊", "丙隊"][i] });
    if (classes[i]) send(room, conn, { type: "TEAM_PICK_CLASS", classId: classes[i] });
    return conn;
  });
  if (start) send(room, host, { type: "HOST_START", aiNarration: false, ...start });
  const all = () => msgs(io.broadcast.mock.calls);
  const state = () => all().findLast((m) => m.type === "STATE");
  const preds = () => all().filter((m) => m.type === "PREDICTIONS");
  const onTurn = () => IDS.indexOf(currentTurnTeamId(room.game!)!);
  const qid = () => room.game!.teams[onTurn()].currentQuestionId;
  const team = (id: string) => room.game!.teams.find((t) => t.id === id)!;
  const predict = (i: number, correct: boolean, eventId = state().eventId) => send(room, phones[i], { type: "PREDICT", eventId, correct });
  /** The fill-in on turn shows: its persuasion check passed. */
  const shown = () => {
    room.game = { ...room.game!, checks: { ...room.game!.checks, [checkKey(qid(), IDS[onTurn()])]: { value: 10, bonus: 0, dc: 8, passed: true } } };
  };
  /** Team on turn locks the right or a wrong option; the host reveals it; the lock's beat runs out. */
  const lock = (right: boolean) => {
    const i = onTurn();
    const q = qid();
    send(room, phones[i], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q].indexOf(right ? 0 : 1) });
    send(room, phones[i], { type: "TEAM_LOCK_OPTION", questionId: q });
    send(room, host, { type: "HOST_REVEAL", teamId: IDS[i], questionId: q });
    vi.advanceTimersByTime(2000);
    // A right lock: its introduction, then the crit die's beat, then the judgment.
    if (right) vi.advanceTimersByTime(4000);
    return { i, q };
  };
  /** The host judges the fill-in on turn after its team typed an answer. */
  const judgeText = (correct: boolean, fleeChoice = "retry") => {
    const i = onTurn();
    const q = qid();
    send(room, phones[i], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "猜", eventId: state().eventId });
    send(room, host, { type: "HOST_JUDGE", teamId: IDS[i], questionId: q, correct, fleeChoice, eventId: state().eventId });
    return { i, q };
  };
  const right = () => room.game!.teams.map((t) => t.predictionsRight ?? 0);
  return { room, io, host, phones, all, state, preds, onTurn, qid, team, predict, shown, lock, judgeText, right, put, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("locking", () => {
  // Value: protects=the lock reaches every screen as a count | fails_when=PREDICTIONS stops listing the team, or a side leaks | no_claim=the phone's layout
  it("a waiting team locks and PREDICTIONS lists who locked, never the side", () => {
    const g = started();
    expect(g.state().predictions).toEqual({ open: true, locked: [] });
    g.predict(1, true);
    g.predict(2, false);
    expect(g.preds()).toEqual([{ type: "PREDICTIONS", locked: [B] }, { type: "PREDICTIONS", locked: [B, C] }]);
  });

  // Value: protects=only waiting joined teams predict | fails_when=the answering team, the host or a waiting late team gets a lock in | no_claim=late-team admission
  it("the team on turn, the host page and a waiting late team are dropped", () => {
    const g = started();
    g.predict(0, true);
    send(g.room, g.host, { type: "PREDICT", eventId: g.state().eventId, correct: true });
    const late = makeConn("late");
    g.room.onConnect(late);
    send(g.room, late, { type: "JOIN", teamId: "00000000-0000-0000-0000-000000000009", teamKey: "team-key-0123456789abcdef9", teamName: "晚到" });
    send(g.room, late, { type: "PREDICT", eventId: g.state().eventId, correct: true });
    expect(g.preds()).toEqual([]);
  });

  // Value: protects=a lock is final | fails_when=a second press switches or re-sends | no_claim=-
  it("a second lock is dropped and the first one stands", () => {
    const g = started();
    g.predict(1, true);
    g.predict(1, false);
    expect(g.preds()).toHaveLength(1);
    g.lock(true);
    expect(g.state().predicted).toMatchObject({ right: [B], wrong: [] });
  });

  // Value: protects=a slow press never lands in another attempt's round | fails_when=an old eventId is accepted | no_claim=-
  it("a lock under an older eventId is dropped", () => {
    const g = started();
    g.predict(1, true, g.state().eventId - 1);
    expect(g.preds()).toEqual([]);
  });

  // Value: protects=no round outside a room question's turn | fails_when=a lock lands in the lobby, intro, initiative, boss room or buzzer phase | no_claim=-
  it("no lock in the lobby, the intro, initiative, the boss room or a buzzer phase", () => {
    for (const start of [null, { intro: true }, { initiative: true }]) {
      const g = started({ start });
      for (const i of [0, 1, 2]) send(g.room, g.phones[i], { type: "PREDICT", eventId: 0, correct: true });
      expect(g.preds()).toEqual([]);
    }
    const g = started({ qs: TEXTS });
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    expect(g.state().predictions).toBeUndefined();
    g.predict(1, true);
    expect(g.preds()).toEqual([]);
    // On into the buzzer phase, where every team is answering.
    g.room.game = { ...g.room.game!, currentTurnIndex: 0 };
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: g.room.game!.boss.currentQuestionId, correct: true, fleeChoice: "retry", eventId: g.state().eventId });
    for (let k = 0; k < 2; k++) {
      send(g.room, g.host, { type: "HOST_SERVE", eventId: g.state().eventId });
      (g.room as unknown as { servedAt: number }).servedAt = -Infinity;
      send(g.room, g.host, { type: "HOST_NEXT", eventId: g.state().eventId });
    }
    expect(g.state().view.buzz).toBeDefined();
    for (const i of [0, 1, 2]) g.predict(i, true);
    expect(g.preds()).toEqual([]);
  });

  // Value: protects=locking closes when the answer starts | fails_when=a team can lock after an option lock or a text submit | no_claim=timing questions (buzzer phases only, never a round); the judgment closing it (tested with resolution)
  it("closes on an option lock and a text submit", () => {
    const g = started();
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: g.qid(), optionIndex: 0 });
    expect(g.state().predictions).toEqual({ open: true, locked: [] }); // a selected option keeps it open
    send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: g.qid() });
    expect(g.state().predictions).toBeUndefined();
    g.predict(1, true);
    expect(g.preds()).toEqual([]);

    const t = started({ qs: TEXTS });
    t.shown();
    t.predict(1, true);
    send(t.room, t.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: t.qid(), text: "猜", eventId: t.state().eventId });
    expect(t.state().predictions).toEqual({ open: false, locked: [B] });
    t.predict(2, true);
    expect(t.preds()).toHaveLength(1);
  });

  // Value: protects=a prediction stays off the save path | fails_when=PREDICT writes storage | no_claim=-
  it("a lock writes nothing to storage", () => {
    const g = started();
    const writes = g.put.mock.calls.length;
    g.predict(1, true);
    expect(g.preds()).toHaveLength(1);
    expect(g.put.mock.calls.length).toBe(writes);
  });

  // Value: protects=the wire format | fails_when=PREDICT parses without a boolean side or a whole eventId | no_claim=-
  it("PREDICT parses only with a boolean correct and a whole eventId ≥ 0", () => {
    expect(parseClientMessage({ type: "PREDICT", eventId: 3, correct: false })).toEqual({ type: "PREDICT", eventId: 3, correct: false });
    for (const bad of [{ correct: "true" }, { correct: 1 }, { correct: undefined }, { eventId: -1 }, { eventId: 1.5 }, { eventId: "3" }, { eventId: undefined }]) {
      expect(parseClientMessage({ type: "PREDICT", eventId: 3, correct: true, ...bad })).toBeNull();
    }
  });
});

describe("resolution", () => {
  // Value: protects=the tally and the reveal list | fails_when=a correct answer misses a 會答對 team, or counts a 會答錯 one, or no side shows before it | no_claim=the screens' rendering
  it("a correct answer gives +1 to 會答對 teams; STATE lists right and wrong only after it", () => {
    const g = started();
    g.predict(1, true);
    g.predict(2, false);
    const before = g.all().map((m) => JSON.stringify(m));
    expect(before.some((m) => m.includes("predicted"))).toBe(false);
    g.lock(true);
    expect(g.right()).toEqual([0, 1, 0]);
    expect(g.state().predicted).toEqual({ eventId: g.state().eventId, correct: true, right: [B], wrong: [C] });
    expect(g.room.game!.judgments!.at(-1)!.predictions).toEqual({ [B]: true, [C]: false });
  });

  // Value: protects=each attempt is one round | fails_when=a wrong retry is not resolved as 答錯 or the next turn finds the old locks | no_claim=-
  it("a wrong answer retried resolves as 答錯 and the next turn opens a fresh round", () => {
    const g = started();
    g.predict(1, true);
    g.predict(2, false);
    const { i, q } = g.lock(false);
    send(g.room, g.phones[i], { type: "TEAM_WRONG_CHOICE", questionId: q, choice: "retry" });
    expect(g.right()).toEqual([0, 0, 1]);
    expect(g.state().predicted).toMatchObject({ correct: false, right: [C], wrong: [B] });
    expect(g.state().predictions).toEqual({ open: true, locked: [] });
  });

  // Value: protects=a flee after a wrong answer counts as 答錯 | fails_when=incorrect-flee drops the round | no_claim=-
  it("a wrong answer the team flees from resolves as 答錯", () => {
    const g = started();
    g.predict(1, false);
    const { i, q } = g.lock(false);
    send(g.room, g.phones[i], { type: "TEAM_WRONG_CHOICE", questionId: q, choice: "flee" });
    expect(g.right()).toEqual([0, 1, 0]);
  });

  // Value: protects=no judgment, no resolution | fails_when=a skipped turn or an upheld 🚨 catch counts the locks | no_claim=-
  it("a skipped turn and an upheld 🚨 catch drop the round", () => {
    const g = started();
    g.predict(1, true);
    const q = g.qid();
    send(g.room, g.host, { type: "HOST_SKIP_TURN", teamId: A, eventId: g.state().eventId });
    expect(g.state().predictions?.locked ?? []).toEqual([]);
    // Back to 甲 on the same question: the skipped turn's lock is gone.
    for (let k = 0; k < 2; k++) {
      const { i, q: missed } = g.lock(false);
      send(g.room, g.phones[i], { type: "TEAM_WRONG_CHOICE", questionId: missed, choice: "retry" });
    }
    expect([g.onTurn(), g.qid()]).toEqual([0, q]);
    expect(g.state().predictions).toEqual({ open: true, locked: [] });
    g.lock(true);
    expect(g.right()).toEqual([0, 0, 0]);

    const c = started();
    send(c.room, c.host, { type: "HOST_ANTI_CHEAT", on: true });
    c.predict(2, false);
    send(c.room, c.phones[1], { type: "TEAM_CATCH", questionId: c.qid() });
    send(c.room, c.host, { type: "HOST_RULE_CATCH", upheld: true });
    expect(c.right()).toEqual([0, 0, 0]);
    expect(c.state().predicted).toBeUndefined();
  });

  // Value: protects=judgeNow's two passes count once | fails_when=a chef's answer die (first pass returns early) resolves the locks twice or never | no_claim=the kill roll's pass (boss, never a round)
  it("a chef's fill-in, judged again after its answer die, counts the locks once", () => {
    const g = started({ qs: TEXTS, classes: ["chef"] });
    g.shown();
    g.predict(1, true);
    g.predict(2, false);
    g.judgeText(true);
    expect((g.room as unknown as { pendingRoll: unknown }).pendingRoll).toBeTruthy();
    expect(g.right()).toEqual([0, 0, 0]);
    vi.advanceTimersByTime(2000);
    expect(g.right()).toEqual([0, 1, 0]);
    expect(g.room.game!.judgments).toHaveLength(1);
    expect(g.room.game!.judgments![0].predictions).toEqual({ [B]: true, [C]: false });
  });

  // Value: protects=改判答對 leaves the tally as if judged right | fails_when=the undone 答錯's locks are lost or counted both ways | no_claim=-
  it("HOST_UNDO_WRONG re-resolves the undone round as 答對", () => {
    const g = started({ qs: TEXTS });
    g.shown();
    g.predict(1, true);
    g.predict(2, false);
    const { q } = g.judgeText(false);
    expect(g.right()).toEqual([0, 0, 1]);
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: A, questionId: q, eventId: g.state().eventId });
    expect(g.right()).toEqual([0, 1, 0]);
    expect(g.room.game!.judgments).toHaveLength(1);
    expect(g.room.game!.judgments![0]).toMatchObject({ correct: true, predictions: { [B]: true, [C]: false } });
    expect(g.state().predicted).toMatchObject({ correct: true, right: [B], wrong: [C] });
  });

  // Value: protects=改判 moves the tally both ways | fails_when=a flip misses the locks or a flip and back does not net 0 | no_claim=-
  it("HOST_REJUDGE flips the tally, and flipping back nets 0", () => {
    const g = started();
    g.predict(1, true);
    g.predict(2, false);
    g.lock(true);
    const rejudge = (correct: boolean) => send(g.room, g.host, { type: "HOST_REJUDGE", index: 0, teamId: A, questionId: g.room.game!.judgments![0].questionId, correct });
    rejudge(false);
    expect(g.right()).toEqual([0, 0, 1]);
    // The result on screen follows the flip at once.
    expect(g.state().predicted).toMatchObject({ correct: false, right: [C], wrong: [B] });
    rejudge(true);
    expect(g.right()).toEqual([0, 1, 0]);
    expect(g.state().predicted).toMatchObject({ correct: true, right: [B], wrong: [C] });
  });

  // Value: protects=a filed 🚨 catch closes locking | fails_when=teams can lock while a catch waits (an upheld one reveals the answer) | no_claim=-
  it("an open 🚨 catch closes locking", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_ANTI_CHEAT", on: true });
    g.predict(1, true);
    send(g.room, g.phones[1], { type: "TEAM_CATCH", questionId: g.qid() });
    expect(g.state().predictions).toEqual({ open: false, locked: [B] });
    g.predict(2, false);
    expect(g.preds()).toHaveLength(1);
  });

  // Value: protects=改判答對 resolves the put-back round at once, and a refused one rolls it back | fails_when=a lock joins
  // the put-back round, it stays open after, or a refused undo clears the shown result or moves the tally | no_claim=a
  // music question with fields (buzzer phases only, never a round)
  it("HOST_UNDO_WRONG leaves no open round to join; a refused undo changes nothing", () => {
    const setup = () => {
      const g = started({ qs: TEXTS });
      g.shown();
      g.predict(1, true);
      const { q } = g.judgeText(false);
      return { g, q };
    };
    const { g, q } = setup();
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: A, questionId: q, eventId: g.state().eventId });
    expect(g.state().predictions?.locked ?? []).toEqual([]);
    g.predict(2, false);
    expect(g.preds()).toHaveLength(1);
    expect(g.right()).toEqual([0, 1, 0]);

    // The re-judgment is refused (as when the team's phones all dropped): the 答錯's result and tally stay.
    const r = setup();
    const before = r.g.state().predicted;
    expect(before).toMatchObject({ correct: false, wrong: [B] });
    vi.spyOn(r.g.room as unknown as { judge: () => void }, "judge").mockImplementation(() => {
      throw new InvalidActionError("not_your_turn");
    });
    send(r.g.room, r.g.host, { type: "HOST_UNDO_WRONG", teamId: A, questionId: r.q, eventId: r.g.state().eventId });
    expect(msgs(r.g.host.send.mock.calls).at(-1)).toMatchObject({ type: "ERROR" });
    send(r.g.room, r.g.host, { type: "HOST_FIX", teamId: B, fix: "score+" }); // any change: a fresh STATE
    expect(r.g.state().predicted).toEqual(before);
    expect(r.g.right()).toEqual([0, 0, 0]);
  });

  // Value: protects=resolved counts survive a restart, an open round does not | fails_when=the tally is lost or old locks come back | no_claim=-
  it("a restart keeps the counts and drops an open round", async () => {
    const storage = memoryStorage();
    const g = started({ storage });
    g.predict(1, true);
    g.lock(true);
    send(g.room, g.host, { type: "HOST_SERVE", eventId: g.state().eventId });
    (g.room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(g.room, g.host, { type: "HOST_NEXT", eventId: g.state().eventId });
    g.predict(2, false);
    expect(g.preds().at(-1)).toEqual({ type: "PREDICTIONS", locked: [C] });
    const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
    const second = new DungeonRoom(io, () => 0, { bank: bank(MCS), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    expect(second.game!.teams.map((t) => t.predictionsRight ?? 0)).toEqual([0, 1, 0]);
    const screen = makeConn("screen");
    second.onConnect(screen);
    const s = msgs(screen.send.mock.calls).findLast((m) => m.type === "STATE");
    expect(s.predictions?.locked ?? []).toEqual([]);
  });
});
