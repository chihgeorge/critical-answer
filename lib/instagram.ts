// An Instagram video as an answer's explanation (docs/designs/instagram-explanations.md): the official embed iframe,
// no API, no token. Like lib/youtube.ts, the shortcode extracted here is what the bank stores.

/** Instagram does not document a length: 11 is usual today, longer ones exist, so the range is wide. Exported so
 * question-bank.ts validates with this same rule. */
export const INSTAGRAM_SHORTCODE_RE = /^[A-Za-z0-9_-]{5,40}$/;

const URL_RE = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]{5,40})(?:[/?#]|$)/;

/** The shortcode from a pasted post or reel URL (any query string), or the paste itself when it already is one. */
export function extractInstagramShortcode(pasted: string): string | null {
  const trimmed = pasted.trim();
  if (INSTAGRAM_SHORTCODE_RE.test(trimmed)) return trimmed;
  return trimmed.match(URL_RE)?.[1] ?? null;
}

/** Without `captioned`: a post's caption may say the answer's details nobody asked for. */
export const instagramEmbedUrl = (shortcode: string) => `https://www.instagram.com/p/${shortcode}/embed/`;
export const INSTAGRAM_ORIGIN = "https://www.instagram.com";

/** The embed's height from its own MEASURE message (`{"type":"MEASURE","details":{"height":689}}`), or null. */
export function measuredHeight(data: unknown): number | null {
  try {
    const m = typeof data === "string" ? JSON.parse(data) : data;
    const h = m?.type === "MEASURE" ? m.details?.height : undefined;
    return typeof h === "number" && h > 0 && h < 5000 ? h : null;
  } catch {
    return null;
  }
}
