"use client";

import { useEffect, useState } from "react";
import { WARRIOR_TARGET } from "@/lib/game-state";
import { LabelChip } from "@/components/pixel";

/** A pixel-outlined d20 face: the hexagon with its front triangle, `value` in the middle. */
export function D20({ value, size }: { value: number | string; size: number }) {
  const edge = { stroke: "var(--k)", strokeWidth: 3 };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ display: "block", filter: "drop-shadow(0 6px 0 var(--k))" }}>
      <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="#ffa94d" stroke="var(--k)" strokeWidth={5} />
      <polygon points="50,18 84,74 16,74" fill="#ffd9a3" {...edge} />
      {["50,3 50,18", "7,27 50,18", "93,27 50,18", "16,74 7,73", "84,74 93,73", "16,74 50,97", "84,74 50,97"].map((l) => {
        const [a, b] = l.split(" ").map((p) => p.split(",").map(Number));
        return <line key={l} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} {...edge} />;
      })}
      <text x="50" y="62" textAnchor="middle" fontFamily="'Press Start 2P', monospace" fontSize="20" fill="var(--k)">
        {value}
      </text>
    </svg>
  );
}

/** How long the die tumbles before it lands; the room judges at 2000 ms (BEAT_MS), so the result stays up a moment. */
const TUMBLE_MS = 1200;

/** The big screen's 2 s over a warrior's roll (class-abilities.md D12=A): the scene dims, a big d20
 * tumbles and lands on the room's `value`. Keyed by the caller per roll, so every roll tumbles again. */
export function RollOverlay({ teamName, value }: { teamName: string; value: number }) {
  const [face, setFace] = useState<number | null>(null);
  useEffect(() => {
    // Reduced motion: no face flicker either (the CSS tumble already stops), the die shows its value at once.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tick = setInterval(() => setFace(1 + Math.floor(Math.random() * 20)), 80);
    const land = setTimeout(() => {
      clearInterval(tick);
      setFace(null);
    }, TUMBLE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(land);
    };
  }, []);
  const landed = face === null;
  const hit = value >= WARRIOR_TARGET;
  return (
    <div data-testid="roll-overlay" className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 8, background: "#1b132099" }}>
      <div className="text-[18px]">
        <LabelChip>⚔️ {teamName} 擲骰！{WARRIOR_TARGET} 以上就贏</LabelChip>
      </div>
      <div className={landed ? undefined : "px-roll-tumble"}>
        <D20 value={landed ? value : face} size={190} />
      </div>
      <div className={`px-bar text-[26px] ${landed && hit ? "ok" : ""}`} style={{ visibility: landed ? "visible" : "hidden", ...(landed && !hit ? { background: "var(--danger)", color: "#fff" } : {}) }}>
        {hit ? `${value} ≥ ${WARRIOR_TARGET} 命中！` : `${value}，差一點……`}
      </div>
    </div>
  );
}
