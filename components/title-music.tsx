"use client";

// The home page's title song and its 🎵 switch (lib/title-music.ts). Self-contained: mount it anywhere on the page.
import { useEffect, useRef, useState } from "react";
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
    const c = titleMusic(() => (player ??= createBgmPlayer()), readStored, writeStored);
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
    <button
      type="button"
      data-title-music
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => setOn(ctl.current!.toggle())}
      className="fixed right-3 top-3 z-20 flex h-11 w-11 items-center justify-center border-2 border-[var(--k)] bg-white/90 text-[20px]"
    >
      {on ? "🎵" : "🔇"}
    </button>
  );
}
