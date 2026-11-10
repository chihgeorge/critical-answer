// The waiting teams' reactions during one team's turn (docs/designs/audience-reactions.md, 旁白提到反應), counted
// in room memory so the narrator can mention the loudest one. Never saved, never scored.

import type { Reaction } from "../protocol";
import type { Crowd } from "./events";

/** A turn needs this many taps before the narrator says anything about the crowd. */
export const CROWD_MIN_TAPS = 3;
/** And its loudest reaction needs this many, so 「噓聲四起」 is never one lone 👎. */
export const CROWD_MIN_MOOD = 2;
/** And this many different waiting teams must have tapped, so one eager team is not 「台下」 on its own. */
export const CROWD_MIN_TEAMS = 2;

type Tap = { team: string; reaction: Reaction };

/** The most common key, the first to reach that count on a tie. */
function top<K>(keys: K[]): [K, number] | undefined {
  const m = new Map<K, number>();
  let best: K | undefined;
  for (const k of keys) {
    m.set(k, (m.get(k) ?? 0) + 1);
    if (best === undefined || m.get(k)! > m.get(best)!) best = k;
  }
  return best === undefined ? undefined : [best, m.get(best)!];
}

/** The loudest reaction of a turn, and the waiting team that tapped it most. `avoid` (the team up next) is never named:
 * the handoff right after names it, and an AI middle line naming it would be taken for the handoff (alignToSlots). When
 * only that team tapped the loudest reaction, nothing is said. */
export function crowdOf(taps: Tap[], avoid?: string): Crowd | undefined {
  if (taps.length < CROWD_MIN_TAPS || new Set(taps.map((t) => t.team)).size < CROWD_MIN_TEAMS) return undefined;
  const [mood, n] = top(taps.map((t) => t.reaction))!;
  if (n < CROWD_MIN_MOOD) return undefined;
  const by = taps.filter((t) => t.reaction === mood).map((t) => t.team);
  const named = top(by.filter((t) => t !== avoid));
  return named && { mood, team: named[0] };
}

/** One room's tally. `take` is called once per judged answer: it hands back the turn's crowd (or nothing) and starts
 * over, and it never hands one back twice in a row, so the crowd is never mentioned on every turn. `skip`: this line
 * has no slot for it (no next team, or the host's line takes the middle), so the count is dropped and nothing is said. */
export function createCrowdTally() {
  let turn: string | undefined;
  let taps: Tap[] = [];
  let saidLast = false;
  return {
    /** `turnKey`: the turn the taps belong to; a different key starts over. */
    tap(turnKey: string, team: string, reaction: Reaction) {
      if (turn !== turnKey) [turn, taps] = [turnKey, []];
      taps.push({ team, reaction });
    },
    take(turnKey: string, avoid?: string, skip = false): Crowd | undefined {
      const crowd = turn === turnKey && !saidLast && !skip ? crowdOf(taps, avoid) : undefined;
      [turn, taps, saidLast] = [undefined, [], !!crowd];
      return crowd;
    },
  };
}
