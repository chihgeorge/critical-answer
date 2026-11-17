"use client";
// 🎯 校正喇叭 on a joined phone (docs/designs/tap-calibrate.md): a big button to tap on every beep the big screen plays,
// stamped with the room clock like the timing button. Client-safe: no bank data.
import { useRef, useState } from "react";
import type { CalibrateRun, ClientMessage } from "@/lib/protocol";
import { useClockPings } from "./room-clock";
import type { TapPhone } from "./tap-button";
import { Panel } from "./pixel";

/** A click this soon after a pointerdown is the same press (a beat is 1 s apart, so a real second press is later). */
const CLICK_AFTER_PRESS_MS = 500;

export function CalibrateTap({ run, clock, send }: { run: CalibrateRun; clock: TapPhone["clock"]; send: (m: ClientMessage) => void }) {
  useClockPings(clock.ping, true, String(run.run));
  const [count, setCount] = useState(0);
  const pressedAt = useRef(-Infinity);
  const synced = clock.offset() !== null;
  const press = (timeStamp: number) => {
    pressedAt.current = timeStamp;
    const offset = clock.offset();
    if (offset === null) return;
    navigator.vibrate?.(30);
    send({ type: "CALIBRATE_TAP", run: run.run, at: timeStamp + offset });
    setCount((n) => n + 1);
  };
  return (
    <div data-testid="calibrate-tap">
      <Panel tone="lav" className="flex flex-col items-center gap-2 px-3 py-4 text-center">
        <div className="text-[22px]">🎯 校正喇叭</div>
        <div className="text-[16px]">聽大螢幕的嗶聲，每一聲都按一下</div>
        <button
          type="button"
          disabled={!synced}
          onPointerDown={(e) => press(e.timeStamp)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            if (!e.repeat) press(e.timeStamp);
          }}
          // A screen reader's activation is a click with no pointerdown before it.
          onClick={(e) => {
            if (e.timeStamp - pressedAt.current >= CLICK_AFTER_PRESS_MS) press(e.timeStamp);
          }}
          className="flex aspect-square w-[min(68vw,260px)] touch-manipulation select-none items-center justify-center rounded-full text-[40px] focus-visible:outline focus-visible:outline-4 focus-visible:outline-[var(--warn)]"
          style={{
            background: synced ? "#ff5050" : "#5a4a60",
            color: synced ? "#fff" : "#ccc",
            boxShadow: "0 0 0 5px var(--k), inset 0 -12px 0 #0004",
            textShadow: synced ? "3px 3px 0 var(--k)" : undefined,
          }}
        >
          {synced ? "嗶！" : "對時中…"}
        </button>
        <div className="text-[16px]">按了 {count} 下</div>
      </Panel>
    </div>
  );
}
