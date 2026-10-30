// PartyKit client/server message contract for the dungeon room.
//
// Iteration 1 has no host quiz-editor UI or player text input (see
// docs/designs/critical-answer-party-game.md, Next Steps #7): the host reads
// each question aloud off a fixed fixture set and judges the current team's
// answer correct/incorrect. Only the host can send HOST_JUDGE — trusting a
// team's own "I got it right" claim would let them self-score.
//
// TEAM_BRANCH_CHOICE and TEAM_SELECT_OPTION are the exceptions to "only the
// host mutates game state" (docs/designs/dm-branching-and-question-types.md
// decision 1; docs/designs/multiple-choice-questions.md decision 5): neither
// is a score claim. A branch pick changes no score, and a multiple-choice pick
// or lock is judged by the room against the shown correctIndex (the bank's, moved by
// the game's optionOrder), which never
// reaches a client (docs/designs/phone-answering.md), so the self-scoring risk
// above does not apply. Both derive their sender's team from the
// connection's own connTeam binding (set at JOIN/REJOIN) — never from a
// client-supplied team id — so no teamKey is needed on either message,
// unlike JOIN/REJOIN. Unlike TEAM_BRANCH_CHOICE, TEAM_SELECT_OPTION is
// re-selectable (a later pick for the same question overwrites the earlier
// one) until TEAM_LOCK_OPTION commits it — not a one-time narrative fork.
//
// TEAM_PICK_CLASS and TEAM_USE_ABILITY (docs/designs/class-abilities.md) also
// come from the team's own phone, bound by connTeam. A class pick is lobby-only;
// the ability's result (the warrior's d20) is rolled by the room, never sent by
// the phone, so neither message is a score claim either.
//
// Host identity is a token minted by the host's browser at room creation.
// The first HOST_CLAIM for a room sets it (trust on first use, on a 4-letter
// room code); every later claim must match. See lib/room/dungeon-room.ts.

import { isBranchOptionId, isClassId, type BranchOptionId, type ClassId, type GamePhase, type LockedOption, type PickBlock, type SpectatorView } from "./game-state";
import type { SpriteKind } from "./sprite-kind";
import type { TranscriptItem } from "./narration/runner";

export const MAX_TEAMS = 8;

/** A question's (or explanation's) content, wire-safe: `image`'s `url` is a public R2 URL, never
 * the raw storage key; `youtube`'s `videoId` is the extracted id, never the pasted URL. See
 * docs/designs/question-media-content.md's D1 (content replaces the old fixed `text` prompt). */
export type PublicMediaContent = { kind: "text"; value: string } | { kind: "image"; url: string } | { kind: "youtube"; videoId: string };

/** The question the team in turn faces, without its answer: safe for /screen and /play.
 * `options` is present only for multipleChoice questions (never `correctIndex` — see
 * question-bank.ts's publicQuestion() field-picking discipline). Deliberately carries no
 * `explanation` — that would leak the answer's supporting content before the answer is judged;
 * see AnswerReveal below, built separately at judge time from the question that was just
 * answered, never from the question currently in play. */
export interface PublicQuestion {
  id: string;
  content: PublicMediaContent;
  difficulty: number;
  boss: boolean;
  monster: { name: string; sprite: SpriteKind; hue: number };
  options?: string[];
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
  /** Set when a team's lock was judged (phone answering): the answered question's options, which one
   * was right, who locked it and the points it scored, so every screen can light the tile (D8, D14).
   * Safe to send: it goes out only once the answer is revealed. */
  choice?: { options: string[]; correctIndex: number; teamId: string; points: number };
};

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
  | { type: "HOST_START"; aiNarration?: boolean }
  /** Which key pays for AI narration in this room. The key stays in the room's memory and is never sent back. */
  | { type: "HOST_AI_KEY"; source: "own"; provider: AiProviderId; key: string }
  /** The server's own key, for whoever knows OWNER_KEY. */
  | { type: "HOST_AI_KEY"; source: "owner"; ownerKey: string }
  /** Forget the key: scripted narration from now on. */
  | { type: "HOST_AI_KEY"; source: "none" }
  /** Most paid AI calls this room may make (1..MAX_AI_LIMIT). */
  | { type: "HOST_AI_LIMIT"; limit: number }
  /** Director: free-text style notes (<= 500 chars) injected into every LLM call. */
  | { type: "HOST_SET_NOTES"; notes: string }
  /** Join password for new teams; "" lets anyone with the room code join. */
  | { type: "HOST_SET_PASSWORD"; password: string }
  /** Director: replace the line now on screen (<= 40 chars). */
  | { type: "HOST_EDIT_NARRATION"; line: string }
  | { type: "HOST_GET_TRANSCRIPT" }
  /** Director: close the answer reveal and show the next question (D7). `eventId` is the STATE
   * eventId the reveal arrived with, so a late HOST_NEXT (second host device, a send buffered
   * across a reconnect) can't close a newer reveal the room hasn't seen yet. */
  | { type: "HOST_NEXT"; eventId: number }
  /** Host override: take a team into the boss room (docs/designs/scoring-and-score-pools.md S13). */
  | { type: "HOST_SEND_TO_BOSS"; teamId: string }
  /** Host: the next question for a team's room, or with target "boss" the boss's; null clears it (game-state queueQuestion). */
  | { type: "HOST_QUEUE_QUESTION"; target: string; questionId: string | null }
  | {
      type: "HOST_JUDGE";
      teamId: string;
      questionId: string;
      correct: boolean;
      fleeChoice?: "flee" | "retry";
      /** The eventId of the STATE the host judged from; an older one is a stale press and is dropped. */
      eventId?: number;
    }
  /** DM branching interlude pick, sent by the team's own phone. See the module header. */
  | { type: "TEAM_BRANCH_CHOICE"; roomIndex: number; choice: BranchOptionId }
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
  | { type: "TEAM_USE_ABILITY"; questionId: string };

/** The warrior's d20, rolled and shown before it is judged (the beat, like a lock's). */
export interface PendingRoll {
  teamId: string;
  questionId: string;
  value: number;
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
  | "invalid_action";

/** One per kind of event: the big screen's sound effect for it (lib/sfx.ts). */
export type SoundCue = "start" | "correct" | "retry" | "flee" | "boss-hit" | "boss-phase" | "boss-kill";

export type ServerMessage =
  | { type: "LOBBY"; teams: { id: string; name: string; classId?: ClassId }[]; roomEpoch: string }
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
      /** A warrior's roll being held for the beat before it is judged (class-abilities.md R2). */
      pendingRoll: PendingRoll | null;
      /** Counts judgments (and the start); NARRATION carries the id it belongs to. */
      eventId: number;
      /** The sound effect for event `eventId` (the big screen plays it once, when eventId goes up).
       * Absent before any event, and after a server restart. */
      cue?: SoundCue;
      /** The boss's phase card is up: `question` is null until the host's 下一題 (docs/designs/boss-phases.md),
       * so the card carries the boss to draw. */
      phaseCard?: { monster: PublicQuestion["monster"] };
      /** The boss phase under way, from phase 2 on (phase 1 stays a plain boss). Never a later phase. */
      bossPhaseInfo?: { name: string; rule: string };
    }
  | { type: "GAME_OVER"; winners: string[] }
  /** Exactly one per event (1-3 segments, played in order). Clients keep the highest eventId they
   * have seen. 3 segments when there's a next team (result + atmosphere + transition), 2 when there
   * isn't (boss-kill, or the game's last judged event) — see docs/designs/multi-segment-narration.md. */
  | { type: "NARRATION"; eventId: number; lines: string[] }
  /** `replay`: set when onConnect resends an epilogue that was already broadcast, so /screen
   * doesn't speak it again; absent on the live broadcast. Older servers never set it. */
  | { type: "EPILOGUE"; text: string; replay?: true }
  /** Host-only reply to HOST_GET_TRANSCRIPT. */
  | { type: "TRANSCRIPT"; entries: TranscriptItem[] }
  | { type: "HOST_OK"; joinPassword: string }
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

export const HOST_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
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
const MAX_ID = 64;
const MAX_RAW_NAME = 100;
export const MAX_NOTES = 500;
export const MAX_PASSWORD = 32;
export const MAX_EDIT_LINE = 40;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
}

function teamKeyOf(v: unknown): string | null {
  return typeof v === "string" && TEAM_KEY_RE.test(v) ? v : null;
}

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
      const teamId = str(m.teamId, MAX_ID);
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
      return { type: "HOST_START", aiNarration: m.aiNarration };
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
    case "HOST_SET_NOTES": {
      const notes = str(m.notes, MAX_NOTES);
      return notes !== null ? { type: "HOST_SET_NOTES", notes } : null;
    }
    case "HOST_SET_PASSWORD": {
      const password = str(m.password, MAX_PASSWORD);
      return password !== null ? { type: "HOST_SET_PASSWORD", password } : null;
    }
    case "HOST_EDIT_NARRATION": {
      const line = str(m.line, MAX_EDIT_LINE);
      return line !== null ? { type: "HOST_EDIT_NARRATION", line } : null;
    }
    case "HOST_GET_TRANSCRIPT":
      return { type: "HOST_GET_TRANSCRIPT" };
    case "HOST_NEXT":
      return Number.isInteger(m.eventId) && (m.eventId as number) >= 0 ? { type: "HOST_NEXT", eventId: m.eventId as number } : null;
    case "HOST_SEND_TO_BOSS": {
      const teamId = str(m.teamId, MAX_ID);
      return teamId === null ? null : { type: "HOST_SEND_TO_BOSS", teamId };
    }
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
      if (m.fleeChoice !== undefined && m.fleeChoice !== "flee" && m.fleeChoice !== "retry") return null;
      if (m.eventId !== undefined && !(Number.isInteger(m.eventId) && (m.eventId as number) >= 0)) return null;
      return { type: "HOST_JUDGE", teamId, questionId, correct: m.correct, fleeChoice: m.fleeChoice, ...(m.eventId !== undefined ? { eventId: m.eventId as number } : {}) };
    }
    case "TEAM_BRANCH_CHOICE": {
      if (!Number.isInteger(m.roomIndex) || !isBranchOptionId(m.choice)) return null;
      return { type: "TEAM_BRANCH_CHOICE", roomIndex: m.roomIndex as number, choice: m.choice };
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
    default:
      return null;
  }
}
