// Circuit breaker for the LLM narrator: three failures in a row, or any 401/403,
// switches LLM narration off for the rest of the room so a dead key or outage
// stops costing 2 seconds per event.

import { NarrationError } from "./errors";
import type { NarrationProvider } from "./scripted";

export function createBreaker(opts: { threshold?: number; onTrip?: (why: string) => void }) {
  const threshold = opts.threshold ?? 3;
  let failures = 0;
  let open = false;
  const trip = (why: string) => {
    if (open) return;
    open = true;
    opts.onTrip?.(why);
  };
  return {
    get open() {
      return open;
    },
    success() {
      failures = 0;
    },
    /** A new key was applied: whatever tripped the breaker may be fixed, so try again. */
    reset() {
      failures = 0;
      open = false;
    },
    failure(err: unknown) {
      if (err instanceof NarrationError && err.reason === "auth") return trip(`auth failure (${err.status})`);
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
