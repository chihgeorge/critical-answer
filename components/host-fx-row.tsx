"use client";

import { useEffect, useRef, useState } from "react";
import { HOST_EFFECTS, HOST_FX_COOLDOWN_MS, type ClientMessage, type HostEffect, type ScreenSound } from "@/lib/protocol";
import { hostPad } from "@/lib/host-fx";
import { Panel, PixelButton } from "./pixel";

/** 大螢幕加料 (docs/designs/immersion.md PR2): ⚡ 雷聲 and 👹 低吼, one sticky row at the top of the host page, in the lobby
 * too (the sound check). `sound` is STATE's `screenSound`, undefined in the lobby. */
export function HostFxRow({ clipPlaying, sound, lobby, online, send }: { clipPlaying: boolean; sound?: ScreenSound; lobby: boolean; online: boolean; send: (m: ClientMessage) => void }) {
  const [sent, setSent] = useState<HostEffect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  function press(effect: HostEffect) {
    send({ type: "HOST_EFFECT", effect });
    setSent(effect);
    timer.current = setTimeout(() => setSent(null), HOST_FX_COOLDOWN_MS);
  }
  return (
    <Panel className="sticky top-0 z-20 px-2 py-2">
      <div data-testid="host-fx" role="group" aria-label="大螢幕加料" className="grid grid-cols-2 gap-2">
        {HOST_EFFECTS.map((effect) => {
          const pad = hostPad(effect, { clipPlaying, sound, sent, online });
          return (
            <PixelButton key={effect} aria-label={pad.aria} disabled={pad.disabled} onClick={() => press(effect)} className="!m-0 min-h-[56px] !px-2 !py-1 text-[16px]" style={{ background: "#fff" }}>
              {pad.label}
            </PixelButton>
          );
        })}
      </div>
      {lobby && <div className="mt-1 text-[14px]">先在大螢幕點一下開聲音，再按 ⚡ 試聽</div>}
      <span className="sr-only" aria-live="polite">{sent ? `${sent === "thunder" ? "雷聲" : "低吼"}已送出` : ""}</span>
    </Panel>
  );
}
