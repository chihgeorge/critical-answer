import type { Accessory } from "./monster-catalog";

/** Kept apart from lib/pixel-art.ts (which draws on a canvas) so server code can name a sprite without pulling in a browser file. */
export type SpriteKind = "slime" | "slime-lost" | "slime-king" | "ghost" | "ghost-cry" | "dragon"
  // The catalog roster, PR2 (docs/designs/monster-catalog.md R4).
  | "mushroom" | "bat" | "skeleton" | "mimic" | "spider" | "snail" | "wisp" | "golem" | "jellyfish" | "frog" | "candle" | "mandrake" | "eyeball" | "crab" | "dice" | "pumpkin" | "cactus" | "kraken" | "phoenix"
  | "owl" | "hero" | "crown" | "heart" | "torch" | "campfire" | "door" | "cloud" | "zz"
  // Cooking (docs/designs/monster-cuisine.md, cooking R6/R7): the pot, its smoke, and one dish per monster sprite.
  | "pot" | "smoke" | "dish-jelly" | "dish-stew" | "dish-tower" | "dish-ice" | "dish-riceball" | "dish-skewer"
  | "dish-mushroom-skewer" | "dish-wings" | "dish-bone-soup" | "dish-bento" | "dish-cotton-candy" | "dish-escargot" | "dish-brulee" | "dish-stone-pot" | "dish-jelly-salad" | "dish-three-cup" | "dish-fondue" | "dish-root-stew" | "dish-tangyuan" | "dish-crab" | "dish-tofu" | "dish-pumpkin-soup" | "dish-smoothie" | "dish-squid" | "dish-roast-chicken"
  // A repeat appearance's hat (docs/designs/monster-catalog.md §3).
  | `acc-${Accessory}`;

/** The monster sprites; each catalog monster's sprite is one of them (lib/monster-catalog.test.ts). */
export const MONSTER_SPRITES = ["slime", "slime-lost", "slime-king", "ghost", "ghost-cry", "dragon", "mushroom", "bat", "skeleton", "mimic", "spider", "snail", "wisp", "golem", "jellyfish", "frog", "candle", "mandrake", "eyeball", "crab", "dice", "pumpkin", "cactus", "kraken", "phoenix"] as const satisfies readonly SpriteKind[];
export type MonsterSprite = (typeof MONSTER_SPRITES)[number];

/** Each monster's cooked dish (cooking R6). A Record, so a new monster sprite fails tsc until its dish is drawn (I11). */
export const DISH_SPRITE: Record<MonsterSprite, SpriteKind> = {
  slime: "dish-jelly",
  "slime-lost": "dish-stew",
  "slime-king": "dish-tower",
  ghost: "dish-ice",
  "ghost-cry": "dish-riceball",
  dragon: "dish-skewer",
  mushroom: "dish-mushroom-skewer",
  bat: "dish-wings",
  skeleton: "dish-bone-soup",
  mimic: "dish-bento",
  spider: "dish-cotton-candy",
  snail: "dish-escargot",
  wisp: "dish-brulee",
  golem: "dish-stone-pot",
  jellyfish: "dish-jelly-salad",
  frog: "dish-three-cup",
  candle: "dish-fondue",
  mandrake: "dish-root-stew",
  eyeball: "dish-tangyuan",
  crab: "dish-crab",
  dice: "dish-tofu",
  pumpkin: "dish-pumpkin-soup",
  cactus: "dish-smoothie",
  kraken: "dish-squid",
  phoenix: "dish-roast-chicken",
};
