// Program-drawn pixel art, ported from the approved mockup
// (designs/screen-variants-20260918/cute-pixel-proposal.html). Every sprite is
// a small canvas filled cell by cell, so the app ships no image assets and the
// art stays crisp at any integer scale (CSS `image-rendering: pixelated`).

import type { SpriteKind } from "./sprite-kind";
export type { SpriteKind };

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
  ghost: [32, 36],
  dragon: [52, 46],
  owl: [28, 28],
  hero: [24, 24],
  crown: [20, 12],
  heart: [11, 10],
  torch: [9, 14],
};

function slime(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 32, 30);
  P.rect(15, 2, 2, 5, "#3fa65a");
  P.ell(12, 3, 3.2, 2, "#6fd36a");
  P.ell(20, 3, 3.2, 2, "#6fd36a");
  P.ell(16, 17, 13, 11, "#6fd36a");
  P.cut((_x, y) => y > 26);
  P.shade(16, 17, 13, 11, "#3fa65a", 2, 2);
  P.ellIn(11, 10, 7, 4, "#a8f07a");
  P.outline(K);
  P.set(9, 10, "#fff");
  P.set(10, 10, "#fff");
  P.set(9, 11, "#fff");
  P.set(13, 9, "#fff");
  eye(P, 9, 15, b);
  eye(P, 20, 15, b);
  P.rect(5, 21, 3, 1, "#ff9db8");
  P.rect(24, 21, 3, 1, "#ff9db8");
  P.set(15, 22, K);
  P.set(16, 23, K);
  P.set(17, 22, K);
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

/**
 * Draw one sprite. `variant` means: hero = look index, torch = frame (0/1),
 * heart = 1 for full and 0 for empty. `blink` closes the eyes.
 */
export function drawSprite(cv: HTMLCanvasElement, kind: SpriteKind, variant = 0, blink = false) {
  switch (kind) {
    case "slime":
      return slime(cv, blink);
    case "ghost":
      return ghost(cv, blink);
    case "dragon":
      return dragon(cv, blink);
    case "owl":
      return owl(cv, blink);
    case "hero":
      return hero(cv, variant, blink);
    case "crown":
      return crown(cv);
    case "heart":
      return heart(cv, variant === 1);
    case "torch":
      return torch(cv, variant);
  }
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

/* ---------- home page: a dungeon castle under the moon ---------- */

/** Screen pixels per scene pixel on the home page, from the viewport size. A whole number, so the
 * drawn scene and the torch sprites laid over it keep square pixels: about 5 on a phone, 7 on a laptop. */
export function homeSceneCell(vw: number, vh: number): number {
  return Math.max(4, Math.min(7, Math.round(Math.min(vw, vh * 0.75) / 80)));
}

/** Where the home scene's torch posts stand, in scene pixels: the top centre of each post. */
export type HomeSceneAnchors = { torches: { x: number; y: number }[] };

const HOME = {
  sky: ["#150e2b", "#1b1236", "#241a3f", "#2f2352", "#3b2d68", "#4f3d84"],
  star: ["#fff", "#fff6b0", "#cdbdf0"],
  far: "#2c2254",
  near: "#1f1740",
  castle: "#1b1236",
  roof: "#3c1530",
  lit: ["#ffcf4a", "#ffa94d"],
  ground: ["#241a3f", "#2a1f4d", "#30245a"],
  cobble: ["#7a5fa6", "#6a4f96", "#5a4690"],
  mortar: "#2f2352",
  grass: ["#3f6b58", "#62957c"],
  stone: ["#63509c", "#5a4690", "#4f3d84"],
} as const;

/**
 * The home page backdrop, sized to fill the viewport: a starry sky and moon, mountains, a
 * castle with lit windows and a glowing gate, and a cobbled path flanked by two torch posts.
 * The torches' flames are sprites the caller lays over the returned anchors, so they can flicker.
 * Seeded, so it never changes between renders.
 */
export function drawHomeScene(cv: HTMLCanvasElement, W: number, H: number): HomeSceneAnchors {
  const P = new Px(cv, W, H);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const hy = Math.floor(H * 0.58); // horizon
  const px = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? P.a[y * W + x] : null);

  // Sky: bands that darken upward, dithered where two bands meet.
  const bands = HOME.sky.length;
  for (let y = 0; y < hy; y++) {
    const t = (y / hy) * bands;
    const b = Math.min(bands - 1, Math.floor(t));
    const edge = t - b > 0.8 && b < bands - 1;
    for (let x = 0; x < W; x++) P.set(x, y, edge && (x + y) % 2 === 0 ? HOME.sky[b + 1] : HOME.sky[b]);
  }
  // Stars, a few of them bigger plus shapes.
  const stars = Math.floor((W * hy) / 70);
  for (let i = 0; i < stars; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * hy * 0.8);
    const c = HOME.star[Math.floor(rnd() * 3)];
    P.set(x, y, c);
    if (rnd() < 0.12) {
      P.set(x - 1, y, HOME.star[2]);
      P.set(x + 1, y, HOME.star[2]);
      P.set(x, y - 1, HOME.star[2]);
      P.set(x, y + 1, HOME.star[2]);
    }
  }
  // Moon, with a dithered halo, a shaded crescent and craters.
  const mr = Math.max(5, Math.round(Math.min(W, H) * 0.07));
  const mx = Math.round(W * 0.8);
  const my = Math.round(Math.max(mr + 3, H * 0.12));
  for (let y = my - mr * 2; y <= my + mr * 2; y++)
    for (let x = mx - mr * 2; x <= mx + mr * 2; x++) {
      const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my) / mr;
      if (d <= 1.6 && (x + y) % 2 === 0 && px(x, y) && !HOME.star.includes(px(x, y) as never)) P.set(x, y, HOME.sky[3]);
    }
  P.ell(mx, my, mr, mr, "#fff4dc");
  P.shade(mx, my, mr, mr, "#f1dcb6", -Math.max(1, mr / 3), -Math.max(1, mr / 4));
  P.ell(mx - mr * 0.35, my - mr * 0.2, Math.max(1, mr * 0.22), Math.max(1, mr * 0.22), "#e8d6b0");
  P.ell(mx + mr * 0.3, my + mr * 0.35, Math.max(1, mr * 0.15), Math.max(1, mr * 0.15), "#e8d6b0");

  // Two mountain ridges.
  for (let x = 0; x < W; x++) {
    const far = hy - Math.round(H * 0.06 + H * 0.05 * Math.sin(x * 0.06 + 1) + H * 0.025 * Math.sin(x * 0.17 + 2));
    for (let y = Math.max(0, far); y < hy; y++) P.set(x, y, HOME.far);
    const near = hy - Math.round(H * 0.02 + H * 0.025 * Math.sin(x * 0.11 + 4) + H * 0.01 * Math.sin(x * 0.31));
    for (let y = Math.max(0, near); y < hy + 1; y++) P.set(x, y, HOME.near);
  }

  // Castle on the horizon: a keep, two side towers and a tall centre tower, all with merlons.
  const cxC = Math.round(W / 2);
  const cw = Math.max(36, Math.min(96, Math.round(W * 0.42)));
  const base = hy;
  // Capped by the sky's height too, so on a wide, short screen the spire still clears the top.
  const kh = Math.min(Math.round(cw * 0.26), Math.round(hy * 0.22));
  const tw = Math.max(6, Math.round(cw * 0.12));
  const block = (x0: number, w: number, h: number) => {
    P.rect(x0, base - h, w, h, HOME.castle);
    for (let x = x0; x < x0 + w; x += 2) if ((x - x0) % 4 < 2) P.rect(x, base - h - 2, 2, 2, HOME.castle);
  };
  const roof = (x0: number, w: number, y: number) => {
    const h = Math.round(w * 1.1);
    for (let r = 0; r < h; r++) {
      const half = Math.round(((r + 1) / h) * (w / 2 + 1));
      P.rect(Math.round(x0 + w / 2 - half), y - h + r, half * 2, 1, HOME.roof);
    }
    return y - h;
  };
  const windows = (x0: number, w: number, top: number, bottom: number) => {
    for (let y = top + 3; y < bottom - 4; y += 5)
      for (let x = x0 + 2; x < x0 + w - 2; x += 4) if (rnd() < 0.45) P.rect(x, y, 1, 2, HOME.lit[Math.floor(rnd() * 2)]);
  };
  const left = cxC - Math.round(cw / 2);
  block(left, cw, kh);
  windows(left + tw, cw - tw * 2, base - kh, base);
  const th = Math.round(kh * 1.5);
  for (const x0 of [left - 1, left + cw - tw + 1]) {
    block(x0, tw, th);
    roof(x0 - 1, tw + 2, base - th - 2);
    windows(x0, tw, base - th, base - kh);
  }
  const ctw = Math.round(tw * 1.4);
  const cth = Math.round(kh * 2);
  block(cxC - Math.round(ctw / 2), ctw, cth);
  const peak = roof(cxC - Math.round(ctw / 2) - 1, ctw + 2, base - cth - 2);
  windows(cxC - Math.round(ctw / 2), ctw, base - cth, base - kh);
  // Pennant on the centre spire.
  P.rect(cxC, peak - 5, 1, 5, HOME.castle);
  P.grid(["dd", "ddd", "dd"], { d: "#ff6b6b" }, cxC + 1, peak - 5);
  // Gate: a warm glowing arch at the foot of the keep.
  const gw = Math.max(3, Math.round(cw * 0.07));
  const gh = Math.max(4, Math.round(kh * 0.45));
  P.ell(cxC, base - gh, gw, gw * 0.8, "#e2742f");
  P.rect(cxC - gw, base - gh, gw * 2, gh, "#e2742f");
  for (let y = base - gh - gw; y < base; y++)
    for (let x = cxC - gw; x < cxC + gw; x++)
      if (px(x, y) === "#e2742f" && ((x + y) % 2 === 0 || Math.abs(x + 0.5 - cxC) < gw / 2)) P.set(x, y, "#ffa94d");

  // Ground, then a cobbled path that widens toward the viewer.
  for (let y = hy + 1; y < H; y++) {
    const t = (y - hy) / (H - hy);
    const g = HOME.ground[Math.min(2, Math.floor(t * 3))];
    for (let x = 0; x < W; x++) P.set(x, y, g);
  }
  for (let y = hy + 1; y < H; y++) {
    const t = (y - hy) / (H - hy);
    const half = gw + t * W * 0.32;
    const bh = 1 + Math.round(t * 3);
    const bw = 2 + Math.round(t * 6);
    const row = Math.floor(((y - hy) * (y - hy)) / Math.max(1, H - hy) / 1.2 + (y - hy) * 0.4);
    for (let x = Math.round(cxC - half); x < Math.round(cxC + half); x++) {
      const off = (row % 2) * Math.floor(bw / 2);
      const col = Math.floor((x + off) / bw);
      const mortar = (x + off) % bw === 0 || (y + row) % (bh + 1) === 0;
      P.set(x, y, mortar ? HOME.mortar : HOME.cobble[(col * 7 + row * 3) % 3]);
    }
  }
  const onPath = (x: number, y: number) => Math.abs(x - cxC) < gw + ((y - hy) / (H - hy)) * W * 0.32 + 2;
  // Grass tufts.
  const tufts = Math.floor((W * (H - hy)) / 45);
  for (let i = 0; i < tufts; i++) {
    const x = Math.floor(rnd() * W);
    const y = hy + 2 + Math.floor(rnd() * (H - hy - 2));
    if (onPath(x, y)) continue;
    const c = HOME.grass[Math.floor(rnd() * 2)];
    P.set(x, y, c);
    P.set(x - 1, y - 1, c);
    P.set(x + 1, y - 1, c);
  }
  // Props beside the path (and clear of the torch posts): gravestones and red mushrooms.
  const pw = Math.max(4, Math.round(W * 0.03));
  const nearPost = (x: number) => [0.12, 0.88].some((fx) => Math.abs(x - W * fx) < pw + 5);
  const props = Math.max(4, Math.floor(W / 16));
  for (let i = 0; i < props; i++) {
    const x = Math.floor(rnd() * W);
    const y = hy + 4 + Math.floor(rnd() * (H - hy - 6));
    if (onPath(x, y) || onPath(x + 4, y) || onPath(x - 4, y) || nearPost(x)) continue;
    if (rnd() < 0.5) {
      P.grid([".sss.", "sssss", "ssXss", "sXXXs", "ssXss", "sssss"], { s: "#8a74c4", X: "#4f3d84" }, x - 2, y - 6);
      P.rect(x - 3, y, 7, 1, HOME.grass[0]);
    } else {
      P.grid([".rrr.", "rwrwr", "rrrrr", "..c..", "..c.."], { r: "#ff6b6b", w: "#fff", c: "#fff4dc" }, x - 2, y - 5);
    }
  }

  // Two stone posts flanking the path; the flames are sprites laid on top (see anchors).
  const pt = H - Math.max(16, Math.round((H - hy) * 0.55));
  const torches: { x: number; y: number }[] = [];
  for (const fx of [0.12, 0.88]) {
    const x0 = Math.round(W * fx - pw / 2);
    for (let y = pt; y < H; y++)
      for (let x = x0; x < x0 + pw; x++) {
        const brick = Math.floor((y - pt) / 3);
        const c = (y - pt) % 3 === 0 ? HOME.mortar : HOME.stone[(brick + Math.floor((x - x0 + (brick % 2) * 2) / 3)) % 3];
        P.set(x, y, c);
      }
    P.rect(x0 - 1, pt - 2, pw + 2, 2, "#8a74c4");
    P.rect(x0 - 1, pt, pw + 2, 1, HOME.mortar);
    torches.push({ x: x0 + pw / 2, y: pt - 2 });
  }

  // Dithered vignette, same as the room scenes.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - W / 2) / (W / 2);
      const dy = Math.abs(y - H * 0.45) / (H * 0.55);
      const d = Math.max(dx, dy);
      if ((d > 0.8 && (x + y) % 2 === 0) || (d > 0.94 && x % 2 === 0)) {
        const i = y * W + x;
        const c = P.a[i];
        if (c) P.a[i] = "#" + rgb(c).map((v) => Math.floor(v * 0.6).toString(16).padStart(2, "0")).join("");
      }
    }
  P.flush();
  return { torches };
}
