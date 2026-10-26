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
//                 │
//                 │ answerQuestion(): 答對，roomIndex 真的變化
//                 │ (最後一房被 clamp 反覆刷分不算，見下方 recordBranchChoice)
//                 ▼
//        ┌───────────────────────────┐
//        │ 該房變成「可選」：client 端比對   │   （非同步、不擋回合 — T 的
//        │ roomIndex 與 branchChoices 的鍵   │    下一輪照常進行，選擇是
//        │ 值，缺的那個 roomIndex 就顯示分支  │    背景 UI，隨時可補）
//        │ 按鈕（DM branching interlude）    │
//        └──────────────┬────────────┘
//                        │ TEAM_BRANCH_CHOICE（隊伍手機直接發，
//                        │ teamId 由 connTeam 綁定推導，不信任 client）
//                        ▼
//        recordBranchChoice()：第一次選擇定案，
//        同 roomIndex 之後的提交一律拒絕
//
// Turn order never changes with room progress — this avoids the "arrival
// order" snowball fairness risk flagged in /plan-eng-review's Outside Voice.
//
// DM branching interlude (docs/designs/dm-branching-and-question-types.md,
// /plan-eng-review 2026-09-21): there is no server-side "trigger" step —
// the offer is purely client-derived. A client compares a team's `roomIndex`
// against the keys of its `branchChoices` map (both broadcast in every
// STATE) to find rooms it has entered but not yet chosen for, and renders
// buttons for them. The team's own phone then sends TEAM_BRANCH_CHOICE,
// validated server-side by recordBranchChoice below. Not turn-blocking: a
// team's next turn is never gated on answering it. The last-room clamp in
// answerQuestion (nextRoomIndex === team.roomIndex when already at the
// final room) means roomIndex simply never grows past it again, so no
// special-casing is needed here — a room is only ever "enterable" once.

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const MIN_DIFFICULTY: Difficulty = 1;

/**
 * Fixed, developer-authored branch option ids (not host-editable — see
 * design doc decision 7). Display text is looked up by id, never stored
 * durably, so copy changes never alter the meaning of an old save.
 */
export const BRANCH_OPTIONS = ["fight", "negotiate"] as const;
export type BranchOptionId = (typeof BRANCH_OPTIONS)[number];

export function isBranchOptionId(v: unknown): v is BranchOptionId {
  return typeof v === "string" && (BRANCH_OPTIONS as readonly string[]).includes(v);
}

/** Display text for each option id — never stored, so this can be reworded freely. */
export const BRANCH_LABELS: Record<BranchOptionId, string> = {
  fight: "武力",
  negotiate: "討價",
};

/**
 * The earliest room a team entered but hasn't chosen a branch for, or null if
 * there's nothing pending. Non-blocking UI (design doc decision 4B) surfaces
 * this one at a time rather than the whole backlog at once.
 */
export function firstPendingBranchRoom(team: { roomIndex: number; branchChoices: Partial<Record<number, BranchOptionId>> }): number | null {
  for (let i = 1; i <= team.roomIndex; i++) {
    if (team.branchChoices[i] === undefined) return i;
  }
  return null;
}

/** What one boss hit pays when the bank does not say (docs/designs/scoring-and-score-pools.md S8). */
export const DEFAULT_BOSS_HIT_REWARD = 10;

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
   * DM branching interlude choices, keyed by the roomIndex the team had
   * just entered when it chose. First choice for a given roomIndex wins —
   * see recordBranchChoice. Stores the option id, not display text.
   */
  branchChoices: Partial<Record<number, BranchOptionId>>;
  /**
   * In the boss room. The first team gets in at `bossThreshold` points; once any team is in, every
   * other team gets in on its next correct answer (docs/designs/live-map.md D9). Stored, not derived
   * from score, because the second rule depends on when the answer came.
   */
  inBoss: boolean;
}

export interface RoomTemplate {
  /** Base difficulty for this room, before any per-team flee downgrades. */
  baseDifficulty: Difficulty;
  /** Reward points for defeating this room's monster, whatever difficulty the team faced it at (S5). */
  reward: number;
}

export interface BossState {
  maxHp: number;
  /** Reward points per hit, the final blow included; the final blow also rolls the kill bonus (S6). */
  hitReward: number;
  hp: number;
  killedByTeamId: string | null;
  currentQuestionId: string;
  questionIds: string[];
}

export interface GameConfig {
  /** Fixed score threshold to enter the boss room (Open Questions: 已決定固定 15 分). */
  bossThreshold: number;
}

export type GamePhase = "playing" | "finished";

export interface GameState {
  teams: Team[];
  /** Fixed team order — does not change with room progress (see header diagram). */
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
  /** Per multipleChoice question id, the option order this game shows: `optionOrder[id][shown] = bank index`.
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
  /** A wrong lock waiting for that team's 重答 / 逃跑. The team keeps the turn meanwhile, even offline (E9). */
  pendingWrong: LockedOption | null;
  boss: BossState;
  config: GameConfig;
  phase: GamePhase;
  /** Team ids tied for first place once phase === "finished". */
  winners: string[];
}

export interface LockedOption {
  teamId: string;
  questionId: string;
  optionIndex: number;
}

export type AnswerOutcome =
  | { type: "correct-room-advance"; teamId: string; pointsAwarded: number; reward: number; nextRoomIndex: number; entersBoss: boolean }
  | { type: "correct-boss-hit"; teamId: string; bossHpRemaining: number; bossKilled: boolean; reward: number; killBonus?: number }
  | { type: "incorrect-flee"; teamId: string; newDifficulty: Difficulty }
  | { type: "incorrect-retry"; teamId: string };

export class InvalidActionError extends Error {}

function rollD20(rng: () => number = Math.random): number {
  return Math.floor(rng() * 20) + 1;
}

/** 4d20 kill bonus (docs/designs/scoring-and-score-pools.md S8). */
export function rollBossKillBonus(rng: () => number = Math.random): number {
  return rollD20(rng) + rollD20(rng) + rollD20(rng) + rollD20(rng);
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
 * cycle, an unrevealed one already drawn (fled) wins over re-showing an answer.
 * When every question is held (a small custom bank), a free question from the nearest other pool comes
 * next, then `own` (the dealt team's fled question), never another team's. Returns the id and the updated used-lists; `rng` keeps tests deterministic.
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
  const held = new Set(teams.filter((t) => !t.inBoss).map((t) => t.currentQuestionId)); // a boss team's room question is stale
  const free = pool.filter((id) => !held.has(id));
  const freeAnywhere = all.filter((id) => !held.has(id));
  if (free.length > 0) pool = free;
  else if (freeAnywhere.length > 0) pool = freeAnywhere;
  else {
    // Every question here is held (a pool smaller than the team count): borrow a free question from the
    // nearest other pool (lower first) before two teams hold the same one, preferring an unrevealed one.
    // A fleeing team's own question comes back only when no unrevealed one is free anywhere: it would
    // undo the flee, and after a wrong lock its answer is half shown. Only a bank with fewer questions than teams repeats.
    const order = pools.map((_, i) => i).filter((i) => i !== p).sort((x, y) => Math.abs(x - p) - Math.abs(y - p) || x - y);
    const borrowFrom = (ok: (id: string) => boolean) => order.map((i) => pools[i].filter((id) => !held.has(id) && ok(id))).find((ids) => ids.length > 0);
    const borrow = borrowFrom((id) => !revealed.includes(id)) ?? (own && !revealed.includes(own) ? [own] : borrowFrom(() => true));
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

export const DEFAULT_GAME_CONFIG: GameConfig = { bossThreshold: 15 };

export function createGame(
  teamSeeds: { id: string; name: string }[],
  rooms: RoomTemplate[],
  pools: string[][],
  bossQuestionIds: string[],
  config: GameConfig,
  bossMaxHp: number,
  rng: () => number = Math.random,
  bossHitReward = DEFAULT_BOSS_HIT_REWARD,
  optionOrder: Record<string, number[]> = {},
): GameState {
  if (teamSeeds.length === 0) {
    throw new InvalidActionError("At least one team is required");
  }
  if (rooms.length === 0) {
    throw new InvalidActionError("At least one room is required");
  }

  let used: string[][] = pools.map(() => []);
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
      currentDifficulty: rooms[0].baseDifficulty,
      currentQuestionId: dealt.questionId,
      currentSelection: null,
      branchChoices: {},
      inBoss: config.bossThreshold <= 0, // score starts at 0
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
      hp: bossMaxHp,
      killedByTeamId: null,
      currentQuestionId: bossQuestionIds[0],
      questionIds: bossQuestionIds,
    },
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
 * different question and a leftover pick would be stale. `game` supplies the stored
 * inBoss flags (isInBossPhase); `teams` is the array to map over (sometimes `game.teams`, sometimes an already-updated
 * copy from a same-branch score change). */
function resetBossSelections(game: GameState, teams: Team[]): Team[] {
  return teams.map((t) => (isInBossPhase(game, t.id) ? { ...t, currentSelection: null } : t));
}

/** The id of the team whose turn it currently is, skipping offline teams (T7). */
export function currentTurnTeamId(game: GameState): string | null {
  // A team deciding 重答 / 逃跑 keeps the turn even if its phone sleeps (phone-answering.md E9).
  if (game.pendingWrong) return game.pendingWrong.teamId;
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

function finishGame(game: GameState): GameState {
  const maxReward = Math.max(...game.teams.map((t) => t.reward));
  const winners = game.teams.filter((t) => t.reward === maxReward).map((t) => t.id);
  return { ...game, phase: "finished", winners };
}

/**
 * Resolve one answer attempt for `teamId`. Always advances the turn
 * afterwards (win or lose) — global round-robin never gives a bonus turn,
 * which is what keeps the 1/N pacing fair (see Architecture Review).
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
): { game: GameState; outcome: AnswerOutcome } {
  assertPlaying(game);

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
  // The choice resolves the pending wrong lock.
  game = { ...game, pendingWrong: null };
  // A wrong lock showed the room part of this question's answer (the red tile on the TV), so a
  // flee from it counts as revealed: deal() and nextBossQuestionId only reuse it as a last resort.
  const seenWrong = !correct && fleeChoice === "flee" && (game.eliminated[questionId]?.length ?? 0) > 0;
  const revealedOnFlee = seenWrong ? withRevealed(game.revealedQuestionIds, questionId) : game.revealedQuestionIds;

  const team = getTeam(game, teamId);
  const boss = game.boss;
  const inBoss = isInBossPhase(game, teamId);

  // T6: reject stale question submissions (front-end cache lag between
  // rooms/monsters) instead of silently scoring against the wrong question.
  const expectedQuestionId = inBoss ? boss.currentQuestionId : team.currentQuestionId;
  if (questionId !== expectedQuestionId) {
    throw new InvalidActionError(
      `Stale question submission for ${teamId}: expected ${expectedQuestionId}, got ${questionId}`,
    );
  }

  let nextGame = game;
  let outcome: AnswerOutcome;

  if (inBoss) {
    if (correct) {
      const newHp = Math.max(0, boss.hp - 1);
      const bossKilled = newHp === 0;
      const killBonus = bossKilled ? rollBossKillBonus(rng) : undefined;
      const reward = boss.hitReward + (killBonus ?? 0);
      const teams = patchTeam(game.teams, teamId, (t) => ({ reward: t.reward + reward }));

      const revealedNow = withRevealed(game.revealedQuestionIds, boss.currentQuestionId);
      const nextQuestionId = bossKilled ? boss.currentQuestionId : nextBossQuestionId(boss, revealedNow);

      // The boss question is shared: every team already in boss phase faces the same
      // nextQuestionId, not just the team that just answered. Reset ALL of their
      // picks, or a team's stale index from the old question could line up with a
      // different option on the new one and mislead the host into judging against
      // a pick that team never made for this question (adversarial review finding).
      nextGame = {
        ...game,
        teams: bossKilled ? teams : resetBossSelections(game, teams),
        // A correct answer is always revealed (D5) — the current boss question just got right,
        // so it joins the never-redeal set before nextBossQuestionId's own next call sees it.
        revealedQuestionIds: revealedNow,
        boss: {
          ...boss,
          hp: newHp,
          killedByTeamId: bossKilled ? teamId : boss.killedByTeamId,
          currentQuestionId: nextQuestionId,
        },
      };
      outcome = { type: "correct-boss-hit", teamId, bossHpRemaining: newHp, bossKilled, reward, ...(killBonus === undefined ? {} : { killBonus }) };

      if (bossKilled) {
        return { game: finishGame(nextGame), outcome };
      }
    } else {
      // Wrong boss answer: rotate to the next boss question either way —
      // there's no "downgrade" concept for a shared boss queue. A flee reveals the question
      // only after a wrong lock (revealedOnFlee); the rotation skips every revealed one.
      const rotatedBossQuestionId = fleeChoice === "flee" ? nextBossQuestionId(boss, revealedOnFlee) : boss.currentQuestionId;
      // Same shared-question reasoning as the correct-hit branch above: a flee rotates
      // the question for every team in boss phase, so every one of their picks resets —
      // unless it stayed on the same question (the last unrevealed one), where picks still apply.
      nextGame = {
        ...game,
        revealedQuestionIds: revealedOnFlee,
        teams: rotatedBossQuestionId !== boss.currentQuestionId ? resetBossSelections(game, game.teams) : game.teams,
        boss: { ...boss, currentQuestionId: rotatedBossQuestionId },
      };
      outcome =
        fleeChoice === "flee"
          ? { type: "incorrect-flee", teamId, newDifficulty: team.currentDifficulty }
          : { type: "incorrect-retry", teamId };
    }
  } else {
    if (correct) {
      // The question's own difficulty: an empty or fully held pool deals from another one (deal()).
      const pointsAwarded = game.pools.findIndex((ids) => ids.includes(questionId)) + 1 || team.currentDifficulty;
      const reward = game.rooms[team.roomIndex].reward;
      // A correct answer is always revealed (D5), so this room's next deal must not hand it
      // back to a team who hasn't faced it yet.
      const revealedQuestionIds = withRevealed(game.revealedQuestionIds, questionId);
      const entersBoss = team.score + pointsAwarded >= game.config.bossThreshold || game.teams.some((t) => t.inBoss);
      // A team walking into the boss room stays at its room: no next-room question is dealt
      // (it would burn one) and no branch room opens that it will never walk into.
      const nextRoomIndex = entersBoss ? team.roomIndex : Math.min(team.roomIndex + 1, game.rooms.length - 1);
      const dealt = entersBoss
        ? { questionId: team.currentQuestionId, used: game.usedQuestionIds }
        : deal(game.pools, game.usedQuestionIds, revealedQuestionIds, game.teams, game.rooms[nextRoomIndex].baseDifficulty, rng);
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        revealedQuestionIds,
        teams: patchTeam(game.teams, teamId, (t) => ({
          score: t.score + pointsAwarded,
          reward: t.reward + reward,
          roomIndex: nextRoomIndex,
          currentDifficulty: entersBoss ? t.currentDifficulty : game.rooms[nextRoomIndex].baseDifficulty,
          currentQuestionId: dealt.questionId,
          currentSelection: null,
          inBoss: entersBoss,
        })),
      };
      outcome = { type: "correct-room-advance", teamId, pointsAwarded, reward, nextRoomIndex, entersBoss };
    } else if (fleeChoice === "flee") {
      const newDifficulty = Math.max(MIN_DIFFICULTY, team.currentDifficulty - 1) as Difficulty;
      // Fleeing reveals the answer only after a wrong lock (revealedOnFlee); otherwise only skip
      // already-revealed questions from prior correct answers.
      const dealt = deal(game.pools, game.usedQuestionIds, revealedOnFlee, game.teams, newDifficulty, rng, team.currentQuestionId);
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        revealedQuestionIds: revealedOnFlee,
        teams: patchTeam(game.teams, teamId, () => ({ currentDifficulty: newDifficulty, currentQuestionId: dealt.questionId, currentSelection: null })),
      };
      outcome = { type: "incorrect-flee", teamId, newDifficulty };
    } else {
      // Retry: same room, same question, waits for this team's next turn.
      outcome = { type: "incorrect-retry", teamId };
    }
  }

  // Eliminated options belong to a question still in play: once it leaves (answered, fled, rotated)
  // a later deal of it starts clean.
  // Any team: a room short of questions can deal one question to two teams at once.
  const stillFaced = nextGame.teams.some((t) => (t.inBoss ? nextGame.boss.currentQuestionId : t.currentQuestionId) === questionId);
  if (!stillFaced && questionId in nextGame.eliminated) {
    nextGame = { ...nextGame, eliminated: Object.fromEntries(Object.entries(nextGame.eliminated).filter(([id]) => id !== questionId)) };
  }
  // Step on from the team that answered: the stored index can point at an offline team the turn skipped.
  return { game: advanceTurn({ ...nextGame, currentTurnIndex: nextGame.turnOrder.indexOf(teamId) }), outcome };
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
  const teams = patchTeam(game.teams, teamId, () => ({ inBoss: true, currentSelection: null }));
  // The room question leaves play with this team (as in answerQuestion): a later deal of it starts clean.
  const left = team.currentQuestionId;
  const stillFaced = teams.some((t) => !t.inBoss && t.currentQuestionId === left);
  const eliminated = stillFaced ? game.eliminated : Object.fromEntries(Object.entries(game.eliminated).filter(([id]) => id !== left));
  return { ...game, teams, eliminated };
}

/**
 * Record a team's DM branching interlude choice for a room it has already
 * entered. Non-turn-blocking (see the module header): a team may submit at
 * any point after entering `roomIndex`, even after advancing further — it
 * is validated against how far the team has actually gotten, not against
 * their current room. First choice for a given roomIndex wins; a later
 * submission for an already-decided roomIndex is a no-op error, not a
 * silent overwrite (design doc decision 6).
 *
 * `roomIndex` must be a room the team actually transitioned INTO (1..team.roomIndex)
 * — room 0 is the starting room, never entered via a branch-triggering transition,
 * and a room reached by the last-room clamp still counts once (the clamp only
 * suppresses *repeat* triggers while farming that same room, see decision 3).
 */
export function recordBranchChoice(
  game: GameState,
  teamId: string,
  roomIndex: number,
  choice: BranchOptionId,
): GameState {
  assertPlaying(game);
  const team = getTeam(game, teamId); // throws if unknown
  if (!Number.isInteger(roomIndex) || roomIndex < 1 || roomIndex > team.roomIndex) {
    throw new InvalidActionError(`Invalid branch roomIndex ${roomIndex} for ${teamId} (at ${team.roomIndex})`);
  }
  if (team.branchChoices[roomIndex] !== undefined) {
    throw new InvalidActionError(`Branch choice for room ${roomIndex} already decided for ${teamId}`);
  }
  return {
    ...game,
    teams: patchTeam(game.teams, teamId, (t) => ({ branchChoices: { ...t.branchChoices, [roomIndex]: choice } })),
  };
}

/**
 * Record (or change) a team's pick for the multipleChoice question they're currently
 * facing. Re-selectable — unlike recordBranchChoice, a later submission for the same
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
 * A wrong lock on a multipleChoice question (phone-answering.md premise 3): the option joins the
 * question's eliminated set, the team's pick clears, and `pendingWrong` waits for the team's
 * 重答 / 逃跑, which answerQuestion(correct=false) applies. Like recordOptionSelection, the caller
 * (dungeon-room.ts) has already checked the question kind and the option range against the bank.
 */
export function recordWrongLock(game: GameState, teamId: string, questionId: string, optionIndex: number): GameState {
  assertPlaying(game);
  if (game.pendingWrong) throw new InvalidActionError("A wrong answer is already waiting for its choice");
  if (currentTurnTeamId(game) !== teamId) throw new InvalidActionError(`It is not ${teamId}'s turn`);
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
  const expectedQuestionId = currentQuestionIdOf(game, teamId);
  if (questionId !== expectedQuestionId) {
    throw new InvalidActionError(`Stale question submission for ${teamId}: expected ${expectedQuestionId}, got ${questionId}`);
  }
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
  return {
    ...game,
    teams: patchTeam(game.teams, teamId, () => ({ online })),
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
    /** DM branching interlude choices so far, keyed by roomIndex. A client derives which
     * rooms are still pending a choice from `roomIndex` minus this map's keys. */
    branchChoices: Partial<Record<number, BranchOptionId>>;
  }[];
  bossHp: number;
  bossMaxHp: number;
  bossCurrentQuestionId: string;
  /** Who landed the boss's final blow, or null while it lives. */
  bossKilledBy: string | null;
  /** Options locked wrong per question id (shown greyed on every screen) and the wrong lock awaiting a choice. */
  eliminated: Record<string, number[]>;
  pendingWrong: LockedOption | null;
}

export function getSpectatorView(game: GameState): SpectatorView {
  return {
    currentTurnTeamId: currentTurnTeamId(game),
    teams: game.teams.map((t) => ({
      id: t.id,
      name: t.name,
      score: t.score,
      reward: t.reward,
      roomIndex: t.roomIndex,
      inBossPhase: isInBossPhase(game, t.id),
      online: t.online,
      currentQuestionId: t.currentQuestionId,
      currentSelection: t.currentSelection,
      branchChoices: t.branchChoices,
    })),
    bossHp: game.boss.hp,
    bossMaxHp: game.boss.maxHp,
    bossCurrentQuestionId: game.boss.currentQuestionId,
    bossKilledBy: game.boss.killedByTeamId,
    eliminated: game.eliminated,
    pendingWrong: game.pendingWrong,
  };
}
