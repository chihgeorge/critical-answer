// PartyKit client/server message contract for the dungeon room.
//
// The host judges each text question's answer correct/incorrect (since #104 the team types it on
// its phone; see TEAM_SUBMIT_TEXT below). Only the host can send HOST_JUDGE — trusting a
// team's own "I got it right" claim would let them self-score.
//
// TEAM_SELECT_OPTION is an exception to "only the host mutates game state"
// (docs/designs/multiple-choice-questions.md decision 5): it is not a score claim.
// A multiple-choice pick or lock is judged by the room against the shown correctIndex
// (the bank's, moved by the game's optionOrder), which never
// reaches a client (docs/designs/phone-answering.md), so the self-scoring risk
// above does not apply. It derives its sender's team from the
// connection's own connTeam binding (set at JOIN/REJOIN) — never from a
// client-supplied team id — so no teamKey is needed,
// unlike JOIN/REJOIN. TEAM_SELECT_OPTION is
// re-selectable (a later pick for the same question overwrites the earlier
// one) until TEAM_LOCK_OPTION commits it.
//
// TEAM_PICK_CLASS and TEAM_USE_ABILITY (docs/designs/class-abilities.md) also
// come from the team's own phone, bound by connTeam. A class pick is lobby-only;
// the ability's result (the warrior's d20) is rolled by the room, never sent by
// the phone, so neither message is a score claim either.
//
// TEAM_SUBMIT_TEXT (fill-in, #104) is a team's typed answer to a text question, also bound by
// connTeam and one per question. The host still judges it, so it is not a score claim, and it
// never goes into an LLM prompt.
//
// Host identity is a token minted by the host's browser at room creation.
// The first HOST_CLAIM for a room sets it (trust on first use, on a 4-letter
// room code); every later claim must match. See lib/room/dungeon-room.ts.

import type { Accessory } from "./monster-catalog";
import { isClassId, type ClassId, type GamePhase, type LockedOption, type PickBlock, type SpectatorView } from "./game-state";
import type { Beat } from "./podium";
import type { MonsterSprite } from "./sprite-kind";
import type { TranscriptItem } from "./narration/runner";

export const MAX_TEAMS = 8;

/** A question's (or explanation's) content, wire-safe: `image`'s `url` is a public R2 URL, never
 * the raw storage key; `youtube`'s `videoId` is the extracted id, never the pasted URL. See
 * docs/designs/question-media-content.md's D1 (content replaces the old fixed `text` prompt). */
export type PublicMediaContent =
  | { kind: "text"; value: string }
  | { kind: "image"; url: string }
  | { kind: "youtube"; videoId: string; audioOnly?: true; start?: number; end?: number };

/** The question the team in turn faces, without its answer: safe for /screen and /play.
 * `options` is present only for multipleChoice questions (never `correctIndex` — see
 * question-bank.ts's publicQuestion() field-picking discipline). Deliberately carries no
 * `explanation` — that would leak the answer's supporting content before the answer is judged;
 * see AnswerReveal below, built separately at judge time from the question that was just
 * answered, never from the question currently in play. */
export interface PublicQuestion {
  id: string;
  content: PublicMediaContent;
  /** The line above an image or a video (docs/designs/youtube-questions.md D5). */
  prompt?: string;
  difficulty: number;
  boss: boolean;
  /** `name` carries a repeat appearance's title and `hue` its recolor; `accessory` only on a repeat
   * appearance (docs/designs/monster-catalog.md §3). `id` and `accessory` are absent from older servers. */
  monster: { id?: string; name: string; sprite: MonsterSprite; hue: number; accessory?: Accessory };
  options?: string[];
  /** A sort question's items in this game's shown order (never the correct order). A pick or lock on it is a
   * sort code (lib/sort-order.ts), not an option index. */
  items?: string[];
}

/** Shown to everyone (D2/D3 — a shared-screen, in-person party game, so hiding the answer from
 * non-answering teams protects nothing here) only after a team answers CORRECTLY (D5 — a retry
 * or a flee never reveals it, so the same question can come back around). Built from the question
 * that was JUST answered, never the one now in play. Carried on STATE, not a one-off message, so a
 * reconnecting phone still sees it; it stays up — replacing the next question on /screen and
 * /play — until the host sends HOST_NEXT (D7). */
export type AnswerReveal = {
  questionId: string;
  answer: string;
  explanation?: PublicMediaContent;
  /** The answered question's own YouTube video, shown again where it stopped, unless an image or a video
   * explanation takes its place (docs/designs/youtube-questions.md D17). */
  video?: Extract<PublicMediaContent, { kind: "youtube" }>;
  /** Set when a team's lock was judged (phone answering): the answered question's options, which one
   * was right, who locked it and the points it scored, so every screen can light the tile (D8, D14).
   * Safe to send: it goes out only once the answer is revealed. */
  choice?: { options: string[]; correctIndex: number; teamId: string; points: number };
  /** Set when a sort question was answered right: its items in the correct order, who answered and the points. */
  sorted?: { items: string[]; teamId: string; points: number };
  /** The dish the defeated monster was cooked into and the 飽足感 it gave (docs/designs/monster-cuisine.md).
   * Only when the answer defeated a room monster or killed the boss, and that monster has a dish. */
  dish?: {
    name: string;
    part: string;
    method: string;
    comment: string;
    points: number;
    /** The monster that was cooked, and whose room it was (`room` null for the boss), so the stage can show it
     * during the reveal instead of the next team's monster (docs/designs/monster-cuisine.md, cooking I6). */
    monster: PublicQuestion["monster"];
    room: number | null;
    /** The team that ate it, for the 🍲 ribbon and the dish line. */
    teamId: string;
  };
  /** The host pressed 🍲 上菜 (HOST_SERVE): the panel goes away and the screen cooks the monster. Only with `dish`. */
  served?: true;
};

/** 上菜's cooking on the big screen (monster-cuisine.md cooking R7): monster 0–0.4 s, pot to 1.2 s, smoke to 1.6 s, then the dish. */
export const COOK_MS = 1600;
/** The pot comes up, then the smoke (the cook sound's bubbles and 砰 land on these too). */
export const COOK_POT_MS = 400;
export const COOK_SMOKE_MS = 1200;
/** The room refuses 下一題 until the cooked dish has been up this long (cooking I2): the cooking plus about a second of dish. */
export const SERVE_HOLD_MS = COOK_MS + 1000;
/** The end screen after a boss kill (cooking R8): the boss cooks, its dish holds, and only then the winner, podium and epilogue. */
export const FINISH_PODIUM_MS = COOK_MS + 3000;

/** The podium reveal of a finished game (docs/designs/podium-reveal.md, eng D20): the room's clock, read by /screen and /play. */
export interface PodiumReveal {
  /** Team ids best first, podium ties broken by d20. */
  ranking: string[];
  /** Null while the room waits for the narrator's lines (名次揭曉中…). */
  beats: Beat[] | null;
  /** How far past the first beat the room's clock was when this STATE was sent; negative before it. */
  elapsedMs: number;
}

/** What scores are called: 飽足感 when the bank cooks its monsters (STATE `cuisine`), else 獎勵分. */
export function scoreName(cuisine: boolean | undefined): string {
  return cuisine ? "飽足感" : "獎勵分";
}

export type ClientMessage =
  /** `teamKey` is the team's secret. teamId is public (every STATE broadcasts it), so the key is what proves a connection owns the team. */
  /** `resume`: sent by a page's automatic reconnect (a network hiccup, a server restart), not by a
   * person. The room still accepts it, but it doesn't count as activity, so a device reconnecting
   * in the background can't keep a room from resting. First opens, reloads and a click on
   * 重新連線 leave it off. */
  /** `password`: only checked for a new team, and only when the host set one (HOST_SET_PASSWORD). */
  | { type: "JOIN"; teamId: string; teamKey: string; teamName: string; password?: string; resume?: true }
  | { type: "REJOIN"; teamId: string; teamKey: string; resume?: true }
  | { type: "HOST_CLAIM"; token: string; resume?: true }
  /** `intro`: play the 4-page how-to-play first (docs/designs/how-to-play.md). Missing means no intro,
   * so a host page from before the intro can't get stuck on a page it has no button for (eng D2). */
  | { type: "HOST_START"; aiNarration?: boolean; intro?: boolean }
  /** How-to-play: go to `page` (1..4); 5 ends the intro and deals the first question. The room takes
   * only the current page ±1, so a double tap or a second host tab turns one page, not two (eng D4). */
  | { type: "HOST_INTRO"; page: number }
  /** Which key pays for AI narration in this room. The key stays in the room's memory and is never sent back. */
  | { type: "HOST_AI_KEY"; source: "own"; provider: AiProviderId; key: string }
  /** The server's own key, for whoever knows OWNER_KEY. */
  | { type: "HOST_AI_KEY"; source: "owner"; ownerKey: string }
  /** Forget the key: scripted narration from now on. */
  | { type: "HOST_AI_KEY"; source: "none" }
  /** Most paid AI calls this room may make (1..MAX_AI_LIMIT). */
  | { type: "HOST_AI_LIMIT"; limit: number }
  /** Join password for new teams; "" lets anyone with the room code join. */
  | { type: "HOST_SET_PASSWORD"; password: string }
  /** Director: replace line `index` (0-based) of narration `eventId` as of edit `rev` (cut to MAX_LINE chars). The room
   * refuses a stale eventId or rev (another host device edited first) and a line the big screen has already read
   * (docs/designs/host-narration-edit.md D3, D9). */
  | { type: "HOST_EDIT_NARRATION"; eventId: number; rev: number; index: number; line: string }
  /** /screen: it has finished reading `done` lines of narration `eventId` at revision `rev` (typed, and spoken
   * when its voice is on). No key: the worst a forged one does is lock lines early. The room ignores it from a team's phone or a host page
   * (host-narration-edit.md D3, D14). */
  | { type: "SCREEN_NARRATION_PROGRESS"; eventId: number; rev: number; done: number }
  /** Director: the next narration's second line says this (<= 40 chars); "" cancels. */
  | { type: "HOST_NEXT_LINE"; line: string }
  | { type: "HOST_GET_TRANSCRIPT" }
  /** Director: close the answer reveal and show the next question (D7). `eventId` is the STATE
   * eventId the reveal arrived with, so a late HOST_NEXT (second host device, a send buffered
   * across a reconnect) can't close a newer reveal the room hasn't seen yet. */
  | { type: "HOST_NEXT"; eventId: number }
  /** Director: cook the revealed monster (docs/designs/monster-cuisine.md, cooking R5). Same `eventId` guard as HOST_NEXT;
   * a second press does nothing. A dish reveal takes this before HOST_NEXT. */
  | { type: "HOST_SERVE"; eventId: number }
  /** Host override: take a team into the boss room (docs/designs/scoring-and-score-pools.md S13). */
  | { type: "HOST_SEND_TO_BOSS"; teamId: string }
  /** Host: reveal a team's locked multiple-choice answer (docs/designs/host-reveal.md). The room judges it after the beat. */
  | { type: "HOST_REVEAL"; teamId: string; questionId: string }
  /** Host: ▶ ⏸ ⟲ for the YouTube video on the big screen (docs/designs/youtube-questions.md). */
  | { type: "HOST_MEDIA"; questionId: string; action: MediaAction }
  /** 結束冒險: end the game now, ranked by each team's reward. */
  | { type: "HOST_END_GAME" }
  /** After the game: back to the lobby with the same teams, ready for another game. */
  | { type: "HOST_BACK_TO_LOBBY" }
  /** Lobby only: take a team out; its phones get team_removed. */
  | { type: "HOST_REMOVE_TEAM"; teamId: string }
  /** Lobby only: rename a team, with JOIN's name check and no other team's name. */
  | { type: "HOST_RENAME_TEAM"; teamId: string; teamName: string }
  /** During a game: a one-time code that hands the team to a new phone (docs/designs/team-handoff.md). */
  | { type: "HOST_HANDOFF"; teamId: string }
  /** A phone the room turned away types the host's handoff code; TEAM_CLAIMED answers with the team to JOIN as. */
  | { type: "TEAM_CLAIM"; code: string }
  /** Host: the next question for a team's room, or with target "boss" the boss's; null clears it (game-state queueQuestion). */
  | { type: "HOST_QUEUE_QUESTION"; target: string; questionId: string | null }
  | {
      type: "HOST_JUDGE";
      teamId: string;
      questionId: string;
      correct: boolean;
      /** With correct: false. "team": a cleric's fill-in waits for 祈禱 / 重答 / 逃跑 (#106); "pray": the host
       * picks 祈禱 for it. */
      fleeChoice?: "flee" | "retry" | "team" | "pray";
      /** The eventId of the STATE the host judged from; an older one is a stale press and is dropped. */
      eventId?: number;
    }
  /** MultipleChoice pick, sent by the team's own phone. Re-selectable — see the module header.
   * `optionIndex` is only type-checked here (non-negative integer); the real bounds check
   * against the live question's actual options.length happens in dungeon-room.ts, which is
   * the only layer that has the current game state. */
  | { type: "TEAM_SELECT_OPTION"; questionId: string; optionIndex: number }
  /** Locks the team's current pick (the server's `currentSelection`, never a client-sent index), judged
   * after the reveal beat (docs/designs/phone-answering.md E2, E11). */
  | { type: "TEAM_LOCK_OPTION"; questionId: string; optionIndex?: number }
  /** The team's choice after a wrong lock: answer again next turn, or flee to an easier question. */
  | { type: "TEAM_WRONG_CHOICE"; questionId: string; choice: "retry" | "flee" }
  /** Lobby only: the team's class, or null for none. The last pick before HOST_START counts. */
  | { type: "TEAM_PICK_CLASS"; classId: ClassId | null }
  /** Spend one use of the team's class ability on `questionId` (PR 1: the warrior's roll). */
  | { type: "TEAM_USE_ABILITY"; questionId: string }
  /** 擲骰說服 on the team's own fill-in turn (dnd design R6, R-E1): the room rolls the check. `eventId`: the STATE it was pressed under (R-E4). */
  | { type: "TEAM_ROLL_CHECK"; questionId: string; eventId: number }
  /** The team's typed answer to a text question, shown to the host to judge. One per question. */
  /** `eventId` is the STATE eventId the answer was typed under; an older one (a send that arrived after
   * the host judged that attempt) is dropped, like HOST_JUDGE. Optional so a phone on an older build still sends. */
  | { type: "TEAM_SUBMIT_TEXT"; questionId: string; text: string; eventId?: number };

/** A d20 rolled and shown for a beat before it is judged. `kind`: the warrior's roll for the answer, the crit die
 * after a correct lock (20 is a critical hit, 1 a fumble), a fill-in's persuasion check (`bonus` + the die against
 * `dc`; nothing of its result is decided before the beat ends), or the boss kill's 4d20 (`values`, the four dice;
 * `value`, the bonus they score, a thief's sneak included; docs/designs/kill-roll.md). Absent from an older server: a warrior's. */
export interface PendingRoll {
  teamId: string;
  questionId: string;
  value: number;
  kind?: "warrior" | "crit" | "check" | "kill";
  bonus?: number;
  dc?: number;
  values?: number[];
}

export type ServerErrorCode =
  | "invalid_team_id"
  | "invalid_name"
  | "game_already_started"
  | "not_host"
  | "bad_token"
  | "bad_password"
  | "no_active_game"
  | "not_enough_teams"
  | "unknown_team"
  | "team_removed"
  /** TEAM_CLAIM's code is wrong, used or expired. */
  | "bad_code"
  | "invalid_action";

/** One per kind of event: the big screen's sound effect for it (lib/sfx.ts). */
export type SoundCue = "start" | "correct" | "retry" | "flee" | "boss-hit" | "boss-phase" | "boss-kill" | "roll" | "crit" | "fumble" | "check-pass" | "check-fail" | "cook";

export const MEDIA_ACTIONS = ["play", "pause", "restart"] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];
/** What the host last asked the big screen's video to do. `seq` goes up on each ⟲ 從頭, so the screen
 * plays from `start` again; `press` on every button. In memory only: absent after a restart, and from older servers (paused). */
export interface MediaCommand {
  questionId: string;
  state: "playing" | "paused";
  seq: number;
  /** Goes up on every press, so a ▶ after the clip stopped itself at its end reaches the player (it replays). */
  press: number;
}

export type ServerMessage =
  /** `replay`: this room has played a game, so the host page leaves 開始前播放玩法說明 unchecked (eng D5). */
  | { type: "LOBBY"; teams: { id: string; name: string; classId?: ClassId }[]; roomEpoch: string; replay?: true }
  | {
      type: "STATE";
      view: SpectatorView;
      phase: GamePhase;
      winners: string[];
      roomEpoch: string;
      question: PublicQuestion | null;
      /** Non-null while the last correct answer is on show; the host's HOST_NEXT clears it. */
      reveal: AnswerReveal | null;
      /** A lock being held for the reveal beat before it is judged (phone-answering.md E2). */
      pendingLock: LockedOption | null;
      /** A d20 being held for the beat before it is judged: a warrior's (class-abilities.md R2) or a correct lock's crit die. */
      pendingRoll: PendingRoll | null;
      /** A wrong sort lock waiting for its 重答 / 逃跑: per slot, top to bottom, whether the team's item there is right. */
      wrongSlots?: boolean[];
      /** Counts judgments (and the start); NARRATION carries the id it belongs to. */
      eventId: number;
      /** The latest sound effect (an event's, or a roll's): the big screen plays it once, when cueSeq goes up.
       * Absent before any cue, and after a server restart. */
      cue?: SoundCue;
      /** Goes up each time the room sets a new cue: the big screen plays `cue` then (a roll's cue is not an event). Absent from older servers. */
      cueSeq?: number;
      /** The boss's phase card is up: `question` is null until the host's 下一題 (docs/designs/boss-phases.md),
       * so the card carries the boss to draw. */
      phaseCard?: { monster: PublicQuestion["monster"] };
      /** How-to-play page on show (1..4); `question` is null until the host leaves page 4. */
      intro?: { page: number };
      /** The boss phase under way, from phase 2 on (phase 1 stays a plain boss). Never a later phase. */
      bossPhaseInfo?: { name: string; rule: string };
      /** Every catalog monster has a dish, so a server since the catalog always sends it: scores read 飽足感 instead of 獎勵分. Absent from older servers. */
      cuisine?: true;
      /** The host's last ▶ ⏸ ⟲ for the video on screen. Only for that video's question; treat anything else as paused. */
      media?: MediaCommand;
      /** A finished game's podium reveal. Absent from older servers and from a game finished before it: show the podium. */
      podium?: PodiumReveal;
    }
  | { type: "GAME_OVER"; winners: string[] }
  /** One per event (1-3 segments, played in order), sent again with `rev` + 1 after each host edit of that eventId.
   * Clients keep the highest eventId they have seen. 3 segments when there's a next team (result + atmosphere +
   * transition), 2 when there isn't (boss-kill, or the game's last judged event) — see docs/designs/multi-segment-narration.md.
   * `rev` is absent from older servers (0); /screen echoes it in SCREEN_NARRATION_PROGRESS so a report about the old
   * text never locks the new one (host-narration-edit.md D14). */
  | { type: "NARRATION"; eventId: number; lines: string[]; rev?: number }
  /** `replay`: set when onConnect resends an epilogue that was already broadcast, so /screen
   * doesn't speak it again; absent on the live broadcast. Older servers never set it. */
  | { type: "EPILOGUE"; text: string; replay?: true }
  /** Host-only reply to HOST_GET_TRANSCRIPT. */
  | { type: "TRANSCRIPT"; entries: TranscriptItem[] }
  | { type: "HOST_OK"; joinPassword: string }
  /** Host-only: how many lines of narration `eventId` the big screen has read. Sent on host connect and on every change. */
  | { type: "HOST_NARRATION_PROGRESS"; eventId: number; done: number }
  /** Host-only: the line queued by HOST_NEXT_LINE, "" when none. Sent on host connect and on every change. */
  | { type: "HOST_NEXT_LINE_STATE"; line: string }
  /** Host-only: who pays for AI narration and how much is left. Never carries the key itself, only its last 4 characters. */
  | {
      type: "HOST_AI_STATUS";
      source: AiSource;
      provider: AiProviderId | null;
      keyHint: string | null;
      /** The source needs a key the room no longer has (it restarted, or the key was refused): the host page resends it. */
      keyMissing: boolean;
      used: number;
      limit: number;
      exhausted: boolean;
      error?: AiKeyError;
    }
  /** Host-only: the answer to the question now in play. Sent with sendTo, never broadcast. */
  | { type: "HOST_ANSWER"; questionId: string; answer: string }
  /** Host-only, sent with every STATE: what the host may queue (HOST_QUEUE_QUESTION) and what is queued.
   * Carries answers, so it goes out with sendTo, never broadcast. */
  | {
      type: "HOST_PICKS";
      questions: HostPick[];
      /** Per target (a room team's id, or "boss"): the question ids it may pick from. */
      options: Record<string, string[]>;
      /** Per target: the queued question id, when there is one. */
      queued: Record<string, string>;
      /** Every boss phase and which one is under way: only the host knows what is still to come. */
      bossPhases: { name: string; rule: string; maxHp: number }[];
      bossPhaseIndex: number;
    }
  /** Host-only, to the page that sent HOST_HANDOFF: the code the team's new phone types. */
  | { type: "HANDOFF_CODE"; teamId: string; code: string }
  /** To the phone whose TEAM_CLAIM matched: the team's id and key, to store and JOIN with. */
  | { type: "TEAM_CLAIMED"; teamId: string; teamKey: string }
  | { type: "ERROR"; error: ServerErrorCode; detail?: string };

/** One bank question in the host's picker: a short label for its content, its answer, and why it can't be picked now. */
export interface HostPick {
  id: string;
  label: string;
  answer: string;
  block?: PickBlock;
}

export type StateMessage = Extract<ServerMessage, { type: "STATE" }>;
export type LobbyTeams = Extract<ServerMessage, { type: "LOBBY" }>["teams"];

export const AI_PROVIDER_IDS = ["anthropic"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];
export type AiSource = "none" | "own" | "owner";
/** invalid_key: refused by the provider or not a key at all. ai_stopped: the breaker switched AI off after repeated failures. */
export type AiKeyError = "invalid_key" | "wrong_owner_key" | "owner_unavailable" | "check_failed" | "ai_stopped";
const MAX_AI_KEY = 256;
/** A room's cap on paid AI narration calls: the default, and the most a host may set. */
export const DEFAULT_AI_LIMIT = 300;
export const MAX_AI_LIMIT = 5000;

const HOST_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
/** Same shape as the host token. */
export const TEAM_KEY_RE = HOST_TOKEN_RE;

/**
 * Shared text cleaner for anything a user types that ends up on a screen or
 * (later) in an LLM prompt: strips HTML-special characters, trims, truncates.
 */
export function sanitizeText(text: string, max: number): string {
  return text
    .replace(/[<>&"']/g, "")
    .trim()
    .slice(0, max);
}

// Raw-length ceilings, checked before any sanitising. A team name is later cut
// to 20 characters; the ceiling here only rejects absurd payloads.
/** Longest id a client message may carry; the bank refuses to save longer question ids (assertSavable). */
export const MAX_ID = 64;
const MAX_RAW_NAME = 100;
export const MAX_RAW_TEXT = 200;
/** A typed answer keeps this many characters (code points). */
export const MAX_TYPED_ANSWER = 40;
export const MAX_PASSWORD = 32;
/** HOST_NEXT_LINE's limit: the AI may add a few characters around it and still fit MAX_LINE. */
export const MAX_EDIT_LINE = 40;
/** How-to-play pages before the first question (docs/designs/how-to-play.md D4). */
export const INTRO_PAGES = 4;
/** A host's handoff code lasts this long (docs/designs/team-handoff.md); the host page hides it then too. */
export const HANDOFF_MS = 5 * 60 * 1000;

/**
 * A typed answer: trimmed, control and bidi-override characters dropped, MAX_TYPED_ANSWER code points,
 * and "" when nothing visible is left (only zero-width characters). Quotes stay (unlike sanitizeText):
 * it is only shown as React text and never goes into an LLM prompt.
 */
export function cleanTypedAnswer(text: string): string {
  const kept = Array.from(text.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, "").trim()).slice(0, MAX_TYPED_ANSWER).join("").trim();
  return /[^\p{Cf}\p{Z}]/u.test(kept) ? kept : "";
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
}

function teamKeyOf(v: unknown): string | null {
  return typeof v === "string" && TEAM_KEY_RE.test(v) ? v : null;
}

/** A whole number, 0 or more. */
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** `{ resume: true }` only for a literal `true`; anything else is simply dropped. */
function resumeOf(m: Record<string, unknown>): { resume?: true } {
  return m.resume === true ? { resume: true } : {};
}

/**
 * Validate an untrusted, already JSON-parsed value into a ClientMessage.
 * Returns null on any missing, wrong-typed or oversize field. Never throws.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;

  switch (m.type) {
    case "JOIN": {
      // No colon: checkKey joins a question id and a team id with one, and question ids may hold it.
      const id = str(m.teamId, MAX_ID);
      const teamId = id?.includes(":") ? null : id;
      const teamName = str(m.teamName, MAX_RAW_NAME);
      const teamKey = teamKeyOf(m.teamKey);
      // Cut, not rejected: an over-long password must not stop a known team (which needs none) from rejoining.
      const password = typeof m.password === "string" ? m.password.slice(0, MAX_PASSWORD) : undefined;
      return teamId !== null && teamName !== null && teamKey !== null
        ? { type: "JOIN", teamId, teamKey, teamName, ...(password ? { password } : {}), ...resumeOf(m) }
        : null;
    }
    case "REJOIN": {
      const teamId = str(m.teamId, MAX_ID);
      const teamKey = teamKeyOf(m.teamKey);
      return teamId !== null && teamKey !== null ? { type: "REJOIN", teamId, teamKey, ...resumeOf(m) } : null;
    }
    case "HOST_CLAIM":
      return typeof m.token === "string" && HOST_TOKEN_RE.test(m.token)
        ? { type: "HOST_CLAIM", token: m.token, ...resumeOf(m) }
        : null;
    case "HOST_START":
      if (m.aiNarration !== undefined && typeof m.aiNarration !== "boolean") return null;
      if (m.intro !== undefined && typeof m.intro !== "boolean") return null;
      return { type: "HOST_START", aiNarration: m.aiNarration, ...(m.intro ? { intro: true } : {}) };
    case "HOST_INTRO":
      return Number.isInteger(m.page) && (m.page as number) >= 1 && (m.page as number) <= INTRO_PAGES + 1
        ? { type: "HOST_INTRO", page: m.page as number }
        : null;
    case "HOST_AI_KEY": {
      if (m.source === "none") return { type: "HOST_AI_KEY", source: "none" };
      if (m.source === "owner") {
        const ownerKey = str(m.ownerKey, MAX_AI_KEY);
        return ownerKey ? { type: "HOST_AI_KEY", source: "owner", ownerKey } : null;
      }
      // The key's format is the room's check (invalid_key), not a malformed message.
      const key = str(m.key, MAX_AI_KEY);
      const provider = AI_PROVIDER_IDS.find((p) => p === m.provider);
      return m.source === "own" && key && provider ? { type: "HOST_AI_KEY", source: "own", provider, key } : null;
    }
    case "HOST_AI_LIMIT":
      return Number.isInteger(m.limit) && (m.limit as number) >= 1 && (m.limit as number) <= MAX_AI_LIMIT
        ? { type: "HOST_AI_LIMIT", limit: m.limit as number }
        : null;
    case "HOST_SET_PASSWORD": {
      const password = str(m.password, MAX_PASSWORD);
      return password !== null ? { type: "HOST_SET_PASSWORD", password } : null;
    }
    case "HOST_EDIT_NARRATION": {
      // The raw ceiling, not MAX_LINE: a scripted line can run past MAX_LINE (long team and monster names), and its
      // prefilled edit must still land. The room cuts it to MAX_LINE (D18).
      const line = str(m.line, MAX_RAW_TEXT);
      if (line === null || !isCount(m.eventId) || !isCount(m.rev) || !isCount(m.index)) return null;
      return { type: "HOST_EDIT_NARRATION", eventId: m.eventId, rev: m.rev, index: m.index, line };
    }
    case "SCREEN_NARRATION_PROGRESS":
      return isCount(m.eventId) && isCount(m.rev) && isCount(m.done)
        ? { type: "SCREEN_NARRATION_PROGRESS", eventId: m.eventId, rev: m.rev, done: m.done }
        : null;
    case "HOST_NEXT_LINE": {
      const line = str(m.line, MAX_EDIT_LINE);
      return line !== null ? { type: "HOST_NEXT_LINE", line } : null;
    }
    case "HOST_GET_TRANSCRIPT":
      return { type: "HOST_GET_TRANSCRIPT" };
    case "HOST_NEXT":
    case "HOST_SERVE":
      return Number.isInteger(m.eventId) && (m.eventId as number) >= 0 ? { type: m.type, eventId: m.eventId as number } : null;
    case "HOST_SEND_TO_BOSS": {
      const teamId = str(m.teamId, MAX_ID);
      return teamId === null ? null : { type: "HOST_SEND_TO_BOSS", teamId };
    }
    case "HOST_REVEAL": {
      const teamId = str(m.teamId, MAX_ID);
      const questionId = str(m.questionId, MAX_ID);
      return teamId === null || questionId === null ? null : { type: "HOST_REVEAL", teamId, questionId };
    }
    case "HOST_MEDIA": {
      const questionId = str(m.questionId, MAX_ID);
      const action = MEDIA_ACTIONS.find((a) => a === m.action);
      return questionId === null || !action ? null : { type: "HOST_MEDIA", questionId, action };
    }
    case "HOST_END_GAME":
      return { type: "HOST_END_GAME" };
    case "HOST_BACK_TO_LOBBY":
      return { type: "HOST_BACK_TO_LOBBY" };
    case "HOST_REMOVE_TEAM": {
      const teamId = str(m.teamId, MAX_ID);
      return teamId === null ? null : { type: "HOST_REMOVE_TEAM", teamId };
    }
    case "HOST_RENAME_TEAM": {
      const teamId = str(m.teamId, MAX_ID);
      const teamName = str(m.teamName, MAX_RAW_TEXT);
      return teamId === null || teamName === null ? null : { type: "HOST_RENAME_TEAM", teamId, teamName };
    }
    case "HOST_HANDOFF": {
      const teamId = str(m.teamId, MAX_ID);
      return teamId === null ? null : { type: "HOST_HANDOFF", teamId };
    }
    case "TEAM_CLAIM":
      return typeof m.code === "string" && /^\d{4}$/.test(m.code) ? { type: "TEAM_CLAIM", code: m.code } : null;
    case "HOST_QUEUE_QUESTION": {
      const target = str(m.target, MAX_ID);
      const questionId = m.questionId === null ? null : str(m.questionId, MAX_ID);
      if (target === null || (questionId === null && m.questionId !== null)) return null;
      return { type: "HOST_QUEUE_QUESTION", target, questionId };
    }
    case "HOST_JUDGE": {
      const teamId = str(m.teamId, MAX_ID);
      const questionId = str(m.questionId, MAX_ID);
      if (teamId === null || questionId === null || typeof m.correct !== "boolean") return null;
      if (m.fleeChoice !== undefined && m.fleeChoice !== "flee" && m.fleeChoice !== "retry" && m.fleeChoice !== "team" && m.fleeChoice !== "pray") return null;
      if (m.correct && (m.fleeChoice === "team" || m.fleeChoice === "pray")) return null;
      if (m.eventId !== undefined && !(Number.isInteger(m.eventId) && (m.eventId as number) >= 0)) return null;
      return { type: "HOST_JUDGE", teamId, questionId, correct: m.correct, fleeChoice: m.fleeChoice, ...(m.eventId !== undefined ? { eventId: m.eventId as number } : {}) };
    }
    case "TEAM_SELECT_OPTION": {
      const questionId = str(m.questionId, MAX_ID);
      if (questionId === null || !Number.isInteger(m.optionIndex) || (m.optionIndex as number) < 0) return null;
      return { type: "TEAM_SELECT_OPTION", questionId, optionIndex: m.optionIndex as number };
    }
    case "TEAM_LOCK_OPTION": {
      const questionId = str(m.questionId, MAX_ID);
      if (questionId === null) return null;
      if (m.optionIndex === undefined) return { type: "TEAM_LOCK_OPTION", questionId };
      if (!Number.isInteger(m.optionIndex) || (m.optionIndex as number) < 0) return null;
      return { type: "TEAM_LOCK_OPTION", questionId, optionIndex: m.optionIndex as number };
    }
    case "TEAM_WRONG_CHOICE": {
      const questionId = str(m.questionId, MAX_ID);
      if (questionId === null || (m.choice !== "retry" && m.choice !== "flee")) return null;
      return { type: "TEAM_WRONG_CHOICE", questionId, choice: m.choice };
    }
    case "TEAM_PICK_CLASS":
      return m.classId === null || isClassId(m.classId) ? { type: "TEAM_PICK_CLASS", classId: m.classId } : null;
    case "TEAM_USE_ABILITY": {
      const questionId = str(m.questionId, MAX_ID);
      return questionId === null ? null : { type: "TEAM_USE_ABILITY", questionId };
    }
    case "TEAM_ROLL_CHECK": {
      const questionId = str(m.questionId, MAX_ID);
      if (questionId === null || !(Number.isInteger(m.eventId) && (m.eventId as number) >= 0)) return null;
      return { type: "TEAM_ROLL_CHECK", questionId, eventId: m.eventId as number };
    }
    case "TEAM_SUBMIT_TEXT": {
      const questionId = str(m.questionId, MAX_ID);
      const text = str(m.text, MAX_RAW_TEXT);
      if (questionId === null || text === null) return null;
      if (m.eventId !== undefined && !(Number.isInteger(m.eventId) && (m.eventId as number) >= 0)) return null;
      return { type: "TEAM_SUBMIT_TEXT", questionId, text, ...(m.eventId !== undefined ? { eventId: m.eventId as number } : {}) };
    }
    default:
      return null;
  }
}
