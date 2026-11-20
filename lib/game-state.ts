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
// exactly once. The mage rolls a skill die for removed options or a hint (mageCast), the thief rolls a Sneak Attack die
// that may raise this answer's reward and boss damage (startSneak, sneakRoll), and the cleric prays on a wrong
// lock (pray) so that its 重答 / 逃跑 keeps the turn instead of advancing it (prayerTurn).
//
// Turn order never changes with room progress — this avoids the "arrival
// order" snowball fairness risk flagged in /plan-eng-review's Outside Voice.
import { rankTeams, type TieRoll } from "./podium";
import { MONSTERS, monsterById, type CatalogMonster } from "./monster-catalog";

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

/** Each class's skill name (owner 2026-11-19): the phone buttons, the lobby, the big screen's roll chips and the
 * how-to-play slides all say these. The chef's is its passive; 「料理骰」 stays the die every team rolls. */
export const CLASS_SKILLS: Record<ClassId, string> = {
  mage: "洞悉",
  cleric: "祈禱",
  warrior: "衝鋒",
  thief: "偷襲",
  chef: "提鮮",
};

export const CLASS_ICONS: Record<ClassId, string> = {
  mage: "🔮",
  cleric: "✝️",
  warrior: "⚔️",
  thief: "🗝️",
  chef: "🍳",
};

/** Ability uses per team per game, the same for every active class (class dice, owner 2026-11-17). The chef has none:
 * its dish die pays more (CHEF_DISH_MULTIPLIERS). */
export const ABILITY_USES = 3;

/** A team's ability uses at the start of a game. */
export function abilityUsesFor(classId: ClassId | undefined): number {
  return classId === "chef" ? 0 : ABILITY_USES;
}

/* ---------- Class dice (docs/designs/class-abilities.md 「職業技能擲骰」) ---------- */

/** One d20's tier, the same for every class: 0 大失敗 (1), 1 失敗 (2–6), 2 成功 (7–19), 3 大成功 (20). */
export type SkillTier = 0 | 1 | 2 | 3;
export function skillTier(value: number): SkillTier {
  return value <= 1 ? 0 : value < SKILL_SUCCESS ? 1 : value <= 19 ? 2 : 3;
}
/** The lowest value of the success tier (7). */
export const SKILL_SUCCESS = 7;
/** Each tier's name, for the screens and the narrator. */
export const TIER_LABELS = ["大失敗", "失敗", "成功", "大成功"] as const;

/** The thief's Sneak Attack die (docs/designs/class-dice-rework.md), rolled when 偷襲 is pressed: on 7–19 a correct answer
 * gives SNEAK_REWARD_MULTIPLIER times the reward (rounded half up) and the boss loses 2 hearts; on a 20 SNEAK_CRIT_MULTIPLIER
 * and 3 hearts. 2–6 is no sneak; a 1 is caught and loses SNEAK_CAUGHT_SHARE of the question's reward at once. */
export const SNEAK_REWARD_MULTIPLIER = 1.5;
export const SNEAK_CRIT_MULTIPLIER = 2;
export const SNEAK_CAUGHT_SHARE = 0.1;

/** 料理骰 (docs/designs/class-dice-rework.md): every team rolls it after a correct turn-based answer, and it multiplies the
 * question's whole reward after every other modifier. Never in a buzzer phase, on an event or on a kill's 4d20, and never
 * on the boss's hearts. Each multiplier is its own constant: the owner may still tune them. */
export const DISH_BURNT_MULTIPLIER = 0.1;
export const DISH_LEGEND_MULTIPLIER = 1.5;
export const CHEF_DISH_SUCCESS_MULTIPLIER = 1.2;
export const CHEF_DISH_LEGEND_MULTIPLIER = 2;
/** The dish die's multiplier per tier (1, 2–6, 7–19, 20) for a team that is not a chef, and for a chef. */
export const DISH_MULTIPLIERS = [DISH_BURNT_MULTIPLIER, 1, 1, DISH_LEGEND_MULTIPLIER] as const;
export const CHEF_DISH_MULTIPLIERS = [DISH_BURNT_MULTIPLIER, 1, CHEF_DISH_SUCCESS_MULTIPLIER, CHEF_DISH_LEGEND_MULTIPLIER] as const;

/** The dish die's tier as players see it: for a team that is not a chef 2–6 pays the same as 7–19, so it reads as the
 * same plain result (owner 2026-11-18), never as a failure; a chef's 2–6 stays tier 1 (no bonus). */
export function dishTier(value: number, chef: boolean): SkillTier {
  const t = skillTier(value);
  return t === 1 && !chef ? 2 : t;
}

/** The dish die `value`'s multiplier for a chef or anyone else. */
export function dishMultiplier(chef: boolean, value: number): number {
  return (chef ? CHEF_DISH_MULTIPLIERS : DISH_MULTIPLIERS)[skillTier(value)];
}

/** The dish die's change to one reward gain (0 with no die): rounded half up. Negative on a 1. */
export function dishShare(gain: number, value: number | undefined, chef: boolean): number {
  if (value === undefined || gain <= 0) return 0;
  return Math.round(gain * dishMultiplier(chef, value)) - gain;
}

/** The warrior's d20 counts as a correct answer at this value or more: the shared tiers' success (owner, 2026-11-09). */
export const WARRIOR_TARGET = SKILL_SUCCESS;
/** The share of the question's reward a warrior's hit pays on 7–19 (owner, 2026-11-17: 「拿八成」). */
export const WARRIOR_HIT_SHARE = 0.8;
/** The share of the question's reward a warrior's hit pays, by its die: WARRIOR_HIT_SHARE on 7–19, twice on a 20. */
export function warriorShare(value: number): number {
  return value >= 20 ? 2 : value >= WARRIOR_TARGET ? WARRIOR_HIT_SHARE : 0;
}

/** A fill-in question is a persuasion check (dnd design Premise 3): d20 + the team's class bonus against the
 * monster's DC. A team with no class adds 1. */
export const CHECK_BONUS: Record<ClassId | "none", number> = { mage: 6, thief: 3, cleric: 2, chef: 4, none: 1, warrior: 0 };
/** The DC per difficulty 1–5 (dnd design Decision 11); a boss question uses its own difficulty's, 3 unless the bank says. */
export const CHECK_DC = [8, 10, 12, 14, 16] as const;
/** A boss question the bank gives no difficulty: 3, a 15-point hit (owner, 2026-11-18). */
export const DEFAULT_BOSS_DIFFICULTY: Difficulty = 3;

/** What hitting the boss pays per question difficulty 1–5 (issue #371). */
export const BOSS_HIT_REWARDS = [5, 10, 15, 20, 25] as const;

/** A boss question's difficulty: the bank's (bossDifficulties), or DEFAULT_BOSS_DIFFICULTY. */
export function bossQuestionDifficulty(game: GameState, questionId: string | null | undefined): Difficulty {
  // Own keys only (an id like "constructor" must not read Object.prototype); a damaged value falls back to the default.
  const d = questionId && game.bossDifficulties && Object.hasOwn(game.bossDifficulties, questionId) ? game.bossDifficulties[questionId] : DEFAULT_BOSS_DIFFICULTY;
  return Number.isInteger(d) && BOSS_HIT_REWARDS[d - 1] !== undefined ? d : DEFAULT_BOSS_DIFFICULTY;
}

/** What one hit on the boss's current question pays (BOSS_HIT_REWARDS by its difficulty). */
export function bossHitReward(game: GameState): number {
  return BOSS_HIT_REWARDS[bossQuestionDifficulty(game, game.boss.currentQuestionId) - 1];
}

/** One team's persuasion check on one question (dnd design R6): `hint` is the answer's first letter or number,
 * given on a pass that is not a natural 20 (that one wins outright) and only when the answer is long enough (R8). */
export interface CheckRecord {
  value: number;
  bonus: number;
  dc: number;
  passed: boolean;
  hint?: string;
  /** A natural 20 whose win failed to apply (roll_failed): no restart applies it later (lostCritOf). */
  dropped?: true;
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
  /** The team's colour (#320, lib/team-look.ts), picked in the lobby; missing in a save from before it. */
  look?: number;
  /** Class ability uses left (ABILITY_USES at the start). */
  abilityUses: number;
  /** Natural 20s this team rolled: dish dice, class dice, persuasion checks and the kill's 4d20 (podium-reveal.md D5).
   * Absent until the first one, and in a game saved before them. */
  natural20s?: number;
  /** Natural 1s, counted by every die that counts a natural 20, and the warrior's d20 whatever the question (fortune-teller.md). */
  natural1s?: number;
  /** Correct judgments, and wrong ones the team retried (a prayed one too; a flee or a switch is in `flees`), for the
   * fortune teller's conditions (docs/designs/fortune-teller.md). Absent until the first. */
  correctAnswers?: number;
  wrongAnswers?: number;
  /** The thief's Sneak Attack die landed 7–19 or 20 and waits for this team's next judgment: a correct one gives ×1.5
   * its reward and ×2 its boss damage (`sneakCrit`, a 20: ×2 and 3 hearts); any judgment uses it up (class-dice-rework.md). */
  sneakArmed?: true;
  sneakCrit?: true;
  /** The thief's last 偷襲: on which question (once per question, whatever its die said), the die once it landed and
   * what a 1 took. */
  sneakTry?: SneakTry;
  /** The question the cleric last prayed on (pray): its prayer die rolled there, so no lucky die for the rest of it. */
  prayedOn?: string;
  /** The team's typed answer to its text question (submitText), waiting for the host. Only the turn's
   * team can hold one, and it keeps the turn until judged; answerQuestion and sendToBoss clear it. */
  typedAnswer?: string;
  /** A music question's typed boxes, in field order, "" for a blank (docs/designs/multi-field.md F4). Set and cleared
   * with `typedAnswer`, which then holds them joined. */
  typedFields?: string[];
  /** Dish names this team ate, in order: one per defeated room monster or boss that has a dish
   * (docs/designs/monster-cuisine.md). Absent until the first, and in saves from before dishes. */
  dishes?: string[];
  /** Turns this team has played: one per answer that passed the turn on (lib/game-log.ts). Absent until the first. */
  turns?: number;
  /** The game round and this team's turn count when it walked into the boss room (lib/game-log.ts). `earned`: its own
   * correct answer reached bossThreshold (answerQuestion), not the host, an open door or an event room (⚡ 閃電突擊). */
  bossAt?: { round: number; turns: number; earned?: true };
  /** 逃跑 put a new monster in this team's room (catalog id); dropped when the team leaves the room. */
  swappedMonsterId?: string;
  /** Wrong answers this team fled from, boss room too (🏃 逃跑大師, podium-titles.md). Absent until the first. */
  flees?: number;
  /** The room question this team answered wrong on and stayed (重答): splitShared moves the other team off it first.
   * Cleared once the team leaves it, so a later deal of the same id starts without it. Absent until the first. */
  wrongOn?: string;
  /** The event behind the ❓ door, only inside chooseFork: drawn on the press and opened at once (docs/designs/branch-fork.md).
   * A save from before the fork has one standing; parseSnapshot turns it into a fork. */
  event?: RoomEvent;
  /** 叉路 (docs/designs/branch-fork.md): at a fork, choosing its door, or in the room it chose ⚔️ for. Absent otherwise. */
  fork?: Fork;
  /** Every door this team took at a fork, in order, for lib/game-log.ts. Absent until the first. */
  forks?: ForkRecord[];
  /** Every fortune this team drew (docs/designs/fortune-teller.md), for the podium and lib/game-log.ts. Absent until the first. */
  fortunes?: FortuneRecord[];
  /** 💫 暈眩 (fortune-teller.md): this team loses its next turn, or sits out the next buzz question, whichever comes first. */
  stunned?: true;
  /** A curse or blessing waiting for this team's next correct answer (event-rooms.md D12). */
  boon?: Boon;
  /** Every event outcome this team opened, in order, for lib/game-log.ts. Absent until the first. */
  events?: EventOutcome[];
  /** The one item the team holds (docs/designs/lucky-potion.md): given by the host, spent by the team. Not a boon. */
  item?: Item;
  /** The question id the potion was drunk on (E1), and the team's `turns` then: armed only on that question in that
   * turn, so a retry next round or the same id dealt again later finds it held, not armed (/review). */
  itemArmedFor?: string;
  itemArmedTurn?: number;
  /** Potions the host gave and the team drank, for lib/game-log.ts (lucky-potion.md E8). Absent until the first. */
  potionsGiven?: number;
  potionsDrunk?: number;
  /** The host's 修正 presses on this team, in order (hostFix), for lib/game-log.ts. Absent until the first. */
  fixes?: FixRecord[];
  /** Let in mid-game with the last-place team's score (docs/designs/late-join.md): its boss entry is never `earned`,
   * so the few turns it took win no ⚡ 閃電突擊. */
  late?: true;
  /** 抓包與神諭 (docs/designs/anti-ai-cheating.md): uses left, given once (absent until the switch first met this team). */
  oracleLeft?: number;
  catchesLeft?: number;
  /** The question this team asked the oracle about: it halves and cannot be caught only while it is still the team's
   * current room question (oracleActive). */
  oracleQ?: string;
  /** For lib/game-log.ts: oracles used, and this team's catches filed / upheld / dismissed / cancelled. */
  oracles?: number;
  catchesFiled?: number;
  catchesUpheld?: number;
  catchesDismissed?: number;
  catchesCancelled?: number;
}

/** 抓包與神諭's switch and the open catch (docs/designs/anti-ai-cheating.md). */
export interface AntiCheatState {
  on: boolean;
  /** Times the host switched it on, for lib/game-log.ts. */
  onCount: number;
  /** A catch waiting for the host's ruling: `by` reported `teamId` on `questionId`. */
  openCatch?: { by: string; teamId: string; questionId: string };
  /** `${teamId}:${questionId}:${turns}` of the last catch filed: one catch per question-turn. */
  caughtTurn?: string;
  /** Times the host took a ruling back (撤回裁決): the big screen shows its notice when this goes up. */
  undone?: number;
}

/** Uses each team gets once (anti-ai-cheating.md). */
export const ORACLE_USES = 1;
export const CATCH_USES = 2;
/** 成立: the reporter gains, the caught team loses. 冤枉: the reporter loses, the accused gains when it holds a potion. */
export const CATCH_PAY = { bounty: 15, caught: 10, falseReport: 10, wronged: 10 } as const;

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
  /** The question type (questionType: 聽歌, 卡點…) `picker` or the host chose; this question was drawn from it (#321). */
  qtype?: string;
  /** The host chose this question, by type or itself (#321): the winner's pick is over. */
  hostPicked?: true;
  /** A timing question's taps (docs/designs/timing-tap.md), in the order the room took them: song time in ms. Never on STATE. */
  taps?: { teamId: string; ms: number }[];
  /** Goes up on each ⟲ 從頭 of a timing question: a tap for an older round is stale. Absent reads as 0. */
  tapRound?: number;
  /** Every online boss-room team was 💫 stunned at some point while this round was open, so none sits it out until the
   * round ends: a team coming back does not take the stunned teams' taps away (timing-tap.md). Cleared by ⟲ and a new
   * question. Set by latchStun on any open buzz and by a stunned team's tap (tapIn), but only stunLifted reads it, for
   * timing questions (tapEligible and the phone's tap button); buzzIn clears the stun flags on the press instead. */
  allStunned?: true;
  /** A music question with fields (#369): each team's verdicts that were right on some fields but not all, in the order
   * judged. Such a team is out like a wrong buzz; once two rounds pass with nobody all right, the most right fields score. */
  partials?: { teamId: string; marks: boolean[] }[];
  /** A music question with fields (#369): every team was out once, so this is the second and last round. */
  second?: true;
}

export interface GameConfig {
  /** Score that lets the first team into the boss room: one of BOSS_THRESHOLDS, picked in the lobby (default 15). */
  bossThreshold: number;
  /** 首領題隨機順序 (lobby): each boss phase's questions shuffled within one difficulty. Absent keeps the bank order. */
  bossShuffle?: true;
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
  /** A mage's public hint, per question id: a fill-in answer's first letter or number, a sort question's first item, or
   * what mageHintKinds says it is. */
  mageHints?: Record<string, string>;
  /** A hint that is not the first character or item (class dice): the letter count, or the whole answer or order. */
  mageHintKinds?: Record<string, MageHintKind>;
  /** Per checkKey(questionId, teamId): that mage team cast there (a die that landed, whatever its tier), so not again
   * (rules 「一題一次」). */
  mageCasts?: Record<string, true>;
  /** Boss question difficulties below 5, per question id, from the bank at game start (absent: 5). */
  bossDifficulties?: Record<string, Difficulty>;
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
  /** This game's boss (gameMonsters: drawn, or the bank's own). Absent in saves from before persuasion gifts: the bank's own boss. */
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
  /** 占卜師 (docs/designs/fortune-teller.md): from the ❓ door until the host's 下一題 after the effect card. */
  fortune?: FortuneState;
  /** Teams a 💫 stun just skipped, for the room to say once and clear (fortune-teller.md Narration). */
  stunSkipped?: string[];
  /** 抓包與神諭 (docs/designs/anti-ai-cheating.md). Absent: switched off, as in every save from before it. */
  antiCheat?: AntiCheatState;
  /** Every applied judgment in order, for 改判 (docs/hosting.md). Host-only: STATE never carries it. */
  judgments?: Judgment[];
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
  /** The prayer die is still rolling (set by pray, gone once it lands): a restart in that beat restores a failed prayer. */
  praying?: true;
  /** The cleric's prayer die came up 1–6 (class dice): no prayer this turn, and its 重答 / 逃跑 ends the turn. */
  prayFailed?: true;
}

/** A mage hint that is not the first character or item: "count" (the answer's letter count), "whole" (the whole answer,
 * or a sort question's whole order joined by " → "). */
export type MageHintKind = "count" | "whole";

/** A natural 20 or 1 behind a correct answer: the dish die (`dish`), a class die's 20 (a warrior's roll or the thief's
 * sneak die, `crit`), or the question's persuasion check (a 20 won it outright, a 1 halved it). Narration and the cue use it. */
export type RollMark = { kind: "dish" | "crit" | "check"; value: 20 | 1 };

export type AnswerOutcome =
  /** `reward` is the whole gain; `dishBonus` the dish die's share of it (negative on a 1), absent when it changed nothing;
   * `dishDie` the dish die that landed, absent when none rolled. */
  /** `halvedFrom`: a halved answer's gain before the half (a persuasion 1, a curse, the oracle), for the phone's 「20 → 10 → 1」. */
  | { type: "correct-room-advance"; teamId: string; pointsAwarded: number; reward: number; dishBonus?: number; dishDie?: number; halvedFrom?: number; nextRoomIndex: number; entersBoss: boolean; roll?: RollMark }
  | { type: "correct-boss-hit"; teamId: string; bossHpRemaining: number; bossKilled: boolean; reward: number; dishBonus?: number; dishDie?: number; killBonus?: number; roll?: RollMark }
  /** `switchedTo`: 逃跑's new monster (catalog id). */
  | { type: "incorrect-flee"; teamId: string; newDifficulty: Difficulty; switchedTo?: string }
  /** `newBossQuestion`: a wrong boss answer rotated the shared question (boss redesign D2=B). */
  | { type: "incorrect-retry"; teamId: string; newBossQuestion?: true; penalty?: number };

export class InvalidActionError extends Error {}

/** After a wrong answer: 重答, or 逃跑 ("switch": a new monster, same room). "flee" keeps the monster: only 🚨 成立
 * (upholdCatch) uses it now; the boss room treats both alike. */
export type FleeChoice = "retry" | "flee" | "switch";

/** The monster this team faces in its room: 逃跑's, else the room's. */
export function teamMonsterId(game: GameState, team: Team): string | undefined {
  return team.swappedMonsterId ?? game.rooms[team.roomIndex]?.monsterId;
}

/** 逃跑's new monster: another room monster of this game at the same base difficulty, else any other room
 * monster in the catalog (the catalog has no tiers of its own). */
function switchMonster(game: GameState, team: Team, rng: () => number): string {
  const now = teamMonsterId(game, team);
  const tier = game.rooms[team.roomIndex].baseDifficulty;
  const same = [...new Set(game.rooms.filter((r) => r.baseDifficulty === tier && r.monsterId && r.monsterId !== now).map((r) => r.monsterId!))];
  const pool = same.length ? same : MONSTERS.filter((m) => !m.boss && m.id !== now).map((m) => m.id);
  return pool[Math.floor(rng() * pool.length)];
}

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

/** Deal an unseen question, preferring an undrawn one in the requested pool that no team holds.
 * Borrow from the nearest pool when necessary. A tiny bank may share an unseen question;
 * once every room question is revealed, an empty id tells the caller to enter the boss room.
 * `used` tracks draws within a shuffle; `revealed` permanently retires answers for this game. */
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
  pool = pool.filter((id) => !revealed.includes(id));
  if (!pool.length) pool = pools.flat().filter((id) => !revealed.includes(id));
  const questionId = pool[Math.floor(rng() * pool.length)] ?? "";
  // Recorded in the pool that holds it (a borrowed or own question belongs to another pool), once:
  // the fled-question fallback above picks from questions already in `used`. This pool's reshuffle
  // only counts when the question came from it.
  const from = pools.findIndex((ids) => ids.includes(questionId));
  return { questionId, used: (all.includes(questionId) ? base : used).map((u, i) => (i === from && !u.includes(questionId) ? [...u, questionId] : u)) };
}

/** A question marked by a hint and later by its judgment is listed only once. */
function withRevealed(revealed: string[], id: string): string[] {
  return revealed.includes(id) ? revealed : [...revealed, id];
}

/** Walk the boss question ring past revealed answers. The fallback is only an exhausted
 * phase's retained question: callers advance the phase or finish before accepting another answer. */
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

/**
 * A bank with fewer questions than teams can leave two teams on one room question (deal()); then one team's
 * correct answer shows the other its answer. Whenever a question may have come free (a team answered, fled,
 * opened an event or went to the boss room), move one team of each shared question to a free, unrevealed one.
 * A revealed one would hand over a known answer, so then they stay together. In a bank big enough nobody
 * shares, so this changes nothing there (and draws no rng).
 * Never moved: the team on turn (it may be mid-answer; the screen and phones show only its question, so a
 * move of anyone else shows up on that team's next turn), counted both ways: the team at currentTurnIndex even
 * offline (its lock or roll may be in its beat, or it just answered) and the team currentTurnTeamId names. Nor a
 * wrong lock or typed answer waiting for its choice or judgment (it would land on a question the team no longer
 * faces). A team at a fork may move: its question shows on no screen until it picks ⚔️, and stays at the fork.
 * deal(), not dealFor(): the host's queued pick waits for the team's next room.
 */
function splitShared(game: GameState, rng: () => number): GameState {
  const keep = [game.turnOrder[game.currentTurnIndex], currentTurnTeamId(game)];
  for (;;) {
    const room = game.teams.filter((t) => !t.inBoss);
    const shared = (t: Team) => room.some((o) => o.id !== t.id && o.currentQuestionId === t.currentQuestionId);
    const movable = room.filter((t) => !keep.includes(t.id) && game.pendingWrong?.teamId !== t.id && t.typedAnswer === undefined && shared(t));
    // A team with no wrong answer on the question moves first: the other keeps the question it has worked on
    // and its red tiles. Then the later team in turn order, just a fixed rule both screens can predict (without
    // 擲先攻 it is also the team createGame dealt the repeat to; initiative reorders turnOrder after the deal).
    const rank = (t: Team) => (t.wrongOn === t.currentQuestionId ? 0 : game.turnOrder.length) + game.turnOrder.indexOf(t.id);
    movable.sort((a, b) => rank(b) - rank(a));
    let move: { t: Team; dealt: ReturnType<typeof deal> } | undefined;
    for (const t of movable) {
      const dealt = deal(game.pools, game.usedQuestionIds, game.revealedQuestionIds, game.teams, t.currentDifficulty, rng, t.currentQuestionId);
      if (dealt.questionId && !room.some((o) => o.currentQuestionId === dealt.questionId) && !game.revealedQuestionIds.includes(dealt.questionId)) {
        move = { t, dealt };
        break;
      }
    }
    if (!move) return game;
    const { t, dealt } = move;
    const checks = { ...game.checks };
    delete checks[checkKey(t.currentQuestionId, t.id)];
    game = {
      ...game,
      usedQuestionIds: dealt.used,
      ...(game.checks ? { checks } : {}),
      teams: patchTeam(game.teams, t.id, () => ({ currentQuestionId: dealt.questionId, currentSelection: null, wrongOn: undefined, oracleQ: undefined })),
    };
  }
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
/** The lobby's 進王門檻 choices: a lower one makes a game with many teams shorter. */
export const BOSS_THRESHOLDS = [10, 12, 15] as const;

export function isBossThreshold(v: unknown): v is number {
  return (BOSS_THRESHOLDS as readonly unknown[]).includes(v);
}

export function createGame(
  teamSeeds: { id: string; name: string; classId?: ClassId; look?: number }[],
  rooms: RoomTemplate[],
  pools: string[][],
  bossQuestionIds: string[],
  config: GameConfig,
  bossMaxHp: number,
  rng: () => number = Math.random,
  /** The bank's old flat hitReward: kept in the state and the game log only; a hit pays bossHitReward. */
  storedHitReward = DEFAULT_BOSS_HIT_REWARD,
  optionOrder: Record<string, number[]> = {},
  /** Phases after the first, which is `bossQuestionIds` and `bossMaxHp`. */
  laterBossPhases: BossPhaseState[] = [],
  bossDish?: string,
  /** Answers an earlier game in this room showed (回到大廳, back-to-lobby): dealt last, once nothing else is left; in a boss
   * phase, last within their difficulty (the owner chose difficulty over freshness). */
  played: string[] = [],
  /** Boss questions not at the default difficulty (bossDifficulties in lib/question-bank.ts): each phase deals easiest first. */
  bossDifficulties: Record<string, Difficulty> = {},
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
  // Easiest first; within one difficulty, an answer the last game showed goes last (a stable sort keeps freshFirst's order).
  const difficulty = (id: string) => (Object.hasOwn(bossDifficulties, id) ? bossDifficulties[id] : DEFAULT_BOSS_DIFFICULTY);
  // Shuffled before the stable sort, so 首領題隨機順序 moves questions only within their difficulty. Off draws no rng.
  const shuffled = (ids: string[]) => {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) {
      const j = pickIndex(rng, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const bossOrder = (ids: string[]) => freshFirst(config.bossShuffle ? shuffled(ids) : ids).sort((a, b) => difficulty(a) - difficulty(b));
  bossQuestionIds = bossOrder(bossQuestionIds);
  laterBossPhases = laterBossPhases.map((p) => ({ ...p, questionIds: bossOrder(p.questionIds) }));
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
      ...(seed.look !== undefined ? { look: seed.look } : {}),
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
      hitReward: storedHitReward,
      ...(bossDish ? { dish: bossDish } : {}),
      hp: bossMaxHp,
      killedByTeamId: null,
      currentQuestionId: bossQuestionIds[0],
      questionIds: bossQuestionIds,
      phases: [{ maxHp: bossMaxHp, questionIds: bossQuestionIds }, ...laterBossPhases],
      phaseIndex: 0,
    },
    ...(Object.keys(bossDifficulties).length ? { bossDifficulties } : {}),
    // Drawn last, so the deals above see the same rng values as before the catalog.
    variantSeed: Math.floor(rng() * 2 ** 32),
    config,
    phase: "playing",
    winners: [],
  };
}

/** A late team may still be let in (docs/designs/late-join.md): the game is being played and no team is in the boss room. */
export function lateJoinOpen(game: GameState): boolean {
  return game.phase === "playing" && !game.teams.some((t) => t.inBoss);
}

/** The host lets a team in mid-game (docs/designs/late-join.md): room 1, last in turnOrder, and level with the team in
 * last place on both counts (reward decides the winner, score the boss door). No 擲先攻 for it. */
export function addLateTeam(game: GameState, seed: { id: string; name: string; classId?: ClassId; look?: number }, rng: () => number = Math.random): GameState {
  if (!lateJoinOpen(game)) throw new InvalidActionError("late_closed");
  if (game.teams.some((t) => t.id === seed.id)) throw new InvalidActionError("already_in_game");
  const room = game.rooms[0];
  const dealt = deal(game.pools, game.usedQuestionIds, game.revealedQuestionIds, game.teams, room.baseDifficulty, rng);
  // Every room question has been shown: nothing is left to deal a newcomer (#366).
  if (!dealt.questionId) throw new InvalidActionError("late_closed");
  const team: Team = {
    id: seed.id,
    name: seed.name,
    online: true,
    score: Math.min(...game.teams.map((t) => t.score)),
    reward: Math.min(...game.teams.map((t) => t.reward)),
    roomIndex: 0,
    metDefeats: (room.monsterId && game.defeats?.[room.monsterId]) || 0,
    currentDifficulty: room.baseDifficulty,
    currentQuestionId: dealt.questionId,
    currentSelection: null,
    inBoss: false,
    ...(seed.classId ? { classId: seed.classId } : {}),
    ...(seed.look !== undefined ? { look: seed.look } : {}),
    abilityUses: abilityUsesFor(seed.classId),
    late: true,
    // Let in while 抓包與神諭 is on: its uses now, as every team got them at the switch (anti-ai-cheating.md).
    ...(game.antiCheat?.on ? { oracleLeft: ORACLE_USES, catchesLeft: CATCH_USES } : {}),
  };
  return { ...game, teams: [...game.teams, team], turnOrder: [...game.turnOrder, seed.id], usedQuestionIds: dealt.used };
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
  const pulledAll = phase.buzzer ? game.teams.reduce<GameState>((g, t) => (t.inBoss ? g : sendToBoss(g, t.id)), { ...game, pendingWrong: null }) : game;
  // Every room team walks into the boss room here, so a split sendToBoss made on the way dealt nothing that stays in play.
  const pulled = { ...pulledAll, usedQuestionIds: game.usedQuestionIds };
  // The old phase's question leaves play, so its wrong tiles go with it.
  const cleared = dropEliminated(pulled, boss.currentQuestionId);
  // A 💫 stun the phase card held back (landTurn waits while it is pending) takes its turn now; a buzzer phase keeps it.
  return landTurn({
    ...pulled,
    ...cleared,
    buzz: undefined,
    // A buzzer phase has no abilities (D6): a sneak armed in the phase before is given back, as sendToBoss does.
    teams: resetBossSelections(phase.buzzer ? pulled.teams.map((t) => (t.sneakArmed ? { ...t, sneakArmed: undefined, sneakCrit: undefined, abilityUses: t.abilityUses + 1 } : t)) : pulled.teams),
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
  });
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

/** The buzz as every screen sees it: a timing question's taps stay in the room until the reveal (timing-tap.md). */
function withoutTaps(buzz: BuzzState): Omit<BuzzState, "taps"> {
  const shown = { ...buzz };
  delete shown.taps;
  return shown;
}

/** The host pressed ▶ on the boss question's video: buzzing opens (D5). A no-op outside a buzzer phase. `timing`: a
 * timing question, whose stunned phones are grey, so when every online boss-room team is stunned they all clear now
 * (buzzIn clears them on the press instead; timing-tap.md). */
export function openBuzz(game: GameState, questionId: string, timing = false): GameState {
  if (!isBuzzPhase(game) || questionId !== game.boss.currentQuestionId) return game;
  const buzz = currentBuzz(game);
  if (buzz.open) return game;
  const clear = timing && allStunned(game.teams, (t) => t.inBoss);
  return { ...game, ...(clear ? { teams: unstun(game.teams, (t) => !!t.inBoss) } : {}), buzz: { ...buzz, open: true } };
}

/** There is an online boss-room team and every one is 💫 stunned: then nobody sits the buzz question out (R5). Pure and
 * BANK-free, so the phone (`inBoss` reads its view's inBossPhase) and the server share it. */
export function allStunned<T extends { online: boolean; stunned?: true }>(teams: readonly T[], inBoss: (t: T) => boolean): boolean {
  const room = teams.filter((t) => t.online && inBoss(t));
  return room.length > 0 && room.every((t) => t.stunned);
}

/** A stunned team may tap on this timing round: every online boss-room team is stunned now, or was once this round
 * (`buzz.allStunned`). The one rule for tapEligible and the phone's tap button. */
export function stunLifted<T extends { online: boolean; stunned?: true }>(buzz: { allStunned?: true } | undefined, teams: readonly T[], inBoss: (t: T) => boolean): boolean {
  return !!buzz?.allStunned || allStunned(teams, inBoss);
}

/** Who may tap on a timing question now (timing-tap.md): online, in the boss room, not 💫 stunned, unless stunLifted
 * (every online boss-room team is or was stunned this round: the question came round as itself, so openBuzz did not
 * clear them, or the one team that was not dropped). The one rule for tapping, the early close and the host's
 * denominator; the phone uses stunLifted too. */
export const tapEligible = (game: GameState, teamId: string): boolean => {
  const t = game.teams.find((x) => x.id === teamId);
  return !!t && t.online && t.inBoss && (!t.stunned || stunLifted(currentBuzz(game), game.teams, (x) => x.inBoss));
};

/** Why `teamId` may not tap on `questionId` in `round` now, as the room's refusal code; throws InvalidActionError. */
export function assertCanTap(game: GameState, teamId: string, questionId: string, round: number): void {
  if (!isBuzzPhase(game)) throw new InvalidActionError("tap_closed");
  const buzz = currentBuzz(game);
  if (questionId !== game.boss.currentQuestionId || round !== (buzz.tapRound ?? 0)) throw new InvalidActionError("stale_question");
  if (!buzz.open || buzz.teamId) throw new InvalidActionError("tap_closed");
  if (buzz.taps?.some((t) => t.teamId === teamId)) throw new InvalidActionError("tap_taken");
  const team = getTeam(game, teamId);
  if (!team.online || !team.inBoss) throw new InvalidActionError("cannot_tap");
  if (!tapEligible(game, teamId)) throw new InvalidActionError("stunned");
}

/** `teamId` taps at song time `ms` (timing-tap.md). Checks assertCanTap again; the room converts the time first. */
export function tapIn(game: GameState, teamId: string, questionId: string, round: number, ms: number): GameState {
  assertCanTap(game, teamId, questionId, round);
  const buzz = currentBuzz(game);
  // A stunned team's tap is taken only under stunLifted: latch the round, so a team coming back later (even into a
  // room every team had left, which latchStun skips) never makes the room drop a tap it already acknowledged.
  const latch = getTeam(game, teamId).stunned ? { allStunned: true as const } : {};
  return { ...game, buzz: { ...buzz, taps: [...(buzz.taps ?? []), { teamId, ms }], ...latch } };
}

/** Every team that may tap has, and there is one: the round may close early (timing-tap.md). */
export function allTapped(game: GameState): boolean {
  const taps = currentBuzz(game).taps ?? [];
  const eligible = game.teams.filter((t) => tapEligible(game, t.id));
  return eligible.length > 0 && eligible.every((t) => taps.some((x) => x.teamId === t.id));
}

/** ⟲ 從頭 on a timing question: the song's clock changed, so its taps go and its round goes up (timing-tap.md). The
 * all-stunned latch starts over too: set again at once if every online boss-room team is still stunned. */
export function restartTaps(game: GameState): GameState {
  if (!isBuzzPhase(game)) return game;
  const buzz = currentBuzz(game);
  return latchStun({ ...game, buzz: { ...buzz, taps: undefined, allStunned: undefined, tapRound: (buzz.tapRound ?? 0) + 1 } });
}

/** A closed timing round with taps: the closest team becomes the one answering (HOST_JUDGE's judge then scores it as
 * a hit), and the other teams' small bonuses go on their reward (timing-tap.md). The room judges right after. */
export function tapWinner(game: GameState, winnerId: string, bonuses: Record<string, number>): GameState {
  const buzz = currentBuzz(game);
  const teams = game.teams.map((t) => (bonuses[t.id] ? { ...t, reward: t.reward + bonuses[t.id] } : t));
  return { ...game, teams, buzz: { ...buzz, teamId: winnerId }, currentTurnIndex: game.turnOrder.indexOf(winnerId) };
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
  // 💫 sits out this buzz question (R5), unless every online team in the boss room is stunned: then all flags clear.
  let teams = game.teams;
  if (team.stunned) {
    if (!allStunned(game.teams, (t) => t.inBoss)) throw new InvalidActionError("stunned");
    teams = unstun(teams, (t) => !!t.inBoss);
  }
  return { ...game, teams, buzz: { ...buzz, teamId }, currentTurnIndex: game.turnOrder.indexOf(teamId) };
}

/** Every online boss-room team is out of this buzz question (a stunned team sits it out, R5). */
function everyoneOut(game: GameState, out: readonly string[]): boolean {
  return game.teams.every((t) => !t.online || !t.inBoss || out.includes(t.id) || t.stunned);
}

/** #369: the host's verdicts (`marks`, not all right) on the buzzing team's music question with fields end the second
 * round: the online team with the most right fields over both rounds scores them, the one judged first on a tie. Returns
 * the game with the buzz handed to that team (answerQuestion then judges it right with `marks`), or null: the round goes
 * on, or nobody got any field. */
export function settleBuzz(game: GameState, teamId: string, marks: boolean[]): { game: GameState; teamId: string; marks: boolean[] } | null {
  const buzz = game.buzz;
  if (!isBuzzPhase(game) || buzz?.teamId !== teamId || buzz.questionId !== game.boss.currentQuestionId || !buzz.second || marks.every(Boolean)) return null;
  if (!everyoneOut(game, [...buzz.out, teamId])) return null;
  const right = (m: boolean[]) => m.filter(Boolean).length;
  const partials = right(marks) > 0 ? [...(buzz.partials ?? []), { teamId, marks }] : (buzz.partials ?? []);
  const best = partials
    .filter((p) => right(p.marks) > 0 && game.teams.some((t) => t.id === p.teamId && t.online && t.inBoss))
    .reduce<{ teamId: string; marks: boolean[] } | null>((a, p) => (!a || right(p.marks) > right(a.marks) ? p : a), null);
  if (!best) return null;
  const teams = patchTeam(game.teams, teamId, () => ({ typedAnswer: undefined, typedFields: undefined }));
  // The judged team is out with its verdicts kept, so judging the winner again (a restart during a kill's 4d20) settles the same way.
  const handed = { ...buzz, teamId: best.teamId, out: [...buzz.out, teamId], partials };
  return { game: { ...game, teams, buzz: handed, currentTurnIndex: game.turnOrder.indexOf(best.teamId) }, teamId: best.teamId, marks: best.marks };
}

/** The buzz once the boss question moved on: none for a new question; the same one (the phase's last unrevealed
 * question came round again) starts over, everyone in, still open if its music was (adversarial review). */
function rotatedBuzz(game: GameState, nextQuestionId: string): BuzzState | undefined {
  if (nextQuestionId !== game.boss.currentQuestionId) return undefined;
  const buzz = currentBuzz(game);
  // A timing question coming round as itself is a new round: a phone's ack for the old one must not grey it (timing-tap.md).
  const round = buzz.taps || buzz.tapRound !== undefined ? { tapRound: (buzz.tapRound ?? 0) + 1 } : {};
  // Back open with every online boss-room team still stunned (▶ will not clear them): latched from the start (timing-tap.md).
  const latched = buzz.open && allStunned(game.teams, (t) => t.inBoss) ? { allStunned: true as const } : {};
  return { questionId: nextQuestionId, ...(buzz.open ? { open: true as const } : {}), out: [], ...round, ...latched };
}

/** Sets the round's all-stunned latch (BuzzState.allStunned) when every online boss-room team is stunned on an open
 * round. Mid-round that starts only with the last unstunned team dropping (setTeamOnline), a ⟲ (restartTaps) or the
 * question coming round as itself (rotatedBuzz). A stunned team reconnecting into an empty room is not latched: every
 * team offline is a restore or a network outage, and the teams coming back must not latch an order nobody chose; a tap
 * taken in that window latches the round in tapIn instead. */
function latchStun(game: GameState): GameState {
  const b = game.buzz;
  if (!isBuzzPhase(game) || !b?.open || b.allStunned || b.questionId !== game.boss.currentQuestionId || !allStunned(game.teams, (t) => t.inBoss)) return game;
  return { ...game, buzz: { ...b, allStunned: true } };
}

/** Whether the next question may still be picked: a buzzer phase, buzzing not open yet (`open`: the room's call, as
 * in buzzIn) and nobody holding the buzz. */
function pickDue(game: GameState, open: boolean): boolean {
  if (!isBuzzPhase(game)) return false;
  const buzz = currentBuzz(game);
  return !open && !buzz.open && !buzz.teamId;
}

/** The categories a buzz winner may pick for the next question: those of the phase's unrevealed questions, in phase
 * order (random each game under 首領題隨機順序). `categoryOf` maps a question id to its bank category (the room's, from the bank). Empty when no pick is due. */
export function pickableCategories(game: GameState, categoryOf: Record<string, string | undefined>, open: boolean): string[] {
  const buzz = currentBuzz(game);
  if (!pickDue(game, open) || !buzz.picker || buzz.hostPicked) return [];
  const found = game.boss.questionIds.filter((id) => !game.revealedQuestionIds.includes(id)).map((id) => categoryOf[id]);
  return [...new Set(found.filter((c): c is string => !!c))];
}

/** The question types of the phase, in phase order, `left` false once all of that type are revealed (#321: shown greyed).
 * `typeOf` maps a question id to its questionType. Empty when no pick is due or no type has a question left. Offered
 * to the host even without a winner. */
export function pickableTypes(game: GameState, typeOf: Record<string, string | undefined>, open: boolean): { type: string; left: boolean }[] {
  if (!pickDue(game, open)) return [];
  const ids = game.boss.questionIds;
  const types = [...new Set(ids.map((id) => typeOf[id]).filter((t): t is string => !!t))];
  const list = types.map((type) => ({ type, left: ids.some((id) => typeOf[id] === type && !game.revealedQuestionIds.includes(id)) }));
  return list.some((t) => t.left) ? list : [];
}

/** Makes `id` the boss question for a pick, with `buzz` (the pick's fields). The question the host queued
 * (指定下一題) plays now, so its queue entry is used up. */
function pickQuestion(game: GameState, id: string, buzz: BuzzState): GameState {
  const queuedQuestionId = game.boss.queuedQuestionId === id ? undefined : game.boss.queuedQuestionId;
  return { ...game, boss: { ...game.boss, currentQuestionId: id, queuedQuestionId }, buzz: { ...buzz, questionId: id } };
}

/** The current buzz without its earlier pick: the latest pick wins. */
function unpicked(buzz: BuzzState): BuzzState {
  const rest = { ...buzz };
  delete rest.category;
  delete rest.qtype;
  return rest;
}

/** The buzz winner (`teamId`, by category since #370), or the host (null, by type, #321), picks the next question: the
 * boss question becomes the current one if it matches, else the next unrevealed one in the ring that does. The
 * winner may change its mind until buzzing opens, unless the host has picked; the host may pick any time before
 * (`open`: the room's call, as in buzzIn). Nobody has heard the question it replaces. */
export function pickNextQuestion(game: GameState, teamId: string | null, by: "category" | "qtype", value: string, of: Record<string, string | undefined>, open: boolean): GameState {
  if (!isBuzzPhase(game)) throw new InvalidActionError("not_buzzer_phase");
  const buzz = currentBuzz(game);
  if (teamId !== null && (buzz.picker !== teamId || buzz.hostPicked)) throw new InvalidActionError("not_picker");
  if (!pickDue(game, open)) throw new InvalidActionError("too_late");
  const { questionIds, currentQuestionId } = game.boss;
  const start = questionIds.indexOf(currentQuestionId);
  const ring = questionIds.map((_, i) => questionIds[(start + i) % questionIds.length]);
  const id = ring.find((q) => of[q] === value && !game.revealedQuestionIds.includes(q));
  if (!id) throw new InvalidActionError(by === "qtype" ? "no_such_type" : "no_such_category");
  return pickQuestion(game, id, { ...unpicked(buzz), [by]: value, ...(teamId === null ? { hostPicked: true as const } : {}) });
}

/** The buzz winner picks the next question's category (boss-music-buzzer.md M5). */
export function pickCategory(game: GameState, teamId: string, category: string, categoryOf: Record<string, string | undefined>, open: boolean): GameState {
  return pickNextQuestion(game, teamId, "category", category, categoryOf, open);
}

/** The host sets the next boss question itself (#321), until buzzing opens: an unrevealed question of the phase. */
export function hostPickBuzzQuestion(game: GameState, questionId: string, open: boolean): GameState {
  if (!isBuzzPhase(game)) throw new InvalidActionError("not_buzzer_phase");
  if (!pickDue(game, open)) throw new InvalidActionError("too_late");
  if (!game.boss.questionIds.includes(questionId) || game.revealedQuestionIds.includes(questionId)) throw new InvalidActionError("no_such_question");
  return pickQuestion(game, questionId, { ...unpicked(currentBuzz(game)), hostPicked: true });
}

/** Move the shared boss question on. Explicit host skips retire its answer; automatic timing
 * rounds with no taps may rotate without revealing it. Exhaustion advances a phase or ends the game. */
export function skipBuzz(game: GameState, retire = false, rng: () => number = Math.random): GameState {
  if (!isBuzzPhase(game)) throw new InvalidActionError("not_buzzer_phase");
  if (game.buzz?.questionId === game.boss.currentQuestionId && game.buzz.teamId) throw new InvalidActionError("buzz_taken");
  const current = game.boss.currentQuestionId;
  let revealed = game.revealedQuestionIds;
  let rotated = rotateBoss(game.boss, revealed);
  if (retire) {
    revealed = withRevealed(revealed, current);
    if (phaseUsedUp(game.boss, revealed)) {
      // The phase card deals the next phase's question (enterNextBossPhase); the stunned teams' sit-out ends (R5).
      return { ...game, revealedQuestionIds: revealed, buzz: undefined, teams: resetBossSelections(unstun(game.teams, (t) => !!t.inBoss)), boss: { ...game.boss, phasePending: "exhausted" } };
    }
    if (game.boss.questionIds.every((id) => revealed.includes(id))) return finishGame({ ...game, revealedQuestionIds: revealed, buzz: undefined }, rng);
    rotated = rotateBoss(game.boss, revealed);
  }
  // A new question ends the stunned teams' sit-out (R5); the same one coming round again does not.
  const teams = rotated.currentQuestionId !== current ? unstun(game.teams, (t) => !!t.inBoss) : game.teams;
  return { ...game, revealedQuestionIds: revealed, buzz: rotatedBuzz(game, rotated.currentQuestionId), teams: resetBossSelections(teams), boss: { ...game.boss, ...rotated } };
}

/** Earlier exhausted phases advance; callers finish the game when the last phase is exhausted. */
function phaseUsedUp(boss: BossState, revealed: string[]): boolean {
  return boss.phaseIndex < boss.phases.length - 1 && boss.questionIds.every((id) => revealed.includes(id));
}

/** No class ability, check or prayer in a buzzer phase (D6): answers are spoken after a buzz. */
function assertNotBuzz(game: GameState) {
  if (isBuzzPhase(game)) throw new InvalidActionError("buzzer_phase");
}

/** The turn stays with its team until a game action or the host advances it. */
export function currentTurnTeamId(game: GameState): string | null {
  // A team deciding 重答 / 逃跑 keeps the turn even if its phone sleeps (phone-answering.md E9).
  if (game.pendingWrong) return game.pendingWrong.teamId;
  // So does a team caught asking an AI, until the host rules (anti-ai-cheating.md).
  if (game.antiCheat?.openCatch) return game.antiCheat.openCatch.teamId;
  // So does a team whose typed answer waits for the host: it puts the phone down after sending.
  const typed = game.teams.find((t) => t.typedAnswer !== undefined);
  if (typed) return typed.id;
  // So does a team choosing its door: its 15 seconds run on, and it may come back to pick (branch-fork.md).
  const choosing = game.teams.find((t) => t.fork?.phase === "choosing");
  if (choosing) return choosing.id;
  // And the team picking a fortune's effect, until it lands (fortune-teller.md).
  if (game.fortune && !game.fortune.effect) return game.fortune.teamId;
  const idx = nextTurnIndex(game, 0);
  // Only an empty order has no turn.
  return idx === null ? null : game.turnOrder[idx];
}

/** The team after the one on turn in turnOrder (including offline teams), or null in a buzzer
 * phase or with nobody on turn. A 💫 stunned team is passed over as landTurn passes it, unless every other one is. */
export function nextTurnTeamId(game: GameState): string | null {
  const now = isBuzzPhase(game) ? null : currentTurnTeamId(game);
  if (now === null) return null;
  const n = game.turnOrder.length;
  const at = game.turnOrder.indexOf(now);
  const candidates = Array.from({ length: n }, (_, i) => getTeam(game, game.turnOrder[(at + i + 1) % n]));
  return (candidates.find((t) => !t.stunned) ?? candidates[0])?.id ?? null;
}

/** The turn index `from` places ahead, regardless of phone connectivity. */
function nextTurnIndex(game: GameState, from: number): number | null {
  return game.turnOrder.length ? (game.currentTurnIndex + from) % game.turnOrder.length : null;
}

/** Advance once, applying stuns and avoiding the previous turn's room monster. */
export function advanceTurn(game: GameState, facedMonster?: string | null): GameState {
  const previous = game.teams.find((t) => t.id === currentTurnTeamId(game));
  const idx = nextTurnIndex(game, 1);
  if (idx === null) return game;
  const next = landTurn({ ...game, currentTurnIndex: idx });
  const team = next.teams.find((t) => t.id === currentTurnTeamId(next));
  // null: the previous team faced no monster (an event room).
  if (!previous || !team || previous.id === team.id || facedMonster === null || (previous.inBoss && !facedMonster) || team.inBoss) return next;
  const lastMonster = facedMonster ?? teamMonsterId(game, previous);
  if (!lastMonster || lastMonster !== teamMonsterId(next, team)) return next;
  // 下輪再答 comes back to the monster that asked it (#328 m3): only a team meeting its room's monster gets another one.
  if (team.wrongOn === team.currentQuestionId) return next;
  const monster = switchMonster(next, team, () => 0);
  return { ...next, teams: patchTeam(next.teams, team.id, () => ({ swappedMonsterId: monster, metDefeats: next.defeats?.[monster] ?? 0 })) };
}

/** Every 💫 flag cleared, or only those of teams `which` picks. */
function unstun(teams: Team[], which: (t: Team) => boolean = () => true): Team[] {
  return teams.map((t) => (t.stunned && which(t) ? { ...t, stunned: undefined } : t));
}

/** The turn lands on the first team at or after currentTurnIndex that is not 💫 stunned (fortune-teller.md G1):
 * each stunned team passed loses that turn, which counts for `round` and `lastTurnIndex` but adds no `turns`, and its
 * flag clears. Every team stunned: all flags clear, nobody is skipped. Never in a buzzer phase or with a boss
 * phase card pending (R5). */
function landTurn(game: GameState): GameState {
  if (isBuzzPhase(game) || game.boss.phasePending) return game;
  const teams = game.teams;
  if (!teams.some((t) => t.stunned)) return game;
  if (teams.every((t) => t.stunned)) return { ...game, teams: unstun(game.teams) };
  let g = game;
  const skipped: string[] = [];
  for (let idx = nextTurnIndex(g, 0); idx !== null; idx = nextTurnIndex(g, 1)) {
    const id = g.turnOrder[idx];
    if (!getTeam(g, id).stunned) {
      g = { ...g, currentTurnIndex: idx };
      break;
    }
    const round = (g.round ?? 1) + (g.lastTurnIndex !== undefined && idx <= g.lastTurnIndex ? 1 : 0);
    g = { ...g, currentTurnIndex: idx, round, lastTurnIndex: idx, teams: patchTeam(g.teams, id, () => ({ stunned: undefined })) };
    skipped.push(id);
  }
  return skipped.length ? { ...g, stunSkipped: [...(game.stunSkipped ?? []), ...skipped] } : g;
}

/** 結束冒險: the host ends a game still being played, ranked by the reward each team has now. */
export function endGame(game: GameState, rng: () => number = Math.random): GameState {
  if (game.phase === "finished") throw new InvalidActionError("Game already finished");
  return finishGame({ ...game, pendingWrong: null }, rng);
}

/** Ranks the teams, rolling d20s for ties on the podium, so exactly one team wins (podium-reveal.md D4). */
function finishGame(game: GameState, rng: () => number): GameState {
  // A catch never ruled is called off, the reporter's use given back (anti-ai-cheating.md).
  game = cancelCatch(game);
  const { ranking, tieRolls } = rankTeams(game.teams, () => rollD20(rng));
  // A fortune still running ends with the game (fortune-teller.md R11).
  return { ...game, phase: "finished", winners: ranking.slice(0, 1), ranking, tieRolls, fortune: undefined };
}

/** Adds the natural 20s (D5) and natural 1s (fortune-teller.md) among `dice` to a team's counts. */
function withNaturals(t: Team, dice: number[]): Partial<Team> {
  const twenties = dice.filter((v) => v === 20).length;
  const ones = dice.filter((v) => v === 1).length;
  return { ...(twenties ? { natural20s: (t.natural20s ?? 0) + twenties } : {}), ...(ones ? { natural1s: (t.natural1s ?? 0) + ones } : {}) };
}

/**
 * Resolve one answer attempt for `teamId`. Always advances the turn
 * afterwards (win or lose) — global round-robin never gives a bonus turn,
 * which is what keeps the 1/N pacing fair (see Architecture Review). The one
 * exception is a cleric's prayed wrong lock: its 重答 / 逃跑 keeps the turn, once a turn (prayerTurn).
 *
 * `fleeChoice` only matters when the answer is incorrect: "flee" downgrades
 * the room's difficulty and keeps the room index; "switch" does the same with a new monster
 * (the boss room treats it as "flee"); "retry" leaves the
 * team facing the exact same question again on their next turn.
 */
export function answerQuestion(
  game: GameState,
  teamId: string,
  questionId: string,
  correct: boolean,
  fleeChoice: FleeChoice = "retry",
  rng: () => number = Math.random,
  /** The dish die rolled after a correct turn-based answer (料理骰): it multiplies the question's whole reward, last. */
  dishDie?: number,
  /** The kill bonus's four d20, already shown by the room; rolled on `rng` when absent. */
  killDice?: number[],
  /** A music question's fields judged right out of how many (docs/designs/multi-field.md D2, E1): a correct boss hit
   * deals one HP per right field (the base HP of a plain hit), and its reward (not the kill's 4d20) is scaled by
   * right / total, rounded half up. On a wrong buzz, `marks` with any right field is kept for settleBuzz (#369). */
  fields?: { right: number; total: number; marks?: boolean[] },
  /** A warrior's missed roll: nothing was judged or shown, so a turn-based boss question stays (class-abilities.md). */
  warriorMiss = false,
  /** A warrior's d20 that stood in for the answer: its hit pays warriorShare, a 20 takes one more boss heart, and a 1
   * takes the question's whole reward away (never below 0). Correctness never changes it (owner, 2026-11-17). */
  warriorDie?: number,
): { game: GameState; outcome: AnswerOutcome } {
  assertPlaying(game);
  const me = game.teams.find((t) => t.id === teamId);
  // The thief's sneak die landed when 偷襲 was pressed (sneakRoll): armed on 7–19, `sneakCrit` on a 20.
  const sneakCrit = correct && !!me?.sneakArmed && !!me.sneakCrit;
  // A class die's 20 behind a correct answer (the sneak die or a warrior's roll) takes one more boss heart.
  const crit = correct && (sneakCrit || warriorDie === 20);
  // This team's persuasion check on this question: a natural 1 halves any success on it, a warrior's too (R3-7).
  const check = game.checks?.[checkKey(questionId, teamId)];
  // A natural 20 talked the monster aside (persuasion-gift): it lives, so the team eats what it shared, not the monster.
  const persuaded = correct && check?.value === 20 && !check.dropped;
  // An event's curse or blessing waits for the next correct answer (event-rooms.md D12): the curse halves like a natural-1
  // check (never twice), the blessing adds half the base.
  const boon = correct ? game.teams.find((t) => t.id === teamId)?.boon : undefined;
  // A question the team asked the oracle about halves the same way (anti-ai-cheating.md); never in the boss room.
  const halved = correct && (check?.value === 1 || boon === "curse" || oracleActive(game, teamId));
  const dishMark = correct && !isBuzzPhase(game) && (dishDie === 20 || dishDie === 1) ? dishDie : undefined;
  // A check's 20 or 1 names the answer first (persuaded, or halved), then a class die's 20; the dish die rides along in
  // the outcome's dishDie, so its look and line still show.
  const rollMark: { roll?: RollMark } =
    correct && (check?.value === 20 || check?.value === 1)
      ? { roll: { kind: "check", value: check.value } }
      : crit
        ? { roll: { kind: "crit", value: 20 } }
        : dishMark
          ? { roll: { kind: "dish", value: dishMark } }
          : {};
  const blessing = (base: number) => (boon === "blessing" ? Math.round(base * 0.5) : 0);
  // R5: the half is taken from the base reward, then the sneak raises it; a warrior's hit pays its die's share of it.
  const shareOf = (reward: number) => (warriorDie === undefined ? reward : Math.round(reward * warriorShare(warriorDie)));
  const baseOf = (reward: number) => shareOf(halved ? Math.round(reward * 0.5) : reward);

  const answeringTeam = getTeam(game, teamId);
  const revealedAtStart = game.revealedQuestionIds;
  const facedMonster = answeringTeam.inBoss ? undefined : teamMonsterId(game, answeringTeam);
  const activeTeamId = currentTurnTeamId(game);
  if (activeTeamId === null) {
    throw new InvalidActionError("No team available to take a turn");
  }
  if (activeTeamId !== teamId) {
    throw new InvalidActionError(
      `It is not ${teamId}'s turn (current turn: ${activeTeamId})`,
    );
  }

  // Before the patch below clears a correct answer's fork: a team at a fork has nothing to answer yet.
  if (atFork(getTeam(game, teamId))) throw new InvalidActionError("fork");
  if (correct && game.pendingWrong) {
    throw new InvalidActionError(`${teamId} already locked a wrong answer; only retry or flee is left`);
  }
  const prayed = !correct && game.pendingWrong?.prayed === true;
  // Any judgment uses up an armed Sneak Attack; only a correct one pays (D16): ×2 boss damage (3 hearts on a 20) and
  // ×1.5 reward (×2 on a 20).
  const sneak = getTeam(game, teamId).sneakArmed ? 2 : 1;
  const sneakPay = (reward: number) => (sneak === 2 ? Math.round(reward * (sneakCrit ? SNEAK_CRIT_MULTIPLIER : SNEAK_REWARD_MULTIPLIER)) : reward);
  // The dish die goes on the question's whole gain, last (eng review D2); never on a kill's 4d20 (`extra`), and not in a
  // buzzer phase.
  const chef = getTeam(game, teamId).classId === "chef";
  const withDish = (gain: number, extra = 0) => {
    const share = isBuzzPhase(game) ? 0 : dishShare(gain, dishDie, chef);
    return { reward: gain + share + extra, ...(share ? { dishBonus: share } : {}), ...(dishDie !== undefined && !isBuzzPhase(game) ? { dishDie } : {}) };
  };
  // This turn counts once, for lib/game-log.ts: a cleric's prayed wrong lock keeps the turn, so its answer after counts.
  const order = game.turnOrder.indexOf(teamId);
  const played = prayed ? {} : {
    round: (game.round ?? 1) + (game.lastTurnIndex !== undefined && order <= game.lastTurnIndex ? 1 : 0),
    lastTurnIndex: order,
  };
  // The choice resolves the pending wrong lock.
  game = { ...game, ...played, pendingWrong: null, teams: patchTeam(game.teams, teamId, (t) => ({ sneakArmed: undefined, sneakCrit: undefined, typedAnswer: undefined, typedFields: undefined, ...(correct ? { boon: undefined, fork: undefined } : {}), ...(prayed ? {} : { turns: (t.turns ?? 0) + 1 }), ...withNaturals(t, correct && dishDie !== undefined ? [dishDie] : []), ...(correct ? { correctAnswers: (t.correctAnswers ?? 0) + 1 } : fleeChoice === "retry" ? { wrongAnswers: (t.wrongAnswers ?? 0) + 1 } : {}) })) };
  // Leaving a question publishes its answer, so it can never be dealt again.
  const seenWrong = !correct && fleeChoice !== "retry";
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
    const usedUp = (revealed: string[]) => phaseUsedUp(boss, revealed);
    if (correct) {
      const hits = fields?.right ?? 1;
      const newHp = Math.max(0, boss.hp - hits * sneak - (crit ? 1 : 0));
      const bossKilled = newHp === 0 && lastPhase;
      // The finishing blow's 4d20 is always plain: no class die raises it (class-dice-rework.md).
      const kill = bossKilled ? (killDice ?? rollBossKillDice(rng)) : undefined;
      const killBonus = kill ? kill.reduce((a, b) => a + b, 0) : undefined;
      const hitReward = bossHitReward(game);
      const hit = sneakPay(baseOf(hitReward)) + blessing(hitReward);
      const gain = withDish(fields ? Math.round((hit * fields.right) / fields.total) : hit, killBonus ?? 0);
      const { reward } = gain;
      const teams = patchTeam(game.teams, teamId, (t) => ({ reward: t.reward + reward, ...(bossKilled ? ate(t, persuaded && game.bossMonsterId ? monsterById(game.bossMonsterId)?.gift.name : boss.dish) : {}), ...withNaturals(t, kill ?? []) }));

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
      // A correct buzz ends the question: the stunned teams' sit-out is over (R5).
      const settled = buzzing ? unstun(teams, (t) => !!t.inBoss) : teams;
      nextGame = {
        ...game,
        teams: stay ? settled : resetBossSelections(settled),
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
      // wrong option makes it revealed; the rotation skips every revealed one. Taking turns, a wrong answer with nothing
      // shown (a fill-in, or the host's stuck-row 下輪換題 for a team that never locked) reveals and rotates too; a warrior's missed roll and a cleric's prayed
      // retry, which answers again at once, keep it (class-abilities.md #106).
      const shownWrong = (game.eliminated[questionId]?.length ?? 0) > 0;
      const leaves = fleeChoice !== "retry" || shownWrong || (!buzzing && !warriorMiss && !prayed);
      const revealed = leaves ? withRevealed(game.revealedQuestionIds, questionId) : game.revealedQuestionIds;
      const phasePending = usedUp(revealed) ? ("exhausted" as const) : undefined;
      // A wrong buzz shuts this team out of the question (D4); once every online team is out, they all buzz on the same
      // question again (boss-music-buzzer.md M1): only the host's 換下一題 moves it on.
      const out = buzzing ? [...game.buzz!.out, teamId] : [];
      const allOut = buzzing && everyoneOut(game, out);
      // A music question with fields (#369): a part-right answer is kept for settleBuzz, and everyone out opens round 2.
      const partial = buzzing && fields?.marks && fields.right > 0 ? { partials: [...(game.buzz!.partials ?? []), { teamId, marks: fields.marks }] } : {};
      const second = buzzing && fields && allOut ? { second: true as const } : {};
      const rotated = !phasePending && (fleeChoice !== "retry" || shownWrong || (!buzzing && !warriorMiss && !prayed)) ? rotateBoss(boss, revealed) : { currentQuestionId: boss.currentQuestionId };
      const rotatedBossQuestionId = rotated.currentQuestionId;
      // Same shared-question reasoning as the correct-hit branch above: a rotation changes
      // the question for every team in boss phase, so every one of their picks resets —
      // unless it stayed on the same question (a one-question boss bank, a wrong buzz, a warrior's miss or a prayed retry), where picks still apply.
      const moved = rotatedBossQuestionId !== boss.currentQuestionId;
      // A new question or the phase's end is the end of this buzz question for the stunned teams (R5).
      const settled = buzzing && (moved || phasePending) ? unstun(game.teams, (t) => !!t.inBoss) : game.teams;
      nextGame = {
        ...game,
        revealedQuestionIds: revealed,
        teams: moved ? resetBossSelections(settled) : settled,
        boss: { ...boss, ...rotated, ...(phasePending ? { phasePending } : {}) },
        // Someone heard this question and buzzed: the last winner's pick is over (#362), even if the room pauses before buzzing reopens.
        ...(buzzing ? { buzz: { ...game.buzz!, teamId: undefined, picker: undefined, out: allOut ? [] : out, ...partial, ...second } } : {}),
      };
      outcome =
        fleeChoice !== "retry"
          ? { type: "incorrect-flee", teamId, newDifficulty: team.currentDifficulty }
          : { type: "incorrect-retry", teamId, ...(rotatedBossQuestionId !== boss.currentQuestionId ? { newBossQuestion: true as const } : {}) };
    }
  } else {
    if (correct) {
      // The question's own difficulty: an empty, fully held or fully revealed pool deals from another one (deal()).
      const pointsAwarded = game.pools.findIndex((ids) => ids.includes(questionId)) + 1 || team.currentDifficulty;
      const base = game.rooms[team.roomIndex].reward;
      const gain = withDish(sneakPay(baseOf(base)) + blessing(base));
      const { reward } = gain;
      // A correct answer is always revealed (D5), so the next deal from any pool must not hand it
      // back to a team who hasn't faced it yet.
      const revealedQuestionIds = withRevealed(game.revealedQuestionIds, questionId);
      const reached = team.score + pointsAwarded >= game.config.bossThreshold;
      const earned = reached && !team.late;
      const entersBoss = reached || game.teams.some((t) => t.inBoss);
      // A team walking into the boss room stays at its room: no next-room question is dealt (it would burn one).
      const nextRoomIndex = entersBoss ? team.roomIndex : Math.min(team.roomIndex + 1, game.rooms.length - 1);
      // Its queued pick goes with it: the boss room has its own.
      const dealt = entersBoss
        ? { questionId: team.currentQuestionId, used: game.usedQuestionIds, queuedQuestionId: undefined }
        : dealFor(game, team, game.rooms[nextRoomIndex].baseDifficulty, revealedQuestionIds, rng, questionId);
      const monsterId = teamMonsterId(game, team);
      // A persuaded monster stepped aside, it was not defeated (#340): no variant look, no defeat count.
      const defeats = monsterId && !persuaded ? { ...game.defeats, [monsterId]: (game.defeats?.[monsterId] ?? 0) + 1 } : game.defeats;
      const nextMonsterId = game.rooms[nextRoomIndex].monsterId;
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        revealedQuestionIds,
        ...(defeats ? { defeats } : {}),
        teams: patchTeam(game.teams, teamId, (t) => ({
          score: t.score + pointsAwarded,
          reward: t.reward + reward,
          ...ate(t, persuaded && monsterId ? monsterById(monsterId)?.gift.name : team.swappedMonsterId ? monsterById(team.swappedMonsterId)?.dish.name : game.rooms[team.roomIndex].dish),
          roomIndex: nextRoomIndex,
          swappedMonsterId: undefined,
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
      outcome = { type: "correct-room-advance", teamId, pointsAwarded, ...gain, ...(halved ? { halvedFrom: sneakPay(shareOf(base)) + blessing(base) } : {}), nextRoomIndex, entersBoss, ...rollMark };
    } else if (fleeChoice !== "retry") {
      const newDifficulty = Math.max(MIN_DIFFICULTY, team.currentDifficulty - 1) as Difficulty;
      const switchedTo = fleeChoice === "switch" ? switchMonster(game, team, rng) : undefined;
      // Fleeing reveals the answer only after a wrong lock (revealedOnFlee); otherwise only skip
      // already-revealed questions from prior correct answers.
      const dealt = dealFor(game, team, newDifficulty, revealedOnFlee, rng, team.currentQuestionId);
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        revealedQuestionIds: revealedOnFlee,
        teams: patchTeam(game.teams, teamId, () => ({
          currentDifficulty: newDifficulty,
          currentQuestionId: dealt.questionId,
          currentSelection: null,
          queuedQuestionId: dealt.queuedQuestionId,
          // The new monster's look as it stands now, as on walking into a room (monster-catalog.md §3).
          ...(switchedTo ? { swappedMonsterId: switchedTo, metDefeats: game.defeats?.[switchedTo] ?? 0 } : {}),
        })),
      };
      outcome = { type: "incorrect-flee", teamId, newDifficulty, ...(switchedTo ? { switchedTo } : {}) };
    } else {
      // Retry: same room, same question, waits for this team's next turn.
      nextGame = { ...nextGame, teams: patchTeam(nextGame.teams, teamId, () => ({ wrongOn: questionId })) };
      outcome = { type: "incorrect-retry", teamId };
    }
  }

  // A warrior's 1 takes the question's whole reward (class dice): the room's, or the boss's hit; never below 0.
  if (!correct && warriorDie === 1) {
    const taken = deduct(nextGame, teamId, questionReward(game, teamId));
    nextGame = taken.game;
    if (taken.penalty > 0 && outcome.type === "incorrect-retry") outcome = { ...outcome, penalty: taken.penalty };
  }
  // Eliminated options and a mage's hint belong to a question still in play: once it leaves (answered, fled, rotated)
  // a later deal of it starts clean.
  // Any team: a room short of questions can deal one question to two teams at once.
  // A team that fled and was dealt the same question again (a room with one question left) faces it afresh, not still.
  const stillFaced = nextGame.teams.some((t) => currentQuestionIdOf(nextGame, t.id) === questionId && !(t.id === teamId && outcome.type === "incorrect-flee"));
  const checked = [...Object.keys(nextGame.checks ?? {}), ...Object.keys(nextGame.mageCasts ?? {})].some((k) => isCheckOn(nextGame, k, questionId));
  if (!stillFaced && (questionId in nextGame.eliminated || questionId in (nextGame.mageHints ?? {}) || checked)) nextGame = { ...nextGame, ...dropEliminated(nextGame, questionId) };
  // This team's check goes once the question is answered or the team has moved off it; a retry keeps it (R6).
  else if (checkKey(questionId, teamId) in (nextGame.checks ?? {}) && (correct || currentQuestionIdOf(nextGame, teamId) !== questionId)) {
    const checks = { ...nextGame.checks };
    delete checks[checkKey(questionId, teamId)];
    nextGame = { ...nextGame, checks };
  }
  if (outcome.type === "incorrect-flee") nextGame = { ...nextGame, teams: patchTeam(nextGame.teams, teamId, (t) => ({ flees: (t.flees ?? 0) + 1 })) };
  // The oracle goes with its question: answered, fled or switched away (a retry keeps it).
  if ((correct || fleeChoice !== "retry") && getTeam(nextGame, teamId).oracleQ !== undefined) nextGame = { ...nextGame, teams: patchTeam(nextGame.teams, teamId, () => ({ oracleQ: undefined })) };
  const left = getTeam(nextGame, teamId).wrongOn;
  if (left !== undefined && left !== currentQuestionIdOf(nextGame, teamId)) nextGame = { ...nextGame, teams: patchTeam(nextGame.teams, teamId, () => ({ wrongOn: undefined })) };
  // A revealed question retires for every team holding it (tiny custom banks), except the answering team's own
  // question a hint revealed earlier (a mage's cast): a 重答 stays on it.
  for (const t of nextGame.teams) {
    if (t.inBoss || (t.id === teamId && revealedAtStart.includes(t.currentQuestionId)) || !nextGame.revealedQuestionIds.includes(t.currentQuestionId)) continue;
    const dealt = dealFor(nextGame, t, t.currentDifficulty, nextGame.revealedQuestionIds, rng);
    nextGame = { ...nextGame, usedQuestionIds: dealt.used, teams: patchTeam(nextGame.teams, t.id, () => ({ currentQuestionId: dealt.questionId, currentSelection: null, wrongOn: undefined, oracleQ: undefined, queuedQuestionId: dealt.queuedQuestionId })) };
  }
  // No unseen room question remains: continue at the boss instead of reusing an answer.
  for (const t of nextGame.teams) {
    if (!t.inBoss && !t.currentQuestionId) nextGame = sendToBoss(nextGame, t.id);
  }
  if (outcome.type === "correct-room-advance" && getTeam(nextGame, teamId).inBoss) outcome = { ...outcome, entersBoss: true };
  if (inBoss && boss.phaseIndex === boss.phases.length - 1 && boss.questionIds.every((id) => nextGame.revealedQuestionIds.includes(id))) {
    return { game: finishGame(nextGame, rng), outcome };
  }
  // Step on from the team that answered: the stored index can point at an offline team the turn skipped.
  // Split before the turn passes, so the team that just answered is the one splitShared leaves alone.
  const here = splitShared({ ...nextGame, currentTurnIndex: nextGame.turnOrder.indexOf(teamId) }, rng);
  // A prayed wrong lock keeps the turn (class-abilities.md PR 2): the cleric answers again at once.
  if (prayed) return { game: { ...here, prayerTurn: teamId }, outcome };
  return { game: advanceTurn({ ...here, prayerTurn: undefined }, facedMonster), outcome };
}

/** What a plain correct answer to the team's current question pays: its room's reward, or the boss's hit. */
function questionReward(game: GameState, teamId: string): number {
  const team = getTeam(game, teamId);
  return team.inBoss ? bossHitReward(game) : (game.rooms[team.roomIndex]?.reward ?? 0);
}

/** Takes `amount` from the team's reward, never below 0: a warrior's 1 (the whole question) and a caught sneak (a tenth). */
function deduct(game: GameState, teamId: string, amount: number): { game: GameState; penalty: number } {
  const penalty = Math.max(0, Math.min(amount, getTeam(game, teamId).reward));
  return penalty > 0 ? { game: { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ reward: t.reward - penalty })) }, penalty } : { game, penalty: 0 };
}

/** The thief's last 偷襲 (Team.sneakTry). */
export type SneakTry = { questionId: string; value?: number; penalty?: number };

/** Throws unless it is `teamId`'s turn as a `classId` with no wrong lock waiting (that waits for
 * retry/flee). The room checks its own beats (locks, rolls). */
function assertAbilityTurn(game: GameState, teamId: string, classId: ClassId) {
  assertPlaying(game);
  assertNotBuzz(game);
  assertTurn(game, teamId);
  if (getTeam(game, teamId).classId !== classId) throw new InvalidActionError(`${teamId} is not a ${classId}`);
  if (atFork(getTeam(game, teamId))) throw new InvalidActionError("fork");
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

/** What a mage casts on: the room's bank question, in shown order. */
export type MageTarget = { kind: "multipleChoice"; correctIndex: number; optionCount: number } | { kind: "text"; answer: string } | { kind: "sort"; items: string[] };

/** The mage's spell, read from its skill die `value` (class dice). The use was spent when the die was rolled
 * (spendAbility); a small failure (2–6) gives it back. Per tier, 1 / 2–6 / 7–19 / 20:
 * - multipleChoice: nothing / removes 1 wrong option / min(2, wrong left − 1) / every wrong option (the answer shows);
 * - fill-in: nothing / the answer's letter count / its first letter or number / the whole answer;
 * - sort: nothing / nothing / the first item / the whole order.
 * Refuses what the success could not do (nothing left to remove, a hint already shown, an answer too short to hint), so
 * the room checks a cast with value 7 before it spends and rolls. */
export function mageCast(game: GameState, teamId: string, questionId: string, target: MageTarget, value: number, rng: () => number = Math.random): GameState {
  assertAbilityTurn(game, teamId, "mage");
  assertCurrentQuestion(game, teamId, questionId);
  if (game.mageCasts?.[checkKey(questionId, teamId)]) throw new InvalidActionError("cast_done");
  const tier = skillTier(value);
  // Marked whatever the tier, so a 1 or a refunded 2–6 is not a free reroll.
  // A 20 shows the whole answer to the room, so the question counts as revealed, like a shown wrong lock (#343).
  const cast = {
    ...game,
    mageCasts: { ...game.mageCasts, [checkKey(questionId, teamId)]: true as const },
    ...(tier === 3 ? { revealedQuestionIds: withRevealed(game.revealedQuestionIds, questionId) } : {}),
  };
  const refunded = { ...cast, teams: patchTeam(game.teams, teamId, (t) => ({ ...(tier === 1 ? { abilityUses: t.abilityUses + 1 } : {}), ...withNaturals(t, [value]) })) };
  if (target.kind === "multipleChoice") {
    const old = game.eliminated[questionId] ?? [];
    const wrong = Array.from({ length: target.optionCount }, (_, i) => i).filter((i) => i !== target.correctIndex && !old.includes(i));
    if (wrong.length < 2) throw new InvalidActionError("no_option_to_remove");
    const n = [0, 1, Math.min(2, wrong.length - 1), wrong.length][tier];
    if (n === 0) return refunded;
    const removed: number[] = [];
    // Clamped: an rng that ever returned 1 would otherwise splice nothing and loop forever.
    while (removed.length < n) removed.push(...wrong.splice(Math.min(wrong.length - 1, Math.floor(rng() * wrong.length)), 1));
    return {
      ...refunded,
      eliminated: { ...game.eliminated, [questionId]: [...old, ...removed] },
      mageRemoved: { ...game.mageRemoved, [questionId]: [...(game.mageRemoved?.[questionId] ?? []), ...removed] },
      // A pick on a removed option clears, for every team facing this question (the boss question is shared).
      teams: refunded.teams.map((t) =>
        t.currentSelection !== null && removed.includes(t.currentSelection) && currentQuestionIdOf(game, t.id) === questionId ? { ...t, currentSelection: null } : t,
      ),
    };
  }
  if (game.mageHints?.[questionId] !== undefined) throw new InvalidActionError("hint_shown");
  // The team's own check already showed the first character (dnd design E1-1): nothing left to give, nothing spent.
  if (target.kind === "text" && game.checks?.[checkKey(questionId, teamId)]?.hint !== undefined) throw new InvalidActionError("hint_shown");
  const first = target.kind === "text" ? firstMeaningfulChar(target.answer) : (target.items[0] ?? null);
  if (first === null) throw new InvalidActionError("no_hint");
  const hint: [string, MageHintKind | undefined] | null =
    tier === 0 ? null
    : tier === 1 ? (target.kind === "text" ? [String(meaningfulChars(target.answer).length), "count"] : null)
    : tier === 2 ? [first, undefined]
    : [target.kind === "text" ? target.answer : target.items.join(" → "), "whole"];
  if (!hint) return refunded;
  const [text, kind] = hint;
  return {
    ...refunded,
    mageHints: { ...game.mageHints, [questionId]: text },
    ...(kind ? { mageHintKinds: { ...game.mageHintKinds, [questionId]: kind } } : {}),
  };
}

/** The answer's letters and numbers (skipping spaces, punctuation, symbols, emoji). */
function meaningfulChars(answer: string): string[] {
  return answer.match(/[\p{L}\p{N}]/gu) ?? [];
}

/** The answer's first letter or number, or null when it has fewer than 2 of them: one would give the whole answer away. */
export function firstMeaningfulChar(answer: string): string | null {
  const chars = meaningfulChars(answer);
  return chars.length >= 2 ? chars[0]! : null;
}

/** The bonus and DC a team rolls with on `questionId` (dnd design Premise 3): its class bonus, against its question's
 * difficulty (the pool it was dealt from, like answerQuestion's points), or a boss question's own (bossDifficulties). */
export function checkTarget(game: GameState, teamId: string, questionId: string): { bonus: number; dc: number } {
  const team = getTeam(game, teamId);
  const bonus = CHECK_BONUS[team.classId ?? "none"];
  if (isInBossPhase(game, teamId)) {
    return { bonus, dc: CHECK_DC[bossQuestionDifficulty(game, questionId) - 1] };
  }
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
  const teams = patchTeam(game.teams, teamId, (t) => withNaturals(t, [value]));
  return { ...game, teams, checks: { ...game.checks, [checkKey(questionId, teamId)]: record } };
}

/** The thief presses 偷襲 on its current question (class-dice-rework.md): the use is spent at once and the room rolls the
 * sneak die, which sneakRoll applies when it lands. Once per question, whatever the die says. */
export function startSneak(game: GameState, teamId: string): GameState {
  assertAbilityTurn(game, teamId, "thief");
  const questionId = currentQuestionIdOf(game, teamId);
  const tried = getTeam(game, teamId).sneakTry;
  // A press whose die never landed (a restart cut its beat; the die lives in the room's memory) rolls again, already paid.
  const unrolled = tried?.questionId === questionId && tried.value === undefined;
  if (getTeam(game, teamId).sneakArmed || (tried?.questionId === questionId && !unrolled)) throw new InvalidActionError("sneak_used");
  const spent = unrolled ? game : spendAbility(game, teamId, "thief");
  return { ...spent, teams: patchTeam(spent.teams, teamId, () => ({ sneakTry: { questionId } })) };
}

/** The sneak die `value` landed: 1 is caught and loses SNEAK_CAUGHT_SHARE of the question's reward now (never below 0),
 * 2–6 is nothing, 7–19 arms the sneak and 20 arms it as a crit (×2, 3 hearts). Natural 20s and 1s count. */
export function sneakRoll(game: GameState, teamId: string, value: number): { game: GameState; penalty: number } {
  assertPlaying(game);
  const tier = skillTier(value);
  const questionId = getTeam(game, teamId).sneakTry?.questionId ?? currentQuestionIdOf(game, teamId);
  const counted = { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ ...withNaturals(t, [value]), sneakTry: { questionId, value }, ...(tier >= 2 ? { sneakArmed: true as const, ...(tier === 3 ? { sneakCrit: true as const } : {}) } : {}) })) };
  if (tier !== 0) return { game: counted, penalty: 0 };
  const taken = deduct(counted, teamId, Math.round(questionReward(game, teamId) * SNEAK_CAUGHT_SHARE));
  return { game: { ...taken.game, teams: patchTeam(taken.game.teams, teamId, () => ({ sneakTry: { questionId, value, penalty: taken.penalty } })) }, penalty: taken.penalty };
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

/** Whether `teamId`'s wrong lock is waiting on a cleric that may still pray this turn (not after a failed prayer die). */
export function canPray(game: GameState, teamId: string): boolean {
  return game.pendingWrong?.teamId === teamId && !game.pendingWrong.prayed && !game.pendingWrong.prayFailed && clericMayPray(game, teamId);
}

/** The cleric prays on its wrong lock: one use, spent as the prayer die rolls, and its 重答 / 逃跑 then keeps the turn
 * (answerQuestion) unless the die says otherwise (prayerRoll). */
export function pray(game: GameState, teamId: string): GameState {
  assertPlaying(game);
  if (!canPray(game, teamId)) throw new InvalidActionError(`${teamId} cannot pray now`);
  return {
    ...game,
    pendingWrong: { ...game.pendingWrong!, prayed: true, praying: true },
    teams: patchTeam(game.teams, teamId, (t) => ({ abilityUses: t.abilityUses - 1, prayedOn: game.pendingWrong!.questionId })),
  };
}

/** The prayer die `value` on a prayer (class dice), once its beat ends: 1 or 2–6 is no prayer (the use stays spent; the
 * wrong answer waits for a plain 重答 / 逃跑, which ends the turn), 7–19 stands, 20 stands and gives the use back. */
export function prayerRoll(game: GameState, teamId: string, value: number): GameState {
  assertPlaying(game);
  const wrong = game.pendingWrong;
  if (wrong?.teamId !== teamId || !wrong.prayed) throw new InvalidActionError("no_prayer");
  const tier = skillTier(value);
  game = { ...game, teams: patchTeam(game.teams, teamId, (t) => withNaturals(t, [value])) };
  if (tier <= 1) return { ...game, pendingWrong: { teamId: wrong.teamId, questionId: wrong.questionId, optionIndex: wrong.optionIndex, prayFailed: true } };
  const stood = { ...game, pendingWrong: { teamId: wrong.teamId, questionId: wrong.questionId, optionIndex: wrong.optionIndex, prayed: true as const } };
  if (tier === 3) return { ...stood, teams: patchTeam(game.teams, teamId, (t) => ({ abilityUses: t.abilityUses + 1 })) };
  return stood;
}

/**
 * The warrior's roll stands in for the answer: `value` (a d20, rolled by the room) of WARRIOR_TARGET
 * or more is a correct answer, less is a wrong one with retry, under answerQuestion's usual rules
 * (in the boss room a shown wrong option still rotates the question). The use was spent by spendAbility.
 * `dishDie`: a hit's dish die, rolled after the warrior's (class-dice-rework.md).
 */
export function warriorRoll(
  game: GameState,
  teamId: string,
  questionId: string,
  value: number,
  rng: () => number = Math.random,
  dishDie?: number,
  killDice?: number[],
): { game: GameState; outcome: AnswerOutcome } {
  assertAbilityTurn(game, teamId, "warrior");
  // Its natural 20s and 1s count here (D5, fortune-teller.md E7); the dish die's count in answerQuestion.
  const counted = { ...game, teams: patchTeam(game.teams, teamId, (t) => withNaturals(t, [value])) };
  return answerQuestion(counted, teamId, questionId, value >= WARRIOR_TARGET, "retry", rng, dishDie, killDice, undefined, value < WARRIOR_TARGET, value);
}

/**
 * The host's override (docs/designs/scoring-and-score-pools.md S13): take a team into the boss room
 * as if it had just reached the threshold. Not a turn: the turn order and every score stay as they
 * are. Refused while the team's wrong lock waits for retry/flee, so that choice never lands on a
 * question the team no longer faces.
 */
export function sendToBoss(game: GameState, teamId: string, rng: () => number = Math.random): GameState {
  assertPlaying(game);
  const team = getTeam(game, teamId);
  if (team.inBoss) throw new InvalidActionError(`${teamId} is already in the boss room`);
  if (game.pendingWrong?.teamId === teamId) throw new InvalidActionError(`${teamId} has a wrong lock waiting for retry or flee`);
  // A catch on this team's room question is called off with it (anti-ai-cheating.md).
  if (game.antiCheat?.openCatch?.teamId === teamId) game = cancelCatch(game);
  // A sneak armed for the room question is for that question only (D16): drop it and give the use back.
  // (A boss-room sneak can outlive a question rotation while the thief is offline; accepted, /review D4=A.)
  const sneak = team.sneakArmed ? { sneakArmed: undefined, sneakCrit: undefined, abilityUses: team.abilityUses + 1 } : {};
  const teams = patchTeam(game.teams, teamId, () => ({ inBoss: true, bossAt: { round: game.round ?? 1, turns: team.turns ?? 0 }, currentSelection: null, queuedQuestionId: undefined, swappedMonsterId: undefined, typedAnswer: undefined, typedFields: undefined, event: undefined, fork: undefined, oracleQ: undefined, ...sneak }));
  // The room question leaves play with this team (as in answerQuestion): a later deal of it starts clean.
  const left = team.currentQuestionId;
  const stillFaced = teams.some((t) => !t.inBoss && t.currentQuestionId === left);
  return splitShared(applySprint(game, { ...game, teams, ...(stillFaced ? {} : dropEliminated(game, left)) }), rng);
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

/** The chance that a correct answer brings a team to a 叉路, whose ❓ door holds an event (D5, branch-fork.md). */
export const EVENT_CHANCE = 0.25;
/** What stands on stage: a chest (a feast or a rotten dish), the statue (`idol`: a blessing or a curse) or the fortune
 * teller (fortune-teller.md). `spring` and `fairy`, and the old lots `great`, `good` and `bad`, are never drawn any more:
 * they stay for a room saved mid-event before the 3-scene deck. */
export type EventScene = "chest" | "spring" | "idol" | "fairy" | "fortune";
export type EventOutcome = "feast" | "rotten" | "spring" | "curse" | "blessing" | "great" | "good" | "bad" | "fortune";
export interface RoomEvent {
  scene: EventScene;
  outcome: EventOutcome;
  /** The fortune teller's condition, drawn with the event (drawEvent). */
  fortune?: FortuneDraw;
}
export type Boon = "curse" | "blessing";
/** 🍀 幸運骰 (once the lucky potion; the id stays for saved games): the only item so far (docs/designs/lucky-potion.md). */
export type Item = "luckyPotion";

/** 🍀 給幸運骰: the host gives `teamId` a lucky die, at any time of the game (premise 1). One at a time (premise 4). */
export function giveItem(game: GameState, teamId: string): GameState {
  if (game.phase !== "playing") throw new InvalidActionError("not_playing");
  if (getTeam(game, teamId).item) throw new InvalidActionError("item_held");
  return { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ item: "luckyPotion", potionsGiven: (t.potionsGiven ?? 0) + 1 })) };
}

/** Whether `teamId`'s lucky die is armed: used on the question it faces now, this turn (E1). Which die it doubles: luckyDieFits. */
export function potionArmed(game: GameState, teamId: string): boolean {
  const t = getTeam(game, teamId);
  return !!t.item && t.itemArmedFor === currentQuestionIdOf(game, teamId) && t.itemArmedTurn === (t.turns ?? 0);
}

/** 🍀 用幸運骰 (甲2, owner 2026-11-19): an armed lucky die goes on the team's next class skill die (洞悉, 祈禱, 衝鋒, 偷襲);
 * a team with no skill uses left at all (a chef, no class, or all 3 used) puts it on its next dish die instead. Never on
 * the persuasion check (it rolls itself) or a kill's dice. The room calls it after spending the use, so a class die always fits. */
export function luckyDieFits(team: SkillTeam, kind: string): boolean {
  if (kind === "mage" || kind === "cleric" || kind === "warrior" || kind === "thief") return true;
  return kind === "dish" && !hasSkillUses(team);
}

type SkillTeam = Pick<Team, "classId" | "abilityUses"> & Partial<Pick<Team, "id" | "sneakTry" | "prayedOn">>;
/** The question the lucky die would be for, and the game's (or view's) mageCasts. */
type SkillAt = { questionId: string; mageCasts?: Record<string, unknown> };

/** A class with a skill die and a use of it left: its lucky die waits for that die, not the dish die. */
export function hasSkillUses(team: SkillTeam): boolean {
  return (team.classId === "mage" || team.classId === "cleric" || team.classId === "warrior" || team.classId === "thief") && team.abilityUses > 0;
}

/** The team's skill die already rolled on `at`'s question: a mage cast 洞悉 there, a thief's 偷襲 die landed there, or a
 * cleric prayed there. A lucky die is used before a roll, so it stays closed for the rest of that question (owner 2026-11-19). */
export function skillRolledOn(team: SkillTeam, at: SkillAt): boolean {
  if (team.id === undefined) return false;
  if (team.classId === "mage") return !!at.mageCasts?.[checkKey(at.questionId, team.id)];
  if (team.classId === "thief") return team.sneakTry?.questionId === at.questionId && team.sneakTry.value !== undefined;
  if (team.classId === "cleric") return team.prayedOn === at.questionId;
  return false;
}

/** 🍀 用幸運骰: the team arms its lucky die for its current question. The room checks the turn and D6's cases first. */
export function drinkPotion(game: GameState, teamId: string): GameState {
  assertPlaying(game);
  assertTurn(game, teamId);
  if (atFork(getTeam(game, teamId))) throw new InvalidActionError("fork");
  if (!getTeam(game, teamId).item) throw new InvalidActionError("no_item");
  if (potionArmed(game, teamId)) throw new InvalidActionError("already_drunk");
  const questionId = currentQuestionIdOf(game, teamId);
  if (skillRolledOn(getTeam(game, teamId), { questionId, mageCasts: game.mageCasts })) throw new InvalidActionError("skill_rolled");
  return { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ itemArmedFor: questionId, itemArmedTurn: t.turns ?? 0 })) };
}

/** A die rolled with the potion: it is gone (E3). */
export function spendPotion(game: GameState, teamId: string): GameState {
  return { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ item: undefined, itemArmedFor: undefined, itemArmedTurn: undefined, potionsDrunk: (t.potionsDrunk ?? 0) + 1 })) };
}

/** ⚙ 更多's 修正 (docs/hosting.md): the host's hand corrections after a misjudgment. */
export const HOST_FIXES = ["score+", "score-", "ability+", "ability-", "potion-"] as const;
export type HostFix = (typeof HOST_FIXES)[number];
/** Reward points one 修正 press adds or takes. */
export const FIX_SCORE_STEP = 5;
/** The most reward 設定 (HOST_SET_SCORE) may set. */
export const FIX_SCORE_MAX = 9999;
/** One correction, for lib/game-log.ts: `from` and `to` are the reward, the uses left, or 1/0 for a held potion.
 * `set` is 設定 (an exact reward), `rejudge` is 改判 on the ledger's entry number `judgment` (1-based). */
export interface FixRecord {
  fix: HostFix | "set" | "rejudge";
  from: number;
  to: number;
  judgment?: number;
}

/** One applied judgment, for 改判 (docs/hosting.md). `correct` is the verdict as shown now (`flipped`: 改判 turned it).
 * `points` (N) is fixed when judged: a correct one's whole gain, a wrong one's plain room or boss reward plus the chef's
 * share. `taken`: what the last 改成答錯 took away, so the next 改成答對 gives back exactly that (the reward's 0 floor). */
export interface Judgment {
  teamId: string;
  questionId: string;
  correct: boolean;
  points: number;
  flipped?: true;
  taken?: number;
  /** A warrior's roll (class dice): only its own die decides it, so 改判 never moves it (owner, 2026-11-17). */
  warrior?: true;
  /** A wrong turn-based answer: its 改成答對 is paid through a dish die rolled then (class-dice-rework.md), a chef's
   * multipliers when `chef`, after the armed sneak's reward multiplier `sneak` (`points` is the plain reward). */
  dish?: { chef?: true; sneak?: number };
}

/** The most ability uses 修正 may give `team` back: its class's set plus the uses event rooms gave it (resolveEvent's
 * spring / good), less an armed 偷襲 (spent already, refunded if it never lands). Null for a chef or no class. */
export function abilityCap(team: Pick<Team, "classId" | "events" | "sneakArmed">): number | null {
  if (!team.classId || team.classId === "chef") return null;
  const won = (team.events ?? []).filter((e) => e === "spring" || e === "good").length;
  return abilityUsesFor(team.classId) + won - (team.sneakArmed ? 1 : 0);
}

/** 修正: reward ± FIX_SCORE_STEP (never below 0; progress and the boss door untouched), ability uses ± 1 (0..abilityCap),
 * or the held potion taken back (armed or not; not counted as drunk). A press that would change nothing throws, so
 * nothing is recorded. */
export function hostFix(game: GameState, teamId: string, fix: HostFix): GameState {
  if (game.phase !== "playing") throw new InvalidActionError("not_playing");
  const t = getTeam(game, teamId);
  let patch: Partial<Team>;
  let from: number;
  let to: number;
  if (fix === "score+" || fix === "score-") {
    from = t.reward;
    to = Math.max(0, from + (fix === "score+" ? FIX_SCORE_STEP : -FIX_SCORE_STEP));
    patch = { reward: to };
  } else if (fix === "ability+" || fix === "ability-") {
    const cap = abilityCap(t);
    if (cap === null) throw new InvalidActionError("no_ability");
    from = t.abilityUses;
    // One step in the pressed direction only, never past 0 or the cap.
    to = fix === "ability+" ? (from < cap ? from + 1 : from) : Math.max(0, from - 1);
    patch = { abilityUses: to };
  } else {
    if (!t.item) throw new InvalidActionError("no_item");
    [from, to] = [1, 0];
    patch = { item: undefined, itemArmedFor: undefined, itemArmedTurn: undefined };
  }
  if (from === to) throw new InvalidActionError("at_limit");
  return { ...game, teams: patchTeam(game.teams, teamId, (x) => ({ ...patch, fixes: [...(x.fixes ?? []), { fix, from, to }] })) };
}

/** 設定: the reward becomes `score` (0..FIX_SCORE_MAX, checked by the parser); progress untouched. The same value throws. */
export function hostSetScore(game: GameState, teamId: string, score: number): GameState {
  if (game.phase !== "playing") throw new InvalidActionError("not_playing");
  const from = getTeam(game, teamId).reward;
  if (from === score) throw new InvalidActionError("at_limit");
  return { ...game, teams: patchTeam(game.teams, teamId, (x) => ({ reward: score, fixes: [...(x.fixes ?? []), { fix: "set" as const, from, to: score }] })) };
}

/** N for the ledger, from `prev` (the game before the judgment): a correct outcome's whole gain; for a wrong one, what a
 * plain correct answer there gives (room reward or the boss's hit, bossHitReward). */
export function judgmentPoints(prev: GameState, teamId: string, outcome: AnswerOutcome): number {
  if (outcome.type === "correct-room-advance" || outcome.type === "correct-boss-hit") return outcome.reward;
  const t = getTeam(prev, teamId);
  return t.inBoss ? bossHitReward(prev) : (prev.rooms[t.roomIndex]?.reward ?? 0);
}

/** Appends one applied judgment to the ledger (the room calls this once per judgment, never for a 🚨 catch). `warrior`:
 * a warrior's roll decided it. */
export function recordJudgment(game: GameState, prev: GameState, teamId: string, questionId: string, outcome: AnswerOutcome, warrior = false): GameState {
  const correct = outcome.type === "correct-room-advance" || outcome.type === "correct-boss-hit";
  const t = getTeam(prev, teamId);
  const dish = correct || warrior || isBuzzPhase(prev) ? undefined : { ...(t.classId === "chef" ? { chef: true as const } : {}), ...(t.sneakArmed ? { sneak: t.sneakCrit ? SNEAK_CRIT_MULTIPLIER : SNEAK_REWARD_MULTIPLIER } : {}) };
  const entry: Judgment = { teamId, questionId, correct, points: judgmentPoints(prev, teamId, outcome), ...(warrior ? { warrior: true as const } : {}), ...(dish ? { dish } : {}) };
  return { ...game, judgments: [...(game.judgments ?? []), entry] };
}

/** Whether 改成答對 on ledger entry `j` needs a dish die rolled now (class-dice-rework.md): a turn-based wrong answer never
 * flipped before (a flip back gives back what the last 改成答錯 took). */
export function rejudgeNeedsDie(j: Judgment): boolean {
  return !j.correct && j.dish !== undefined && j.taken === undefined;
}

/** 改判: ledger entry `index` shows `correct` from now on, and only its reward points move (owner decision "A 只改分數").
 * 改成答錯 takes min(taken ?? N, reward) and keeps it as `taken`; 改成答對 gives back `taken ?? N` and drops it, so any flip
 * cycle nets 0 and the next 改成答錯 starts from N again. `teamId` and `questionId` must match the entry, or it is a press from an older list (`stale`).
 * `die`: the dish die a first 改成答對 of a turn-based answer rolls. */
export function hostRejudge(game: GameState, index: number, teamId: string, questionId: string, correct: boolean, die?: number): GameState {
  if (game.phase !== "playing") throw new InvalidActionError("not_playing");
  const j = game.judgments?.[index];
  if (!j || j.teamId !== teamId || j.questionId !== questionId) throw new InvalidActionError("stale");
  // A warrior's roll is its own die's, whatever the host decides later (owner, 2026-11-17).
  if (j.warrior) throw new InvalidActionError("warrior_roll");
  if (j.correct === correct) throw new InvalidActionError("at_limit");
  const needsDie = correct && rejudgeNeedsDie(j);
  if (needsDie && die === undefined) throw new InvalidActionError("die_needed");
  // As live: the armed sneak's multiplier, then the dish die's on the whole of it.
  const sneaked = Math.round(j.points * (j.dish?.sneak ?? 1));
  const paid = !needsDie ? (j.taken ?? j.points) : Math.round(sneaked * dishMultiplier(!!j.dish?.chef, die!));
  const from = getTeam(game, teamId).reward;
  const moved = correct ? paid : Math.min(j.taken ?? j.points, from);
  const to = correct ? from + moved : from - moved;
  const entry: Judgment = { teamId, questionId, correct, points: j.points, ...(j.dish ? { dish: j.dish } : {}) };
  if (!j.flipped) entry.flipped = true;
  // What this flip moved, for the next flip to move back exactly (a dish die is rolled once per entry).
  if (!correct || needsDie) entry.taken = moved;
  const judgments = game.judgments!.map((e, i) => (i === index ? entry : e));
  return { ...game, judgments, teams: patchTeam(game.teams, teamId, (x) => ({ reward: to, fixes: [...(x.fixes ?? []), { fix: "rejudge" as const, from, to, judgment: index + 1 }], ...withNaturals(x, needsDie ? [die!] : []) })) };
}
/** Satiety each outcome gives or takes (D4, D9); the spring's goes only to a chef or a team with no class. `great` and
 * `spring` are only for saves from before the 3-scene deck. */
export const EVENT_SATIETY = { feast: 20, rotten: -10, great: 25, spring: 10 } as const;

/** One of `n` equally, never `n` itself (an rng that ever returned 1). */
const pickIndex = (rng: () => number, n: number) => Math.min(n - 1, Math.floor(rng() * n));

/** The chest (a feast or a rotten dish) or the statue (a blessing or a curse), 1/2 each. */
function chestOrStatue(chest: boolean, rng: () => number): RoomEvent {
  const first = rng() < 0.5;
  return chest ? { scene: "chest", outcome: first ? "feast" : "rotten" } : { scene: "idol", outcome: first ? "blessing" : "curse" };
}

/** The ❓ door's event (fortune-teller.md G3): chest, statue or fortune teller, 1/3 each, then the outcome. The fortune
 * teller draws her condition from the pool now; an empty pool means no fortune this time (G2): chest or statue instead. */
export function drawEvent(game: GameState, teamId: string, rng: () => number = Math.random): RoomEvent {
  const scene = pickIndex(rng, 3);
  if (scene < 2) return chestOrStatue(scene === 0, rng);
  const pool = fortunePool(game, teamId);
  if (!pool.length) return chestOrStatue(rng() < 0.5, rng);
  const condition = pool[pickIndex(rng, pool.length)];
  const values = fortuneValues(game, teamId, condition);
  const value = Math.max(...game.teams.map((t) => values[t.id]));
  return { scene: "fortune", outcome: "fortune", fortune: { condition, value, matchIds: game.teams.filter((t) => values[t.id] === value).map((t) => t.id) } };
}

/* ---------- 占卜師 (docs/designs/fortune-teller.md) ---------- */

export const FORTUNE_CONDITIONS = ["natural20s", "natural1s", "flees", "potions", "wrong", "correct", "mystery", "dishes", "rotten"] as const;
export type FortuneCondition = (typeof FORTUNE_CONDITIONS)[number];
export const FORTUNE_EFFECTS = ["blessing", "curse", "potion", "tribute", "relief", "stun"] as const;
export type FortuneEffect = (typeof FORTUNE_EFFECTS)[number];
export const isFortuneCondition = (v: unknown): v is FortuneCondition => typeof v === "string" && (FORTUNE_CONDITIONS as readonly string[]).includes(v);
export const isFortuneEffect = (v: unknown): v is FortuneEffect => typeof v === "string" && (FORTUNE_EFFECTS as readonly string[]).includes(v);
/** The condition drawn with the event, and the teams tied on its highest value: fixed at the draw. */
export interface FortuneDraw {
  condition: FortuneCondition;
  value: number;
  matchIds: string[];
}
/** `deadline` (ms epoch, the room's clock) is set when the crystal ball comes up; `effect` once the pick landed, which
 * keeps the state on show (the effect card) until the host's 下一題. */
export interface FortuneState extends FortuneDraw {
  teamId: string;
  deadline?: number;
  effect?: FortuneEffect;
  timeout?: true;
}
/** One fortune in the drawing team's record (the podium and lib/game-log.ts read the hit teams off `matchIds`). */
export interface FortuneRecord extends FortuneDraw {
  effect: FortuneEffect;
  timeout?: true;
  /** The drawing team matched its own condition. */
  self?: true;
}
/** The crystal ball shows the condition this long before the drawing team may pick (then the fork's FORK_MS). */
export const FORTUNE_INTRO_MS = 3000;
/** What 進貢 takes from each team that does not match, and 救濟 from each matching team (fortune-teller.md Effects).
 * Remainders: tribute's sum is split between the matching teams rounded down and the rest is not paid out; relief's
 * payer keeps what does not split evenly between the receivers (E11). */
export const FORTUNE_PAY = { tribute: 10, relief: 20 } as const;

/** Every team's value for `condition`; the drawing team's mystery rooms count this one. */
function fortuneValues(game: GameState, teamId: string, condition: FortuneCondition): Record<string, number> {
  const of = (t: Team): number => {
    switch (condition) {
      case "natural20s": return t.natural20s ?? 0;
      case "natural1s": return t.natural1s ?? 0;
      case "flees": return t.flees ?? 0;
      case "potions": return t.potionsDrunk ?? 0;
      case "wrong": return t.wrongAnswers ?? 0;
      case "correct": return t.correctAnswers ?? 0;
      case "mystery": return (t.events?.length ?? 0) + (t.id === teamId ? 1 : 0);
      case "dishes": return new Set(t.dishes ?? []).size;
      case "rotten": return (t.events ?? []).filter((e) => e === "rotten").length;
    }
  };
  return Object.fromEntries(game.teams.map((t) => [t.id, of(t)]));
}

/** The conditions the fortune teller may draw now (G2): a highest value above 0, held by two teams or at least 2; the
 * mystery-room count never on the game's first mystery room. */
export function fortunePool(game: GameState, teamId: string): FortuneCondition[] {
  const firstMystery = game.teams.every((t) => !t.events?.length);
  return FORTUNE_CONDITIONS.filter((c) => {
    if (c === "mystery" && firstMystery) return false;
    const values = Object.values(fortuneValues(game, teamId, c));
    const max = Math.max(...values);
    return max > 0 && (values.filter((v) => v > 0).length >= 2 || max >= 2);
  });
}

/** The effect lands on the matching teams (no chef bonus on any of it, fortune-teller.md Effects). */
function applyFortuneEffect(game: GameState, matchIds: string[], effect: FortuneEffect): GameState {
  const matched = (t: Team) => matchIds.includes(t.id);
  if (effect === "blessing" || effect === "curse") return { ...game, teams: game.teams.map((t) => (matched(t) ? { ...t, boon: effect } : t)) };
  if (effect === "potion") return { ...game, teams: game.teams.map((t) => (matched(t) && !t.item ? { ...t, item: "luckyPotion" as const } : t)) };
  // Lands before openEvent's turn change, so that change already skips a stunned next team (G10).
  if (effect === "stun") return { ...game, teams: game.teams.map((t) => (matched(t) ? { ...t, stunned: true as const } : t)) };
  const pay = new Map<string, number>();
  const get = new Map<string, number>();
  if (effect === "tribute") {
    for (const t of game.teams) if (!matched(t)) pay.set(t.id, Math.min(FORTUNE_PAY.tribute, t.reward));
    const share = Math.floor([...pay.values()].reduce((a, b) => a + b, 0) / matchIds.length);
    for (const id of matchIds) get.set(id, share);
  } else {
    const low = Math.min(...game.teams.map((t) => t.reward));
    const receivers = game.teams.filter((t) => t.reward === low).map((t) => t.id);
    for (const t of game.teams) {
      if (!matched(t) || receivers.includes(t.id)) continue;
      const share = Math.floor(Math.min(FORTUNE_PAY.relief, t.reward) / receivers.length);
      pay.set(t.id, share * receivers.length);
      for (const id of receivers) get.set(id, (get.get(id) ?? 0) + share);
    }
  }
  return { ...game, teams: game.teams.map((t) => (pay.has(t.id) || get.has(t.id) ? { ...t, reward: t.reward - (pay.get(t.id) ?? 0) + (get.get(t.id) ?? 0) } : t)) };
}

/**
 * The fortune's effect lands (fortune-teller.md R2, E3, G10), in one change: the turn is checked while no effect is set, the
 * effect lands on the matching teams, the fortune event opens (openEvent: recorded, the turn counts, the team walks on,
 * the turn passes), and the effect and the drawing team's record are written. `game.fortune` stays for the effect card.
 */
export function resolveFortune(game: GameState, effect: FortuneEffect, timeout: boolean, rng: () => number = Math.random): GameState {
  assertPlaying(game);
  const fortune = game.fortune;
  if (!fortune || fortune.effect) throw new InvalidActionError("no_fortune");
  assertTurn(game, fortune.teamId);
  const { game: opened } = openEvent(applyFortuneEffect(game, fortune.matchIds, effect), fortune.teamId, rng);
  const { condition, value, matchIds, teamId } = fortune;
  const record: FortuneRecord = { condition, value, matchIds, effect, ...(timeout ? { timeout: true as const } : {}), ...(matchIds.includes(teamId) ? { self: true as const } : {}) };
  return {
    ...opened,
    fortune: { ...fortune, effect, ...(timeout ? { timeout: true as const } : {}) },
    teams: patchTeam(opened.teams, teamId, (t) => ({ fortunes: [...(t.fortunes ?? []), record] })),
  };
}

/** The effect card is closed (the host's 下一題): the fortune is over. */
export function endFortune(game: GameState): GameState {
  return game.fortune ? { ...game, fortune: undefined } : game;
}

/** Whether this correct answer may bring its team to a fork (D5, D12; branch-fork.md): only into a room before the
 * last, never into the boss room. The last room never rolls; the room picks ⚔️ led to, and an opened event, never
 * come through here (the room checks the first, openEvent is no answer). */
export function eventEligible(game: GameState, outcome: AnswerOutcome): boolean {
  return outcome.type === "correct-room-advance" && !outcome.entersBoss && outcome.nextRoomIndex < game.rooms.length - 1;
}

/* ---------- 叉路 (docs/designs/branch-fork.md) ---------- */

/** waiting: at the fork, its turn not come yet (no clock). choosing: its turn, until `deadline` (ms epoch, the room's
 * clock), with the ⚔️ door on `monsterSide` (drawn by the room, never sent to any screen). monster: it took ⚔️ (or timed
 * out), so this room's correct answer rolls no fork. */
export type Fork = { phase: "waiting" } | { phase: "choosing"; deadline: number; monsterSide: ForkSide } | { phase: "monster" };
export type ForkDoor = "monster" | "mystery";
/** The doors are unmarked: a team picks a side, and only the opened door shows what it was. */
export type ForkSide = "left" | "right";
/** A team's pick, or the clock running out (the room's only). */
export type ForkChoice = ForkSide | "timeout";
/** One fork in the game log: the side opened, what was behind it, and whether the clock picked it. */
export type ForkRecord = { side: ForkSide; door: ForkDoor; timeout?: true };
/** How long the team on turn has to pick a door; then the room takes ⚔️ for it. */
export const FORK_MS = 15_000;

/** At a fork: no question to answer, no ability, no potion, until it picks ⚔️. */
export function atFork(team: Team): boolean {
  return team.fork?.phase === "waiting" || team.fork?.phase === "choosing";
}

/** A correct answer brought the team to a fork: nothing behind the doors is drawn yet. Not a turn. */
export function enterFork(game: GameState, teamId: string): GameState {
  assertPlaying(game);
  if (getTeam(game, teamId).inBoss) throw new InvalidActionError("no forks in the boss room");
  return { ...game, teams: patchTeam(game.teams, teamId, () => ({ fork: { phase: "waiting" } })) };
}

/** The fork team's turn came (the room decides when): its door clock starts, ⚔️ behind `monsterSide`. */
export function startForkChoice(game: GameState, teamId: string, deadline: number, monsterSide: ForkSide): GameState {
  if (getTeam(game, teamId).fork?.phase !== "waiting") throw new InvalidActionError("no_fork");
  // The turn is pinned on the fork team, as answerQuestion does: the stored index can point at an offline team the turn
  // skipped, which would take the turn back the moment the door clears the choosing exception (or its phone wakes).
  return { ...game, currentTurnIndex: game.turnOrder.indexOf(teamId), teams: patchTeam(game.teams, teamId, () => ({ fork: { phase: "choosing", deadline, monsterSide } })) };
}

/**
 * The team on turn picks a side, or the clock ran out ("timeout", the room's only: the ⚔️ door opens). ⚔️: the room is
 * as if there had been no fork (the question it holds, the same turn). ❓: the event is drawn now and opened at once, as
 * openEvent does (the effect lands, the team walks on, the turn passes).
 */
export function chooseFork(game: GameState, teamId: string, choice: ForkChoice, rng: () => number = Math.random): { game: GameState; record: ForkRecord; result?: EventResult } {
  assertPlaying(game);
  assertTurn(game, teamId);
  const fork = getTeam(game, teamId).fork;
  if (fork?.phase !== "choosing") throw new InvalidActionError("no_fork");
  const side = choice === "timeout" ? fork.monsterSide : choice;
  const door: ForkDoor = side === fork.monsterSide ? "monster" : "mystery";
  const record: ForkRecord = { side, door, ...(choice === "timeout" ? { timeout: true as const } : {}) };
  const chose = patchTeam(game.teams, teamId, (t) => ({ fork: door === "mystery" ? undefined : { phase: "monster" as const }, forks: [...(t.forks ?? []), record] }));
  if (door === "monster") return { game: { ...game, teams: chose }, record };
  const event = drawEvent(game, teamId, rng);
  const entered = enterEventRoom({ ...game, teams: chose }, teamId, event);
  // The fortune teller's event waits on the team for its effect (resolveFortune opens it).
  if (event.fortune) return { record, game: { ...entered, fortune: { teamId, ...event.fortune } } };
  return { record, ...openEvent(entered, teamId, rng) };
}

/** The event behind the ❓ door, just drawn: chooseFork opens it in the same call. */
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
  // The chef reads no die here: an event's satiety is the same for every team (class dice, owner 2026-11-09).
  const give = (n: number) => {
    result.satiety = n;
  };
  const o = event.outcome;
  // The fortune itself gives nothing: its effect landed in resolveFortune (fortune-teller.md).
  if (o === "fortune") result.satiety = 0;
  else if (o === "feast" || o === "great") give(EVENT_SATIETY[o]);
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
    swappedMonsterId: undefined,
    ...(monsterId ? { metDefeats: game.defeats?.[monsterId] ?? 0 } : {}),
    currentDifficulty: game.rooms[next].baseDifficulty,
    currentQuestionId: dealt.questionId,
    currentSelection: null,
    queuedQuestionId: dealt.queuedQuestionId,
    // This turn counts, as answerQuestion counts the answering turn before it writes bossAt.
    ...(entersBoss ? { inBoss: true, bossAt: { round: game.round ?? 1, turns: (t.turns ?? 0) + 1 } } : {}),
  }));
  const moved = { ...game, teams, usedQuestionIds: dealt.used, round, lastTurnIndex: order, currentTurnIndex: order, prayerTurn: undefined };
  // No unseen room question is left for the next room: the team goes on to the boss, as in answerQuestion (#366).
  const placed = dealt.questionId ? moved : sendToBoss(moved, teamId, rng);
  if (!dealt.questionId) result.entersBoss = true;
  return { game: advanceTurn(splitShared(placed, rng), null), result };
}

/** The chest's feast (openEvent) served `dish`, drawn by the room from the catalog: it goes on the team's menu too (issue #371). */
export function serveFeast(game: GameState, teamId: string, dish: string): GameState {
  return { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ ...ate(t, dish) })) };
}

/** The team's dishes with `dish` eaten, or nothing when the monster has none. */
function ate(team: Team, dish: string | undefined): Pick<Team, "dishes"> | object {
  return dish ? { dishes: [...(team.dishes ?? []), dish] } : {};
}

/** `eliminated`, `mageRemoved`, `mageHints` and every team's check without `questionId`: it left play, and a later deal of it starts clean. */
function dropEliminated(game: GameState, questionId: string): Pick<GameState, "eliminated" | "mageRemoved" | "mageHints" | "mageHintKinds" | "mageCasts" | "checks"> {
  const drop = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== questionId));
  const checks = Object.fromEntries(Object.entries(game.checks ?? {}).filter(([k]) => !isCheckOn(game, k, questionId)));
  return { eliminated: drop(game.eliminated), mageRemoved: drop(game.mageRemoved ?? {}), mageHints: drop(game.mageHints ?? {}), mageHintKinds: drop(game.mageHintKinds ?? {}), mageCasts: Object.fromEntries(Object.entries(game.mageCasts ?? {}).filter(([k]) => !isCheckOn(game, k, questionId))), checks };
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
export function submitText(game: GameState, teamId: string, questionId: string, text: string, fields?: string[]): GameState {
  assertPlaying(game);
  // In a buzzer phase only the team that buzzed may type, if it likes (boss-music-buzzer.md M2).
  if (isBuzzPhase(game) && game.buzz?.teamId !== teamId) throw new InvalidActionError("no_buzz");
  if (game.pendingWrong) throw new InvalidActionError("A wrong answer is already waiting for its choice");
  assertTurn(game, teamId);
  assertCurrentQuestion(game, teamId, questionId);
  if (getTeam(game, teamId).typedAnswer !== undefined) throw new InvalidActionError("already_submitted");
  return { ...game, teams: patchTeam(game.teams, teamId, () => ({ typedAnswer: text, ...(fields ? { typedFields: fields } : {}) })) };
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
  // A team at a fork has no question to answer until it picks ⚔️ (branch-fork.md).
  if (atFork(getTeam(game, teamId))) throw new InvalidActionError("fork");
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

/** Update phone availability without moving the turn. Buzz races still release a dropped buzz. */
export function setTeamOnline(game: GameState, teamId: string, online: boolean): GameState {
  getTeam(game, teamId); // throws if unknown
  // A buzzing team that drops lets go of the buzz, not judged (boss-buzzer.md): another team may buzz. Not once it has
  // sent a typed answer: the big screen already shows it (#368), and the team puts the phone down to wait for the host.
  const drops = !online && game.buzz?.teamId === teamId && getTeam(game, teamId).typedAnswer === undefined;
  // An unsent buzz's state goes with it (boss-music-buzzer.md M2): it may buzz and type again.
  const dropped = { ...game, ...(drops ? { buzz: { ...game.buzz!, teamId: undefined } } : {}), teams: patchTeam(game.teams, teamId, () => ({ online, ...(drops ? { typedAnswer: undefined, typedFields: undefined } : {}) })) };
  // The last unstunned team dropping leaves every online boss-room team stunned: latched for the round (timing-tap.md).
  // Only when this drop makes it true: a stunned team blipping after stunned teams reconnected into an empty room does not.
  const next = online || allStunned(game.teams, (t) => t.inBoss) ? dropped : latchStun(dropped);
  // The last team still in dropped: everyone online is out, so the same question opens to all again (M1).
  const buzz = next.buzz;
  const stuck = !online && isBuzzPhase(next) && buzz?.questionId === next.boss.currentQuestionId && buzz.out.length > 0 && !buzz.teamId && next.teams.every((t) => !t.online || !t.inBoss || buzz.out.includes(t.id) || t.stunned);
  const after = stuck ? { ...next, buzz: { ...buzz!, out: [] } } : next;
  return after;
}

/* ---------- 抓包與神諭 (docs/designs/anti-ai-cheating.md) ---------- */

/** Whether `teamId` asked the oracle about the room question it faces now: that answer halves and cannot be caught. */
export function oracleActive(game: GameState, teamId: string): boolean {
  const t = game.teams.find((x) => x.id === teamId);
  return !!t && !t.inBoss && t.oracleQ !== undefined && t.oracleQ === t.currentQuestionId;
}

/** The host's switch. On: every team the switch never met gets its uses (a re-on refills nothing). Off: an open catch is
 * called off and refunded; an oracle already asked keeps halving its question. */
export function setAntiCheat(game: GameState, on: boolean): GameState {
  assertPlaying(game);
  const ac = game.antiCheat;
  if ((ac?.on ?? false) === on) return game;
  if (!on) {
    const off = cancelCatch(game);
    return { ...off, antiCheat: { ...off.antiCheat!, on: false } };
  }
  return {
    ...game,
    antiCheat: { ...ac, on: true, onCount: (ac?.onCount ?? 0) + 1 },
    teams: game.teams.map((t) => (t.catchesLeft === undefined ? { ...t, oracleLeft: ORACLE_USES, catchesLeft: CATCH_USES } : t)),
  };
}

/** What both actions refuse alike: the switch off, a buzzer phase, a catch waiting, a team not answering a room question
 * now. The room checks its own beats and screens first (one window predicate). */
function assertAntiCheatTurn(game: GameState, teamId: string, questionId: string) {
  assertPlaying(game);
  if (!game.antiCheat?.on) throw new InvalidActionError("anti_cheat_off");
  assertNotBuzz(game);
  if (game.antiCheat.openCatch) throw new InvalidActionError("catch_pending");
  const team = getTeam(game, teamId);
  if (team.inBoss) throw new InvalidActionError("boss_room");
  if (game.fortune && !game.fortune.effect) throw new InvalidActionError("fortune");
  if (game.pendingWrong) throw new InvalidActionError("answer_pending");
  if (atFork(team)) throw new InvalidActionError("fork");
  if (questionId !== team.currentQuestionId) throw new InvalidActionError("stale_question");
}

/** 🔮 公開問神諭: the team on turn asks the oracle about its room question, once a game, before its answer is in. */
export function askOracle(game: GameState, teamId: string, questionId: string): GameState {
  assertAntiCheatTurn(game, teamId, questionId);
  if (currentTurnTeamId(game) !== teamId) throw new InvalidActionError("not_your_turn");
  const team = getTeam(game, teamId);
  if (team.typedAnswer !== undefined) throw new InvalidActionError("answer_submitted");
  if ((team.oracleLeft ?? 0) <= 0) throw new InvalidActionError("oracle_used");
  return { ...game, teams: patchTeam(game.teams, teamId, (t) => ({ oracleLeft: (t.oracleLeft ?? 0) - 1, oracleQ: questionId, oracles: (t.oracles ?? 0) + 1 })) };
}

/** 🚨 抓包: `reporterId` (the room's connection team, never the message) says the team on turn asks an AI about
 * `questionId`. One catch per question-turn; none on an oracle question or on oneself. */
export function fileCatch(game: GameState, reporterId: string, questionId: string): GameState {
  const reporter = getTeam(game, reporterId);
  const accused = currentTurnTeamId(game);
  if (accused === null) throw new InvalidActionError("not_your_turn");
  assertAntiCheatTurn(game, accused, questionId);
  if (accused === reporterId) throw new InvalidActionError("self_catch");
  if (oracleActive(game, accused)) throw new InvalidActionError("oracle_question");
  const turn = `${accused}:${questionId}:${getTeam(game, accused).turns ?? 0}`;
  if (game.antiCheat!.caughtTurn === turn) throw new InvalidActionError("already_caught");
  if ((reporter.catchesLeft ?? 0) <= 0) throw new InvalidActionError("no_catches");
  return {
    ...game,
    antiCheat: { ...game.antiCheat!, openCatch: { by: reporterId, teamId: accused, questionId }, caughtTurn: turn },
    teams: patchTeam(game.teams, reporterId, (t) => ({ catchesLeft: (t.catchesLeft ?? 0) - 1, catchesFiled: (t.catchesFiled ?? 0) + 1 })),
  };
}

/** A catch never ruled (switch off, game over, the accused sent to the boss room): gone, the reporter's use given back. */
export function cancelCatch(game: GameState): GameState {
  const c = game.antiCheat?.openCatch;
  if (!c) return game;
  return {
    ...game,
    antiCheat: { ...game.antiCheat!, openCatch: undefined },
    teams: patchTeam(game.teams, c.by, (t) => ({ catchesLeft: (t.catchesLeft ?? 0) + 1, catchesCancelled: (t.catchesCancelled ?? 0) + 1 })),
  };
}

function openCatchOf(game: GameState) {
  assertPlaying(game);
  const c = game.antiCheat?.openCatch;
  if (!c) throw new InvalidActionError("no_catch");
  return c;
}

/** 🚨 成立: the question is marked revealed, the accused flees it (same room, a new question one easier, the turn passes;
 * an armed sneak is used up), counted as a wrong answer but not a flee, and loses CATCH_PAY.caught (never below 0); the
 * reporter gains CATCH_PAY.bounty, flat (no chef share). */
export function upholdCatch(game: GameState, rng: () => number = Math.random): { game: GameState; outcome: AnswerOutcome } {
  const c = openCatchOf(game);
  // Revealed first, so the flee's deal does not hand the same question back while another is left.
  const marked = { ...game, revealedQuestionIds: withRevealed(game.revealedQuestionIds, c.questionId) };
  // Judged while the catch still holds the turn, so an offline accused is still the team on turn.
  const { game: fled, outcome } = answerQuestion(marked, c.teamId, c.questionId, false, "flee", rng);
  const teams = fled.teams.map((t) =>
    t.id === c.teamId
      ? { ...t, flees: (t.flees ?? 1) - 1 || undefined, wrongAnswers: (t.wrongAnswers ?? 0) + 1, reward: Math.max(0, t.reward - CATCH_PAY.caught) }
      : t.id === c.by
        ? { ...t, reward: t.reward + CATCH_PAY.bounty, catchesUpheld: (t.catchesUpheld ?? 0) + 1 }
        : t,
  );
  return { game: { ...fled, teams, antiCheat: { ...fled.antiCheat!, openCatch: undefined } }, outcome };
}

/** 🛡️ 冤枉: the reporter loses CATCH_PAY.falseReport (never below 0); the accused gets a lucky potion (giveItem, counted in
 * potionsGiven), or CATCH_PAY.wronged when it holds one already, and answers on. `potion` says which. */
export function dismissCatch(game: GameState): { game: GameState; potion: boolean } {
  const c = openCatchOf(game);
  const g: GameState = {
    ...game,
    antiCheat: { ...game.antiCheat!, openCatch: undefined },
    teams: patchTeam(game.teams, c.by, (t) => ({ reward: Math.max(0, t.reward - CATCH_PAY.falseReport), catchesDismissed: (t.catchesDismissed ?? 0) + 1 })),
  };
  const potion = !getTeam(g, c.teamId).item;
  return { game: potion ? giveItem(g, c.teamId) : { ...g, teams: patchTeam(g.teams, c.teamId, (t) => ({ reward: t.reward + CATCH_PAY.wronged })) }, potion };
}

/**
 * Minimal spectator view for waiting teams (Premise 7 — pacing mitigation).
 * Not a full "活地圖" (that's deferred to iteration 2): just who's up and
 * how far they've gotten.
 */
export interface SpectatorView {
  currentTurnTeamId: string | null;
  /** The team whose turn comes after this one (turnOrder, including offline teams), for the host's 指定下一題. The team itself
   * when it is the only team; absent in a buzzer phase or with nobody on turn. */
  nextTurnTeamId?: string;
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
    /** The team's colour (#320); missing for a team saved before it (pages fall back to its index). */
    look?: number;
    abilityUses: number;
    /** The most uses ⚙ 更多's 修正 may give back (abilityCap); absent for a chef or no class. */
    abilityCap?: number;
    sneakArmed?: true;
    /** The armed sneak die landed on 20 (×2, 3 hearts). */
    sneakCrit?: true;
    /** The thief's last 偷襲 (its button stays grey on that question) and what its die did. */
    sneakTry?: SneakTry;
    /** The question the cleric last prayed on: its lucky die stays grey there (skillRolledOn). Absent from an older server. */
    prayedOn?: string;
    /** The typed answer waiting for the host (text questions), or null. */
    typedAnswer: string | null;
    /** A cleric that could pray if judged wrong now (canPrayBeforeJudge): the host's one 答錯 key waits for
     * its choice. */
    mayPray?: true;
    /** The class bonus and DC this team's persuasion check rolls with on its current question (checkTarget). */
    checkTarget?: { bonus: number; dc: number };
    /** 叉路 (branch-fork.md): at a fork waiting for its turn, or choosing its door now. Never what is behind a door. */
    fork?: "waiting" | "choosing";
    boon?: Boon;
    /** 💫 暈眩: loses its next turn or sits out the next buzz question (fortune-teller.md). */
    stunned?: true;
    /** The item the team holds; whether it is drunk for the question this turn (potionArmed); the question it was last
     * drunk on, which tells a potion that came back (lucky-potion.md E1, E2). */
    item?: Item;
    itemArmed?: true;
    itemArmedFor?: string;
    /** 抓包與神諭 uses left once given; `oracle`: this team asked the oracle about the room question it faces now. */
    oracleLeft?: number;
    catchesLeft?: number;
    oracle?: true;
  }[];
  /** The score that opens the boss room (GameConfig). Absent from older servers: DEFAULT_GAME_CONFIG's. */
  bossThreshold?: number;
  bossHp: number;
  bossMaxHp: number;
  /** This game's boss as the map strip draws it (the room's bossLook: drawn, or the bank's). Absent from an older server. */
  bossLook?: { sprite: CatalogMonster["sprite"]; hue: number };
  /** The boss phase being fought, from 1. Only phases already reached: never the total (boss-phases.md). */
  bossPhase: number;
  bossCurrentQuestionId: string;
  /** Who landed the boss's final blow, or null while it lives. */
  bossKilledBy: string | null;
  /** Options locked wrong per question id (shown greyed on every screen) and the wrong lock awaiting a choice. */
  eliminated: Record<string, number[]>;
  mageRemoved: Record<string, number[]>;
  /** The mage's public hint per fill-in or sort question id (mageCast), and what kind it is when not the first character. */
  mageHints: Record<string, string>;
  mageHintKinds?: Record<string, MageHintKind>;
  /** Per checkKey(questionId, teamId): that mage team cast there, so not again (absent from an older server). */
  mageCasts?: Record<string, true>;
  /** Persuasion checks per checkKey(questionId, teamId), written once their beat ends (dnd design R6). Absent from an older server. */
  checks?: Record<string, CheckRecord>;
  pendingWrong: WrongAnswer | null;
  /** The buzz on the boss question, only while a buzzer phase is fought (boss-buzzer.md). Its presence is what tells
   * every screen the phase is a buzzer one. */
  buzz?: Omit<BuzzState, "taps">;
  /** The cleric whose wrong lock waits for its 祈禱 (canPray), or null. */
  awaitingPrayer: string | null;
  /** ⚔️ 最後衝刺 once it fired (GameState.sprint): the screen and phones name the blessed teams. */
  sprint?: { teamIds: string[] };
  /** 抓包與神諭 once the host ever switched it on (anti-ai-cheating.md). `caught`: the team on turn was already caught
   * on this question this turn, so no second catch. */
  antiCheat?: { on: boolean; onCount: number; openCatch?: { by: string; teamId: string; questionId: string }; caught?: true; undone?: number };
}

export function getSpectatorView(game: GameState): SpectatorView {
  return {
    // A buzzer phase has no turns: the team that buzzed answers, nobody else is on turn (boss-buzzer.md).
    currentTurnTeamId: isBuzzPhase(game) ? (currentBuzz(game).teamId ?? null) : currentTurnTeamId(game),
    ...(nextTurnTeamId(game) ? { nextTurnTeamId: nextTurnTeamId(game)! } : {}),
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
      ...(t.look !== undefined ? { look: t.look } : {}),
      abilityUses: t.abilityUses,
      ...(abilityCap(t) !== null ? { abilityCap: abilityCap(t)! } : {}),
      ...(t.sneakArmed ? { sneakArmed: true as const } : {}),
      ...(t.sneakArmed && t.sneakCrit ? { sneakCrit: true as const } : {}),
      ...(t.sneakTry ? { sneakTry: t.sneakTry } : {}),
      ...(t.prayedOn ? { prayedOn: t.prayedOn } : {}),
      typedAnswer: t.typedAnswer ?? null,
      ...(canPrayBeforeJudge(game, t.id) ? { mayPray: true as const } : {}),
      // A boss team's question is the boss's, not its stale room question.
      checkTarget: checkTarget(game, t.id, currentQuestionIdOf(game, t.id)),
      // A game ended at a fork shows no door on the podium.
      ...(game.phase === "playing" && atFork(t) ? { fork: t.fork!.phase as "waiting" | "choosing" } : {}),
      ...(t.boon ? { boon: t.boon } : {}),
      ...(t.stunned ? { stunned: true as const } : {}),
      ...(t.item ? { item: t.item } : {}),
      ...(potionArmed(game, t.id) ? { itemArmed: true as const } : {}),
      ...(t.itemArmedFor ? { itemArmedFor: t.itemArmedFor } : {}),
      ...(t.oracleLeft !== undefined ? { oracleLeft: t.oracleLeft } : {}),
      ...(t.catchesLeft !== undefined ? { catchesLeft: t.catchesLeft } : {}),
      ...(oracleActive(game, t.id) ? { oracle: true as const } : {}),
    })),
    bossThreshold: game.config.bossThreshold,
    bossHp: game.boss.hp,
    bossMaxHp: game.boss.maxHp,
    bossPhase: game.boss.phaseIndex + 1,
    bossCurrentQuestionId: game.boss.currentQuestionId,
    bossKilledBy: game.boss.killedByTeamId,
    eliminated: game.eliminated,
    mageRemoved: game.mageRemoved ?? {},
    mageHints: game.mageHints ?? {},
    mageHintKinds: game.mageHintKinds ?? {},
    mageCasts: game.mageCasts ?? {},
    checks: game.checks ?? {},
    pendingWrong: game.pendingWrong,
    // A timing question's taps stay in the room until the reveal (timing-tap.md).
    ...(isBuzzPhase(game) ? { buzz: withoutTaps(currentBuzz(game)) } : {}),
    awaitingPrayer: game.pendingWrong && canPray(game, game.pendingWrong.teamId) ? game.pendingWrong.teamId : null,
    ...(game.sprint ? { sprint: game.sprint } : {}),
    ...(game.antiCheat ? { antiCheat: antiCheatView(game, game.antiCheat) } : {}),
  };
}

function antiCheatView(game: GameState, ac: AntiCheatState): NonNullable<SpectatorView["antiCheat"]> {
  const turn = currentTurnTeamId(game);
  const t = game.teams.find((x) => x.id === turn);
  const caught = !!t && ac.caughtTurn === `${t.id}:${t.currentQuestionId}:${t.turns ?? 0}`;
  return { on: ac.on, onCount: ac.onCount, ...(ac.openCatch ? { openCatch: ac.openCatch } : {}), ...(caught ? { caught: true as const } : {}), ...(ac.undone ? { undone: ac.undone } : {}) };
}
