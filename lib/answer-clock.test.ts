import { describe, expect, it } from "vitest";
import { clipIdle, STUCK_MS, stuckDelayMs, stuckKey } from "./answer-clock";

// Value: protects=the host's 「好像卡住了／替○○選」 row waits for the countdown's 0 when it is on, and 15 s when it is off
// or not running; fails_when=the row comes 15 s into a counted turn, or never comes; seam=pure; no_claim=the timer itself
describe("stuckDelayMs", () => {
  it("waits out the countdown when it runs, and STUCK_MS without one or while a clip has not ended", () => {
    expect(stuckDelayMs({ left: 42_000 })).toBe(42_000);
    expect(stuckDelayMs({ left: 0 })).toBe(0);
    expect(stuckDelayMs({ left: null })).toBe(STUCK_MS);
    expect(stuckDelayMs(undefined)).toBe(STUCK_MS);
  });
});

// Value: protects=no 「好像卡住了」 row while a memory question's media plays (the teams cannot see the question yet), and
// the row's timer starting once it is shown; fails_when=the 15 s run from before the host presses ▶; seam=pure; no_claim=the timer itself
describe("stuckKey", () => {
  const mc = { teamId: "t1", questionId: "q1", mc: true, lock: false, roll: false, wrong: false, eventId: 7 };
  it("has no key while a memory question waits for its media, and a fresh one once the question shows", () => {
    expect(stuckKey({ ...mc, memorize: true, clock: { left: null } })).toBeNull();
    expect(stuckKey({ ...mc, eventId: 8, clock: { left: 60_000 } })).toBe("t1|q1|pick|8|count");
  });
  it("keeps the other turns' rows: a pick (also during a plain question's clip), a wrong pick; none on a fill-in (its check rolls itself)", () => {
    expect(stuckKey({ ...mc, clock: { left: null } })).toBe("t1|q1|pick|7|clip");
    // A video the host has not played yet: no row; once ▶ is pressed it arms as before.
    expect(stuckKey({ ...mc, clock: { left: null }, clipIdle: true })).toBeNull();
    expect(stuckKey({ ...mc, wrong: true })).toBe("t1|q1|wrong|7|count");
    expect(stuckKey({ ...mc, mc: false })).toBeNull();
    expect(stuckKey({ ...mc, lock: true })).toBeNull();
    expect(stuckKey({ ...mc, teamId: undefined })).toBeNull();
  });
});

describe("clipIdle", () => {
  const video = { question: { id: "q1", content: { kind: "youtube" } } };
  it("is a video question before its ▶, with no count and no clip error", () => {
    expect(clipIdle({ ...video, answerClock: { left: null } })).toBe(true);
    expect(clipIdle(video)).toBe(true);
  });
  it("arms again once ▶ or ⏸ touched it, on a clip error, or once a count runs", () => {
    expect(clipIdle({ ...video, media: { questionId: "q1" } })).toBe(false);
    expect(clipIdle({ ...video, media: { questionId: "q0" } })).toBe(true);
    expect(clipIdle({ ...video, clipError: true })).toBe(false);
    expect(clipIdle({ ...video, answerClock: { left: 30_000 } })).toBe(false);
  });
  it("is never true for a non-video question or no game", () => {
    expect(clipIdle({ question: { id: "q1", content: { kind: "text" } } })).toBe(false);
    expect(clipIdle({ question: null })).toBe(false);
    expect(clipIdle(undefined)).toBe(false);
  });
});
