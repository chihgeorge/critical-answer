/**
 * Parse a millisecond duration from an env var (e.g. `ROOM_IDLE_MS`). Anything that is not a positive,
 * finite number — missing, empty, negative, zero, or not a number at all — falls back to the caller's
 * default rather than producing a broken duration.
 */
export function positiveMs(v: string | undefined): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
