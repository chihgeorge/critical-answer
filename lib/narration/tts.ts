// Pure decision logic for the browser TTS narration playback (Web Speech API). See
// docs/designs/dm-voice-narration-tts.md. The actual speechSynthesis calls live in
// app/room/[code]/screen/page.tsx — a real browser API, untestable in vitest's node
// environment — so this file only decides WHAT to speak and WHICH voice, kept pure and
// unit-tested.

export interface SpokenNarration {
  eventId: number;
  /** 1-3 segments — see docs/designs/multi-segment-narration.md. */
  lines: string[];
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/** Whether to speak this NARRATION. The caller must update its lastSpoken tracking to this
 * narration on EVERY call, regardless of the return value (see the doc comment on the caller's
 * ref in app/room/[code]/screen/page.tsx) — that's what makes the two rules below compose
 * correctly instead of needing a separate "have I seen anything yet" flag:
 *
 * - First narration seen this connection (lastSpoken is null): speak it only if its eventId is
 *   newer than the connection's baseline (the eventId seen in the first STATE/LOBBY snapshot
 *   after connect). onConnect's resent lastNarration always carries that same baseline eventId,
 *   so this suppresses exactly the replay, nothing else. A brand-new room with no narration yet
 *   has baseline 0, so its first live line (eventId >= 1) still speaks.
 * - Every narration after that: speak it iff it differs from what's already been "seen"
 *   (remembered, whether or not it was spoken) — either a genuinely new eventId, or the SAME
 *   eventId with a different segment array (length OR content). That second case is a host
 *   correction (HOST_EDIT_NARRATION re-broadcasts the same eventId with a corrected first
 *   segment) — including a correction to the very narration that was just suppressed as a
 *   replay, which an earlier version of this function got wrong by blocking anything
 *   at-or-below baseline unconditionally (adversarial review finding: the replayed line's own
 *   correction was silently never spoken). Comparing the whole array (not just index 0) also
 *   catches a same-eventId narration whose segment COUNT differs — e.g. the LLM producing 2
 *   segments one time and 3 the next for the same event — as a real content change, not a
 *   silently-ignored no-op (/plan-eng-review D1). */
export function shouldSpeakNarration(narration: SpokenNarration, baselineEventId: number, lastSpoken: SpokenNarration | null): boolean {
  if (!lastSpoken) return narration.eventId > baselineEventId;
  return narration.eventId !== lastSpoken.eventId || !sameLines(narration.lines, lastSpoken.lines);
}

/** Speak a live EPILOGUE, never onConnect's replay of one: the server marks the replay with
 * `replay: true` and sends the live broadcast without it. This replaced "was a live GAME_OVER seen
 * on this connection", which went wrong when a connection landed in the ~4 s between GAME_OVER and
 * the live EPILOGUE: that EPILOGUE was taken for a replay and never spoken. (The Worker deploys
 * before the frontend, so a page that reads the flag never talks to a server that doesn't send it.) */
export function shouldSpeakEpilogue(msg: { replay?: true }): boolean {
  return !msg.replay;
}

const ZH_OR_CMN_PREFIX_RE = /^(zh|cmn)/i;
const TW_RE = /TW/i;
const HANT_RE = /Hant/i;
const HK_OR_MO_RE = /HK|MO/i;

/** Loose match: different OS/browsers report Traditional Chinese as zh-TW, zh-Hant-TW,
 * cmn-Hant-TW (cmn is Mandarin's own ISO 639-3 code), zh_TW, or similar. An exact
 * `lang === "zh-TW"` comparison false-negatives on real voices that do support Traditional
 * Chinese.
 *
 * Two-pass, not a single combined regex: a voice explicitly tagged TW always wins. Only when
 * none exists does a bare Hant-tagged voice (Traditional script, no region — or an ambiguous
 * one) get picked as a fallback, and even then never one tagged HK or MO (adversarial review
 * finding: an earlier version matched "TW" OR "Hant" with no requirement that TW also be
 * present, so a Hong Kong Traditional-Chinese voice — Cantonese-accented, not the intended
 * Taiwan Mandarin — silently won over a missing TW-tagged voice). */
export function pickVoice<V extends { lang: string }>(voices: readonly V[]): V | undefined {
  const candidates = voices.filter((v) => ZH_OR_CMN_PREFIX_RE.test(v.lang));
  return candidates.find((v) => TW_RE.test(v.lang)) ?? candidates.find((v) => HANT_RE.test(v.lang) && !HK_OR_MO_RE.test(v.lang));
}
