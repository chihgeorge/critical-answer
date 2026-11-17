import { describe, expect, it } from "vitest";
import { FIELD_SEP as BANK_FIELD_SEP } from "../lib/question-bank";
import { DEFAULT_BASE, FIELD_SEP, PLAY_WAIT_MS, decide, parseArgs, sortStep, summarize, type PageResult, type Seen, type StepResult } from "./canary-live";

it("splits a music answer on the bank's own field separator (the script cannot import lib/ on plain node)", () => {
  expect(FIELD_SEP).toBe(BANK_FIELD_SEP);
});

describe("parseArgs", () => {
  it("defaults to production, one round, one turn, no boss", () => {
    expect(parseArgs([])).toEqual({ base: DEFAULT_BASE, rounds: 1, turns: 1, boss: false });
  });
  it("takes --rounds, --turns, --boss and --base, in both spellings, and drops a trailing slash", () => {
    expect(parseArgs(["--rounds", "3", "--base=http://localhost:3000/"])).toEqual({ base: "http://localhost:3000", rounds: 3, turns: 1, boss: false });
    expect(parseArgs(["--rounds=2", "--base", "https://x.vercel.app"])).toEqual({ base: "https://x.vercel.app", rounds: 2, turns: 1, boss: false });
    expect(parseArgs(["--turns", "8", "--boss"])).toMatchObject({ turns: 8, boss: true });
    expect(parseArgs(["--turns=4"]).turns).toBe(4);
  });
  it("reads CANARY_BASE_URL, and a flag beats it", () => {
    expect(parseArgs([], { CANARY_BASE_URL: "https://preview.vercel.app" }).base).toBe("https://preview.vercel.app");
    expect(parseArgs(["--base", "http://localhost:3000"], { CANARY_BASE_URL: "https://preview.vercel.app" }).base).toBe("http://localhost:3000");
  });
  it("rejects bad values and unknown flags, and has no way to pass a key or pick a bank", () => {
    expect(() => parseArgs(["--rounds", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--rounds", "1.5"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--rounds"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--turns", "0"])).toThrow(/--turns must be a positive integer/);
    expect(() => parseArgs(["--boss=yes"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--base", "critical-answer.vercel.app"])).toThrow(/http/);
    expect(() => parseArgs(["--owner-key", "x"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--bank", "event"])).toThrow(/unknown argument/);
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
  it("prints a step's note, and a noted (skipped) step is still healthy", () => {
    const { lines, healthy } = summarize([page()], [step({ name: "answer-correctly-t3", note: "skipped: timing question: the host skipped it" })]);
    expect(lines[0]).toBe('STEP r1 answer-correctly-t3 ok ms=900 note="skipped: timing question: the host skipped it"');
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

describe("decide", () => {
  const none: Seen = {
    revealed: false, over: false, wrong: false, phaseCard: false, next: false, acted: false, reveal: false, roll: false,
    checkFirst: false, hostRoll: false, fork: false, fortune: false, memory: false, fields: false, judge: false, sort: false,
    choice: false, buzz: false, buzzWaiting: false, tap: false, play: false, played: false, liveOpen: false, skip: false,
  };
  const seen = (s: Partial<Seen>): Seen => ({ ...none, ...s });

  it("answers each kind the way a team and host would", () => {
    expect(decide(seen({ choice: true }), null)).toBe("choice");
    expect(decide(seen({ choice: true, sort: true }), null)).toBe("sort");
    expect(decide(seen({ judge: true }), null)).toBe("judge");
    expect(decide(seen({ roll: true, judge: true }), null)).toBe("roll");
    expect(decide(seen({ reveal: true, choice: true }), null)).toBe("reveal");
    expect(decide(seen({ fields: true, judge: true }), null)).toBe("fields");
    expect(decide(seen({ buzz: true, skip: true }), null)).toBe("buzz");
  });
  it("does not judge during a memory clip or before the team's check", () => {
    expect(decide(seen({ memory: true, judge: true }), null)).toBe("memory");
    expect(decide(seen({ checkFirst: true, judge: true }), null)).toBe("wait");
    expect(decide(seen({ checkFirst: true, hostRoll: true, judge: true }), null)).toBe("host-roll");
    expect(decide(seen({ checkFirst: true, roll: true, judge: true }), null)).toBe("roll");
    expect(decide(seen({ checkFirst: true, memory: true }), null)).toBe("wait");
  });
  it("walks through doors, fortunes and boss phase cards", () => {
    expect(decide(seen({ fork: true }), null)).toBe("fork");
    expect(decide(seen({ fortune: true }), null)).toBe("fortune");
    expect(decide(seen({ phaseCard: true, next: true }), null)).toBe("next");
    expect(decide(seen({ next: true }), null)).toBe("card");
    // Once the canary answered, a 下一題 means the answer is on its way to the big screen.
    expect(decide(seen({ next: true, acted: true }), null)).toBe("wait");
  });
  it("skips what cannot be answered on purpose: a timing tap, a song that does not start", () => {
    expect(decide(seen({ tap: true, skip: true }), null)).toBe("skip");
    expect(decide(seen({ tap: true }), null)).toBe("wait");
    expect(decide(seen({ buzzWaiting: true, play: true, skip: true }), null)).toBe("play");
    expect(decide(seen({ buzzWaiting: true, play: true, played: true, skip: true }), 1000)).toBe("wait");
    expect(decide(seen({ buzzWaiting: true, play: true, played: true, skip: true }), PLAY_WAIT_MS + 1)).toBe("skip");
    expect(decide(seen({ buzzWaiting: true, liveOpen: true, skip: true }), 1000)).toBe("live");
    // No ▶ (an uploaded song, or ▶ not up yet): give it the same time to start before skipping.
    expect(decide(seen({ buzzWaiting: true, skip: true }), null)).toBe("wait");
    expect(decide(seen({ buzzWaiting: true, skip: true }), 1000)).toBe("wait");
    expect(decide(seen({ buzzWaiting: true, skip: true }), PLAY_WAIT_MS + 1)).toBe("skip");
  });
  it("stops on the answer, a wrong answer and the end of the game, in that order", () => {
    expect(decide(seen({ revealed: true, judge: true, next: true }), null)).toBe("done");
    expect(decide(seen({ over: true, revealed: true }), null)).toBe("over");
    expect(decide(seen({ wrong: true, choice: true }), null)).toBe("wrong");
    expect(decide(none, null)).toBe("wait");
  });
});

describe("sortStep", () => {
  it("names the row to move down until the rows are in order", () => {
    const want = ["甲", "乙", "丙", "丁"];
    let rows = ["丁", "丙", "甲", "乙"];
    let moves = 0;
    for (let i = sortStep(rows, want); i !== null; i = sortStep(rows, want), moves++) {
      rows = [...rows.slice(0, i), rows[i + 1], rows[i], ...rows.slice(i + 2)];
      expect(moves).toBeLessThan(want.length ** 2);
    }
    expect(rows).toEqual(want);
    expect(sortStep(want, want)).toBeNull();
    expect(sortStep(["乙", "甲"], ["甲", "乙"])).toBe(0);
  });
});
