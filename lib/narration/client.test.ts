import { describe, it, expect } from "vitest";
import { keepLatest, isPending } from "./client";

describe("keepLatest", () => {
  it("takes the first line, then only lines with a higher eventId", () => {
    let n = keepLatest(null, { eventId: 2, line: "二" });
    expect(n).toEqual({ eventId: 2, line: "二" });
    n = keepLatest(n, { eventId: 1, line: "舊的" }); // arrived late
    expect(n?.line).toBe("二");
    n = keepLatest(n, { eventId: 3, line: "三" });
    expect(n?.line).toBe("三");
  });

  it("keeps the follow-up line with its result line, and drops it when a newer event has none", () => {
    let n = keepLatest(null, { eventId: 2, line: "結果", then: "輪到藍隊" });
    expect(n).toEqual({ eventId: 2, line: "結果", then: "輪到藍隊" });
    n = keepLatest(n, { eventId: 3, line: "終局" });
    expect(n).toEqual({ eventId: 3, line: "終局", then: undefined });
  });

  it("accepts a replay of the same eventId (a reconnect) without changing it", () => {
    const n = keepLatest({ eventId: 4, line: "四" }, { eventId: 4, line: "四" });
    expect(n).toEqual({ eventId: 4, line: "四" });
  });
});

describe("isPending", () => {
  it("is true while STATE is ahead of the last narration (the … loader)", () => {
    expect(isPending(3, { eventId: 2, line: "x" })).toBe(true);
    expect(isPending(1, null)).toBe(true);
  });
  it("is false once the narration for the current event arrived, and before any event", () => {
    expect(isPending(3, { eventId: 3, line: "x" })).toBe(false);
    expect(isPending(0, null)).toBe(false);
  });
});
