/** Kept apart from lib/pixel-art.ts (which draws on a canvas) so server code can name a sprite without pulling in a browser file. */
export type SpriteKind = "slime" | "slime-lost" | "slime-king" | "ghost" | "ghost-cry" | "dragon" | "owl" | "hero" | "crown" | "heart" | "torch" | "campfire" | "door" | "cloud" | "zz"
  // Cooking (docs/designs/monster-cuisine.md, cooking R6/R7): the pot, its smoke, and one dish per monster sprite.
  | "pot" | "smoke" | "dish-jelly" | "dish-stew" | "dish-tower" | "dish-ice" | "dish-riceball" | "dish-skewer";

/** The sprites a bank monster may use (lib/question-bank.ts checks a bank against this list). */
export const MONSTER_SPRITES = ["slime", "slime-lost", "slime-king", "ghost", "ghost-cry", "dragon"] as const satisfies readonly SpriteKind[];
export type MonsterSprite = (typeof MONSTER_SPRITES)[number];

/** Each monster's cooked dish (cooking R6). A Record, so a new monster sprite fails tsc until its dish is drawn (I11). */
export const DISH_SPRITE: Record<MonsterSprite, SpriteKind> = {
  slime: "dish-jelly",
  "slime-lost": "dish-stew",
  "slime-king": "dish-tower",
  ghost: "dish-ice",
  "ghost-cry": "dish-riceball",
  dragon: "dish-skewer",
};
