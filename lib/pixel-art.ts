// Program-drawn pixel art, ported from the approved mockup
// (designs/screen-variants-20260918/cute-pixel-proposal.html). Every sprite is
// a small canvas filled cell by cell, so the app ships no image assets and the
// art stays crisp at any integer scale (CSS `image-rendering: pixelated`).

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

export type SpriteKind = "slime" | "ghost" | "dragon" | "owl" | "hero" | "crown" | "heart" | "torch";

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
