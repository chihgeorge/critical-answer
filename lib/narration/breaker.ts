// Circuit breaker for the LLM narrator: three failures in a row, or any 401/403,
// switches LLM narration off so a dead key or outage stops costing 2 seconds per event.
// After `cooldownMs` one request goes through (half-open): a success closes it, a failure waits
// another cooldown. A refused key (401/403) stays off until the next key: it will not fix itself.

import { NarrationError } from "./errors";
import type { NarrationProvider } from "./scripted";

export function createBreaker(opts: { threshold?: number; cooldownMs?: number; now?: () => number; onTrip?: (why: string) => void; onRecover?: () => void }) {
  const threshold = opts.threshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  const now = opts.now ?? Date.now;
  let failures = 0;
  let open = false;
  let openedAt = 0;
  const trip = (why: string, retry = true) => {
    if (open) return;
    open = true;
    openedAt = retry ? now() : Infinity;
    opts.onTrip?.(why);
  };
  return {
    /** Read once per request: after the cooldown it lets that one through and restarts the cooldown, so one probe per cooldown. */
    get open() {
      if (open && now() - openedAt >= cooldownMs) {
        openedAt = now();
        return false;
      }
      return open;
    },
    success() {
      failures = 0;
      if (!open || openedAt === Infinity) return; // a refused key stays off even if an older request comes back
      open = false;
      opts.onRecover?.();
    },
    /** A new key was applied: whatever tripped the breaker may be fixed, so try again. */
    reset() {
      failures = 0;
      open = false;
    },
    failure(err: unknown) {
      if (err instanceof NarrationError && err.reason === "auth") return trip(`auth failure (${err.status})`, false);
      if (++failures >= threshold) trip(`${threshold} consecutive failures`);
    },
  };
}

export type Breaker = ReturnType<typeof createBreaker>;

export function withBreaker(inner: NarrationProvider, breaker: Breaker): NarrationProvider {
  return {
    get name() {
      return inner.name;
    },
    async narrate(event, o) {
      if (breaker.open) throw new NarrationError("breaker_open", "LLM narration is switched off for this room");
      try {
        const line = await inner.narrate(event, o);
        breaker.success();
        return line;
      } catch (err) {
        breaker.failure(err);
        throw err;
      }
    },
  };
}
