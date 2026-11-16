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

// The join password goes from the home form to /play in sessionStorage, not the URL: a URL lands in
// history, logs and shared links. Gone when the tab closes; a known team rejoins without it.
const joinPasswordKey = (code: string) => `joinPassword:${code.toUpperCase()}`;

export function rememberJoinPassword(code: string, password: string): void {
  try {
    if (password) sessionStorage.setItem(joinPasswordKey(code), password);
    else sessionStorage.removeItem(joinPasswordKey(code));
  } catch {
    // Blocked storage: the phone is told the room needs a password.
  }
}

export function joinPasswordFor(code: string): string {
  try {
    return sessionStorage.getItem(joinPasswordKey(code)) ?? "";
  } catch {
    return "";
  }
}

export function forgetStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing was remembered.
  }
}

/** The big screen's error page reloads itself after this long: nobody stands by the TV to press 重新載入. */
export const SCREEN_ERROR_RELOAD_MS = 5000;
/** At most one automatic reload this often, so a page that fails on every load doesn't reload forever. */
export const SCREEN_ERROR_RELOAD_GAP_MS = 60_000;
const screenReloadKey = "screenErrorReloadAt";

/** True (and the time recorded) when an error page at `pathname` should reload by itself now: only the big screen
 * (`/room/X/screen`), and not within SCREEN_ERROR_RELOAD_GAP_MS of the last one. Blocked storage: false, since without
 * a record the gap can't hold. */
export function claimScreenAutoReload(pathname: string, now: number): boolean {
  if (!/\/screen\/?$/.test(pathname)) return false;
  try {
    const last = Number(sessionStorage.getItem(screenReloadKey));
    if (last && now - last < SCREEN_ERROR_RELOAD_GAP_MS) return false;
    sessionStorage.setItem(screenReloadKey, String(now));
    return true;
  } catch {
    return false;
  }
}
