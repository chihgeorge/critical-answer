// Which bank editor controls (app/bank-editor/page.tsx) are locked while requests are in flight, here so it has
// unit tests. Client-safe: no bank data.

/** A load that hangs gives up after this long, so 載入中… and the locked fields don't stay forever. */
export const BANK_LOAD_TIMEOUT_MS = 15_000;
/** An image upload (up to 5 MB) gives up after this long, so a hung one doesn't block 儲存 forever. */
export const IMAGE_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Every in-flight request ends in setBank: a load or a save with the server's bank, an upload with its new image
 * key. So the fields lock during a load or save (an edit made meanwhile would be replaced), and load and save also
 * wait for uploads: an upload landing after a load writes into the new bank, and one landing during a save is
 * replaced by the saved bank (the old image comes back, the new one is orphaned on R2).
 */
export function editorLocks(s: { loading: boolean; saving: boolean; uploads: number }) {
  const busy = s.loading || s.saving;
  return { fields: busy, load: busy || s.uploads > 0, save: busy || s.uploads > 0 };
}
