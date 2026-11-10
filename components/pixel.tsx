"use client";

// Shared pixel-dungeon components (see DESIGN.md). Styles live in app/globals.css.

import { useEffect, useEffectEvent, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { biteSprite, drawEmptyPlate, drawHomeScene, drawScene, drawSprite, HEAD_ANCHOR, homeSceneCell, SPRITE_SIZE, type HomeSceneAnchors, type SceneTheme } from "@/lib/pixel-art";
import type { Accessory } from "@/lib/monster-catalog";
import { MONSTER_SPRITES, type MonsterSprite, type SpriteKind } from "@/lib/sprite-kind";
import { BOSS_THRESHOLD } from "@/lib/turn-info";
import { loadCaptions, syncZhCaptions, youtubeEmbedUrl, type CaptionPlayer } from "@/lib/youtube";
import { loadYoutubeApi } from "@/components/youtube-player";
import { firstChange, resumeFrom } from "@/lib/narration/client";
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
export function QuestionMedia({
  content,
  maxWidth,
  maxHeight,
  className,
  label = "題目",
  zhCaptions = false,
}: {
  content: PublicMediaContent;
  maxWidth: number;
  maxHeight: number;
  className?: string;
  label?: string;
  /** A video explanation after the reveal: Chinese captions (docs/designs/youtube-questions.md「公布答案後的中文字幕」). */
  zhCaptions?: boolean;
}) {
  if (content.kind === "text") return null;
  if (content.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a remote R2 URL, not a local asset next/image can optimize
      <img src={content.url} alt={`${label}圖片`} className={className} style={{ maxWidth, maxHeight, objectFit: "contain" }} onError={hideOnImageError} />
    );
  }
  return <YoutubeFrame content={content} maxWidth={maxWidth} maxHeight={maxHeight} className={className} label={label} zhCaptions={zhCaptions} />;
}

// youtube: a plain iframe, no library or API key needed (confirmed 2026 best practice,
// /plan-eng-review). No render-time detection of a since-deleted/private video — that needs
// the YouTube IFrame Player API, deliberately deferred (design doc R2-4). With zhCaptions the API
// attaches to this same iframe only to pick the caption track.
function YoutubeFrame({ content, maxWidth, maxHeight, className, label, zhCaptions }: { content: Extract<PublicMediaContent, { kind: "youtube" }>; maxWidth: number; maxHeight: number; className?: string; label: string; zhCaptions: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!zhCaptions) return;
    let gone = false;
    let done = false;
    const captions = (p: CaptionPlayer) => {
      if (!gone && !done) done = syncZhCaptions(p, true);
    };
    loadYoutubeApi().then(
      (YT) => {
        if (gone || !frame.current) return;
        try {
          // No destroy() on cleanup: it would remove the iframe React still owns.
          new YT.Player(frame.current, {
            events: {
              onReady: (e) => {
                if (!gone) loadCaptions(e.target);
              },
              onApiChange: (e) => captions(e.target),
              onStateChange: (e) => {
                if (e.data === 1) captions(e.target);
              },
            },
          });
        } catch {
          // no captions, the video still plays
        }
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [zhCaptions, content.videoId]);
  return (
    <iframe
      ref={frame}
      src={youtubeEmbedUrl(content.videoId, content.start, content.end, zhCaptions)}
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

export const prefersReducedMotion = () =>
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

/** `tag`: the live map's cream-on-plum team name tag (docs/designs/live-map.md D5, D17). */
export function LabelChip({ children, tone }: { children: ReactNode; tone?: "tag" }) {
  return <span className={cx("px-chip", tone === "tag" && "px-chip-tag")}>{children}</span>;
}

/* ---------- Sprite: a program-drawn pixel canvas that blinks ---------- */

/** The sprites with eyes; everything else (props, food, the pot) never blinks. */
const BLINKS = new Set<SpriteKind>([...MONSTER_SPRITES.filter((s) => s !== "mandrake"), "owl", "hero"]); // the mandrake has no closed-eye frame

export function Sprite({
  kind: asked,
  variant = 0,
  scale = 4,
  hue = 0,
  accessory,
  bites = 0,
  blink,
  className,
  style,
}: {
  kind: SpriteKind;
  /** Bites taken out of a dish (docs/designs/eat-dish.md), 4 for the empty plate; only for dishes, which never blink. */
  bites?: number;
  /** Fixes the eyes open (false) or shut (true) and stops the blink timer: a frame of the eater's chew. */
  blink?: boolean;
  variant?: number;
  /** A repeat appearance's hat on the head (docs/designs/monster-catalog.md §3). Never hue-rotated. */
  accessory?: Accessory;
  /** hue-rotate degrees: lets one drawn monster play several. */
  hue?: number;
  /** Integer multiple of the native pixel size, so pixels stay square. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Unknown sprites (a newer server than this page) draw as a slime rather than crash the render.
  const kind: SpriteKind = Object.hasOwn(SPRITE_SIZE, asked) ? asked : "slime";
  const [w, h] = SPRITE_SIZE[kind];
  // Unknown hats (a newer server than this page) draw none rather than crash the render.
  const hat = accessory ? (`acc-${accessory}` as SpriteKind) : null;
  const wearing = !!hat && hat in SPRITE_SIZE && kind in HEAD_ANCHOR;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    drawSprite(cv, kind, variant, !!blink);
    if (bites >= 4) drawEmptyPlate(cv, kind);
    else if (bites) biteSprite(cv, bites);
    if (blink !== undefined || prefersReducedMotion() || !BLINKS.has(kind)) return;
    let reopen: ReturnType<typeof setTimeout>;
    const id = setInterval(() => {
      drawSprite(cv, kind, variant, true);
      reopen = setTimeout(() => drawSprite(cv, kind, variant, false), 140);
    }, 2600);
    return () => {
      clearInterval(id);
      clearTimeout(reopen);
    };
    // `wearing` swaps the canvas element (bare vs inside the hat's wrapper): the new one needs drawing too.
  }, [kind, variant, wearing, bites, blink]);

  const box = { width: w * scale, height: h * scale };
  const hueStyle = hue ? { filter: `hue-rotate(${hue}deg)` } : null;
  if (!wearing) return <canvas ref={ref} className={cx("px-sprite", className)} style={{ ...box, ...hueStyle, ...style }} />;
  // The hat sits in the monster's own box, so wearing one never moves the layout.
  const [aw, ah] = SPRITE_SIZE[hat!];
  const [ax, ay] = HEAD_ANCHOR[kind as MonsterSprite];
  return (
    <span className={cx("relative block", className)} style={{ ...box, ...style }}>
      <canvas ref={ref} className="px-sprite absolute left-0 top-0" style={{ ...box, ...hueStyle }} />
      <Sprite kind={hat!} scale={scale} className="absolute" style={{ left: (ax - Math.floor(aw / 2)) * scale, top: (ay - ah + 1) * scale }} />
    </span>
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
  /** "fork": the middle arch bricked up and two doorways either side (lib/pixel-art.ts FORK_ARCH). */
  arch?: boolean | "fork";
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawScene(ref.current, theme, cols, rows, arch);
  }, [theme, cols, rows, arch]);
  return <canvas ref={ref} className={cx("px-sprite h-full w-full", className)} />;
}

/* ---------- Home background: the dungeon corridor, sized to the viewport ---------- */

/**
 * Fills the viewport with the home page's dungeon corridor. Unlike `SceneBackground`, which stretches a
 * fixed grid, this sizes the grid from the viewport so every scene pixel is a whole number of screen
 * pixels, then lays two flickering torch sprites (and their glow) on the corridor's wall brackets.
 */
export function HomeBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<{ cell: number; W: number; H: number } | null>(null);
  const [anchors, setAnchors] = useState<HomeSceneAnchors | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cell = homeSceneCell(vw, vh);
        const W = Math.ceil(vw / cell);
        const H = Math.ceil(vh / cell);
        setLayout((old) => (old && old.cell === cell && old.W === W && old.H === H ? old : { cell, W, H }));
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (ref.current && layout) setAnchors(drawHomeScene(ref.current, layout.W, layout.H));
  }, [layout]);

  const cell = layout?.cell ?? 1;
  const [tw, th] = SPRITE_SIZE.torch;
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      <canvas
        ref={ref}
        className="px-sprite absolute left-0 top-0"
        style={layout ? { width: layout.W * cell, height: layout.H * cell } : { display: "none" }}
      />
      {anchors?.torches.map(({ x, y }) => (
        <div key={x} className="absolute" style={{ left: x * cell - (tw * cell) / 2, top: y * cell - th * cell, width: tw * cell, height: th * cell }}>
          <div className="px-glow px-tf1" style={{ left: (tw * cell) / 2 - 150, top: -150 + (th * cell) / 3 }} />
          <Sprite kind="torch" variant={0} scale={cell} className="px-tf1 absolute inset-0" />
          <Sprite kind="torch" variant={1} scale={cell} className="px-tf2 absolute inset-0" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Score meter: one cell per point up to the boss threshold ---------- */

export function ScoreMeter({ score: raw, active = false }: { score: number; active?: boolean }) {
  const max = BOSS_THRESHOLD;
  const score = Math.min(raw, max);
  return (
    <div className={cx("px-meter", active && "act")} role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={max}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < score ? "on" : undefined} />
      ))}
    </div>
  );
}

/* ---------- Turn ribbon ---------- */

export function TurnRibbon({ children, color, maxWidth }: { children: ReactNode; color?: string; maxWidth?: number }) {
  return (
    <div className="px-ribbon" style={{ ...(color ? { background: color } : null), maxWidth }}>
      <i>▶</i>
      <span className="min-w-0 truncate">{children}</span>
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
const LINE_PAUSE_MS = 2200;

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
 * When the host edits a line (same box, new `lines`), an edit at or before the line being read restarts from
 * the edited line; a later one is simply read when its turn comes (host-narration-edit.md D13).
 */
function Sequence({ lines, onRead }: { lines: string[]; onRead?: (count: number) => void }) {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(false);
  const [seen, setSeen] = useState(lines);
  if (firstChange(seen, lines) !== -1) {
    const from = resumeFrom(seen, lines, i);
    setSeen(lines);
    if (from !== null) {
      setI(Math.min(from, lines.length - 1));
      setTyped(false);
    }
  }
  const last = i >= lines.length - 1;
  const read = useEffectEvent((count: number) => onRead?.(count));
  useEffect(() => {
    if (typed) read(i + 1);
  }, [typed, i]);
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
      <Typewriter key={`${i}\n${lines[i]}`} text={lines[i] ?? ""} onDone={() => setTyped(true)} />
      {typed && !last && <span className="more">▼</span>}
    </>
  );
}

export function DialogueBox({
  lines,
  loading = false,
  accent,
  className,
  style,
  compact = false,
  id,
  onRead,
}: {
  /** Played in order with a ▼ between them. Ignored while `loading`. */
  lines: string[];
  /** Narration hold: shows a blinking `…` and keeps the portrait. */
  loading?: boolean;
  /** Speaker tag color. */
  accent?: string;
  className?: string;
  style?: CSSProperties;
  /** Smaller box for the phone. */
  compact?: boolean;
  /** Names what the box is reading (a narration's eventId). New `lines` under the same id are a host edit: the
   * box reads on instead of starting over. Without an id, any new lines start over. */
  id?: number;
  /** Called with how many lines have finished typing. */
  onRead?: (count: number) => void;
}) {
  const portrait = compact ? 56 : 84; // multiples of the owl's 28px, so pixels stay square
  const shown = lines.length > 0 ? lines : [""];
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
        地城主
      </span>
      <div className="por" style={{ width: portrait, height: portrait, ...(compact ? { left: 8, top: 10 } : {}) }}>
        <Sprite kind="owl" scale={portrait / 28} />
      </div>
      {loading ? (
        <span className="px-anim" style={{ animation: "px-blink 1s steps(1) infinite" }} aria-label="旁白準備中">
          …
        </span>
      ) : (
        <Sequence key={id !== undefined ? `id:${id}` : shown.join("\n")} lines={shown} onRead={onRead} />
      )}
    </Panel>
  );
}
