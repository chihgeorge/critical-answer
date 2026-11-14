// 🧪 幸運藥水 in the room (docs/designs/lucky-potion.md): the host gives one, the team drinks it on its own turn, and its
// next crit or check die rolls twice keeping the higher, then it is gone. No roll this question: it comes back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
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
  /** 甲 locks the right option and the host reveals it: the crit die rolls. */
  const lockRight = () => {
    const q = state().question.id;
    send(room, phones[0], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q].indexOf(0) });
    send(room, phones[0], { type: "TEAM_LOCK_OPTION", questionId: q });
    send(room, host, { type: "HOST_REVEAL", teamId: A, questionId: q });
    vi.advanceTimersByTime(2000);
  };
  return { room, io, host, phones, dice, all, state, team, lastTo, give, drink, lockRight };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("🧪 lucky potion in the room", () => {
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

  it("a crit with the potion rolls two dice, keeps the higher, and spends it before the STATE goes out", () => {
    const g = started();
    g.give(A);
    g.drink();
    expect(g.team(A).itemArmedFor).toBe("m1");
    g.dice.push(3, 18);
    g.lockRight();
    expect(g.state().pendingRoll).toMatchObject({ kind: "crit", value: 18, values: [3, 18] });
    expect(g.team(A).item).toBeUndefined();
    expect(g.room.game!.teams[0].potionsDrunk).toBe(1);
  });

  it("a crit without the potion stays one die", () => {
    const g = started();
    g.give(A);
    g.dice.push(7);
    g.lockRight();
    expect(g.state().pendingRoll.values).toBeUndefined();
    expect(g.team(A).item).toBe("luckyPotion");
  });

  it("a persuasion check with the potion records the higher die", () => {
    const g = started(text("t1"));
    g.give(A);
    g.drink();
    g.dice.push(19, 4);
    send(g.room, g.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: g.state().eventId });
    expect(g.state().pendingRoll).toMatchObject({ kind: "check", value: 19, values: [19, 4] });
    expect(g.room.game!.checks![checkKey("t1", A)].value).toBe(19);
    expect(g.team(A).item).toBeUndefined();
  });

  it("the warrior's answer die never uses it: one die, and the potion is back once the question is over", () => {
    const g = started(mc("m1"), ["warrior", null]);
    g.give(A);
    g.drink();
    g.dice.push(15); // pregate-literal: CHEF_BONUS_PERCENT=15 a die value, not the chef
    send(g.room, g.phones[0], { type: "TEAM_USE_ABILITY", questionId: "m1" });
    expect(g.state().pendingRoll).toMatchObject({ kind: "warrior", value: 15 });
    expect(g.state().pendingRoll.values).toBeUndefined();
    vi.advanceTimersByTime(2000);
    expect(g.team(A).item).toBe("luckyPotion");
    expect(g.room.game!.teams[0].currentQuestionId).not.toBe("m1");
    expect(g.team(A).itemArmedFor).toBe("m1"); // the phone's 「藥水還在」 (E2)
  });

  it("a wrong answer with no roll keeps the potion, no longer armed", () => {
    const g = started(text("t1"));
    g.give(A);
    g.drink();
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: "t1", correct: false, fleeChoice: "flee", eventId: g.state().eventId });
    expect(g.team(A).item).toBe("luckyPotion");
    expect(g.room.game!.teams[0].itemArmedFor).not.toBe(g.room.game!.teams[0].currentQuestionId);
  });

  it("refuses a drink off turn, under a stale STATE, with no potion, twice, after the check, with a lock in, or at a fork", () => {
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

    const c = started(text("t1"));
    c.give(A);
    send(c.room, c.phones[0], { type: "TEAM_ROLL_CHECK", questionId: "t1", eventId: c.state().eventId });
    vi.advanceTimersByTime(2000);
    c.drink();
    expect(c.lastTo(c.phones[0])).toMatchObject({ detail: "check_done" });

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

  describe("the owl's give line (E5)", () => {
    const narrations = (g: ReturnType<typeof started>) => g.all().filter((m) => m.type === "NARRATION");

    it("rides the current narration when it lands, then is appended at once under a new rev", async () => {
      const g = started();
      g.give(A); // the start narration is still on its way
      await vi.advanceTimersByTimeAsync(0);
      const n = narrations(g).at(-1);
      expect(n.lines.at(-1)).toBe("🧪 甲隊拿到一瓶幸運藥水！");
      g.give(B);
      const m = narrations(g).at(-1);
      expect(m).toMatchObject({ eventId: n.eventId, rev: n.rev + 1 });
      expect(m.lines).toEqual([...n.lines, "🧪 乙隊拿到一瓶幸運藥水！"]);
    });

    it("a held line is dropped when the game ends first", async () => {
      const g = started();
      g.give(A);
      send(g.room, g.host, { type: "HOST_END_GAME" });
      await vi.advanceTimersByTimeAsync(0);
      expect(narrations(g).some((m) => m.lines.some((l: string) => l.includes("幸運藥水")))).toBe(false);
    });
  });
});
