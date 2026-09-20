"use client";

// Shared pixel-dungeon components (see DESIGN.md). Styles live in app/globals.css.

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { drawScene, drawSprite, SPRITE_SIZE, type SceneTheme, type SpriteKind } from "@/lib/pixel-art";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Panel ---------- */

export function Panel({
  tone = "cream",
  className,
  style,
  children,
}: {
  tone?: "cream" | "lav" | "turn";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={cx("px-panel", tone !== "cream" && tone, className)} style={style}>
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

/* ---------- Dialogue box: owl portrait, `…` loader, one typewriter line ---------- */

function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i = prefersReducedMotion() ? text.length : i + 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [text]);
  return <>{text.slice(0, n)}</>;
}

export function DialogueBox({
  text,
  loading = false,
  speaker = "地城主",
  accent,
  className,
  style,
  compact = false,
}: {
  /** The line to show. Ignored while `loading`. */
  text?: string;
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
        <>
          <Typewriter key={text} text={text ?? ""} />
          <span className="more">▼</span>
        </>
      )}
    </Panel>
  );
}
