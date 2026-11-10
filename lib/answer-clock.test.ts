import { describe, expect, it } from "vitest";
import { STUCK_MS, stuckDelayMs } from "./answer-clock";

// Value: protects=the host's 「好像卡住了／替○○選」 row waits for the countdown's 0 when it is on, and 15 s when it is off
// or not running; fails_when=the row comes 15 s into a counted turn, or never comes; seam=pure; no_claim=the timer itself
describe("stuckDelayMs", () => {
  it("waits out the countdown when it runs, and STUCK_MS without one or while a clip has not ended", () => {
    expect(stuckDelayMs({ left: 42_000 })).toBe(42_000);
    expect(stuckDelayMs({ left: 0 })).toBe(0);
    expect(stuckDelayMs({ left: null })).toBe(STUCK_MS);
    expect(stuckDelayMs(undefined)).toBe(STUCK_MS);
  });
});
