import { describe, it, expect } from "vitest";
import { bossClock, heartbeatTimes, parryFor, rageNow } from "./boss-fx";
import { createFlashBudget, FLASH_MAX } from "./flash-budget";
import type { StateMessage } from "./protocol";

const team = (id: string, inBossPhase: boolean) => ({ id, name: id, inBossPhase, roomIndex: 0, currentQuestionId: "q1" });
const room = { id: "q1", content: { kind: "text", value: "題目" }, difficulty: 1, boss: false, monster: { name: "史萊姆", sprite: "slime", hue: 0 } };
const boss = { ...room, id: "b1", boss: true, monster: { name: "魔王", sprite: "dragon", hue: 0 } };

type Over = { inBoss?: boolean; wrong?: boolean; cue?: string; cueSeq?: number; hp?: number; maxHp?: number; phase?: "playing" | "finished"; phaseCard?: boolean; left?: number | null; reveal?: boolean };
function state(o: Over = {}): StateMessage {
  const inBoss = o.inBoss ?? true;
  return {
    type: "STATE",
    phase: o.phase ?? "playing",
    eventId: 1,
    cueSeq: o.cueSeq ?? 1,
    ...(o.cue ? { cue: o.cue } : {}),
    view: {
      currentTurnTeamId: "a",
      teams: [team("a", inBoss)],
      bossHp: o.hp ?? 5,
      bossMaxHp: o.maxHp ?? 5,
      bossPhase: 1,
      bossCurrentQuestionId: "b1",
      pendingWrong: o.wrong ? { teamId: "a", questionId: inBoss ? "b1" : "q1", optionIndex: 1 } : null,
    },
    question: inBoss ? boss : room,
    reveal: o.reveal ? { questionId: "q1", answer: "x" } : null,
    ...(o.phaseCard ? { phaseCard: { monster: boss.monster } } : {}),
    ...(o.left !== undefined ? { answerClock: { left: o.left } } : {}),
  } as unknown as StateMessage;
}

describe("parryFor (② boss wrong answer)", () => {
  it("plays on a boss wrong lock, once, and the retry cue that follows does not play it again", () => {
    const k = parryFor(state(), state({ wrong: true }), null);
    expect(k).toBe("a:b1");
    expect(parryFor(state({ wrong: true }), state({ wrong: true, cue: "retry", cueSeq: 2 }), k)).toBeNull();
  });

  it("plays on a boss retry or flee cue with no wrong lock first (a typed answer judged wrong), not on a catch ruling", () => {
    expect(parryFor(state(), state({ cue: "retry", cueSeq: 2 }), null)).toBe("a:b1");
    expect(parryFor(state(), state({ cue: "flee", cueSeq: 2 }), null)).toBe("a:b1");
    const catchOpen = { ...state(), view: { ...state().view, antiCheat: { on: true, onCount: 1, openCatch: { by: "b", teamId: "a" } } } } as unknown as StateMessage;
    expect(parryFor(catchOpen, state({ cue: "flee", cueSeq: 2 }), null)).toBeNull();
  });

  it("never plays outside the boss room, for a fumble (a hit), on an old cue, or on a screen's first STATE", () => {
    expect(parryFor(state({ inBoss: false }), state({ inBoss: false, wrong: true }), null)).toBeNull();
    expect(parryFor(state({ inBoss: false }), state({ inBoss: false, cue: "retry", cueSeq: 2 }), null)).toBeNull();
    expect(parryFor(state(), state({ cue: "fumble", cueSeq: 2 }), null)).toBeNull();
    expect(parryFor(state({ cue: "retry" }), state({ cue: "retry" }), null)).toBeNull();
    expect(parryFor(null, state({ wrong: true }), null)).toBeNull();
  });
});

describe("rageNow (④)", () => {
  it("is on at a third of the phase's bar or less, never at 0", () => {
    expect(rageNow(state({ hp: 1 }))).toBe(true);
    expect(rageNow(state({ hp: 2 }))).toBe(false);
    expect(rageNow(state({ hp: 2, maxHp: 6 }))).toBe(true);
    expect(rageNow(state({ hp: 3, maxHp: 6 }))).toBe(false);
    expect(rageNow(state({ hp: 0 }))).toBe(false);
  });

  it("never fires with a bar of 1 or 2 (the owner's formula, on purpose)", () => {
    expect(rageNow(state({ hp: 1, maxHp: 1 }))).toBe(false);
    expect(rageNow(state({ hp: 1, maxHp: 2 }))).toBe(false);
  });

  it("gives way to the phase card, and ends with the game", () => {
    expect(rageNow(state({ hp: 1, phaseCard: true }))).toBe(false);
    expect(rageNow({ ...state({ hp: 1 }), phaseCardDue: true } as StateMessage)).toBe(false);
    expect(rageNow(state({ hp: 1, phase: "finished" }))).toBe(false);
  });
});

describe("bossClock and heartbeatTimes (③)", () => {
  it("runs only in the boss scene while an answer count is on screen", () => {
    expect(bossClock(state({ left: 5000 }))).toBe(true);
    expect(bossClock(state({ left: null }))).toBe(false);
    expect(bossClock(state())).toBe(false);
    expect(bossClock(state({ inBoss: false, left: 5000 }))).toBe(false);
    expect(bossClock(state({ left: 5000, reveal: true }))).toBe(false);
    expect(bossClock(state({ left: 5000, phaseCard: true }))).toBe(false);
  });

  it("beats from once a second up to 2.5 a second, all before the clock reaches 0", () => {
    const t = heartbeatTimes(5);
    expect(t[0]).toBe(0);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    expect(gaps[0]).toBeCloseTo(1, 5);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.4);
    expect(gaps.at(-1)!).toBeLessThan(0.5); // near 2.5 a second by the end
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    expect(t.at(-1)!).toBeLessThan(5);
  });

  it("joined late (3 s left), it beats at the pace for 3 s left, never past 0", () => {
    const t = heartbeatTimes(3);
    expect(t[1] - t[0]).toBeCloseTo(0.4 + 0.6 * (3 / 5), 5);
    expect(t.at(-1)!).toBeLessThan(3);
  });
});

describe("the shared flash budget", () => {
  it("allows at most 3 flashes in any 1 s, then frees up as the window slides", () => {
    let now = 0;
    const b = createFlashBudget(() => now);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    now = 999;
    expect(b.take()).toBe(false);
    now = 1000;
    expect(b.take()).toBe(true);
  });

  it("a heartbeat glow at full pace plus a parry's red flash never flash more than 3 times in any 1 s", () => {
    let now = 0;
    const b = createFlashBudget(() => now);
    const asks = [...heartbeatTimes(5).map((t) => t * 1000), 3500, 3600, 4200].sort((x, y) => x - y);
    const lit: number[] = [];
    for (const at of asks) {
      now = at;
      if (b.take()) lit.push(at);
    }
    for (const start of lit) expect(lit.filter((t) => t >= start && t < start + 1000).length).toBeLessThanOrEqual(FLASH_MAX);
    expect(lit.length).toBeLessThan(asks.length); // the budget did refuse some
  });
});
