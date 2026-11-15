"use client";

// The big screen's test load of every clip in the bank (docs/designs/screen-media-test.md D3): one at a time, muted
// and out of sight (a music video's title is its answer), at most TEST_MS each. Its own probes, not YoutubePlayer or
// FilePlayer: those follow the host's ▶ with sound, and YoutubePlayer hides YouTube's error code.

import { useEffect, useRef, useState } from "react";
import type { ScreenTestError, ScreenVideo } from "@/lib/protocol";
import { INSTAGRAM_ORIGIN, instagramEmbedUrl, measuredHeight } from "@/lib/instagram";
import { youtubeTestError } from "@/lib/youtube";
import { loadYoutubeApi } from "./youtube-player";

const TEST_MS = 20_000;
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
  const finished = useRef(false);
  const report = useRef(onDone);
  useEffect(() => {
    report.current = onDone;
  }, [onDone]);
  const finish = (error: ScreenTestError | null) => {
    if (finished.current) return;
    finished.current = true;
    report.current(error);
  };

  useEffect(() => {
    const timer = setTimeout(() => finish("timeout"), TEST_MS);
    let gone = false;
    let player: { destroy(): void } | null = null;
    let onMessage: ((e: MessageEvent) => void) | null = null;
    if (video.kind === "youtube") {
      loadYoutubeApi().then(
        (YT) => {
          if (gone || !host.current) return;
          const el = document.createElement("div");
          host.current.replaceChildren(el);
          player = new YT.Player(el, {
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
        () => finish("error"),
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
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one probe per mount (keyed by index)

  if (video.kind === "youtube") return <div ref={host} />;
  if (video.kind === "instagram") return <iframe ref={frame} src={instagramEmbedUrl(video.shortcode)} title="試播" width={SIZE} height={SIZE} style={{ border: 0 }} />;
  return (
    <video
      src={video.url}
      muted
      autoPlay
      playsInline
      preload="auto"
      width={SIZE}
      height={SIZE}
      // The picture's size is known by now: none means the browser cannot decode the video track (e.g. HEVC).
      onLoadedData={(e) => finish(!video.audioOnly && e.currentTarget.videoWidth === 0 ? "no_picture" : null)}
      onError={() => finish("error")}
    />
  );
}
