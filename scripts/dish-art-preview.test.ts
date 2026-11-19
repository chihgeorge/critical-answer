import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// scripts/dish-art-preview.ts needs Google Chrome, so CI never runs it. This only guards where it writes.
const src = readFileSync(new URL("./dish-art-preview.ts", import.meta.url), "utf8");

describe("scripts/dish-art-preview.ts", () => {
  // Value: protects=the preview's PNG sheets stay out of the public repo by default; fails_when=the default out-dir
  // moves into the checkout; seam=the script's source text; no_claim=the rendering itself
  it("writes its PNGs outside the repo unless given a directory", () => {
    expect(src).toMatch(/process\.argv\[2\] \?\? join\(homedir\(\), "\.gstack\//);
  });
});
