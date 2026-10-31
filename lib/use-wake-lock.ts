"use client";

import { useEffect } from "react";

/** Keeps the screen on while the page is open: the TV and the host's phone sit untouched for a
 * whole turn. The browser drops the lock whenever the page is hidden, so it is asked for again each
 * time the page comes back. Unsupported or refused (low battery, no HTTPS) just means the old
 * behaviour, so failures are ignored. */
export function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const request = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (gone) void next.release();
        else {
          // Two quick visibilitychanges can both get a lock; keep only the newest so cleanup frees it.
          void lock?.release();
          lock = next;
        }
      } catch {
        // Refused or unsupported: the screen may sleep, as before.
      }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, []);
}
