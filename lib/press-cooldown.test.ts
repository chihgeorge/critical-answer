import { describe, expect, it } from "vitest";
import { FIX_COOLDOWN_MS, pressCooldown } from "./press-cooldown";

describe("pressCooldown (⚙ 更多 修正 double taps)", () => {
  it("drops a second press of the same button inside the window, then lets the next one through", () => {
    let t = 1000;
    const allow = pressCooldown(FIX_COOLDOWN_MS, () => t);
    expect(allow("A:score+")).toBe(true);
    t += 150;
    expect(allow("A:score+")).toBe(false);
    t += FIX_COOLDOWN_MS - 150 - 1;
    expect(allow("A:score+")).toBe(false);
    t += 1;
    expect(allow("A:score+")).toBe(true);
  });

  it("keeps buttons apart: another fix or another team is never held back", () => {
    let t = 0;
    const allow = pressCooldown(FIX_COOLDOWN_MS, () => t);
    expect(allow("A:score+")).toBe(true);
    expect(allow("A:score-")).toBe(true);
    expect(allow("B:score+")).toBe(true);
    t += 10;
    expect(allow("A:score+")).toBe(false);
  });
});
