import { describe, expect, it, vi } from "vitest";
import { CLASS_FX_MS, classFxFor, playClassFx, type ClassFx, type ClassFxDeps } from "./class-fx";
import { CLASS_PULSE, CLASS_TINT, createFlashBudget, FLASH_MAX, FLASH_WINDOW_MS } from "./flash-budget";
import { heartbeatTimes } from "./boss-fx";
import { CHEF_SIZZLE, CLERIC_PRAYER, MAGE_SPELL, THIEF_SNEAK } from "./sfx";
import type { StateMessage } from "./protocol";

type T = { id: string; classId?: string; uses: number };
const state = (teams: T[], phase: "playing" | "finished" = "playing"): StateMessage =>
  ({ type: "STATE", phase, eventId: 1, view: { currentTurnTeamId: teams[0]?.id ?? null, teams: teams.map((t) => ({ id: t.id, name: `隊${t.id}`, classId: t.classId, abilityUses: t.uses })) } }) as unknown as StateMessage;

describe("classFxFor", () => {
  it.each(["mage", "cleric", "thief"] as const)("plays the %s's moment when its uses drop, with the team's name", (classId) => {
    expect(classFxFor(state([{ id: "a", classId, uses: 2 }]), state([{ id: "a", classId, uses: 1 }]))).toEqual({ kind: classId, teamId: "a", name: "隊a" });
  });

  it("finds the spender among several teams", () => {
    const prev = state([{ id: "a", classId: "mage", uses: 4 }, { id: "b", classId: "thief", uses: 2 }]);
    expect(classFxFor(prev, state([{ id: "a", classId: "mage", uses: 4 }, { id: "b", classId: "thief", uses: 1 }]))?.teamId).toBe("b");
  });

  it("leaves out the warrior (its d20 is its moment), the chef, a classless team, a refund and no change", () => {
    expect(classFxFor(state([{ id: "a", classId: "warrior", uses: 4 }]), state([{ id: "a", classId: "warrior", uses: 3 }]))).toBeNull();
    expect(classFxFor(state([{ id: "a", classId: "chef", uses: 2 }]), state([{ id: "a", classId: "chef", uses: 1 }]))).toBeNull();
    expect(classFxFor(state([{ id: "a", uses: 2 }]), state([{ id: "a", uses: 1 }]))).toBeNull();
    expect(classFxFor(state([{ id: "a", classId: "thief", uses: 1 }]), state([{ id: "a", classId: "thief", uses: 2 }]))).toBeNull();
    expect(classFxFor(state([{ id: "a", classId: "mage", uses: 2 }]), state([{ id: "a", classId: "mage", uses: 2 }]))).toBeNull();
  });

  it("is live only: nothing on a screen's first STATE, across a phase change, or for a team that just joined", () => {
    expect(classFxFor(null, state([{ id: "a", classId: "mage", uses: 1 }]))).toBeNull();
    expect(classFxFor(state([{ id: "a", classId: "mage", uses: 2 }]), state([{ id: "a", classId: "mage", uses: 1 }], "finished"))).toBeNull();
    expect(classFxFor(state([{ id: "a", classId: "mage", uses: 2 }], "finished"), state([{ id: "a", classId: "mage", uses: 1 }]))).toBeNull();
    expect(classFxFor(state([]), state([{ id: "a", classId: "mage", uses: 1 }]))).toBeNull();
  });
});

const fx: ClassFx = { kind: "mage", teamId: "a", name: "隊a" };
const deps = (o: Partial<ClassFxDeps> = {}): ClassFxDeps => ({ clipPlaying: false, reducedMotion: false, transitionUp: false, parrying: false, takeFlash: () => true, play: vi.fn(), show: vi.fn(), ...o });

describe("playClassFx", () => {
  it.each([
    ["with budget", {}, "flash"],
    ["budget spent", { takeFlash: () => false }, "tint"],
    ["reduced motion", { reducedMotion: true }, "tint"],
    ["over a transition", { transitionUp: true }, "tint"],
    ["while a parry runs", { parrying: true }, "tint"],
  ] as const)("%s → %s, with its sound", (_, o, look) => {
    const d = deps(o);
    expect(playClassFx(fx, d)).toEqual({ ...fx, look });
    expect(d.play).toHaveBeenCalledWith("mage");
    expect(d.show).toHaveBeenCalledWith({ ...fx, look });
  });

  it("only a pulse asks the budget: reduced motion, a transition or a parry never spend a flash", () => {
    const takeFlash = vi.fn(() => true);
    for (const o of [{ reducedMotion: true }, { transitionUp: true }, { parrying: true }]) playClassFx(fx, deps({ ...o, takeFlash }));
    expect(takeFlash).not.toHaveBeenCalled();
  });

  it("drops the sound over this screen's own clip, the look still shows", () => {
    const d = deps({ clipPlaying: true });
    expect(playClassFx(fx, d)?.look).toBe("flash");
    expect(d.play).not.toHaveBeenCalled();
    expect(d.show).toHaveBeenCalled();
  });

  it("a throwing audio call is logged and never escapes", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => playClassFx(fx, deps({ play: () => { throw new Error("audio"); } }))).not.toThrow();
    expect(err).toHaveBeenCalledWith("[fx] class-effect", expect.any(Error));
    err.mockRestore();
  });

  it("class moments on top of the fastest heartbeat never flash more than 3 times in any second", () => {
    let now = 0;
    const budget = createFlashBudget(() => now);
    const lit: number[] = [];
    const events = [...heartbeatTimes(2).map((t) => ({ at: t * 1000, take: () => budget.take() })), ...[0, 100, 300, 500, 900, 1200].map((at) => ({ at, take: () => playClassFx(fx, deps({ takeFlash: () => budget.take() }))?.look === "flash" }))];
    for (const e of events.sort((x, y) => x.at - y.at)) {
      now = e.at;
      if (e.take()) lit.push(now);
    }
    for (const t of lit) expect(lit.filter((u) => u >= t && u < t + FLASH_WINDOW_MS).length).toBeLessThanOrEqual(FLASH_MAX);
    expect(lit.length).toBeGreaterThan(0);
  });
});

describe("class sounds and tints", () => {
  it("are synthesized without the sawtooth, distinct, and over within the badge's time", () => {
    const all = [MAGE_SPELL, CLERIC_PRAYER, THIEF_SNEAK, CHEF_SIZZLE];
    for (const notes of all) {
      expect(notes.every((n) => n.wave !== "sawtooth")).toBe(true);
      expect(Math.max(...notes.map((n) => n.at + n.duration)) * 1000).toBeLessThanOrEqual(CLASS_FX_MS);
    }
    expect(new Set(all.map((n) => JSON.stringify(n))).size).toBe(all.length);
  });

  it("use no red (red is the boss's one job)", () => {
    for (const c of [...Object.values(CLASS_PULSE), ...Object.values(CLASS_TINT)]) {
      const [r, g] = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16)];
      expect(r - g).toBeLessThan(80);
    }
  });
});
