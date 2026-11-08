import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// scripts/balance-sim.ts still runs against lib/game-state.ts: every game finishes and every class gets a row.
describe("balance-sim", () => {
  it("plays a short run to the end and prints all six options", () => {
    const out = execFileSync(process.execPath, ["--no-warnings", "scripts/balance-sim.ts", "30"], { encoding: "utf8" });
    expect(out).toContain("games=30 unfinished=0");
    for (const c of ["mage", "cleric", "warrior", "thief", "chef", "none"]) expect(out).toMatch(new RegExp(`^${c} +win%`, "m"));
  });
});
