// A short per-button cooldown for host buttons that act on every press (⚙ 更多's 修正): a double tap
// before the next STATE greys the button would otherwise apply twice.

/** How long a 修正 button ignores further presses after one goes through. */
export const FIX_COOLDOWN_MS = 400;

/** Returns a gate: `allow(key)` is true for the first press of `key`, then false until `ms` have passed. Keys are
 * independent, so −5 right after +5 (or another team's button) still goes through. */
export function pressCooldown(ms: number = FIX_COOLDOWN_MS, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return (key: string): boolean => {
    const t = now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < ms) return false;
    last.set(key, t);
    return true;
  };
}
