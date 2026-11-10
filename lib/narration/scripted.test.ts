import { describe, it, expect } from "vitest";
import { createScriptedProvider, scriptedEpilogue, EVENT_VARIANTS, FOODIE, VARIANTS, ATMOSPHERE_VARIANTS, NEXT_VARIANTS, BOSS_ENTER_VARIANTS, BOSS_JOIN_VARIANTS, BOSS_MISS_VARIANTS, BUZZ_OUT_VARIANTS, BUZZ_AGAIN_VARIANTS, DISH_VARIANTS, BOSS_DISH_VARIANTS, BOSS_EMPTIED_VARIANTS, BOSS_EXHAUSTED_VARIANTS, CLASS_VARIANTS, ROLL_VARIANTS, NEXT_FORK_VARIANTS, FORK_MONSTER_VARIANTS, FORK_TIMEOUT_VARIANTS } from "./scripted";
import type { NarrationEvent } from "./events";
import { MAX_MODEL_LINE } from "./runner";

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
  it("has at least 4 variants for every event type", () => {
    for (const e of samples) {
      expect(VARIANTS[e.type].length).toBeGreaterThanOrEqual(4);
    }
  });

  it("the per-turn correct / retry / flee pools hold 10 distinct lines, each at most 22 characters with a 4-character team and 3-character monster", () => {
    for (const type of ["correct", "retry", "flee"] as const) {
      expect(new Set(VARIANTS[type]).size).toBe(10);
      for (const t of VARIANTS[type]) expect([...t.replace(/\{team\}/g, "冒險小隊").replace(/\{monster\}/g, "史萊姆").replace(/\{points\}/g, "3")].length).toBeLessThanOrEqual(MAX_MODEL_LINE);
    }
  });

  it("a wrong boss answer gets a new-question line, never an answer-again one (D2=B)", () => {
    const p = createScriptedProvider(lcg(2));
    const boss = new Set(BOSS_MISS_VARIANTS.map((t) => t.replace("{team}", team).replace("{monster}", monster)));
    for (let i = 0; i < 20; i++) expect(boss.has(p.line({ type: "retry", team, monster, boss: true }))).toBe(true);
    expect(BOSS_MISS_VARIANTS.length).toBeGreaterThanOrEqual(4);
  });

  it("a wrong buzz says the team is out, never that it may answer again (boss-buzzer.md)", () => {
    const p = createScriptedProvider(lcg(3));
    const out = new Set(BUZZ_OUT_VARIANTS.map((t) => t.replace("{team}", team).replace("{monster}", monster)));
    for (let i = 0; i < 20; i++) {
      const line = p.line({ type: "retry", team, monster, buzzOut: true });
      expect(out.has(line)).toBe(true);
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it("everyone missing the song says the same one comes again, never a new question (boss-music-buzzer.md M1)", () => {
    const p = createScriptedProvider(lcg(4));
    const again = new Set(BUZZ_AGAIN_VARIANTS.map((t) => t.replace("{team}", team).replace("{monster}", monster)));
    for (let i = 0; i < 20; i++) {
      const line = p.line({ type: "retry", team, monster, buzzOut: true, buzzAgain: true });
      expect(again.has(line)).toBe(true);
      expect(line.length).toBeLessThanOrEqual(40);
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

describe("scripted: an opened event room", () => {
  const events: NarrationEvent[] = [
    { type: "event-room", team, scene: "chest", outcome: "feast", satiety: 23, dish: "烤史萊姆凍" },
    { type: "event-room", team, scene: "chest", outcome: "rotten", satiety: -10 },
    { type: "event-room", team, scene: "chest", outcome: "rotten", satiety: 0 },
    { type: "event-room", team, scene: "spring", outcome: "spring", satiety: 10 },
    { type: "event-room", team, scene: "spring", outcome: "spring", satiety: 0, abilityUse: true },
    { type: "event-room", team, scene: "idol", outcome: "curse", satiety: 0 },
    { type: "event-room", team, scene: "fortune", outcome: "bad", satiety: 0 },
  ];

  it("names the team and the dish, fills every brace, and never says −0", () => {
    const p = createScriptedProvider(lcg(8));
    for (const e of events) {
      for (let i = 0; i < 10; i++) {
        const line = p.line(e);
        expect(line).toContain(team);
        expect(line).not.toMatch(/[{}]|[−-]0/);
        expect(line.length).toBeLessThanOrEqual(40);
        if (e.type === "event-room" && e.dish) expect(line).toContain(e.dish);
        expect(p.atmosphereLine(e)).not.toMatch(/[{}]/);
      }
    }
    expect(ATMOSPHERE_VARIANTS["event-room"].length).toBeGreaterThanOrEqual(4);
  });
});

describe("atmosphereLine", () => {
  it("has at least 4 variants for every event type", () => {
    for (const e of samples) {
      expect(ATMOSPHERE_VARIANTS[e.type].length).toBeGreaterThanOrEqual(4);
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

  // Value: protects=a scripted hour repeats each atmosphere and room transition about four times, not ten (TODOS 旁白語氣是否耐聽);
  // fails_when=pick() forgets the bag and repeats a line before the pool runs out, or a pool shrinks back
  it("plays every line of a pool once before any repeats, and never the same line twice across a reshuffle", () => {
    for (const seed of [1, 2, 3]) {
      const p = createScriptedProvider(lcg(seed));
      const n = ATMOSPHERE_VARIANTS.correct.length;
      const said = Array.from({ length: n * 3 }, () => p.atmosphereLine(samples[1]));
      for (let r = 0; r < 3; r++) expect(new Set(said.slice(r * n, (r + 1) * n)).size).toBe(n);
      said.slice(1).forEach((line, i) => expect(line).not.toBe(said[i]));
      const nextRoom = { team, monster, boss: false };
      expect(new Set(Array.from({ length: NEXT_VARIANTS.room.length }, () => p.nextLine(nextRoom))).size).toBe(NEXT_VARIANTS.room.length);
    }
  });

  it("keeps a class team's own lines in the bag when it shares a key with teams of no class, and never repeats in a row", () => {
    const p = createScriptedProvider(lcg(5));
    const base = { type: "correct" as const, team, monster, points: 12 };
    const fill = (v: string) => v.replace("{team}", team).replace("{monster}", monster).replace("{points}", "12");
    const plain = VARIANTS.correct.map(fill);
    const warrior = CLASS_VARIANTS.warrior.correct.map(fill);
    const said: string[] = [];
    for (let i = 0; i < 60; i++) said.push(i % 3 === 0 ? p.line({ ...base, classId: "warrior" }) : p.line(base));
    said.forEach((line, i) => expect(i % 3 === 0 ? [...plain, ...warrior] : plain).toContain(line));
    said.slice(1).forEach((line, i) => expect(line).not.toBe(said[i]));
    expect(said.filter((l) => warrior.includes(l)).length).toBeGreaterThan(0);
  });

  it("has ten atmosphere lines per event (boss-phase's say its rule), ten room transitions, at most one 「！」 and no 喵", () => {
    for (const [type, pool] of Object.entries(ATMOSPHERE_VARIANTS)) if (type !== "boss-phase") expect(pool, type).toHaveLength(10);
    expect(NEXT_VARIANTS.room).toHaveLength(10);
    for (const line of [...Object.values(ATMOSPHERE_VARIANTS).flat(), ...NEXT_VARIANTS.room]) {
      expect(line.split("！").length - 1, line).toBeLessThanOrEqual(1);
      expect(line).not.toMatch(/喵/);
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

  it("has at least 4 variants for a room and for the boss room", () => {
    expect(NEXT_VARIANTS.room.length).toBeGreaterThanOrEqual(4);
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

  // Value: protects=a fork's lines never give away a door (branch-fork.md); fails_when=a line names a scene or outcome.
  it("a fork turn's line names the team and two doors, never a monster or anything behind a door; ⚔️'s lines fit 22 characters", () => {
    const p = createScriptedProvider(lcg(8));
    for (let i = 0; i < 10; i++) {
      const line = p.nextLine({ team: "炸雞小隊", monster: "", boss: false, fork: true });
      expect(NEXT_FORK_VARIANTS.map((v) => v.replaceAll("{team}", "炸雞小隊"))).toContain(line);
      expect(line).not.toMatch(/寶箱|泉水|雕像|精靈|占卜|詛咒|祝福|[{}]/);
      expect(p.forkLine(i % 2 === 0, "炸雞小隊", "史萊姆")).toMatch(i % 2 === 0 ? /炸雞小隊.*⚔️|⚔️.*炸雞小隊/ : /史萊姆/);
    }
    for (const v of [...NEXT_FORK_VARIANTS, ...FORK_MONSTER_VARIANTS, ...FORK_TIMEOUT_VARIANTS]) expect(v.replaceAll("{team}", "炸雞小隊").replaceAll("{monster}", "史萊姆").length).toBeLessThanOrEqual(22);
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
  it("announces the entrance", () => {
    const p = createScriptedProvider(lcg(3));
    const event: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 3, entersBoss: {} };
    for (let i = 0; i < 8; i++) {
      const line = p.line(event);
      expect(BOSS_ENTER_VARIANTS.some((v) => line === v.replace("{team}", "紅隊").replace("{monster}", "史萊姆").replace("{points}", "3"))).toBe(true);
    }
  });
});

describe("scripted: a later team joining the boss room", () => {
  it("uses the join lines, never the door-opening ones", () => {
    const p = createScriptedProvider(lcg(5));
    const fill = (v: string) => v.replace("{team}", "藍隊").replace("{monster}", "史萊姆").replace("{points}", "3");
    for (let i = 0; i < 8; i++) {
      const line = p.line({ type: "correct", team: "藍隊", monster: "史萊姆", points: 3, entersBoss: { order: 2 } });
      expect(BOSS_JOIN_VARIANTS.map(fill)).toContain(line);
      expect(line).not.toContain("推開");
    }
    expect(BOSS_JOIN_VARIANTS.filter((v) => v.includes("推開"))).toEqual([]);
  });

  it("a later team entering mid-phase hears the phase, never the door being pushed open", () => {
    const p = createScriptedProvider(lcg(9));
    for (let i = 0; i < 8; i++) {
      const line = p.line({ type: "correct", team: "藍隊", monster: "史萊姆", points: 3, entersBoss: { phase: "主題曲之謎", order: 2 } });
      expect(line).toContain("主題曲之謎");
      expect(line).not.toContain("推開");
    }
  });

  it("the next-team boss lines never mention the door, which may have been open for a while", () => {
    expect(NEXT_VARIANTS.boss.filter((v) => v.includes("門"))).toEqual([]);
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
    const line = p.line({ type: "correct", team, monster, points: 30, entersBoss: { phase: "主題曲之謎" } });
    expect(line).toContain("主題曲之謎");
  });
});

// Regression: the last answer of a phase out of questions said "try again" or counted hearts, right before the card
// Found by /review on 2026-10-28
describe("a boss phase out of questions", () => {
  const p = createScriptedProvider(lcg(3));
  it("never says try again, never counts hearts", () => {
    for (let i = 0; i < 9; i++) {
      for (const line of [p.line({ type: "retry", team, monster, exhausted: true }), p.line({ type: "boss-hit", team, bossHp: 2, bossMaxHp: 3, exhausted: true })]) {
        expect(line).not.toMatch(/再試|重答|顆心|2\/3|倒下了|擊倒/);
        expect(line).not.toContain("{");
      }
    }
  });
});

const fills = (pool: string[], v: Record<string, string | number>) => pool.map((t) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k])));

describe("monster dishes (docs/designs/monster-cuisine.md)", () => {
  it("a cooked monster's line comes from the dish lines, never naming a dish (cooking I1)", async () => {
    const p = createScriptedProvider(lcg(3));
    const room = new Set(fills(DISH_VARIANTS, { team, monster, points: 10 }));
    for (let i = 0; i < DISH_VARIANTS.length; i++) expect(room.has(await p.narrate({ type: "correct", team, monster, points: 10, cooked: true }))).toBe(true);
    const boss = new Set(fills(BOSS_DISH_VARIANTS, { team, monster, bonus: 18 }));
    for (let i = 0; i < BOSS_DISH_VARIANTS.length; i++) expect(boss.has(await p.narrate({ type: "boss-kill", team, monster, bonus: 18, cooked: true }))).toBe(true);
    for (const l of [...DISH_VARIANTS, ...BOSS_DISH_VARIANTS]) expect(l).not.toContain("{dish}");
  });

  it("the epilogue counts 飽足感 and serves the champions' dishes when there are any", () => {
    const feast = scriptedEpilogue([{ name: "綠隊", score: 27, dishes: ["湯", "湯", "烤肉"] }, { name: "紅隊", score: 21 }], ["綠隊"], lcg(1));
    expect(feast).toContain("飽足感");
    expect(feast).toContain("綠隊吃了湯、烤肉，最飽。");
    const plain = scriptedEpilogue([{ name: "綠隊", score: 27 }], ["綠隊"], lcg(1));
    expect(plain).not.toContain("飽足感");
  });
});

describe("class attack lines (TODOS: 旁白的武器和招式要配合職業)", () => {
  it("a team with a class hears its own weapons, never another class's", () => {
    const v = { team, monster, points: 12, bossHp: 4 };
    for (const cls of Object.keys(CLASS_VARIANTS) as (keyof typeof CLASS_VARIANTS)[]) {
      const p = createScriptedProvider(lcg(5));
      const own = new Set([...fills(CLASS_VARIANTS[cls].correct, v), ...fills(CLASS_VARIANTS[cls]["boss-hit"], v)]);
      const others = new Set(Object.entries(CLASS_VARIANTS).filter(([id]) => id !== cls).flatMap(([, c]) => [...fills(c.correct, v), ...fills(c["boss-hit"], v)]));
      const heard = new Set<string>();
      for (let i = 0; i < 60; i++) {
        for (const e of [{ type: "correct", team, monster, points: 12, classId: cls }, { type: "boss-hit", team, bossHp: 4, bossMaxHp: 5, classId: cls }] as const) {
          const line = p.line(e);
          expect(others.has(line)).toBe(false);
          expect(line).not.toMatch(/[{}]/);
          expect(line.length).toBeLessThanOrEqual(40);
          heard.add(line);
        }
      }
      expect([...own].some((l) => heard.has(l))).toBe(true);
    }
  });

  // Value: protects=an ordinary hit never sounds like a class ability fired; fails_when=a class line says 偷襲 or 祈禱 (on-screen ability names); why_new=no test checks wording against ability names; seam=none; no_claim=the AI narrator's wording
  it("class lines never name the 偷襲 or 祈禱 abilities", () => {
    const all = Object.values(CLASS_VARIANTS).flatMap((c) => [...c.correct, ...c["boss-hit"]]);
    for (const l of all) expect(l).not.toMatch(/偷襲|祈禱/);
  });

  it("class lines never replace the boss entrance or the dish line", () => {
    const p = createScriptedProvider(lcg(8));
    const enter = new Set(fills(BOSS_ENTER_VARIANTS, { team, monster, points: 12 }));
    for (let i = 0; i < 20; i++) {
      expect(enter.has(p.line({ type: "correct", team, monster, points: 12, classId: "mage", entersBoss: {} }))).toBe(true);
      expect(fills(DISH_VARIANTS, { team, monster, points: 12 })).toContain(p.line({ type: "correct", team, monster, points: 12, classId: "warrior", cooked: true }));
      // Value: protects=class lines never replace the emptied-bar or exhausted-phase line; fails_when=the class branch moves above those checks; why_new=those tests use no classId; seam=none; no_claim=none beyond protects
      const emptied = p.line({ type: "boss-hit", team, bossHp: 0, bossMaxHp: 3, classId: "thief" });
      expect(fills(BOSS_EMPTIED_VARIANTS, { team, monster, bossHp: 0 })).toContain(emptied);
      const exhausted = p.line({ type: "boss-hit", team, bossHp: 2, bossMaxHp: 3, classId: "cleric", exhausted: true });
      expect(fills(BOSS_EXHAUSTED_VARIANTS, { team, monster, bossHp: 2 })).toContain(exhausted);
    }
  });

  it("a team with no class never hears a class line", () => {
    const p = createScriptedProvider(lcg(6));
    const v = { team, monster, points: 12, bossHp: 4 };
    const all = new Set(Object.values(CLASS_VARIANTS).flatMap((c) => [...fills(c.correct, v), ...fills(c["boss-hit"], v)]));
    for (let i = 0; i < 40; i++) {
      expect(all.has(p.line({ type: "correct", team, monster, points: 12 }))).toBe(false);
      expect(all.has(p.line({ type: "boss-hit", team, bossHp: 4, bossMaxHp: 5 }))).toBe(false);
    }
  });

  it("never plays the same line twice in a row when a class team and a team with no class take turns", () => {
    const p = createScriptedProvider(lcg(7));
    let prev = "";
    for (let i = 0; i < 200; i++) {
      const line = p.line({ type: "correct", team, monster, points: 12, ...(i % 2 ? { classId: "warrior" as const } : {}) });
      expect(line).not.toBe(prev);
      prev = line;
    }
  });
});

// Value: protects=a 20 or a 1 swaps the result line, not adds one (dnd design E3, R1); fails_when=the roll is ignored,
// or a fumble line forgets the hit still landed
describe("scripted: the crit die", () => {
  // Value: protects=a persuasion check's 20 or 1 (dnd design R7, R8) gets its own line, not the attack's 大成功 / 手滑
  it("a check's 20 gets a 說服 win line and its 1 a line that says only half was paid, for room and boss hits", () => {
    const p = createScriptedProvider(() => 0);
    const correct = { type: "correct", team: "紅隊", monster: "史萊姆", points: 10 } as const;
    const won = p.line({ ...correct, roll: { kind: "check", value: 20 } });
    expect(ROLL_VARIANTS.persuaded.correct.map((t) => t.replace("{team}", "紅隊").replace("{monster}", "史萊姆").replace("{points}", "10"))).toContain(won);
    expect(won).not.toContain("大成功");
    const blunder = p.line({ ...correct, points: 5, roll: { kind: "check", value: 1 } });
    expect(blunder).toContain("一半");
    expect(blunder).not.toContain("手滑");
    expect(p.line({ type: "boss-hit", team: "紅隊", bossHp: 2, bossMaxHp: 3, roll: { kind: "check", value: 1 } })).toContain("2 顆心");
    for (const kind of ["persuaded", "blunder"] as const) for (const lines of Object.values(ROLL_VARIANTS[kind])) expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  // Value: protects=a warrior's d20 is said once (TODOS: 旁白念出戰士擲到幾點); fails_when=a 20 line also gets the prefix
  it("a warrior's roll leads the line with its number and hit or miss, except a crit die's 大成功 or 手滑 line, which already says it", () => {
    const p = createScriptedProvider(() => 0);
    expect(p.line({ type: "retry", team: "紅隊", monster: "史萊姆", warriorRoll: 3 })).toMatch(/^戰士擲出 3 點，沒打中。.+/);
    expect(p.line({ type: "boss-hit", team: "紅隊", bossHp: 2, bossMaxHp: 3, warriorRoll: 9 })).toMatch(/^戰士擲出 9 點，命中！.*2 顆心/);
    expect(p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 15, warriorRoll: 20, roll: { kind: "crit", value: 20 } })).not.toContain("戰士擲出");
    // The boss kill has no 大成功 line, and a check's 1 is the persuasion die (its 答對 line would be wrong): both say the warrior's number.
    expect(p.line({ type: "boss-kill", team: "紅隊", monster: "魔王", bonus: 40, warriorRoll: 20, roll: { kind: "crit", value: 20 } })).toMatch(/^戰士擲出 20 點，命中！/);
    expect(p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 5, warriorRoll: 9, roll: { kind: "check", value: 1 } })).toMatch(/^戰士擲出 9 點，命中！(?!.*說服)/);
  });

  it("a 20 gets a 大成功 line and a 1 a 手滑 line that still hits, for room and boss hits", () => {
    const p = createScriptedProvider(() => 0);
    const correct = { type: "correct", team: "紅隊", monster: "史萊姆", points: 15 } as const;
    expect(p.line({ ...correct, roll: { kind: "crit", value: 20 } })).toMatch(/20.*\+15/);
    expect(ROLL_VARIANTS.crit.correct).toContain(p.line({ ...correct, roll: { kind: "crit", value: 20 } }).replace("紅隊", "{team}").replace("史萊姆", "{monster}").replace("15", "{points}"));
    const fumble = p.line({ ...correct, points: 10, roll: { kind: "crit", value: 1 } });
    expect(fumble).toMatch(/擲出 1|停在 1/);
    expect(fumble).toMatch(/打中|倒了/);
    const boss = p.line({ type: "boss-hit", team: "紅隊", bossHp: 1, bossMaxHp: 3, roll: { kind: "crit", value: 20 } });
    expect(boss).toContain("1 顆心");
    for (const kind of ["crit", "fumble"] as const) for (const lines of Object.values(ROLL_VARIANTS[kind])) expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  // Value: protects=every crit/fumble line fills from its event (dnd design E3); fails_when=a template names a field the
  // event lacks ({bossHP}, {points} on a boss hit), so the TV shows a raw brace; seam=none; no_claim=wording quality
  it("every crit and fumble line uses only the placeholders its event fills", () => {
    const allowed = { correct: ["{team}", "{monster}", "{points}"], "boss-hit": ["{team}", "{bossHp}"] } as const;
    for (const kind of ["crit", "fumble"] as const)
      for (const type of ["correct", "boss-hit"] as const)
        for (const t of ROLL_VARIANTS[kind][type]) for (const ph of t.match(/\{\w+\}/g) ?? []) expect(allowed[type]).toContain(ph);
    const p = createScriptedProvider(() => 0);
    const fumbleBoss = p.line({ type: "boss-hit", team: "紅隊", bossHp: 2, bossMaxHp: 3, roll: { kind: "crit", value: 1 } });
    expect(fumbleBoss).toContain("2 顆心");
    expect(fumbleBoss).not.toMatch(/[{}]/);
  });

  // Value: protects=a 20 or 1 on a cooked room hit says the roll, not the dish (user decision, 2026-11-06: rarer beat wins);
  // fails_when=the dish branch moves above the roll branch; no_claim=the TV's dish reveal (it still shows)
  it("a 20 or 1 on a cooked monster says the roll line, not the dish line", () => {
    const p = createScriptedProvider(() => 0);
    const line = p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 15, cooked: true, roll: { kind: "crit", value: 20 } });
    expect(fills(DISH_VARIANTS, { team: "紅隊", monster: "史萊姆", points: 15 })).not.toContain(line);
    expect(line).toMatch(/20/);
  });

  it("a team entering the boss room keeps its boss-door line, even on a 20", () => {
    const p = createScriptedProvider(() => 0);
    const line = p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 15, entersBoss: {}, roll: { kind: "crit", value: 20 } });
    expect(BOSS_ENTER_VARIANTS.map((t) => t.replace("{team}", "紅隊").replace("{monster}", "史萊姆").replace("{points}", "15"))).toContain(line);
  });
});

// Value: protects=with AI narration off the podium segments are scripted in the order the screen reads them: an empty
// title per untitled team (the 🛡️ fallback, podium-titles.md eng 2), places lowest first, then the story (podium-reveal.md
// D3; eng D21); fails_when=the order flips, a call is missing, a title gets text, or the story moves off the last
// segment; why_new=new segments; seam=none; no_claim=none beyond protects
describe("epilogueLines", () => {
  const p = createScriptedProvider(() => 0);
  const ranking = [{ name: "紅隊", score: 30 }, { name: "藍隊", score: 20 }, { name: "綠隊", score: 10 }];

  it("leaves each title empty, calls third, second, first, then tells the story", () => {
    const facts = { turns: 3, dishes: 0, flees: 0, events: [], natural20s: 0, boss: false };
    const lines = p.epilogueLines({
      type: "epilogue",
      ranking,
      winners: ["紅隊"],
      titles: [{ team: "藍隊", facts }, { team: "綠隊", facts }],
      calls: [{ place: 3, team: "綠隊" }, { place: 2, team: "藍隊" }, { place: 1, team: "紅隊" }],
    });
    expect(lines.slice(0, 5)).toEqual(["", "", "第三名是……綠隊！", "第二名是……藍隊！", "第一名是……紅隊！"]);
    expect(lines[5]).toBe(scriptedEpilogue(ranking, ["紅隊"], () => 0));
  });

  it("one team gets its call; no calls is the story alone; any other event has none", () => {
    expect(p.epilogueLines({ type: "epilogue", ranking: [ranking[0]], winners: ["紅隊"], calls: [{ place: 1, team: "紅隊" }] })[0]).toBe("第一名是……紅隊！");
    expect(p.epilogueLines({ type: "epilogue", ranking, winners: ["紅隊"] })).toHaveLength(1);
    expect(p.epilogueLines({ type: "retry", team: "紅隊", monster: "史萊姆" })).toEqual([]);
  });
});

// Value: protects=the food talk stays a seasoning (TODOS 地城料理風格 3): short lines, about a third of a pool, never two
// in a row, and no pool smaller than before; fails_when=a food line outgrows 22 characters, a pool turns mostly food,
// pick() stops skipping food after food, or a part line plays without a part.
describe("美食節目／生物學家口吻 (FOODIE)", () => {
  const food = new Set(Object.values(FOODIE).flat());
  const sized = (t: string) => [...t.replace(/\{team\}/g, "冒險小隊").replace(/\{monster\}/g, "史萊姆").replace(/\{part\}/g, "霧狀身體").replace(/\{points\}|\{bonus\}/g, "3")].length;

  it("every food line is distinct, has at most one 「！」, and the per-turn ones fit 22 characters", () => {
    expect(food.size).toBe(Object.values(FOODIE).flat().length);
    for (const l of food) expect(l.split("！").length - 1, l).toBeLessThanOrEqual(1);
    for (const l of [...DISH_VARIANTS, ...FOODIE.dishPart, ...FOODIE.nextRoom, ...FOODIE.nextBoss, ...FOODIE.atmBossKill]) expect(sized(l), l).toBeLessThanOrEqual(MAX_MODEL_LINE);
    for (const l of [...BOSS_DISH_VARIANTS, ...BOSS_ENTER_VARIANTS]) expect(sized(l), l).toBeLessThanOrEqual(40);
  });

  it("no pool is smaller than before, and food is at most 40% of each", () => {
    const pools: [string[], number][] = [
      [DISH_VARIANTS, 3],
      [[...FOODIE.dishPart, ...DISH_VARIANTS], 3],
      [BOSS_DISH_VARIANTS, 3],
      [BOSS_ENTER_VARIANTS, 4],
      [NEXT_VARIANTS.room, 10],
      [NEXT_VARIANTS.boss, 4],
      [ATMOSPHERE_VARIANTS["boss-kill"], 10],
    ];
    for (const [pool, floor] of pools) {
      expect(new Set(pool).size, pool[0]).toBe(pool.length);
      expect(pool.length, pool[0]).toBeGreaterThanOrEqual(floor);
      const share = pool.filter((l) => food.has(l)).length / pool.length;
      expect(share, pool[0]).toBeGreaterThan(0);
      expect(share, pool[0]).toBeLessThanOrEqual(0.4);
    }
    expect(EVENT_VARIANTS.feast).toEqual(expect.arrayContaining(FOODIE.feast));
    expect(EVENT_VARIANTS.feast.length).toBeGreaterThanOrEqual(4);
    // A wrong answer, a flee and a boss hit never talk about food.
    for (const l of [...VARIANTS.retry, ...VARIANTS.flee, ...VARIANTS["boss-hit"], ...BOSS_MISS_VARIANTS, ...ATMOSPHERE_VARIANTS.retry, ...ATMOSPHERE_VARIANTS.flee, ...ATMOSPHERE_VARIANTS.correct, ...ATMOSPHERE_VARIANTS["boss-hit"], ...Object.values(ROLL_VARIANTS).flatMap((r) => [...r.correct, ...r["boss-hit"]])]) expect(food.has(l), l).toBe(false);
  });

  const said1 = (t: string) => t.replace("{team}", "紅隊").replace("{monster}", "史萊姆").replace("{part}", "外膜").replace("{points}", "3").replace("{bonus}", "3").replace("{dish}", "燉菜");
  const isFood = (line: string) => [...food, ...EVENT_VARIANTS.feast].some((t) => said1(t) === line);

  it("the boss kill's result, atmosphere and the boss handoff never say two food lines in a row; a chest dish is followed by a plain handoff", () => {
    const p = createScriptedProvider(lcg(6));
    const kill: NarrationEvent = { type: "boss-kill", team: "紅隊", monster: "史萊姆", bonus: 3, cooked: true };
    const said: string[] = [];
    for (let i = 0; i < 60; i++) said.push(p.nextLine({ team: "紅隊", monster: "史萊姆", boss: true }), p.line(kill), p.atmosphereLine(kill));
    for (let i = 1; i < said.length; i++) expect(isFood(said[i]) && isFood(said[i - 1]), `${said[i - 1]} / ${said[i]}`).toBe(false);
    expect(said.filter(isFood).length).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) {
      expect(isFood(p.line({ type: "event-room", team: "紅隊", scene: "chest", outcome: "feast", satiety: 3, dish: "燉菜" }))).toBe(true);
      expect(isFood(p.nextLine({ team: "紅隊", monster: "史萊姆", boss: false }))).toBe(false);
      expect(p.line({ type: "event-room", team: "紅隊", scene: "chest", outcome: "rotten", satiety: i % 2 ? -3 : 0 })).toMatch(/黑暗料理|紫煙/);
      expect(isFood(p.nextLine({ team: "紅隊", monster: "史萊姆", boss: false }))).toBe(false);
    }
  });

  it("a chest dish right after a food handoff is still said: its pool has no plain line", () => {
    const p = createScriptedProvider(lcg(9));
    let after = 0;
    for (let i = 0; i < 200; i++) {
      if (!isFood(p.nextLine({ team: "紅隊", monster: "史萊姆", boss: false }))) continue;
      after++;
      expect(p.line({ type: "event-room", team: "紅隊", scene: "chest", outcome: "feast", satiety: 3, dish: "燉菜" })).toContain("燉菜");
    }
    expect(after).toBeGreaterThan(0);
  });

  it("never says two food lines in a row across the result and the handoff, and still plays every line", () => {
    const p = createScriptedProvider(lcg(4));
    const said: string[] = [];
    for (let i = 0; i < 130; i++) said.push(p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 3, cooked: true, part: "外膜" }), p.nextLine({ team: "紅隊", monster: "史萊姆", boss: false }));
    for (let i = 1; i < said.length; i++) expect(isFood(said[i]) && isFood(said[i - 1]), `${said[i - 1]} / ${said[i]}`).toBe(false);
    expect(new Set(said).size).toBe(DISH_VARIANTS.length + FOODIE.dishPart.length + NEXT_VARIANTS.room.length);
  });

  it("names the edible part only when the event has one", () => {
    const p = createScriptedProvider(lcg(2));
    for (let i = 0; i < 40; i++) expect(p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 3, cooked: true })).not.toMatch(/[{}]|undefined/);
    const withPart = Array.from({ length: 40 }, () => p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 3, cooked: true, part: "外膜" }));
    expect(withPart.some((l) => l.includes("外膜"))).toBe(true);
    for (const l of withPart) expect(l).not.toMatch(/[{}]/);
    // 「牠的整隻」 and a 6-character part do not read well in these lines: the plain pool only.
    for (const part of ["整隻", "寶箱裡的東西", "根"]) for (let i = 0; i < 40; i++) expect(p.line({ type: "correct", team: "紅隊", monster: "史萊姆", points: 3, cooked: true, part })).not.toContain(part);
  });
});
