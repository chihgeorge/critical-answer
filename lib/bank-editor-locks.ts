// When the bank editor (app/bank-editor/page.tsx) locks its fields and buttons, here so it has unit tests.
// Client-safe: no bank data.

/** A load that hangs gives up after this long, so 載入中… and the locked fields don't stay forever. */
export const BANK_LOAD_TIMEOUT_MS = 15_000;
/** An image upload gives up after this long, so a hung one doesn't lock the editor forever. Long enough for a 5 MB
 * image on slow Wi-Fi (about 0.35 Mbps). */
export const IMAGE_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Every in-flight request ends in setBank: a load or a save with the server's bank, an upload with its new image key.
 * So while any of them runs, fields, 載入題庫 and 儲存 all lock: an upload landing after a load would write into the
 * new bank, one landing during a save would be replaced by the saved bank (the old image back, the new one orphaned
 * on R2), and an edit made during an upload (a tab switch, a deleted phase or question) could misplace its key.
 */
export function editorBusy(s: { loading: boolean; saving: boolean; uploads: number }): boolean {
  return s.loading || s.saving || s.uploads > 0;
}
