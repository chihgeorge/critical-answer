// The per-room cap on paid AI narration calls, as a wrapper around the narrator (same shape as
// withBreaker in lib/narration/breaker.ts). The breaker goes outside it, so a call the breaker
// refuses is never counted:  withBreaker(withBudget(narrator, hooks), breaker).

import { NarrationError } from "../narration/errors";
import type { NarrationProvider } from "../narration/scripted";

/** All the host ever sees of a key: its last 4 characters. */
export const keyHint = (key: string) => `…${key.slice(-4)}`;

export interface BudgetHooks {
  canSpend(): boolean;
  /** Counts one call and returns the generation of the key it is about to use. */
  spend(): number;
  /** False once the host has applied another key since `generation`. */
  isCurrent(generation: number): boolean;
  /** The current key was refused (401/403): drop it. */
  onAuthRejected(): void;
}

export function withBudget(inner: NarrationProvider, hooks: BudgetHooks): NarrationProvider {
  return {
    get name() {
      return inner.name;
    },
    async narrate(event, o) {
      // Check and count before the first await: the room is single-threaded, so concurrent
      // narrations cannot both pass the check for the last call left.
      if (!hooks.canSpend()) throw new NarrationError("config_missing", "AI budget used up");
      const generation = hooks.spend();
      try {
        return await inner.narrate(event, o);
      } catch (err) {
        if (err instanceof NarrationError && err.reason === "auth") {
          // A key the host has already replaced: not a reason to drop the new one or trip the breaker.
          if (!hooks.isCurrent(generation)) throw new NarrationError("upstream", "a replaced key was refused", err.status);
          hooks.onAuthRejected();
        }
        throw err;
      }
    },
  };
}
