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
