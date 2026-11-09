// Global turn-based dungeon game state (see docs/designs/critical-answer-party-game.md).
//
//                    ┌─────────────────────────┐
//                    │  隊伍固定順序佇列          │
//                    │  A → B → C → ... → 循環   │
//                    └───────────┬──────────────┘
//                                │ advanceTurn()
//                                ▼
//                    ┌─────────────────────────┐
//                    │ 輪到隊伍 T，查詢 T 目前狀態 │
//                    └───────────┬──────────────┘
//                                │
//                 ┌──────────────┴───────────────┐
//                 ▼                               ▼
//        T 分數 < 門檻 X                     T 分數 ≥ 門檻 X
//        （一般怪物房）                        （首領房）
//
// Class abilities (docs/designs/class-abilities.md): a team picked a class in the lobby
// spends one of its ABILITY_USES on its turn. The warrior rolls instead of answering:
// spendAbility() takes the use when the room rolls, then warriorRoll() judges the d20 as the
// answer (WARRIOR_TARGET or more is correct) through answerQuestion, so the turn still advances
// exactly once. The mage removes wrong options (mageEliminate), the thief arms a Sneak Attack
// that raises this answer's reward ×1.5 and doubles its boss damage (armSneak), and the cleric prays on a wrong
// lock (pray) so that its 重答 / 逃跑 keeps the turn instead of advancing it (prayerTurn).
//
// Turn order never changes with room progress — this avoids the "arrival
// order" snowball fairness risk flagged in /plan-eng-review's Outside Voice.
import { rankTeams, type TieRoll } from "./podium";

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const MIN_DIFFICULTY: Difficulty = 1;

/** What one boss hit pays when the bank does not say (docs/designs/scoring-and-score-pools.md S8). */
export const DEFAULT_BOSS_HIT_REWARD = 10;

/** Fixed class ids (docs/designs/class-abilities.md). Display text is looked up by id. */
export const CLASS_IDS = ["mage", "cleric", "warrior", "thief", "chef"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export function isClassId(v: unknown): v is ClassId {
  return typeof v === "string" && (CLASS_IDS as readonly string[]).includes(v);
}

export const CLASS_LABELS: Record<ClassId, string> = {
  mage: "法師",
  cleric: "牧師",
  warrior: "戰士",
  thief: "盜賊",
  chef: "廚師",
};

export const CLASS_ICONS: Record<ClassId, string> = {
  mage: "🔮",
  cleric: "✝️",
  warrior: "⚔️",
  thief: "🗝️",
  chef: "🍳",
};

/** Ability uses per team per game for the thief and the cleric (the chef's is passive, CHEF_BONUS_PERCENT). */
export const ABILITY_USES = 2;
/** The warrior and the mage get more: their abilities only raise the odds on one question (owner, 2026-11-08 balance). */
export const MORE_ABILITY_USES = 4;

/** A team's ability uses at the start of a game. */
export function abilityUsesFor(classId: ClassId | undefined): number {
  return classId === "warrior" || classId === "mage" ? MORE_ABILITY_USES : ABILITY_USES;
}

/** A correct answer after Sneak Attack gives this times the reward (rounded half up); the boss still loses 2 hearts. */
export const SNEAK_REWARD_MULTIPLIER = 1.5;
/** The chef's passive: every reward gain of the team is this much bigger, after the sneak, a crit and the kill's 4d20. */
export const CHEF_BONUS_PERCENT = 15;

/** The chef's share of one reward gain: rounded half up, at least 1 on any gain (eng review D1–D3). */
export function chefShare(gain: number): number {
  return gain > 0 ? Math.max(1, Math.round((gain * CHEF_BONUS_PERCENT) / 100)) : 0;
}
/** The warrior's d20 counts as a correct answer at this value or more (60%; owner, 2026-11-08 two-phase boss balance). */
export const WARRIOR_TARGET = 9;

/** A fill-in question is a persuasion check (dnd design Premise 3): d20 + the team's class bonus against the
 * monster's DC. A team with no class adds 1. */
export const CHECK_BONUS: Record<ClassId | "none", number> = { mage: 4, thief: 3, cleric: 2, chef: 1, none: 1, warrior: 0 };
/** The DC per difficulty 1–5 (dnd design Decision 11); the boss uses difficulty 5's. */
export const CHECK_DC = [8, 10, 12, 14, 16] as const;
export const BOSS_CHECK_DC = 16;

/** One team's persuasion check on one question (dnd design R6): `hint` is the answer's first letter or number,
 * given on a pass that is not a natural 20 (that one wins outright) and only when the answer is long enough (R8). */
export interface CheckRecord {
  value: number;
  bonus: number;
  dc: number;
  passed: boolean;
  hint?: string;
}

/** Checks are kept per question and team: two teams facing one question (the boss's, or a short pool) each roll. */
/** One key per (question, team). A team id never holds a colon (JOIN refuses one), so the key stays unique even when a
 * question id does. */
export const checkKey = (questionId: string, teamId: string) => `${questionId}:${teamId}`;
/** Whether a checks key is some team's check on `questionId`: compared whole, as both ids may hold a colon. */
const isCheckOn = (game: GameState, key: string, questionId: string) => game.teams.some((t) => key === checkKey(questionId, t.id));

export interface Team {
  id: string;
  name: string;
  online: boolean;
  /** Progress points: the difficulty of every question answered right. Decides boss-room entry only,
   * and only the host page shows it (docs/designs/scoring-and-score-pools.md S3). It is still in the
   * broadcast SpectatorView, so this is a UI rule, not a secret. */
  score: number;
  /** Reward points: what this team's defeated monsters and boss hits paid. Decides the winner (S7). */
  reward: number;
  /** Index into the shared room template this team is currently facing. */
  roomIndex: number;
  /** How many times this room's monster had been defeated when the team walked in: its look stays put
   * until the team leaves the room, whatever other teams defeat meanwhile (docs/designs/monster-catalog.md §3).
   * Absent in saves from before it (the game-wide count is used). */
  metDefeats?: number;
  /**
   * The difficulty of the monster this team is currently facing at
   * `roomIndex`. Starts at the room template's base difficulty; downgraded
   * after a flee (see `answerQuestion`).
   */
  currentDifficulty: Difficulty;
  /** Question id the team must answer next — used to reject stale submissions (T6). */
  currentQuestionId: string;
  /**
   * The team's current pick for a multipleChoice question, or null if none yet.
   * Re-selectable until the team locks it (docs/designs/phone-answering.md) — set by
   * recordOptionSelection, reset to null everywhere a new question is dealt (createGame,
   * correct-room-advance, incorrect-flee, and boss question rotation) and by a wrong lock
   * (recordWrongLock), so a retry turn starts with no pick.
   */
  currentSelection: number | null;
  /**
   * In the boss room. The first team gets in at `bossThreshold` points; once any team is in, every
   * other team gets in on its next correct answer (docs/designs/live-map.md D9). Stored, not derived
   * from score, because the second rule depends on when the answer came.
   */
  inBoss: boolean;
  /** The host's pick for this team's next room question (queueQuestion): the next deal of its difficulty
   * hands it out instead of drawing. Dropped when the team walks into the boss room. */
  queuedQuestionId?: string;
  /** Picked in the lobby, fixed once the game starts; none is a plain adventurer. */
  classId?: ClassId;
  /** Class ability uses left (ABILITY_USES at the start). */
  abilityUses: number;
  /** Natural 20s this team rolled: crit dice, warrior rolls, persuasion checks and the kill's 4d20 (podium-reveal.md D5).
   * Absent until the first one, and in a game saved before them. */
  natural20s?: number;
  /** The thief's Sneak Attack waits for this team's next judgment: a correct one gives ×1.5 its reward
   * and ×2 its boss damage; any judgment uses it up (class-abilities.md D16). */
  sneakArmed?: true;
  /** The team's typed answer to its text question (submitText), waiting for the host. Only the turn's
   * team can hold one, and it keeps the turn until judged; answerQuestion and sendToBoss clear it. */
  typedAnswer?: string;
  /** Dish names this team ate, in order: one per defeated room monster or boss that has a dish
   * (docs/designs/monster-cuisine.md). Absent until the first, and in saves from before dishes. */
  dishes?: string[];
  /** Turns this team has played: one per answer that passed the turn on (lib/game-log.ts). Absent until the first. */
  turns?: number;
  /** The game round and this team's turn count when it walked into the boss room (lib/game-log.ts). `earned`: its own
   * correct answer reached bossThreshold (answerQuestion), not the host, an open door or an event room (⚡ 閃電突擊). */
  bossAt?: { round: number; turns: number; earned?: true };
  /** Wrong answers this team fled from, boss room too (🏃 逃跑大師, podium-titles.md). Absent until the first. */
  flees?: number;
  /** The event room this team stands in (docs/designs/event-rooms.md), drawn as it walked in: its next turn opens it. */
  event?: RoomEvent;
  /** A curse or blessing waiting for this team's next correct answer (event-rooms.md D12). */
  boon?: Boon;
  /** Every event outcome this team opened, in order, for lib/game-log.ts. Absent until the first. */
  events?: EventOutcome[];
}

export interface RoomTemplate {
  /** Base difficulty for this room, before any per-team flee downgrades. */
  baseDifficulty: Difficulty;
  /** Reward points for defeating this room's monster, whatever difficulty the team faced it at (S5). */
  reward: number;
  /** The name of the dish its monster is cooked into. Absent in saves from before dishes. */
  dish?: string;
  /** Its monster's catalog id (docs/designs/monster-catalog.md). Absent in saves from before the catalog. */
  monsterId?: string;
}

export interface BossState {
  maxHp: number;
  /** Reward points per hit, the final blow included; the final blow also rolls the kill bonus (S6). */
  hitReward: number;
  /** The name of the dish the boss is cooked into, eaten by the team that kills it. */
  dish?: string;
  hp: number;
  killedByTeamId: string | null;
  currentQuestionId: string;
  questionIds: string[];
  /** The host's pick for the boss's next question (queueQuestion): the next rotation takes it. */
  queuedQuestionId?: string;
  /** Every phase's bar and questions (docs/designs/boss-phases.md); `maxHp` and `questionIds` above are
   * a copy of `phases[phaseIndex]`, written only by createGame and enterNextBossPhase. */
  phases: BossPhaseState[];
  phaseIndex: number;
  /** The current phase is over, its bar emptied ("cleared") or its questions all revealed ("exhausted"),
   * and the next has not started: the room starts it with enterNextBossPhase when the phase card opens. */
  phasePending?: "cleared" | "exhausted";
}

export interface BossPhaseState {
  maxHp: number;
  questionIds: string[];
  /** Every team buzzes in on this phase's questions (docs/designs/boss-buzzer.md). Never the first phase. */
  buzzer?: true;
}

/** The buzz on the boss question of a buzzer phase (boss-buzzer.md). Saved with the game. */
export interface BuzzState {
  /** The boss question this buzz is about: a buzz for any other question is stale. */
  questionId: string;
  /** Buzzing is open: the host pressed ▶ on a video question (D5). The room treats any other question as open. */
  open?: true;
  /** The team that buzzed first and answers aloud now. */
  teamId?: string;
  /** Teams judged wrong on this question: they cannot buzz on it again (D4), until every online team is (boss-music-buzzer.md M1). */
  out: string[];
  /** The team judged right on the question before: it may pick this question's category until buzzing opens (M5). */
  picker?: string;
  /** The category `picker` chose; this question was drawn from it. */
  category?: string;
}

export interface GameConfig {
  /** Fixed score threshold to enter the boss room (Open Questions: 已決定固定 15 分). */
  bossThreshold: number;
}

export type GamePhase = "playing" | "finished";

export interface GameState {
  teams: Team[];
  /** Team order: the lobby's, or the one 擲先攻 rolled (lib/initiative.ts). Fixed for the game, whatever the room progress. */
  turnOrder: string[];
  currentTurnIndex: number;
  rooms: RoomTemplate[];
  /** Question ids by difficulty: `pools[d - 1]` holds difficulty d (S11). A room deals from its own
   * difficulty's pool, and a team that fled from the pool of its lowered difficulty. */
  pools: string[][];
  /**
   * Per pool, the same index as `pools`: the questions dealt from it since it was last
   * reshuffled. Shared by every team, so nobody is dealt a question another team
   * already faced until the pool runs out.
   */
  usedQuestionIds: string[][];
  /** Per multipleChoice and sort question id, the option (item) order this game shows: `optionOrder[id][shown] = bank index`.
   * Every option index the room and clients use (picks, locks, eliminated, reveals) is a shown index. */
  optionOrder: Record<string, number[]>;
  /** Every question id a team has actually gotten right, globally, across the whole game — never
   * reset by a pool's reshuffle. A revealed answer (see AnswerReveal, lib/protocol.ts) must
   * never come back around for someone who hasn't faced it yet; a retried or fled question stays
   * eligible (D5 — its answer was never shown). deal()'s reshuffle and the boss ring both filter
   * against this before falling back to reuse once every remaining question has been revealed. */
  revealedQuestionIds: string[];
  /** Options locked wrong so far, per question id (docs/designs/phone-answering.md E6): one map for rooms
   * and the boss, public like the TV's wrong reveal. A new question id simply has no entry. */
  eliminated: Record<string, number[]>;
  /** The part of `eliminated` a mage removed: grey with no ✕ 答錯 label (class-abilities.md D13=A). */
  mageRemoved?: Record<string, number[]>;
  /** A mage's public hint on a fill-in question, per question id: the answer's first letter or number. */
  mageHints?: Record<string, string>;
  /** Persuasion checks, per checkKey(questionId, teamId) (dnd design R6). Absent from a game saved before them. */
  checks?: Record<string, CheckRecord>;
  /** A wrong answer waiting for that team's choice. The team keeps the turn meanwhile, even offline (E9). */
  pendingWrong: WrongAnswer | null;
  /** The cleric whose prayer kept this turn: it cannot pray again until the turn moves on. */
  prayerTurn?: string;
  boss: BossState;
  /** The buzz on the current boss question while a buzzer phase runs; absent otherwise (boss-buzzer.md). */
  buzz?: BuzzState;
  /** Room monsters defeated so far, per catalog id: each repeat appearance wears the next variant
   * (docs/designs/monster-catalog.md §3). Absent until the first, and in saves from before the catalog. */
  defeats?: Record<string, number>;
  /** Picks each game's first variant (R1). Absent (read as 0) in saves from before the catalog. */
  variantSeed?: number;
  /** This game's boss when the bank draws monsters per game (gameMonsters). Absent: the bank's own boss. */
  bossMonsterId?: string;
  config: GameConfig;
  /** The round of the last turn played, from 1 (lib/game-log.ts): a turn starts a new round when its team does not
   * come after the last team that played in turnOrder, skipped offline teams included. Absent (read as 1) until then. */
  round?: number;
  /** turnOrder index of the last team that played a turn, for `round`. */
  lastTurnIndex?: number;
  /** When the room started this game (ms since epoch), for lib/game-log.ts. Absent in saves from before it. */
  startedAt?: number;
  phase: GamePhase;
  /** The one team in first place once phase === "finished": a tie is broken by d20 (podium-reveal.md D4). Empty before. */
  winners: string[];
  /** Team ids best first once finished, ties on the podium broken by `tieRolls`. Absent from a game finished before them. */
  ranking?: string[];
  /** The tie-break d20s, in the order they were rolled (lib/podium.ts). */
  tieRolls?: TieRoll[];
  /** ⚔️ 最後衝刺 (docs/designs/last-sprint.md): set once, when the first team entered the boss room, naming the trailing
   * teams it blessed. Never empty; its presence is the once-per-game guard. Absent in saves from before it. */
  sprint?: { teamIds: string[] };
}

export interface LockedOption {
  teamId: string;
  questionId: string;
  optionIndex: number;
  /** Set once the host pressed 公布答案 and the beat runs (host-reveal.md). */
  revealing?: true;
}

/** A wrong answer waiting for its 重答 / 逃跑 (or a cleric's 祈禱). `optionIndex` is the wrong lock on a
 * multipleChoice question, or null for a fill-in the host judged wrong while a cleric could still pray (#106). */
export interface WrongAnswer {
  teamId: string;
  questionId: string;
  optionIndex: number | null;
  /** The cleric prayed on this lock: its 重答 / 逃跑 keeps the turn. */
  prayed?: true;
}

/** A natural 20 or 1 behind a correct answer: the crit die (or a warrior's 20 on a multipleChoice question), or the
 * question's persuasion check (a 20 won it outright, a 1 halved it). Narration and the cue use it. */
export type RollMark = { kind: "crit" | "check"; value: 20 | 1 };

export type AnswerOutcome =
  /** `reward` is the whole gain; `chefBonus` the chef's share of it, only for a chef. */
  | { type: "correct-room-advance"; teamId: string; pointsAwarded: number; reward: number; chefBonus?: number; nextRoomIndex: number; entersBoss: boolean; roll?: RollMark }
  | { type: "correct-boss-hit"; teamId: string; bossHpRemaining: number; bossKilled: boolean; reward: number; chefBonus?: number; killBonus?: number; roll?: RollMark }
  | { type: "incorrect-flee"; teamId: string; newDifficulty: Difficulty }
  /** `newBossQuestion`: a wrong boss answer rotated the shared question (boss redesign D2=B). */
  | { type: "incorrect-retry"; teamId: string; newBossQuestion?: true };

export class InvalidActionError extends Error {}

export function rollD20(rng: () => number = Math.random): number {
  return Math.floor(rng() * 20) + 1;
}

/** The four d20 of the kill bonus (docs/designs/scoring-and-score-pools.md S8). The room rolls them before the
 * kill is judged, so the big screen shows them first (docs/designs/kill-roll.md). */
export function rollBossKillDice(rng: () => number = Math.random): number[] {
  return [rollD20(rng), rollD20(rng), rollD20(rng), rollD20(rng)];
}

/** The pool difficulty `d` deals from: its own, else the nearest non-empty one below it, then above
 * (a custom bank may leave a pool empty; parseBank only insists on each room's own pool). */
function poolIndexFor(pools: string[][], d: Difficulty): number {
  for (let i = d - 1; i >= 0; i--) if (pools[i].length > 0) return i;
  const above = pools.findIndex((p) => p.length > 0);
  if (above < 0) throw new InvalidActionError("No questions to deal");
  return above;
}

/**
 * Deal one question of `difficulty`: a question nobody has drawn from its pool since the last
 * reshuffle, avoiding any question a team is holding right now. When every
 * question in the pool has been drawn it reshuffles. Within that, prefer a
 * question whose answer hasn't been revealed; if only revealed ones are left this
 * cycle, an unrevealed one already drawn (fled) wins over re-showing an answer, then an
 * unrevealed free one from the nearest other pool, then `own` if unrevealed and no other team holds it.
 * When every question is held (a small custom bank): an unrevealed free borrow, then `own` (the
 * question the dealt team is leaving: fled, or just answered) if unrevealed and unshared, then any
 * free borrow, then `own` anyway. In a bank with fewer questions than teams, only that last step,
 * or a deal with no `own` (game start), can leave two teams on one question. "Nearest" is by
 * distance, lower first on ties, and a donor pool's undrawn questions come first. Returns the id and the updated used-lists; `rng` keeps tests deterministic.
 */
function deal(
  pools: string[][],
  used: string[][],
  revealed: string[],
  teams: Team[],
  difficulty: Difficulty,
  rng: () => number,
  own?: string,
): { questionId: string; used: string[][] } {
  const p = poolIndexFor(pools, difficulty);
  const all = pools[p];
  let base = used;
  let pool = all.filter((id) => !used[p].includes(id));
  if (pool.length === 0) {
    base = used.map((u, i) => (i === p ? [] : u));
    pool = all;
  }
  // A boss team's room question is stale; a question the host queued for a team is spoken for.
  const held = new Set([...teams.filter((t) => !t.inBoss).map((t) => t.currentQuestionId), ...teams.flatMap((t) => t.queuedQuestionId ?? [])]);
  const order = pools.map((_, i) => i).filter((i) => i !== p).sort((x, y) => Math.abs(x - p) - Math.abs(y - p) || x - y);
  // From each donor pool, a question not drawn since its last reshuffle comes first.
  const borrowFrom = (ok: (id: string) => boolean) =>
    order
      .map((i) => pools[i].filter((id) => !held.has(id) && ok(id)))
      .map((ids, k) => (ids.some((id) => !used[order[k]].includes(id)) ? ids.filter((id) => !used[order[k]].includes(id)) : ids))
      .find((ids) => ids.length > 0);
  // In a bank smaller than the team count `own` may be shared already; keeping it then would undo the flee.
  const mine = own && teams.filter((t) => !t.inBoss && t.currentQuestionId === own).length < 2 ? own : undefined;
  const free = pool.filter((id) => !held.has(id));
  const freeAnywhere = all.filter((id) => !held.has(id));
  if (free.length > 0) pool = free;
  else if (freeAnywhere.length > 0) pool = freeAnywhere;
  else {
    // Every question here is held (a pool smaller than the team count): borrow a free question from the
    // nearest other pool (by distance, lower first on ties) before two teams hold the same one, preferring an unrevealed one.
    // A fleeing team's own question comes back only when no unrevealed one is free anywhere: it would
    // undo the flee, and after a wrong lock its answer is half shown. Only a bank with fewer questions than teams repeats.
    const borrow = borrowFrom((id) => !revealed.includes(id)) ?? (mine && !revealed.includes(mine) ? [mine] : borrowFrom(() => true));
    if (borrow) pool = borrow;
    else if (own) pool = [own];
  }
  // Prefer a question nobody has seen the answer to yet (D4/D5 — AnswerReveal), but never
  // at the cost of handing two teams the identical question — the held-exclusion above is the
  // more important invariant, so this only narrows within whatever it already left.
  // When every question left in this cycle is revealed, an unrevealed one already dealt this
  // cycle (fled, never answered) still beats re-showing an answer everyone has seen.
  const unrevealed = pool.filter((id) => !revealed.includes(id));
  const unrevealedAnywhere = all.filter((id) => !revealed.includes(id) && !held.has(id));
  if (unrevealed.length > 0) pool = unrevealed;
  else if (unrevealedAnywhere.length > 0) pool = unrevealedAnywhere;
  // Every answer left here has been shown: an unseen question from the nearest other pool, then the
  // team's own unseen one, beats a repeat (the same order as the all-held branch above).
  else pool = borrowFrom((id) => !revealed.includes(id)) ?? (mine && !revealed.includes(mine) ? [mine] : pool);
  const questionId = pool[Math.floor(rng() * pool.length)];
  // Recorded in the pool that holds it (a borrowed or own question belongs to another pool), once:
  // the fled-question fallback above picks from questions already in `used`. This pool's reshuffle
  // only counts when the question came from it.
  const from = pools.findIndex((ids) => ids.includes(questionId));
  return { questionId, used: (all.includes(questionId) ? base : used).map((u, i) => (i === from && !u.includes(questionId) ? [...u, questionId] : u)) };
}

/** A question answered again after every question was revealed must not be listed twice. */
function withRevealed(revealed: string[], id: string): string[] {
  return revealed.includes(id) ? revealed : [...revealed, id];
}

/** Same never-redeal-a-revealed-question rule as deal(), for the boss's shared question ring —
 * walk the ring from the current question (ending back on it), skip anything already revealed,
 * and only fall back to the plain next-in-ring slot once every question has been revealed. A
 * flee therefore stays on the current question when it is the last unrevealed one; a correct hit
 * passes `revealed` with the current question already added, so it never comes straight back. */
function nextBossQuestionId(boss: BossState, revealed: string[]): string {
  const { questionIds, currentQuestionId } = boss;
  const startIdx = questionIds.indexOf(currentQuestionId);
  for (let step = 1; step <= questionIds.length; step++) {
    const candidate = questionIds[(startIdx + step) % questionIds.length];
    if (!revealed.includes(candidate)) return candidate;
  }
  return questionIds[(startIdx + 1) % questionIds.length];
}

/** The boss's next question: the host's queued pick if it is still unseen, else the next one in the ring. */
function rotateBoss(boss: BossState, revealed: string[]): Pick<BossState, "currentQuestionId" | "queuedQuestionId"> {
  const q = boss.queuedQuestionId;
  if (q && q !== boss.currentQuestionId && !revealed.includes(q)) return { currentQuestionId: q, queuedQuestionId: undefined };
  return { currentQuestionId: nextBossQuestionId(boss, revealed), queuedQuestionId: q };
}

/** Deal `team` a question of `difficulty`: its queued pick when that is in the pool this difficulty
 * deals from, else deal(). A pick of another difficulty (a flee lowered it) waits for a deal that fits. */
function dealFor(game: GameState, team: Team, difficulty: Difficulty, revealed: string[], rng: () => number, own?: string) {
  const q = team.queuedQuestionId;
  if (q && game.pools[poolIndexFor(game.pools, difficulty)].includes(q) && !revealed.includes(q)) {
    const from = game.pools.findIndex((ids) => ids.includes(q));
    return { questionId: q, used: game.usedQuestionIds.map((u, i) => (i === from && !u.includes(q) ? [...u, q] : u)), queuedQuestionId: undefined };
  }
  return { ...deal(game.pools, game.usedQuestionIds, revealed, game.teams, difficulty, rng, own), queuedQuestionId: q };
}

/** The difficulty a team's next correct answer deals from: its next room's (the last room repeats). */
function nextRoomDifficulty(game: GameState, team: Team): Difficulty {
  return game.rooms[Math.min(team.roomIndex + 1, game.rooms.length - 1)].baseDifficulty;
}

/** Why the host can't queue question `id` for anyone, or null if it is free. */
export type PickBlock = { kind: "revealed" } | { kind: "held" | "queued"; teamId: string | "boss" };

export function pickBlock(game: GameState, id: string): PickBlock | null {
  if (game.revealedQuestionIds.includes(id)) return { kind: "revealed" };
  const holder = game.teams.find((t) => !t.inBoss && t.currentQuestionId === id);
  if (holder) return { kind: "held", teamId: holder.id };
  if (game.boss.currentQuestionId === id) return { kind: "held", teamId: "boss" };
  const queuer = game.teams.find((t) => t.queuedQuestionId === id);
  if (queuer) return { kind: "queued", teamId: queuer.id };
  if (game.boss.queuedQuestionId === id) return { kind: "queued", teamId: "boss" };
  return null;
}

/** The questions the host may pick from for `target` (a team id or "boss"): a room team's next room
 * difficulty, or the boss's questions. Blocked ones are included; pickBlock says which. */
export function pickableQuestionIds(game: GameState, target: string): string[] {
  if (target === "boss") return game.boss.questionIds;
  const team = getTeam(game, target);
  return team.inBoss ? [] : game.pools[poolIndexFor(game.pools, nextRoomDifficulty(game, team))];
}

/**
 * The host picks the next question for a team's room (or, with "boss", the boss's), from the pool its
 * next room deals from (TODOS.md 主持人可以指定每一題要出題庫裡的哪一題). Revealed, held and already
 * queued questions are refused. `questionId` null clears the pick. Not a turn: nothing else changes.
 */
export function queueQuestion(game: GameState, target: string, questionId: string | null): GameState {
  assertPlaying(game);
  const team = target === "boss" ? null : getTeam(game, target);
  if (team?.inBoss) throw new InvalidActionError(`${target} is in the boss room`);
  const current = team ? team.queuedQuestionId : game.boss.queuedQuestionId;
  if (questionId !== null && questionId !== current) {
    if (!pickableQuestionIds(game, target).includes(questionId)) throw new InvalidActionError(`${questionId} can't be ${target}'s next question`);
    const block = pickBlock(game, questionId);
    if (block) throw new InvalidActionError(`${questionId} is ${block.kind}`);
  }
  const queuedQuestionId = questionId ?? undefined;
  return team
    ? { ...game, teams: patchTeam(game.teams, team.id, () => ({ queuedQuestionId })) }
    : { ...game, boss: { ...game.boss, queuedQuestionId } };
}

export const DEFAULT_GAME_CONFIG: GameConfig = { bossThreshold: 15 };

export function createGame(
  teamSeeds: { id: string; name: string; classId?: ClassId }[],
  rooms: RoomTemplate[],
  pools: string[][],
  bossQuestionIds: string[],
  config: GameConfig,
  bossMaxHp: number,
  rng: () => number = Math.random,
  bossHitReward = DEFAULT_BOSS_HIT_REWARD,
  optionOrder: Record<string, number[]> = {},
  /** Phases after the first, which is `bossQuestionIds` and `bossMaxHp`. */
  laterBossPhases: BossPhaseState[] = [],
  bossDish?: string,
  /** Answers an earlier game in this room showed (回到大廳, back-to-lobby): dealt last, once nothing else is left. */
  played: string[] = [],
): GameState {
  if (teamSeeds.length === 0) {
    throw new InvalidActionError("At least one team is required");
  }
  if (rooms.length === 0) {
    throw new InvalidActionError("At least one room is required");
  }

  // Counted as already dealt this cycle, so deal() reaches them only after its reshuffle: never a "revealed"
  // seed, which would make a boss phase whose questions were all played last game count as used up at once.
  let used: string[][] = pools.map((ids) => ids.filter((id) => played.includes(id)));
  const freshFirst = (ids: string[]) => [...ids.filter((id) => !played.includes(id)), ...ids.filter((id) => played.includes(id))];
  bossQuestionIds = freshFirst(bossQuestionIds);
  laterBossPhases = laterBossPhases.map((p) => ({ ...p, questionIds: freshFirst(p.questionIds) }));
  const revealed: string[] = [];
  const teams: Team[] = [];
  for (const seed of teamSeeds) {
    // Teams not dealt yet hold no question; the ones already dealt count as held.
    const dealt = deal(pools, used, revealed, teams, rooms[0].baseDifficulty, rng);
    used = dealt.used;
    teams.push({
      id: seed.id,
      name: seed.name,
      online: true,
      score: 0,
      reward: 0,
      roomIndex: 0,
      metDefeats: 0,
      currentDifficulty: rooms[0].baseDifficulty,
      currentQuestionId: dealt.questionId,
      currentSelection: null,
      inBoss: config.bossThreshold <= 0, // score starts at 0
      ...(config.bossThreshold <= 0 ? { bossAt: { round: 1, turns: 0 } } : {}),
      ...(seed.classId ? { classId: seed.classId } : {}),
      abilityUses: abilityUsesFor(seed.classId),
    });
  }

  return {
    teams,
    turnOrder: teamSeeds.map((t) => t.id),
    currentTurnIndex: 0,
    rooms,
    pools,
    usedQuestionIds: used,
    optionOrder,
    revealedQuestionIds: revealed,
    eliminated: {},
    pendingWrong: null,
    boss: {
      maxHp: bossMaxHp,
      hitReward: bossHitReward,
      ...(bossDish ? { dish: bossDish } : {}),
      hp: bossMaxHp,
      killedByTeamId: null,
      currentQuestionId: bossQuestionIds[0],
      questionIds: bossQuestionIds,
      phases: [{ maxHp: bossMaxHp, questionIds: bossQuestionIds }, ...laterBossPhases],
      phaseIndex: 0,
    },
    // Drawn last, so the deals above see the same rng values as before the catalog.
    variantSeed: Math.floor(rng() * 2 ** 32),
    config,
    phase: "playing",
    winners: [],
  };
}

function getTeam(game: GameState, teamId: string): Team {
  const team = game.teams.find((t) => t.id === teamId);
  if (!team) throw new InvalidActionError(`Unknown team: ${teamId}`);
  return team;
}

/** Whether this team is in the boss room (see Team.inBoss). */
export function isInBossPhase(game: GameState, teamId: string): boolean {
  return getTeam(game, teamId).inBoss;
}

/** Clears every boss-phase team's multipleChoice pick — used wherever the shared boss question
 * rotates (correct-hit-not-killed, flee), since every team still fighting the boss now faces a
 * different question and a leftover pick would be stale. */
function resetBossSelections(teams: Team[]): Team[] {
  return teams.map((t) => (t.inBoss ? { ...t, currentSelection: null } : t));
}

/** Starts the boss's next phase once the room opens its phase card (docs/designs/boss-phases.md, D1):
 * a full new bar, that phase's first unrevealed question, no queued pick and no leftover picks. Not a turn. */
export function enterNextBossPhase(game: GameState): GameState {
  assertPlaying(game);
  const boss = game.boss;
  const phaseIndex = boss.phaseIndex + 1;
  const phase = boss.phases[phaseIndex];
  if (!boss.phasePending || !phase) throw new InvalidActionError("no boss phase is waiting to start");
  // A buzzer phase is everyone's final fight (boss-buzzer.md D2): every team still in a room walks in.
  const pulled = phase.buzzer ? game.teams.reduce<GameState>((g, t) => (t.inBoss ? g : sendToBoss(g, t.id)), { ...game, pendingWrong: null }) : game;
  // The old phase's question leaves play, so its wrong tiles go with it.
  const cleared = dropEliminated(pulled, boss.currentQuestionId);
  return {
    ...pulled,
    ...cleared,
    buzz: undefined,
    // A buzzer phase has no abilities (D6): a sneak armed in the phase before is given back, as sendToBoss does.
    teams: resetBossSelections(phase.buzzer ? pulled.teams.map((t) => (t.sneakArmed ? { ...t, sneakArmed: undefined, abilityUses: t.abilityUses + 1 } : t)) : pulled.teams),
    boss: {
      ...boss,
      phaseIndex,
      maxHp: phase.maxHp,
      hp: phase.maxHp,
      questionIds: phase.questionIds,
      currentQuestionId: phase.questionIds.find((id) => !game.revealedQuestionIds.includes(id)) ?? phase.questionIds[0],
      queuedQuestionId: undefined,
      phasePending: undefined,
    },
  };
}

/** Whether a buzzer phase is being fought now: every team buzzes in, nobody takes turns (boss-buzzer.md). */
export function isBuzzPhase(game: GameState): boolean {
  const boss = game.boss;
  return game.phase === "playing" && !boss.phasePending && boss.phases[boss.phaseIndex]?.buzzer === true;
}

/** The buzz on the current boss question: the saved one, or a fresh one when the question moved on. */
function currentBuzz(game: GameState): BuzzState {
  const id = game.boss.currentQuestionId;
  return game.buzz?.questionId === id ? game.buzz : { questionId: id, out: [] };
}

/** The host pressed ▶ on the boss question's video: buzzing opens (D5). A no-op outside a buzzer phase. */
export function openBuzz(game: GameState, questionId: string): GameState {
  if (!isBuzzPhase(game) || questionId !== game.boss.currentQuestionId) return game;
  const buzz = currentBuzz(game);
  return buzz.open ? game : { ...game, buzz: { ...buzz, open: true } };
}

/** `teamId` buzzes in on `questionId`. The first buzz the room handles wins (D: latency). `open`: buzzing is open
 * for this question (the room's call: a video waits for ▶, D5). The winner takes the turn, so HOST_JUDGE judges it. */
export function buzzIn(game: GameState, teamId: string, questionId: string, open: boolean): GameState {
  if (!isBuzzPhase(game)) throw new InvalidActionError("not_buzzer_phase");
  if (questionId !== game.boss.currentQuestionId) throw new InvalidActionError("stale_question");
  const team = getTeam(game, teamId);
  const buzz = currentBuzz(game);
  if (!open && !buzz.open) throw new InvalidActionError("buzz_closed");
  if (buzz.teamId) throw new InvalidActionError("buzz_taken");
  if (buzz.out.includes(teamId)) throw new InvalidActionError("buzz_out");
  if (!team.online || !team.inBoss) throw new InvalidActionError("cannot_buzz");
  return { ...game, buzz: { ...buzz, teamId }, currentTurnIndex: game.turnOrder.indexOf(teamId) };
}

/** The buzz once the boss question moved on: none for a new question; the same one (the phase's last unrevealed
 * question came round again) starts over, everyone in, still open if its music was (adversarial review). */
function rotatedBuzz(game: GameState, nextQuestionId: string): BuzzState | undefined {
  return nextQuestionId === game.boss.currentQuestionId ? { questionId: nextQuestionId, ...(currentBuzz(game).open ? { open: true as const } : {}), out: [] } : undefined;
}

/** The categories a buzz winner may pick for the next question: those of the phase's unrevealed questions, in bank
 * order. `categoryOf` maps a question id to its bank category (the room's, from the bank). Empty when no pick is due. */
export function pickableCategories(game: GameState, categoryOf: Record<string, string | undefined>, open: boolean): string[] {
  if (!isBuzzPhase(game)) return [];
  const buzz = currentBuzz(game);
  if (!buzz.picker || open || buzz.open || buzz.teamId) return [];
  const found = game.boss.questionIds.filter((id) => !game.revealedQuestionIds.includes(id)).map((id) => categoryOf[id]);
  return [...new Set(found.filter((c): c is string => !!c))];
}

/** The buzz winner picks the next question's category (boss-music-buzzer.md M5): the boss question becomes the
 * current one if it has that category, else the next unrevealed one in the ring that does. It may change its mind
 * until buzzing opens (`open`: the room's call, as in buzzIn). Nobody has heard the question it replaces. */
export function pickCategory(game: GameState, teamId: string, category: string, categoryOf: Record<string, string | undefined>, open: boolean): GameState {
  if (!isBuzzPhase(game)) throw new InvalidActionError("not_buzzer_phase");
  const buzz = currentBuzz(game);
  if (buzz.picker !== teamId) throw new InvalidActionError("not_picker");
  if (open || buzz.open || buzz.teamId) throw new InvalidActionError("too_late");
  const { questionIds, currentQuestionId } = game.boss;
  const start = questionIds.indexOf(currentQuestionId);
  const ring = questionIds.map((_, i) => questionIds[(start + i) % questionIds.length]);
  const id = ring.find((q) => categoryOf[q] === category && !game.revealedQuestionIds.includes(q));
  if (!id) throw new InvalidActionError("no_such_category");
  return { ...game, boss: { ...game.boss, currentQuestionId: id }, buzz: { ...buzz, questionId: id, category } };
}

/** 沒人答對，換下一題 (D4): the boss question moves on, unrevealed, so it may come round again. */
export function skipBuzz(game: GameState): GameState {
  if (!isBuzzPhase(game)) throw new InvalidActionError("not_buzzer_phase");
  if (game.buzz?.questionId === game.boss.currentQuestionId && game.buzz.teamId) throw new InvalidActionError("buzz_taken");
  const rotated = rotateBoss(game.boss, game.revealedQuestionIds);
  return { ...game, buzz: rotatedBuzz(game, rotated.currentQuestionId), teams: resetBossSelections(game.teams), boss: { ...game.boss, ...rotated } };
}

/** No class ability, check or prayer in a buzzer phase (D6): answers are spoken after a buzz. */
function assertNotBuzz(game: GameState) {
  if (isBuzzPhase(game)) throw new InvalidActionError("buzzer_phase");
}

/** The id of the team whose turn it currently is, skipping offline teams (T7). */
export function currentTurnTeamId(game: GameState): string | null {
  // A team deciding 重答 / 逃跑 keeps the turn even if its phone sleeps (phone-answering.md E9).
  if (game.pendingWrong) return game.pendingWrong.teamId;
  // So does a team whose typed answer waits for the host: it puts the phone down after sending.
  const typed = game.teams.find((t) => t.typedAnswer !== undefined);
  if (typed) return typed.id;
  const idx = nextOnlineIndex(game, 0);
  // null: every team is offline, so no one can take a turn.
  return idx === null ? null : game.turnOrder[idx];
}

/** The first turn index at or after currentTurnIndex + `from` whose team is online (wrapping), or null. */
function nextOnlineIndex(game: GameState, from: number): number | null {
  const n = game.turnOrder.length;
  for (let i = from; i < from + n; i++) {
    const idx = (game.currentTurnIndex + i) % n;
    if (getTeam(game, game.turnOrder[idx]).online) return idx;
  }
  return null;
}

/**
 * Advance to the next online team's turn. If every team is offline this is a
 * no-op (there's nothing to advance to) rather than an infinite loop — see
 * Failure modes: nextTurn() 離線隊伍處理 critical gap from /plan-eng-review.
 */
export function advanceTurn(game: GameState): GameState {
  const idx = nextOnlineIndex(game, 1);
  return idx === null ? game : { ...game, currentTurnIndex: idx };
}

/** 結束冒險: the host ends a game still being played, ranked by the reward each team has now. */
export function endGame(game: GameState, rng: () => number = Math.random): GameState {
  if (game.phase === "finished") throw new InvalidActionError("Game already finished");
  return finishGame({ ...game, pendingWrong: null }, rng);
}

/** Ranks the teams, rolling d20s for ties on the podium, so exactly one team wins (podium-reveal.md D4). */
function finishGame(game: GameState, rng: () => number): GameState {
  const { ranking, tieRolls } = rankTeams(game.teams, () => rollD20(rng));
  return { ...game, phase: "finished", winners: ranking.slice(0, 1), ranking, tieRolls };
}

/** Adds `n` natural 20s to a team's count (D5). */
function withNatural20s(t: Team, n: number): Partial<Team> {
  return n > 0 ? { natural20s: (t.natural20s ?? 0) + n } : {};
}

/**
 * Resolve one answer attempt for `teamId`. Always advances the turn
 * afterwards (win or lose) — global round-robin never gives a bonus turn,
 * which is what keeps the 1/N pacing fair (see Architecture Review). The one
 * exception is a cleric's prayed wrong lock: its 重答 / 逃跑 keeps the turn, once a turn (prayerTurn).
 *
 * `fleeChoice` only matters when the answer is incorrect: "flee" downgrades
 * the room's difficulty and keeps the room index; "retry" leaves the
 * team facing the exact same question again on their next turn.
 */
export function answerQuestion(
  game: GameState,
  teamId: string,
  questionId: string,
  correct: boolean,
  fleeChoice: "flee" | "retry" = "retry",
  rng: () => number = Math.random,
  critValue?: number,
  /** The kill bonus's four d20, already shown by the room; rolled on `rng` when absent. */
  killDice?: number[],
): { game: GameState; outcome: AnswerOutcome } {
  assertPlaying(game);
  // The die behind a correct answer: a 20 adds half the base reward (and a boss hit); a 1 is only a show.
  const crit = correct && critValue === 20;
  // This team's persuasion check on this question: a natural 1 halves any success on it, a warrior's too (R3-7).
  const check = game.checks?.[checkKey(questionId, teamId)];
  // An event's curse or blessing waits for the next correct answer (event-rooms.md D12): the curse halves like a natural-1
  // check (never twice), the blessing adds half the base like a crit 20.
  const boon = correct ? game.teams.find((t) => t.id === teamId)?.boon : undefined;
  const halved = correct && (check?.value === 1 || boon === "curse");
  const rollMark: { roll?: RollMark } =
    correct && (critValue === 20 || critValue === 1)
      ? { roll: { kind: "crit", value: critValue } }
      : correct && (check?.value === 20 || check?.value === 1)
        ? { roll: { kind: "check", value: check.value } }
        : {};
  const critBonus = (base: number) => (crit ? Math.round(base * 0.5) : 0) + (boon === "blessing" ? Math.round(base * 0.5) : 0);
  // R5: the half is taken from the base reward, then the sneak raises it.
  const baseOf = (reward: number) => (halved ? Math.round(reward * 0.5) : reward);

  const activeTeamId = currentTurnTeamId(game);
  if (activeTeamId === null) {
    throw new InvalidActionError("No online team available to take a turn");
  }
  if (activeTeamId !== teamId) {
    throw new InvalidActionError(
      `It is not ${teamId}'s turn (current turn: ${activeTeamId})`,
    );
  }

  if (correct && game.pendingWrong) {
    throw new InvalidActionError(`${teamId} already locked a wrong answer; only retry or flee is left`);
  }
  const prayed = !correct && game.pendingWrong?.prayed === true;
  // Any judgment uses up an armed Sneak Attack; only a correct one pays (D16): ×2 boss damage, ×1.5 reward.
  const sneak = getTeam(game, teamId).sneakArmed ? 2 : 1;
  const sneakPay = (reward: number) => (sneak === 2 ? Math.round(reward * SNEAK_REWARD_MULTIPLIER) : reward);
  // The chef's 15% goes on the whole gain, last (eng review D2).
  const chef = getTeam(game, teamId).classId === "chef";
  const withChef = (gain: number) => {
    const share = chef ? chefShare(gain) : 0;
    return { reward: gain + share, ...(share ? { chefBonus: share } : {}) };
  };
  // This turn counts once, for lib/game-log.ts: a cleric's prayed wrong lock keeps the turn, so its answer after counts.
  const order = game.turnOrder.indexOf(teamId);
  const played = prayed ? {} : {
    round: (game.round ?? 1) + (game.lastTurnIndex !== undefined && order <= game.lastTurnIndex ? 1 : 0),
    lastTurnIndex: order,
  };
  // The choice resolves the pending wrong lock.
  game = { ...game, ...played, pendingWrong: null, teams: patchTeam(game.teams, teamId, (t) => ({ sneakArmed: undefined, typedAnswer: undefined, ...(correct ? { boon: undefined } : {}), ...(prayed ? {} : { turns: (t.turns ?? 0) + 1 }), ...withNatural20s(t, correct && critValue === 20 ? 1 : 0) })) };
  // A wrong lock showed the room part of this question's answer (the red tile on the TV), so a
  // flee from it counts as revealed: deal() and nextBossQuestionId only reuse it as a last resort.
  const seenWrong = !correct && fleeChoice === "flee" && (game.eliminated[questionId]?.length ?? 0) > 0;
  const revealedOnFlee = seenWrong ? withRevealed(game.revealedQuestionIds, questionId) : game.revealedQuestionIds;

  const team = getTeam(game, teamId);
  const boss = game.boss;
  const inBoss = team.inBoss;

  // T6: reject stale question submissions (front-end cache lag between
  // rooms/monsters) instead of silently scoring against the wrong question.
  assertCurrentQuestion(game, teamId, questionId);

  let nextGame = game;
  let outcome: AnswerOutcome;

  if (inBoss && boss.phasePending) throw new InvalidActionError("the next boss phase has not started yet");
  // A buzzer phase judges only the team that buzzed first (boss-buzzer.md).
  const buzzing = isBuzzPhase(game);
  if (buzzing && game.buzz?.teamId !== teamId) throw new InvalidActionError("no_buzz");

  if (inBoss) {
    const lastPhase = boss.phaseIndex >= boss.phases.length - 1;
    // An earlier phase out of unrevealed questions moves on; the last one repeats them (premise 3).
    const usedUp = (revealed: string[]) => !lastPhase && boss.questionIds.every((id) => revealed.includes(id));
    if (correct) {
      const newHp = Math.max(0, boss.hp - sneak - (crit ? 1 : 0));
      const bossKilled = newHp === 0 && lastPhase;
      // The 4d20 is not raised by a crit (R4).
      const kill = bossKilled ? (killDice ?? rollBossKillDice(rng)) : undefined;
      const killBonus = kill ? sneakPay(kill.reduce((a, b) => a + b, 0)) : undefined;
      const gain = withChef(sneakPay(baseOf(boss.hitReward)) + critBonus(boss.hitReward) + (killBonus ?? 0));
      const { reward } = gain;
      const teams = patchTeam(game.teams, teamId, (t) => ({ reward: t.reward + reward, ...(bossKilled ? ate(t, boss.dish) : {}), ...withNatural20s(t, kill?.filter((v) => v === 20).length ?? 0) }));

      const revealedNow = withRevealed(game.revealedQuestionIds, boss.currentQuestionId);
      const phasePending = bossKilled ? undefined : newHp === 0 ? "cleared" : usedUp(revealedNow) ? "exhausted" : undefined;
      // A phase that just ended keeps its question until enterNextBossPhase deals the next phase's.
      const stay = bossKilled || phasePending;
      const next = stay ? { currentQuestionId: boss.currentQuestionId } : rotateBoss(boss, revealedNow);

      // The boss question is shared: every team already in boss phase faces the same
      // next question, not just the team that just answered. Reset ALL of their
      // picks, or a team's stale index from the old question could line up with a
      // different option on the new one and mislead the host into judging against
      // a pick that team never made for this question (adversarial review finding).
      nextGame = {
        ...game,
        teams: stay ? teams : resetBossSelections(teams),
        // A correct answer is always revealed (D5) — the current boss question just got right,
        // so it joins the never-redeal set before nextBossQuestionId's own next call sees it.
        revealedQuestionIds: revealedNow,
        boss: {
          ...boss,
          hp: newHp,
          killedByTeamId: bossKilled ? teamId : boss.killedByTeamId,
          ...next,
          ...(phasePending ? { phasePending } : {}),
        },
        // A buzz winner picks the next question's category until buzzing opens (boss-music-buzzer.md M5).
        buzz: buzzing && !stay ? { questionId: next.currentQuestionId, out: [], picker: teamId } : undefined,
      };
      outcome = { type: "correct-boss-hit", teamId, bossHpRemaining: newHp, bossKilled, ...gain, ...(killBonus === undefined ? {} : { killBonus }), ...rollMark };

      if (bossKilled) {
        return { game: finishGame(nextGame, rng), outcome };
      }
    } else {
      // Wrong boss answer: there's no "downgrade" concept for a shared boss queue. A flee rotates
      // the question, and so does a wrong lock even on retry: its red tile on the TV would hand the
      // next team a narrowed question, up to a free hit (boss redesign D1=A). Either way the shown
      // wrong option makes it revealed; the rotation skips every revealed one.
      const shownWrong = (game.eliminated[questionId]?.length ?? 0) > 0;
      const revealed = shownWrong ? withRevealed(game.revealedQuestionIds, questionId) : game.revealedQuestionIds;
      const phasePending = usedUp(revealed) ? ("exhausted" as const) : undefined;
      // A wrong buzz shuts this team out of the question (D4); once every online team is out, they all buzz on the same
      // question again (boss-music-buzzer.md M1): only the host's 換下一題 moves it on.
      const out = buzzing ? [...game.buzz!.out, teamId] : [];
      const allOut = buzzing && game.teams.every((t) => !t.online || !t.inBoss || out.includes(t.id));
      const rotated = !phasePending && (fleeChoice === "flee" || shownWrong) ? rotateBoss(boss, revealed) : { currentQuestionId: boss.currentQuestionId };
      const rotatedBossQuestionId = rotated.currentQuestionId;
      // Same shared-question reasoning as the correct-hit branch above: a rotation changes
      // the question for every team in boss phase, so every one of their picks resets —
      // unless it stayed on the same question (a one-question boss bank, or no option shown), where picks still apply.
      nextGame = {
        ...game,
        revealedQuestionIds: revealed,
        teams: rotatedBossQuestionId !== boss.currentQuestionId ? resetBossSelections(game.teams) : game.teams,
        boss: { ...boss, ...rotated, ...(phasePending ? { phasePending } : {}) },
        ...(buzzing ? { buzz: { ...game.buzz!, teamId: undefined, out: allOut ? [] : out } } : {}),
      };
      outcome =
        fleeChoice === "flee"
          ? { type: "incorrect-flee", teamId, newDifficulty: team.currentDifficulty }
          : { type: "incorrect-retry", teamId, ...(rotatedBossQuestionId !== boss.currentQuestionId ? { newBossQuestion: true as const } : {}) };
    }
  } else {
    if (correct) {
      // The question's own difficulty: an empty, fully held or fully revealed pool deals from another one (deal()).
      const pointsAwarded = game.pools.findIndex((ids) => ids.includes(questionId)) + 1 || team.currentDifficulty;
      const base = game.rooms[team.roomIndex].reward;
      const gain = withChef(sneakPay(baseOf(base)) + critBonus(base));
      const { reward } = gain;
      // A correct answer is always revealed (D5), so the next deal from any pool must not hand it
      // back to a team who hasn't faced it yet.
      const revealedQuestionIds = withRevealed(game.revealedQuestionIds, questionId);
      const earned = team.score + pointsAwarded >= game.config.bossThreshold;
      const entersBoss = earned || game.teams.some((t) => t.inBoss);
      // A team walking into the boss room stays at its room: no next-room question is dealt (it would burn one).
      const nextRoomIndex = entersBoss ? team.roomIndex : Math.min(team.roomIndex + 1, game.rooms.length - 1);
      // Its queued pick goes with it: the boss room has its own.
      const dealt = entersBoss
        ? { questionId: team.currentQuestionId, used: game.usedQuestionIds, queuedQuestionId: undefined }
        : dealFor(game, team, game.rooms[nextRoomIndex].baseDifficulty, revealedQuestionIds, rng, questionId);
      const monsterId = game.rooms[team.roomIndex].monsterId;
      const defeats = monsterId ? { ...game.defeats, [monsterId]: (game.defeats?.[monsterId] ?? 0) + 1 } : game.defeats;
      const nextMonsterId = game.rooms[nextRoomIndex].monsterId;
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        revealedQuestionIds,
        ...(defeats ? { defeats } : {}),
        teams: patchTeam(game.teams, teamId, (t) => ({
          score: t.score + pointsAwarded,
          reward: t.reward + reward,
          ...ate(t, game.rooms[team.roomIndex].dish),
          roomIndex: nextRoomIndex,
          ...(nextMonsterId ? { metDefeats: defeats?.[nextMonsterId] ?? 0 } : {}),
          currentDifficulty: entersBoss ? t.currentDifficulty : game.rooms[nextRoomIndex].baseDifficulty,
          currentQuestionId: dealt.questionId,
          currentSelection: null,
          inBoss: entersBoss,
          ...(entersBoss ? { bossAt: { round: game.round ?? 1, turns: t.turns ?? 0, ...(earned ? { earned: true as const } : {}) } } : {}),
          queuedQuestionId: dealt.queuedQuestionId,
        })),
      };
      nextGame = applySprint(game, nextGame);
      outcome = { type: "correct-room-advance", teamId, pointsAwarded, ...gain, nextRoomIndex, entersBoss, ...rollMark };
    } else if (fleeChoice === "flee") {
      const newDifficulty = Math.max(MIN_DIFFICULTY, team.currentDifficulty - 1) as Difficulty;
      // Fleeing reveals the answer only after a wrong lock (revealedOnFlee); otherwise only skip
      // already-revealed questions from prior correct answers.
      const dealt = dealFor(game, team, newDifficulty, revealedOnFlee, rng, team.currentQuestionId);
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        revealedQuestionIds: revealedOnFlee,
        teams: patchTeam(game.teams, teamId, () => ({ currentDifficulty: newDifficulty, currentQuestionId: dealt.questionId, currentSelection: null, queuedQuestionId: dealt.queuedQuestionId })),
      };
      outcome = { type: "incorrect-flee", teamId, newDifficulty };
    } else {
      // Retry: same room, same question, waits for this team's next turn.
      outcome = { type: "incorrect-retry", teamId };
    }
  }

  // Eliminated options and a mage's hint belong to a question still in play: once it leaves (answered, fled, rotated)
  // a later deal of it starts clean.
  // Any team: a room short of questions can deal one question to two teams at once.
  const stillFaced = nextGame.teams.some((t) => currentQuestionIdOf(nextGame, t.id) === questionId);
  const checked = Object.keys(nextGame.checks ?? {}).some((k) => isCheckOn(nextGame, k, questionId));
  if (!stillFaced && (questionId in nextGame.eliminated || questionId in (nextGame.mageHints ?? {}) || checked)) nextGame = { ...nextGame, ...dropEliminated(nextGame, questionId) };
  // This team's check goes once the question is answered or the team has moved off it; a retry keeps it (R6).
  else if (checkKey(questionId, teamId) in (nextGame.checks ?? {}) && (correct || currentQuestionIdOf(nextGame, teamId) !== questionId)) {
    const checks = { ...nextGame.checks };
    delete checks[checkKey(questionId, teamId)];
    nextGame = { ...nextGame, checks };
  }
  if (outcome.type === "incorrect-flee") nextGame = { ...nextGame, teams: patchTeam(nextGame.teams, teamId, (t) => ({ flees: (t.flees ?? 0) + 1 })) };
  // Step on from the team that answered: the stored index can point at an offline team the turn skipped.
  const here = { ...nextGame, currentTurnIndex: nextGame.turnOrder.indexOf(teamId) };
  // A prayed wrong lock keeps the turn (class-abilities.md PR 2): the cleric answers again at once.
  if (prayed) return { game: { ...here, prayerTurn: teamId }, outcome };
  return { game: advanceTurn({ ...here, prayerTurn: undefined }), outcome };
}

/** Throws unless it is `teamId`'s turn as a `classId` with no wrong lock waiting (that waits for
 * retry/flee). The room checks its own beats (locks, rolls). */
function assertAbilityTurn(game: GameState, teamId: string, classId: ClassId) {
  assertPlaying(game);
  assertNotBuzz(game);
  assertTurn(game, teamId);
  if (getTeam(game, teamId).classId !== classId) throw new InvalidActionError(`${teamId} is not a ${classId}`);
  if (getTeam(game, teamId).event) throw new InvalidActionError("event_room");
  if (game.pendingWrong) throw new InvalidActionError(`${teamId} already locked a wrong answer`);
  if (getTeam(game, teamId).typedAnswer !== undefined) throw new InvalidActionError("answer_submitted");
}

/** Takes one `classId` use from `teamId` as the ability starts, so a roll dropped in its beat (a phone
 * that reloads to throw a bad die away) still costs it (class-abilities.md D5, reversed in /review). */
export function spendAbility(game: GameState, teamId: string, classId: ClassId): GameState {
  assertAbilityTurn(game, teamId, classId);
  if (getTeam(game, teamId).abilityUses <= 0) throw new InvalidActionError(`${teamId} has no ability uses left`);
  return { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ abilityUses: t.abilityUses - 1 })) };
}

/** The mage removes min(2, wrong options left − 1) wrong options of `questionId` at random into the
 * public eliminated set, and spends a use. Nothing to remove is refused before anything is spent.
 * `correctIndex` and `optionCount` come from the room's bank, in shown order. */
export function mageEliminate(
  game: GameState,
  teamId: string,
  questionId: string,
  correctIndex: number,
  optionCount: number,
  rng: () => number = Math.random,
): GameState {
  assertAbilityTurn(game, teamId, "mage");
  assertCurrentQuestion(game, teamId, questionId);
  const old = game.eliminated[questionId] ?? [];
  const wrong = Array.from({ length: optionCount }, (_, i) => i).filter((i) => i !== correctIndex && !old.includes(i));
  const n = Math.min(2, wrong.length - 1);
  if (n <= 0) throw new InvalidActionError("no_option_to_remove");
  const removed: number[] = [];
  // Clamped: an rng that ever returned 1 would otherwise splice nothing and loop forever.
  while (removed.length < n) removed.push(...wrong.splice(Math.min(wrong.length - 1, Math.floor(rng() * wrong.length)), 1));
  const spent = spendAbility(game, teamId, "mage");
  return {
    ...spent,
    eliminated: { ...game.eliminated, [questionId]: [...old, ...removed] },
    mageRemoved: { ...game.mageRemoved, [questionId]: [...(game.mageRemoved?.[questionId] ?? []), ...removed] },
    // A pick on a removed option clears, for every team facing this question (the boss question is shared).
    teams: spent.teams.map((t) =>
      t.currentSelection !== null && removed.includes(t.currentSelection) && currentQuestionIdOf(game, t.id) === questionId ? { ...t, currentSelection: null } : t,
    ),
  };
}

/** The answer's first letter or number (skipping spaces, punctuation, symbols, emoji), or null when it
 * has fewer than 2 of them: one would give the whole answer away. */
export function firstMeaningfulChar(answer: string): string | null {
  const chars = answer.match(/[\p{L}\p{N}]/gu) ?? [];
  return chars.length >= 2 ? chars[0]! : null;
}

/** The mage shows the first character of a fill-in answer to everyone and spends a use; with `whole`, `answer` itself
 * (a sort question's first item). A second cast on the same question, or an answer too short to hint, is refused
 * before anything is spent. */
export function mageHint(game: GameState, teamId: string, questionId: string, answer: string, whole = false): GameState {
  assertAbilityTurn(game, teamId, "mage");
  assertCurrentQuestion(game, teamId, questionId);
  if (game.mageHints?.[questionId] !== undefined) throw new InvalidActionError("hint_shown");
  // The team's own check already showed the first character (dnd design E1-1): nothing left to give, nothing spent.
  if (game.checks?.[checkKey(questionId, teamId)]?.hint !== undefined) throw new InvalidActionError("hint_shown");
  const hint = whole ? answer : firstMeaningfulChar(answer);
  if (hint === null) throw new InvalidActionError("no_hint");
  const spent = spendAbility(game, teamId, "mage");
  return { ...spent, mageHints: { ...game.mageHints, [questionId]: hint } };
}

/** The bonus and DC a team rolls with on `questionId` (dnd design Premise 3): its class bonus, against its question's
 * difficulty (the pool it was dealt from, like answerQuestion's points), or the boss's 16. */
export function checkTarget(game: GameState, teamId: string, questionId: string): { bonus: number; dc: number } {
  const team = getTeam(game, teamId);
  const bonus = CHECK_BONUS[team.classId ?? "none"];
  if (isInBossPhase(game, teamId)) return { bonus, dc: BOSS_CHECK_DC };
  const difficulty = game.pools.findIndex((ids) => ids.includes(questionId)) + 1 || team.currentDifficulty;
  return { bonus, dc: CHECK_DC[difficulty - 1] };
}

/** Writes the team's persuasion check on its current fill-in question (dnd design R6, R8). A natural 20 passes, a 1
 * fails; otherwise die + bonus >= DC passes. Not a judgment: the turn stays, and a natural 20's win is the room's to apply. */
export function recordCheck(game: GameState, teamId: string, questionId: string, value: number, answer: string): GameState {
  assertPlaying(game);
  assertNotBuzz(game);
  if (currentTurnTeamId(game) !== teamId) throw new InvalidActionError("not_your_turn");
  assertCurrentQuestion(game, teamId, questionId);
  if (game.checks?.[checkKey(questionId, teamId)]) throw new InvalidActionError("check_done");
  const { bonus, dc } = checkTarget(game, teamId, questionId);
  const passed = value === 20 || (value !== 1 && value + bonus >= dc);
  // A mage's hint already showed the first character: the check gives no second copy (R8).
  const hint = passed && value !== 20 && game.mageHints?.[questionId] === undefined ? firstMeaningfulChar(answer) : null;
  const record: CheckRecord = { value, bonus, dc, passed, ...(hint !== null ? { hint } : {}) };
  const teams = patchTeam(game.teams, teamId, (t) => withNatural20s(t, value === 20 ? 1 : 0));
  return { ...game, teams, checks: { ...game.checks, [checkKey(questionId, teamId)]: record } };
}

/** The thief arms a Sneak Attack for its answer to this question, spending the use at once (D16). */
export function armSneak(game: GameState, teamId: string): GameState {
  assertAbilityTurn(game, teamId, "thief");
  if (getTeam(game, teamId).sneakArmed) throw new InvalidActionError("sneak_armed");
  const spent = spendAbility(game, teamId, "thief");
  return { ...spent, teams: patchTeam(spent.teams, teamId, () => ({ sneakArmed: true })) };
}

/** Whether `teamId` is a cleric that may pray this turn: the game on, a use left, no prayer yet this turn. */
function clericMayPray(game: GameState, teamId: string): boolean {
  const team = game.teams.find((t) => t.id === teamId);
  return game.phase === "playing" && !isBuzzPhase(game) && team?.classId === "cleric" && team.abilityUses > 0 && game.prayerTurn !== teamId;
}

/** Whether `teamId` is a cleric that could pray on a wrong answer now: a use left, no prayer yet this turn. */
export function canPrayBeforeJudge(game: GameState, teamId: string): boolean {
  return !game.pendingWrong && clericMayPray(game, teamId);
}

/**
 * The host judged a cleric's fill-in answer wrong (#106): instead of settling it, the wrong answer waits for
 * 祈禱 / 重答 / 逃跑 from the team or the host. Like recordWrongLock there is no narration until then (E7).
 * Only for a cleric that may pray (canPrayBeforeJudge); the room has checked the question is a text one.
 */
export function recordTextWrong(game: GameState, teamId: string, questionId: string): GameState {
  assertPlaying(game);
  assertTurn(game, teamId);
  assertCurrentQuestion(game, teamId, questionId);
  if (!canPrayBeforeJudge(game, teamId)) throw new InvalidActionError("cannot_pray");
  return { ...game, pendingWrong: { teamId, questionId, optionIndex: null } };
}

/** Whether `teamId`'s wrong lock is waiting on a cleric that may still pray this turn. */
export function canPray(game: GameState, teamId: string): boolean {
  return game.pendingWrong?.teamId === teamId && !game.pendingWrong.prayed && clericMayPray(game, teamId);
}

/** The cleric prays on its wrong lock: one use, and its 重答 / 逃跑 then keeps the turn (answerQuestion). */
export function pray(game: GameState, teamId: string): GameState {
  assertPlaying(game);
  if (!canPray(game, teamId)) throw new InvalidActionError(`${teamId} cannot pray now`);
  return {
    ...game,
    pendingWrong: { ...game.pendingWrong!, prayed: true },
    teams: patchTeam(game.teams, teamId, (t) => ({ abilityUses: t.abilityUses - 1 })),
  };
}

/**
 * The warrior's roll stands in for the answer: `value` (a d20, rolled by the room) of WARRIOR_TARGET
 * or more is a correct answer, less is a wrong one with retry, under answerQuestion's usual rules
 * (in the boss room a shown wrong option still rotates the question). The use was spent by spendAbility.
 * `critable`: a multipleChoice question, where this die is also the crit die (a 20 is a critical hit, R2).
 */
export function warriorRoll(
  game: GameState,
  teamId: string,
  questionId: string,
  value: number,
  rng: () => number = Math.random,
  critable = false,
  killDice?: number[],
): { game: GameState; outcome: AnswerOutcome } {
  assertAbilityTurn(game, teamId, "warrior");
  // A critable die is counted as the crit die in answerQuestion; any other natural 20 is counted here (D5).
  const counted = critable ? game : { ...game, teams: patchTeam(game.teams, teamId, (t) => withNatural20s(t, value === 20 ? 1 : 0)) };
  return answerQuestion(counted, teamId, questionId, value >= WARRIOR_TARGET, "retry", rng, critable ? value : undefined, killDice);
}

/**
 * The host's override (docs/designs/scoring-and-score-pools.md S13): take a team into the boss room
 * as if it had just reached the threshold. Not a turn: the turn order and every score stay as they
 * are. Refused while the team's wrong lock waits for retry/flee, so that choice never lands on a
 * question the team no longer faces.
 */
export function sendToBoss(game: GameState, teamId: string): GameState {
  assertPlaying(game);
  const team = getTeam(game, teamId);
  if (team.inBoss) throw new InvalidActionError(`${teamId} is already in the boss room`);
  if (game.pendingWrong?.teamId === teamId) throw new InvalidActionError(`${teamId} has a wrong lock waiting for retry or flee`);
  // A sneak armed for the room question is for that question only (D16): drop it and give the use back.
  // (A boss-room sneak can outlive a question rotation while the thief is offline; accepted, /review D4=A.)
  const sneak = team.sneakArmed ? { sneakArmed: undefined, abilityUses: team.abilityUses + 1 } : {};
  const teams = patchTeam(game.teams, teamId, () => ({ inBoss: true, bossAt: { round: game.round ?? 1, turns: team.turns ?? 0 }, currentSelection: null, queuedQuestionId: undefined, typedAnswer: undefined, event: undefined, ...sneak }));
  // The room question leaves play with this team (as in answerQuestion): a later deal of it starts clean.
  const left = team.currentQuestionId;
  const stillFaced = teams.some((t) => !t.inBoss && t.currentQuestionId === left);
  return applySprint(game, { ...game, teams, ...(stillFaced ? {} : dropEliminated(game, left)) });
}

/**
 * ⚔️ 最後衝刺 (docs/designs/last-sprint.md): the first time any team enters the boss room, the trailing teams still
 * outside (lowest 飽足感, ties all) get the event room's blessing, which replaces a curse and never stacks. Once per game.
 */
export function applySprint(prev: GameState, next: GameState): GameState {
  if (prev.sprint || prev.teams.some((t) => t.inBoss) || !next.teams.some((t) => t.inBoss) || next.config.bossThreshold <= 0) return next;
  // Offline teams count: they are still in the game.
  const outside = next.teams.filter((t) => !t.inBoss);
  if (next.teams.length < 2 || outside.length === 0) return next;
  const low = Math.min(...outside.map((t) => t.reward));
  const teamIds = outside.filter((t) => t.reward === low).map((t) => t.id);
  return { ...next, sprint: { teamIds }, teams: next.teams.map((t) => (teamIds.includes(t.id) ? { ...t, boon: "blessing" as const } : t)) };
}

/* ---------- Event rooms (docs/designs/event-rooms.md) ---------- */

/** The chance that a correct answer walks a team into an event room instead of the next room's monster (D5). */
export const EVENT_CHANCE = 0.25;
/** What stands on stage. A chest hides a feast or a rotten dish; the fortune teller draws 大吉, 中吉 or 凶. */
export type EventScene = "chest" | "spring" | "idol" | "fairy" | "fortune";
export type EventOutcome = "feast" | "rotten" | "spring" | "curse" | "blessing" | "great" | "good" | "bad";
export interface RoomEvent {
  scene: EventScene;
  outcome: EventOutcome;
}
export type Boon = "curse" | "blessing";
/** Satiety each outcome gives or takes (D4, D9); the spring's goes only to a chef or a team with no class. */
export const EVENT_SATIETY = { feast: 20, rotten: -10, great: 25, spring: 10 } as const;

/** The six events, one each (D4): the chest twice, since it hides two. The fortune teller draws its lot here too. */
export function drawEvent(rng: () => number = Math.random): RoomEvent {
  const deck: RoomEvent[] = [
    { scene: "chest", outcome: "feast" },
    { scene: "chest", outcome: "rotten" },
    { scene: "spring", outcome: "spring" },
    { scene: "idol", outcome: "curse" },
    { scene: "fairy", outcome: "blessing" },
  ];
  const i = Math.floor(rng() * (deck.length + 1));
  if (i < deck.length) return deck[i];
  return { scene: "fortune", outcome: (["great", "good", "bad"] as const)[Math.min(2, Math.floor(rng() * 3))] };
}

/** Whether this correct answer may walk its team into an event room (D5, D12): only into a room before the last,
 * never into the boss room. The last room and leaving an event room never roll. */
export function eventEligible(game: GameState, outcome: AnswerOutcome): boolean {
  return outcome.type === "correct-room-advance" && !outcome.entersBoss && outcome.nextRoomIndex < game.rooms.length - 1 && !getTeam(game, outcome.teamId).event;
}

/** The team walked into an event room: `event` waits for its next turn. Not a turn. */
export function enterEventRoom(game: GameState, teamId: string, event: RoomEvent): GameState {
  assertPlaying(game);
  if (getTeam(game, teamId).inBoss) throw new InvalidActionError("no events in the boss room");
  return { ...game, teams: patchTeam(game.teams, teamId, () => ({ event })) };
}

/** What opening an event did, for the room's reveal, narration and the phone. `satiety` is the change actually made
 * (a rotten dish takes no more than the team has), chef bonus included. */
export interface EventResult {
  teamId: string;
  scene: EventScene;
  outcome: EventOutcome;
  satiety: number;
  chefBonus?: number;
  /** The spring's (or 中吉's) extra ability use. */
  abilityUse?: true;
  boon?: Boon;
  /** The boss door was already open: the team walked on into the boss room, as a correct answer would. */
  entersBoss?: true;
}

/**
 * The turn's team opens its event (D3): the effect lands, the turn counts, the team walks on into the next room
 * with a fresh deal, and the turn passes, as answerQuestion does. The room holds the result on show until 下一題.
 */
export function openEvent(game: GameState, teamId: string, rng: () => number = Math.random): { game: GameState; result: EventResult } {
  assertPlaying(game);
  assertTurn(game, teamId);
  const team = getTeam(game, teamId);
  const event = team.event;
  if (!event) throw new InvalidActionError("no_event");
  const result: EventResult = { teamId, scene: event.scene, outcome: event.outcome, satiety: 0 };
  // The chef's 15% goes on satiety an event gives, never on what it takes (D12).
  const give = (n: number) => {
    const share = team.classId === "chef" ? chefShare(n) : 0;
    result.satiety = n + share;
    if (share) result.chefBonus = share;
  };
  const o = event.outcome;
  if (o === "feast" || o === "great") give(EVENT_SATIETY[o]);
  // No more than the team has, and a plain 0 (not -0) when it has nothing left.
  else if (o === "rotten") result.satiety = team.reward > 0 ? -Math.min(-EVENT_SATIETY.rotten, team.reward) : 0;
  else if (o === "spring" || o === "good") {
    if (team.classId && team.classId !== "chef") result.abilityUse = true;
    else give(EVENT_SATIETY.spring);
  } else result.boon = o === "blessing" ? "blessing" : "curse";

  const order = game.turnOrder.indexOf(teamId);
  const round = (game.round ?? 1) + (game.lastTurnIndex !== undefined && order <= game.lastTurnIndex ? 1 : 0);
  // Once a team is in the boss room, everyone's next room is the boss's (answerQuestion's entersBoss): the event
  // counts as that step, and like a correct answer it deals nothing, since the boss room has its own questions.
  const entersBoss = game.teams.some((t) => t.inBoss);
  if (entersBoss) result.entersBoss = true;
  const next = entersBoss ? team.roomIndex : Math.min(team.roomIndex + 1, game.rooms.length - 1);
  const dealt = entersBoss
    ? { questionId: team.currentQuestionId, used: game.usedQuestionIds, queuedQuestionId: undefined }
    : dealFor(game, team, game.rooms[next].baseDifficulty, game.revealedQuestionIds, rng, team.currentQuestionId);
  const monsterId = game.rooms[next].monsterId;
  const teams = patchTeam(game.teams, teamId, (t) => ({
    event: undefined,
    events: [...(t.events ?? []), o],
    reward: t.reward + result.satiety,
    abilityUses: t.abilityUses + (result.abilityUse ? 1 : 0),
    ...(result.boon ? { boon: result.boon } : {}),
    turns: (t.turns ?? 0) + 1,
    roomIndex: next,
    ...(monsterId ? { metDefeats: game.defeats?.[monsterId] ?? 0 } : {}),
    currentDifficulty: game.rooms[next].baseDifficulty,
    currentQuestionId: dealt.questionId,
    currentSelection: null,
    queuedQuestionId: dealt.queuedQuestionId,
    // This turn counts, as answerQuestion counts the answering turn before it writes bossAt.
    ...(entersBoss ? { inBoss: true, bossAt: { round: game.round ?? 1, turns: (t.turns ?? 0) + 1 } } : {}),
  }));
  const moved = { ...game, teams, usedQuestionIds: dealt.used, round, lastTurnIndex: order, currentTurnIndex: order, prayerTurn: undefined };
  return { game: advanceTurn(moved), result };
}

/** The team's dishes with `dish` eaten, or nothing when the monster has none. */
function ate(team: Team, dish: string | undefined): Pick<Team, "dishes"> | object {
  return dish ? { dishes: [...(team.dishes ?? []), dish] } : {};
}

/** `eliminated`, `mageRemoved`, `mageHints` and every team's check without `questionId`: it left play, and a later deal of it starts clean. */
function dropEliminated(game: GameState, questionId: string): Pick<GameState, "eliminated" | "mageRemoved" | "mageHints" | "checks"> {
  const drop = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== questionId));
  const checks = Object.fromEntries(Object.entries(game.checks ?? {}).filter(([k]) => !isCheckOn(game, k, questionId)));
  return { eliminated: drop(game.eliminated), mageRemoved: drop(game.mageRemoved ?? {}), mageHints: drop(game.mageHints ?? {}), checks };
}

/**
 * Record (or change) a team's pick for the multipleChoice question they're currently
 * facing. Re-selectable: a later submission for the same
 * question simply overwrites the earlier one; the sender only ever changes their own
 * mind before the host judges. Rejects a submission for any question other than the
 * one the team (or the shared boss encounter, if they're in it) is expected to answer
 * right now — same stale-submission guard as answerQuestion's expectedQuestionId.
 *
 * `optionIndex` is only type-checked at the protocol layer (lib/protocol.ts); bounds-
 * checking it against the live question's actual options.length — and rejecting a
 * questionId whose question isn't kind "multipleChoice" at all — happens in
 * dungeon-room.ts, the only layer with bank access. This function has no bank access
 * (game-state.ts is deliberately bank-agnostic) and so cannot check "is this actually
 * an MC question" itself; it trusts its one caller to have gated that first.
 */
export function recordOptionSelection(game: GameState, teamId: string, questionId: string, optionIndex: number): GameState {
  assertPlaying(game);
  assertCurrentQuestion(game, teamId, questionId);
  if (game.eliminated[questionId]?.includes(optionIndex)) {
    throw new InvalidActionError(`Option ${optionIndex} of ${questionId} was already locked wrong`);
  }
  return {
    ...game,
    teams: patchTeam(game.teams, teamId, () => ({ currentSelection: optionIndex })),
  };
}

/**
 * The turn's team sends its typed answer (already cleaned by the room) to its current question. One per
 * question: a second is refused. Like recordOptionSelection, the room has checked the question is a text one.
 */
export function submitText(game: GameState, teamId: string, questionId: string, text: string): GameState {
  assertPlaying(game);
  // In a buzzer phase only the team that buzzed may type, if it likes (boss-music-buzzer.md M2).
  if (isBuzzPhase(game) && game.buzz?.teamId !== teamId) throw new InvalidActionError("no_buzz");
  if (game.pendingWrong) throw new InvalidActionError("A wrong answer is already waiting for its choice");
  assertTurn(game, teamId);
  assertCurrentQuestion(game, teamId, questionId);
  if (getTeam(game, teamId).typedAnswer !== undefined) throw new InvalidActionError("already_submitted");
  return { ...game, teams: patchTeam(game.teams, teamId, () => ({ typedAnswer: text })) };
}

/**
 * A wrong lock on a multipleChoice question (phone-answering.md premise 3): the option joins the
 * question's eliminated set, the team's pick clears, and `pendingWrong` waits for the team's
 * 重答 / 逃跑, which answerQuestion(correct=false) applies. Like recordOptionSelection, the caller
 * (dungeon-room.ts) has already checked the question kind and the option range against the bank.
 */
export function recordWrongLock(game: GameState, teamId: string, questionId: string, optionIndex: number): GameState {
  assertPlaying(game);
  if (game.pendingWrong) throw new InvalidActionError("A wrong answer is already waiting for its choice");
  assertTurn(game, teamId);
  assertCurrentQuestion(game, teamId, questionId);
  const old = game.eliminated[questionId] ?? [];
  return {
    ...game,
    eliminated: { ...game.eliminated, [questionId]: old.includes(optionIndex) ? old : [...old, optionIndex] },
    pendingWrong: { teamId, questionId, optionIndex },
    teams: patchTeam(game.teams, teamId, () => ({ currentSelection: null })),
  };
}

/** The question `teamId` faces right now: the shared boss question in the boss room, else its own. */
export function currentQuestionIdOf(game: GameState, teamId: string): string {
  return isInBossPhase(game, teamId) ? game.boss.currentQuestionId : getTeam(game, teamId).currentQuestionId;
}

function assertCurrentQuestion(game: GameState, teamId: string, questionId: string) {
  // A team in an event room has no question to answer until it opens the event (event-rooms.md).
  if (getTeam(game, teamId).event) throw new InvalidActionError("event_room");
  const expectedQuestionId = currentQuestionIdOf(game, teamId);
  if (questionId !== expectedQuestionId) {
    throw new InvalidActionError(`Stale question submission for ${teamId}: expected ${expectedQuestionId}, got ${questionId}`);
  }
}

function assertTurn(game: GameState, teamId: string) {
  if (currentTurnTeamId(game) !== teamId) throw new InvalidActionError(`It is not ${teamId}'s turn`);
}

function assertPlaying(game: GameState) {
  if (game.phase === "finished") throw new InvalidActionError("Game already finished");
}

/** `teams` with team `teamId` replaced by a copy that has `patch(team)`'s fields. */
function patchTeam(teams: Team[], teamId: string, patch: (t: Team) => Partial<Team>): Team[] {
  return teams.map((t) => (t.id === teamId ? { ...t, ...patch(t) } : t));
}

/** Mark a team offline/online — a disconnected team is skipped by advanceTurn (T7). */
export function setTeamOnline(game: GameState, teamId: string, online: boolean): GameState {
  getTeam(game, teamId); // throws if unknown
  // A buzzing team that drops lets go of the buzz, not judged (boss-buzzer.md): another team may buzz.
  const drops = !online && game.buzz?.teamId === teamId;
  const dropped = drops ? { buzz: { ...game.buzz!, teamId: undefined } } : {};
  return {
    ...game,
    ...dropped,
    // Its typed answer goes with the buzz (boss-music-buzzer.md M2): it may buzz and type again.
    teams: patchTeam(game.teams, teamId, () => ({ online, ...(drops ? { typedAnswer: undefined } : {}) })),
  };
}

/**
 * Minimal spectator view for waiting teams (Premise 7 — pacing mitigation).
 * Not a full "活地圖" (that's deferred to iteration 2): just who's up and
 * how far they've gotten.
 */
export interface SpectatorView {
  currentTurnTeamId: string | null;
  teams: {
    id: string;
    name: string;
    score: number;
    reward: number;
    roomIndex: number;
    inBossPhase: boolean;
    online: boolean;
    /** The question id this team must answer on their next turn — an opaque
     * id, not the question text (the host reads text off a paper sheet
     * matched by id; see docs/designs Next Steps #7). Exposed so the host
     * client can submit a matching HOST_JUDGE without a separate lookup. */
    currentQuestionId: string;
    /** The team's current pick for a multipleChoice question, or null. Lets the host
     * see what a team has picked before judging (T7 host UI). */
    currentSelection: number | null;
    classId?: ClassId;
    abilityUses: number;
    sneakArmed?: true;
    /** The typed answer waiting for the host (text questions), or null. */
    typedAnswer: string | null;
    /** A cleric that could pray if judged wrong now (canPrayBeforeJudge): the host's one 答錯 key waits for
     * its choice. */
    mayPray?: true;
    /** The class bonus and DC this team's persuasion check rolls with on its current question (checkTarget). */
    checkTarget?: { bonus: number; dc: number };
    /** The event room this team stands in: the scene only, never its outcome until it is opened (event-rooms.md). */
    eventScene?: EventScene;
    boon?: Boon;
  }[];
  bossHp: number;
  bossMaxHp: number;
  /** The boss phase being fought, from 1. Only phases already reached: never the total (boss-phases.md). */
  bossPhase: number;
  bossCurrentQuestionId: string;
  /** Who landed the boss's final blow, or null while it lives. */
  bossKilledBy: string | null;
  /** Options locked wrong per question id (shown greyed on every screen) and the wrong lock awaiting a choice. */
  eliminated: Record<string, number[]>;
  mageRemoved: Record<string, number[]>;
  /** The mage's first-character hint per fill-in question id (mageHint). */
  mageHints: Record<string, string>;
  /** Persuasion checks per checkKey(questionId, teamId), written once their beat ends (dnd design R6). Absent from an older server. */
  checks?: Record<string, CheckRecord>;
  pendingWrong: WrongAnswer | null;
  /** The buzz on the boss question, only while a buzzer phase is fought (boss-buzzer.md). Its presence is what tells
   * every screen the phase is a buzzer one. */
  buzz?: BuzzState;
  /** The cleric whose wrong lock waits for its 祈禱 (canPray), or null. */
  awaitingPrayer: string | null;
  /** ⚔️ 最後衝刺 once it fired (GameState.sprint): the screen and phones name the blessed teams. */
  sprint?: { teamIds: string[] };
}

export function getSpectatorView(game: GameState): SpectatorView {
  return {
    // A buzzer phase has no turns: the team that buzzed answers, nobody else is on turn (boss-buzzer.md).
    currentTurnTeamId: isBuzzPhase(game) ? (currentBuzz(game).teamId ?? null) : currentTurnTeamId(game),
    teams: game.teams.map((t) => ({
      id: t.id,
      name: t.name,
      score: t.score,
      reward: t.reward,
      roomIndex: t.roomIndex,
      inBossPhase: t.inBoss,
      online: t.online,
      currentQuestionId: t.currentQuestionId,
      currentSelection: t.currentSelection,
      ...(t.classId ? { classId: t.classId } : {}),
      abilityUses: t.abilityUses,
      ...(t.sneakArmed ? { sneakArmed: true as const } : {}),
      typedAnswer: t.typedAnswer ?? null,
      ...(canPrayBeforeJudge(game, t.id) ? { mayPray: true as const } : {}),
      checkTarget: checkTarget(game, t.id, t.currentQuestionId),
      ...(t.event ? { eventScene: t.event.scene } : {}),
      ...(t.boon ? { boon: t.boon } : {}),
    })),
    bossHp: game.boss.hp,
    bossMaxHp: game.boss.maxHp,
    bossPhase: game.boss.phaseIndex + 1,
    bossCurrentQuestionId: game.boss.currentQuestionId,
    bossKilledBy: game.boss.killedByTeamId,
    eliminated: game.eliminated,
    mageRemoved: game.mageRemoved ?? {},
    mageHints: game.mageHints ?? {},
    checks: game.checks ?? {},
    pendingWrong: game.pendingWrong,
    ...(isBuzzPhase(game) ? { buzz: currentBuzz(game) } : {}),
    awaitingPrayer: game.pendingWrong && canPray(game, game.pendingWrong.teamId) ? game.pendingWrong.teamId : null,
    ...(game.sprint ? { sprint: game.sprint } : {}),
  };
}
