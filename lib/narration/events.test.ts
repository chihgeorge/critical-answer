import { describe, it, expect } from "vitest";
import { toNarrationEvent } from "./events";
import { createGame, type AnswerOutcome, type GameState } from "../game-state";

const game: GameState = createGame(
  [{ id: "a", name: "紅隊" }, { id: "b", name: "藍隊" }],
  [{ baseDifficulty: 2, reward: 20, questionIds: ["q1", "q2", "q3"] }],
  ["b1", "b2"],
  { bossThreshold: 15 },
  5,
  () => 0,
);

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
  const withBranches = (branchChoices: GameState["teams"][number]["branchChoices"] = {}): GameState => ({
    ...game,
    teams: game.teams.map((t) => (t.id === "a" ? { ...t, branchChoices } : t)),
  });
  const advance = (entersBoss: boolean): AnswerOutcome => ({ type: "correct-room-advance", teamId: "a", pointsAwarded: 2, reward: 20, nextRoomIndex: 1, entersBoss });

  it("flags a correct answer that enters the boss room, with the team's branch choices in room order", () => {
    const e = toNarrationEvent(withBranches({ 3: "negotiate", 1: "fight" }), advance(true), "史萊姆");
    expect(e).toMatchObject({ type: "correct", entersBoss: { branches: ["武力", "討價"] } });
  });

  it("flags it with no branches when the team never chose one", () => {
    expect(toNarrationEvent(withBranches(), advance(true), "史萊姆")).toMatchObject({ entersBoss: { branches: [] } });
  });

  it("does not flag an answer that stays out of the boss room", () => {
    expect(toNarrationEvent(withBranches(), advance(false), "史萊姆")).not.toHaveProperty("entersBoss");
  });
});
