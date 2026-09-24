"use client";

// Shared pixel-dungeon components (see DESIGN.md). Styles live in app/globals.css.

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { drawScene, drawSprite, SPRITE_SIZE, type SceneTheme, type SpriteKind } from "@/lib/pixel-art";
import { youtubeEmbedUrl } from "@/lib/youtube";
import type { PublicMediaContent } from "@/lib/protocol";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** A question image (on /play or /screen) that fails to load hides itself rather than leaving a
 * broken-image icon or blocking the rest of the question from rendering — the decided
 * broken-image fallback (docs/designs/image-question-type.md). */
function hideOnImageError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = "none";
}

/** Renders a question's or explanation's `content`/`explanation` media on /play, /screen, or the
 * host's preview — `text` content renders nothing here (the caller shows its `value` as the
 * ordinary prompt/explanation line, same slot the old fixed text field used); `image` and
 * `youtube` render below that line. Callers pass `key={questionId}` on <QuestionMedia> itself, which
 * forces a fresh DOM node per question, same broken-image fallback discipline as before this
 * component existed (docs/designs/question-media-content.md, carrying forward
 * image-question-type.md's decision). */
export function QuestionMedia({ content, maxWidth, maxHeight, className, label = "題目" }: { content: PublicMediaContent; maxWidth: number; maxHeight: number; className?: string; label?: string }) {
  if (content.kind === "text") return null;
  if (content.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a remote R2 URL, not a local asset next/image can optimize
      <img src={content.url} alt={`${label}圖片`} className={className} style={{ maxWidth, maxHeight, objectFit: "contain" }} onError={hideOnImageError} />
    );
  }
  // youtube: a plain iframe, no library or API key needed (confirmed 2026 best practice,
  // /plan-eng-review). No render-time detection of a since-deleted/private video — that needs
  // the YouTube IFrame Player API, deliberately deferred (design doc R2-4).
  return (
    <iframe
      src={youtubeEmbedUrl(content.videoId)}
      title={`${label}影片`}
      className={className}
      // width: 100% (capped by maxWidth) instead of a hardcoded pixel width — /screen and the
      // host preview live inside a fixed-size scaled stage where maxWidth always fits, but
      // /play has no fixed canvas (just page padding), so on a narrow phone the available width
      // can drop below maxWidth and a fixed-width iframe wouldn't shrink to fit, unlike the
      // <img> branch above which already caps via objectFit (design review finding, /ship).
      style={{ width: "100%", maxWidth, aspectRatio: "16 / 9", maxHeight }}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Panel ---------- */

export function Panel({
  tone = "cream",
  className,
  style,
  role,
  children,
}: {
  tone?: "cream" | "lav" | "turn";
  className?: string;
  style?: CSSProperties;
  /** e.g. "status" for a notice that appears on its own, so a screen reader announces it. */
  role?: "status" | "alert";
  children: ReactNode;
}) {
  return (
    <div className={cx("px-panel", tone !== "cream" && tone, className)} style={style} role={role}>
      {children}
    </div>
  );
}

/* ---------- Button ---------- */

export function PixelButton({
  variant = "retry",
  className,
  ...rest
}: { variant?: "ok" | "retry" | "flee" | "primary" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cx("px-btn", variant !== "retry" && variant, className)} {...rest} />;
}

/* ---------- Label chip (small orange text on a dark pill) ---------- */

export function LabelChip({ children }: { children: ReactNode }) {
  return <span className="px-chip">{children}</span>;
}

/* ---------- Sprite: a program-drawn pixel canvas that blinks ---------- */

export function Sprite({
  kind,
  variant = 0,
  scale = 4,
  hue = 0,
  className,
  style,
}: {
  kind: SpriteKind;
  variant?: number;
  /** hue-rotate degrees: lets one drawn monster play several. */
  hue?: number;
  /** Integer multiple of the native pixel size, so pixels stay square. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, h] = SPRITE_SIZE[kind];

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    drawSprite(cv, kind, variant, false);
    if (prefersReducedMotion() || kind === "crown" || kind === "heart" || kind === "torch") return;
    let reopen: ReturnType<typeof setTimeout>;
    const id = setInterval(() => {
      drawSprite(cv, kind, variant, true);
      reopen = setTimeout(() => drawSprite(cv, kind, variant, false), 140);
    }, 2600);
    return () => {
      clearInterval(id);
      clearTimeout(reopen);
    };
  }, [kind, variant]);

  return (
    <canvas
      ref={ref}
      className={cx("px-sprite", className)}
      style={{ width: w * scale, height: h * scale, ...(hue ? { filter: `hue-rotate(${hue}deg)` } : null), ...style }}
    />
  );
}

/* ---------- Scene background ---------- */

export function SceneBackground({
  theme,
  cols = 160,
  rows = 90,
  arch = true,
  className = "absolute inset-0",
}: {
  theme: SceneTheme;
  cols?: number;
  rows?: number;
  arch?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawScene(ref.current, theme, cols, rows, arch);
  }, [theme, cols, rows, arch]);
  return <canvas ref={ref} className={cx("px-sprite h-full w-full", className)} />;
}

/* ---------- Score meter: 15 cells ---------- */

export function ScoreMeter({ score, max = 15, active = false }: { score: number; max?: number; active?: boolean }) {
  return (
    <div className={cx("px-meter", active && "act")} role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={max}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < score ? "on" : undefined} />
      ))}
    </div>
  );
}

/* ---------- Turn ribbon ---------- */

export function TurnRibbon({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div className="px-ribbon" style={color ? { background: color } : undefined}>
      <i>▶</i>
      {children}
    </div>
  );
}

/* ---------- Nameplate ---------- */

export function Nameplate({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <Panel tone="lav" className={cx("flex items-center whitespace-nowrap px-[18px] py-[3px] text-[22px]", className)} style={style}>
      {children}
    </Panel>
  );
}

/* ---------- Dialogue box: owl portrait, `…` loader, lines typed one after another ---------- */

/** Reading time between one line and the next, after the first has finished typing. */
export const LINE_PAUSE_MS = 2200;

function Typewriter({ text, onDone }: { text: string; onDone: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i = prefersReducedMotion() ? text.length : i + 1;
      setN(i);
      if (i >= text.length) {
        clearInterval(id);
        onDone();
      }
    }, 45);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <>{text.slice(0, n)}</>;
}

/**
 * Plays `lines` in order. The ▼ shows only while another line is still to come,
 * so a player learns that ▼ means "the owl has more to say"; the last line has none.
 */
function Sequence({ lines }: { lines: string[] }) {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(false);
  const last = i >= lines.length - 1;
  useEffect(() => {
    if (!typed || last) return;
    const id = setTimeout(() => {
      setI((c) => c + 1);
      setTyped(false);
    }, LINE_PAUSE_MS);
    return () => clearTimeout(id);
  }, [typed, last]);
  return (
    <>
      <Typewriter key={i} text={lines[i]} onDone={() => setTyped(true)} />
      {typed && !last && <span className="more">▼</span>}
    </>
  );
}

export function DialogueBox({
  text,
  lines,
  loading = false,
  speaker = "地城主",
  accent,
  className,
  style,
  compact = false,
}: {
  /** One line to show. Ignored while `loading`, or when `lines` is given. */
  text?: string;
  /** Several lines, played in order with a ▼ between them. */
  lines?: string[];
  /** Narration hold: shows a blinking `…` and keeps the portrait. */
  loading?: boolean;
  speaker?: string;
  /** Speaker tag color. */
  accent?: string;
  className?: string;
  style?: CSSProperties;
  /** Smaller box for the phone. */
  compact?: boolean;
}) {
  const portrait = compact ? 56 : 84; // multiples of the owl's 28px, so pixels stay square
  const shown = (lines && lines.length > 0 ? lines : text ? [text] : [""]);
  return (
    <Panel
      tone="lav"
      className={cx("px-say", className)}
      style={{
        minHeight: 96,
        padding: compact ? "10px 12px 10px 76px" : "12px 22px 10px 116px",
        fontSize: compact ? 19 : 27,
        lineHeight: 1.4,
        ...style,
      }}
    >
      <span className="who" style={accent ? { background: accent } : undefined}>
        {speaker}
      </span>
      <div className="por" style={compact ? { left: 8, top: 10, width: 56, height: 56 } : { width: 84, height: 84 }}>
        <Sprite kind="owl" scale={portrait / 28} />
      </div>
      {loading ? (
        <span className="px-anim" style={{ animation: "px-blink 1s steps(1) infinite" }} aria-label="旁白準備中">
          …
        </span>
      ) : (
        <Sequence key={shown.join("\n")} lines={shown} />
      )}
    </Panel>
  );
}
