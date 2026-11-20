// 首領血量 −5 / +5 (docs/hosting.md): the host shortens or lengthens the boss fight. Host only, once a team is in the boss
// room, clamped to 1..MAX_BOSS_HP on the current phase, saved with the game, and told on the big screen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSettled } from "./test-send";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { parseClientMessage } from "../protocol";
import { adjustBossHp, MAX_BOSS_HP } from "../game-state";
import { bossHpBanner } from "../transitions";
import { NARRATION_MAX_LINES } from "./snapshot";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const [A] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = () =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [text("r1"), text("r2"), text("r3"), text("r4"), text("r5")] }],
    boss: {
      monster: "dragon",
      phases: [
        { name: "一", rule: "規則一", maxHp: 3, questions: [text("b1"), text("b2")] },
        { name: "二", rule: "規則二", maxHp: 8, questions: [text("b3")] },
      ],
    },
  });

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => sendSettled(room, conn, msg);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage;
}

function started() {
  const storage = memoryStorage();
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const conn = makeConn(`p${i}`);
    room.onConnect(conn);
    send(room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊"][i] });
    return conn;
  });
  send(room, host, { type: "HOST_START", aiNarration: false });
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  const lastTo = (conn: Conn & { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).at(-1);
  const hp = (delta: number, conn: Conn = host) => send(room, conn, { type: "HOST_BOSS_HP", delta });
  return { room, io, host, phones, state, lastTo, hp, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("首領血量 −5 / +5", () => {
  it("parses only ±5", () => {
    expect(parseClientMessage({ type: "HOST_BOSS_HP", delta: -5 })).toEqual({ type: "HOST_BOSS_HP", delta: -5 });
    expect(parseClientMessage({ type: "HOST_BOSS_HP", delta: 5 })).toEqual({ type: "HOST_BOSS_HP", delta: 5 });
    for (const delta of [1, -6, 50, "5", null]) expect(parseClientMessage({ type: "HOST_BOSS_HP", delta })).toBeNull();
  });

  it("a phone gets not_host; before any team is in the boss room it is refused", () => {
    const g = started();
    g.hp(-5, g.phones[0]);
    expect(g.lastTo(g.phones[0])).toMatchObject({ type: "ERROR", error: "not_host" });
    g.hp(-5);
    expect(g.lastTo(g.host)).toMatchObject({ type: "ERROR", detail: "boss_not_reached" });
    expect(g.room.game!.boss.hp).toBe(3);
  });

  it("−5 stops at 1, +5 raises the bar with it, and each press shows on the big screen with an owl line", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    g.hp(-5);
    expect(g.room.game!.boss).toMatchObject({ hp: 1, maxHp: 3, hpAdjust: { delta: -2, count: 1 } });
    expect(g.state().view).toMatchObject({ bossHp: 1, bossMaxHp: 3, bossHpAdjust: { delta: -2, count: 1 } });
    g.hp(-5);
    expect(g.lastTo(g.host)).toMatchObject({ type: "ERROR", detail: "boss_hp_limit" });
    g.hp(5);
    g.hp(5);
    // 1 → 6 → 11: past the bank's 3, the bar (and phase 1's bar) grows; phase 2 keeps its 8.
    expect(g.room.game!.boss).toMatchObject({ hp: 11, maxHp: 11, hpAdjust: { delta: 5, count: 3 } });
    expect(g.room.game!.boss.phases.map((p) => p.maxHp)).toEqual([11, 8]);
    // Said with this event's narration: at once when it is on screen, else held for it (as 🍀 給幸運骰's line).
    const r = g.room as unknown as { heldLines: { lines: string[] } | null };
    const lines = [...msgs(g.io.broadcast.mock.calls).filter((m) => m.type === "NARRATION").flatMap((m) => m.lines), ...(r.heldLines?.lines ?? [])];
    expect(lines.join("\n")).toMatch(/首領體力不支了！血量 −2，只剩 1。/);
  });

  it("+5 never passes MAX_BOSS_HP", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    for (let i = 0; i < 20; i++) g.hp(5);
    expect(g.room.game!.boss.hp).toBe(MAX_BOSS_HP);
    expect(g.lastTo(g.host)).toMatchObject({ type: "ERROR", detail: "boss_hp_limit" });
  });

  it("is refused while a die, a lock or a phase card is in its beat (a kill roll included)", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    const r = g.room as unknown as Record<string, unknown>;
    for (const [key, value] of [["pendingRoll", { teamId: A, questionId: "b1", value: 20, kind: "kill" }], ["pendingLock", { teamId: A, questionId: "b1", index: 0 }], ["phaseCard", true]] as const) {
      r[key] = value;
      g.hp(-5);
      expect(g.lastTo(g.host)).toMatchObject({ type: "ERROR", detail: "lock_pending" });
      expect(g.room.game!.boss.hp).toBe(3);
      r[key] = key === "phaseCard" ? false : null;
    }
    const game = g.room.game!;
    expect(() => adjustBossHp({ ...game, boss: { ...game.boss, killedByTeamId: A } }, 5)).toThrow("boss_phase_changing");
    expect(() => adjustBossHp({ ...game, phase: "finished" }, 5)).toThrow("not_playing");
  });

  it("presses while this turn's narration is still coming never hold more lines than a save keeps", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    const r = g.room as unknown as { lastNarration: { eventId: number } | null; eventSeq: number; heldLines: { lines: string[] } | null };
    r.lastNarration = r.lastNarration && { ...r.lastNarration, eventId: r.eventSeq - 1 };
    for (let i = 0; i < 30; i++) g.hp(i % 2 ? 5 : -5);
    expect(r.heldLines!.lines.length).toBeLessThanOrEqual(NARRATION_MAX_LINES);
  });

  it("survives a restart", async () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    g.hp(5);
    const second = new DungeonRoom({ broadcast: vi.fn(), storage: g.storage } as unknown as RoomIO, () => 0, { bank: bank(), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    expect(second.game!.boss).toMatchObject({ hp: 8, maxHp: 8, hpAdjust: { delta: 5, count: 1 } });
  });

  it("acts on the current phase only and never during a phase change", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: A });
    const game = g.room.game!;
    expect(() => adjustBossHp({ ...game, boss: { ...game.boss, hp: 0, phasePending: "cleared" } }, 5)).toThrow("boss_phase_changing");
    const second = { ...game, boss: { ...game.boss, phaseIndex: 1, hp: 8, maxHp: 8 } };
    expect(adjustBossHp(second, -5).boss).toMatchObject({ hp: 3, maxHp: 8 });
    expect(adjustBossHp(second, 5).boss.phases.map((p) => p.maxHp)).toEqual([3, 13]);
  });

  it("the big screen plays the notice once per press, never on connect", () => {
    expect(bossHpBanner(null, { bossHpAdjust: { delta: 5, count: 2 } })).toEqual({ seen: 2, play: null });
    expect(bossHpBanner(2, { bossHpAdjust: { delta: -5, count: 3 } })).toEqual({ seen: 3, play: { kind: "bossHp", delta: -5 } });
    expect(bossHpBanner(3, { bossHpAdjust: { delta: -5, count: 3 } }).play).toBeNull();
  });
});
