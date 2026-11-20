"use client";

// 占卜師 (docs/designs/fortune-teller.md): the pizza of effects, one slice lit once picked, and the effect card naming the
// teams the condition hit. Shared by the big screen and the phones. Pure view, no question or answer.

import { FORTUNE_EFFECTS, type ClassId, type FortuneEffect } from "@/lib/game-state";
import { FORTUNE_CONDITION_TEXT, FORTUNE_EFFECT_TEXT } from "@/lib/event-text";
import type { FortuneView } from "@/lib/protocol";
import { prefersReducedMotion, Sprite } from "./pixel";
import { lookOf } from "@/lib/team-look";

const TONE: Record<"good" | "bad" | "swap", string> = { good: "#6fd36a", bad: "#ff6b6b", swap: "#ffcf4a" };

/** The pizza: a slice an effect, the picked one lit and the rest dimmed. */
export function FortunePizza({ lit, size }: { lit?: FortuneEffect; size: number }) {
  const n = FORTUNE_EFFECTS.length;
  const r = 50;
  const at = (i: number) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  };
  return (
    <svg data-testid="fortune-pizza" {...(lit ? { "data-lit": lit } : {})} viewBox="-4 -4 108 108" width={size} height={size} role="img" aria-label="命運披薩">
      {FORTUNE_EFFECTS.map((e, i) => {
        const [x1, y1] = at(i);
        const [x2, y2] = at(i + 1);
        const [tx, ty] = (() => {
          const a = ((i + 0.5) / n) * 2 * Math.PI - Math.PI / 2;
          return [50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)];
        })();
        const on = lit === e;
        const dim = !!lit && !on;
        return (
          <g key={e} opacity={dim ? 0.3 : 1} style={{ transition: prefersReducedMotion() ? undefined : "opacity 400ms" }}>
            <path d={`M50 50 L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`} fill={on ? TONE[FORTUNE_EFFECT_TEXT[e].tone] : "#f2c36b"} stroke="#7a3b12" strokeWidth={2} />
            <text x={tx} y={ty - 2} textAnchor="middle" dominantBaseline="middle" fontSize={13}>{FORTUNE_EFFECT_TEXT[e].icon}</text>
            <text x={tx} y={ty + 11} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#3a1a06">{FORTUNE_EFFECT_TEXT[e].name}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The heroes' sprite scale on the effect card. The card must clear the big screen's narration box, so the heroes stay
 * on one row, and drop from 4 to 3 when the 「選的人自己也中了！」 line takes room or a row at 4 would not fit (7 or
 * more; MAX_TEAMS 8 fit at 3). */
export function fortuneHeroScale(matches: number, self: boolean): 3 | 4 {
  return self || matches > 6 ? 3 : 4;
}

/** The effect card (step 4): the effect, the count that hit, and each matching team's hero. Big screen only. */
export function FortuneCard({ fortune, teams }: { fortune: FortuneView; teams: { id: string; name: string; classId?: ClassId; look?: number }[] }) {
  if (!fortune.effect || !fortune.matchIds) return null;
  const fx = FORTUNE_EFFECT_TEXT[fortune.effect];
  const unit = FORTUNE_CONDITION_TEXT[fortune.condition].unit;
  const self = fortune.matchIds.includes(fortune.teamId);
  const heroScale = fortuneHeroScale(fortune.matchIds.length, self);
  return (
    <div data-testid="fortune-card" data-effect={fortune.effect} className="flex flex-col items-center gap-1 text-center">
      <div className="px-title-gold px-title-sm" style={{ fontSize: "1.6em", lineHeight: 1.2 }}>{fx.icon} {fx.name}！</div>
      <div>{fx.line}</div>
      <div className="flex w-full justify-center gap-3">
        {fortune.matchIds.map((id) => {
          const idx = teams.findIndex((t) => t.id === id);
          return (
            <div key={id} className="flex min-w-0 flex-col items-center gap-1" style={{ flex: "0 1 160px" }}>
              <Sprite kind="hero" variant={lookOf(teams[idx], Math.max(0, idx))} cls={teams[idx]?.classId} scale={heroScale} />
              <div className="w-full truncate">{teams[idx]?.name ?? ""}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: "0.8em" }}>{fortune.value} {unit}</div>
      {self && <div data-testid="fortune-self">選的人自己也中了！</div>}
    </div>
  );
}
