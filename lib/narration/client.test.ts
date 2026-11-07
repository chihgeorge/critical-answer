import { describe, it, expect } from "vitest";
import { firstChange, keepLatest, isPending, narrationSummary, readCount, resumeFrom } from "./client";

describe("keepLatest", () => {
  it("takes the first narration, then only narrations with a higher eventId", () => {
    let n = keepLatest(null, { eventId: 2, lines: ["二"] });
    expect(n).toEqual({ eventId: 2, lines: ["二"], rev: 0 });
    n = keepLatest(n, { eventId: 1, lines: ["舊的"] }); // arrived late
    expect(n?.lines).toEqual(["二"]);
    n = keepLatest(n, { eventId: 3, lines: ["三"] });
    expect(n?.lines).toEqual(["三"]);
  });

  it("keeps the multi-segment array with its result, and replaces it wholesale when a newer event has fewer segments", () => {
    let n = keepLatest(null, { eventId: 2, lines: ["結果", "氣氛", "輪到藍隊"] });
    expect(n).toEqual({ eventId: 2, lines: ["結果", "氣氛", "輪到藍隊"], rev: 0 });
    n = keepLatest(n, { eventId: 3, lines: ["終局", "氣氛"] });
    expect(n).toEqual({ eventId: 3, lines: ["終局", "氣氛"], rev: 0 });
  });

  it("accepts a replay of the same eventId (a reconnect) without changing it", () => {
    const n = keepLatest({ eventId: 4, lines: ["四"], rev: 0 }, { eventId: 4, lines: ["四"] });
    expect(n).toEqual({ eventId: 4, lines: ["四"], rev: 0 });
  });
});

describe("isPending", () => {
  it("is true while STATE is ahead of the last narration (the … loader)", () => {
    expect(isPending(3, { eventId: 2, lines: ["x"], rev: 0 })).toBe(true);
    expect(isPending(1, null)).toBe(true);
  });
  it("is false once the narration for the current event arrived, and before any event", () => {
    expect(isPending(3, { eventId: 3, lines: ["x"], rev: 0 })).toBe(false);
    expect(isPending(0, null)).toBe(false);
  });
});

// Value: protects=a host edit reaches every screen under the same eventId (host-narration-edit.md D9, D14);
// fails_when=keepLatest ignores a same-eventId message, or drops its rev so /screen reports progress on the old text.
describe("keepLatest with host edits", () => {
  it("takes a same-eventId edit with its rev", () => {
    const n = keepLatest({ eventId: 4, lines: ["一", "二"], rev: 0 }, { eventId: 4, lines: ["一", "改"], rev: 1 });
    expect(n).toEqual({ eventId: 4, lines: ["一", "改"], rev: 1 });
  });
});

// Value: protects=the big screen reads on from an edit instead of starting over or cutting a line off (D13);
// fails_when=an edit after the current line restarts it, an edit at or before it does not, or a new narration
// (everything different) does not start from line 0.
describe("resumeFrom", () => {
  const old = ["一", "二", "三"];
  it("reads on when a later line changed", () => {
    expect(resumeFrom(old, ["一", "二", "改"], 1)).toBeNull();
  });
  it("restarts the line being read when that line changed", () => {
    expect(resumeFrom(old, ["一", "改", "三"], 1)).toBe(1);
  });
  it("restarts from an earlier changed line (typed but not yet spoken, D11)", () => {
    expect(resumeFrom(old, ["改", "二", "三"], 2)).toBe(0);
  });
  it("starts a new narration from line 0, and does nothing when nothing changed", () => {
    expect(resumeFrom(old, ["甲", "乙"], 2)).toBe(0);
    expect(resumeFrom(old, [...old], 1)).toBeNull();
    expect(firstChange(["一"], ["一", "二"])).toBe(1);
  });
});

// Value: protects=「已念完」 means read aloud when the voice is on (D11); fails_when=a typed-but-unspoken line counts
// as read, or a screen with no voice never counts anything.
describe("readCount", () => {
  it("is the typed count with no voice, and the smaller of the two with one", () => {
    expect(readCount(2, null)).toBe(2);
    expect(readCount(2, 1)).toBe(1);
    expect(readCount(1, 3)).toBe(1);
  });
});

// Value: protects=the collapsed row only says what the room knows (D6, D15); fails_when=it claims progress no
// screen reported, shows 0-based line numbers, or loses the pending / queued / all-read states.
describe("narrationSummary", () => {
  const n = { eventId: 3, lines: ["一", "二", "三"], rev: 0 };
  it("covers every state", () => {
    expect(narrationSummary(n, true, 0, false)).toBe("旁白生成中…");
    expect(narrationSummary(null, false, 0, false)).toBe("還沒有旁白");
    expect(narrationSummary(n, false, 0, false)).toBe("3 句・大螢幕還沒開始念");
    expect(narrationSummary(n, false, 1, false)).toBe("3 句・念到第 2 句");
    expect(narrationSummary(n, false, 3, true)).toBe("3 句・都念完了・已排下一句");
  });
});
