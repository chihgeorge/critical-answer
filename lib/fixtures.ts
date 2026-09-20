// The default dungeon, derived from the question bank (data/question-bank.json).
// Server and tests import this; the browser must not (it would pull in answers).

import type { GameConfig } from "./game-state";
import { BANK, bossQuestionIds, roomTemplates } from "./question-bank";

export const DEFAULT_ROOMS = roomTemplates(BANK);
export const DEFAULT_BOSS_QUESTION_IDS = bossQuestionIds(BANK);
export const DEFAULT_BOSS_MAX_HP = BANK.boss.maxHp;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  bossThreshold: 15, // Open Questions: 已決定固定值
};
