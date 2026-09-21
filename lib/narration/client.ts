// Client-side bookkeeping for narration lines (safe to import in the browser).

/** `then` is the follow-up line about the next team, shown after `line`. */
export type NarrationState = { eventId: number; line: string; then?: string } | null;

/** Keep the line with the highest eventId; a late, older line is ignored. */
export function keepLatest(prev: NarrationState, msg: { eventId: number; line: string; then?: string }): NarrationState {
  return prev && prev.eventId > msg.eventId ? prev : { eventId: msg.eventId, line: msg.line, then: msg.then };
}

/** The lines to play in order: the result, then (if any) the turn prompt. */
export function linesOf(n: NarrationState): string[] {
  return n ? [n.line, ...(n.then ? [n.then] : [])] : [];
}

/** STATE for a new event arrives before its narration: show the `…` loader in between. */
export function isPending(stateEventId: number, narration: NarrationState): boolean {
  return stateEventId > (narration?.eventId ?? 0);
}
