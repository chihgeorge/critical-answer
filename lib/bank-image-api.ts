// Pure, testable HTTP handling for question-bank image uploads. Platform-agnostic on purpose,
// same split as bank-api.ts/bank-store.ts — worker/index.ts wires this to the real R2 binding,
// but none of the logic here knows Cloudflare exists. See docs/designs/image-question-type.md's
// "Upload transport" and "Platform-abstraction discipline" decisions.

import { corsHeaders, ownerAuthResponse } from "./bank-api";

export interface BankImageApiDeps {
  ownerKey: string | undefined;
  allowedOrigins: string;
  /** Writes the validated bytes to storage and returns the key they're stored under. Cloudflare
   * R2 in production (worker/index.ts); an in-memory Map in tests. */
  putImage(bytes: Uint8Array, contentType: string): Promise<{ key: string }>;
  /** True while the stored bank can't be read by this version: no save can keep an upload then. */
  bankUnreadable(): Promise<boolean>;
}

// Independent of MAX_BANK_BODY_BYTES (lib/bank-api.ts) — that governs the bank JSON PUT, this
// governs one binary upload. Generous enough for a question illustration, small enough that a
// party's whole bank of images stays a manageable R2 footprint.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type AllowedContentType = "image/png" | "image/jpeg" | "image/webp";

// Exported so the test file imports these instead of re-declaring its own copies — one source of
// truth per format's signature, so the two files can't silently drift apart.
export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
export const JPEG_MAGIC = [0xff, 0xd8, 0xff];
/** WEBP's signature isn't contiguous: "RIFF" (bytes 0-3), then a 4-byte size field (bytes 4-7,
 * skipped here), then "WEBP" (bytes 8-11) — checked as two separate matches below. */
export const WEBP_RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
export const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

function matchesAt(bytes: Uint8Array, offset: number, magic: number[]): boolean {
  return bytes.length >= offset + magic.length && magic.every((b, i) => bytes[offset + i] === b);
}

/** Magic-byte signatures for each allowed type. Checked against the actual uploaded bytes, never
 * the client-declared Content-Type header — the R2 bucket is public-read, so trusting a spoofed
 * header would let an arbitrary file be uploaded and served under a false image claim (see the
 * design doc's "Upload validation" decision). */
function sniffContentType(bytes: Uint8Array): AllowedContentType | null {
  if (matchesAt(bytes, 0, PNG_MAGIC)) return "image/png";
  if (matchesAt(bytes, 0, JPEG_MAGIC)) return "image/jpeg";
  if (matchesAt(bytes, 0, WEBP_RIFF_MAGIC) && matchesAt(bytes, 8, WEBP_MAGIC)) return "image/webp";
  return null;
}

/** Owner-only image upload for the question bank. POST a raw image body (any of the allowed
 * types); returns `{ key }` for the bank editor to store on an `image` question. Deliberately a
 * separate exported handler (not a case inside handleBankApi) so worker/index.ts can dispatch on
 * pathname without either handler needing to know about the other — see the design doc's
 * "Routing" decision. */
export async function handleBankImageApi(request: Request, deps: BankImageApiDeps): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, deps.allowedOrigins, "POST, OPTIONS");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const authError = ownerAuthResponse(request, deps.ownerKey, cors);
  if (authError) return authError;
  let unreadable: boolean;
  try {
    unreadable = await deps.bankUnreadable();
  } catch (err) {
    // BankStore unreachable (redeploying, cold start): refuse rather than upload an image no save may keep.
    console.error(JSON.stringify({ event: "bank_state_unavailable", error: String(err) }));
    return new Response("題庫暫時連不上，請稍後再上傳", { status: 503, headers: cors });
  }
  if (unreadable) {
    return new Response("題庫目前是唯讀：存著的題庫這個版本讀不懂，上傳的圖片存不進去", { status: 409, headers: cors });
  }

  // Same lesson as bank-api.ts's PUT handler: Content-Length is attacker-controlled, so the real
  // limit is enforced against bytes actually read below, not this header. This early check is
  // just a cheap short-circuit for an obviously-oversized declared length.
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES) return new Response("Image too large", { status: 413, headers: cors });

  let buf: ArrayBuffer;
  try {
    buf = await request.arrayBuffer();
  } catch {
    return new Response("Could not read upload", { status: 400, headers: cors });
  }
  if (buf.byteLength > MAX_IMAGE_BYTES) return new Response("Image too large", { status: 413, headers: cors });
  if (buf.byteLength === 0) return new Response("Empty upload", { status: 400, headers: cors });

  const bytes = new Uint8Array(buf);
  const contentType = sniffContentType(bytes);
  if (!contentType) return new Response("Unsupported image type (png, jpeg, webp only)", { status: 400, headers: cors });

  try {
    const { key } = await deps.putImage(bytes, contentType);
    return Response.json({ key }, { headers: cors });
  } catch (err) {
    console.error(JSON.stringify({ event: "image_upload_failed", error: String(err) }));
    return new Response("Upload failed", { status: 502, headers: cors });
  }
}
