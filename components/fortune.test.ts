import { expect, it } from "vitest";
import { fortuneHeroScale } from "./fortune";
import { MAX_TEAMS } from "@/lib/protocol";

// Value: protects=QA c3 2c: the effect card clears the big screen's narration box; fails_when=the self line or a full
// room keeps the 4x heroes and the card runs under the box; no_claim=the pixel layout itself (checked in screenshots)
it("shrinks the effect card's heroes for the self line and for a full room", () => {
  expect(fortuneHeroScale(1, false)).toBe(4);
  expect(fortuneHeroScale(6, false)).toBe(4);
  expect(fortuneHeroScale(1, true)).toBe(3);
  expect(fortuneHeroScale(7, false)).toBe(3);
  expect(fortuneHeroScale(MAX_TEAMS, true)).toBe(3);
});
