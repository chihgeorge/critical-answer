import { describe, it, expect } from "vitest";
import { positiveMs } from "./positive-ms";

describe("positiveMs", () => {
  it("parses a valid positive duration", () => {
    expect(positiveMs("7200000")).toBe(7_200_000);
  });

  it("falls back to undefined for missing, zero, negative or non-numeric values", () => {
    for (const bad of [undefined, "", "  ", "0", "-100", "abc", "2h", "NaN", "Infinity"]) {
      expect(positiveMs(bad), `positiveMs(${JSON.stringify(bad)})`).toBeUndefined();
    }
  });
});
