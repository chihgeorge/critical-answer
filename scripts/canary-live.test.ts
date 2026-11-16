import { describe, expect, it } from "vitest";
import { DEFAULT_BASE, parseArgs, summarize, type PageResult, type StepResult } from "./canary-live";

describe("parseArgs", () => {
  it("defaults to production and one round", () => {
    expect(parseArgs([])).toEqual({ base: DEFAULT_BASE, rounds: 1 });
  });
  it("takes --rounds and --base, in both spellings, and drops a trailing slash", () => {
    expect(parseArgs(["--rounds", "3", "--base=http://localhost:3000/"])).toEqual({ base: "http://localhost:3000", rounds: 3 });
    expect(parseArgs(["--rounds=2", "--base", "https://x.vercel.app"])).toEqual({ base: "https://x.vercel.app", rounds: 2 });
  });
  it("reads CANARY_BASE_URL, and a flag beats it", () => {
    expect(parseArgs([], { CANARY_BASE_URL: "https://preview.vercel.app" }).base).toBe("https://preview.vercel.app");
    expect(parseArgs(["--base", "http://localhost:3000"], { CANARY_BASE_URL: "https://preview.vercel.app" }).base).toBe("http://localhost:3000");
  });
  it("rejects bad values and unknown flags", () => {
    expect(() => parseArgs(["--rounds", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--rounds", "1.5"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--rounds"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--base", "critical-answer.vercel.app"])).toThrow(/http/);
    expect(() => parseArgs(["--owner-key", "x"])).toThrow(/unknown argument/);
  });
});

describe("summarize", () => {
  const page = (p: Partial<PageResult> = {}): PageResult => ({ round: 1, name: "host", status: 200, ms: 500, errs: [], ...p });
  const step = (s: Partial<StepResult> = {}): StepResult => ({ round: 1, name: "create-room", ok: true, ms: 900, ...s });

  it("prints STEP and PAGE lines, then HEALTHY when every step passed and no page logged an error", () => {
    const { lines, healthy } = summarize([page()], [step()]);
    expect(lines).toEqual(["STEP r1 create-room ok ms=900", "PAGE r1 host status=200 ms=500 errs=[]", "CANARY HEALTHY"]);
    expect(healthy).toBe(true);
  });
  it("is BROKEN on a failed step, a console error, a bad status, a page that never loaded, or no steps at all", () => {
    expect(summarize([page()], [step({ ok: false, error: "boom" })]).lines[0]).toBe('STEP r1 create-room FAIL ms=900 error="boom"');
    for (const [pages, steps] of [
      [[page()], [step({ ok: false })]],
      [[page({ errs: ["TypeError: x"] })], [step()]],
      [[page({ status: 500 })], [step()]],
      [[page({ status: null })], [step()]],
      [[page()], []],
    ] as [PageResult[], StepResult[]][]) {
      const { lines, healthy } = summarize(pages, steps);
      expect(healthy).toBe(false);
      expect(lines.at(-1)).toBe("CANARY BROKEN");
    }
  });
});
