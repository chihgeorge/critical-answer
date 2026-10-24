/** Kept apart from lib/pixel-art.ts (which draws on a canvas) so server code can name a sprite without pulling in a browser file. */
export type SpriteKind = "slime" | "slime-lost" | "slime-king" | "ghost" | "ghost-cry" | "dragon" | "owl" | "hero" | "crown" | "heart" | "torch" | "campfire" | "door" | "cloud" | "zz";
