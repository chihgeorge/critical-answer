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

/** The big screen's 2 s over a roll (class-abilities.md D12=A): the scene dims, a big d20 tumbles and lands on the
 * room's `value`. `kind`: a warrior's roll for the answer (12+ hits), or the crit die after a correct answer (20 is a
 * critical hit, 1 a fumble, still a hit). Keyed by the caller per roll, so every roll tumbles again. */
export function RollOverlay({ teamName, value, kind = "warrior", critable = false, bonus = 0, dc = 0 }: { teamName: string; value: number; kind?: "warrior" | "crit" | "check"; critable?: boolean; bonus?: number; dc?: number }) {
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
  const crit = kind === "crit";
  const check = kind === "check";
  // A persuasion check (dnd design R6): die + class bonus against the monster's DC; a 20 wins outright, a 1 halves.
  const hit = check ? value === 20 || (value !== 1 && value + bonus >= dc) : crit ? value !== 1 : value >= WARRIOR_TARGET;
  const result = check
    ? value === 20
      ? "20！說服成功，免答"
      : value === 1
        ? "1……說服失敗，答對只拿一半"
        : `${value} + ${bonus} = ${value + bonus} ${hit ? "≥" : "<"} DC ${dc}${hit ? " 過了！" : " 沒過"}`
    : crit
    ? value === 20
      ? "20 大成功！多拿一半"
      : value === 1
        ? "1 大失敗……還是打中了"
        : `${value}，答對！`
    : critable && value === 20 // a warrior's 20 on a multipleChoice question is a crit too (game-state warriorRoll)
      ? "20 大成功！命中，多拿一半"
      : hit
        ? `${value} ≥ ${WARRIOR_TARGET} 命中！`
        : `${value}，差一點……`;
  return (
    <div data-testid="roll-overlay" data-kind={kind} className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 8, background: "#1b132099" }}>
      <div className="text-[18px]">
        <LabelChip>
          {check ? `🗣️ ${teamName} 說服檢定：d20 + ${bonus}，DC ${dc}` : crit ? `✨ ${teamName} 答對！擲暴擊骰，20 是大成功` : `⚔️ ${teamName} 擲骰！${WARRIOR_TARGET} 以上就贏`}
        </LabelChip>
      </div>
      <div className={landed ? undefined : "px-roll-tumble"}>
        <D20 value={landed ? value : face} size={190} />
      </div>
      <div
        data-testid="roll-result"
        className={`px-bar text-[26px] ${landed && hit ? "ok" : ""}`}
        style={{
          visibility: landed ? "visible" : "hidden",
          ...(landed && !hit ? { background: "var(--danger)", color: "#fff" } : {}),
          ...(landed && (crit || check || critable) && value === 20 ? { background: "var(--warn)", color: "var(--k)", boxShadow: "inset 0 -6px 0 var(--orange)" } : {}),
        }}
      >
        {result}
      </div>
    </div>
  );
}
