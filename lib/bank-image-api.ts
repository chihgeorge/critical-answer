// Pure, testable HTTP handling for question-bank image uploads. Platform-agnostic on purpose,
// same split as bank-api.ts/bank-store.ts — worker/index.ts wires this to the real R2 binding,
// but none of the logic here knows Cloudflare exists. See docs/designs/image-question-type.md's
// "Upload transport" and "Platform-abstraction discipline" decisions. "Image" in the names here
// means any uploaded media: the same endpoint takes MP4 video and M4A/MP3 audio too
// (docs/designs/uploaded-media.md D2).

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
/** One uploaded video or audio file. Workers accept request bodies up to 100 MB (Free/Pro). */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

type ImageContentType = "image/png" | "image/jpeg" | "image/webp";
type MediaContentType = "video/mp4" | "audio/mp4" | "audio/mpeg";

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
function sniffImage(bytes: Uint8Array): ImageContentType | null {
  if (matchesAt(bytes, 0, PNG_MAGIC)) return "image/png";
  if (matchesAt(bytes, 0, JPEG_MAGIC)) return "image/jpeg";
  if (matchesAt(bytes, 0, WEBP_RIFF_MAGIC) && matchesAt(bytes, 8, WEBP_MAGIC)) return "image/webp";
  return null;
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
/** MP4 major brands a browser plays as one file. Not dash / "M4V " (may be fragmented or DRM), HEIC, AVIF, QuickTime, 3GP.
 * Many audio-only M4A files carry a generic one (isom, mp42), so for those the declared type picks audio (review). */
const VIDEO_BRANDS = new Set(["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1"]);
const AUDIO_BRANDS = new Set(["M4A ", "M4B "]);

// shortcut: checks the container only, not the codec (an HEVC MP4 passes); the editor preview catches what the browser can't play.
function sniffMedia(bytes: Uint8Array, declared: string): MediaContentType | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    // Same container either way: the client's word only picks the music card over a picture, never what is stored.
    if (VIDEO_BRANDS.has(brand)) return declared.startsWith("audio/") ? "audio/mp4" : "video/mp4";
    if (AUDIO_BRANDS.has(brand)) return "audio/mp4";
    return null;
  }
  // An ID3 tag, or an MPEG audio frame sync (11 bits set) with layer III.
  if (ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2) return "audio/mpeg";
  return null;
}

const UNSUPPORTED = "不支援這種檔案：圖片請用 PNG、JPEG 或 WEBP，影片請用 MP4（H.264／AAC），聲音用 M4A 或 MP3";
const MEDIA_TOO_LARGE = "影片或聲音超過 25 MB，請先剪短或壓縮";
const IMAGE_TOO_LARGE = "圖片超過 5 MB，請先縮小";

/** Reads at most `max` bytes of the body; null once it runs past them (the rest is never read). */
async function readCapped(body: ReadableStream<Uint8Array>, max: number, declared: number): Promise<Uint8Array | null> {
  // One buffer filled in place (joining chunks at the end would hold the upload twice), sized from Content-Length when
  // it has one, so a small image never reserves 25 MB (review). It doubles if the body runs past it.
  let buf = new Uint8Array(Number.isInteger(declared) && declared > 0 && declared <= max ? declared : Math.min(max, 1024 * 1024));
  let n = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return buf.subarray(0, n);
    if (n + value.byteLength > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    if (n + value.byteLength > buf.byteLength) {
      const bigger = new Uint8Array(Math.min(max, Math.max(buf.byteLength * 2, n + value.byteLength)));
      bigger.set(buf.subarray(0, n));
      buf = bigger;
    }
    buf.set(value, n);
    n += value.byteLength;
  }
}

/** Owner-only image/video/audio upload for the question bank. POST a raw body (any of the allowed
 * types); returns `{ key, contentType }` for the bank editor to store on an `image`, `video` or `audio` item. Deliberately a
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
    return new Response("題庫目前是唯讀：存著的題庫這個版本讀不懂，上傳的檔案存不進去", { status: 409, headers: cors });
  }
  const reject = (status: number, reason: string, text: string) => {
    console.warn(JSON.stringify({ event: "media_rejected", reason }));
    return new Response(text, { status, headers: cors });
  };

  // Same lesson as bank-api.ts's PUT handler: Content-Length is attacker-controlled (and HTTP/2 may
  // not send one), so the real limit is the bytes actually read below. This is a cheap short-circuit.
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (declaredLength > MAX_MEDIA_BYTES) return reject(413, "too_large", MEDIA_TOO_LARGE);

  let bytes: Uint8Array | null;
  try {
    bytes = request.body ? await readCapped(request.body, MAX_MEDIA_BYTES, declaredLength) : new Uint8Array(0);
  } catch {
    return reject(400, "unreadable", "上傳讀不到，請再試一次");
  }
  if (!bytes) return reject(413, "too_large", MEDIA_TOO_LARGE);
  if (bytes.byteLength === 0) return reject(400, "empty", "檔案是空的");

  const image = sniffImage(bytes);
  const contentType = image ?? sniffMedia(bytes, request.headers.get("Content-Type") ?? "");
  if (!contentType) return reject(400, "unsupported", UNSUPPORTED);
  if (image && bytes.byteLength > MAX_IMAGE_BYTES) return reject(413, "image_too_large", IMAGE_TOO_LARGE);

  try {
    const { key } = await deps.putImage(bytes, contentType);
    if (!image) console.log(JSON.stringify({ event: "media_uploaded", contentType, bytes: bytes.byteLength }));
    return Response.json({ key, contentType }, { headers: cors });
  } catch (err) {
    console.error(JSON.stringify({ event: "image_upload_failed", error: String(err) }));
    return new Response("上傳失敗，請再試一次", { status: 502, headers: cors });
  }
}
