// Program-drawn pixel art, ported from the approved mockup
// (designs/screen-variants-20260918/cute-pixel-proposal.html). Every sprite is
// a small canvas filled cell by cell, so the app ships no image assets and the
// art stays crisp at any integer scale (CSS `image-rendering: pixelated`).

import type { SpriteKind } from "./sprite-kind";

export const OUTLINE = "#2a1533";
const K = OUTLINE;

function rgb(h: string): [number, number, number] {
  if (h.length === 4) h = "#" + [...h.slice(1)].map((c) => c + c).join("");
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

type Cell = string | null;

class Px {
  a: Cell[];
  constructor(
    readonly cv: HTMLCanvasElement,
    readonly w: number,
    readonly h: number,
  ) {
    cv.width = w;
    cv.height = h;
    this.a = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  private inE(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  ell(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (this.inE(x, y, cx, cy, rx, ry)) this.a[y * this.w + x] = c;
  }
  /** Recolour only cells that are already painted. */
  ellIn(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.a[i] !== null && this.inE(x, y, cx, cy, rx, ry)) this.a[i] = c;
      }
  }
  /** Shadow crescent: inside the ellipse but outside a copy shifted up-left. */
  shade(cx: number, cy: number, rx: number, ry: number, c: string, dx = 2, dy = 2) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.a[i] !== null && this.inE(x, y, cx, cy, rx, ry) && !this.inE(x, y, cx - dx, cy - dy, rx, ry))
          this.a[i] = c;
      }
  }
  cut(fn: (x: number, y: number) => boolean) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (fn(x, y)) this.a[y * this.w + x] = null;
  }
  grid(rows: string[], pal: Record<string, string>, ox = 0, oy = 0) {
    rows.forEach((r, y) =>
      [...r].forEach((ch, x) => {
        if (ch !== ".") this.set(ox + x, oy + y, pal[ch]);
      }),
    );
  }
  outline(c: string) {
    const b = this.a.slice();
    const g = (x: number, y: number) => (x >= 0 && y >= 0 && x < this.w && y < this.h ? b[y * this.w + x] : null);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (b[y * this.w + x] === null && (g(x + 1, y) || g(x - 1, y) || g(x, y + 1) || g(x, y - 1)))
          this.a[y * this.w + x] = c;
  }
  flush() {
    const ctx = this.cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(this.w, this.h);
    this.a.forEach((c, i) => {
      if (c) img.data.set([...rgb(c), 255], i * 4);
    });
    ctx.putImageData(img, 0, 0);
  }
}

function eye(P: Px, x: number, y: number, blink: boolean, big = false) {
  if (blink) {
    P.rect(x, y + (big ? 3 : 2), big ? 4 : 3, 1, K);
    return;
  }
  const w = big ? 4 : 3;
  const h = big ? 5 : 4;
  P.rect(x, y, w, h, K);
  P.set(x, y, "#fff");
  if (big) P.set(x + 1, y, "#fff");
  P.set(x + w - 1, y + h - 1, "#7a5a9a");
}

/** Native pixel size of each sprite; the component scales it with CSS. */
export const SPRITE_SIZE: Record<SpriteKind, [number, number]> = {
  slime: [32, 30],
  "slime-lost": [32, 38],
  "slime-king": [36, 40],
  ghost: [32, 36],
  "ghost-cry": [32, 36],
  dragon: [52, 46],
  owl: [28, 28],
  hero: [24, 24],
  crown: [20, 12],
  heart: [11, 10],
  torch: [9, 14],
  campfire: [26, 22],
};

/** Body colors: face, shade, highlight. The newer monsters bake in their own instead of relying on
 * the bank's hue-rotate, which would also recolor their crown, spear or thought bubble. */
type SlimeColors = { body: string; dark: string; light: string };
const GREEN_SLIME: SlimeColors = { body: "#6fd36a", dark: "#3fa65a", light: "#a8f07a" };
const BLUE_SLIME: SlimeColors = { body: "#6fb8e8", dark: "#3f7fb8", light: "#b0e0ff" };
const PURPLE_SLIME: SlimeColors = { body: "#b07ae8", dark: "#7a4ab8", light: "#dcb8ff" };

/** The slime's body, `oy` pixels down the canvas (room above for a hat or a thought). `sprout`: the
 * leaf on top (the plain slime has one; the king wears a crown instead). Call before outline(). */
function slimeBody(P: Px, oy: number, sprout = true, c: SlimeColors = GREEN_SLIME) {
  if (sprout) {
    P.rect(15, 2 + oy, 2, 5, c.dark);
    P.ell(12, 3 + oy, 3.2, 2, c.body);
    P.ell(20, 3 + oy, 3.2, 2, c.body);
  }
  P.ell(16, 17 + oy, 13, 11, c.body);
  P.cut((_x, y) => y > 26 + oy);
  P.shade(16, 17 + oy, 13, 11, c.dark, 2, 2);
  P.ellIn(11, 10 + oy, 7, 4, c.light);
}

/** The slime's face and shine, drawn after outline() so the outline doesn't swallow them. */
function slimeFace(P: Px, oy: number, b: boolean) {
  P.set(9, 10 + oy, "#fff");
  P.set(10, 10 + oy, "#fff");
  P.set(9, 11 + oy, "#fff");
  P.set(13, 9 + oy, "#fff");
  eye(P, 9, 15 + oy, b);
  eye(P, 20, 15 + oy, b);
  P.rect(5, 21 + oy, 3, 1, "#ff9db8");
  P.rect(24, 21 + oy, 3, 1, "#ff9db8");
  P.set(15, 22 + oy, K);
  P.set(16, 23 + oy, K);
  P.set(17, 22 + oy, K);
}

function slime(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 32, 30);
  slimeBody(P, 0);
  P.outline(K);
  slimeFace(P, 0, b);
  P.flush();
}

/** 迷路史萊姆: the slime, with a big question mark floating over its head. */
function slimeLost(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 32, 38);
  slimeBody(P, 8, true, BLUE_SLIME);
  P.grid([".www.", "ww.ww", "...ww", "..ww.", "..w..", ".....", "..w.."], { w: "#fff4dc" }, 22, 0);
  P.outline(K);
  slimeFace(P, 8, b);
  // A flat, unsure mouth instead of the smile.
  P.set(15, 30, K);
  P.set(16, 30, K);
  P.set(17, 30, K);
  P.set(16, 31, BLUE_SLIME.body);
  P.flush();
}

/** 守門史萊姆王: a crowned slime standing guard with a spear. */
function slimeKing(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 36, 40);
  const oy = 10;
  P.rect(32, 6, 2, 32, "#b07a4f");
  P.grid(["..s..", ".sss.", ".sss.", "sssss", "..n.."], { s: "#d8d4ee", n: "#7a4a34" }, 30, 1);
  slimeBody(P, oy, false, PURPLE_SLIME);
  // Sits on the top of the head (the body's top edge is at y = 6 + oy).
  const cy = 2 + oy;
  P.grid(["y...y...y", "yy.yyy.yy", "yyyyyyyyy", "yrryyyrry", "yyyyyyyyy"], { y: "#ffcf4a", r: "#ff6b6b" }, 12, cy);
  P.outline(K);
  slimeFace(P, oy, b);
  P.set(13, cy + 1, "#fff6b0");
  P.flush();
}

function ghost(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 32, 36);
  const sc = [0, 1, 2, 2, 1, 0, 0, 1];
  P.ell(16, 15, 11, 12, "#f4ecff");
  P.rect(5, 15, 22, 15, "#f4ecff");
  P.ell(4, 20, 2.4, 3, "#f4ecff");
  P.ell(28, 20, 2.4, 3, "#f4ecff");
  P.cut((x, y) => x >= 5 && x <= 26 && y > 29 + sc[(x - 5) % 8]);
  P.cut((x, y) => y > 29 + sc[((x % 8) + 8) % 8] && (x < 5 || x > 26));
  P.shade(16, 15, 11, 12, "#cdbdf0", 2, 2);
  P.cut((x, y) => x >= 5 && x <= 26 && y > 29 + sc[(x - 5) % 8]);
  P.rect(22, 16, 5, 13, "#cdbdf0");
  P.outline(K);
  P.set(9, 7, "#fff");
  P.set(10, 7, "#fff");
  P.set(9, 8, "#fff");
  eye(P, 10, 14, b, true);
  eye(P, 18, 14, b, true);
  P.rect(7, 21, 3, 1, "#ff9db8");
  P.rect(22, 21, 3, 1, "#ff9db8");
  P.rect(15, 21, 2, 2, "#7a4a6a");
  P.flush();
}

/** 愛哭幽靈: the ghost, with streams of tears and a wobbly frown. */
function ghostCry(cv: HTMLCanvasElement, b: boolean) {
  ghost(cv, b);
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const tear = "#8fd4ff";
  const put = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };
  // Replace the round mouth with a wobbly frown, then draw two tear streams under the eyes.
  for (let x = 14; x <= 17; x++) for (let y = 21; y <= 22; y++) put(x, y, "#f4ecff");
  for (const [x, y] of [[13, 23], [14, 22], [15, 23], [16, 22], [17, 23], [18, 22]]) put(x, y, K);
  for (let y = 19; y <= 26; y++) {
    put(11, y, tear);
    put(20, y, tear);
  }
  put(10, 27, tear);
  put(21, 27, tear);
}

function dragon(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 52, 46);
  P.ell(9, 26, 7, 9, "#5a3fb0");
  P.ell(43, 26, 7, 9, "#5a3fb0");
  P.ellIn(9, 26, 3.5, 6, "#8f74e8");
  P.ellIn(43, 26, 3.5, 6, "#8f74e8");
  P.ell(26, 33, 15, 11, "#7b5cd6");
  P.ellIn(26, 35, 9, 7, "#ffe9a8");
  P.ell(43, 38, 4, 3, "#7b5cd6");
  P.ell(47, 33, 3.5, 3, "#7b5cd6");
  P.ell(48, 29, 2.4, 2.4, "#ffb84d");
  P.ell(16, 43, 5, 3, "#5a3fb0");
  P.ell(36, 43, 5, 3, "#5a3fb0");
  P.ell(26, 18, 15, 13, "#7b5cd6");
  P.shade(26, 33, 15, 11, "#5a3fb0", 2, 2);
  P.shade(26, 18, 15, 13, "#5a3fb0", 2, 2);
  P.ellIn(21, 10, 6, 3, "#a48cf0");
  P.rect(10, 7, 4, 4, "#ffb84d");
  P.rect(10, 4, 3, 3, "#ffb84d");
  P.rect(9, 1, 3, 3, "#ffb84d");
  P.rect(38, 7, 4, 4, "#ffb84d");
  P.rect(39, 4, 3, 3, "#ffb84d");
  P.rect(40, 1, 3, 3, "#ffb84d");
  P.rect(25, 3, 2, 2, "#ffb84d");
  P.rect(24, 4, 4, 2, "#ffb84d");
  P.outline(K);
  P.set(19, 9, "#fff");
  P.set(20, 9, "#fff");
  P.set(19, 10, "#fff");
  eye(P, 17, 16, b, true);
  eye(P, 31, 16, b, true);
  P.rect(13, 24, 4, 2, "#ff9db8");
  P.rect(35, 24, 4, 2, "#ff9db8");
  P.set(24, 22, K);
  P.set(28, 22, K);
  for (const [x, y] of [[22, 25], [23, 26], [24, 26], [25, 26], [26, 26], [27, 26], [28, 26], [29, 25]]) P.set(x, y, K);
  P.set(24, 27, "#fff");
  P.set(27, 27, "#fff");
  P.flush();
}

/**
 * Eight team looks: three hat shapes cycling over eight colors, so a full
 * room of MAX_TEAMS never repeats a look. Index by team join order.
 */
export const TEAM_LOOKS = [
  { name: "紅", hat: "#ff6b6b", dk: "#c9384a", kind: "cap" },
  { name: "藍", hat: "#4a86ff", dk: "#2f5fd0", kind: "wiz" },
  { name: "綠", hat: "#5fd067", dk: "#2f8f3a", kind: "ranger" },
  { name: "黃", hat: "#ffcf4a", dk: "#c99a1a", kind: "cap" },
  { name: "粉", hat: "#ff9db8", dk: "#d05b80", kind: "wiz" },
  { name: "紫", hat: "#a07be8", dk: "#6a4dbb", kind: "ranger" },
  { name: "橘", hat: "#ffa94d", dk: "#c2571f", kind: "cap" },
  { name: "青", hat: "#4fd1c5", dk: "#218a80", kind: "wiz" },
] as const;

function hero(cv: HTMLCanvasElement, look: number, b: boolean) {
  const H = TEAM_LOOKS[((look % TEAM_LOOKS.length) + TEAM_LOOKS.length) % TEAM_LOOKS.length];
  const P = new Px(cv, 24, 24);
  P.ell(12, 21, 6.5, 3.5, H.hat);
  P.rect(6, 18, 12, 2, H.hat);
  P.ell(12, 13.5, 8, 7, "#ffdcb8");
  P.shade(12, 13.5, 8, 7, "#f0b98c", 1, 1);
  if (H.kind === "cap") {
    P.ell(12, 9, 9.5, 6.5, H.hat);
    P.rect(2, 10, 20, 3, H.dk);
    P.ell(12, 2.6, 2.2, 2.2, "#fff");
  }
  if (H.kind === "wiz") {
    for (let y = 0; y < 11; y++) {
      const half = Math.round(y * 0.95) + 1;
      P.rect(12 - half, y + 1, half * 2, 1, H.hat);
    }
    P.rect(2, 10, 20, 3, H.dk);
    P.set(12, 6, "#ffe27a");
    P.set(11, 7, "#ffe27a");
    P.set(13, 7, "#ffe27a");
  }
  if (H.kind === "ranger") {
    P.ell(12, 9, 9.5, 6.5, H.hat);
    P.rect(2, 10, 20, 3, H.dk);
    P.rect(18, 3, 2, 6, "#ffe27a");
    P.rect(19, 2, 2, 2, "#fff2b0");
  }
  P.outline(K);
  if (b) {
    P.rect(7, 15, 3, 1, K);
    P.rect(14, 15, 3, 1, K);
  } else {
    P.rect(7, 14, 2, 3, K);
    P.rect(15, 14, 2, 3, K);
    P.set(7, 14, "#fff");
    P.set(15, 14, "#fff");
  }
  P.rect(5, 17, 2, 1, "#ff9db8");
  P.rect(17, 17, 2, 1, "#ff9db8");
  P.set(11, 18, K);
  P.set(12, 18, K);
  P.flush();
}

/** 地城主, the owl mage who narrates. */
function owl(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 28, 28);
  for (let y = 0; y < 9; y++) {
    const half = Math.round(y * 1.05) + 1;
    P.rect(14 - half, y + 1, half * 2, 1, "#3b2a7a");
  }
  P.rect(3, 9, 22, 3, "#2a1d5c");
  P.set(14, 5, "#ffe27a");
  P.set(13, 6, "#ffe27a");
  P.set(15, 6, "#ffe27a");
  P.set(14, 7, "#ffe27a");
  P.ell(14, 18, 10, 9, "#8a6bd6");
  P.shade(14, 18, 10, 9, "#6a4dbb", 2, 2);
  P.ellIn(14, 21, 6, 5, "#f0e4ff");
  P.outline(K);
  P.ell(9, 16, 3.4, 3.4, "#fff");
  P.ell(19, 16, 3.4, 3.4, "#fff");
  if (b) {
    P.rect(7, 16, 4, 1, K);
    P.rect(17, 16, 4, 1, K);
  } else {
    P.rect(8, 15, 3, 3, K);
    P.rect(18, 15, 3, 3, K);
    P.set(8, 15, "#fff");
    P.set(18, 15, "#fff");
  }
  P.set(13, 20, "#ffb84d");
  P.set(14, 20, "#ffb84d");
  P.set(15, 20, "#ffb84d");
  P.set(14, 21, "#ffb84d");
  P.flush();
}

function crown(cv: HTMLCanvasElement) {
  const P = new Px(cv, 20, 12);
  P.grid(
    [".y..y..y..y.", "yy.yyyyyyy.y", "yyyyyyyyyyyy", "yoyyyyyyyyoy", "yyyyyyyyyyyy", "oooooooooooo"],
    { y: "#ffdd55", o: "#e8a824" },
    4,
    3,
  );
  P.outline(K);
  P.flush();
}

const HEART_PAL = { r: "#ff5d73", R: "#c22a49", w: "#fff", S: "#9a8fb8" };
function heart(cv: HTMLCanvasElement, on: boolean) {
  const P = new Px(cv, 11, 10);
  P.grid(
    on
      ? [".rrr.rrr.", "rwrrrrrrr", "rrrrrrrrr", "rrrrrrrrR", ".rrrrrrR.", "..rrrrR..", "...rrR...", "....R...."]
      : [".SS.SS...", "S..S..S..", "S.......S", ".S.....S.", "..S...S..", "...S.S...", "....S....", "........."],
    HEART_PAL,
    1,
    1,
  );
  P.outline(K);
  P.flush();
}

const TORCH_FRAMES = [
  ["...y...", "..yoy..", ".yoooy.", ".yooOy.", "..oOO..", "...O...", "..nnn..", "...n...", "...n...", "...n...", "..nnn..", "..nNn.."],
  ["....y..", "..yoyy.", ".yooooy", ".yoOOy.", "..oOO..", "..O....", "..nnn..", "...n...", "...n...", "...n...", "..nnn..", "..nNn.."],
];
const TORCH_PAL = { y: "#fff08a", o: "#ffa94d", O: "#e2742f", n: "#b07a4f", N: "#7a4a34" };
function torch(cv: HTMLCanvasElement, frame: number) {
  const P = new Px(cv, 9, 14);
  P.grid(TORCH_FRAMES[frame % 2], TORCH_PAL, 1, 1);
  P.outline(K);
  P.flush();
}

// The lobby campfire: two flame frames over crossed logs in a ring of stones (like the torch, the
// screen shows both frames and flicks between them with CSS, so the canvas itself never animates).
const CAMPFIRE_FLAMES = [
  [
    "...........y..........",
    "..........yy..........",
    ".........yoy...y......",
    "........yooy..yy......",
    "....y...yooyy.yoy.....",
    "...yy..yoooOy.yooy....",
    "...yoy.yoOOoyyooy.....",
    "...yooyyoOrOooooy.....",
    "....yoooOrrrOooy......",
    "....yooOrrrrrOoy......",
    ".....yoOrrrrrOy.......",
  ],
  [
    "..........y...........",
    "..........yy..y.......",
    "......y..yoy..yy......",
    ".....yy..yooy.yoy.....",
    ".....yoy.yoooyyoy.....",
    "....yooy.yoOoooy......",
    "...yooyyyoOOoooy......",
    "...yoooyoOrOOooy......",
    "....yoooOrrrOooy......",
    "....yooOrrrrrOoy......",
    ".....yoOrrrrrOy.......",
  ],
];
const CAMPFIRE_BASE = [
  "..nnN..........Nnn....",
  "...nnNN......NNnn.....",
  "....NnnNN..NNnnN......",
  "..ss..NNnnnnNN..ss....",
  ".sSss...NNNN...ssSs...",
  "..sss..........sss....",
];
const CAMPFIRE_PAL = { y: "#fff08a", o: "#ffa94d", O: "#e2742f", r: "#c94a2a", n: "#b07a4f", N: "#7a4a34", s: "#8a86a8", S: "#5a5670" };
function campfire(cv: HTMLCanvasElement, frame: number) {
  const P = new Px(cv, 26, 22);
  P.grid(CAMPFIRE_FLAMES[frame % 2], CAMPFIRE_PAL, 2, 1);
  P.grid(CAMPFIRE_BASE, CAMPFIRE_PAL, 2, 11);
  P.outline(K);
  P.flush();
}

const DRAW: Record<SpriteKind, (cv: HTMLCanvasElement, variant: number, blink: boolean) => void> = {
  slime: (cv, _v, b) => slime(cv, b),
  "slime-lost": (cv, _v, b) => slimeLost(cv, b),
  "slime-king": (cv, _v, b) => slimeKing(cv, b),
  ghost: (cv, _v, b) => ghost(cv, b),
  "ghost-cry": (cv, _v, b) => ghostCry(cv, b),
  dragon: (cv, _v, b) => dragon(cv, b),
  owl: (cv, _v, b) => owl(cv, b),
  hero: (cv, v, b) => hero(cv, v, b),
  crown: (cv) => crown(cv),
  heart: (cv, v) => heart(cv, v === 1),
  torch: (cv, v) => torch(cv, v),
  campfire: (cv, v) => campfire(cv, v),
};

/**
 * Draw one sprite. `variant` means: hero = look index, torch/campfire = frame (0/1),
 * heart = 1 for full and 0 for empty. `blink` closes the eyes.
 */
export function drawSprite(cv: HTMLCanvasElement, kind: SpriteKind, variant = 0, blink = false) {
  DRAW[kind](cv, variant, blink);
}

/* ---------- scene backgrounds ---------- */

export type SceneTheme = "stone" | "moss" | "crimson";

const THEME = {
  stone: { b: ["#5a4690", "#63509c", "#4f3d84"], m: "#33285e", hi: "#7a66b6", f: ["#7a5fa6", "#6a4f96"], fm: "#2f2352", arch: "#1b1236", rim: "#8a74c4" },
  moss: { b: ["#3f6b58", "#487a64", "#385f4e"], m: "#233d34", hi: "#62957c", f: ["#6aa084", "#5b8e74"], fm: "#1e3a2f", arch: "#0f2219", rim: "#7fb59a" },
  crimson: { b: ["#7a3560", "#86406c", "#6b2c54"], m: "#3c1530", hi: "#a85a8a", f: ["#a0507e", "#8e426e"], fm: "#3a1230", arch: "#1a0716", rim: "#c07aa4" },
} as const;

/** Brick wall, tiled floor, optional arch and a dithered vignette. Seeded, so it never flickers between renders. */
export function drawScene(cv: HTMLCanvasElement, name: SceneTheme, W = 160, H = 90, arch = true) {
  const T = THEME[name];
  const P = new Px(cv, W, H);
  const fy = Math.floor(H * 0.74);
  const bh = 7;
  const bw = 14;
  let s = 11;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const cache: Record<string, string> = {};
  for (let y = 0; y < fy; y++)
    for (let x = 0; x < W; x++) {
      const row = Math.floor(y / bh);
      const off = ((row % 2) * bw) / 2;
      const col = Math.floor((x + off) / bw);
      const key = row + "," + col;
      if (!(key in cache)) cache[key] = T.b[Math.floor(rnd() * 3)];
      let c = cache[key];
      if (y % bh === 0 || Math.floor(x + off) % bw === 0) c = T.m;
      else if (y % bh === 1) c = T.hi;
      P.set(x, y, c);
    }
  for (let y = fy; y < H; y++)
    for (let x = 0; x < W; x++) {
      const tx = Math.floor(x / 10);
      const ty = Math.floor((y - fy) / 5);
      P.set(x, y, (y - fy) % 5 === 4 ? T.fm : T.f[(tx + ty) % 2]);
    }
  const cx = W / 2;
  const aw = W > 100 ? 22 : 11;
  const ah = W > 100 ? 21 : 20;
  if (W > 100 && arch) {
    P.ell(cx, fy - ah, aw + 2, 12, T.rim);
    P.rect(cx - aw - 2, fy - ah, aw * 2 + 4, ah, T.rim);
    P.ell(cx, fy - ah, aw, 10, T.arch);
    P.rect(cx - aw, fy - ah, aw * 2, ah, T.arch);
    for (let y = fy - ah - 10; y < fy; y++)
      for (let x = cx - aw; x < cx + aw; x++)
        if (P.a[y * W + x] === T.arch && (x + y) % 2 === 0 && y < fy - ah + 10) P.a[y * W + x] = "#241848";
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - W / 2) / (W / 2);
      const dy = Math.abs(y - H * 0.45) / (H * 0.55);
      const d = Math.max(dx, dy);
      if ((d > 0.78 && (x + y) % 2 === 0) || (d > 0.92 && x % 2 === 0)) {
        const i = y * W + x;
        const c = P.a[i];
        if (c) P.a[i] = "#" + rgb(c).map((v) => Math.floor(v * 0.55).toString(16).padStart(2, "0")).join("");
      }
    }
  P.flush();
}

/* ---------- home page: looking down a dungeon corridor ---------- */

/** Screen pixels per scene pixel on the home page, from the viewport size. A whole number, so the
 * drawn scene and the torch sprites laid over it keep square pixels: about 5 on a phone, 7 on a laptop. */
export function homeSceneCell(vw: number, vh: number): number {
  return Math.max(4, Math.min(7, Math.round(Math.min(vw, vh * 0.75) / 80)));
}

/** Where the home scene's wall torches hang, in scene pixels: the top centre of each bracket. */
export type HomeSceneAnchors = { torches: { x: number; y: number }[] };

const DUN = {
  wall: ["#5a4690", "#63509c", "#4f3d84"],
  wallHi: "#7a66b6",
  mortar: "#2f2352",
  floor: ["#6a4f96", "#5f4589", "#553d7c"],
  floorM: "#2a1f4d",
  ceil: ["#3b2d68", "#33285e"],
  beam: "#7a4a34",
  beamHi: "#8a5a3e",
  moss: ["#3f6b58", "#62957c"],
  iron: ["#8a86a8", "#5a5670"],
  bone: "#fff4dc",
  web: "#cdbdf0",
} as const;

const SKULL = [".wwwww.", "wwwwwww", "wkkwkkw", "wkkwkkw", "wwwkwww", ".wwwww.", ".w.w.w."];
const BONES = ["ww....ww", ".wwwwww.", "ww....ww"];
const CHEST = [
  ".kkkkkkkkkkkk.",
  "kbBbbBbbBbbBbk",
  "kbbbbbbbbbbbbk",
  "kyyyyyyyyyyyyk",
  "kbbbbbyybbbbbk",
  "kbbbbbkkbbbbbk",
  "kbBbbBbbBbbBbk",
  "kkkkkkkkkkkkkk",
];
const BARREL = [".kkkkkk.", "kbBbbBbk", "kssssssk", "kbBbbBbk", "kbBbbBbk", "kbBbbBbk", "kssssssk", "kbBbbBbk", ".kkkkkk."];
const PROP_PAL = { w: DUN.bone, k: K, b: "#b07a4f", B: "#8a5a3e", y: "#ffcf4a", s: "#5a5670" };

/**
 * The home page backdrop, sized to fill the viewport: a stone corridor seen from inside, with
 * brick walls in perspective, a beamed ceiling hung with chains, a tiled floor, and an iron-banded
 * door at the far end. Cobwebs, moss, bones, a chest and a barrel fill the corners, where the home
 * page's panels leave the backdrop showing. The two wall torches' flames are sprites the caller lays
 * over the returned anchors, so they can flicker; their glow is painted here.
 * Seeded, so it never changes between renders.
 */
export function drawHomeScene(cv: HTMLCanvasElement, W: number, H: number): HomeSceneAnchors {
  const P = new Px(cv, W, H);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  // The far wall, a rectangle the four near surfaces (walls, ceiling, floor) run into.
  const cx = W / 2;
  const bw = Math.max(16, Math.round(W * 0.34));
  const bh = Math.max(14, Math.round(H * 0.34));
  const Rl = Math.round(cx - bw / 2);
  const Rr = Rl + bw;
  const Rt = Math.round(H * 0.42 - bh / 2);
  const Rb = Rt + bh;
  const sIn = bw / W;

  // Each pixel outside the far wall sits on a ring t (0 = screen edge, 1 = far wall) of one surface.
  type Surf = "L" | "R" | "T" | "B" | "F";
  const surf: Surf[] = new Array(W * H);
  const ring = new Float32Array(W * H);
  const cellId: string[] = new Array(W * H);
  const zScale = Math.max(Rl, Rt, 1) / (1 - sIn);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = [
        ["L", x < Rl ? x / Rl : 9],
        ["R", x >= Rr ? (W - 1 - x) / Math.max(1, W - 1 - Rr) : 9],
        ["T", y < Rt ? y / Rt : 9],
        ["B", y >= Rb ? (H - 1 - y) / Math.max(1, H - 1 - Rb) : 9],
      ] as [Surf, number][];
      let [sf, t] = c[0];
      for (const [k, v] of c) if (v < t) [sf, t] = [k, v];
      const i = y * W + x;
      if (t >= 9) {
        surf[i] = "F";
        ring[i] = 1;
        const row = Math.floor((y - Rt) / 3);
        cellId[i] = `F${row},${Math.floor((x - Rl + (row % 2) * 3) / 6)}`;
        continue;
      }
      surf[i] = sf;
      ring[i] = t;
      // Depth along the corridor, in roughly near-screen pixels.
      const z = (1 / (1 - t * (1 - sIn))) * zScale;
      if (sf === "L" || sf === "R") {
        const top = t * Rt;
        const bot = H - 1 - t * (H - 1 - Rb);
        const row = Math.floor(((y - top) / Math.max(1, bot - top)) * 12);
        cellId[i] = `${sf}${row},${Math.floor(z / 14 + (row % 2) * 0.5)}`;
      } else {
        const left = t * Rl;
        const right = W - 1 - t * (W - 1 - Rr);
        const col = Math.floor(((x - left) / Math.max(1, right - left)) * (sf === "B" ? 7 : 9));
        cellId[i] = `${sf}${col},${Math.floor(z / (sf === "B" ? 12 : 26))}`;
      }
    }
  // Paint: a 1px mortar line wherever the brick/tile id changes from the pixel above or to the left.
  const pick = <T,>(arr: readonly T[], key: string) => {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return arr[Math.abs(h) % arr.length];
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const id = cellId[i];
      const up = y > 0 && surf[i - W] === surf[i] ? cellId[i - W] : id;
      const lf = x > 0 && surf[i - 1] === surf[i] ? cellId[i - 1] : id;
      const edge = up !== id || lf !== id;
      const sf = surf[i];
      if (sf === "B") P.set(x, y, edge ? DUN.floorM : pick(DUN.floor, id));
      else if (sf === "T") {
        const beam = Number(id.split(",")[1]) % 2 === 0;
        P.set(x, y, beam ? (edge ? DUN.mortar : up !== id ? DUN.beamHi : DUN.beam) : edge ? DUN.mortar : pick(DUN.ceil, id));
      } else P.set(x, y, edge ? DUN.mortar : up !== id || (y > 0 && cellId[i - W] !== id) ? DUN.wallHi : pick(DUN.wall, id));
      if (!edge && sf !== "T" && sf !== "B" && y > 0 && cellId[i - W] !== id) P.set(x, y, DUN.wallHi);
    }
  // Corner seams where two surfaces meet.
  for (let y = 0; y < H; y++)
    for (let x = 1; x < W; x++) {
      const i = y * W + x;
      if (surf[i] !== surf[i - 1] || (y > 0 && surf[i] !== surf[i - W])) P.set(x, y, K);
    }
  P.rect(Rl, Rt, bw, 1, K);
  P.rect(Rl, Rb - 1, bw, 1, K);

  // Moss creeping up the bottom of the side walls, and a few cracks on the far wall.
  for (let n = 0; n < Math.floor((W * H) / 90); n++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H);
    const i = y * W + x;
    if ((surf[i] === "L" || surf[i] === "R") && y > H * 0.55) {
      const c = DUN.moss[Math.floor(rnd() * 2)];
      P.set(x, y, c);
      P.set(x + 1, y, c);
      P.set(x, y - 1, c);
    }
  }
  for (let n = 0; n < 3; n++) {
    let x = Rl + 3 + Math.floor(rnd() * (bw - 6));
    for (let y = Rt + 2 + Math.floor(rnd() * 4), k = 0; k < 5; k++, y++) {
      P.set(x, y, K);
      x += rnd() < 0.5 ? -1 : 1;
    }
  }

  // The door at the end: a stone rim, wooden planks, iron bands, a ring and light leaking under it.
  const dw = Math.max(6, Math.round(bw * 0.34));
  const dh = Math.max(8, Math.round(bh * 0.72));
  const dx = Math.round(cx - dw / 2);
  const dTop = Rb - dh;
  // Arch height capped so a wide, short far wall (an ultrawide screen) can't push it below the floor.
  const archR = Math.min(dw / 2, dh * 0.4);
  P.ell(cx, dTop + archR, dw / 2 + 1.5, archR + 1.5, DUN.wallHi);
  P.rect(dx - 1, dTop + archR, dw + 2, dh - archR, DUN.wallHi);
  P.ell(cx, dTop + archR, dw / 2, archR, "#8a5a3e");
  P.rect(dx, dTop + archR, dw, dh - archR - 1, "#8a5a3e");
  for (let y = dTop; y < Rb - 1; y++)
    for (let x = dx; x < dx + dw; x++) {
      if (P.a[y * W + x] !== "#8a5a3e") continue;
      if ((x - dx) % 3 === 2) P.set(x, y, "#5a3426");
      const band = Math.round(dh * 0.35);
      if (y === dTop + band || y === Rb - 1 - band) P.set(x, y, DUN.iron[1]);
    }
  P.set(Math.round(cx) + Math.max(1, Math.round(dw / 4)), dTop + Math.round(dh * 0.55), "#ffcf4a");
  P.rect(dx, Rb - 1, dw, 1, "#ffa94d");

  // Two small torches on the far wall either side of the door (painted, not sprites: too small to flicker).
  const glows: { x: number; y: number; r: number }[] = [];
  for (const sx of [-1, 1]) {
    const tx = Math.round(cx + sx * (dw / 2 + Math.max(3, bw * 0.12)));
    const ty = dTop + Math.round(dh * 0.25);
    P.rect(tx, ty + 2, 1, 2, "#7a4a34");
    P.set(tx, ty + 1, "#ffa94d");
    P.set(tx, ty, "#fff08a");
    glows.push({ x: tx, y: ty, r: Math.max(6, bw * 0.2) });
  }

  // Wall torches near the viewer: an iron bracket here, the flame is a sprite on top.
  const torches: { x: number; y: number }[] = [];
  const tt = 0.3;
  for (const side of ["L", "R"] as const) {
    const edgeX = side === "L" ? tt * Rl : W - 1 - tt * (W - 1 - Rr);
    const top = tt * Rt;
    const bot = H - 1 - tt * (H - 1 - Rb);
    const x = Math.round(edgeX + (side === "L" ? -1 : 1) * Math.max(3, W * 0.03));
    const y = Math.round(top + (bot - top) * 0.32);
    P.rect(x - 2, y, 5, 1, DUN.iron[0]);
    P.rect(x - 1, y + 1, 3, 1, DUN.iron[1]);
    P.rect(x, y + 2, 1, 3, DUN.iron[1]);
    torches.push({ x: x + 0.5, y });
    glows.push({ x, y: y - 6, r: Math.max(14, Math.min(W, H) * 0.28) });
  }

  // Chains hanging from the ceiling.
  for (const fx of [0.3, 0.7, 0.18, 0.82]) {
    const x = Math.round(W * fx);
    const len = Math.round(Rt * (0.5 + rnd() * 0.4));
    for (let y = 0; y < len; y++) {
      if (y % 3 === 2) P.set(x, y, DUN.iron[1]);
      else {
        P.set(x - (y % 3), y, DUN.iron[0]);
        P.set(x + 1 - (y % 3), y, DUN.iron[1]);
      }
    }
    P.rect(x - 1, len, 3, 1, DUN.iron[0]);
    P.set(x - 1, len + 1, DUN.iron[0]);
    P.set(x + 1, len + 1, DUN.iron[0]);
  }

  // Cobwebs in the two top corners: spokes plus dotted arcs.
  const webR = Math.max(8, Math.round(Math.min(W, H) * 0.14));
  for (const [ox, dir] of [[0, 1], [W - 1, -1]] as const)
    for (let y = 0; y <= webR; y++)
      for (let x = 0; x <= webR; x++) {
        const d = Math.hypot(x, y);
        if (d > webR) continue;
        const a = Math.atan2(y, x);
        const spoke = [0.25, 0.75, 1.2].some((k) => Math.abs(a - k) * d < 0.6);
        const arc = [0.35, 0.65, 0.95].some((k) => Math.abs(d - webR * k) < 0.5) && (x + y) % 2 === 0;
        if (spoke || arc) P.set(ox + dir * x, y, DUN.web);
      }

  // Things on the floor, in the strip the home page leaves showing at the bottom.
  const fy = H - 2;
  P.grid(SKULL, PROP_PAL, Math.round(W * 0.2) - 3, fy - 8);
  P.grid(BONES, PROP_PAL, Math.round(W * 0.2) + 5, fy - 3);
  P.grid(BONES, PROP_PAL, Math.round(W * 0.12), fy - 2);
  P.grid(CHEST, PROP_PAL, Math.round(W * 0.66) - 7, fy - 8);
  for (let n = 0; n < 5; n++) P.set(Math.round(W * 0.66) - 9 + Math.floor(rnd() * 18), fy - Math.floor(rnd() * 2), "#ffcf4a");
  P.grid(BARREL, PROP_PAL, Math.round(W * 0.86) - 4, fy - 9);
  P.ell(Math.round(W * 0.42), fy - 2, Math.max(3, W * 0.05), 1.6, "#2a1f4d");
  P.set(Math.round(W * 0.42) - 1, fy - 3, "#7a66b6");

  // Light: the corridor darkens with depth, and every torch throws a warm pool.
  const cache = new Map<string, string>();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = P.a[i];
      if (!c || c === K) continue;
      let f = 1 - 0.55 * ring[i];
      let warm = 0;
      for (const g of glows) {
        const d = Math.hypot(x - g.x, y - g.y) / g.r;
        if (d < 1) warm = Math.max(warm, 1 - d);
      }
      f += warm * 0.45;
      // Quantize so the light falls off in visible pixel-art steps, dithered between steps.
      const q = Math.round(f * 6 + ((x + y) % 2 ? 0.25 : -0.25)) / 6;
      const w = Math.round(warm * 3) / 3;
      const key = `${c}${q}${w}`;
      let out = cache.get(key);
      if (!out) {
        const [r, gg, b] = rgb(c);
        const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
        out = "#" + hex(r * q + 95 * w) + hex(gg * q + 50 * w) + hex(b * q * (1 - 0.35 * w));
        cache.set(key, out);
      }
      P.a[i] = out;
    }
  P.flush();
  return { torches };
}
