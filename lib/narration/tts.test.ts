import { describe, it, expect } from "vitest";
import { shouldSpeakNarration, shouldSpeakEpilogue, pickVoice } from "./tts";

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

  it("re-speaks a correction to the exact narration that was just suppressed as onConnect's replay (adversarial review finding)", () => {
    // A client connects/reconnects AFTER narration eventId 5 already happened: baseline is 5,
    // onConnect replays that same eventId 5 — correctly suppressed (not spoken), but the
    // caller must still remember it as lastSpoken (see the ref's doc comment in the page).
    const replayed = { eventId: 5, line: "原本的答案" };
    expect(shouldSpeakNarration(replayed, 5, null)).toBe(false);
    // The host then corrects that exact line. Same eventId, different text — must speak,
    // now that lastSpoken is the replay's own content rather than null.
    const corrected = { eventId: 5, line: "修正後的答案" };
    expect(shouldSpeakNarration(corrected, 5, replayed)).toBe(true);
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

  it("never picks a Hong Kong or Macau voice — Hant alone is not enough (adversarial review finding)", () => {
    // An earlier version matched "TW" OR "Hant" with no requirement that TW also be present, so
    // a Cantonese-accented zh-Hant-HK voice would win over having no Taiwan voice at all.
    expect(pickVoice([{ lang: "zh-Hant-HK" }])).toBeUndefined();
    expect(pickVoice([{ lang: "zh-Hant-MO" }])).toBeUndefined();
  });

  it("prefers a TW-tagged voice over a bare Hant-tagged one when both are offered", () => {
    const tw = { lang: "zh-TW" };
    const hant = { lang: "zh-Hant" };
    expect(pickVoice([hant, tw])).toBe(tw);
  });

  it("falls back to a bare Hant-tagged voice (no region) only when no TW-tagged voice exists", () => {
    const hant = { lang: "zh-Hant" };
    expect(pickVoice([hant])).toBe(hant);
  });
});

