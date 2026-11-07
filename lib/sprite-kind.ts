import type { Accessory } from "./monster-catalog";

/** Kept apart from lib/pixel-art.ts (which draws on a canvas) so server code can name a sprite without pulling in a browser file. */
export type SpriteKind = "slime" | "slime-lost" | "slime-king" | "ghost" | "ghost-cry" | "dragon" | "owl" | "hero" | "crown" | "heart" | "torch" | "campfire" | "door" | "cloud" | "zz"
  // Cooking (docs/designs/monster-cuisine.md, cooking R6/R7): the pot, its smoke, and one dish per monster sprite.
  | "pot" | "smoke" | "dish-jelly" | "dish-stew" | "dish-tower" | "dish-ice" | "dish-riceball" | "dish-skewer"
  // A repeat appearance's hat (docs/designs/monster-catalog.md §3).
  | `acc-${Accessory}`;

/** The monster sprites; each catalog monster's sprite is one of them (lib/monster-catalog.test.ts). */
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
