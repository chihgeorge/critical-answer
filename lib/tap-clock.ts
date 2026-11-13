/** Timing-tap math (docs/designs/timing-tap.md): the big screen's media anchor, song time, round close, results.
 * Pure and client-safe: no bank data. Song time and every value here are ms unless the name ends in _S. */

/** The round closes this long after the target (song time). A bank target needs this much clip after it. */
export const TAP_GRACE_S = 2;
export const TAP_GRACE_MS = TAP_GRACE_S * 1000;
/** Everyone tapped: the round still waits until this long after the target, so the room hears the beat. */
export const TAP_SETTLE_MS = 500;
/** A tap stamped earlier than this before the room received it is refused (tap_late): a resend or a slow network. */
export const TAP_MAX_LAG_MS = 1000;
/** A tap stamped after the room received it is clamped to this far ahead (a device clock a little fast). */
export const TAP_MAX_LEAD_MS = 300;
/** No clock report from the chosen big screen for this long: its anchor is gone (a frozen tab). */
export const TAP_CLOCK_STALE_MS = 2500;
/** Bank health: a target closer than this to the clip start leaves the screen's clock too little time to settle. */
export const TAP_HEALTH_LEAD_S = 3;
/** Speaker latency the host may set (E3-lite), ms. */
export const MAX_TAP_LATENCY_MS = 1000;
/** Other teams' small bonus by |error|: within 0.3 s +3, 0.6 s +2, 1 s +1. The winner gets the boss hit instead. */
export const TAP_BONUS_TIERS: readonly (readonly [number, number])[] = [
  [300, 3],
  [600, 2],
  [1000, 1],
];

/** The screen samples its player this often; an anchor that moves more than ANCHOR_JUMP_MS is a seek or a stall. */
export const ANCHOR_POLL_MS = 30;
export const ANCHOR_JUMP_MS = 150;
export const ANCHOR_WINDOW = 8;
/** The screen sends a changed anchor at most this often, and an unchanged one every ANCHOR_HEARTBEAT_MS. */
export const ANCHOR_SEND_GAP_MS = 250;
export const ANCHOR_HEARTBEAT_MS = 1000;
/** A change smaller than this is not worth a message. */
export const ANCHOR_SEND_MIN_MS = 10;

/** The screen's anchor window after one more raw sample (server time of song 0 ms). A player's reported time is only
 * ever late, so the anchor is the window's minimum; a jump past ANCHOR_JUMP_MS (a seek, a stall resumed) restarts it. */
export function nextAnchorWindow(window: number[], raw: number): number[] {
  if (!Number.isFinite(raw)) return window;
  if (window.length && Math.abs(raw - Math.min(...window)) > ANCHOR_JUMP_MS) return [raw];
  return [...window, raw].slice(-ANCHOR_WINDOW);
}

export const anchorOf = (window: number[]): number | null => (window.length ? Math.min(...window) : null);

/** Song time (ms into the video) of a server instant: the speaker latency is how much later the room hears it. */
export const songMs = (serverMs: number, anchor: number, latencyMs: number): number => serverMs - anchor - latencyMs;
/** The server instant of a song time: songMs's inverse. */
export const serverMsOf = (song: number, anchor: number, latencyMs: number): number => song + anchor + latencyMs;

/** A tap's server time as the room takes it, or "late" when it was stamped too long before `received`. */
export function acceptTapAt(at: number, received: number): number | "late" {
  if (at < received - TAP_MAX_LAG_MS) return "late";
  return Math.min(at, received + TAP_MAX_LEAD_MS);
}

/** The song time the round closes at: `target + grace`, or, once everyone eligible tapped, `target + settle`. */
export const closeSongMs = (targetMs: number, allTapped: boolean): number => targetMs + (allTapped ? TAP_SETTLE_MS : TAP_GRACE_MS);

export interface TapResult {
  teamId: string;
  /** Song time − target: negative is early. */
  errorMs: number;
  /** Small bonus; 0 for the winner, who gets the boss hit. */
  bonus: number;
}

export function tapBonus(errorMs: number): number {
  const abs = Math.abs(errorMs);
  return TAP_BONUS_TIERS.find(([ms]) => abs <= ms)?.[1] ?? 0;
}

/** Taps (in the order the room received them) ranked closest first; an equal |error| goes to the earlier one. The
 * first is the winner (no error cap, owner U2). `tie`: the winner's |error| equals the runner-up's. */
export function tapResults(taps: { teamId: string; ms: number }[], targetMs: number): { rows: TapResult[]; tie: boolean } {
  const ranked = taps
    .map((t, i) => ({ teamId: t.teamId, errorMs: Math.round(t.ms - targetMs), i }))
    .sort((a, b) => Math.abs(a.errorMs) - Math.abs(b.errorMs) || a.i - b.i);
  const rows = ranked.map((r, k) => ({ teamId: r.teamId, errorMs: r.errorMs, bonus: k === 0 ? 0 : tapBonus(r.errorMs) }));
  const tie = rows.length > 1 && Math.abs(rows[0].errorMs) === Math.abs(rows[1].errorMs);
  return { rows, tie };
}

/** "3:10.35": a song time in ms, to the hundredth. */
export function formatSongTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** "早 0.12 秒" / "晚 0.12 秒" / "準 0.00 秒". */
export function formatTapError(errorMs: number): string {
  const s = (Math.abs(errorMs) / 1000).toFixed(2);
  return errorMs < 0 ? `早 ${s} 秒` : errorMs > 0 ? `晚 ${s} 秒` : `準 ${s} 秒`;
}

/** The median error of a reveal's taps, or null with none. */
export function medianError(errors: number[]): number | null {
  if (!errors.length) return null;
  const s = [...errors].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** The latency the host's 「把延遲改成 X ms」 sets: the current one plus the median error, 0–MAX_TAP_LATENCY_MS. */
export const suggestedLatency = (current: number, median: number): number => Math.min(MAX_TAP_LATENCY_MS, Math.max(0, Math.round(current + median)));
