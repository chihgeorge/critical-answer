"use client";

// The home page's title song and its 🎵 switch (lib/title-music.ts). Self-contained: the home page mounts it in the title plate's #title-theme-slot, which places it.
import { useEffect, useRef, useState } from "react";
import { PixelButton } from "@/components/pixel";
import { createBgmPlayer, type BgmPlayer } from "@/lib/bgm-player";
import { readStored, writeStored } from "@/lib/stored";
import { titleMusic } from "@/lib/title-music";

export function TitleMusic() {
  const ctl = useRef<ReturnType<typeof titleMusic> | null>(null);
  /** Null until mounted (and on a browser without Web Audio): no switch then. */
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!("AudioContext" in window)) return;
    let player: BgmPlayer | null = null;
    // A phone (a touch screen as its main pointer, or a narrow window) starts with the music off.
    const phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
    const c = titleMusic(() => (player ??= createBgmPlayer()), readStored, writeStored, !phone);
    ctl.current = c;
    // localStorage is read after mount, never in render (lib/stored.ts). A named function, not the effect body
    // itself: react-hooks/set-state-in-effect (as in app/bank-editor/page.tsx).
    function restore() {
      setOn(c.on());
    }
    restore();
    const onGesture = (e: Event) => {
      // The switch's own click is its toggle, not a first tap.
      if (!(e.target instanceof Element && e.target.closest("[data-title-music]"))) c.gesture();
    };
    window.addEventListener("click", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("click", onGesture);
      window.removeEventListener("keydown", onGesture);
      player?.close();
    };
  }, []);
  if (on === null) return null;
  const label = on ? "關閉首頁音樂" : "開啟首頁音樂";
  return (
    <PixelButton
      data-title-music
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => setOn(ctl.current!.toggle())}
      className="!m-0 !min-h-0 h-11 w-11 !p-0 text-[20px]"
    >
      {on ? "🎵" : "🔇"}
    </PixelButton>
  );
}
