import { describe, it, expect } from "vitest";
import { createScriptedProvider, scriptedEpilogue, VARIANTS, NEXT_VARIANTS } from "./scripted";
import type { NarrationEvent } from "./events";

const team = "六個字的隊伍";
const monster = "守門史萊姆王";
const samples: Exclude<NarrationEvent, { type: "epilogue" }>[] = [
  { type: "start", teams: ["a", "b"] },
  { type: "correct", team, monster, points: 12 },
  { type: "retry", team, monster },
  { type: "flee", team, monster },
  { type: "boss-hit", team, bossHp: 4, bossMaxHp: 5 },
  { type: "boss-kill", team, monster, bonus: 18 },
];

/** Small seeded generator so "random" tests are repeatable. */
function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("scripted lines", () => {
  it("has 4-5 variants for every event type", () => {
    for (const e of samples) {
      expect(VARIANTS[e.type].length).toBeGreaterThanOrEqual(4);
      expect(VARIANTS[e.type].length).toBeLessThanOrEqual(5);
    }
  });

  it("fills in the team, monster and numbers and leaves no template braces", async () => {
    const p = createScriptedProvider(lcg(1));
    for (const e of samples) {
      for (let i = 0; i < 20; i++) {
        const line = p.line(e);
        expect(line).not.toMatch(/[{}]/);
        expect(line.length).toBeLessThanOrEqual(40); // the narration ceiling (D19)
      }
    }
  });

  it("mentions the team on events that are about a team", () => {
    const p = createScriptedProvider(lcg(2));
    for (const e of samples.filter((s) => s.type !== "start" && s.type !== "boss-hit")) {
      for (let i = 0; i < 10; i++) expect(p.line(e)).toContain(team);
    }
  });

  it("never repeats the same variant twice in a row for one event type", () => {
    const p = createScriptedProvider(lcg(3));
    const e = samples[1];
    let prev = "";
    for (let i = 0; i < 200; i++) {
      const line = p.line(e);
      expect(line).not.toBe(prev);
      prev = line;
    }
  });

  it("is deterministic for the same rng seed", () => {
    const run = (seed: number) => {
      const p = createScriptedProvider(lcg(seed));
      return samples.map((e) => p.line(e));
    };
    expect(run(7)).toEqual(run(7));
  });

  it("narrate() resolves to the same kind of line", async () => {
    const p = createScriptedProvider(lcg(4));
    expect(p.name).toBe("scripted");
    await expect(p.narrate(samples[2])).resolves.toContain(team);
  });
});

describe("scriptedEpilogue", () => {
  it("names the winner and the score from the facts, and only the top three teams", () => {
    const text = scriptedEpilogue(
      [
        { name: "綠隊", score: 27 },
        { name: "紅隊", score: 21 },
        { name: "藍隊", score: 15 },
        { name: "黃隊", score: 3 },
      ],
      ["綠隊"],
      lcg(1),
    );
    expect(text).toContain("綠隊");
    expect(text).toContain("27");
    expect(text).toContain("紅隊");
    expect(text).not.toContain("黃隊");
  });

  it("handles a tie for first", () => {
    const text = scriptedEpilogue(
      [
        { name: "紅隊", score: 20 },
        { name: "藍隊", score: 20 },
      ],
      ["紅隊", "藍隊"],
      lcg(1),
    );
    expect(text).toContain("紅隊");
    expect(text).toContain("藍隊");
  });
});

describe("next-team prompt (the second line)", () => {
  const next = { team: "六個字的隊伍", monster: "守門史萊姆王", boss: false };

  it("has 4-5 variants for a room and for the boss room", () => {
    expect(NEXT_VARIANTS.room.length).toBeGreaterThanOrEqual(4);
    expect(NEXT_VARIANTS.room.length).toBeLessThanOrEqual(5);
    expect(NEXT_VARIANTS.boss.length).toBeGreaterThanOrEqual(4);
  });

  it("names the team on turn and the monster it faces, with no braces left", () => {
    const p = createScriptedProvider(lcg(5));
    for (let i = 0; i < 30; i++) {
      const line = p.nextLine(next);
      expect(line).toContain(next.team);
      expect(line).toContain(next.monster);
      expect(line).not.toMatch(/[{}]/);
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it("uses the boss variants in the boss room", () => {
    const p = createScriptedProvider(lcg(6));
    const line = p.nextLine({ ...next, boss: true });
    expect(NEXT_VARIANTS.boss.some((v) => v.replace("{team}", next.team).replace("{monster}", next.monster) === line)).toBe(true);
  });

  it("never repeats the same prompt twice in a row", () => {
    const p = createScriptedProvider(lcg(7));
    let prev = "";
    for (let i = 0; i < 100; i++) {
      const line = p.nextLine(next);
      expect(line).not.toBe(prev);
      prev = line;
    }
  });
});
