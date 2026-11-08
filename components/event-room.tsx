"use client";

// What stands in the arch of an event room (docs/designs/event-rooms.md D6): the scene before the press, and what
// it turned into after. Shared by the big screen and the phone's turn card.

import type { EventScene } from "@/lib/game-state";
import type { EventReveal } from "@/lib/protocol";
import { DISH_SPRITE, type SpriteKind } from "@/lib/sprite-kind";
import { SPRITE_SIZE } from "@/lib/pixel-art";
import { Sprite } from "./pixel";

const SCENE_SPRITE: Record<EventScene, SpriteKind> = { chest: "chest", spring: "spring", idol: "idol", fairy: "fairy", fortune: "fortune-teller" };
const LOT: Partial<Record<EventReveal["outcome"], number>> = { great: 0, good: 1, bad: 2 };

/** The scene's sprite, sized to about `height` px; after the press the chest opens with its dish, the lot is drawn. */
export function EventStage({ scene, reveal, height }: { scene: EventScene; reveal?: EventReveal | null; height: number }) {
  const kind: SpriteKind = scene === "chest" && reveal ? "chest-open" : SCENE_SPRITE[scene];
  const scale = Math.max(1, Math.floor(height / SPRITE_SIZE[kind][1]));
  // A newer server's dish sprite draws as the slime's dish rather than crash.
  const dish: SpriteKind | null = reveal?.outcome === "rotten" ? "dish-rotten" : reveal?.dish ? (DISH_SPRITE[reveal.dish.sprite] ?? DISH_SPRITE.slime) : null;
  const lot = reveal ? LOT[reveal.outcome] : undefined;
  return (
    <div data-testid="event-stage" data-scene={scene} className="relative flex items-end gap-2">
      <div className={scene === "fairy" ? "px-float" : reveal?.outcome === "curse" || reveal?.outcome === "bad" ? "px-hit" : "px-idle"}>
        <Sprite kind={kind} scale={scale} />
      </div>
      {dish && (
        <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: SPRITE_SIZE[kind][1] * scale - scale * 4 }}>
          <Sprite kind={dish} scale={Math.max(1, scale - 1)} hue={reveal?.dish?.hue ?? 0} />
        </div>
      )}
      {lot !== undefined && <Sprite kind="lot" variant={lot} scale={scale} />}
    </div>
  );
}
