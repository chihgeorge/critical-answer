// The podium reveal at the game's end (docs/designs/podium-reveal.md): the d20 tie-break, the crit king, and the
// beats the narrator calls before the scores come up. Shared by the room, /screen and /play, so it is pure and
// imports nothing that holds the bank.

import { ordinal } from "./ordinal";

/** The podium has three steps: only ties that reach them are rolled, and only these places are called (D3, D4). */
export const PODIUM_PLACES = 3;
/** A phone shows the result this long after the big screen does, so a phone whose STATE came in first never spoils
 * first place (eng D23). */
export const PHONE_LAG_MS = 1000;

/** One round of tie-break dice: `teams` (ids) were tied for the places `from` .. `from + teams.length - 1`. */
export interface TieRoll {
  from: number;
  teams: string[];
  values: number[];
}

/** Above this many teams in one tie roll the dice shrink and the result row drops the names (TieRollOverlay). */
export const ROW_NAMES = 4;

// shortcut: a tie still unbroken after this many rounds keeps the team order; only a fixed die (tests) gets there.
const MAX_ROUNDS = 5;

/**
 * Teams best first by reward. Teams tied where the order changes the podium each roll a d20 (`roll`), highest
 * first; teams still tied roll again among themselves (D4). Ties wholly below the podium (`places`) keep the team order.
 */
export function rankTeams(teams: { id: string; reward: number }[], roll: () => number, places = PODIUM_PLACES): { ranking: string[]; tieRolls: TieRoll[] } {
  const sorted = [...teams].sort((a, b) => b.reward - a.reward);
  const ranking: string[] = [];
  const tieRolls: TieRoll[] = [];
  const resolve = (ids: string[], from: number, round: number) => {
    if (ids.length === 1 || from > places || round >= MAX_ROUNDS) return void ranking.push(...ids);
    const values = ids.map(() => roll());
    tieRolls.push({ from, teams: ids, values });
    let at = from;
    for (const v of [...new Set(values)].sort((a, b) => b - a)) {
      const group = ids.filter((_, i) => values[i] === v);
      resolve(group, at, round + 1);
      at += group.length;
    }
  };
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].reward === sorted[i].reward) j++;
    resolve(sorted.slice(i, j).map((t) => t.id), i + 1, 0);
    i = j;
  }
  return { ranking, tieRolls };
}

/** The teams with the most natural 20s, or null when nobody rolled one (D5). */
export function critKing(teams: { name: string; natural20s?: number }[]): { names: string[]; count: number } | null {
  const count = Math.max(0, ...teams.map((t) => t.natural20s ?? 0));
  return count > 0 ? { names: teams.filter((t) => (t.natural20s ?? 0) === count).map((t) => t.name), count } : null;
}

export const critLine = (names: string[], count: number) => `本場大成功王是……${names.join("、")}，擲出 ${count} 次 20！`;
export const placeLine = (place: number, name: string) => `第${ordinal(place)}名是……${name}！`;

/** One beat of the reveal. Each `line` is read on the big screen; a roll's line is its chip. */
export type Beat =
  | { kind: "crit"; line: string; names: string[]; count: number }
  | { kind: "roll"; line: string; names: string[]; values: number[]; result: string }
  | { kind: "place"; line: string; place: number; teamId: string };

/** How long each beat holds (D9). First place is the last beat; the story is read after it. */
export function beatMs(beat: Beat): number {
  if (beat.kind === "crit") return 3000;
  if (beat.kind === "roll") return 2500;
  return beat.place === 1 ? 4000 : 3500;
}

function rollTexts(roll: TieRoll, name: (id: string) => string): { line: string; result: string } {
  const to = roll.from + roll.teams.length - 1;
  const places = Array.from({ length: Math.min(to, PODIUM_PLACES) - roll.from + 1 }, (_, i) => roll.from + i);
  const line = `第 ${places.join("、")} 名同分！擲 d20 ${to > PODIUM_PLACES ? "搶上台" : "比大小"}`;
  if (new Set(roll.values).size === 1) return { line, result: "又同點！重擲" };
  const order = roll.teams.map((id, i) => ({ id, v: roll.values[i] })).sort((a, b) => b.v - a.v);
  if (order.length === 2) return { line, result: `${order[0].v} 比 ${order[1].v}，${name(order[0].id)}勝！` };
  // A reroll follows only for a tie still on the podium, the way rankTeams resolves it.
  let at = roll.from;
  let rerolls = false;
  for (const v of [...new Set(roll.values)].sort((a, b) => b - a)) {
    const n = roll.values.filter((x) => x === v).length;
    if (n > 1 && at <= PODIUM_PLACES) rerolls = true;
    at += n;
  }
  const again = rerolls ? "，同點的重擲" : "";
  // Over ROW_NAMES teams the names under the dice say who rolled what; listing them again wraps the result row.
  if (order.length > ROW_NAMES) return { line, result: rerolls ? "同點的重擲！" : `點數最高的${places.length > 1 ? ` ${places.length} 隊` : ""}上台` };
  return { line, result: order.map((o) => `${name(o.id)} ${o.v}`).join("、") + again };
}

/** What the narration is asked to write: the crit king, then each place lowest first (the story comes after). */
export function revealCalls(teams: { id: string; name: string; natural20s?: number }[], ranking: string[]) {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const calls = ranking.slice(0, PODIUM_PLACES).map((id, i) => ({ place: i + 1, team: name(id) })).reverse();
  return { critKing: critKing(teams), calls };
}

/**
 * The beats, in order: the crit king (if any), then each place lowest first, each tie roll just before the first
 * place it decides (D10). `lines` are the narration's segments, in revealCalls' order; a missing one is scripted.
 */
export function revealBeats(
  teams: { id: string; name: string; natural20s?: number }[],
  ranking: string[],
  tieRolls: TieRoll[],
  lines: string[] = [],
): Beat[] {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const { critKing: king, calls } = revealCalls(teams, ranking);
  const said = [...lines];
  const beats: Beat[] = [];
  if (king) beats.push({ kind: "crit", line: said.shift() ?? critLine(king.names, king.count), ...king });
  const shown = new Set<TieRoll>();
  for (const call of calls) {
    for (const roll of tieRolls) {
      if (shown.has(roll) || call.place < roll.from || call.place >= roll.from + roll.teams.length) continue;
      shown.add(roll);
      beats.push({ kind: "roll", names: roll.teams.map(name), values: roll.values, ...rollTexts(roll, name) });
    }
    beats.push({ kind: "place", line: said.shift() ?? placeLine(call.place, call.team), place: call.place, teamId: ranking[call.place - 1] });
  }
  return beats;
}

/**
 * Where the reveal is `t` ms after its first beat: `beat` the index on show (-1 before the first), `result` first
 * place is up (the winner, crown and scores), `done` its beat is over and the story is read.
 */
export function revealAt(beats: Beat[], t: number): { beat: number; result: boolean; done: boolean } {
  let at = 0;
  let beat = -1;
  for (let i = 0; i < beats.length; i++) {
    if (t >= at) beat = i;
    at += beatMs(beats[i]);
  }
  const last = beats.length ? at - beatMs(beats[beats.length - 1]) : 0;
  return { beat: t < 0 ? -1 : beat, result: t >= last, done: t >= at };
}

/** Every time revealAt can change, so a page re-renders only then. */
export function revealMarks(beats: Beat[]): number[] {
  const marks = [0];
  for (const b of beats) marks.push(marks[marks.length - 1] + beatMs(b));
  return marks;
}

/** revealAt for a page: with no reveal to play (`podium` absent: an older server or game; `t` null: reduced motion) it
 * is the end; while the lines are still coming (`beats` null) it waits. */
export function revealNow(podium: { beats: Beat[] | null } | undefined, t: number | null): { beat: number; result: boolean; done: boolean } {
  if (!podium || t === null) return { beat: -1, result: true, done: true };
  return podium.beats ? revealAt(podium.beats, t) : { beat: -1, result: false, done: false };
}
