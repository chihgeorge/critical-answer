import { describe, it, expect } from "vitest";
import { createScriptedProvider, scriptedEpilogue, VARIANTS, ATMOSPHERE_VARIANTS, NEXT_VARIANTS, BOSS_ENTER_VARIANTS, BOSS_MISS_VARIANTS } from "./scripted";
import type { NarrationEvent } from "./events";

const team = "六個字的隊伍";
const monster = "守門史萊姆王";
const samples: Exclude<NarrationEvent, { type: "epilogue" }>[] = [
  { type: "start", teams: ["a", "b"] },
  { type: "correct", team, monster, points: 12 },
  { type: "retry", team, monster },
  { type: "retry", team, monster, boss: true },
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

  it("a wrong boss answer gets a new-question line, never an answer-again one (D2=B)", () => {
    const p = createScriptedProvider(lcg(2));
    const boss = new Set(BOSS_MISS_VARIANTS.map((t) => t.replace("{team}", team).replace("{monster}", monster)));
    for (let i = 0; i < 20; i++) expect(boss.has(p.line({ type: "retry", team, monster, boss: true }))).toBe(true);
    expect(BOSS_MISS_VARIANTS.length).toBeGreaterThanOrEqual(4);
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

describe("atmosphereLine", () => {
  it("has 4-5 variants for every event type", () => {
    for (const e of samples) {
      expect(ATMOSPHERE_VARIANTS[e.type].length).toBeGreaterThanOrEqual(4);
      expect(ATMOSPHERE_VARIANTS[e.type].length).toBeLessThanOrEqual(5);
    }
  });

  it("fills in the team, monster and numbers and leaves no template braces", () => {
    const p = createScriptedProvider(lcg(5));
    for (const e of samples) {
      for (let i = 0; i < 20; i++) {
        const line = p.atmosphereLine(e);
        expect(line).not.toMatch(/[{}]/);
        expect(line.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it("never repeats the same variant twice in a row for one event type", () => {
    const p = createScriptedProvider(lcg(6));
    const e = samples[1];
    let prev = "";
    for (let i = 0; i < 200; i++) {
      const line = p.atmosphereLine(e);
      expect(line).not.toBe(prev);
      prev = line;
    }
  });

  it("rotates independently from line() — picking one doesn't affect the other's rotation state", () => {
    const p = createScriptedProvider(lcg(7));
    const e = samples[1];
    const lines = new Set<string>();
    const atmospheres = new Set<string>();
    for (let i = 0; i < 20; i++) {
      lines.add(p.line(e));
      atmospheres.add(p.atmosphereLine(e));
    }
    expect(lines.size).toBeGreaterThan(1);
    expect(atmospheres.size).toBeGreaterThan(1);
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

  // Generated by /ship test-coverage audit.
  // Value: protects=team names (player input) appear verbatim in the epilogue; fails_when=fill is
  // swapped back for chained String.replace, which re-scans inserted names and expands $' patterns;
  // why_new=the tests above use plain names only; seam=none
  it("keeps team names verbatim, even ones that look like a placeholder or a replace pattern", () => {
    // One rng value per EPILOGUES template (index = floor(r * 3)), so every template is checked.
    for (const r of [0, 0.4, 0.8]) {
      const text = scriptedEpilogue(
        [
          { name: "{score}隊", score: 27 },
          { name: "$'隊", score: 21 },
        ],
        ["{score}隊"],
        () => r,
      );
      expect(text).toContain("{score}隊");
      expect(text).toContain("27 分");
      expect(text).toContain("$'隊 21 分緊追在後");
    }
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

describe("scripted: entering the boss room", () => {
  it("announces the entrance, and never recites the branch choices (design doc T4)", () => {
    const p = createScriptedProvider(lcg(3));
    const event: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 3, entersBoss: { branches: ["武力"] } };
    for (let i = 0; i < 8; i++) {
      const line = p.line(event);
      expect(BOSS_ENTER_VARIANTS.some((v) => line === v.replace("{team}", "紅隊").replace("{monster}", "史萊姆").replace("{points}", "3"))).toBe(true);
      expect(line).not.toContain("武力");
    }
  });
});

describe("boss phases (docs/designs/boss-phases.md)", () => {
  const p = createScriptedProvider(lcg(7));
  it("an emptied bar without a kill never says the boss fell (D3)", () => {
    for (let i = 0; i < 12; i++) {
      const line = p.line({ type: "boss-hit", team, bossHp: 0, bossMaxHp: 3 });
      expect(line).not.toMatch(/倒下|擊倒|擊敗|勝利|0\/3/);
      expect(line).not.toContain("{");
    }
  });

  it("the phase card names the phase reached and its rule, and nothing after it", () => {
    const e = { type: "boss-phase" as const, monster, phase: 2, name: "主題曲之謎", rule: "聽前奏說出作品名" };
    for (let i = 0; i < 8; i++) expect(p.line(e)).toMatch(/第二階段|主題曲之謎/);
    for (let i = 0; i < 6; i++) expect(p.atmosphereLine(e)).toContain("聽前奏說出作品名");
  });

  it("a team entering the boss room mid-fight hears the phase already under way (D13)", () => {
    const line = p.line({ type: "correct", team, monster, points: 30, entersBoss: { branches: [], phase: "主題曲之謎" } });
    expect(line).toContain("主題曲之謎");
  });
});
