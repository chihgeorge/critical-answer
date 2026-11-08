"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/components/pixel";
import type { Transition } from "@/lib/transitions";

/** How long each transition covers the stage; reduced motion holds one still frame for less.
 * Keep MS just past the .px-door-* and .px-alarm-* animations in app/globals.css (doors 0.6 s + 1 s, alarm 2.4 s). */
const MS = { open: 1700, boss: 2500 } as const;
const STILL_MS = { open: 1000, boss: 1500 } as const;

/**
 * The opening's stone doors and the boss's alarm banner, over the stage (lib/transitions.ts decides when).
 * They only cover: the question and narration underneath carry on. Reduced motion shows one still frame.
 */
export function TransitionOverlay({ play, onDone }: { play: Transition; onDone: () => void }) {
  const [still] = useState(prefersReducedMotion);
  useEffect(() => {
    const t = setTimeout(onDone, (still ? STILL_MS : MS)[play.kind]);
    return () => clearTimeout(t);
  }, [play, still, onDone]);
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
      ) : (
        <>
          <div className={`px-alarm-tint absolute inset-0${cls}`} />
          <div className={`px-alarm-band absolute inset-x-0${cls}`} style={{ top: 180, height: 150 }}>
            <div className={`px-alarm-text absolute inset-0 flex flex-col items-center justify-center${cls}`}>
              <div className="px-title-danger" style={{ fontSize: 60, lineHeight: 1.1 }}>首領出現！</div>
              <div className="mt-2 max-w-[860px] truncate text-[30px] text-[var(--cream)] [text-shadow:3px_3px_0_var(--k)]">{play.name}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
