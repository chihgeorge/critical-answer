// Client-side bookkeeping for narration lines (safe to import in the browser).

import { sanitizeText } from "../protocol";
import { MAX_LINE } from "./runner";

/** `lines`: 1-3 segments, played in order (the result, an atmosphere or host line on big moments, a transition when
 * there's a next team — see runner.ts targetSegmentCount and docs/designs/multi-segment-narration.md). `rev` counts host edits of this eventId (host-narration-edit.md D14). */
export type NarrationState = { eventId: number; lines: string[]; rev: number } | null;

/** Keep the line with the highest eventId; a late, older line is ignored. The same eventId again is a host edit: take it. */
export function keepLatest(prev: NarrationState, msg: { eventId: number; lines: string[]; rev?: number }): NarrationState {
  return prev && prev.eventId > msg.eventId ? prev : { eventId: msg.eventId, lines: msg.lines, rev: msg.rev ?? 0 };
}

/** A host's edit as the room stores it: one line, cleaned, cut to MAX_LINE. The panel compares with it to tell its own edit landing from another device's. */
export function editedLine(raw: string): string {
  return sanitizeText(raw.replace(/\s+/g, " "), MAX_LINE);
}

/** STATE for a new event arrives before its narration: show the `…` loader in between. */
export function isPending(stateEventId: number, narration: NarrationState): boolean {
  return stateEventId > (narration?.eventId ?? 0);
}

/** A clip owns its sound while playing. A reveal no longer holds the narration: it is read with the phones (#405). */
export function narrationCanSpeak(sceneEventId: number, narrationEventId: number, videoPlaying: boolean): boolean {
  return sceneEventId === narrationEventId && !videoPlaying;
}

/** A NARRATION for the narration this screen already tracks, after the reveal closed: a line the room added then (the
 * handoff after 下一題, #350), read over the scene. Over a reveal, or for another narration, it is not. */
export function handoffAdded(revealUp: boolean, trackedEventId: number | undefined, eventId: number): boolean {
  return !revealUp && trackedEventId === eventId;
}

/** Whether to voice a NARRATION: every narration except the served dish's own (上菜 said it, cooking I1); for that one,
 * only the lines the room added after 下一題. */
export function voiceNarration(speakIt: boolean, eventId: number, servedEventId: number | null, added: boolean): boolean {
  return speakIt && (eventId !== servedEventId || added);
}

/** Where the dialogue box starts when `read` of its `count` lines are already read (#351: the served reveal's narration
 * after 下一題): on the first unread line, or on the last one already typed when none is unread yet. */
export function sequenceStart(read: number, count: number): { line: number; typed: boolean } {
  return { line: Math.max(0, Math.min(read, count - 1)), typed: read > 0 && read >= count };
}

/** The line the dialogue box shows: never behind the voice reading it (subtitles follow speech), and the last line at
 * once on a hidden tab, whose throttled timers would leave the typing (and the room's progress) far behind (#365). */
export function boxLine(i: number, count: number, voiceLine: number | undefined, hidden: boolean): number {
  const last = Math.max(0, count - 1);
  if (hidden) return last;
  return voiceLine === undefined ? i : Math.min(Math.max(i, voiceLine), last);
}

export const revealDialogue = (scored: boolean): string => scored ? "答對！" : "……";

/** Where the dialogue box goes for a NARRATION `jump` (#405): to line `jump`, the line that overrides one already
 * said, when it is ahead of line `i`; null to stay. */
export function jumpLine(i: number, jump: number | undefined, count: number): number | null {
  return jump !== undefined && jump > i && jump < count ? jump : null;
}

/** What the big screen's box says over an answer reveal (#405): this turn's narration once it has come in (the room
 * holds the handoff back until 下一題), else 「答對！」 or 「……」 while it is on its way. */
export function revealLines(narration: NarrationState, eventId: number, scored: boolean): { lines: string[]; narrated: boolean } {
  return narration && narration.eventId === eventId ? { lines: narration.lines, narrated: true } : { lines: [revealDialogue(scored)], narrated: false };
}

/** The first index where two sets of lines differ (a length change counts), or -1 when they are the same. */
export function firstChange(prev: readonly string[], next: readonly string[]): number {
  const n = Math.max(prev.length, next.length);
  for (let i = 0; i < n; i++) if (prev[i] !== next[i]) return i;
  return -1;
}

/** The lines changed while line `current` was being read: the index to read again from, or null to read on
 * (host-narration-edit.md D13). Only a change at or before the current line restarts; a later one is simply read
 * when its turn comes, so the line being read is never cut off. */
export function resumeFrom(prev: readonly string[], next: readonly string[], current: number): number | null {
  const d = firstChange(prev, next);
  return d === -1 || d > current ? null : d;
}

/** How many lines the big screen has read: typed, and spoken too when its voice reads them (D11). */
export function readCount(typed: number, spoken: number | null): number {
  return spoken === null ? typed : Math.min(typed, spoken);
}

/** The host's one-line summary of the narration panel (D6, D15). `done` is the big screen's progress for this narration. */
export function narrationSummary(narration: NarrationState, pending: boolean, done: number, queued: boolean): string {
  if (pending) return "旁白生成中…";
  if (!narration) return "還沒有旁白";
  const n = narration.lines.length;
  const read = done <= 0 ? "大螢幕還沒開始念" : done >= n ? "都念完了" : `念到第 ${done + 1} 句`;
  return `${n} 句・${read}${queued ? "・已排下一句" : ""}`;
}
