// Iteration-1 fixture dungeon: no host quiz-editor UI yet (deferred to
// iteration 2, see docs/designs/dungeon-master-party-game.md Next Steps #7).
// The host reads each question aloud from a printed/shared sheet that
// matches these question ids — the app only tracks state, not question text.

import type { RoomTemplate, GameConfig } from "./game-state";

export const DEFAULT_ROOMS: RoomTemplate[] = [
  { baseDifficulty: 1, questionIds: ["r0-q1", "r0-q2", "r0-q3"] },
  { baseDifficulty: 2, questionIds: ["r1-q1", "r1-q2", "r1-q3"] },
  { baseDifficulty: 2, questionIds: ["r2-q1", "r2-q2", "r2-q3"] },
  { baseDifficulty: 3, questionIds: ["r3-q1", "r3-q2", "r3-q3"] },
  { baseDifficulty: 4, questionIds: ["r4-q1", "r4-q2", "r4-q3"] },
];

export const DEFAULT_BOSS_QUESTION_IDS = [
  "boss-q1",
  "boss-q2",
  "boss-q3",
  "boss-q4",
  "boss-q5",
];

export const DEFAULT_BOSS_MAX_HP = 5;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  bossThreshold: 15, // Open Questions: 已決定固定值
};
