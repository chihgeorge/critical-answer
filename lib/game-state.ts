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
// Turn order never changes with room progress — this avoids the "arrival
// order" snowball fairness risk flagged in /plan-eng-review's Outside Voice.

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const MIN_DIFFICULTY: Difficulty = 1;
export const MAX_DIFFICULTY: Difficulty = 5;

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

function clampDifficulty(value: number): Difficulty {
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, value)) as Difficulty;
}

function rollD6(rng: () => number = Math.random): number {
  return Math.floor(rng() * 6) + 1;
}

/** 3d6 kill bonus per Premise 5. */
export function rollBossKillBonus(rng: () => number = Math.random): number {
  return rollD6(rng) + rollD6(rng) + rollD6(rng);
}

export function createGame(
  teamSeeds: { id: string; name: string }[],
  rooms: RoomTemplate[],
  bossQuestionIds: string[],
  config: GameConfig = { bossThreshold: 15 },
  bossMaxHp: number,
): GameState {
  if (teamSeeds.length === 0) {
    throw new InvalidActionError("At least one team is required");
  }
  if (rooms.length === 0) {
    throw new InvalidActionError("At least one room is required");
  }

  const teams: Team[] = teamSeeds.map((seed) => ({
    id: seed.id,
    name: seed.name,
    online: true,
    score: 0,
    roomIndex: 0,
    currentDifficulty: rooms[0].baseDifficulty,
    currentQuestionId: rooms[0].questionIds[0],
  }));

  return {
    teams,
    turnOrder: teamSeeds.map((t) => t.id),
    currentTurnIndex: 0,
    rooms,
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

/** The id of the team whose turn it currently is, skipping offline teams (T7). */
export function currentTurnTeamId(game: GameState): string | null {
  const n = game.turnOrder.length;
  for (let i = 0; i < n; i++) {
    const idx = (game.currentTurnIndex + i) % n;
    const teamId = game.turnOrder[idx];
    const team = getTeam(game, teamId);
    if (team.online) return teamId;
  }
  // Every team is offline — no one can take a turn.
  return null;
}

/**
 * Advance to the next online team's turn. If every team is offline this is a
 * no-op (there's nothing to advance to) rather than an infinite loop — see
 * Failure modes: nextTurn() 離線隊伍處理 critical gap from /plan-eng-review.
 */
export function advanceTurn(game: GameState): GameState {
  const n = game.turnOrder.length;
  for (let i = 1; i <= n; i++) {
    const idx = (game.currentTurnIndex + i) % n;
    if (getTeam(game, game.turnOrder[idx]).online) {
      return { ...game, currentTurnIndex: idx };
    }
  }
  return game;
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

      const nextBossQuestionId = bossKilled
        ? boss.currentQuestionId
        : boss.questionIds[(boss.questionIds.indexOf(boss.currentQuestionId) + 1) % boss.questionIds.length];

      nextGame = {
        ...game,
        teams,
        boss: {
          ...boss,
          hp: newHp,
          killedByTeamId: bossKilled ? teamId : boss.killedByTeamId,
          currentQuestionId: nextBossQuestionId,
        },
      };
      outcome = { type: "correct-boss-hit", teamId, bossHpRemaining: newHp, bossKilled, killBonus };

      if (bossKilled) {
        return { game: finishGame(nextGame), outcome };
      }
    } else {
      // Wrong boss answer: rotate to the next boss question either way —
      // there's no "downgrade" concept for a shared boss queue.
      const nextBossQuestionId =
        fleeChoice === "flee"
          ? boss.questionIds[(boss.questionIds.indexOf(boss.currentQuestionId) + 1) % boss.questionIds.length]
          : boss.currentQuestionId;
      nextGame = { ...game, boss: { ...boss, currentQuestionId: nextBossQuestionId } };
      outcome =
        fleeChoice === "flee"
          ? { type: "incorrect-flee", teamId, newDifficulty: team.currentDifficulty }
          : { type: "incorrect-retry", teamId };
    }
  } else {
    const room = game.rooms[team.roomIndex];
    if (correct) {
      const pointsAwarded = team.currentDifficulty;
      const nextRoomIndex = Math.min(team.roomIndex + 1, game.rooms.length - 1);
      const nextRoom = game.rooms[nextRoomIndex];
      nextGame = {
        ...game,
        teams: game.teams.map((t) =>
          t.id === teamId
            ? {
                ...t,
                score: t.score + pointsAwarded,
                roomIndex: nextRoomIndex,
                currentDifficulty: nextRoom.baseDifficulty,
                currentQuestionId: nextRoom.questionIds[0],
              }
            : t,
        ),
      };
      outcome = { type: "correct-room-advance", teamId, pointsAwarded, nextRoomIndex };
    } else if (fleeChoice === "flee") {
      const newDifficulty = clampDifficulty(team.currentDifficulty - 1);
      nextGame = {
        ...game,
        teams: game.teams.map((t) =>
          t.id === teamId
            ? { ...t, currentDifficulty: newDifficulty, currentQuestionId: room.questionIds[0] }
            : t,
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
    })),
    bossHp: game.boss.hp,
    bossMaxHp: game.boss.maxHp,
    bossCurrentQuestionId: game.boss.currentQuestionId,
  };
}
