// Typed narration events, derived from what just happened in the game. This is
// the seam every narration provider (scripted now, LLM later) reads.

import type { AnswerOutcome, GameState } from "../game-state";

/** Who is up next and what they face: the story moves on to them after the result line. */
export interface NextTurn {
  team: string;
  monster: string;
  boss: boolean;
}

type WithNext<T> = T & { next?: NextTurn };

export type NarrationEvent =
  | WithNext<{ type: "start"; teams: string[] }>
  | WithNext<{ type: "correct"; team: string; monster: string; points: number }>
  | WithNext<{ type: "retry"; team: string; monster: string }>
  | WithNext<{ type: "flee"; team: string; monster: string }>
  | WithNext<{ type: "boss-hit"; team: string; bossHp: number; bossMaxHp: number }>
  | WithNext<{ type: "boss-kill"; team: string; monster: string; bonus: number }>
  /** Game over: ranking is sorted high to low. Longer line, longer timeout. */
  | { type: "epilogue"; ranking: { name: string; score: number }[]; winners: string[] };

/**
 * Pure. `prev` is the game before the judgment (it names the team and gives the
 * boss's full HP); `monster` is the monster the team was facing, supplied by the
 * caller because the bank lives on the server.
 */
export function toNarrationEvent(prev: GameState, outcome: AnswerOutcome, monster: string, next?: NextTurn): NarrationEvent {
  const event = baseEvent(prev, outcome, monster);
  // A finished game has nobody next: the last line stands alone.
  return next && event.type !== "boss-kill" ? { ...event, next } : event;
}

function baseEvent(prev: GameState, outcome: AnswerOutcome, monster: string): Exclude<NarrationEvent, { type: "epilogue" }> {
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
