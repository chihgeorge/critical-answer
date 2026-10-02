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

export interface Team {
  id: string;
  name: string;
  online: boolean;
  score: number;
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
   * Re-selectable up until the host judges (docs/designs/multiple-choice-questions.md
   * decision 5) — set by recordOptionSelection, reset to null everywhere a new question
   * is dealt (createGame, correct-room-advance, incorrect-flee, and boss question
   * rotation), but left alone on incorrect-retry, where the team still faces the same
   * question and a stray earlier pick is still meaningful context for the host.
   */
  currentSelection: number | null;
  /**
   * DM branching interlude choices, keyed by the roomIndex the team had
   * just entered when it chose. First choice for a given roomIndex wins —
   * see recordBranchChoice. Stores the option id, not display text.
   */
  branchChoices: Partial<Record<number, BranchOptionId>>;
}

export interface RoomTemplate {
  /** Base difficulty for this room, before any per-team flee downgrades. */
  baseDifficulty: Difficulty;
  /** Question bank for this room; questionId must be one of these ids. */
  questionIds: string[];
}

export interface BossState {
  maxHp: number;
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
  /**
   * Per room index: the questions dealt there since that room's deck was last
   * reshuffled. Shared by every team, so nobody is dealt a question another team
   * already faced in the same room until the deck runs out.
   */
  usedQuestionIds: string[][];
  /** Every question id a team has actually gotten right, globally, across the whole game — never
   * reset by a room's reshuffle. A revealed answer (see AnswerReveal, lib/protocol.ts) must
   * never come back around for someone who hasn't faced it yet; a retried or fled question stays
   * eligible (D5 — its answer was never shown). deal()'s reshuffle and the boss ring both filter
   * against this before falling back to reuse once every remaining question has been revealed. */
  revealedQuestionIds: string[];
  boss: BossState;
  config: GameConfig;
  phase: GamePhase;
  /** Team ids tied for first place once phase === "finished". */
  winners: string[];
}

export type AnswerOutcome =
  | { type: "correct-room-advance"; teamId: string; pointsAwarded: number; nextRoomIndex: number }
  | { type: "correct-boss-hit"; teamId: string; bossHpRemaining: number; bossKilled: boolean; killBonus?: number }
  | { type: "incorrect-flee"; teamId: string; newDifficulty: Difficulty }
  | { type: "incorrect-retry"; teamId: string };

export class InvalidActionError extends Error {}

function rollD6(rng: () => number = Math.random): number {
  return Math.floor(rng() * 6) + 1;
}

/** 3d6 kill bonus per Premise 5. */
export function rollBossKillBonus(rng: () => number = Math.random): number {
  return rollD6(rng) + rollD6(rng) + rollD6(rng);
}

/**
 * Deal one question for `roomIndex`: a question nobody has drawn since the last
 * reshuffle, avoiding any question a team is holding right now. When every
 * question in the room has been drawn the deck reshuffles. Within that, prefer a
 * question whose answer hasn't been revealed; if only revealed ones are left this
 * cycle, an unrevealed one already drawn (fled) wins over re-showing an answer.
 * Returns the id and the updated used-lists; `rng` is injected so tests are deterministic.
 */
function deal(
  rooms: RoomTemplate[],
  used: string[][],
  revealed: string[],
  teams: Team[],
  roomIndex: number,
  rng: () => number,
): { questionId: string; used: string[][] } {
  const all = rooms[roomIndex].questionIds;
  let base = used;
  let pool = all.filter((id) => !used[roomIndex].includes(id));
  if (pool.length === 0) {
    base = used.map((u, i) => (i === roomIndex ? [] : u));
    pool = all;
  }
  const held = new Set(teams.map((t) => t.currentQuestionId));
  const free = pool.filter((id) => !held.has(id));
  if (free.length > 0) pool = free;
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
  // The fled-question fallback above picks from questions already in `used`; don't record them twice.
  return { questionId, used: base.map((u, i) => (i === roomIndex && !u.includes(questionId) ? [...u, questionId] : u)) };
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
  bossQuestionIds: string[],
  config: GameConfig,
  bossMaxHp: number,
  rng: () => number = Math.random,
): GameState {
  if (teamSeeds.length === 0) {
    throw new InvalidActionError("At least one team is required");
  }
  if (rooms.length === 0) {
    throw new InvalidActionError("At least one room is required");
  }

  let used: string[][] = rooms.map(() => []);
  const revealed: string[] = [];
  const teams: Team[] = [];
  for (const seed of teamSeeds) {
    // Teams not dealt yet hold no question; the ones already dealt count as held.
    const dealt = deal(rooms, used, revealed, teams, 0, rng);
    used = dealt.used;
    teams.push({
      id: seed.id,
      name: seed.name,
      online: true,
      score: 0,
      roomIndex: 0,
      currentDifficulty: rooms[0].baseDifficulty,
      currentQuestionId: dealt.questionId,
      currentSelection: null,
      branchChoices: {},
    });
  }

  return {
    teams,
    turnOrder: teamSeeds.map((t) => t.id),
    currentTurnIndex: 0,
    rooms,
    usedQuestionIds: used,
    revealedQuestionIds: revealed,
    boss: {
      maxHp: bossMaxHp,
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

/** Whether it's this team in a boss encounter (score threshold reached). */
export function isInBossPhase(game: GameState, teamId: string): boolean {
  const team = getTeam(game, teamId);
  return team.score >= game.config.bossThreshold;
}

/** Clears every boss-phase team's multipleChoice pick — used wherever the shared boss question
 * rotates (correct-hit-not-killed, flee), since every team still fighting the boss now faces a
 * different question and a leftover pick would be stale. `game` supplies isInBossPhase's score
 * check; `teams` is the array to map over (sometimes `game.teams`, sometimes an already-updated
 * copy from a same-branch score change). */
function resetBossSelections(game: GameState, teams: Team[]): Team[] {
  return teams.map((t) => (isInBossPhase(game, t.id) ? { ...t, currentSelection: null } : t));
}

/** The id of the team whose turn it currently is, skipping offline teams (T7). */
export function currentTurnTeamId(game: GameState): string | null {
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
  const maxScore = Math.max(...game.teams.map((t) => t.score));
  const winners = game.teams.filter((t) => t.score === maxScore).map((t) => t.id);
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
  if (game.phase === "finished") {
    throw new InvalidActionError("Game already finished");
  }

  const activeTeamId = currentTurnTeamId(game);
  if (activeTeamId === null) {
    throw new InvalidActionError("No online team available to take a turn");
  }
  if (activeTeamId !== teamId) {
    throw new InvalidActionError(
      `It is not ${teamId}'s turn (current turn: ${activeTeamId})`,
    );
  }

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
      let killBonus: number | undefined;
      let teams = game.teams;

      if (bossKilled) {
        killBonus = rollBossKillBonus(rng);
        teams = game.teams.map((t) =>
          t.id === teamId ? { ...t, score: t.score + (killBonus as number) } : t,
        );
      }

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
      outcome = { type: "correct-boss-hit", teamId, bossHpRemaining: newHp, bossKilled, killBonus };

      if (bossKilled) {
        return { game: finishGame(nextGame), outcome };
      }
    } else {
      // Wrong boss answer: rotate to the next boss question either way —
      // there's no "downgrade" concept for a shared boss queue. Fleeing never reveals the
      // answer (D5), so this rotation only skips already-revealed questions from prior
      // correct hits — it never adds one.
      const rotatedBossQuestionId = fleeChoice === "flee" ? nextBossQuestionId(boss, game.revealedQuestionIds) : boss.currentQuestionId;
      // Same shared-question reasoning as the correct-hit branch above: a flee rotates
      // the question for every team in boss phase, so every one of their picks resets —
      // unless it stayed on the same question (the last unrevealed one), where picks still apply.
      nextGame = {
        ...game,
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
      const pointsAwarded = team.currentDifficulty;
      const nextRoomIndex = Math.min(team.roomIndex + 1, game.rooms.length - 1);
      const nextRoom = game.rooms[nextRoomIndex];
      // A correct answer is always revealed (D5), so this room's next deal must not hand it
      // back to a team who hasn't faced it yet.
      const revealedQuestionIds = withRevealed(game.revealedQuestionIds, questionId);
      const dealt = deal(game.rooms, game.usedQuestionIds, revealedQuestionIds, game.teams, nextRoomIndex, rng);
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        revealedQuestionIds,
        teams: game.teams.map((t) =>
          t.id === teamId
            ? {
                ...t,
                score: t.score + pointsAwarded,
                roomIndex: nextRoomIndex,
                currentDifficulty: nextRoom.baseDifficulty,
                currentQuestionId: dealt.questionId,
                currentSelection: null,
              }
            : t,
        ),
      };
      outcome = { type: "correct-room-advance", teamId, pointsAwarded, nextRoomIndex };
    } else if (fleeChoice === "flee") {
      const newDifficulty = Math.max(MIN_DIFFICULTY, team.currentDifficulty - 1) as Difficulty;
      // Fleeing never reveals the answer (D5) — only skip already-revealed questions from
      // prior correct answers, never add this one.
      const dealt = deal(game.rooms, game.usedQuestionIds, game.revealedQuestionIds, game.teams, team.roomIndex, rng);
      nextGame = {
        ...game,
        usedQuestionIds: dealt.used,
        teams: game.teams.map((t) =>
          t.id === teamId ? { ...t, currentDifficulty: newDifficulty, currentQuestionId: dealt.questionId, currentSelection: null } : t,
        ),
      };
      outcome = { type: "incorrect-flee", teamId, newDifficulty };
    } else {
      // Retry: same room, same question, waits for this team's next turn.
      outcome = { type: "incorrect-retry", teamId };
    }
  }

  return { game: advanceTurn(nextGame), outcome };
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
  if (game.phase === "finished") {
    throw new InvalidActionError("Game already finished");
  }
  const team = getTeam(game, teamId); // throws if unknown
  if (!Number.isInteger(roomIndex) || roomIndex < 1 || roomIndex > team.roomIndex) {
    throw new InvalidActionError(`Invalid branch roomIndex ${roomIndex} for ${teamId} (at ${team.roomIndex})`);
  }
  if (team.branchChoices[roomIndex] !== undefined) {
    throw new InvalidActionError(`Branch choice for room ${roomIndex} already decided for ${teamId}`);
  }
  return {
    ...game,
    teams: game.teams.map((t) =>
      t.id === teamId ? { ...t, branchChoices: { ...t.branchChoices, [roomIndex]: choice } } : t,
    ),
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
  if (game.phase === "finished") {
    throw new InvalidActionError("Game already finished");
  }
  const team = getTeam(game, teamId); // throws if unknown
  const expectedQuestionId = isInBossPhase(game, teamId) ? game.boss.currentQuestionId : team.currentQuestionId;
  if (questionId !== expectedQuestionId) {
    throw new InvalidActionError(`Stale question submission for ${teamId}: expected ${expectedQuestionId}, got ${questionId}`);
  }
  return {
    ...game,
    teams: game.teams.map((t) => (t.id === teamId ? { ...t, currentSelection: optionIndex } : t)),
  };
}

/** Mark a team offline/online — a disconnected team is skipped by advanceTurn (T7). */
export function setTeamOnline(game: GameState, teamId: string, online: boolean): GameState {
  getTeam(game, teamId); // throws if unknown
  return {
    ...game,
    teams: game.teams.map((t) => (t.id === teamId ? { ...t, online } : t)),
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
}

export function getSpectatorView(game: GameState): SpectatorView {
  return {
    currentTurnTeamId: currentTurnTeamId(game),
    teams: game.teams.map((t) => ({
      id: t.id,
      name: t.name,
      score: t.score,
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
  };
}
