// One record per finished game, so the owner can tune boss HP and the boss-entry score from real play
// (owner, 2026-11-07). Built from GameState alone: team names, classes and numbers, never question or
// answer text. The room hands it to RoomIO.logGame; worker/index.ts stores it in the bank's Durable
// Object, and the bank editor downloads them all from GET /api/game-logs (owner key only).

import type { ClassId, GameState } from "./game-state";

export interface GameLog {
  startedAt: string | null;
  endedAt: string;
  /** "kill": a team slew the boss. "host": the host pressed 結束冒險. */
  endedBy: "kill" | "host";
  bossThreshold: number;
  roomRewards: number[];
  bossHitReward: number;
  bossPhases: { maxHp: number }[];
  /** The phase the game ended in, from 1, and its HP left then. */
  bossPhaseReached: number;
  bossHpLeft: number;
  /** The round of the last turn played, from 1: a round is one turn for every team still online. */
  rounds: number;
  /** The round the first team walked into the boss room, or null if none did. */
  firstBossRound: number | null;
  /** Rounds from the first boss entry to the end, both counted, or null if no team reached the boss. */
  bossRounds: number | null;
  teams: {
    name: string;
    classId: ClassId | null;
    /** 1 is the winner. */
    rank: number;
    score: number;
    reward: number;
    turns: number;
    /** The round this team walked into the boss room, and its own turns until then (that turn counted). */
    bossRound: number | null;
    turnsToBoss: number | null;
    killedBoss: boolean;
  }[];
}

export function gameLog(game: GameState, endedAt: number): GameLog {
  const rounds = game.round ?? 1;
  const entries = game.teams.flatMap((t) => (t.bossAt ? [t.bossAt.round] : []));
  const firstBossRound = entries.length ? Math.min(...entries) : null;
  const ranking = game.ranking ?? [...game.teams].sort((a, b) => b.reward - a.reward).map((t) => t.id);
  return {
    startedAt: game.startedAt === undefined ? null : new Date(game.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    endedBy: game.boss.killedByTeamId === null ? "host" : "kill",
    bossThreshold: game.config.bossThreshold,
    roomRewards: game.rooms.map((r) => r.reward),
    bossHitReward: game.boss.hitReward,
    bossPhases: game.boss.phases.map((p) => ({ maxHp: p.maxHp })),
    bossPhaseReached: game.boss.phaseIndex + 1,
    bossHpLeft: game.boss.hp,
    rounds,
    firstBossRound,
    bossRounds: firstBossRound === null ? null : rounds - firstBossRound + 1,
    teams: game.teams.map((t) => ({
      name: t.name,
      classId: t.classId ?? null,
      rank: ranking.indexOf(t.id) + 1,
      score: t.score,
      reward: t.reward,
      turns: t.turns ?? 0,
      bossRound: t.bossAt?.round ?? null,
      turnsToBoss: t.bossAt?.turns ?? null,
      killedBoss: game.boss.killedByTeamId === t.id,
    })),
  };
}

/** The Durable Object storage calls the log needs. */
export interface GameLogStorage {
  put(key: string, value: unknown): void | Promise<void>;
  list(options: { prefix: string }): Promise<Map<string, unknown>>;
}

const PREFIX = "gameLog:";

/** One key per game, so a game's write never rewrites the others. Keys sort by end time. */
export async function appendGameLog(storage: GameLogStorage, log: GameLog): Promise<void> {
  await storage.put(`${PREFIX}${log.endedAt}:${crypto.randomUUID()}`, log);
}

/** Every stored game, oldest first. */
export async function readGameLogs(storage: GameLogStorage): Promise<GameLog[]> {
  return [...(await storage.list({ prefix: PREFIX })).values()] as GameLog[];
}
