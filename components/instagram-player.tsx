"use client";

// An Instagram video on the big screen and in the bank editor (docs/designs/instagram-explanations.md). The official
// embed has no player API and sends no play or end event, so: someone at the screen clicks the video; the host's ▶
// only asks for that click; ⏸ and ⟲ mount the embed again, which stops it. A click is seen as focus moving into the
// iframe. Never downloads Instagram's video (its terms).

import { useEffect, useRef, useState } from "react";
import { INSTAGRAM_ORIGIN, instagramEmbedUrl, measuredHeight } from "@/lib/instagram";
import { playerSteps, type MediaWant } from "@/lib/youtube";

/** The embed's own width, and its height before its first MEASURE message. */
const EMBED_W = 326;
const EMBED_H = 640;
const FOCUS_POLL_MS = 250;

export function InstagramPlayer({
  shortcode,
  end,
  command,
  maxWidth,
  maxHeight,
  onPlayingChange,
  title = "詳解影片",
}: {
  shortcode: string;
  /** The video's length in seconds: this long after the click it counts as over. */
  end?: number;
  /** The host's last ▶ ⏸ ⟲; absent in the bank editor, where the click is all there is. */
  command?: MediaWant | null;
  maxWidth: number;
  maxHeight: number;
  /** Someone clicked the video (true), or it ended, stopped or left (false): the music goes silent meanwhile. */
  onPlayingChange?: (playing: boolean) => void;
  title?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(EMBED_H);
  /** Goes up to mount the embed again: back to its cover, sound off. */
  const [mount, setMount] = useState(0);
  const [clicked, setClicked] = useState(false);
  const report = useRef(onPlayingChange);
  useEffect(() => {
    report.current = onPlayingChange;
  }, [onPlayingChange]);

  // ⏸ and ⟲ (and a first command after a reconnect) stop the video the only way the embed allows.
  const applied = useRef<MediaWant | null>(null);
  const want = command ?? null;
  useEffect(() => {
    if (!want) return;
    const next = { state: want.state, seq: want.seq };
    const steps = playerSteps(applied.current, next, false);
    const first = applied.current === null;
    applied.current = next;
    if (!first && steps.some((s) => s === "pause" || s === "restart")) {
      setMount((m) => m + 1);
      setClicked(false);
    }
  }, [want?.state, want?.seq, want?.press]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== INSTAGRAM_ORIGIN || e.source !== frame.current?.contentWindow) return;
      const h = measuredHeight(e.data);
      if (h !== null) setHeight(h);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A click inside a cross-origin iframe moves focus into it; nothing else tells the page.
  useEffect(() => {
    if (clicked) return;
    const timer = setInterval(() => {
      if (frame.current && document.activeElement === frame.current) setClicked(true);
    }, FOCUS_POLL_MS);
    return () => clearInterval(timer);
  }, [clicked, mount]);

  useEffect(() => {
    if (!clicked) return;
    report.current?.(true);
    const timer = end !== undefined ? setTimeout(() => report.current?.(false), end * 1000) : undefined;
    return () => {
      clearTimeout(timer);
      report.current?.(false);
    };
  }, [clicked, end]);

  const scale = Math.min(1, maxWidth / EMBED_W, maxHeight / height);
  const asking = want?.state === "playing" && !clicked;
  return (
    <div data-testid="instagram-player" data-clicked={clicked || undefined} className="flex flex-col items-center gap-2">
      <div style={{ width: EMBED_W * scale, height: height * scale, overflow: "hidden", boxShadow: "0 0 0 4px var(--k)", background: "#fff" }}>
        <iframe
          key={mount}
          ref={frame}
          src={instagramEmbedUrl(shortcode)}
          title={title}
          width={EMBED_W}
          height={height}
          allow="autoplay; encrypted-media; fullscreen"
          style={{ border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
      </div>
      {asking && (
        <div data-testid="instagram-click-hint" role="status" className="px-chip text-[22px]" style={{ background: "var(--warn)", color: "var(--k)" }}>
          👆 點影片開始播放
        </div>
      )}
    </div>
  );
}
