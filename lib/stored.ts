// localStorage that never throws: private browsing or blocked storage just means nothing is
// remembered past this page load. Client-only, and read in an effect after mount, never during
// render (SSR has no localStorage, so a render-time read causes a hydration mismatch).

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Still works for this page load, just won't be remembered.
  }
}
