import { partyHttpBase } from "./party-host";

/** Sends one line about a crash to the Worker's log (/api/client-error), so a white screen at a
 * party is not invisible to us. Best effort: a beacon needs no CORS preflight and survives the
 * reload the error screen offers; when it cannot be sent, nothing else happens. */
export function reportClientError(error: unknown) {
  try {
    // Inside the try: String() throws on some thrown values (Object.create(null)).
    const message = error instanceof Error ? error.message : String(error);
    const digest = error instanceof Error && "digest" in error ? String(error.digest) : undefined;
    navigator.sendBeacon(`${partyHttpBase()}/api/client-error`, JSON.stringify({ message, digest, path: location.pathname }));
  } catch {
    // Reporting must never break the error screen itself.
  }
}
