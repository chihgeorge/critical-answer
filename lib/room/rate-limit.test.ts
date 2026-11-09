import { describe, it, expect } from "vitest";
import { MSG_BURST, MSG_PER_SECOND, RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  // Value: protects=one socket flooding the room cannot keep the single-threaded room busy, while a fast tapper is
  // never dropped; fails_when=the burst is not enforced, the bucket never refills, or sockets share one budget
  it("allows a burst, drops the rest, refills over time, and keeps each socket's budget apart", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const flooder = {};
    const player = {};
    for (let i = 0; i < MSG_BURST; i++) expect(limiter.allow(flooder)).toBe(true);
    expect(limiter.allow(flooder)).toBe(false);
    expect(limiter.allow(player)).toBe(true);
    now += 1000;
    for (let i = 0; i < MSG_PER_SECOND; i++) expect(limiter.allow(flooder)).toBe(true);
    expect(limiter.allow(flooder)).toBe(false);
    // A long pause refills to the burst, never past it.
    now += 60_000;
    for (let i = 0; i < MSG_BURST; i++) expect(limiter.allow(flooder)).toBe(true);
    expect(limiter.allow(flooder)).toBe(false);
  });

  it("a person tapping 5 times a second all game is never dropped", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const phone = {};
    for (let i = 0; i < 5 * 600; i++, now += 200) expect(limiter.allow(phone)).toBe(true);
  });
});
