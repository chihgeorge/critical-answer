"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/** Logical size of the big-screen stage. Every approved mockup was laid out at this size. */
const STAGE_W = 960;
const STAGE_H = 540;

function subscribe(cb: () => void) {
  addEventListener("resize", cb);
  return () => removeEventListener("resize", cb);
}
const fitScale = () => Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);

/**
 * Fixed-size stage scaled to fit the window with transform: scale(), centered
 * and letterboxed outside 16:9. 1920x1080 is exactly 2x and 4K exactly 4x, so
 * pixel art stays sharp on the common TV sizes.
 */
export function Stage({ children }: { children: ReactNode }) {
  const scale = useSyncExternalStore(subscribe, fitScale, () => 1);
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div
        className="absolute overflow-hidden"
        style={{
          left: "50%",
          top: "50%",
          width: STAGE_W,
          height: STAGE_H,
          background: "var(--stage)",
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
