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
// is a score claim — a branch pick and a multiple-choice pick both leave the
// actual correct/incorrect call to the host (HOST_JUDGE), so the self-scoring
// risk above does not apply. Both derive their sender's team from the
// connection's own connTeam binding (set at JOIN/REJOIN) — never from a
// client-supplied team id — so no teamKey is needed on either message,
// unlike JOIN/REJOIN. Unlike TEAM_BRANCH_CHOICE, TEAM_SELECT_OPTION is
// re-selectable (a later pick for the same question overwrites the earlier
// one) — picking an option is a "change your mind before the host looks"
// interaction, not a one-time narrative fork.
//
// Host identity is a token minted by the host's browser at room creation.
// The first HOST_CLAIM for a room sets it (trust on first use, on a 4-letter
// room code); every later claim must match. See lib/room/dungeon-room.ts.

import { isBranchOptionId, type BranchOptionId, type GamePhase, type SpectatorView } from "./game-state";
import type { SpriteKind } from "./sprite-kind";
import type { TranscriptItem } from "./narration/runner";

export const MAX_TEAMS = 8;

/** The question the team in turn faces, without its answer: safe for /screen and /play.
 * `options` is present only for multipleChoice questions (never `correctIndex` — see
 * question-bank.ts's publicQuestion() field-picking discipline). */
export interface PublicQuestion {
  id: string;
  text: string;
  difficulty: number;
  boss: boolean;
  monster: { name: string; sprite: SpriteKind; hue: number };
  options?: string[];
}

export type ClientMessage =
  /** `teamKey` is the team's secret. teamId is public (every STATE broadcasts it), so the key is what proves a connection owns the team. */
  | { type: "JOIN"; teamId: string; teamKey: string; teamName: string }
  | { type: "REJOIN"; teamId: string; teamKey: string }
  | { type: "HOST_CLAIM"; token: string }
  | { type: "HOST_START"; aiNarration?: boolean }
  /** Director: free-text style notes (<= 500 chars) injected into every LLM call. */
  | { type: "HOST_SET_NOTES"; notes: string }
  /** Director: replace the line now on screen (<= 40 chars). */
  | { type: "HOST_EDIT_NARRATION"; line: string }
  | { type: "HOST_GET_TRANSCRIPT" }
  | {
      type: "HOST_JUDGE";
      teamId: string;
      questionId: string;
      correct: boolean;
      fleeChoice?: "flee" | "retry";
    }
  /** DM branching interlude pick, sent by the team's own phone. See the module header. */
  | { type: "TEAM_BRANCH_CHOICE"; roomIndex: number; choice: BranchOptionId }
  /** MultipleChoice pick, sent by the team's own phone. Re-selectable — see the module header.
   * `optionIndex` is only type-checked here (non-negative integer); the real bounds check
   * against the live question's actual options.length happens in dungeon-room.ts, which is
   * the only layer that has the current game state. */
  | { type: "TEAM_SELECT_OPTION"; questionId: string; optionIndex: number };

export type ServerErrorCode =
  | "invalid_team_id"
  | "invalid_name"
  | "game_already_started"
  | "not_host"
  | "bad_token"
  | "no_active_game"
  | "not_enough_teams"
  | "unknown_team"
  | "invalid_action";

export type ServerMessage =
  | { type: "LOBBY"; teams: { id: string; name: string }[]; roomEpoch: string }
  | {
      type: "STATE";
      view: SpectatorView;
      phase: GamePhase;
      winners: string[];
      roomEpoch: string;
      question: PublicQuestion | null;
      /** Counts judgments (and the start); NARRATION carries the id it belongs to. */
      eventId: number;
    }
  | { type: "GAME_OVER"; winners: string[] }
  /** Exactly one per event (it may carry two lines). Clients keep the highest eventId they have seen. */
  /** `then`: a follow-up line about the team now on turn, shown after `line` (absent at game over). */
  | { type: "NARRATION"; eventId: number; line: string; then?: string }
  | { type: "EPILOGUE"; text: string }
  /** Host-only reply to HOST_GET_TRANSCRIPT. */
  | { type: "TRANSCRIPT"; entries: TranscriptItem[] }
  /** `aiAvailable`: the server has an API key, so the host may turn AI narration on. */
  | { type: "HOST_OK"; aiAvailable: boolean }
  /** Host-only: the answer to the question now in play. Sent with sendTo, never broadcast. */
  | { type: "HOST_ANSWER"; questionId: string; answer: string }
  | { type: "ERROR"; error: ServerErrorCode; detail?: string };

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
export const MAX_EDIT_LINE = 40;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
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
      const teamKey = typeof m.teamKey === "string" && TEAM_KEY_RE.test(m.teamKey) ? m.teamKey : null;
      return teamId !== null && teamName !== null && teamKey !== null ? { type: "JOIN", teamId, teamKey, teamName } : null;
    }
    case "REJOIN": {
      const teamId = str(m.teamId, MAX_ID);
      const teamKey = typeof m.teamKey === "string" && TEAM_KEY_RE.test(m.teamKey) ? m.teamKey : null;
      return teamId !== null && teamKey !== null ? { type: "REJOIN", teamId, teamKey } : null;
    }
    case "HOST_CLAIM":
      return typeof m.token === "string" && HOST_TOKEN_RE.test(m.token)
        ? { type: "HOST_CLAIM", token: m.token }
        : null;
    case "HOST_START":
      if (m.aiNarration !== undefined && typeof m.aiNarration !== "boolean") return null;
      return { type: "HOST_START", aiNarration: m.aiNarration };
    case "HOST_SET_NOTES": {
      const notes = str(m.notes, MAX_NOTES);
      return notes !== null ? { type: "HOST_SET_NOTES", notes } : null;
    }
    case "HOST_EDIT_NARRATION": {
      const line = str(m.line, MAX_EDIT_LINE);
      return line !== null ? { type: "HOST_EDIT_NARRATION", line } : null;
    }
    case "HOST_GET_TRANSCRIPT":
      return { type: "HOST_GET_TRANSCRIPT" };
    case "HOST_JUDGE": {
      const teamId = str(m.teamId, MAX_ID);
      const questionId = str(m.questionId, MAX_ID);
      if (teamId === null || questionId === null || typeof m.correct !== "boolean") return null;
      if (m.fleeChoice !== undefined && m.fleeChoice !== "flee" && m.fleeChoice !== "retry") return null;
      return { type: "HOST_JUDGE", teamId, questionId, correct: m.correct, fleeChoice: m.fleeChoice };
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
    default:
      return null;
  }
}
