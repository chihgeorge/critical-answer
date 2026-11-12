"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, Sprite } from "@/components/pixel";
import { SPRITE_SIZE } from "@/lib/pixel-art";
import type { Transition } from "@/lib/transitions";

/** How long each transition covers the stage; reduced motion holds one still frame for less.
 * Keep MS just past the .px-door-*, .px-alarm-* and .px-boss-enter-* animations in app/globals.css (doors 0.6 s + 1 s,
 * alarm and boss entrance 2.4 s). */
const MS = { open: 1700, boss: 2500, sprint: 2500, cheat: 2500, catch: 2500 } as const;
const STILL_MS = { open: 1000, boss: 1500, sprint: 1500, cheat: 1500, catch: 1500 } as const;

/** ① The boss entrance's silhouette lights up into full colour this long in (one flash of the shared budget). */
const BOSS_LIT_MS = 1000;
/** The silhouette fits the 190px band. */
const BOSS_SPRITE_PX = 140;

/**
 * The opening's stone doors, the boss's alarm banner and ⚔️ 最後衝刺's banner (last-sprint.md), over the stage (lib/transitions.ts decides when).
 * They only cover: the question and narration underneath carry on. Reduced motion shows one still frame.
 */
export function TransitionOverlay({ play, onDone, flash }: { play: Transition; onDone: () => void; flash: () => boolean }) {
  const [still] = useState(prefersReducedMotion);
  // Reduced motion shows the boss in full colour from the start: no flash.
  const [lit, setLit] = useState(still);
  useEffect(() => {
    const t = setTimeout(onDone, (still ? STILL_MS : MS)[play.kind]);
    // A refused flash keeps the silhouette.
    const l = play.kind === "boss" && !still ? setTimeout(() => setLit(flash()), BOSS_LIT_MS) : undefined;
    return () => {
      clearTimeout(t);
      clearTimeout(l);
    };
  }, [play, still, onDone, flash]);
  const cls = still ? " px-still" : "";
  return (
    <div data-testid={`transition-${play.kind}`} aria-hidden className="pointer-events-none absolute inset-0" style={{ zIndex: 15 }}>
      {play.kind === "open" ? (
        <>
          <div className={`px-door px-door-l${cls}`} />
          <div className={`px-door px-door-r${cls}`} />
          <div className={`px-door-title absolute inset-x-0 text-center${cls}`} style={{ top: 190 }}>
            <div className="px-title-gold" style={{ fontSize: 64 }}>冒險開始！</div>
            {play.team && <div className="mx-auto mt-4 max-w-[860px] truncate text-[30px] text-[var(--cream)] [text-shadow:3px_3px_0_var(--k)]">第一隊：{play.team}</div>}
          </div>
        </>
      ) : play.kind === "cheat" || play.kind === "catch" ? (
        // 抓包與神諭 (anti-ai-cheating.md): the boss's red alarm, its band in red and black.
        <>
          <div className={`px-alarm-tint absolute inset-0${cls}`} />
          <div className={`px-alarm-band px-catch-band absolute inset-x-0${cls}`} style={{ top: 170, height: 170 }}>
            <div className={`px-alarm-text px-catch-text absolute inset-0 flex flex-col items-center justify-center${cls}`}>
              {play.kind === "cheat" ? (
                <>
                  <div className="px-title-danger" style={{ fontSize: 52, lineHeight: 1.1 }}>🚨 有人在問 AI！</div>
                  <div className="mt-2 text-[28px] text-[var(--cream)] [text-shadow:3px_3px_0_var(--k)]">抓包與神諭開放了</div>
                </>
              ) : (
                <>
                  <div className="px-title-danger" style={{ fontSize: 60, lineHeight: 1.1 }}>🚨 抓包！</div>
                  <div className="mt-2 max-w-[860px] truncate text-[28px] text-[var(--cream)] [text-shadow:3px_3px_0_var(--k)]">{play.by}說 {play.team} 在問 AI</div>
                </>
              )}
            </div>
          </div>
        </>
      ) : play.kind === "sprint" ? (
        // The alarm band's geometry, in --lav2 stripes, 190px for three lines.
        <div className={`px-alarm-band px-sprint-band absolute inset-x-0${cls}`} style={{ top: 160, height: 190 }}>
          <div className={`px-alarm-text px-sprint-text absolute inset-0 flex flex-col items-center justify-center${cls}`}>
            <div className="px-title-gold" style={{ fontSize: 52, lineHeight: 1.1 }}>⚔️ 魔王門開了！</div>
            <div className="mt-2 text-[26px] text-[var(--cream)] [text-shadow:3px_3px_0_var(--k)]">最後衝刺：其他隊答對一題就能進魔王房</div>
            <div className="mt-1 max-w-[860px] truncate text-[26px] text-[var(--turn)] [text-shadow:3px_3px_0_var(--k)]">{play.names.join("、")} 獲得 ✨祝福（下次答對多一半）</div>
          </div>
        </div>
      ) : (
        // ① The boss entrance (immersion.md design block): the stage goes dark for 0.5 s, then dims, so the question and
        // the answer clock outside the band stay readable; the boss's silhouette lights up, its name slams in, the band shakes.
        <>
          <div className={`px-boss-enter-tint absolute inset-0${cls}`} />
          <div className={`px-boss-enter-band absolute inset-x-0 flex items-center justify-center gap-8${cls}`} style={{ top: 165, height: 190 }}>
            <div style={{ filter: lit ? "none" : "brightness(0) drop-shadow(4px 0 0 var(--danger)) drop-shadow(-4px 0 0 var(--danger)) drop-shadow(0 4px 0 var(--danger)) drop-shadow(0 -4px 0 var(--danger))" }}>
              <Sprite kind={play.monster.kind} scale={Math.max(1, Math.min(play.monster.scale, Math.floor(BOSS_SPRITE_PX / SPRITE_SIZE[play.monster.kind][1])))} hue={play.monster.hue} accessory={play.monster.accessory} />
            </div>
            <div className="flex flex-col items-start">
              <div className="px-title-danger" style={{ fontSize: 56, lineHeight: 1.1 }}>首領出現！</div>
              <div className={`px-boss-enter-name px-title-gold mt-2 max-w-[640px] truncate${cls}`} style={{ fontSize: 40, lineHeight: 1.2 }}>{play.monster.name}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
