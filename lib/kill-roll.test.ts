import { describe, it, expect } from "vitest";
import { killRollText } from "./kill-roll";

// Value: protects=the TV's kill dice line adds up what has landed and ends on the bonus the room scores, sneak shown as
// ×1.5 (kill-roll.md UI B, class balance 2026-11-08); fails_when=the total skips a die, shows the undoubled sum for a thief, or ends before the last
// die; why_new=no test covers the overlay text; seam=none; no_claim=the animation timing (e2e boss-phases)
describe("killRollText", () => {
  const dice = [9, 14, 3, 17];
  it("adds the dice up as they land, then shows the sum", () => {
    expect(killRollText(dice, 43, 0)).toMatchObject({ result: "", done: false });
    expect(killRollText(dice, 43, 1)).toMatchObject({ result: "9 …", done: false });
    expect(killRollText(dice, 43, 2).result).toBe("9 + 14 = 23 …");
    expect(killRollText(dice, 43, 4)).toEqual({ chip: "最後一擊！擲 4d20 擊殺獎勵", result: "9 + 14 + 3 + 17 = 43 分", done: true });
  });

  it("shows a thief's sneak as a multiplier on the sum", () => {
    expect(killRollText(dice, 65, 4)).toEqual({ chip: "最後一擊！擲 4d20 擊殺獎勵（偷襲 ×1.5）", result: "43 × 1.5 = 65 分", done: true });
  });
});
