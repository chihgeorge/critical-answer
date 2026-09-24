// Extracts a YouTube video id from whatever URL shape someone pastes. No API calls, no library —
// a plain regex is the whole job (see docs/designs/question-media-content.md's D1/architecture
// decisions). The id, once extracted, is what's actually stored on the question; nothing else
// ever needs to re-parse a URL.

// Exported so question-bank.ts's server-side trust-boundary validation (parseMediaContent) uses
// this exact same rule, not a second copy that could silently drift from it (maintainability
// specialist finding, /ship).
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const URL_PATTERNS = [
  /youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
];

/** Pulls the 11-character video id out of a pasted YouTube URL (watch/embed/shorts/youtu.be), or
 * returns the string unchanged if it's already a bare id. Null if it doesn't look like either. */
export function extractYoutubeId(pasted: string): string | null {
  const trimmed = pasted.trim();
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;
  for (const re of URL_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

/** The privacy-friendly embed domain — confirmed as 2026 best practice for a plain-iframe
 * embed (no library, no API key) via live web search during /plan-eng-review. */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}
