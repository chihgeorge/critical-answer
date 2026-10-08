// Client-side bookkeeping for narration lines (safe to import in the browser).

/** `lines`: 1-3 segments, played in order (result, atmosphere, transition — see
 * docs/designs/multi-segment-narration.md). */
export type NarrationState = { eventId: number; lines: string[] } | null;

/** Keep the line with the highest eventId; a late, older line is ignored. */
export function keepLatest(prev: NarrationState, msg: { eventId: number; lines: string[] }): NarrationState {
  return prev && prev.eventId > msg.eventId ? prev : { eventId: msg.eventId, lines: msg.lines };
}

/** STATE for a new event arrives before its narration: show the `…` loader in between. */
export function isPending(stateEventId: number, narration: NarrationState): boolean {
  return stateEventId > (narration?.eventId ?? 0);
}
