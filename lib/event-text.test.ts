import { describe, it, expect } from "vitest";
import { eventEffectLine } from "./event-text";

// Value: protects=the one line the phones and the big screen show for a ❓ room's result (event-rooms.md); fails_when=a
// boon or an ability use shows as points, a loss shows a plus, or an empty belly reads as −0; why_new=no test (coverage pass
// 2026-11-16); seam=none
describe("eventEffectLine", () => {
  it("names an ability use or a boon before any points", () => {
    expect(eventEffectLine({ satiety: 20, abilityUse: true })).toBe("職業能力 +1 次");
    expect(eventEffectLine({ satiety: 0, boon: "curse" })).toBe("下次答對獎勵減半");
    expect(eventEffectLine({ satiety: 0, boon: "blessing" })).toBe("下次答對多拿一半");
  });

  it("signs the points, adds the chef's bonus, and says an empty belly lost nothing", () => {
    expect(eventEffectLine({ satiety: 20, chefBonus: 3 })).toBe("+20 飽足感（提鮮 +3）");
    expect(eventEffectLine({ satiety: -10 })).toBe("−10 飽足感");
    expect(eventEffectLine({ satiety: 0 })).toBe("飽足感已經見底，沒被扣");
  });
});
