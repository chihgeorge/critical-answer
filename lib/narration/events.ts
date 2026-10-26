// Typed narration events, derived from what just happened in the game. This is
// the seam every narration provider (scripted now, LLM later) reads.

import { BRANCH_LABELS, type AnswerOutcome, type GameState } from "../game-state";

/** Who is up next and what they face: the story moves on to them after the result line. */
export interface NextTurn {
  team: string;
  monster: string;
  boss: boolean;
}

type WithNext<T> = T & { next?: NextTurn };

export type NarrationEvent =
  | WithNext<{ type: "start"; teams: string[] }>
  /** `entersBoss`: this answer moved the team into the boss room (it reached the boss
   * threshold, or another team was already inside: Team.inBoss). `branches`
   * are the DM branch choices it made on the way (display text, room order), for the LLM to call
   * back; the scripted lines just announce the entrance (design doc T4: no forced callback template). */
  | WithNext<{ type: "correct"; team: string; monster: string; points: number; entersBoss?: { branches: string[] } }>
  /** `boss`: a wrong boss answer, which always brings a new question (boss redesign D2=B). */
  | WithNext<{ type: "retry"; team: string; monster: string; boss?: true }>
  | WithNext<{ type: "flee"; team: string; monster: string }>
  | WithNext<{ type: "boss-hit"; team: string; bossHp: number; bossMaxHp: number }>
  | WithNext<{ type: "boss-kill"; team: string; monster: string; bonus: number }>
  /** Game over: ranking is sorted high to low. Longer line, longer timeout. */
  // ranking[].score carries reward points (Team.reward), not progress points (Team.score).
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

/** A team's branch choices as display text, in the order of the rooms it made them in. */
function branchesOf(team: GameState["teams"][number]): string[] {
  return Object.entries(team.branchChoices)
    .sort(([a], [b]) => Number(a) - Number(b))
    .flatMap(([, id]) => (id ? [BRANCH_LABELS[id]] : []));
}

function baseEvent(prev: GameState, outcome: AnswerOutcome, monster: string): Exclude<NarrationEvent, { type: "epilogue" }> {
  const t = prev.teams.find((x) => x.id === outcome.teamId);
  const team = t?.name ?? "冒險者";
  switch (outcome.type) {
    case "correct-room-advance": {
      // A team already in the boss room answers correct-boss-hit, never this, so entersBoss fires once per team.
      const entersBoss = !!t && outcome.entersBoss;
      return {
        type: "correct",
        team,
        monster,
        points: outcome.reward,
        ...(entersBoss ? { entersBoss: { branches: branchesOf(t) } } : {}),
      };
    }
    case "incorrect-retry":
      return { type: "retry", team, monster, ...(outcome.newBossQuestion ? { boss: true as const } : {}) };
    case "incorrect-flee":
      return { type: "flee", team, monster };
    case "correct-boss-hit":
      return outcome.bossKilled
        ? { type: "boss-kill", team, monster, bonus: outcome.killBonus ?? 0 }
        : { type: "boss-hit", team, bossHp: outcome.bossHpRemaining, bossMaxHp: prev.boss.maxHp };
  }
}
