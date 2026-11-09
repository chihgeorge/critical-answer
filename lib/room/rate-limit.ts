/**
 * Per-socket message budget (a token bucket): `burst` messages at once, refilled at `perSecond`. A message over
 * budget is dropped, not answered and not punished with a close: a real phone tapping fast never gets near it, and a
 * client stuck in a send loop is just ignored instead of reconnecting over and over. The room's Durable Object is
 * single-threaded, so this keeps one socket from slowing a live game for everyone.
 */
export const MSG_BURST = 30;
export const MSG_PER_SECOND = 10;

export class RateLimiter {
  private buckets = new WeakMap<object, { tokens: number; at: number }>();

  constructor(
    private now: () => number = Date.now,
    private burst = MSG_BURST,
    private perSecond = MSG_PER_SECOND,
  ) {}

  /** Spends one message for `key` (a socket). False: over budget, drop it. */
  allow(key: object): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 1000) * this.perSecond);
    b.at = t;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
