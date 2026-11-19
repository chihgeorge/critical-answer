import { describe, it, expect } from "vitest";
import { boxLine, editedLine, firstChange, handoffAdded, jumpLine, keepLatest, isPending, narrationCanSpeak, narrationSummary, readCount, resumeFrom, revealDialogue, revealLines, sequenceStart, voiceNarration } from "./client";

// Value: protects=the next-team line added after 下一題 is spoken, a late line over a reveal is not (#350, #352);
// fails_when=handoffAdded ignores the reveal or the tracked narration, or voiceNarration voices the served dish's own lines.
describe("the handoff added after a served reveal (big screen)", () => {
  it("is an added line only after the reveal closed, for the narration already tracked", () => {
    expect(handoffAdded(false, 7, 7)).toBe(true);
    expect(handoffAdded(true, 7, 7)).toBe(false); // still under the reveal
    expect(handoffAdded(false, 6, 7)).toBe(false); // a new narration, not an addition
    expect(handoffAdded(false, undefined, 7)).toBe(false);
  });
  it("voices the served narration only for what was added; other narrations as usual", () => {
    expect(voiceNarration(true, 7, 7, false)).toBe(false); // 上菜 already said it
    expect(voiceNarration(true, 7, 7, true)).toBe(true);
    expect(voiceNarration(true, 8, 7, false)).toBe(true);
    expect(voiceNarration(true, 8, null, false)).toBe(true);
    expect(voiceNarration(false, 7, 7, true)).toBe(false);
  });
});

// Value: protects=after 上菜 and 下一題 the box goes on to the added line instead of retyping the result (#351);
// fails_when=sequenceStart starts at 0, or past the last line, or leaves an already-read line to be typed again.
describe("sequenceStart (where the dialogue box starts)", () => {
  it("starts at the top with nothing read", () => expect(sequenceStart(0, 2)).toEqual({ line: 0, typed: false }));
  it("starts on the first unread line", () => expect(sequenceStart(1, 2)).toEqual({ line: 1, typed: false }));
  it("holds the last line, already typed, until a line is added", () => {
    expect(sequenceStart(2, 2)).toEqual({ line: 1, typed: true });
    expect(sequenceStart(5, 2)).toEqual({ line: 1, typed: true });
  });
  it("never starts below 0 on an empty box", () => expect(sequenceStart(0, 0)).toEqual({ line: 0, typed: false }));
});

describe("narration on a reveal (#405)", () => {
  // Value: protects=the big screen reads this turn's narration with the phones over a reveal; fails_when=it goes back to 「答對！」 only
  it("reads this turn's narration once it is in, and says 答對！ or …… only while it is on its way", () => {
    expect(revealDialogue(true)).toBe("答對！");
    expect(revealDialogue(false)).toBe("……");
    const n = { eventId: 4, lines: ["甲隊打倒史萊姆", "史萊姆滾走了"], rev: 0 };
    expect(revealLines(n, 4, true)).toEqual({ lines: n.lines, narrated: true });
    expect(revealLines(n, 5, true)).toEqual({ lines: ["答對！"], narrated: false });
    expect(revealLines(null, 4, false)).toEqual({ lines: ["……"], narrated: false });
  });
  it("speaks over a reveal; waits only for a playing video, and drops a line from an older room event", () => {
    expect(narrationCanSpeak(4, 4, true)).toBe(false);
    expect(narrationCanSpeak(5, 4, false)).toBe(false);
    expect(narrationCanSpeak(4, 4, false)).toBe(true);
  });
});

describe("jumpLine (#405)", () => {
  // Value: protects=a line that overrides one already said (送王房) goes up at once; fails_when=the box waits LINE_PAUSE_MS or jumps back
  it("moves to the overriding line when it is ahead, and stays otherwise", () => {
    expect(jumpLine(1, 2, 3)).toBe(2);
    expect(jumpLine(0, 2, 3)).toBe(2);
    expect(jumpLine(2, 2, 3)).toBeNull();
    expect(jumpLine(2, 1, 3)).toBeNull();
    expect(jumpLine(1, undefined, 3)).toBeNull();
    expect(jumpLine(1, 3, 3)).toBeNull();
  });
});

describe("boxLine (#365)", () => {
  // Value: protects=the words on screen are the words heard, and a hidden tab keeps up with the room; fails_when=the box types on its own clock under the voice
  it("follows the voice's line, never goes back, and stops at the last line", () => {
    expect(boxLine(0, 3, undefined, false)).toBe(0);
    expect(boxLine(0, 3, 2, false)).toBe(2);
    expect(boxLine(2, 3, 1, false)).toBe(2);
    expect(boxLine(0, 3, 5, false)).toBe(2);
  });
  it("shows the last line at once on a hidden tab", () => {
    expect(boxLine(0, 3, undefined, true)).toBe(2);
    expect(boxLine(0, 3, 0, true)).toBe(2);
    expect(boxLine(0, 0, undefined, true)).toBe(0);
  });
});

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

describe("editedLine", () => {
  // Protects the panel's D12 close: it closes only when the broadcast line equals editedLine(draft), so this must match
  // what the room stores. Fails if the room's cleanup and this helper drift apart, and the host's own edit then never closes.
  it("folds whitespace, strips markup characters and cuts to MAX_LINE, like the room", () => {
    expect(editedLine("  牠\n  醒了 <b> ")).toBe("牠 醒了 b");
    expect(editedLine("字".repeat(60))).toBe("字".repeat(50));
  });
});
