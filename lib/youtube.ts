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
export function youtubeEmbedUrl(videoId: string, start?: number, end?: number, zhCaptions = false): string {
  const clip = new URLSearchParams({
    ...(start !== undefined ? { start: String(start) } : {}),
    ...(end !== undefined ? { end: String(end) } : {}),
    // enablejsapi lets the page pick the caption track itself (pickZhCaption); the rest is YouTube's own first guess.
    ...(zhCaptions ? { enablejsapi: "1", ...ZH_CAPTION_VARS } : {}),
  }).toString();
  return `https://www.youtube-nocookie.com/embed/${videoId}${clip ? `?${clip}` : ""}`;
}

/* ---------- The big screen's player (docs/designs/youtube-questions.md) ---------- */

/** What the host asked the video to do, as the player sees it. */
export interface MediaWant {
  state: "playing" | "paused";
  seq: number;
  /** A new press re-checks the steps even when state and seq are the same (▶ after the clip ended). */
  press?: number;
}
export type PlayerStep = "restart" | "play" | "pause";

/** The player calls that take the video from the last command it carried out (`prev`, null before any)
 * to `next`. A new `seq` (⟲) or the first command after a (re)connect plays from the clip's start (D6);
 * so does ▶ after the clip has ended. A repeated ▶ or ⏸ does nothing. */
export function playerSteps(prev: MediaWant | null, next: MediaWant, ended: boolean): PlayerStep[] {
  if (next.state === "paused") return prev?.state === "playing" ? ["pause"] : [];
  if (!prev || prev.seq !== next.seq || ended) return ["restart"];
  return prev.state === "paused" ? ["play"] : [];
}

/** A clip error the big screen reported: the video, and the host's last press on it then (0 if none). */
export interface ClipErrorSeen {
  questionId: string;
  press: number;
}

/** Whether the big screen reports `seen` again on the first STATE after a reconnect (boss-music-buzzer.md M4): the room
 * keeps clipError in memory, so a restart lost it. Not when a newer press says play: the player retries the video on
 * it, so the old error would be a false warning (a pause press retries nothing). shortcut: after a restart the room
 * counts presses from 0 again, so a ▶ then may look old and the error goes back up; the host's next ▶ clears it. */
export function resendClipError(seen: ClipErrorSeen | null, media: { questionId: string; press: number; state: "playing" | "paused" } | undefined): boolean {
  return !!seen && !(media?.questionId === seen.questionId && media.press > seen.press && media.state === "playing");
}

/** The music card's five states (D15). */
export type ClipStatus = "loading" | "playing" | "paused" | "ended" | "error";
export const CLIP_STATUS_TEXT: Record<ClipStatus, string> = {
  loading: "準備中",
  playing: "播放中",
  paused: "暫停",
  ended: "播完",
  error: "影片無法播放",
};

/** The music card's state from YouTube's onStateChange code (1 playing, 2 paused, 5 cued, 0 ended; 3 buffering
 * and -1 unstarted read as loading). Once the clip has ended at its `end`, everything reads as ended. */
export function clipStatusFromYoutube(ytState: number, ended: boolean): ClipStatus {
  if (ended || ytState === 0) return "ended";
  if (ytState === 1) return "playing";
  if (ytState === 2 || ytState === 5) return "paused";
  return "loading";
}

/** A clip time typed in the bank editor: `1:05`, `65` or `0:5`. Whole seconds only; null when it is not one (D22). */
export function parseClipTime(input: string): number | null {
  const t = input.trim();
  const m = t.match(/^(?:(\d+):)?(\d+)$/);
  if (!m) return null;
  const minutes = m[1] === undefined ? 0 : Number(m[1]);
  const seconds = Number(m[2]);
  if (m[1] !== undefined && seconds >= 60) return null;
  return minutes * 60 + seconds;
}

/** 65 → "1:05". */
export function formatClipTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The host's 大螢幕： status. After a clip error and the 🎤 open, the host plays the song live (boss-music-buzzer.md M4). */
export function hostMediaStatus(playing: boolean, liveOpen: boolean): string {
  return liveOpen ? "現場放歌中" : playing ? "播放中" : "已暫停";
}

/** The host's line while no team holds the buzz. None on a clip error: the red warning and its 🎤 button say what to do. */
export function hostBuzzWait(youtube: boolean, open: boolean, clipError: boolean): string | null {
  if (!youtube || open) return "等隊伍搶答…";
  return clipError ? null : "按 ▶ 播放後開放搶答";
}

/* ---------- Chinese captions after the reveal (docs/designs/youtube-questions.md「公布答案後的中文字幕」) ---------- */

/** playerVars that ask YouTube to show captions, in Traditional Chinese where it can. Never while a question is
 * being answered: a music question's captions would show the lyrics or the title. */
export const ZH_CAPTION_VARS = { cc_load_policy: "1", cc_lang_pref: "zh-TW", hl: "zh-TW" };
/** YouTube's auto-translate target. */
export const ZH_HANT = "zh-Hant";

/** One entry of the captions module's unofficial `tracklist`: `kind` is "asr" for auto-generated captions. */
export interface CaptionTrack {
  languageCode: string;
  kind?: string;
  is_translateable?: boolean;
}

/** Which caption track to show after the reveal: Traditional Chinese, then any other Chinese, then any track
 * auto-translated to Traditional Chinese; null when the video has no track at all. Hand-made beats auto-generated
 * within each step. */
export function pickZhCaption<T extends CaptionTrack>(tracks: readonly T[]): { track: T; translate: boolean } | null {
  const code = (t: T) => (typeof t?.languageCode === "string" ? t.languageCode.toLowerCase() : "");
  const best = (ok: (t: T) => boolean) => tracks.find((t) => ok(t) && t.kind !== "asr") ?? tracks.find(ok);
  const hant = best((t) => ["zh-tw", "zh-hant"].includes(code(t)) || code(t).startsWith("zh-hant-"));
  if (hant) return { track: hant, translate: false };
  const zh = best((t) => code(t) === "zh" || code(t).startsWith("zh-"));
  if (zh) return { track: zh, translate: false };
  const source = best((t) => code(t) !== "" && t.is_translateable !== false);
  return source ? { track: source, translate: true } : null;
}
