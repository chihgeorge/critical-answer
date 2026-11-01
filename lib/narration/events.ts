// Typed narration events, derived from what just happened in the game. This is
// the seam every narration provider (scripted now, LLM later) reads.

import { BRANCH_LABELS, type AnswerOutcome, type GameState } from "../game-state";

/** Who is up next and what they face: the story moves on to them after the result line. */
export interface NextTurn {
  team: string;
  monster: string;
  boss: boolean;
}

/** `hostLine`: the line the host queued for this narration (HOST_NEXT_LINE); segment 2 always says it
 * (docs/designs/host-next-line.md). `hostLineVerbatim`: it holds a bank answer, so the LLM never sees it. */
type WithNext<T> = T & { next?: NextTurn; hostLine?: string; hostLineVerbatim?: true };

export type NarrationEvent =
  | WithNext<{ type: "start"; teams: string[] }>
  /** `entersBoss`: this answer moved the team into the boss room (it reached the boss
   * threshold, or another team was already inside: Team.inBoss). `branches`
   * are the DM branch choices it made on the way (display text, room order), for the LLM to call
   * back; the scripted lines just announce the entrance (design doc T4: no forced callback template).
   * `phase`: the boss phase already under way when a late team walks in, from phase 2 on (boss-phases.md D13). */
  /** `dish` (correct and boss-kill): what the monster was cooked into; left out when it holds a bank answer. */
  | WithNext<{ type: "correct"; team: string; monster: string; points: number; dish?: string; entersBoss?: { branches: string[]; phase?: string } }>
  /** `boss`: a wrong boss answer, which always brings a new question (boss redesign D2=B).
   * `exhausted`: it used up the boss phase's questions, and the phase card comes next (boss-phases.md). */
  | WithNext<{ type: "retry"; team: string; monster: string; boss?: true; exhausted?: true }>
  | WithNext<{ type: "flee"; team: string; monster: string }>
  /** `bossHp` 0 without a kill: an earlier phase's bar emptied, and the next phase is still a secret.
   * `exhausted`: the hit used up the phase's questions with HP left, and the phase card comes next. */
  | WithNext<{ type: "boss-hit"; team: string; bossHp: number; bossMaxHp: number; exhausted?: true }>
  /** The phase card opened: the boss is back with a new bar. `phase` counts from 1; nothing about later phases. */
  | WithNext<{ type: "boss-phase"; monster: string; phase: number; name: string; rule: string }>
  | WithNext<{ type: "boss-kill"; team: string; monster: string; bonus: number; dish?: string }>
  /** Game over: ranking is sorted high to low. Longer line, longer timeout. */
  // ranking[].score carries reward points (Team.reward), not progress points (Team.score).
  // ranking[].dishes: what the team ate, without any dish holding a bank answer.
  | { type: "epilogue"; ranking: { name: string; score: number; dishes?: string[] }[]; winners: string[] };

/**
 * Pure. `prev` is the game before the judgment (it names the team and gives the
 * boss's full HP); `monster` is the monster the team was facing, supplied by the
 * caller because the bank lives on the server.
 */
export function toNarrationEvent(prev: GameState, outcome: AnswerOutcome, monster: string, next?: NextTurn, bossPhase?: string): NarrationEvent {
  const event = baseEvent(prev, outcome, monster, bossPhase);
  // A finished game has nobody next: the last line stands alone.
  return next && event.type !== "boss-kill" ? { ...event, next } : event;
}

/** A team's branch choices as display text, in the order of the rooms it made them in. */
function branchesOf(team: GameState["teams"][number]): string[] {
  return Object.entries(team.branchChoices)
    .sort(([a], [b]) => Number(a) - Number(b))
    .flatMap(([, id]) => (id ? [BRANCH_LABELS[id]] : []));
}

/** `bossPhase`: the current boss phase's name, given only from phase 2 on. */
function baseEvent(prev: GameState, outcome: AnswerOutcome, monster: string, bossPhase?: string): Exclude<NarrationEvent, { type: "epilogue" }> {
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
        ...(entersBoss ? { entersBoss: { branches: branchesOf(t), ...(bossPhase ? { phase: bossPhase } : {}) } } : {}),
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
