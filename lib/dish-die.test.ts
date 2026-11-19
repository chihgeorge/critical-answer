import { expect, it } from "vitest";
import { rolledDish } from "./dish-die";

// Value: protects=the dish die renames the served dish by tier (class-dice-rework.md): 1 burnt, 2–6 botched, 7–19 as
// cooked, 20 legendary; fails_when=a tier keeps the wrong name or look, or 7–19 renames the catalog dish
it("serves the dish by its tier: burnt, botched, as cooked, legendary", () => {
  const dish = { name: "炒飯", comment: "好吃" };
  expect(rolledDish(dish, 12, () => 0)).toEqual({ ...dish, look: "plain" });
  expect(rolledDish(dish, 4, () => 0)).toMatchObject({ name: "半生不熟的炒飯", comment: "能吃，但大家都安靜地吃完了。", look: "botched" });
  expect(rolledDish(dish, 1, () => 0)).toMatchObject({ name: "碳化的炒飯", look: "burnt" });
  expect(rolledDish(dish, 20, () => 0.99)).toMatchObject({ name: "一生一次的炒飯", look: "legend" });
});
