// PartyKit client/server message contract for the dungeon room.
//
// Iteration 1 has no host quiz-editor UI or player text input (see
// docs/designs/critical-answer-party-game.md, Next Steps #7): the host reads
// each question aloud off a fixed fixture set and judges the current team's
// answer correct/incorrect. Only the host can send HOST_JUDGE — trusting a
// team's own "I got it right" claim would let them self-score.

import type { GamePhase, SpectatorView } from "./game-state";

export type ClientMessage =
  | { type: "JOIN"; teamId: string; teamName: string }
  | { type: "REJOIN"; teamId: string }
  | { type: "HOST_START" }
  | {
      type: "HOST_JUDGE";
      teamId: string;
      questionId: string;
      correct: boolean;
      fleeChoice?: "flee" | "retry";
    };

export type ServerErrorCode =
  | "invalid_team_id"
  | "invalid_name"
  | "game_already_started"
  | "not_host"
  | "no_active_game"
  | "not_enough_teams"
  | "unknown_team"
  | "invalid_action";

export type ServerMessage =
  | { type: "LOBBY"; teams: { id: string; name: string }[] }
  | { type: "STATE"; view: SpectatorView; phase: GamePhase; winners: string[] }
  | { type: "GAME_OVER"; winners: string[] }
  | { type: "ERROR"; error: ServerErrorCode; detail?: string };
