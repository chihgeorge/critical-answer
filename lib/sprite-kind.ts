/** Kept apart from lib/pixel-art.ts (which draws on a canvas) so server code can name a sprite without pulling in a browser file. */
export type SpriteKind = "slime" | "ghost" | "dragon" | "owl" | "hero" | "crown" | "heart" | "torch" | "campfire";
