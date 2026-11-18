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

/** The link the editor shows for a stored id, so the host can open, copy or replace it (the bank keeps the bare id). */
export const youtubeWatchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;
export const youtubeThumbnailUrl = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

/** The privacy-friendly embed domain — confirmed as 2026 best practice for a plain-iframe
 * embed (no library, no API key) via live web search during /plan-eng-review. */
export function youtubeEmbedUrl(videoId: string, start?: number, end?: number, zhCaptions = false): string {
  const clip = new URLSearchParams({
    // Related videos only from the same channel (YouTube's floor), no annotation cards.
    rel: "0",
    iv_load_policy: "3",
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
  /** Host-selected position, in seconds, for this seq. */
  seek?: number;
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

/** A timing reveal's replay seeks once per key (timing-tap-timeline.md): a re-render with the same key does nothing. */
export const shouldSeek = (doneKey: string | null, key: string): boolean => doneKey !== key;

/** A question clip has a fixed end; its answer reveal stays available until the host advances. */
export const clipEndForStage = (end: number | undefined, revealing: boolean): number | undefined => revealing ? undefined : end;

/** Seconds before the video's own end that the player stops by itself: YouTube's end screen of other videos never
 * shows (#365). The IFrame API has no switch for it, nor for the share button. */
export const END_SCREEN_GUARD_S = 0.5;
/** Where the big screen's player stops: the clip's end, and never later than just before the video's end (once its
 * duration is known; 0 before that). shortcut: a live stream's duration grows as it plays, so one would stop at once; the bank has none. */
export const clipStopAt = (end: number | undefined, duration: number): number | undefined =>
  duration > END_SCREEN_GUARD_S ? Math.min(end ?? Infinity, duration - END_SCREEN_GUARD_S) : end;

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

/** The big screen's test load (screen-media-test.md D3): YouTube's onError code as a reason. 101 and 150: the owner
 * turned embedding off; 100: removed or private; 2: a bad id. */
export function youtubeTestError(code: number): "blocked" | "gone" | "error" {
  return code === 101 || code === 150 ? "blocked" : code === 100 || code === 2 ? "gone" : "error";
}

/** The big screen's test load of an uploaded file, once its first frame is in: a video with no picture size means the
 * browser cannot decode its video track (e.g. HEVC). An audio file has none to decode. */
export const fileTestError = (audioOnly: boolean, videoWidth: number): "no_picture" | null => (!audioOnly && videoWidth === 0 ? "no_picture" : null);

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

/** Which caption track to show after the reveal: Traditional Chinese, then any other Chinese, then a track
 * auto-translated to Traditional Chinese; null when the video has no track at all. Hand-made beats auto-generated
 * within each Chinese step. The translation source is English first (it translates best), hand-made before
 * auto-generated: en hand-made → other hand-made → en auto-generated → other auto-generated. */
export function pickZhCaption<T extends CaptionTrack>(tracks: readonly T[]): { track: T; translate: boolean } | null {
  const code = (t: T) => (typeof t?.languageCode === "string" ? t.languageCode.toLowerCase() : "");
  const asr = (t: T) => t.kind === "asr";
  const best = (ok: (t: T) => boolean) => tracks.find((t) => ok(t) && !asr(t)) ?? tracks.find(ok);
  const hant = best((t) => ["zh-tw", "zh-hant"].includes(code(t)) || code(t).startsWith("zh-hant-"));
  if (hant) return { track: hant, translate: false };
  const zh = best((t) => code(t) === "zh" || code(t).startsWith("zh-"));
  if (zh) return { track: zh, translate: false };
  const ok = (t: T) => code(t) !== "" && t.is_translateable !== false;
  const en = (t: T) => code(t) === "en" || code(t).startsWith("en-");
  const source =
    tracks.find((t) => ok(t) && en(t) && !asr(t)) ??
    tracks.find((t) => ok(t) && !asr(t)) ??
    tracks.find((t) => ok(t) && en(t)) ??
    tracks.find(ok);
  return source ? { track: source, translate: true } : null;
}

/** The player methods the captions code uses. The captions module is not in YouTube's documented API, so every
 * method may be missing or throw. */
export interface CaptionPlayer {
  loadModule?(name: string): void;
  unloadModule?(name: string): void;
  getOption?(module: string, option: string): unknown;
  setOption?(module: string, option: string, value: unknown): void;
}

/** Turns on Chinese captions (`on`), or keeps captions off, through YouTube's unofficial captions module
 * (docs/designs/youtube-questions.md「公布答案後的中文字幕」). True once a track is set; the caller tries again on
 * the next onApiChange or play until then, and always while captions must stay off. It never loads the module, so it
 * cannot set off another onApiChange. Any failure only means no captions: the video plays on. */
export function syncZhCaptions(p: CaptionPlayer, on: boolean): boolean {
  try {
    if (!on) {
      // A caption choice YouTube remembers from an earlier reveal must not show a music question's lyrics.
      // Unloading does not fire onApiChange (tried in a browser, 2026-11-09), so calling it again is safe.
      p.unloadModule?.("captions");
      return false;
    }
    const list = p.getOption?.("captions", "tracklist");
    const pick = pickZhCaption(Array.isArray(list) ? (list as CaptionTrack[]) : []);
    if (!pick) return false;
    const langs = p.getOption?.("captions", "translationLanguages");
    const target = Array.isArray(langs) ? langs.find((l) => l?.languageCode === ZH_HANT) : undefined;
    p.setOption?.("captions", "track", pick.translate ? { ...pick.track, translationLanguage: target ?? { languageCode: ZH_HANT } } : pick.track);
    return true;
  } catch {
    return false;
  }
}

/** Asks the player to load its captions module; onApiChange fires once it has the track list. */
export function loadCaptions(p: CaptionPlayer) {
  try {
    p.loadModule?.("captions");
  } catch {
    // no captions, the video still plays
  }
}
