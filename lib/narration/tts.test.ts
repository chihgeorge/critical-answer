import { describe, it, expect } from "vitest";
import { shouldSpeakNarration, shouldSpeakEpilogue, pickVoice, speechLinesOf } from "./tts";

describe("shouldSpeakNarration", () => {
  it("suppresses onConnect's resent lastNarration (eventId at or below the connection baseline)", () => {
    expect(shouldSpeakNarration({ eventId: 5, line: "x" }, 5, null)).toBe(false);
    expect(shouldSpeakNarration({ eventId: 3, line: "x" }, 5, null)).toBe(false); // stale, shouldn't happen but still guarded
  });

  it("speaks a genuinely new eventId (above baseline)", () => {
    expect(shouldSpeakNarration({ eventId: 6, line: "x" }, 5, null)).toBe(true);
  });

  it("speaks the very first live narration of a brand-new room (baseline 0, no resend)", () => {
    expect(shouldSpeakNarration({ eventId: 1, line: "第一題" }, 0, null)).toBe(true);
  });

  it("does not re-speak an identical narration already spoken", () => {
    const spoken = { eventId: 6, line: "x", then: "y" };
    expect(shouldSpeakNarration(spoken, 5, spoken)).toBe(false);
  });

  it("re-speaks the same eventId when the text changed (HOST_EDIT_NARRATION correction)", () => {
    const lastSpoken = { eventId: 6, line: "原本的答案", then: "y" };
    const edited = { eventId: 6, line: "修正後的答案", then: "y" };
    expect(shouldSpeakNarration(edited, 5, lastSpoken)).toBe(true);
  });

  it("speaks a new higher eventId even if lastSpoken is set", () => {
    const lastSpoken = { eventId: 6, line: "x" };
    expect(shouldSpeakNarration({ eventId: 7, line: "z" }, 5, lastSpoken)).toBe(true);
  });
});

describe("shouldSpeakEpilogue", () => {
  it("speaks only after a live GAME_OVER was observed this connection", () => {
    expect(shouldSpeakEpilogue(true)).toBe(true);
    expect(shouldSpeakEpilogue(false)).toBe(false); // onConnect's resend of an already-finished game
  });
});

describe("pickVoice", () => {
  it("matches common Traditional Chinese lang tag variants", () => {
    expect(pickVoice([{ lang: "en-US" }, { lang: "zh-TW" }])?.lang).toBe("zh-TW");
    expect(pickVoice([{ lang: "zh-Hant-TW" }])?.lang).toBe("zh-Hant-TW");
    expect(pickVoice([{ lang: "cmn-Hant-TW" }])?.lang).toBe("cmn-Hant-TW");
    expect(pickVoice([{ lang: "zh_TW" }])?.lang).toBe("zh_TW");
  });

  it("does not match simplified Chinese or unrelated languages", () => {
    expect(pickVoice([{ lang: "zh-CN" }, { lang: "en-US" }, { lang: "ja-JP" }])).toBeUndefined();
  });

  it("returns undefined for an empty voice list", () => {
    expect(pickVoice([])).toBeUndefined();
  });
});

describe("speechLinesOf", () => {
  it("returns just the result line when there's no follow-up", () => {
    expect(speechLinesOf({ eventId: 1, line: "答對了" })).toEqual(["答對了"]);
  });

  it("returns both lines in order when a follow-up exists", () => {
    expect(speechLinesOf({ eventId: 1, line: "答對了", then: "輪到藍隊了" })).toEqual(["答對了", "輪到藍隊了"]);
  });
});
