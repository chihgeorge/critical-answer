// 🍀 幸運骰 in the room (docs/designs/lucky-potion.md): the host gives one, the team uses it on its own turn, and its
// next class skill die, or its dish die once it has no skill uses left (甲2), rolls twice keeping the higher, then it is
// gone. Never the persuasion check, which rolls itself. No roll this question: it comes back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSettled } from "./test-send";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { checkKey } from "../game-state";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const [A, B] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const mc = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "text", value: `題目 ${id}` }, options: ["甲", "乙", "丙"], correctIndex: 0 });
const bank = (first: object) =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [first, text("r2"), text("r3"), text("r4"), text("r5")] }],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] },
  });

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => sendSettled(room, conn, msg);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));
/** rollD20 of each value. */
const die = (v: number) => (v - 1) / 20; // pregate-literal: MAX_BOSS_HP=20 not the HP cap

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage;
}

/** Two teams (甲 乙, 甲 on turn) and a host. `dice`: what the room's next rolls land on; empty, the rng gives 0. */
function started(first: object = mc("m1"), classes: (string | null)[] = [null, null], storage = memoryStorage()) {
  const dice: number[] = [];
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => (dice.length ? die(dice.shift()!) : 0), { bank: bank(first), epilogueDelayMs: 0 });
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
  const all = () => msgs(io.broadcast.mock.calls);
  const state = () => all().findLast((m) => m.type === "STATE");
  const team = (id: string) => state().view.teams.find((t: { id: string }) => t.id === id);
  const lastTo = (conn: Conn & { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).at(-1);
  const give = (id: string) => send(room, host, { type: "HOST_GIVE_ITEM", teamId: id });
  const drink = (i = 0, eventId = state().eventId, questionId = state().question.id) => send(room, phones[i], { type: "TEAM_DRINK_POTION", questionId, eventId });
  /** 🎲 擲料理骰 under the answer's reveal: the dish die rolls (and is left in its beat). */
  const rollDish = () => room.onMessage(JSON.stringify({ type: "HOST_NEXT", eventId: state().eventId }), host);
  /** 甲 locks the right option and the host reveals it, then rolls the dish die. */
  const lockRight = () => {
    const q = state().question.id;
    send(room, phones[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q].indexOf(0) });
    send(room, phones[0], { type: "TEAM_LOCK_OPTION", questionId: q });
    send(room, host, { type: "HOST_REVEAL", teamId: A, questionId: q });
    vi.advanceTimersByTime(2000); // the lock's beat: the answer's reveal comes first
    rollDish();
  };
  return { room, io, host, phones, dice, all, state, team, lastTo, give, drink, lockRight, rollDish };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("🍀 lucky die in the room", () => {
  it("the host gives one to any team, even off turn; a second one, or one from a phone, is refused", () => {
    const g = started();
    g.give(B);
    expect(g.team(B).item).toBe("luckyPotion");
    g.give(B);
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action", detail: "item_held" });
    send(g.room, g.phones[0], { type: "HOST_GIVE_ITEM", teamId: A });
    expect(g.lastTo(g.phones[0])).toMatchObject({ error: "not_host" });
    expect(g.team(A).item).toBeUndefined();
  });

  it("a dish die with the potion rolls two dice, keeps the higher, and spends it before the STATE goes out", () => {
    const g = started();
    g.give(A);
    g.drink();
    expect(g.team(A).itemArmedFor).toBe("m1");
    g.dice.push(3, 18);
    g.lockRight();
    expect(g.state().pendingRoll).toMatchObject({ kind: "dish", value: 18, values: [3, 18] });
    expect(g.team(A).item).toBeUndefined();
    expect(g.room.game!.teams[0].potionsDrunk).toBe(1);
  });

  // Value: protects=a dish 2–6 pays ×1 for everyone, so the potion never "saves" it; only a burnt 1 is a bad dish die
  // (#418); fails_when=sayPotion judges the dish die by skillTier again
  it("a potion dish says the saved line only when the low die burnt", async () => {
    const saved = async (classes: (string | null)[], low: number) => {
      const g = started(mc("m1"), classes);
      g.give(A);
      g.drink();
      g.dice.push(low, 18);
      g.lockRight();
      await vi.advanceTimersByTimeAsync(10_000);
      return /還好有幸運骰|一顆失敗，一顆成功|幸運骰發威/.test(JSON.stringify(g.all())); // POTION_VARIANTS.saved
    };
    expect(await saved([null, null], 3)).toBe(false);
    expect(await saved(["chef", null], 3)).toBe(false);
    expect(await saved([null, null], 1)).toBe(true);
  });

  it("a dish die without the potion stays one die", () => {
    const g = started();
    g.give(A);
    g.dice.push(7);
    g.lockRight();
    expect(g.state().pendingRoll.values).toBeUndefined();
    expect(g.team(A).item).toBe("luckyPotion");
  });

  // Value: protects=甲2: a class with skill uses left keeps the lucky die for its skill die, not the dish die; with none
  // left the dish die takes it; fails_when=startRoll arms it on any next die again
  it("a skill class with uses left keeps it off the dish die; with none left the dish die takes it", () => {
    const g = started(mc("m1"), ["mage", null]);
    g.give(A);
    g.drink();
    g.dice.push(3, 18);
    g.lockRight();
    expect(g.state().pendingRoll).toMatchObject({ kind: "dish", value: 3 });
    expect(g.state().pendingRoll.values).toBeUndefined();
    expect(g.team(A).item).toBe("luckyPotion");

    const n = started(mc("m1"), ["mage", null]);
    n.room.game = { ...n.room.game!, teams: n.room.game!.teams.map((t) => (t.id === A ? { ...t, abilityUses: 0 } : t)) };
    n.give(A);
    n.drink();
    n.dice.push(3, 18);
    n.lockRight();
    expect(n.state().pendingRoll).toMatchObject({ kind: "dish", value: 18, values: [3, 18] });
    expect(n.team(A).item).toBeUndefined();
  });

  // Value: protects=a dish die's 🍀 line is said before the dish it judged, not after it (QA 2026-11-19: 「兩顆骰子手牽手」 came
  // after the burnt dish's line); fails_when=sayPotion appends it after the judgment's narration again.
  it("a dish die's lucky line leads its judgment's narration", async () => {
    const g = started();
    g.give(A);
    g.drink();
    g.dice.push(1, 1);
    g.lockRight();
    expect(g.state().pendingRoll).toMatchObject({ kind: "dish", values: [1, 1] });
    await vi.advanceTimersByTimeAsync(2000);
    const n = g.all().filter((m) => m.type === "NARRATION").at(-1);
    expect(n.lines[0]).toMatch(/^🍀 /);
    expect(n.lines.filter((l: string) => l.startsWith("🍀"))).toHaveLength(1);
    expect(n.lines.length).toBeGreaterThan(1);
  });

  it("the persuasion check rolls itself before a drink, and an armed one stays off it", () => {
    const g = started(text("t1"));
    // The check rolled and landed as the turn opened (sendSettled): one die, nothing to double.
    expect(g.room.game!.checks![checkKey("t1", A)]).toBeDefined();
    g.give(A);
    g.drink();
    expect(g.team(A).itemArmed).toBe(true);
    expect(g.team(A).item).toBe("luckyPotion");
  });

  it("doubles the warrior's roll, and its hit's dish die is a single die", () => {
    const g = started(mc("m1"), ["warrior", null]);
    g.give(A);
    g.drink();
    g.dice.push(4, 16);
    send(g.room, g.phones[0], { type: "TEAM_USE_ABILITY", questionId: "m1" });
    expect(g.state().pendingRoll).toMatchObject({ kind: "warrior", value: 16, values: [4, 16] });
    expect(g.team(A).item).toBeUndefined();
    g.dice.push(9);
    vi.advanceTimersByTime(2000);
    g.rollDish();
    expect(g.state().pendingRoll).toMatchObject({ kind: "dish", value: 9 });
    expect(g.state().pendingRoll.values).toBeUndefined();
  });

  it("a potion with no die this question comes back once the question is over", () => {
    const g = started(text("t1"));
    g.give(A);
    g.drink();
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: "t1", correct: false, fleeChoice: "flee", eventId: g.state().eventId });
    expect(g.team(A).item).toBe("luckyPotion");
    expect(g.room.game!.teams[0].currentQuestionId).not.toBe("t1");
    expect(g.team(A).itemArmedFor).toBe("t1"); // the phone's 「幸運骰還在」 (E2)
  });

  // Value: protects=a potion doubles a mage's skill die (drinkable on a fill-in after its check) and a cleric's prayer die
  // (drinkable on its wrong lock); fails_when=startRoll or the drink gate stays crit/check only; why_new=only crit, check and
  // warrior dice were covered; seam=none; no_claim=the phones' potion button
  it("doubles a mage's skill die after a fill-in check and a cleric's prayer die on its wrong lock", () => {
    const m = started(text("t1"), ["mage", null]);
    m.give(A); // the check landed failed (sendSettled): no hint, so the mage's die is still to come
    m.drink();
    expect(m.team(A).itemArmedFor).toBe("t1");
    m.dice.push(5, 16);
    send(m.room, m.phones[0], { type: "TEAM_USE_ABILITY", questionId: "t1" });
    expect(m.state().pendingRoll).toMatchObject({ kind: "mage", value: 16, values: [5, 16] });
    expect(m.team(A).item).toBeUndefined();

    const c = started(mc("m1"), ["cleric", null]);
    c.give(A);
    send(c.room, c.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "m1", optionIndex: c.room.game!.optionOrder.m1.indexOf(1) });
    send(c.room, c.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "m1" });
    send(c.room, c.host, { type: "HOST_REVEAL", teamId: A, questionId: "m1" });
    vi.advanceTimersByTime(2000);
    c.drink();
    expect(c.team(A).itemArmedFor).toBe("m1");
    c.dice.push(15, 3); // pregate-literal: CHEF_BONUS_PERCENT=15 a die value, not the chef
    send(c.room, c.phones[0], { type: "TEAM_USE_ABILITY", questionId: "m1" });
    expect(c.state().pendingRoll).toMatchObject({ kind: "cleric", value: 15, values: [15, 3] }); // pregate-literal: CHEF_BONUS_PERCENT=15 a die value
    // The prayer rolled on m1: no lucky die for the rest of it (skillRolledOn).
    expect(c.team(A).prayedOn).toBe("m1");
  });

  // Value: protects=the owner's PR 422 ruling: a lucky die is used before a roll, so after the mage's cast on this question
  // the drink is refused there (never moved to the dish die); fails_when=the room arms it after the cast again
  it("refuses a mage's drink on a question it already cast on; takes it once its answer is in", () => {
    const failedCheck = () => {
      const m = started(text("t1"), ["mage", null]);
      m.give(A); // the check landed failed (sendSettled): no hint
      return m;
    };
    const cast = failedCheck();
    cast.dice.push(9);
    send(cast.room, cast.phones[0], { type: "TEAM_USE_ABILITY", questionId: "t1" });
    vi.advanceTimersByTime(2000);
    expect(cast.room.game!.mageCasts?.[checkKey("t1", A)]).toBeTruthy();
    cast.drink();
    expect(cast.team(A).itemArmedFor).toBeUndefined();
    expect(cast.lastTo(cast.phones[0])).toMatchObject({ detail: "skill_rolled" });

    const typed = failedCheck();
    send(typed.room, typed.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "t1", text: "答", eventId: typed.state().eventId });
    typed.drink();
    expect(typed.team(A).typedAnswer).toBe("答");
    expect(typed.team(A).itemArmedFor).toBe("t1");
  });

  it("a wrong answer with no roll keeps the potion, no longer armed", () => {
    const g = started(text("t1"));
    g.give(A);
    g.drink();
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: "t1", correct: false, fleeChoice: "flee", eventId: g.state().eventId });
    expect(g.team(A).item).toBe("luckyPotion");
    expect(g.room.game!.teams[0].itemArmedFor).not.toBe(g.room.game!.teams[0].currentQuestionId);
  });

  it("refuses a drink off turn, under a stale STATE, with no potion, twice, with a lock in, or at a fork", () => {
    const g = started(text("t1"));
    g.drink();
    expect(g.lastTo(g.phones[0])).toMatchObject({ detail: "no_item" });
    g.give(A);
    g.give(B);
    g.drink(1);
    expect(g.lastTo(g.phones[1])).toMatchObject({ detail: "not_your_turn" });
    g.drink(0, g.state().eventId - 1);
    expect(g.lastTo(g.phones[0])).toMatchObject({ detail: "stale_event" });
    g.drink();
    g.drink();
    expect(g.lastTo(g.phones[0])).toMatchObject({ detail: "already_drunk" });


    const l = started();
    l.give(A);
    send(l.room, l.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "m1", optionIndex: l.room.game!.optionOrder.m1.indexOf(1) });
    send(l.room, l.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "m1" });
    l.drink();
    expect(l.lastTo(l.phones[0])).toMatchObject({ detail: "answer_pending" });
    // A wrong lock waiting for 重答／逃跑: no die can roll.
    send(l.room, l.host, { type: "HOST_REVEAL", teamId: A, questionId: "m1" });
    vi.advanceTimersByTime(2000);
    expect(l.room.game!.pendingWrong).not.toBeNull();
    l.drink();
    expect(l.lastTo(l.phones[0])).toMatchObject({ detail: "answer_pending" });

    const e = started();
    e.give(A);
    const game = e.room.game!;
    e.room.game = { ...game, teams: game.teams.map((t) => (t.id === A ? { ...t, fork: { phase: "waiting" as const } } : t)) };
    e.drink();
    expect(e.lastTo(e.phones[0])).toMatchObject({ detail: "fork" });
    expect(e.room.game!.teams[0].itemArmedFor).toBeUndefined();
  });

  it("a restart inside the roll's beat keeps the potion spent", async () => {
    const storage = memoryStorage();
    const g = started(mc("m1"), [null, null], storage);
    g.give(A);
    g.drink();
    g.dice.push(2, 11);
    g.lockRight();
    const second = new DungeonRoom({ broadcast: vi.fn(), storage } as unknown as RoomIO, () => 0, { bank: bank(mc("m1")), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    expect(second.game!.teams[0]).toMatchObject({ item: undefined, potionsDrunk: 1 });
  });

  // Value: protects=a restart inside a cleric's prayer die restores a failed prayer, never a free one (class dice);
  // fails_when=restore keeps prayed with no die, so the cleric's 重答 keeps the turn; why_new=no restart test rolled a class
  // die; seam=none; no_claim=real Durable Object storage (memory storage)
  it("a restart inside a cleric's prayer die restores a failed prayer, with the use spent", async () => {
    const storage = memoryStorage();
    const c = started(mc("m1"), ["cleric", null], storage);
    send(c.room, c.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "m1", optionIndex: c.room.game!.optionOrder.m1.indexOf(1) });
    send(c.room, c.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "m1" });
    send(c.room, c.host, { type: "HOST_REVEAL", teamId: A, questionId: "m1" });
    vi.advanceTimersByTime(2000);
    c.dice.push(12);
    send(c.room, c.phones[0], { type: "TEAM_USE_ABILITY", questionId: "m1" }); // the prayer die rolls; the room restarts in its beat
    expect(c.state().pendingRoll).toMatchObject({ kind: "cleric" });
    const second = new DungeonRoom({ broadcast: vi.fn(), storage } as unknown as RoomIO, () => 0, { bank: bank(mc("m1")), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    expect(second.game!.pendingWrong).toEqual({ teamId: A, questionId: "m1", optionIndex: c.room.game!.optionOrder.m1.indexOf(1), prayFailed: true });
    expect(second.game!.teams[0].abilityUses).toBe(c.room.game!.teams[0].abilityUses);
    // Without the restart the 12 lands and the prayer stands, no longer marked as rolling.
    vi.advanceTimersByTime(2000);
    expect(c.room.game!.pendingWrong).toMatchObject({ prayed: true });
    expect(c.room.game!.pendingWrong?.praying).toBeUndefined();
  });

  describe("the owl's give line (E5)", () => {
    const narrations = (g: ReturnType<typeof started>) => g.all().filter((m) => m.type === "NARRATION");

    it("rides the current narration when it lands, then is appended at once under a new rev", async () => {
      const g = started();
      g.give(A); // the start narration is still on its way
      await vi.advanceTimersByTimeAsync(0);
      const n = narrations(g).at(-1);
      expect(n.lines.at(-1)).toBe("🍀 甲隊拿到一顆幸運骰！");
      g.give(B);
      const m = narrations(g).at(-1);
      expect(m).toMatchObject({ eventId: n.eventId, rev: n.rev + 1 });
      expect(m.lines).toEqual([...n.lines, "🍀 乙隊拿到一顆幸運骰！"]);
    });

    it("a held line is dropped when the game ends first", async () => {
      const g = started();
      g.give(A);
      send(g.room, g.host, { type: "HOST_END_GAME" });
      await vi.advanceTimersByTimeAsync(0);
      expect(narrations(g).some((m) => m.lines.some((l: string) => l.includes("幸運骰")))).toBe(false);
    });
  });
});
