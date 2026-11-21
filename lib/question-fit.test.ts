import { describe, expect, it } from "vitest";
import { fitQuestionSize, QUESTION_SIZES, TILE_SIZES } from "./question-fit";

// The screen's question panel: top 100, 44 px of padding, line-height 1.3, about 692 px of text per line.
const panel = (chars: number) => (size: number) => 100 + 44 + Math.ceil((chars * size) / 692) * size * 1.3;

describe("fitQuestionSize", () => {
  it("keeps 30 px for a two-line question above the tiles", () => {
    expect(fitQuestionSize(panel(40), 238)).toBe(30);
  });

  it("shrinks a three- or four-line question until the panel ends above the tiles", () => {
    for (const chars of [60, 90]) {
      const size = fitQuestionSize(panel(chars), 238);
      expect(size).toBeLessThan(30);
      expect(panel(chars)(size)).toBeLessThanOrEqual(238);
    }
  });

  it("stops at the smallest size when nothing fits", () => {
    expect(fitQuestionSize(panel(400), 238)).toBe(QUESTION_SIZES.at(-1));
  });

  it("has no limit to fit when nothing stands below the panel", () => {
    expect(fitQuestionSize(panel(400), Infinity)).toBe(30);
  });
});

// A wall tile: 54 px of text box, line-height 1, about 252 px of text per line (CJK glyphs are one em wide).
const tile = (chars: number) => (size: number) => Math.ceil((chars * size) / 252) * size - 54;

describe("fitQuestionSize on the option tiles", () => {
  it("keeps 24 px for a bank-length option", () => {
    expect(fitQuestionSize(tile(20), 0, TILE_SIZES)).toBe(24);
  });

  it("shrinks a long option until its whole text fits the tile", () => {
    const size = fitQuestionSize(tile(40), 0, TILE_SIZES);
    expect(size).toBeLessThan(24);
    expect(tile(40)(size)).toBeLessThanOrEqual(0);
  });
});
