import { describe, it, expect } from "vitest";
import { MAX_FIELDS, MAX_ID, MAX_PASSWORD, MAX_RAW_TEXT, parseClientMessage } from "../protocol";
import { MAX_MESSAGE_BYTES, MSG_BURST, MSG_PER_SECOND, oversized, RateLimiter } from "./rate-limit";

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

describe("oversized", () => {
  // Value: protects=a socket cannot make the room parse a huge JSON text; fails_when=the cap counts UTF-16 units
  // instead of bytes, or is off by one at the boundary
  it("drops a message over 4096 UTF-8 bytes and keeps one at the cap", () => {
    expect(oversized("a".repeat(MAX_MESSAGE_BYTES))).toBe(false);
    expect(oversized("a".repeat(MAX_MESSAGE_BYTES + 1))).toBe(true);
    // 1366 CJK characters are under the cap as a string length and over it in bytes (3 each).
    expect(oversized("題".repeat(1366))).toBe(true);
    expect(oversized("題".repeat(1365))).toBe(false);
  });

  // Value: protects=no real message is ever dropped by the cap; fails_when=a protocol length limit grows until its
  // largest valid message passes 4096 bytes; no_claim=hand-made messages of JSON-escaped control characters (6 bytes
  // each), and limits this test writes as numbers (team name 100, team key 128, AI key 256, key id 64)
  it("keeps the largest message each long-text type may carry, in 3-byte characters", () => {
    const text = "題".repeat(MAX_RAW_TEXT);
    const id = "q".repeat(MAX_ID);
    const largest: unknown[] = [
      { type: "TEAM_SUBMIT_TEXT", questionId: id, text, eventId: Number.MAX_SAFE_INTEGER, fields: Array.from({ length: MAX_FIELDS }, () => text) },
      { type: "HOST_EDIT_NARRATION", eventId: Number.MAX_SAFE_INTEGER, rev: Number.MAX_SAFE_INTEGER, index: Number.MAX_SAFE_INTEGER, line: text },
      { type: "JOIN", teamId: id, teamKey: "k".repeat(128), teamName: "題".repeat(100), password: "密".repeat(MAX_PASSWORD), resume: true },
      { type: "HOST_AI_KEY", source: "own", provider: "anthropic", key: "k".repeat(256), keyId: "i".repeat(64) },
      { type: "HOST_PACING", mode: "manual" },
    ];
    for (const msg of largest) {
      expect(parseClientMessage(msg), JSON.stringify(msg).slice(0, 40)).not.toBeNull();
      expect(oversized(JSON.stringify(msg))).toBe(false);
    }
    // The biggest of them leaves room to spare.
    expect(new TextEncoder().encode(JSON.stringify(largest[0])).byteLength).toBeLessThan(3000);
  });
});
