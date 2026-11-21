/** The one bank-editor preview allowed to play: each YouTube player costs ~12 MB heap and 70–90 MB of browser memory,
 * so ▶ 試聽 on one question stops the one before it. Holds a preview's id (React's useId), or null. */
let active: string | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

export function activePreview(): string | null {
  return active;
}

/** This preview plays now; any other one unmounts. */
export function claimPreview(id: string): void {
  if (active === id) return;
  active = id;
  notify();
}

/** This preview is done (its clip ended, or its row unmounted); a no-op when another one has taken over. */
export function releasePreview(id: string): void {
  if (active !== id) return;
  active = null;
  notify();
}

export function subscribePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
