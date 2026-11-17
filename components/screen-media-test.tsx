"use client";

// The big screen's test load of every clip in the bank (docs/designs/screen-media-test.md D3): one at a time, muted
// and out of sight (a music video's title is its answer), at most SCREEN_TEST_SECONDS each. Its own probes, not
// YoutubePlayer or FilePlayer: those follow the host's ▶ with sound, and YoutubePlayer hides YouTube's error code.

import { useCallback, useEffect, useRef, useState } from "react";
import { SCREEN_TEST_SECONDS, type ScreenTestError, type ScreenVideo } from "@/lib/protocol";
import { INSTAGRAM_ORIGIN, instagramEmbedUrl, measuredHeight } from "@/lib/instagram";
import { fileTestError, youtubeTestError } from "@/lib/youtube";
import { loadYoutubeApi } from "./youtube-player";

/** YouTube's smallest player that still plays. */
const SIZE = 200;

type Done = (error: ScreenTestError | null) => void;

/** Mount with `key={runId}`: a new run starts from the first clip. */
export function ScreenMediaTest({ items, onResult }: { items: ScreenVideo[]; onResult: (index: number, error: ScreenTestError | null) => void }) {
  const [index, setIndex] = useState(0);
  const report = useRef(onResult);
  useEffect(() => {
    report.current = onResult;
  }, [onResult]);
  const item = items[index];
  if (!item) return null;
  const done: Done = (error) => {
    report.current(index, error);
    setIndex(index + 1);
  };
  return (
    <div aria-hidden data-testid="screen-media-test" style={{ position: "fixed", right: 0, bottom: 0, width: SIZE, height: SIZE, overflow: "hidden", opacity: 0, pointerEvents: "none", zIndex: -1 }}>
      <Probe key={index} video={item} onDone={done} />
    </div>
  );
}

function Probe({ video, onDone }: { video: ScreenVideo; onDone: Done }) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const file = useRef<HTMLVideoElement>(null);
  const finished = useRef(false);
  const report = useRef(onDone);
  useEffect(() => {
    report.current = onDone;
  }, [onDone]);
  // Only refs inside: one stable function for the effect and the <video> handlers. Reports once per probe.
  const finish = useCallback((error: ScreenTestError | null) => {
    if (finished.current) return;
    finished.current = true;
    report.current(error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => finish("timeout"), SCREEN_TEST_SECONDS * 1000);
    let gone = false;
    let player: { destroy(): void } | null = null;
    let onMessage: ((e: MessageEvent) => void) | null = null;
    const el = file.current;
    if (video.kind === "youtube") {
      loadYoutubeApi().then(
        (YT) => {
          if (gone || !host.current) return;
          const div = document.createElement("div");
          host.current.replaceChildren(div);
          player = new YT.Player(div, {
            videoId: video.videoId,
            width: SIZE,
            height: SIZE,
            host: "https://www.youtube-nocookie.com",
            playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, mute: 1 },
            events: {
              onReady: (e) => {
                e.target.mute();
                e.target.playVideo();
              },
              onStateChange: (e) => e.data === 1 && finish(null),
              onError: (e) => finish(youtubeTestError(e.data)),
            },
          });
        },
        // The local network blocks YouTube's script: nothing is known about the video itself, so yellow, not red.
        () => finish("timeout"),
      );
    } else if (video.kind === "instagram") {
      // The embed has no player API: its first MEASURE message is the only sign it loaded.
      onMessage = (e: MessageEvent) => {
        if (e.origin === INSTAGRAM_ORIGIN && e.source === frame.current?.contentWindow && measuredHeight(e.data) !== null) finish(null);
      };
      window.addEventListener("message", onMessage);
    }
    return () => {
      gone = true;
      clearTimeout(timer);
      if (onMessage) window.removeEventListener("message", onMessage);
      player?.destroy();
      // A detached <video> keeps downloading until it is collected; stop it so later probes get the bandwidth. Only once
      // it has reported: React's dev-mode remount runs this cleanup on a probe that is still loading.
      if (el && finished.current) {
        el.removeAttribute("src");
        el.load();
      }
    };
  }, [video, finish]);

  if (video.kind === "youtube") return <div ref={host} />;
  if (video.kind === "instagram") return <iframe ref={frame} src={instagramEmbedUrl(video.shortcode)} title="試播" width={SIZE} height={SIZE} style={{ border: 0 }} />;
  return (
    <video
      ref={file}
      src={video.url}
      muted
      autoPlay
      playsInline
      preload="auto"
      width={SIZE}
      height={SIZE}
      onLoadedData={(e) => finish(fileTestError(!!video.audioOnly, e.currentTarget.videoWidth))}
      onError={() => finish("error")}
    />
  );
}
