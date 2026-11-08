// Typed narration events, derived from what just happened in the game. This is
// the seam every narration provider (scripted now, LLM later) reads.

import { type AnswerOutcome, type ClassId, type EventOutcome, type EventScene, type GameState, type RollMark } from "../game-state";

/** Who is up next and what they face: the story moves on to them after the result line. */
export interface NextTurn {
  team: string;
  monster: string;
  boss: boolean;
  /** The team stands in an event room (docs/designs/event-rooms.md): the line sets this scene, with no monster and no spoiler. */
  event?: EventScene;
}

/** `hostLine`: the line the host queued for this narration (HOST_NEXT_LINE); segment 2 always says it
 * (docs/designs/host-next-line.md). `hostLineVerbatim`: it holds a bank answer, so the LLM never sees it. */
type WithNext<T> = T & { next?: NextTurn; hostLine?: string; hostLineVerbatim?: true };

/** `classId`: the acting team's class, so the weapons and spells in the line fit it. Left out for a team with no class. */
type ByClass<T> = T & { classId?: ClassId };

/** `roll`: the die behind this hit landed on a natural 20 (a critical hit) or a 1 (a fumble that still hit). */
type WithRoll<T> = T & { roll?: RollMark };

export type NarrationEvent =
  /** `initiative`: `teams` is the turn order the teams just rolled (lib/initiative.ts). */
  | WithNext<{ type: "start"; teams: string[]; initiative?: true }>
  /** `entersBoss`: this answer moved the team into the boss room (it reached the boss
   * threshold, or another team was already inside: Team.inBoss).
   * `phase`: the boss phase already under way when a late team walks in, from phase 2 on (boss-phases.md D13).
   * `order`: this team is the Nth in (2 and up), so the door is already open; left out for the first team. */
  /** `cooked` (correct and boss-kill): the monster will be cooked; the line counts 飽足感 but keeps the dish for the
   * big screen's 上菜 (docs/designs/monster-cuisine.md, cooking I1). */
  | WithNext<WithRoll<ByClass<{ type: "correct"; team: string; monster: string; points: number; cooked?: true; entersBoss?: { phase?: string; order?: number } }>>>
  /** `boss`: a wrong boss answer, which always brings a new question (boss redesign D2=B).
   * `exhausted`: it used up the boss phase's questions, and the phase card comes next (boss-phases.md).
   * `buzzOut`: a wrong buzz in a buzzer phase (boss-buzzer.md): this team is out of the question, the others may still buzz. */
  | WithNext<ByClass<{ type: "retry"; team: string; monster: string; boss?: true; exhausted?: true; buzzOut?: true }>>
  | WithNext<{ type: "flee"; team: string; monster: string }>
  /** `bossHp` 0 without a kill: an earlier phase's bar emptied, and the next phase is still a secret.
   * `exhausted`: the hit used up the phase's questions with HP left, and the phase card comes next. */
  | WithNext<WithRoll<ByClass<{ type: "boss-hit"; team: string; bossHp: number; bossMaxHp: number; exhausted?: true }>>>
  /** The phase card opened: the boss is back with a new bar. `phase` counts from 1; nothing about later phases. */
  | WithNext<{ type: "boss-phase"; monster: string; phase: number; name: string; rule: string }>
  /** A team opened its event room (event-rooms.md D11): `satiety` is the change made, `dish` the feast's catalog dish. */
  | WithNext<ByClass<{ type: "event-room"; team: string; scene: EventScene; outcome: EventOutcome; satiety: number; abilityUse?: true; dish?: string }>>
  | WithNext<WithRoll<ByClass<{ type: "boss-kill"; team: string; monster: string; bonus: number; cooked?: true }>>>
  /** Game over: ranking is sorted high to low. Longer line, longer timeout. */
  // ranking[].score carries reward points (Team.reward), not progress points (Team.score).
  // ranking[].dishes: what the team ate, without any dish holding a bank answer.
  // bossStanding: the host ended the game early (結束冒險), so nobody slew the boss.
  // calls: the places read before the story, lowest first; critKing: the most natural 20s (podium-reveal.md D3, D5).
  | {
      type: "epilogue";
      ranking: { name: string; score: number; dishes?: string[] }[];
      winners: string[];
      bossStanding?: true;
      calls?: { place: number; team: string }[];
      critKing?: { names: string[]; count: number };
    };

/** One segment of the epilogue, in order: the crit king, each place lowest first, then the story (eng D21). */
export type EpiloguePart = { kind: "crit"; names: string[]; count: number } | { kind: "place"; place: number; team: string } | { kind: "story" };

export function epilogueParts(e: Extract<NarrationEvent, { type: "epilogue" }>): EpiloguePart[] {
  return [
    ...(e.critKing ? [{ kind: "crit" as const, ...e.critKing }] : []),
    ...(e.calls ?? []).map((c) => ({ kind: "place" as const, ...c })),
    { kind: "story" },
  ];
}

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

/** `bossPhase`: the current boss phase's name, given only from phase 2 on. */
function baseEvent(prev: GameState, outcome: AnswerOutcome, monster: string, bossPhase?: string): Exclude<NarrationEvent, { type: "epilogue" }> {
  const t = prev.teams.find((x) => x.id === outcome.teamId);
  const team = t?.name ?? "冒險者";
  const cls = t?.classId ? { classId: t.classId } : {};
  const roll = "roll" in outcome && outcome.roll ? { roll: outcome.roll } : {};
  switch (outcome.type) {
    case "correct-room-advance": {
      // A team already in the boss room answers correct-boss-hit, never this, so entersBoss fires once per team.
      const entersBoss = !!t && outcome.entersBoss;
      // Teams already inside, host-sent (sendToBoss) ones included: they opened the door before this one.
      const order = prev.teams.filter((x) => x.inBoss).length + 1;
      return {
        type: "correct",
        team,
        ...cls,
        ...roll,
        monster,
        points: outcome.reward,
        ...(entersBoss ? { entersBoss: { ...(bossPhase ? { phase: bossPhase } : {}), ...(order > 1 ? { order } : {}) } } : {}),
      };
    }
    case "incorrect-retry":
      return { type: "retry", team, monster, ...cls, ...(outcome.newBossQuestion ? { boss: true as const } : {}) };
    case "incorrect-flee":
      return { type: "flee", team, monster };
    case "correct-boss-hit":
      return outcome.bossKilled
        ? { type: "boss-kill", team, ...cls, ...roll, monster, bonus: outcome.killBonus ?? 0 }
        : { type: "boss-hit", team, ...cls, ...roll, bossHp: outcome.bossHpRemaining, bossMaxHp: prev.boss.maxHp };
  }
}
