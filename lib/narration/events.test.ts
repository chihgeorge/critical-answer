import { describe, it, expect } from "vitest";
import { toNarrationEvent } from "./events";
import { createGame, type AnswerOutcome, type GameState } from "../game-state";

const game: GameState = createGame(
  [{ id: "a", name: "紅隊" }, { id: "b", name: "藍隊" }],
  [{ baseDifficulty: 2, questionIds: ["q1", "q2", "q3"] }],
  ["b1", "b2"],
  { bossThreshold: 15 },
  5,
  () => 0,
);

describe("toNarrationEvent", () => {
  it("maps a correct room answer to a 'correct' event with team, monster and points", () => {
    const o: AnswerOutcome = { type: "correct-room-advance", teamId: "a", pointsAwarded: 2, nextRoomIndex: 1 };
    expect(toNarrationEvent(game, o, "害羞幽靈")).toEqual({ type: "correct", team: "紅隊", monster: "害羞幽靈", points: 2 });
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
    const o: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 3, bossKilled: false };
    expect(toNarrationEvent(game, o, "小黑龍")).toEqual({ type: "boss-hit", team: "紅隊", bossHp: 3, bossMaxHp: 5 });
  });

  it("maps the killing blow to exactly one 'boss-kill' event carrying the bonus", () => {
    const o: AnswerOutcome = { type: "correct-boss-hit", teamId: "a", bossHpRemaining: 0, bossKilled: true, killBonus: 11 };
    expect(toNarrationEvent(game, o, "小黑龍")).toEqual({ type: "boss-kill", team: "紅隊", monster: "小黑龍", bonus: 11 });
  });

  it("does not throw on an unknown team and falls back to a neutral name", () => {
    const o: AnswerOutcome = { type: "incorrect-retry", teamId: "zzz" };
    expect(toNarrationEvent(game, o, "史萊姆")).toMatchObject({ team: "冒險者" });
  });
});
