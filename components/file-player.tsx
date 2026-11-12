"use client";

// An uploaded video or audio file on the big screen (docs/designs/uploaded-media.md D4): a native <video> driven by
// the host's ▶ ⏸ ⟲ through the same playerSteps as YoutubePlayer. Audio plays in the same element under the music card.
import { useEffect, useRef, useState } from "react";
import { CLIP_STATUS_TEXT, playerSteps, type ClipStatus, type MediaWant } from "@/lib/youtube";
import { MusicCard } from "./youtube-player";

const PAUSED: MediaWant = { state: "paused", seq: 0 };

export function FilePlayer({
  url,
  command,
  width,
  height,
  cover = false,
  cardTitle,
  needsTap = false,
  onPlayingChange,
  onEnded,
  onError,
  errorNote,
  title = "題目影片",
}: {
  url: string;
  /** The host's last command for this clip; null or absent is paused. */
  command?: MediaWant | null;
  width: number;
  height: number;
  /** An audio file: the music card covers the (empty) picture. */
  cover?: boolean;
  /** The music card's title (聽歌猜題, 正解音樂, 詳解音樂). */
  cardTitle?: string;
  /** Nobody has tapped the big screen yet, so the browser will block the sound. */
  needsTap?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  onEnded?: () => void;
  onError?: () => void;
  errorNote?: string;
  title?: string;
}) {
  const el = useRef<HTMLVideoElement>(null);
  const applied = useRef<MediaWant | null>(null);
  const [status, setStatus] = useState<ClipStatus>("loading");
  /** Goes up to load the file again: a ▶ or ⟲ while it shows 影片無法播放 retries (venue Wi-Fi). */
  const [attempt, setAttempt] = useState(0);
  // The reveal swaps in an explanation's file on the same player: it starts over, not under the last clip's error (review).
  const [seenUrl, setSeenUrl] = useState(url);
  if (url !== seenUrl) {
    setSeenUrl(url);
    setStatus("loading");
  }
  const report = useRef(onPlayingChange);
  const reportEnd = useRef(onEnded);
  const reportError = useRef(onError);
  useEffect(() => {
    report.current = onPlayingChange;
    reportEnd.current = onEnded;
    reportError.current = onError;
  }, [onPlayingChange, onEnded, onError]);

  const show = (s: ClipStatus) => {
    setStatus(s);
    if (s !== "loading") report.current?.(s === "playing");
    if (s === "ended") reportEnd.current?.();
    if (s === "error") reportError.current?.();
  };

  // A new file (or a retry) starts from nothing applied: the first command is the starting point, as in YoutubePlayer.
  useEffect(() => {
    applied.current = null;
    return () => report.current?.(false);
  }, [url, attempt]);

  const want = command ?? PAUSED;
  const [seenPress, setSeenPress] = useState(want.press);
  if (want.press !== seenPress) {
    setSeenPress(want.press);
    if (status === "error" && want.state === "playing") {
      setStatus("loading");
      setAttempt((a) => a + 1);
    }
  }
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    const next = { state: want.state, seq: want.seq };
    const steps = playerSteps(applied.current, next, v.ended);
    applied.current = next;
    for (const step of steps) {
      if (step === "pause") v.pause();
      else {
        if (step === "restart") v.currentTime = 0;
        // Blocked autoplay (no tap yet) or a pause that came first: the needsTap card says what to do.
        v.play().catch(() => {});
      }
    }
  }, [want.state, want.seq, want.press, url, attempt]);
  // A new file or a retry mounts a fresh element.
  const mount = url + "#" + attempt;

  return (
    <div data-testid="file-player" data-status={status} className="relative shrink-0" style={{ width, height, boxShadow: "0 0 0 4px var(--k)" }}>
      <video
        key={mount}
        ref={el}
        src={url}
        aria-label={title}
        preload="auto"
        playsInline
        width={width}
        height={height}
        style={{ width, height, objectFit: "contain", background: "var(--k)" }}
        onCanPlay={() => status === "loading" && show(el.current?.paused === false ? "playing" : "paused")}
        onWaiting={() => setStatus("loading")}
        onPlaying={() => show("playing")}
        onPause={() => !el.current?.ended && show("paused")}
        onEnded={() => show("ended")}
        onError={() => show("error")}
      />
      {cover && status !== "error" && <MusicCard status={status} start={0} title={cardTitle} />}
      {status === "error" && (
        <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--k)] text-[24px] text-[var(--cream)]">
          {CLIP_STATUS_TEXT.error}
          {errorNote && (
            <span data-testid="clip-error-note" className="px-chip text-[20px]" style={{ background: "var(--warn)", color: "var(--k)" }}>
              {errorNote}
            </span>
          )}
        </div>
      )}
      {needsTap && status !== "error" && (
        <div role="status" className="absolute inset-0 flex items-center justify-center text-center text-[22px] leading-[1.4]" style={{ background: cover ? "rgb(42,21,51)" : "rgba(42,21,51,0.88)", color: "#fff0a8" }}>
          👆 點一下大螢幕
          <br />
          才能播放聲音
        </div>
      )}
    </div>
  );
}
