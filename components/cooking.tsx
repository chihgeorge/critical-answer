"use client";

// 🍲 上菜 on the big screen (docs/designs/monster-cuisine.md, cooking R7): the defeated monster, then the pot,
// a puff of smoke and the dish. Every change is a hard cut between frames (cooking I8, DESIGN.md: no tweens).

import { useEffect, useRef, useState } from "react";
import { COOK_MS, FINISH_PODIUM_MS, type AnswerReveal } from "@/lib/protocol";
import { DISH_SPRITE } from "@/lib/sprite-kind";
import { Panel, prefersReducedMotion, Sprite } from "@/components/pixel";

type Dish = NonNullable<AnswerReveal["dish"]>;

/** 0 the monster, 1 the pot, 2 the smoke, 3 the dish. */
export type CookStep = 0 | 1 | 2 | 3;
/** When each frame comes up, in ms after 上菜. */
const STEP_AT: [CookStep, number][] = [
  [1, 400],
  [2, 1200],
  [3, COOK_MS],
];

/**
 * Which cooking frame is up. `served` is the key of the served dish (null before 上菜). Only a change seen while the
 * page is open plays the frames (cooking I3): a page that opens on a served dish, or reduced motion, shows the dish.
 * `onPlay` runs when the frames start, `onDish` when the dish comes up after them.
 */
export function useCookStep(served: string | null, onPlay?: () => void, onDish?: () => void): CookStep | null {
  const [shown, setShown] = useState(served);
  const [step, setStep] = useState<CookStep | null>(served ? 3 : null);
  /** The served key whose frames are playing, null when none are. */
  const [play, setPlay] = useState<string | null>(null);
  if (served !== shown) {
    setShown(served);
    const animate = !!served && !prefersReducedMotion();
    setPlay(animate ? served : null);
    setStep(served ? (animate ? 0 : 3) : null);
  }
  const calls = useRef({ onPlay, onDish });
  useEffect(() => {
    calls.current = { onPlay, onDish };
  });
  useEffect(() => {
    if (!play) return;
    calls.current.onPlay?.();
    const timers = STEP_AT.map(([s, at]) =>
      setTimeout(() => {
        setStep(s);
        if (s === 3) calls.current.onDish?.();
      }, at),
    );
    return () => timers.forEach(clearTimeout);
  }, [play]);
  return step;
}

/**
 * The end screen after a boss kill seen live (cooking R8): the boss cooks like any monster (steps 0–3), its dish holds,
 * and at 4 the winner, the podium and the epilogue come up. `play` is read once, when the screen mounts; false (a
 * page opened on the end screen, no dish, reduced motion) goes straight to 4.
 */
export function useFinaleStep(play: boolean, onPlay?: () => void, onDish?: () => void, onPodium?: () => void): CookStep | 4 {
  const [start] = useState(() => play && !prefersReducedMotion());
  const [step, setStep] = useState<CookStep | 4>(start ? 0 : 4);
  const calls = useRef({ onPlay, onDish, onPodium });
  useEffect(() => {
    calls.current = { onPlay, onDish, onPodium };
  });
  useEffect(() => {
    if (!start) {
      calls.current.onPodium?.();
      return;
    }
    calls.current.onPlay?.();
    const timers = [...STEP_AT, [4, FINISH_PODIUM_MS] as const].map(([s, at]) =>
      setTimeout(() => {
        setStep(s);
        if (s === 3) calls.current.onDish?.();
        if (s === 4) calls.current.onPodium?.();
      }, at),
    );
    return () => timers.forEach(clearTimeout);
  }, [start]);
  return step;
}

/** The narrator's line once the dish is up (cooking I1): typed and read on the big screen. */
export function dishLine(dish: Dish, team: string, boss: boolean): string {
  return boss ? `今晚的大菜：${dish.name}！` : `今晚的菜：${dish.name}！${team}吃下 ${dish.points} 飽足感。`;
}

const POP = { fontSize: 26, padding: "2px 10px", background: "var(--k)", color: "#fff" } as const;

/** The pot or the smoke, in the monster's spot (steps 1 and 2). */
export function CookFrame({ step, bottom }: { step: 1 | 2; bottom: number }) {
  return (
    <div className="absolute" style={{ left: "50%", bottom, transform: "translateX(-50%)", zIndex: 4 }}>
      {step === 1 ? (
        <div className="relative" style={{ width: 200, height: 170 }}>
          <Sprite kind="pot" variant={0} scale={5} className="px-tf1 absolute inset-0" />
          <Sprite kind="pot" variant={1} scale={5} className="px-tf2 absolute inset-0" />
          <div className="absolute whitespace-nowrap" style={{ ...POP, left: 210, top: 20 }}>咕嘟咕嘟</div>
        </div>
      ) : (
        <div className="relative">
          <Sprite kind="smoke" scale={6} />
          <div className="absolute whitespace-nowrap" style={{ ...POP, left: 250, top: 40 }}>砰！</div>
        </div>
      )}
    </div>
  );
}

/** The cooked dish: its picture, tinted like the monster, beside the card (step 3). */
export function DishServed({ dish, title = "今晚的菜", scale = 5 }: { dish: Dish; title?: string; scale?: number }) {
  return (
    <div data-testid="dish-served" className="flex items-center justify-center gap-6">
      <Sprite kind={DISH_SPRITE[dish.monster.sprite]} scale={scale} hue={dish.monster.hue} />
      <DishCard dish={dish} title={title} />
    </div>
  );
}

/** The defeated monster, cooked (docs/designs/monster-cuisine.md, approved mockup A). */
export function DishCard({ dish, title = "今晚的菜" }: { dish: Dish; title?: string }) {
  return (
    <Panel tone="lav" className="px-[18px] pt-3 pb-[14px] text-center" style={{ maxWidth: 360 }}>
      <div data-testid="dish-card">
        <div className="text-[28px] leading-[1.25]">
          🍲 {title}：<br />
          {dish.name}
        </div>
        <div className="text-[18px]" style={{ color: "#6a4d74" }}>
          {dish.part}・{dish.method}
        </div>
        <div className="text-[20px]">「{dish.comment}」</div>
        <div className="mt-1 text-[22px]" style={{ color: "var(--ok2)" }}>
          <span className="px-num">+{dish.points}</span> 飽足感
        </div>
      </div>
    </Panel>
  );
}
