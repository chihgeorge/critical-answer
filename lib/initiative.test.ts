import { describe, expect, it } from "vitest";
import { initiativeOrder } from "./initiative";

const dice = (...values: number[]) => () => values.shift()!;

describe("initiativeOrder (擲先攻)", () => {
  it("puts the highest roll first, whatever the lobby order", () => {
    expect(initiativeOrder(["a", "b", "c"], { a: 3, b: 17, c: 9 }, dice())).toEqual({ order: ["b", "c", "a"], tieRolls: [] });
  });

  it("rerolls only the tied teams, at every place, not just the podium's three", () => {
    const { order, tieRolls } = initiativeOrder(["a", "b", "c", "d", "e"], { a: 20, b: 2, c: 15, d: 2, e: 15 }, dice(4, 11, 19, 6));
    // c and e tie for 2nd: 4 vs 11. b and d tie for 4th: 19 vs 6.
    expect(order).toEqual(["a", "e", "c", "b", "d"]);
    expect(tieRolls).toEqual([
      { from: 2, teams: ["c", "e"], values: [4, 11] },
      { from: 4, teams: ["b", "d"], values: [19, 6] },
    ]);
  });

  it("rolls again while the reroll still ties", () => {
    const { order, tieRolls } = initiativeOrder(["a", "b"], { a: 8, b: 8 }, dice(5, 5, 2, 13));
    expect(order).toEqual(["b", "a"]);
    expect(tieRolls.map((r) => r.values)).toEqual([[5, 5], [2, 13]]);
  });
});
