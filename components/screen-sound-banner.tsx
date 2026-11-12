"use client";

// The host page's line about the big screen's sound (docs/designs/immersion.md PR0): yellow while no screen can be
// heard, a short 🔊 once one can. Shown by the host page only while a game is playing.

import { useEffect, useState } from "react";
import type { ScreenSound } from "@/lib/protocol";
import { Panel, PixelButton } from "@/components/pixel";

const READY_TOAST_MS = 3000;

/** Remount it (a new `key`) on every reconnect: 知道了 lasts until then. */
/** `music` is the host's own 🎵 switch (⚙ 更多, immersion.md PR3): off, the screen is "muted" on purpose. */
export function ScreenSoundBanner({ sound, music = true }: { sound: ScreenSound | undefined; music?: boolean }) {
  /** 知道了: the host keeps the screen quiet on purpose (plays their own song). Until the next reconnect, or ready → not ready. */
  const [dismissed, setDismissed] = useState(false);
  const [toast, setToast] = useState(false);
  const [prev, setPrev] = useState(sound);
  // React's "adjust state when a prop changes" pattern: no effect, no extra render of the old banner.
  if (sound !== prev) {
    setPrev(sound);
    if (sound === "ready") {
      setDismissed(false);
      // Not on the page's first STATE: a host page opened mid-game has nothing to celebrate.
      if (prev !== undefined) setToast(true);
    } else setToast(false);
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(false), READY_TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  if (sound === "ready") {
    return toast ? (
      <Panel tone="lav" role="status" className="px-3 py-2 text-center text-[16px]">
        🔊 大螢幕聲音已就緒
      </Panel>
    ) : null;
  }
  if (sound === "none") {
    return (
      <Panel tone="turn" role="status" className="px-3 py-2 text-center text-[16px]" style={{ background: "var(--warn)", textWrap: "balance" }}>
        沒有大螢幕連著：用主持人頁的大螢幕連結開啟
      </Panel>
    );
  }
  if (sound !== "muted" || dismissed) return null;
  return (
    <Panel tone="turn" role="status" className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 text-center text-[16px]" style={{ background: "var(--warn)", textWrap: "balance" }}>
      <span>{music ? "大螢幕還沒開聲音：去點大螢幕右下角的「👆 開聲音」" : "大螢幕的 🎵 音樂關著：到 ⚙ 更多 打開"}</span>
      <PixelButton onClick={() => setDismissed(true)} className="!m-0 min-h-[44px] !px-3 !py-1 text-[16px]">
        知道了
      </PixelButton>
    </Panel>
  );
}
