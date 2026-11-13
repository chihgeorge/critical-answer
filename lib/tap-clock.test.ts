import { describe, expect, it } from "vitest";
import { addSample, bestOffset, clockSample, CLOCK_SAMPLES, CLOCK_STALE_MS } from "./server-clock";
import {
  acceptTapAt,
  anchorOf,
  closeSongMs,
  formatSongTime,
  formatTapError,
  medianError,
  nextAnchorWindow,
  serverMsOf,
  songMs,
  suggestedLatency,
  tapBonus,
  tapResults,
} from "./tap-clock";

describe("server clock", () => {
  it("takes the midpoint offset", () => {
    // Sent at local 100, server said 10_000 + ... received at local 140: midpoint 120.
    expect(clockSample(100, 140, 10_120)).toEqual({ offset: 10_000, rtt: 40, at: 140 });
  });

  it("keeps the smallest-RTT sample of the last 8", () => {
    let s = addSample([], clockSample(0, 200, 1100)); // rtt 200, offset 1000
    s = addSample(s, clockSample(300, 310, 1305)); // rtt 10, offset 1000
    s = addSample(s, clockSample(400, 500, 1500)); // rtt 100, offset 1050
    expect(bestOffset(s, 500)).toBe(1000);
    for (let i = 0; i < CLOCK_SAMPLES; i++) s = addSample(s, clockSample(1000 + i, 1050 + i, 3025 + i)); // rtt 50, offset 2000
    expect(s).toHaveLength(CLOCK_SAMPLES);
    expect(bestOffset(s, 1060)).toBe(2000);
  });

  it("drops a negative round trip and goes stale", () => {
    expect(addSample([], clockSample(10, 5, 0))).toEqual([]);
    const s = addSample([], clockSample(0, 10, 105));
    expect(bestOffset(s, 10 + CLOCK_STALE_MS)).toBe(100);
    expect(bestOffset(s, 11 + CLOCK_STALE_MS)).toBeNull();
    expect(bestOffset([], 0)).toBeNull();
  });
});

describe("screen anchor", () => {
  it("keeps the minimum of the last 8 and restarts on a jump", () => {
    let w: number[] = [];
    for (const raw of [1000, 1012, 1005, 1030]) w = nextAnchorWindow(w, raw);
    expect(anchorOf(w)).toBe(1000);
    for (let i = 0; i < 8; i++) w = nextAnchorWindow(w, 1010);
    expect(anchorOf(w)).toBe(1010);
    w = nextAnchorWindow(w, 5000); // seek
    expect(w).toEqual([5000]);
    expect(nextAnchorWindow(w, NaN)).toBe(w);
    expect(anchorOf([])).toBeNull();
  });

  it("converts song time both ways with latency", () => {
    expect(songMs(10_500, 10_000, 100)).toBe(400);
    expect(serverMsOf(400, 10_000, 100)).toBe(10_500);
  });
});

describe("tap acceptance", () => {
  it("refuses a stale stamp and clamps a future one", () => {
    expect(acceptTapAt(8999, 10_000)).toBe("late");
    expect(acceptTapAt(9000, 10_000)).toBe(9000);
    expect(acceptTapAt(10_200, 10_000)).toBe(10_200);
    expect(acceptTapAt(11_000, 10_000)).toBe(10_300);
  });

  it("closes at target + 2 s, or + 0.5 s once everyone tapped", () => {
    expect(closeSongMs(60_000, false)).toBe(62_000);
    expect(closeSongMs(60_000, true)).toBe(60_500);
  });
});

describe("tapResults", () => {
  it("ranks by |error|, ties to the earlier tap, tiers the rest", () => {
    const { rows, tie } = tapResults(
      [
        { teamId: "a", ms: 10_120 },
        { teamId: "b", ms: 9_880 },
        { teamId: "c", ms: 10_550 },
        { teamId: "d", ms: 8_000 },
        { teamId: "e", ms: 10_900 },
      ],
      10_000,
    );
    expect(rows.map((r) => r.teamId)).toEqual(["a", "b", "c", "e", "d"]);
    expect(rows.map((r) => r.errorMs)).toEqual([120, -120, 550, 900, -2000]);
    expect(rows.map((r) => r.bonus)).toEqual([0, 3, 2, 1, 0]);
    expect(tie).toBe(true);
  });

  it("has no cap: a far tap still wins alone", () => {
    const { rows, tie } = tapResults([{ teamId: "a", ms: 30_000 }], 10_000);
    expect(rows).toEqual([{ teamId: "a", errorMs: 20_000, bonus: 0 }]);
    expect(tie).toBe(false);
    expect(tapResults([], 0).rows).toEqual([]);
  });

  it("bonus tiers are inclusive", () => {
    expect([300, 301, 600, 1000, 1001].map(tapBonus)).toEqual([3, 2, 2, 1, 0]);
  });
});

describe("formatting", () => {
  it("formats song time and error", () => {
    expect(formatSongTime(190_350)).toBe("3:10.35");
    expect(formatSongTime(5)).toBe("0:00.01");
    expect(formatSongTime(59_999)).toBe("1:00.00");
    expect(formatTapError(-120)).toBe("早 0.12 秒");
    expect(formatTapError(1500)).toBe("晚 1.50 秒");
    expect(formatTapError(0)).toBe("準 0.00 秒");
  });

  it("medians and suggests a clamped latency", () => {
    expect(medianError([])).toBeNull();
    expect(medianError([300, -100, 200])).toBe(200);
    expect(medianError([100, 200, 301, 401])).toBe(251);
    expect(suggestedLatency(100, 150)).toBe(250);
    expect(suggestedLatency(100, -400)).toBe(0);
    expect(suggestedLatency(900, 400)).toBe(1000);
  });
});
