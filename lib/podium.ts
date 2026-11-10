// The podium reveal at the game's end (docs/designs/podium-reveal.md): the d20 tie-break, the titles (podium-titles.md), and the
// beats the narrator calls before the scores come up. Shared by the room, /screen and /play, so it is pure and
// imports nothing that holds the bank.

import { ordinal } from "./ordinal";
import type { EventOutcome } from "./game-state";

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

/** What awardTitles reads from a team: missing counts (a save from before them) are 0. */
export interface TitleTeam {
  id: string;
  name: string;
  events?: EventOutcome[];
  dishes?: string[];
  flees?: number;
  potionsDrunk?: number;
  natural20s?: number;
  turns?: number;
  bossAt?: { turns: number; earned?: true };
}

/** A data title (docs/designs/podium-titles.md): every team tied on the best value gets it, in team order (eng 10). */
export interface Award {
  id: string;
  icon: string;
  title: string;
  teamIds: string[];
  reason: string;
}

const outcomes = (t: TitleTeam, ...kinds: EventOutcome[]) => (t.events ?? []).filter((e) => kinds.includes(e)).length;

/** In award order, 🎲 last. `value` null: the team is not in the running (a count of 0). `fewest`: least wins. */
const TITLES: { id: string; icon: string; title: string; value: (t: TitleTeam) => number | null; reason: (n: number) => string; fewest?: true }[] = [
  { id: "explorer", icon: "🗺️", title: "探險家", value: (t) => t.events?.length || null, reason: (n) => `開了 ${n} 間神秘房` },
  // Only an event room's blessing: 大吉 (great) gives satiety, not a blessing, and the last sprint's is no event room.
  { id: "blessing", icon: "✨", title: "女神的寵兒", value: (t) => outcomes(t, "blessing") || null, reason: (n) => `被祝福 ${n} 次` },
  // The fortune teller's 凶 (bad) curses too (openEvent).
  { id: "curse", icon: "💀", title: "詛咒磁鐵", value: (t) => outcomes(t, "curse", "bad") || null, reason: (n) => `被詛咒 ${n} 次` },
  { id: "rotten", icon: "🤢", title: "腐肉品嚐家", value: (t) => outcomes(t, "rotten") || null, reason: (n) => `吃到 ${n} 次腐肉` },
  { id: "flees", icon: "🏃", title: "逃跑大師", value: (t) => t.flees || null, reason: (n) => `逃跑 ${n} 次` },
  // 🧪 lucky potions drunk (docs/designs/lucky-potion.md E8).
  { id: "potions", icon: "🧪", title: "藥水成癮", value: (t) => t.potionsDrunk || null, reason: (n) => `喝了 ${n} 瓶幸運藥水` },
  { id: "dishes", icon: "🍲", title: "大胃王", value: (t) => t.dishes?.length || null, reason: (n) => `吃了 ${n} 道料理` },
  // Only a team that answered its way in (earned): one sent by the host or let through an open door is not quick.
  { id: "rush", icon: "⚡", title: "閃電突擊", value: (t) => (t.bossAt?.earned ? t.bossAt.turns : null), reason: (n) => `${n} 回合就進魔王房`, fewest: true },
  { id: "crit", icon: "🎲", title: "大成功王", value: (t) => t.natural20s || null, reason: (n) => `擲出 ${n} 次 20` },
];

/** The data titles this game earned, in award order: each to the teams with the best value, none for a value of 0. */
export function awardTitles(teams: TitleTeam[]): Award[] {
  return TITLES.flatMap(({ id, icon, title, value, reason, fewest }) => {
    const held = teams.flatMap((t) => {
      const v = value(t);
      return v === null ? [] : [{ id: t.id, v }];
    });
    if (!held.length) return [];
    const best = (fewest ? Math.min : Math.max)(...held.map((h) => h.v));
    return [{ id, icon, title, teamIds: held.filter((h) => h.v === best).map((h) => h.id), reason: reason(best) }];
  });
}

/** A beat's spoken line holds one row of the podium's narrator box: 27px text, 786px wide, so 29 a row, one spare
 * for punctuation (UTF-16 units, so an emoji counts as two). */
export const MAX_AWARD_LINE = 28;

/** 「{icon}{title}……{names}！」 in one row: a tie too long becomes 「{first}等 N 隊」, and a name still too long is cut. */
export function awardLine(icon: string, title: string, names: string[]): string {
  const say = (who: string) => `${icon}${title}……${who}！`;
  if (say(names.join("、")).length <= MAX_AWARD_LINE) return say(names.join("、"));
  const tail = names.length > 1 ? `等 ${names.length} 隊` : "";
  const head = [...(names[0] ?? "")];
  while (head.length && say(head.join("") + tail).length > MAX_AWARD_LINE) head.pop();
  return say(head.join("") + tail);
}

/** Emoji read aloud come out as words (🎲 「骰子」): the voice skips them (podium-titles.md eng 7). */
export const unemoji = (line: string) => line.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "");

/** An AI title's halves, at most this long (UTF-16 units). */
export const MAX_TITLE = 10;
export const MAX_TITLE_REASON = 16;

/** The AI's title for a team with none (「稱號｜理由」, a half-width | too): null when it does not split into two
 * non-empty halves within their limits. The one parser, for the runner's check and the beats. */
export function parseTitle(line: string | undefined): { title: string; reason: string } | null {
  const at = line?.search(/[｜|]/) ?? -1;
  if (!line || at < 0) return null;
  const title = line.slice(0, at).trim();
  const reason = line.slice(at + 1).trim();
  return title && reason && title.length <= MAX_TITLE && reason.length <= MAX_TITLE_REASON ? { title, reason } : null;
}

/** The fallback for a team the AI did not title (D4): its own turns. */
const fallbackTitle = (t: TitleTeam) => ({ title: "堅持到最後的冒險者", reason: `撐了 ${t.turns ?? 0} 回合` });

/** The teams no data title went to, in team order: each gets a consolation title (AI 🌟, else 🛡️). */
export function untitledTeams<T extends TitleTeam>(teams: T[], awards = awardTitles(teams)): T[] {
  const held = new Set(awards.flatMap((a) => a.teamIds));
  return teams.filter((t) => !held.has(t.id));
}

export const placeLine = (place: number, name: string) => `第${ordinal(place)}名是……${name}！`;

/** One beat of the reveal. Each `line` is read on the big screen; a roll's line is its chip. */
export type Beat =
  /** A title: a data title, or a team's consolation (🌟 the AI's, 🛡️ the fallback). `reason` is on the card only (D2). */
  | { kind: "award"; line: string; icon: string; title: string; names: string[]; teamIds: string[]; reason: string }
  | { kind: "roll"; line: string; names: string[]; values: number[]; result: string }
  | { kind: "place"; line: string; place: number; teamId: string };

/** How long each beat holds (D9). First place is the last beat; the story is read after it. */
export function beatMs(beat: Beat): number {
  if (beat.kind === "award" || beat.kind === "roll") return 2500;
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

/** What the narration is asked to write: a title for each team with none (`titles`, in team order), then each place
 * lowest first (the story comes after). */
export function revealCalls<T extends TitleTeam>(teams: T[], ranking: string[]) {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const calls = ranking.slice(0, PODIUM_PLACES).map((id, i) => ({ place: i + 1, team: name(id) })).reverse();
  return { titles: untitledTeams(teams), calls };
}

/**
 * The beats, in order: every data title, each untitled team's consolation, then each place lowest first, each tie
 * roll just before the first place it decides (D10). `lines` are the narration's place calls in revealCalls' order and
 * `titles` its 「稱號｜理由」 lines in `titles` order; a missing call is scripted, a missing or bad title is 🛡️.
 */
export function revealBeats(teams: TitleTeam[], ranking: string[], tieRolls: TieRoll[], lines: string[] = [], titles: string[] = []): Beat[] {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const awards = awardTitles(teams);
  const { calls } = revealCalls(teams, ranking);
  // A save from before titles holds [crit, p3, p2, p1]: the calls are always the last lines.
  const said = lines.slice(Math.max(0, lines.length - calls.length));
  const beats: Beat[] = awards.map((a) => {
    const names = a.teamIds.map(name);
    return { kind: "award", line: awardLine(a.icon, a.title, names), icon: a.icon, title: a.title, names, teamIds: a.teamIds, reason: a.reason };
  });
  untitledTeams(teams, awards).forEach((t, i) => {
    const ai = parseTitle(titles[i]);
    const icon = ai ? "🌟" : "🛡️";
    const { title, reason } = ai ?? fallbackTitle(t);
    beats.push({ kind: "award", line: awardLine(icon, title, [t.name]), icon, title, names: [t.name], teamIds: [t.id], reason });
  });
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
  // Lines still coming, or held by manual pacing: reduced motion waits too, or it would show the end early.
  if (podium && !podium.beats) return { beat: -1, result: false, done: false };
  if (!podium || t === null) return { beat: -1, result: true, done: true };
  return revealAt(podium.beats!, t);
}

/** An epilogue page on the big screen holds at most this many characters: three rows of the narrator box at the
 * podium's 22px (786px of text per row, a CJK character 22px wide), so the box stays under the steps (bottom 130).
 * One character a row is spare, for punctuation the browser will not start a row with. */
export const EPILOGUE_PAGE_CHARS = 3 * (Math.floor(786 / 22) - 1);

/** The epilogue as the big screen's pages, turned by the host (owner, 2026-11-08): whole sentences per page where they
 * fit, a sentence longer than a page cut at the page's length. An epilogue that fits is one page. */
export function epiloguePages(text: string): string[] {
  const pages: string[] = [];
  let page = "";
  for (const sentence of text.match(/[^。！？!?]+[。！？!?」』）)]*|[。！？!?]+/g) ?? []) {
    // Counted by code point, like the cut below, so an emoji counts once.
    if ([...page + sentence].length <= EPILOGUE_PAGE_CHARS) {
      page += sentence;
      continue;
    }
    if (page) pages.push(page);
    // By code point, so an emoji is never cut in half.
    const chars = [...sentence];
    while (chars.length > EPILOGUE_PAGE_CHARS) pages.push(chars.splice(0, EPILOGUE_PAGE_CHARS).join(""));
    page = chars.join("");
  }
  if (page) pages.push(page);
  // A page of only spaces or line breaks (trailing whitespace after the last sentence) is not a page.
  const shown = pages.map((p) => p.trim()).filter(Boolean);
  return shown.length ? shown : [text];
}
