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
 *   correction (HOST_EDIT_NARRATION re-broadcasts the same eventId with line N
 *   replaced; the screen reads on from that line, see trackNarration in the screen page) — including a correction to the very narration that was just suppressed as a
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
 * Taiwan Mandarin — silently won over a missing TW-tagged voice).
 *
 * The voice saved by the screen's voice picker wins while this browser still offers it. Among TW voices: a known female
 * voice (FEMALE_TW order) first, then any voice not known to be male, then the first one. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], savedUri?: string | null): V | undefined {
  const saved = savedUri ? voices.find((v) => v.voiceURI === savedUri) : undefined;
  if (saved) return saved;
  const candidates = voices.filter((v) => /^(zh|cmn)/i.test(v.lang));
  const tw = candidates.filter((v) => /TW/i.test(v.lang));
  for (const name of FEMALE_TW) {
    const found = tw.find((v) => name.test(v.name ?? ""));
    if (found) return found;
  }
  return tw.find((v) => !MALE_TW.test(v.name ?? "")) ?? tw[0] ?? candidates.find((v) => /Hant/i.test(v.lang) && !/HK|MO/i.test(v.lang));
}

type VoiceLike = { lang: string; name?: string; voiceURI?: string };

/** Known Taiwan female voices, best first (a playtest found a male default voice unwanted), matched on the voice's
 * name: Apple's Meijia, Chrome's Google 國語（臺灣）, then Microsoft's (Edge / Windows). */
const FEMALE_TW = [/Meijia|美佳/i, /Google\s*國語/i, /HsiaoChen|曉臻/i, /HsiaoYu|曉雨/i, /Hanhan|涵涵/i, /Yating|雅婷/i];
/** Known Taiwan male voices: never the default while another TW voice is offered. */
const MALE_TW = /Zhiwei|志偉|Yunjhe|雲哲/i;

/** Every Chinese voice, for the screen's voice picker: TW-tagged first, then the other zh / cmn ones, each group in the
 * browser's own order. */
export function chineseVoices<V extends VoiceLike>(voices: readonly V[]): V[] {
  const zh = voices.filter((v) => /^(zh|cmn)/i.test(v.lang));
  return [...zh.filter((v) => /TW/i.test(v.lang)), ...zh.filter((v) => !/TW/i.test(v.lang))];
}

/** Longest a line may take to speak before the screen gives up on its onend and reads on: some browsers sometimes
 * never fire onend or onerror, which would stop the voice and freeze the host's progress (host-narration-edit.md D11).
 * About 0.4 s a character (Mandarin TTS reads roughly 4 a second) plus 3 s for a slow voice to start. */
export function speechTimeoutMs(line: string): number {
  return [...line].length * 400 + 3000;
}
