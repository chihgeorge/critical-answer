// Typed narration events, derived from what just happened in the game. This is
// the seam every narration provider (scripted now, LLM later) reads.

import type { AnswerOutcome, GameState } from "../game-state";

export type NarrationEvent =
  | { type: "start"; teams: string[] }
  | { type: "correct"; team: string; monster: string; points: number }
  | { type: "retry"; team: string; monster: string }
  | { type: "flee"; team: string; monster: string }
  | { type: "boss-hit"; team: string; bossHp: number; bossMaxHp: number }
  | { type: "boss-kill"; team: string; monster: string; bonus: number }
  /** Game over: ranking is sorted high to low. Longer line, longer timeout. */
  | { type: "epilogue"; ranking: { name: string; score: number }[]; winners: string[] };

/**
 * Pure. `prev` is the game before the judgment (it names the team and gives the
 * boss's full HP); `monster` is the monster the team was facing, supplied by the
 * caller because the bank lives on the server.
 */
export function toNarrationEvent(prev: GameState, outcome: AnswerOutcome, monster: string): NarrationEvent {
  const team = prev.teams.find((t) => t.id === outcome.teamId)?.name ?? "冒險者";
  switch (outcome.type) {
    case "correct-room-advance":
      return { type: "correct", team, monster, points: outcome.pointsAwarded };
    case "incorrect-retry":
      return { type: "retry", team, monster };
    case "incorrect-flee":
      return { type: "flee", team, monster };
    case "correct-boss-hit":
      return outcome.bossKilled
        ? { type: "boss-kill", team, monster, bonus: outcome.killBonus ?? 0 }
        : { type: "boss-hit", team, bossHp: outcome.bossHpRemaining, bossMaxHp: prev.boss.maxHp };
  }
}
