import { describe, it, expect } from "vitest";
import { keepLatest, isPending } from "./client";

describe("keepLatest", () => {
  it("takes the first narration, then only narrations with a higher eventId", () => {
    let n = keepLatest(null, { eventId: 2, lines: ["二"] });
    expect(n).toEqual({ eventId: 2, lines: ["二"] });
    n = keepLatest(n, { eventId: 1, lines: ["舊的"] }); // arrived late
    expect(n?.lines).toEqual(["二"]);
    n = keepLatest(n, { eventId: 3, lines: ["三"] });
    expect(n?.lines).toEqual(["三"]);
  });

  it("keeps the multi-segment array with its result, and replaces it wholesale when a newer event has fewer segments", () => {
    let n = keepLatest(null, { eventId: 2, lines: ["結果", "氣氛", "輪到藍隊"] });
    expect(n).toEqual({ eventId: 2, lines: ["結果", "氣氛", "輪到藍隊"] });
    n = keepLatest(n, { eventId: 3, lines: ["終局", "氣氛"] });
    expect(n).toEqual({ eventId: 3, lines: ["終局", "氣氛"] });
  });

  it("accepts a replay of the same eventId (a reconnect) without changing it", () => {
    const n = keepLatest({ eventId: 4, lines: ["四"] }, { eventId: 4, lines: ["四"] });
    expect(n).toEqual({ eventId: 4, lines: ["四"] });
  });
});

describe("isPending", () => {
  it("is true while STATE is ahead of the last narration (the … loader)", () => {
    expect(isPending(3, { eventId: 2, lines: ["x"] })).toBe(true);
    expect(isPending(1, null)).toBe(true);
  });
  it("is false once the narration for the current event arrived, and before any event", () => {
    expect(isPending(3, { eventId: 3, lines: ["x"] })).toBe(false);
    expect(isPending(0, null)).toBe(false);
  });
});
