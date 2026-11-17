import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sim = (env: Record<string, string> = {}) =>
  execFileSync(process.execPath, ["--no-warnings", "scripts/balance-sim.ts", "30"], { encoding: "utf8", env: { ...process.env, ...env } });

// scripts/balance-sim.ts still runs against lib/game-state.ts: every game finishes and every class gets a row.
describe("balance-sim", () => {
  it("plays a short run to the end and prints all six options", () => {
    const out = sim();
    expect(out).toContain("games=30 unfinished=0");
    for (const c of ["mage", "cleric", "warrior", "thief", "chef", "none"]) expect(out).toMatch(new RegExp(`^${c} +win%`, "m"));
  });

  // Only sort questions in the rooms and only timing taps in the buzzer phase: both paths call lib without a throw.
  it("plays sort questions and timing taps to the end", () => {
    expect(sim({ TEXT: "0", SORT: "1", TAP: "1", HP2: "5" })).toContain("games=30 unfinished=0");
  });
});

// scripts/balance-sim-dice.ts is a record of the class-dice analysis that no longer runs against today's lib (tsc still
// checks it). Its header must keep saying so, and where the shipped rules are simulated.
describe("balance-sim-dice (record)", () => {
  it("says it no longer runs and points to balance-sim.ts", () => {
    const head = readFileSync("scripts/balance-sim-dice.ts", "utf8").split("\n").slice(0, 3).join("\n");
    expect(head).toContain("no longer runs");
    expect(head).toContain("scripts/balance-sim.ts");
  });
});
