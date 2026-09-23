// Pure decision logic for the browser TTS narration playback (Web Speech API). See
// docs/designs/dm-voice-narration-tts.md. The actual speechSynthesis calls live in
// app/room/[code]/screen/page.tsx — a real browser API, untestable in vitest's node
// environment — so this file only decides WHAT to speak and WHICH voice, kept pure and
// unit-tested.

export interface SpokenNarration {
  eventId: number;
  line: string;
  then?: string;
}

/** Speak this NARRATION iff its eventId is newer than the connection's baseline (the eventId
 * seen in the very first STATE/LOBBY snapshot after connect — onConnect's resent
 * lastNarration always carries that same eventId, so this cleanly separates a replay from
 * anything new without persisting state or comparing text) and it's not identical to what was
 * already spoken. A host correction (HOST_EDIT_NARRATION) re-broadcasts the same eventId with
 * different text; it still passes because it differs from lastSpoken. */
export function shouldSpeakNarration(narration: SpokenNarration, baselineEventId: number, lastSpoken: SpokenNarration | null): boolean {
  if (narration.eventId <= baselineEventId) return false;
  if (!lastSpoken) return true;
  return narration.eventId !== lastSpoken.eventId || narration.line !== lastSpoken.line || narration.then !== lastSpoken.then;
}

/** Speak EPILOGUE iff a live GAME_OVER was already observed on this connection — onConnect's
 * resend of an already-finished game's epilogue text is never preceded by a GAME_OVER on the
 * CURRENT connection (GAME_OVER is only ever broadcast live, never replayed at connect; see
 * dungeon-room.ts's onConnect), so this distinguishes a live epilogue from a stale replay
 * without comparing text or persisting anything across reconnects. */
export function shouldSpeakEpilogue(sawLiveGameOver: boolean): boolean {
  return sawLiveGameOver;
}

const ZH_OR_CMN_PREFIX_RE = /^(zh|cmn)/i;
const TW_HANT_RE = /(TW|Hant)/i;

/** Loose match: different OS/browsers report Traditional Chinese as zh-TW, zh-Hant-TW,
 * cmn-Hant-TW (cmn is Mandarin's own ISO 639-3 code), zh_TW, or similar. An exact
 * `lang === "zh-TW"` comparison false-negatives on real voices that do support Traditional
 * Chinese. */
export function pickVoice<V extends { lang: string }>(voices: readonly V[]): V | undefined {
  return voices.find((v) => ZH_OR_CMN_PREFIX_RE.test(v.lang) && TW_HANT_RE.test(v.lang));
}

/** The lines to speak, in order, for a NARRATION message — mirrors lib/narration/client.ts's
 * linesOf() so TTS never drops the `then` (next-team) line that the screen already displays. */
export function speechLinesOf(narration: SpokenNarration): string[] {
  return [narration.line, ...(narration.then ? [narration.then] : [])];
}
