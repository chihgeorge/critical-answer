/** NTP-style clock sync with the room (docs/designs/timing-tap.md 時間怎麼量 1). Client-safe: no bank data.
 * A device sends CLOCK_PING { t } with its `performance.now()`, the room answers CLOCK_PONG { t, server } with its
 * `Date.now()`. `offset` maps the device's `performance.now()` timeline (which `event.timeStamp` shares) onto the
 * room's epoch ms: server ≈ local + offset. */

/** Samples kept; the one with the smallest round trip wins (its asymmetry error is smallest). */
export const CLOCK_SAMPLES = 8;
/** A burst of pings when a timing question shows, this far apart, then one every CLOCK_REFRESH_MS. */
export const CLOCK_BURST = 8;
export const CLOCK_BURST_GAP_MS = 150;
export const CLOCK_REFRESH_MS = 5000;
/** An offset whose newest sample is older than this is stale: iOS stops `performance.now()` while a page sleeps. */
export const CLOCK_STALE_MS = 10_000;

export interface ClockSample {
  /** server − local midpoint, ms. */
  offset: number;
  /** Round trip, ms. */
  rtt: number;
  /** Local `performance.now()` when the pong arrived. */
  at: number;
}

/** One ping/pong: sent at local `t0`, answered with `server`, received at local `t1`. */
export function clockSample(t0: number, t1: number, server: number): ClockSample {
  return { offset: server - (t0 + t1) / 2, rtt: t1 - t0, at: t1 };
}

/** The last CLOCK_SAMPLES samples, newest last. A negative round trip (a clock that went backwards) is dropped. */
export function addSample(samples: ClockSample[], s: ClockSample): ClockSample[] {
  if (!(s.rtt >= 0) || !Number.isFinite(s.offset)) return samples;
  return [...samples, s].slice(-CLOCK_SAMPLES);
}

/** The offset of the smallest-RTT sample, or null with no samples or when the newest is older than CLOCK_STALE_MS. */
export function bestOffset(samples: ClockSample[], now: number): number | null {
  if (!samples.length || now - samples[samples.length - 1].at > CLOCK_STALE_MS) return null;
  return samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
}
