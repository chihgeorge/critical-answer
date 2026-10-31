import { originAllowed } from "./origin";

/** A crash report is one short line; anything bigger is not from our error screen. */
export const MAX_CLIENT_ERROR_BYTES = 4096;

/** Only printable text, cut to `max` characters, so a report cannot forge or flood log lines. */
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : undefined);

/** The body as text, or null past `max` bytes. Reads the stream itself so a chunked body without
 * Content-Length is cut off at the cap instead of being buffered whole. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

/** POST /api/client-error: components/error-screen.tsx reports a front-end crash here and the
 * Worker writes one JSON log line (Workers observability keeps it). No auth, like the page that
 * sends it; the size cap and the cleaning above are the only limits.
 * shortcut: no rate limit, so a script can fill the log; add one if the log ever gets noisy. */
export async function handleClientError(request: Request, allowedOrigins: string, log: (line: string) => void = console.log): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!originAllowed(request.headers.get("Origin"), allowedOrigins)) return new Response("Forbidden", { status: 403 });
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_CLIENT_ERROR_BYTES) return new Response("Payload too large", { status: 413 });
  const text = await readCapped(request, MAX_CLIENT_ERROR_BYTES);
  if (text === null) return new Response("Payload too large", { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return new Response("Bad request", { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  log(JSON.stringify({ event: "client_error", message: clean(body.message, 500), digest: clean(body.digest, 100), path: clean(body.path, 200) }));
  return new Response(null, { status: 204 });
}
