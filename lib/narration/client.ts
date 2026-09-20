// Client-side bookkeeping for narration lines (safe to import in the browser).

export type NarrationState = { eventId: number; line: string } | null;

/** Keep the line with the highest eventId; a late, older line is ignored. */
export function keepLatest(prev: NarrationState, msg: { eventId: number; line: string }): NarrationState {
  return prev && prev.eventId > msg.eventId ? prev : { eventId: msg.eventId, line: msg.line };
}

/** STATE for a new event arrives before its narration: show the `…` loader in between. */
export function isPending(stateEventId: number, narration: NarrationState): boolean {
  return stateEventId > (narration?.eventId ?? 0);
}
