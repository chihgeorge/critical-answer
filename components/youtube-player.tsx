"use client";

// The big screen's YouTube player (docs/designs/youtube-questions.md D2, D4): the official IFrame API,
// driven by the host's ▶ ⏸ ⟲. The decisions live in lib/youtube.ts (playerSteps, clipStatusFromYoutube);
// this file only wires them to window.YT.
//
// gstack-shortcut(dec-b741774e): the host page sees only its own commands, not the real playback state
// (stopped at the clip's end, video blocked); upgrade when someone hosts away from the big screen, or a
// broken video costs a turn at an event.

import { useEffect, useRef, useState } from "react";
import { CLIP_STATUS_TEXT, clipStatusFromYoutube, playerSteps, type ClipStatus, type MediaWant } from "@/lib/youtube";

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width: number;
      height: number;
      host?: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: (e: { target: YTPlayer }) => void;
        onStateChange: (e: { data: number; target: YTPlayer }) => void;
        onError: () => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = "https://www.youtube.com/iframe_api";
/** A network that drops the script without an error (some venue Wi-Fi) must not leave 準備中 up forever. */
const API_TIMEOUT_MS = 15_000;
let api: Promise<YTNamespace> | null = null;

/** Loads iframe_api once per page; a failure lets the next player try again. */
function loadYoutubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const fail = () => {
      api = null;
      // iframe_api is a loader that sets YT = {loading} and fetches the real API itself; if that second script was
      // lost, a half-made YT makes every later load a no-op. Drop it so the next try starts clean.
      if (window.YT && !window.YT.Player) delete window.YT;
      reject(new Error("youtube iframe_api did not load"));
    };
    const timer = setTimeout(fail, API_TIMEOUT_MS);
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else fail();
    };
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      fail();
    };
    document.head.appendChild(script);
  });
  return api;
}

const PAUSED: MediaWant = { state: "paused", seq: 0 };
const END_POLL_MS = 250;

export function YoutubePlayer({
  videoId,
  start = 0,
  end,
  command,
  width,
  height,
  cover = false,
  controls = false,
  needsTap = false,
  onPlayingChange,
  onEnded,
  title = "題目影片",
}: {
  videoId: string;
  start?: number;
  end?: number;
  /** The host's last command for this video; null or absent is paused (an older server, another question). */
  command?: MediaWant | null;
  width: number;
  height: number;
  /** A music question: the pixel card hides the picture (D3, D15). */
  cover?: boolean;
  /** YouTube's own controls: the bank editor's preview. The big screen has no mouse. */
  controls?: boolean;
  /** Nobody has tapped the big screen yet, so the browser will block the sound (D16). */
  needsTap?: boolean;
  /** Called with the player's real state, not the host's command: the clip stops itself at `end` (D10 correction). */
  onPlayingChange?: (playing: boolean) => void;
  /** The clip reached its end (YouTube's own end, or `end`): the answer countdown starts (answer-countdown.md D4). */
  onEnded?: () => void;
  title?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const applied = useRef<MediaWant | null>(null);
  const ended = useRef(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ClipStatus>("loading");
  /** Goes up to build the player again: a ▶ or ⟲ while it shows 影片無法播放 retries (venue Wi-Fi, D26). */
  const [attempt, setAttempt] = useState(0);
  const report = useRef(onPlayingChange);
  const reportEnd = useRef(onEnded);
  useEffect(() => {
    report.current = onPlayingChange;
    reportEnd.current = onEnded;
  }, [onPlayingChange, onEnded]);

  useEffect(() => {
    let gone = false;
    let made: YTPlayer | null = null;
    const show = (s: ClipStatus) => {
      if (gone) return;
      setStatus(s);
      // A stall mid-clip (buffering reads as loading) must not bring the music back for a moment.
      if (s !== "loading") report.current?.(s === "playing");
      if (s === "ended") reportEnd.current?.();
    };
    loadYoutubeApi().then(
      (YT) => {
        if (gone || !host.current) return;
        // YT.Player replaces the element it is given; a child keeps React's own node intact.
        const el = document.createElement("div");
        host.current.replaceChildren(el);
        made = new YT.Player(el, {
          videoId,
          width,
          height,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            start,
            ...(end !== undefined ? { end } : {}),
            controls: controls ? 1 : 0,
            disablekb: controls ? 0 : 1,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onReady: (e) => {
              if (gone) return;
              player.current = e.target;
              setReady(true);
              show("paused");
            },
            onStateChange: (e) => {
              // YouTube can reach the end itself (its own `end`, or a clip with none) before the poll sees it.
              if (e.data === 0) ended.current = true;
              show(clipStatusFromYoutube(e.data, ended.current));
            },
            // onError codes 2, 5, 100, 101 and 150 all leave nothing to play: one message covers them (D7).
            onError: () => show("error"),
          },
        });
      },
      () => show("error"),
    );
    return () => {
      gone = true;
      made?.destroy();
      player.current = null;
      applied.current = null;
      ended.current = false;
      setReady(false);
      report.current?.(false);
    };
  }, [videoId, start, end, width, height, controls, attempt]);

  const want = command ?? PAUSED;
  // A new press while the player shows its error builds it again (state adjusted during render, not in an effect).
  const [seenPress, setSeenPress] = useState(want.press);
  if (want.press !== seenPress) {
    setSeenPress(want.press);
    if (status === "error" && want.state === "playing") {
      setStatus("loading");
      setAttempt((a) => a + 1);
    }
  }
  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    const next = { state: want.state, seq: want.seq };
    const steps = playerSteps(applied.current, next, ended.current);
    applied.current = next;
    for (const step of steps) {
      if (step === "pause") p.pauseVideo();
      else {
        if (step === "restart") {
          ended.current = false;
          p.seekTo(start, true);
        }
        p.playVideo();
      }
    }
  }, [ready, want.state, want.seq, want.press, start]);

  // The clip ends by the video's own clock, not a timer, so buffering never cuts it short (eng review).
  useEffect(() => {
    if (status !== "playing" || end === undefined) return;
    const timer = setInterval(() => {
      const p = player.current;
      if (!p || p.getCurrentTime() < end) return;
      ended.current = true;
      p.pauseVideo();
      setStatus("ended");
      report.current?.(false);
      reportEnd.current?.();
    }, END_POLL_MS);
    return () => clearInterval(timer);
  }, [status, end]);

  return (
    <div data-testid="youtube-player" data-status={status} className="relative" style={{ width, height, boxShadow: "0 0 0 4px var(--k)" }}>
      <div ref={host} aria-label={title} style={{ width, height }} />
      {cover && status !== "error" && <MusicCard status={status} start={start} end={end} />}
      {status === "error" && (
        <div role="status" className="absolute inset-0 flex items-center justify-center bg-[var(--k)] text-[24px] text-[var(--cream)]">
          {CLIP_STATUS_TEXT.error}
        </div>
      )}
      {needsTap && status !== "error" && (
        <div role="status" className="absolute inset-0 flex items-center justify-center text-center text-[22px] leading-[1.4]" style={{ background: "rgba(42,21,51,0.88)", color: "#fff0a8" }}>
          👆 點一下大螢幕
          <br />
          才能播放聲音
        </div>
      )}
    </div>
  );
}

/** The music question's card over the hidden video (D15): a pixel note, 聽歌猜題, an equalizer that moves only
 * while the song plays, the state in words, and the clip's length. */
function MusicCard({ status, start, end }: { status: ClipStatus; start: number; end?: number }) {
  const playing = status === "playing";
  return (
    <div data-testid="music-card" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--lav)] text-[var(--k)]">
      {end !== undefined && <div className="absolute right-3 top-2 text-[16px]">{end - start} 秒</div>}
      <PixelNote />
      <div className="text-[32px] leading-none">聽歌猜題</div>
      <div className="flex h-[28px] items-end gap-[6px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={playing ? (i % 2 ? "px-eq px-eq2" : "px-eq") : undefined} style={{ display: "block", width: 8, height: playing ? 28 : 6, background: "var(--k)", transformOrigin: "bottom" }} />
        ))}
      </div>
      <div className="text-[20px]" role="status">
        {CLIP_STATUS_TEXT[status]}
      </div>
    </div>
  );
}

/** An eighth note drawn in 4px cells (DESIGN.md: pictures are drawn by code, not emoji). */
function PixelNote() {
  const cells = [
    "....XXX",
    "....XXXX",
    "....X..XX",
    "....X...X",
    "....X",
    "....X",
    ".XXXX",
    "XXXXX",
    "XXXXX",
    ".XXX",
  ];
  return (
    <svg width={40} height={40} viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden>
      {cells.flatMap((row, y) => [...row].map((c, x) => (c === "X" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="var(--k)" /> : null)))}
    </svg>
  );
}
