import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// .github/workflows/ci.yml: the main ruleset requires a status named `check`, so that job must gate every other job.
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const job = (name: string) => ci.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)*)`, "m"))?.[1] ?? "";

describe("ci.yml", () => {
  it("has a `check` job that runs even when a needed job failed, and passes only when all of them succeeded", () => {
    const check = job("check");
    // always(), not !cancelled(): a skipped required check counts as passed on GitHub.
    expect(check).toMatch(/^    if: always\(\)$/m);
    const needs = check.match(/^    needs: \[(.*)\]$/m)?.[1].split(/,\s*/) ?? [];
    const jobs = [...ci.slice(ci.indexOf("\njobs:")).matchAll(/^  ([\w-]+):$/gm)].map((m) => m[1]).filter((j) => j !== "check");
    expect(needs.sort()).toEqual(jobs.sort());
    // One `&&` chain: with `;` or separate lines, only the last result would decide the step.
    const run = check.match(/^      - run: (.*)$/m)?.[1] ?? "";
    expect(run.split(" && ").sort()).toEqual(jobs.map((j) => `test "\${{ needs.${j}.result }}" = success`).sort());
  });

  it("runs every e2e shard", () => {
    const e2e = job("e2e");
    const shards = e2e.match(/shard: \[(.*)\]/)?.[1].split(/,\s*/) ?? [];
    expect(shards.length).toBeGreaterThan(0);
    expect(e2e).toContain(`--shard=\${{ matrix.shard }}/${shards.length}`);
    expect(e2e).toContain("fail-fast: false");
    // Either of these would let a failing shard report success to `check`.
    expect(ci).not.toContain("continue-on-error");
    expect(e2e).toMatch(/^      - run: npx playwright test --shard=/m);
  });
});

// Pinned, never ubuntu-latest: an image change is a deliberate PR, and the workflows CI never runs move with ci.yml.
describe("runner image", () => {
  it("pins every workflow to the runner ci.yml uses", () => {
    for (const file of ["ci.yml", "release.yml", "dependabot-auto-merge.yml"]) {
      const text = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
      const labels = [...text.matchAll(/^    runs-on: (.*)$/gm)].map((m) => m[1]);
      expect(labels.length, file).toBeGreaterThan(0);
      expect(new Set(labels), file).toEqual(new Set(["ubuntu-26.04"]));
    }
  });
});
