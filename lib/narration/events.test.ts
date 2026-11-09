import { describe, it, expect } from "vitest";
import { epilogueParts, titleFacts, toNarrationEvent } from "./events";
import { createGame, sendToBoss, type AnswerOutcome, type GameState } from "../game-state";

const game: GameState = createGame(
  [{ id: "a", name: "紅隊" }, { id: "b", name: "藍隊" }],
  [{ baseDifficulty: 2, reward: 20 }],
  [[], ["q1", "q2", "q3"], [], [], []],
  ["b1", "b2"],
  { bossThreshold: 15 },
  5,
  () => 0,
);

// Value: protects=the AI's title facts carry the team's own play only, and a title is checked against every other
// team's name except one inside its own (podium-titles.md); fails_when=facts leak satiety or place, an old save throws,
// or 老王 blocks 隔壁老王's own title; why_new=new; seam=none; no_claim=the prompt wording (llm.test.ts)
describe("titles", () => {
  it("titleFacts reads the team's own play, missing counts as 0", () => {
    const t = { ...game.teams[0], turns: 4, flees: 2, dishes: ["湯"], events: ["rotten" as const, "bad" as const], natural20s: 1, bossAt: { round: 2, turns: 3 } };
    expect(titleFacts(t)).toEqual({ turns: 4, dishes: 1, flees: 2, events: ["寶箱：黑暗料理……", "占卜師：凶……"], natural20s: 1, boss: true });
    expect(titleFacts(game.teams[1])).toEqual({ turns: 0, dishes: 0, flees: 0, events: [], natural20s: 0, boss: false });
  });

  it("puts the titles first, each with the other teams it must not name", () => {
    const facts = titleFacts(game.teams[0]);
    const parts = epilogueParts({
      type: "epilogue",
      ranking: [{ name: "紅隊", score: 3 }, { name: "隔壁老王", score: 2 }, { name: "老王", score: 1 }],
      winners: ["紅隊"],
      calls: [{ place: 1, team: "紅隊" }],
      titles: [{ team: "隔壁老王", facts }, { team: "老王", facts }],
    });
    expect(parts.map((p) => p.kind)).toEqual(["title", "title", "place", "story"]);
    expect(parts[0]).toMatchObject({ team: "隔壁老王", others: ["紅隊"] });
    expect(parts[1]).toMatchObject({ team: "老王", others: ["紅隊", "隔壁老王"] });
  });
});

describe("toNarrationEvent", () => {
  it("maps a correct room answer to a 'correct' event with team, monster and points", () => {
    const o: AnswerOutcome = { type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 20, nextRoomIndex: 1, entersBoss: false };
    expect(toNarrationEvent(game, o, "害羞幽靈")).toEqual({ type: "correct", team: "紅隊", monster: "害羞幽靈", points: 20 });
  });

  it("maps retry and flee", () => {
    expect(toNarrationEvent(game, { type: "incorrect-retry", teamId: "b" }, "史萊姆")).toEqual({
      type: "retry",
      team: "藍隊",
      monster: "史萊姆",
    });
    expect(toNarrationEvent(game, { type: "incorrect-flee", teamId: "b", newDifficulty: 1 }, "史萊姆")).toEqual({
      type: "flee",
      team: "藍隊",
      monster: "史萊姆",
    });
  });

  it("marks a retry as a boss miss only when the boss brought a new question (D2=B)", () => {
    expect(toNarrationEvent(game, { type: "incorrect-retry", teamId: "a", newBossQuestion: true }, "小黑龍")).toEqual({ type: "retry", team: "紅隊", monster: "小黑龍", boss: true });
    expect(toNarrationEvent(game, { type: "incorrect-retry", teamId: "a" }, "小黑龍")).toEqual({ type: "retry", team: "紅隊", monster: "小黑龍" });
  });

  it("maps a boss hit that does not kill to 'boss-hit' with the HP left", () => {
    const o: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 3, bossKilled: false, reward: 10 };
    expect(toNarrationEvent(game, o, "小黑龍")).toEqual({ type: "boss-hit", team: "紅隊", bossHp: 3, bossMaxHp: 5 });
  });

  it("maps the killing blow to exactly one 'boss-kill' event carrying the bonus", () => {
    const o: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 0, bossKilled: true, reward: 21, killBonus: 11 };
    expect(toNarrationEvent(game, o, "小黑龍")).toEqual({ type: "boss-kill", team: "紅隊", monster: "小黑龍", bonus: 11 });
  });

  it("does not throw on an unknown team and falls back to a neutral name", () => {
    const o: AnswerOutcome = { type: "incorrect-retry", teamId: "zzz" };
    expect(toNarrationEvent(game, o, "史萊姆")).toMatchObject({ team: "冒險者" });
  });

  it("attaches who is up next, when the game goes on", () => {
    const next = { team: "藍隊", monster: "害羞幽靈", boss: false };
    const o: AnswerOutcome = { type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 20, nextRoomIndex: 1, entersBoss: false };
    expect(toNarrationEvent(game, o, "史萊姆", next)).toMatchObject({ type: "correct", next });
    expect(toNarrationEvent(game, { type: "incorrect-retry", teamId: "b" }, "史萊姆", next)).toMatchObject({ next });
  });

  it("leaves 'next' off when nobody is next (the killing blow ends the game)", () => {
    const next = { team: "藍隊", monster: "小黑龍", boss: true };
    const o: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 0, bossKilled: true, reward: 21, killBonus: 11 };
    expect(toNarrationEvent(game, o, "小黑龍", next)).not.toHaveProperty("next");
  });

  it("has no 'next' at all when none is given", () => {
    expect(toNarrationEvent(game, { type: "incorrect-retry", teamId: "b" }, "史萊姆")).not.toHaveProperty("next");
  });
});

describe("toNarrationEvent: entering the boss room", () => {
  const advance = (entersBoss: boolean): AnswerOutcome => ({ type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 20, nextRoomIndex: 1, entersBoss });

  it("flags a correct answer that enters the boss room", () => {
    expect(toNarrationEvent(game, advance(true), "史萊姆")).toMatchObject({ type: "correct", entersBoss: {} });
  });

  it("marks the first team in as first (no order), and a later team, host-sent ones counted, by its join order", () => {
    expect((toNarrationEvent(game, advance(true), "史萊姆") as { entersBoss: object }).entersBoss).not.toHaveProperty("order");
    const oneInside = { ...game, teams: game.teams.map((t) => (t.id === "b" ? { ...t, inBoss: true } : t)) };
    expect(toNarrationEvent(oneInside, advance(true), "史萊姆")).toMatchObject({ entersBoss: { order: 2 } });
    expect(toNarrationEvent(sendToBoss(game, "b"), advance(true), "史萊姆", undefined, "主題曲之謎")).toMatchObject({ entersBoss: { phase: "主題曲之謎", order: 2 } });
  });

  it("does not flag an answer that stays out of the boss room", () => {
    expect(toNarrationEvent(game, advance(false), "史萊姆")).not.toHaveProperty("entersBoss");
  });
});

describe("boss phases", () => {
  it("names the phase under way when a team enters the boss room from phase 2 on (D13), and only then", () => {
    const o: AnswerOutcome = { type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 20, nextRoomIndex: 0, entersBoss: true };
    expect(toNarrationEvent(game, o, "害羞幽靈", undefined, "主題曲之謎")).toMatchObject({ entersBoss: { phase: "主題曲之謎" } });
    expect(toNarrationEvent(game, o, "害羞幽靈")).toMatchObject({ entersBoss: {} });
    expect((toNarrationEvent(game, o, "害羞幽靈") as { entersBoss: object }).entersBoss).not.toHaveProperty("phase");
  });

  it("carries the acting team's class on attack events, and leaves it out for a team with no class", () => {
    const withClass: GameState = { ...game, teams: game.teams.map((t) => (t.id === "a" ? { ...t, classId: "mage" as const } : t)) };
    const hit: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 3, bossKilled: false, reward: 10 };
    const correct: AnswerOutcome = { type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 20, nextRoomIndex: 1, entersBoss: false };
    expect(toNarrationEvent(withClass, hit, "小黑龍")).toMatchObject({ type: "boss-hit", classId: "mage" });
    expect(toNarrationEvent(withClass, correct, "史萊姆")).toMatchObject({ type: "correct", classId: "mage" });
    expect(toNarrationEvent(withClass, { type: "incorrect-retry", teamId: "a" }, "史萊姆")).toMatchObject({ classId: "mage" });
    expect(toNarrationEvent(withClass, { type: "incorrect-retry", teamId: "b" }, "史萊姆")).not.toHaveProperty("classId");
    expect(toNarrationEvent(withClass, { type: "incorrect-flee", teamId: "a", newDifficulty: 1 }, "史萊姆")).not.toHaveProperty("classId");
    // Value: protects=boss-kill carries the killer's class; fails_when=classId is dropped from the boss-kill branch; why_new=only hit/correct/retry were checked; seam=none; no_claim=none beyond protects
    const kill: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 0, bossKilled: true, reward: 21, killBonus: 11 };
    expect(toNarrationEvent(withClass, kill, "小黑龍")).toMatchObject({ type: "boss-kill", classId: "mage" });
  });
});

// Value: protects=a natural 20 or 1 reaches the narrator (dnd design E3); fails_when=toNarrationEvent drops outcome.roll
describe("toNarrationEvent: the crit die", () => {
  it("carries a 20 or a 1 on correct, boss-hit and boss-kill, and nothing otherwise", () => {
    const crit = { kind: "crit", value: 20 } as const;
    const room: AnswerOutcome = { type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 30, nextRoomIndex: 1, entersBoss: false, roll: crit };
    expect(toNarrationEvent(game, room, "史萊姆")).toMatchObject({ type: "correct", points: 30, roll: crit });
    const hit: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 2, bossKilled: false, reward: 10, roll: { kind: "crit", value: 1 } };
    expect(toNarrationEvent(game, hit, "龍")).toMatchObject({ type: "boss-hit", roll: { kind: "crit", value: 1 } });
    const kill: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 0, bossKilled: true, reward: 30, killBonus: 15, roll: crit };
    expect(toNarrationEvent(game, kill, "龍")).toMatchObject({ type: "boss-kill", roll: crit });
    const plain: AnswerOutcome = { type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 20, nextRoomIndex: 1, entersBoss: false };
    expect(toNarrationEvent(game, plain, "史萊姆")).not.toHaveProperty("roll");
  });
});
