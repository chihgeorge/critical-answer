"use client";

// 每題作答倒數 (docs/designs/answer-countdown.md D5): the room's `left`, counted down here. Key it by `left` so each
// STATE restarts it from the room's figure, like 擲先攻's Countdown (components/d20.tsx).

import { useEffect, useState } from "react";
import { ANSWER_WARN_SECONDS, secondsLeft } from "@/lib/answer-clock";

/** `big`: the big screen's round clock beside the monster. `chip`: the phone's and the host page's ⏱ chip.
 * `onSecond` hears every whole second shown (the big screen ticks on it), possibly twice when a STATE remounts it. */
export function AnswerClock({ ms, variant, onSecond }: { ms: number; variant: "big" | "wall" | "chip"; onSecond?: (s: number) => void }) {
  const [end] = useState(() => Date.now() + ms);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = secondsLeft(end - now);
  useEffect(() => onSecond?.(s), [s, onSecond]);
  const warn = s <= ANSWER_WARN_SECONDS;
  if (variant === "chip") {
    return (
      <span data-testid="answer-clock" data-left={s} className="px-chip" style={warn ? { background: "var(--danger)", color: "var(--k)" } : { color: "#fff" }}>
        {s === 0 ? "⏰ 時間到" : `⏱ ${s}`}
      </span>
    );
  }
  if (variant === "wall") {
    // The big screen's clock when option tiles fill the wall: a pill under the B/D tiles, so it never covers an option.
    return (
      <div data-testid="answer-clock" data-left={s} role="timer" aria-label={s === 0 ? "時間到" : `還有 ${s} 秒`} className="flex items-center gap-2 rounded-full px-4" style={{ height: 38, background: "var(--k)", border: `4px solid ${warn ? "var(--danger)" : "var(--warn)"}`, color: warn ? "var(--danger)" : "#fff", fontSize: 26, lineHeight: 1 }}>
        {s === 0 ? "⏰ 時間到" : <>⏱ <span className="px-num" style={{ fontSize: 22 }}>{s}</span></>}
      </div>
    );
  }
  return (
    <div
      data-testid="answer-clock"
      data-left={s}
      role="timer"
      aria-label={s === 0 ? "時間到" : `還有 ${s} 秒`}
      className="flex items-center justify-center rounded-full text-center"
      style={{ width: 120, height: 120, background: "var(--k)", border: `6px solid ${warn ? "var(--danger)" : "var(--warn)"}`, color: warn ? "var(--danger)" : "#fff", fontSize: s === 0 ? 24 : 52, lineHeight: 1.1 }}
    >
      {s === 0 ? "⏰ 時間到" : s}
    </div>
  );
}
