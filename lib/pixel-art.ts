// Program-drawn pixel art, ported from the approved mockup
// (designs/screen-variants-20260918/cute-pixel-proposal.html). Every sprite is
// a small canvas filled cell by cell, so the app ships no image assets and the
// art stays crisp at any integer scale (CSS `image-rendering: pixelated`).

import { ACCESSORIES, type Accessory } from "./monster-catalog";
import type { MonsterSprite, SpriteKind } from "./sprite-kind";

const K = "#2a1533"; // the outline colour

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

/** The six hats, drawn without hue-rotate (the monster's recolor never reaches them), outlined like the crown. */
const ACC: Record<Accessory, { rows: string[]; pal: Record<string, string> }> = {
  crown: { rows: ["y...y...y", "yy.yyy.yy", "yryyryyry", "ooooooooo"], pal: { y: "#ffdd55", r: "#ff6b6b", o: "#e8a824" } },
  "party-hat": { rows: ["...w...", "...b...", "..bbb..", "..yyy..", ".bbbbb.", ".yyyyy.", "bbbbbbb"], pal: { w: "#fff4dc", b: "#5ab0f0", y: "#ffcf4a" } },
  flower: { rows: ["..p.p..", ".ppppp.", "pppyppp", ".ppppp.", "..p.p..", "...g...", "..gg..."], pal: { p: "#ff8fb1", y: "#ffcf4a", g: "#3fa65a" } },
  headband: { rows: ["rrrrrrrrr", "RRRRRRRRR"], pal: { r: "#ff6b6b", R: "#c94848" } },
  bow: { rows: ["pp.....pp", "pppp.pppp", "ppppPpppp", "pppp.pppp", "pp.....pp"], pal: { p: "#ff6bb1", P: "#c2448a" } },
  "pirate-hat": { rows: ["...kkk...", ".kkkkkkk.", "kkkkwkkkk", "kkkwkwkkk", "yyyyyyyyy"], pal: { k: "#4a3a5e", w: "#fff4dc", y: "#ffcf4a" } },
};
/** Native pixel size of each sprite; the component scales it with CSS. */
export const SPRITE_SIZE: Record<SpriteKind, [number, number]> = {
  slime: [32, 30],
  "slime-lost": [32, 38],
  "slime-king": [36, 40],
  ghost: [32, 36],
  "ghost-cry": [32, 36],
  dragon: [52, 46],
  mushroom: [32, 32],
  bat: [36, 28],
  skeleton: [30, 38],
  mimic: [34, 30],
  spider: [36, 30],
  snail: [36, 30],
  wisp: [28, 34],
  golem: [34, 34],
  jellyfish: [30, 36],
  frog: [36, 30],
  candle: [24, 36],
  mandrake: [28, 36],
  eyeball: [30, 30],
  crab: [38, 28],
  dice: [30, 30],
  pumpkin: [34, 30],
  cactus: [30, 36],
  kraken: [52, 48],
  phoenix: [52, 46],
  owl: [28, 28],
  hero: [24, 24],
  crown: [20, 12],
  heart: [11, 10],
  torch: [9, 14],
  campfire: [26, 22],
  door: [20, 26],
  cloud: [18, 10],
  zz: [9, 9],
  pot: [40, 34],
  smoke: [40, 30],
  "dish-jelly": [34, 24],
  "dish-stew": [34, 26],
  "dish-tower": [34, 32],
  "dish-ice": [26, 32],
  "dish-riceball": [36, 24],
  "dish-skewer": [42, 22],
  "dish-mushroom-skewer": [42, 22],
  "dish-wings": [36, 24],
  "dish-bone-soup": [34, 28],
  "dish-bento": [36, 26],
  "dish-cotton-candy": [26, 32],
  "dish-escargot": [36, 24],
  "dish-brulee": [30, 26],
  "dish-stone-pot": [36, 26],
  "dish-jelly-salad": [36, 22],
  "dish-three-cup": [36, 26],
  "dish-fondue": [34, 30],
  "dish-root-stew": [34, 26],
  "dish-tangyuan": [34, 26],
  "dish-crab": [38, 24],
  "dish-tofu": [36, 22],
  "dish-pumpkin-soup": [34, 24],
  "dish-smoothie": [26, 32],
  "dish-squid": [30, 34],
  "dish-roast-chicken": [40, 28],
  ...(Object.fromEntries(Object.entries(ACC).map(([a, g]) => [`acc-${a}`, [g.rows[0].length + 2, g.rows.length + 2]])) as Record<`acc-${Accessory}`, [number, number]>),
};

/** Where a hat's bottom-centre cell goes on each monster, in native pixels from the top-left: on top
 * of the head, low enough that the tallest hat stays inside the sprite (docs/designs/monster-catalog.md §3). */
export const HEAD_ANCHOR: Record<MonsterSprite, [number, number]> = {
  slime: [16, 9],
  "slime-lost": [16, 11],
  "slime-king": [18, 15],
  ghost: [16, 8],
  "ghost-cry": [16, 8],
  dragon: [26, 8],
  mushroom: [16, 8],
  bat: [18, 9],
  skeleton: [14, 8],
  mimic: [17, 9],
  spider: [18, 11],
  snail: [28, 11],
  wisp: [14, 10],
  golem: [17, 9],
  jellyfish: [15, 8],
  frog: [18, 10],
  candle: [12, 15],
  mandrake: [14, 10],
  eyeball: [15, 8],
  crab: [19, 10],
  dice: [15, 9],
  pumpkin: [17, 9],
  cactus: [15, 8],
  kraken: [26, 6],
  phoenix: [34, 8],
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

function accessory(cv: HTMLCanvasElement, a: Accessory) {
  const g = ACC[a];
  const P = new Px(cv, g.rows[0].length + 2, g.rows.length + 2);
  P.grid(g.rows, g.pal, 1, 1);
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

// Live map (docs/designs/live-map.md): the boss room's closed door (D14), a fog cloud (D16) and an
// offline team's "zz" (D11).
const DOOR = [
  "....rrrrrrrr....",
  "..rrRRRRRRRRrr..",
  ".rRRRRRwRRRRRRr.",
  ".rRRRRRwRRRRRRr.",
  "rRRRRRRwRRRRRRRr",
  "rsssssswsssssssr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRyRwRyRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rsssssswsssssssr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rRRRRRRwRRRRRRRr",
  "rrrrrrrrrrrrrrrr",
];
const DOOR_PAL = { r: "#5a1a2a", R: "#7a2438", w: "#3c1020", s: "#5a5670", y: "#ffcf4a" };
const CLOUD = ["....llll........", "..llwwwwll.lll..", ".lwwwwwwwwlwwwl.", "lwwwwwwwwwwwwwwl", "lwwwwwwwwwwwwwwl", ".llllllllllllll."];
const ZZ = ["zzzz...", "..z....", ".z.....", "zzzz...", "...zzz.", "....z..", "...zzz."];
function door(cv: HTMLCanvasElement) {
  const P = new Px(cv, 20, 26);
  P.grid(DOOR, DOOR_PAL, 2, 3);
  P.outline(K);
  P.flush();
}
function cloud(cv: HTMLCanvasElement) {
  const P = new Px(cv, 18, 10);
  P.grid(CLOUD, { w: "#e9defa", l: "#cdbdf0" }, 1, 2);
  P.outline(K);
  P.flush();
}
function zz(cv: HTMLCanvasElement) {
  const P = new Px(cv, 9, 9);
  P.grid(ZZ, { z: "#fff4dc" }, 1, 1);
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

/* ---------- cooking (docs/designs/monster-cuisine.md, cooking R7) ---------- */

const PLATE = "#fff4dc";
const PLATE_DARK = "#d8c8a8";
const STEAM = "#ffffff";

/** The pot over the fire. `frame` 0/1 moves the bubbles, so the screen flicks between two canvases (DESIGN.md: steps(2)). */
function pot(cv: HTMLCanvasElement, frame: number) {
  const P = new Px(cv, 40, 34);
  // The broth on top, then the iron body, the rim and the two handles.
  P.ell(20, 9, 15, 4, "#ffb84d");
  P.ellIn(20, 9, 12, 2.5, "#ffd98a");
  P.rect(5, 10, 30, 14, "#4a4660");
  P.ell(20, 23, 15, 4, "#4a4660");
  P.rect(5, 10, 30, 3, "#6a6688");
  P.rect(1, 13, 4, 3, "#4a4660");
  P.rect(35, 13, 4, 3, "#4a4660");
  P.shade(20, 18, 15, 9, "#35324a", 2, 1);
  P.outline(K);
  const bubbles = frame % 2 === 0 ? [[11, 6], [24, 7], [17, 2]] : [[14, 7], [27, 4], [20, 1]];
  for (const [x, y] of bubbles) {
    P.rect(x, y, 3, 3, "#fff6c0");
    P.set(x, y, "#fff");
    P.set(x + 2, y + 2, "#ffb84d");
  }
  // The fire under it: two flame frames, like the torch.
  const flames =
    frame % 2 === 0
      ? ["..y.....y.....y...", ".yoy...yoy...yoy..", "yoOoy.yoOoy.yoOoy.", "oOOOooOOOooOOOoo.."]
      : ["....y.....y.....y.", "...yoy...yoy...yoy", "..yoOoy.yoOoy.yoOo", "..oOOOooOOOooOOOoo"];
  P.grid(flames, TORCH_PAL, 11, 28);
  P.flush();
}

/** The puff of smoke between the pot and the dish. */
function smoke(cv: HTMLCanvasElement) {
  const P = new Px(cv, 40, 30);
  P.ell(12, 18, 9, 8, "#e9e4f4");
  P.ell(27, 17, 10, 9, "#e9e4f4");
  P.ell(19, 10, 9, 8, "#f8f6ff");
  P.ell(20, 22, 12, 6, "#d8d0ea");
  P.ellIn(16, 8, 4, 3, "#ffffff");
  P.outline(K);
  P.flush();
}

/** A plate under a dish, `y` its top row. */
function plate(P: Px, y: number, w: number) {
  const cx = P.w / 2;
  P.ell(cx, y + 2, w / 2, 2.5, PLATE);
  P.ellIn(cx, y + 3, w / 2, 1.2, PLATE_DARK);
}

/** Two wisps of steam over a hot dish. */
function steam(P: Px, xs: number[], y: number) {
  for (const x of xs) P.grid(["s.", ".s", "s.", ".s"], { s: STEAM }, x, y);
}

/** 史萊姆 → a wobbly green jelly on a plate. */
function dishJelly(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 24);
  plate(P, 18, 32);
  P.ell(17, 15, 12, 9, GREEN_SLIME.body);
  P.cut((_x, y) => y > 18);
  P.shade(17, 15, 12, 9, GREEN_SLIME.dark, 2, 2);
  P.ellIn(13, 9, 5, 3, GREEN_SLIME.light);
  P.outline(K);
  P.rect(11, 8, 2, 1, "#fff");
  P.set(11, 9, "#fff");
  P.flush();
}

/** 迷途史萊姆 → a hot bowl of blue stew. */
function dishStew(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 26);
  P.rect(3, 13, 28, 4, "#f4ecff");
  P.ell(17, 17, 14, 7, "#f4ecff");
  P.cut((_x, y) => y > 23);
  P.shade(17, 17, 14, 7, "#cdbdf0", 2, 1);
  // The soup sits in the bowl's mouth, drawn last so the bowl doesn't cover it.
  P.ell(17, 12, 14, 3.5, BLUE_SLIME.body);
  P.ellIn(15, 11, 8, 1.5, BLUE_SLIME.light);
  P.outline(K);
  P.set(12, 11, "#8f74e8");
  P.set(20, 12, "#ffb84d");
  steam(P, [11, 17, 23], 3);
  P.flush();
}

/** 史萊姆王 → a tall purple jelly tower, crowned with a gold cherry. */
function dishTower(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 32);
  plate(P, 26, 32);
  P.rect(7, 18, 20, 9, PURPLE_SLIME.body);
  P.rect(9, 10, 16, 9, PURPLE_SLIME.body);
  P.rect(11, 4, 12, 7, PURPLE_SLIME.body);
  P.rect(24, 18, 3, 9, PURPLE_SLIME.dark);
  P.rect(22, 10, 3, 9, PURPLE_SLIME.dark);
  P.rect(20, 4, 3, 7, PURPLE_SLIME.dark);
  P.rect(12, 5, 2, 4, PURPLE_SLIME.light);
  P.ell(17, 3, 2.5, 2.5, "#ffcf4a");
  P.outline(K);
  P.set(16, 2, "#fff6b0");
  P.flush();
}

/** 幽靈 → shaved ice in a glass, a ghost-white heap with a little syrup. */
function dishIce(cv: HTMLCanvasElement) {
  const P = new Px(cv, 26, 32);
  P.ell(13, 10, 10, 8, "#f4ecff");
  P.cut((_x, y) => y > 14);
  P.ellIn(10, 6, 4, 3, "#ffffff");
  P.ellIn(16, 11, 5, 3, "#ff9db8");
  P.grid(["gggggggggggggggggg", ".gggggggggggggggg.", "..gggggggggggggg..", "...gggggggggggg...", "....gggggggggg....", ".....gggggggg.....", "......gggggg......", ".......gggg.......", "........gg........", "........gg........", "........gg........", "......gggggg......", "....gggggggggg...."], { g: "#b8e4ff" }, 4, 15);
  P.outline(K);
  P.rect(7, 16, 2, 4, "#ffffff");
  P.flush();
}

/** 哭哭幽靈 → two grilled rice balls with a sprinkle of tear salt. */
function dishRiceball(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 24);
  plate(P, 18, 34);
  for (const cx of [11, 25]) {
    P.ell(cx, 12, 8, 7, "#fff8ec");
    P.rect(cx - 7, 12, 14, 7, "#fff8ec");
    P.rect(cx - 4, 13, 8, 6, "#3a3a4a");
    P.ellIn(cx, 8, 3, 2, "#f0d8a8");
  }
  P.outline(K);
  for (const [x, y] of [[8, 6], [13, 9], [23, 7], [28, 9]]) P.set(x, y, "#8fd4ff");
  P.flush();
}

/** 小黑龍 → roasted dragon-tail skewer, charred purple chunks on a stick. */
function dishSkewer(cv: HTMLCanvasElement) {
  const P = new Px(cv, 42, 22);
  P.rect(1, 12, 40, 2, "#b07a4f");
  for (const x of [5, 15, 25]) {
    P.rect(x, 6, 9, 13, "#7b5cd6");
    P.rect(x, 6, 9, 3, "#9a80e8");
    P.rect(x + 6, 9, 3, 10, "#5a3fb0");
  }
  P.outline(K);
  for (const x of [7, 17, 27]) P.rect(x, 13, 3, 1, "#3a2a5a");
  steam(P, [10, 20, 30], 0);
  P.flush();
}

/* ---------- the catalog roster, PR2 (docs/designs/monster-catalog.md R4) ---------- */

const BLUSH = "#ff9db8";
/** A row of grid strings, flipped left to right (for a right wing or arm). */
const mirror = (rows: string[]) => rows.map((r) => [...r].reverse().join(""));
/** A one-cell line from (x0, y0) to (x1, y1). */
function line(P: Px, x0: number, y0: number, x1: number, y1: number, c: string) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) P.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
}
/** A small smile: two corners and a centre dip. */
function smile(P: Px, x: number, y: number) {
  P.set(x, y, K);
  P.set(x + 1, y + 1, K);
  P.set(x + 2, y, K);
}

/** 碎碎蘑菇: a red spotted cap on a stubby stem, dropping crumbs. */
function mushroom(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 32, 32);
  P.rect(9, 16, 14, 11, "#fff1d6");
  P.ell(16, 27, 7, 2.5, "#fff1d6");
  P.rect(20, 16, 3, 11, "#ecd2a8");
  P.ell(16, 13, 15, 9, "#e8463c");
  P.cut((x, y) => y > 17 && (x < 9 || x > 22));
  P.cut((_x, y) => y > 29);
  P.shade(16, 13, 15, 9, "#b52f34", 2, 2);
  P.rect(3, 17, 26, 1, "#b52f34");
  P.ellIn(10, 9, 2.6, 2, "#fff6ec");
  P.ellIn(20, 7, 2.2, 1.6, "#fff6ec");
  P.ellIn(25, 12, 2, 1.8, "#fff6ec");
  P.ellIn(6, 14, 1.6, 1.4, "#fff6ec");
  P.ellIn(16, 13, 1.5, 1.3, "#fff6ec");
  P.outline(K);
  eye(P, 11, 20, b);
  eye(P, 18, 20, b);
  P.rect(9, 25, 2, 1, BLUSH);
  P.rect(21, 25, 2, 1, BLUSH);
  smile(P, 15, 25);
  for (const [x, y] of [[4, 30], [27, 29], [25, 31], [7, 31]]) P.set(x, y, "#ecd2a8");
  P.flush();
}

/** 倒掛蝙蝠: a round purple bat with wide scalloped wings and two little fangs. */
function bat(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 36, 28);
  const wing = ["w..........", "ww.........", "www........", "wwww.......", "wwwww......", "wwwwww.....", "wwwwwww....", "wwwwwwww...", "wwwwwwwww..", "w.wwwwwwwww", "...w..wwwww", ".......w.ww"];
  P.grid(wing, { w: "#5e4596" }, 1, 7);
  P.grid(mirror(wing), { w: "#5e4596" }, 24, 7);
  P.grid(["e..", "ee.", "eee", "eee"], { e: "#8a64c8" }, 11, 4);
  P.grid(["..e", ".ee", "eee", "eee"], { e: "#8a64c8" }, 22, 4);
  P.ell(18, 15, 8, 8, "#8a64c8");
  P.shade(18, 15, 8, 8, "#6a4aa8", 2, 2);
  P.ellIn(18, 19, 4.5, 3.5, "#b496e8");
  P.rect(15, 23, 2, 2, "#ffb84d");
  P.rect(20, 23, 2, 2, "#ffb84d");
  P.outline(K);
  eye(P, 13, 11, b);
  eye(P, 20, 11, b);
  P.rect(11, 16, 2, 1, BLUSH);
  P.rect(23, 16, 2, 1, BLUSH);
  P.rect(16, 17, 4, 1, K);
  P.set(16, 18, "#fff");
  P.set(19, 18, "#fff");
  P.flush();
}

/** 喀啦骷髏兵: a big-skulled skeleton holding a little sword. */
function skeleton(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 30, 38);
  const BONE = "#f4efe4";
  const BONE_DK = "#d8cfbd";
  P.rect(23, 13, 1, 12, "#d8d4ee");
  P.rect(21, 23, 5, 1, "#b07a4f");
  P.rect(23, 24, 1, 3, "#7a4a34");
  P.ell(14, 12, 8.5, 7, BONE);
  P.rect(9, 16, 10, 4, BONE);
  P.shade(14, 12, 8.5, 7, BONE_DK, 2, 2);
  P.rect(13, 20, 2, 11, BONE);
  P.rect(9, 22, 10, 1, BONE);
  P.rect(10, 24, 8, 1, BONE);
  P.rect(10, 26, 8, 1, BONE);
  P.rect(6, 21, 2, 7, BONE);
  P.rect(20, 21, 2, 6, BONE);
  P.rect(10, 29, 8, 2, BONE);
  P.rect(10, 31, 2, 5, BONE);
  P.rect(16, 31, 2, 5, BONE);
  P.rect(8, 35, 4, 1, BONE);
  P.rect(16, 35, 4, 1, BONE);
  P.outline(K);
  eye(P, 8, 10, b, true);
  eye(P, 16, 10, b, true);
  P.set(13, 16, K);
  P.set(14, 16, K);
  for (const x of [10, 12, 14, 16, 18]) P.set(x, 18, K);
  P.rect(9, 19, 11, 1, K);
  P.flush();
}

/** 寶箱怪: a treasure chest whose lid is a toothy mouth, tongue out. */
function mimic(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 34, 30);
  const WOOD = "#b5733a";
  P.rect(3, 6, 28, 9, WOOD);
  P.rect(4, 5, 26, 1, WOOD);
  P.rect(3, 17, 28, 11, "#9a5a2a");
  P.rect(3, 15, 28, 2, "#4a1030");
  P.rect(28, 6, 3, 9, "#8a5226");
  P.rect(28, 17, 3, 11, "#7a4220");
  P.rect(3, 11, 28, 1, "#8a5226");
  P.rect(3, 22, 28, 1, "#7a4220");
  for (const x of [5, 26]) {
    P.rect(x, 5, 2, 10, "#ffcf4a");
    P.rect(x, 17, 2, 11, "#ffcf4a");
  }
  P.rect(15, 18, 4, 4, "#ffcf4a");
  P.outline(K);
  for (let x = 4; x < 30; x += 3) {
    P.set(x, 15, "#fff");
    P.set(x + 1, 16, "#fff");
  }
  P.rect(19, 16, 4, 3, "#ff6b8a");
  P.set(16, 19, K);
  P.set(17, 19, K);
  P.set(16, 20, K);
  eye(P, 10, 7, b);
  eye(P, 21, 7, b);
  P.flush();
}

/** 毛毛蜘蛛: a fuzzy dark spider, eight bent legs and rosy cheeks. */
function spider(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 36, 30);
  const LEG = "#4a3a5e";
  const legs = [[12, 15, 6, 8, 2, 14], [11, 18, 4, 12, 1, 19], [11, 21, 4, 17, 1, 24], [13, 24, 6, 22, 3, 28]];
  for (const [sx, sy, kx, ky, tx, ty] of legs) {
    line(P, sx, sy, kx, ky, LEG);
    line(P, kx, ky, tx, ty, LEG);
    line(P, 35 - sx, sy, 35 - kx, ky, LEG);
    line(P, 35 - kx, ky, 35 - tx, ty, LEG);
  }
  P.ell(18, 18, 9, 8.5, "#5a4870");
  P.shade(18, 18, 9, 8.5, "#3e3052", 2, 2);
  P.ellIn(15, 13, 4, 2.5, "#7a6894");
  for (const x of [12, 15, 18, 21, 24]) P.set(x, 9, "#5a4870");
  P.outline(K);
  eye(P, 13, 15, b);
  eye(P, 20, 15, b);
  P.set(15, 12, "#ff8fb1");
  P.set(20, 12, "#ff8fb1");
  P.rect(10, 20, 2, 1, BLUSH);
  P.rect(24, 20, 2, 1, BLUSH);
  P.set(16, 22, "#fff");
  P.set(19, 22, "#fff");
  P.rect(16, 21, 4, 1, K);
  P.flush();
}

/** 慢吞吞蝸牛: an orange spiral shell on a soft green body, sleepy eyes. */
function snail(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 36, 30);
  const BODY = "#9ee08a";
  P.rect(25, 4, 1, 8, "#6fb85a");
  P.rect(31, 4, 1, 8, "#6fb85a");
  P.ell(25.5, 4, 1.8, 1.8, BODY);
  P.ell(31.5, 4, 1.8, 1.8, BODY);
  P.ell(28, 18, 6, 8, BODY);
  P.rect(3, 22, 29, 5, BODY);
  P.ell(4, 25, 3, 2, BODY);
  P.rect(3, 26, 29, 1, "#6fb85a");
  P.ell(14, 15, 10, 9.5, "#f0a850");
  P.shade(14, 15, 10, 9.5, "#c97a2a", 2, 2);
  P.ellIn(14, 15, 6.5, 6, "#d88a38");
  P.ellIn(13, 14, 4.5, 4, "#f0a850");
  P.ellIn(14, 15, 2.5, 2.2, "#d88a38");
  P.ellIn(13, 14, 1, 1, "#f0a850");
  P.ellIn(10, 9, 3, 1.5, "#ffd090");
  P.outline(K);
  if (b) {
    P.rect(25, 18, 3, 1, K);
    P.rect(29, 18, 3, 1, K);
  } else {
    // Half-shut, sleepy eyes.
    P.rect(25, 17, 3, 1, K);
    P.rect(25, 18, 3, 2, K);
    P.rect(29, 17, 3, 1, K);
    P.rect(29, 18, 3, 2, K);
    P.set(25, 18, "#fff");
    P.set(29, 18, "#fff");
  }
  P.rect(23, 21, 2, 1, BLUSH);
  P.rect(32, 21, 2, 1, BLUSH);
  P.rect(27, 22, 3, 1, K);
  P.flush();
}

/** 鬼火精: a blue flame drop with a flickering tip. */
function wisp(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 28, 34);
  P.grid(["....f....", "...ff....", "...fff..f", "..ffff.ff", "..fffffff", ".ffffffff", "fffffffff"], { f: "#5ab0f0" }, 9, 6);
  P.grid(["f..", "ff.", "fff"], { f: "#5ab0f0" }, 5, 10);
  P.ell(14, 22, 10, 9.5, "#5ab0f0");
  P.shade(14, 22, 10, 9.5, "#3f7fb8", 2, 2);
  P.ellIn(13, 23, 6, 5.5, "#8fd4ff");
  P.ellIn(12, 21, 3, 2.5, "#c8ecff");
  P.outline(K);
  eye(P, 9, 20, b);
  eye(P, 16, 20, b);
  P.rect(7, 26, 2, 1, BLUSH);
  P.rect(19, 26, 2, 1, BLUSH);
  P.rect(13, 26, 2, 2, "#2a5a8a");
  for (const [x, y] of [[3, 6], [24, 4], [25, 16]]) P.set(x, y, "#b0e0ff");
  P.flush();
}

/** 小石魔像: a little golem of stacked stone blocks, moss on its head and glowing eyes. */
function golem(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 34, 34);
  const STONE = "#8a8aa0";
  const STONE_DK = "#6a6a80";
  // Separate blocks: the one-cell gaps between them become outline seams.
  for (const [x, y, w, h] of [[10, 6, 14, 11], [5, 18, 24, 10], [0, 19, 4, 9], [30, 19, 4, 9], [8, 29, 6, 4], [20, 29, 6, 4]]) {
    P.rect(x, y, w, h, STONE);
    P.rect(x + w - 2, y, 2, h, STONE_DK);
  }
  P.rect(10, 6, 14, 3, "#6fd36a");
  P.rect(12, 9, 3, 1, "#6fd36a");
  P.rect(19, 9, 2, 2, "#6fd36a");
  P.outline(K);
  for (const [x, y] of [[8, 21], [9, 22], [20, 24], [21, 25], [1, 23]]) P.set(x, y, STONE_DK);
  if (b) {
    P.rect(12, 12, 3, 1, K);
    P.rect(19, 12, 3, 1, K);
  } else {
    P.rect(12, 11, 3, 2, "#ffcf4a");
    P.rect(19, 11, 3, 2, "#ffcf4a");
    P.set(12, 11, "#fff6c0");
    P.set(19, 11, "#fff6c0");
  }
  P.rect(15, 15, 4, 1, K);
  P.flush();
}

/** 地底水母: a lilac jellyfish bell trailing wavy tentacles. */
function jellyfish(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 30, 36);
  for (const x of [6, 9, 12, 15, 18, 21, 24]) {
    for (let y = 16; y < 33; y++) P.set(x + (Math.floor((y + x) / 3) % 2), y, "#b48ae0");
  }
  P.ell(15, 13, 12, 9, "#c9a0f0");
  P.cut((_x, y) => y > 14 && y < 16);
  P.rect(3, 14, 24, 2, "#a07be8");
  P.shade(15, 13, 12, 9, "#a07be8", 2, 2);
  P.ellIn(11, 8, 5, 2.5, "#ead8ff");
  P.outline(K);
  eye(P, 10, 9, b);
  eye(P, 17, 9, b);
  P.rect(7, 13, 2, 1, BLUSH);
  P.rect(21, 13, 2, 1, BLUSH);
  smile(P, 14, 13);
  P.set(9, 6, "#fff");
  P.set(10, 6, "#fff");
  P.flush();
}

/** 沼澤胖蛙: a round green frog, bulging eyes and a wide grin. */
function frog(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 36, 30);
  const G = "#6fd36a";
  P.ell(8, 27, 4.5, 2.2, "#3fa65a");
  P.ell(28, 27, 4.5, 2.2, "#3fa65a");
  P.ell(11, 9, 5.5, 5, G);
  P.ell(25, 9, 5.5, 5, G);
  P.ell(18, 19, 16, 9.5, G);
  P.cut((_x, y) => y > 27);
  P.shade(18, 19, 16, 9.5, "#3fa65a", 2, 2);
  P.ellIn(18, 23, 10, 4.5, "#d8f5a8");
  P.outline(K);
  P.ell(11, 9, 3.6, 3.4, "#fff");
  P.ell(25, 9, 3.6, 3.4, "#fff");
  eye(P, 10, 7, b);
  eye(P, 24, 7, b);
  P.rect(5, 17, 3, 1, BLUSH);
  P.rect(28, 17, 3, 1, BLUSH);
  P.rect(13, 17, 10, 1, K);
  P.set(12, 16, K);
  P.set(23, 16, K);
  P.flush();
}

/** 蠟燭精: a dripping candle with a live flame and a face in the wax. */
function candle(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 24, 36);
  P.ell(12, 33, 10, 2.2, "#b07a4f");
  P.rect(5, 14, 14, 19, "#fff4dc");
  P.rect(16, 14, 3, 19, "#e8d8b0");
  P.rect(6, 14, 2, 6, "#fffaf0");
  P.rect(4, 17, 1, 3, "#fff4dc");
  P.rect(19, 15, 1, 5, "#e8d8b0");
  P.ell(12, 14, 7, 1.6, "#fffaf0");
  P.rect(11, 11, 1, 3, "#4a3a5e");
  P.grid(["..y..", ".yoy.", "yoOoy", "yoOoy", ".yoy."], TORCH_PAL, 9, 5);
  P.outline(K);
  eye(P, 7, 20, b);
  eye(P, 13, 20, b);
  P.rect(5, 25, 2, 1, BLUSH);
  P.rect(17, 25, 2, 1, BLUSH);
  P.rect(11, 25, 2, 1, K);
  P.flush();
}

/** 尖叫曼德拉草: a tan root with a leafy top, screwed-up eyes and a screaming mouth. */
function mandrake(cv: HTMLCanvasElement) {
  const P = new Px(cv, 28, 36);
  const ROOT = "#c99a6a";
  P.rect(13, 3, 2, 7, "#3fa65a");
  P.ell(9, 5, 4, 2.2, "#6fd36a");
  P.ell(19, 5, 4, 2.2, "#6fd36a");
  P.ell(14, 2.5, 2, 2, "#6fd36a");
  P.rect(3, 19, 4, 2, ROOT);
  P.rect(21, 19, 4, 2, ROOT);
  P.rect(10, 30, 2, 5, ROOT);
  P.rect(16, 30, 2, 5, ROOT);
  P.ell(14, 21, 9, 11, ROOT);
  P.shade(14, 21, 9, 11, "#a07a4a", 2, 2);
  P.ellIn(11, 15, 3.5, 3, "#e0b888");
  P.outline(K);
  // Screwed-shut > < eyes: it screams too hard to blink.
  for (const [x, y] of [[8, 16], [9, 17], [10, 18], [9, 19], [8, 20], [19, 16], [18, 17], [17, 18], [18, 19], [19, 20]]) P.set(x, y, K);
  P.ell(14, 25, 2.6, 3.4, K);
  P.ellIn(14, 26.5, 1.6, 1.4, "#ff6b8a");
  P.rect(7, 22, 2, 1, BLUSH);
  P.rect(19, 22, 2, 1, BLUSH);
  for (const [x, y] of [[20, 27], [7, 26], [21, 13]]) P.set(x, y, "#7a5a3a");
  P.flush();
}

/** 浮游眼球: one huge floating eye with a blue iris and a few red veins. */
function eyeball(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 30, 30);
  P.ell(15, 16, 12, 12, "#fffaf0");
  P.shade(15, 16, 12, 12, "#e8dcd0", 2, 2);
  for (const [x, y] of [[4, 13], [5, 14], [5, 15], [24, 10], [25, 9], [23, 22], [24, 23], [7, 22], [6, 23]]) P.set(x, y, "#ff6b6b");
  P.outline(K);
  if (b) {
    P.ell(15, 16, 7, 7, "#e8dcd0");
    P.rect(8, 16, 15, 1, K);
  } else {
    P.ell(15, 16, 6.5, 6.5, "#4a86ff");
    P.ellIn(15, 16, 4.5, 4.5, "#2f5fd0");
    P.ell(15, 16, 2.6, 2.6, K);
    P.rect(11, 12, 2, 2, "#fff");
    P.set(17, 19, "#b0d0ff");
  }
  P.rect(5, 19, 2, 1, BLUSH);
  P.rect(23, 19, 2, 1, BLUSH);
  P.flush();
}

/** 鐵殼螃蟹: a red crab with a riveted shell and two raised claws. */
function crab(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 38, 28);
  const RED = "#e8463c";
  for (let i = 0; i < 3; i++) {
    P.rect(3 + i, 20 + i * 2, 5, 1, "#b52f34");
    P.rect(30 - i, 20 + i * 2, 5, 1, "#b52f34");
  }
  P.rect(6, 11, 3, 7, RED);
  P.rect(29, 11, 3, 7, RED);
  P.ell(6, 7, 4.5, 4.5, RED);
  P.ell(32, 7, 4.5, 4.5, RED);
  P.cut((x, y) => y < 7 && Math.abs(x - 6) < 1.5 && y > 1);
  P.cut((x, y) => y < 7 && Math.abs(x - 32) < 1.5 && y > 1);
  P.rect(14, 6, 1, 5, "#b52f34");
  P.rect(23, 6, 1, 5, "#b52f34");
  P.ell(14.5, 5.5, 1.5, 1.5, RED);
  P.ell(23.5, 5.5, 1.5, 1.5, RED);
  P.ell(19, 17, 13, 8.5, RED);
  P.cut((_x, y) => y > 24);
  P.shade(19, 17, 13, 8.5, "#b52f34", 2, 2);
  P.rect(8, 12, 22, 1, "#c9c9dc");
  P.ellIn(13, 11, 4, 1.5, "#ff8a7a");
  P.outline(K);
  for (const x of [10, 15, 23, 28]) P.set(x, 12, "#fff");
  eye(P, 13, 14, b);
  eye(P, 22, 14, b);
  P.rect(10, 19, 2, 1, BLUSH);
  P.rect(26, 19, 2, 1, BLUSH);
  P.rect(17, 20, 4, 1, K);
  P.flush();
}

/** 骰子怪: a white die with corner pips and a face. */
function dice(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 30, 30);
  P.rect(5, 7, 20, 20, "#fffaf0");
  P.rect(22, 7, 3, 20, "#e0d8c8");
  P.rect(5, 25, 20, 2, "#e0d8c8");
  P.cut((x, y) => (x === 5 || x === 24) && (y === 7 || y === 26));
  P.outline(K);
  for (const [x, y] of [[7, 9], [20, 9], [7, 22], [20, 22]]) P.rect(x, y, 2, 2, "#e8463c");
  eye(P, 10, 13, b);
  eye(P, 17, 13, b);
  P.rect(8, 19, 2, 1, BLUSH);
  P.rect(20, 19, 2, 1, BLUSH);
  P.rect(14, 19, 2, 2, "#e8463c");
  P.flush();
}

/** 南瓜頭: a jack-o'-lantern with a curly stem and a zigzag grin. */
function pumpkin(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 34, 30);
  const OR = "#ff9a3c";
  P.rect(16, 3, 3, 6, "#3fa65a");
  P.ell(21, 4, 3, 1.6, "#6fd36a");
  P.ell(17, 18, 15, 10.5, OR);
  P.shade(17, 18, 15, 10.5, "#d8701c", 2, 2);
  for (const x of [9.5, 17.5, 25.5]) P.ellIn(x, 18, 0.6, 10, "#d8701c");
  P.ellIn(10, 12, 3, 2, "#ffc080");
  P.outline(K);
  eye(P, 10, 14, b);
  eye(P, 21, 14, b);
  P.rect(6, 20, 2, 1, BLUSH);
  P.rect(26, 20, 2, 1, BLUSH);
  for (let i = 0; i < 9; i++) P.set(13 + i, 22 + (i % 2), K);
  P.flush();
}

/** 刺刺仙人掌: a potted cactus with two arms, white spines and a pink flower. */
function cactus(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 30, 36);
  const G = "#5fd067";
  P.ell(15, 8, 5, 3, G);
  P.rect(10, 8, 10, 22, G);
  P.rect(3, 13, 4, 8, G);
  P.ell(5, 13, 2, 1.5, G);
  P.rect(3, 19, 8, 3, G);
  P.rect(23, 9, 4, 9, G);
  P.ell(25, 9, 2, 1.5, G);
  P.rect(19, 15, 8, 3, G);
  P.rect(17, 8, 3, 22, "#3fa65a");
  P.rect(13, 10, 1, 18, "#8fe08a");
  P.ell(25, 6, 2.5, 2, "#ff8fb1");
  P.rect(6, 29, 18, 6, "#c2571f");
  P.rect(5, 29, 20, 2, "#e07a3a");
  P.outline(K);
  P.set(25, 6, "#ffcf4a");
  for (const [x, y] of [[11, 9], [18, 11], [11, 24], [18, 26], [4, 15], [25, 13], [15, 28]]) P.set(x, y, "#fff4dc");
  eye(P, 11, 14, b);
  eye(P, 16, 14, b);
  P.rect(10, 19, 2, 1, BLUSH);
  P.rect(18, 19, 2, 1, BLUSH);
  smile(P, 13, 20);
  P.flush();
}

/** 深海大王烏賊 (boss): a huge magenta squid with a small gold crown and eight curling arms. */
function kraken(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 52, 48);
  const C = "#e85aa8";
  const DK = "#b53a80";
  for (let i = 0; i < 8; i++) {
    const x0 = 8 + i * 5;
    for (let t = 0; t < 19; t++) {
      const x = x0 + Math.round(Math.sin(t / 3 + i * 1.3) * 2);
      P.rect(x, 26 + t, t < 13 ? 3 : 2, 1, i % 2 ? C : DK);
    }
  }
  P.ell(26, 18, 15, 14, C);
  P.shade(26, 18, 15, 14, DK, 2, 2);
  P.ellIn(21, 10, 6, 3, "#ff9ad0");
  P.ellIn(34, 9, 2, 1.5, "#ff9ad0");
  P.ellIn(15, 18, 1.6, 1.4, "#ff9ad0");
  P.grid(["y...y...y", "yy.yyy.yy", "yyyyyyyyy"], { y: "#ffcf4a" }, 22, 2);
  P.outline(K);
  P.set(26, 4, "#ff6b6b");
  for (const [x, y] of [[10, 33], [20, 37], [30, 34], [40, 38], [15, 40], [36, 42]]) P.set(x, y, "#ffc0e0");
  eye(P, 17, 15, b, true);
  eye(P, 31, 15, b, true);
  P.rect(16, 13, 5, 1, K);
  P.rect(31, 13, 5, 1, K);
  P.rect(13, 22, 4, 2, BLUSH);
  P.rect(35, 22, 4, 2, BLUSH);
  for (const [x, y] of [[23, 25], [24, 24], [25, 24], [26, 24], [27, 24], [28, 24], [29, 25]]) P.set(x, y, K);
  P.flush();
}

/** 不死火鳥 (boss): a round fire bird with a flame crest, a big burning wing and a fan of tail feathers. */
function phoenix(cv: HTMLCanvasElement, b: boolean) {
  const P = new Px(cv, 52, 46);
  const BODY = "#ff6b3c";
  const FIRE = { y: "#fff08a", o: "#ffa94d", O: "#e2742f" };
  const tail = ["........yyy", "......yyooo", "....yyooOOO", "..yyooOOO..", "yyooOOO....", "yoOOO......", "yoOO.......", ".yoO.......", "..yO.......", "...y......."];
  P.grid(tail, FIRE, 1, 27);
  P.grid(["yyyy", "yyooo", ".yooOO", "..yoOOO"], FIRE, 3, 22);
  P.rect(22, 38, 2, 6, "#ffb84d");
  P.rect(29, 38, 2, 6, "#ffb84d");
  P.rect(20, 43, 5, 1, "#ffb84d");
  P.rect(27, 43, 5, 1, "#ffb84d");
  P.ell(25, 29, 14, 11, BODY);
  P.ell(34, 15, 9, 8.5, BODY);
  P.shade(25, 29, 14, 11, "#c94828", 2, 2);
  P.ellIn(27, 32, 8, 6, "#ffd98a");
  P.grid(["..y......", ".yoy..y..", ".yoOy.yoy", "yoOOoyoOy", "yoOOOOOOy"], FIRE, 29, 2);
  // The wing rises off the back like a flame.
  const wing = ["y..........", "yy....y....", "yoy...yy...", "yoOy..yoy..", "yoOOy.yoOy.", "yoOOOyyoOOy", ".yoOOOOoOOy", ".yoOOOOOOOy", "..yoOOOOOy.", "...yoOOOy..", "....yyyy..."];
  P.grid(wing, FIRE, 11, 14);
  P.grid(["yyyy", "yyyyyy", "yyyy"], { y: "#ffcf4a" }, 42, 14);
  P.outline(K);
  eye(P, 34, 11, b, true);
  P.rect(39, 18, 3, 1, BLUSH);
  P.rect(43, 15, 5, 1, "#c99a1a");
  for (const [x, y] of [[47, 6], [6, 14], [44, 30], [24, 8]]) P.set(x, y, "#fff08a");
  P.flush();
}

/** A bowl, `top` its rim row; the food goes in its mouth afterwards. */
function bowl(P: Px, top: number, rx: number, c = "#f4ecff", dk = "#cdbdf0") {
  const cx = P.w / 2;
  P.rect(cx - rx, top, rx * 2, 4, c);
  P.ell(cx, top + 4, rx, rx / 2, c);
  P.cut((_x, y) => y > top + 4 + rx / 2 - 1);
  P.shade(cx, top + 4, rx, rx / 2, dk, 2, 1);
}

/** 蘑菇 → three grilled mushrooms on a skewer. */
function dishMushroomSkewer(cv: HTMLCanvasElement) {
  const P = new Px(cv, 42, 22);
  P.rect(1, 13, 40, 2, "#b07a4f");
  for (const x of [9, 20, 31]) {
    P.rect(x - 2, 11, 5, 7, "#fff1d6");
    P.ell(x, 9, 5.5, 4, "#c9463c");
    P.cut((xx, y) => y > 10 && Math.abs(xx - x) > 2 && y < 13);
    P.ellIn(x - 2, 7, 1.4, 1, "#fff6ec");
    P.ellIn(x + 2, 8, 1, 1, "#fff6ec");
  }
  P.outline(K);
  for (const x of [9, 20, 31]) P.rect(x - 2, 15, 5, 1, "#8a5226");
  steam(P, [12, 23, 34], 0);
  P.flush();
}

/** 蝙蝠 → two golden fried wings on a plate. */
function dishWings(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 24);
  plate(P, 18, 34);
  const wing = ["....ggg", "..ggggg", ".gggggg", "ggggggg", "gggggg.", "g.gg.g."];
  P.grid(wing, { g: "#e8a83a" }, 6, 11);
  P.grid(mirror(wing), { g: "#e8a83a" }, 19, 11);
  P.grid(wing, { g: "#ffcf6a" }, 7, 10);
  P.grid(mirror(wing), { g: "#ffcf6a" }, 20, 10);
  P.outline(K);
  for (const [x, y] of [[10, 12], [13, 14], [24, 12], [27, 14]]) P.set(x, y, "#c97a2a");
  P.rect(15, 16, 2, 1, "#5fd067");
  steam(P, [11, 23], 2);
  P.flush();
}

/** 骷髏 → a bowl of milky bone broth with a big bone sticking out. */
function dishBoneSoup(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 28);
  P.rect(20, 3, 3, 11, "#f4efe4");
  P.ell(20, 3, 2, 2, "#f4efe4");
  P.ell(23, 3, 2, 2, "#f4efe4");
  bowl(P, 14, 14, "#8a6aa8", "#6a4a88");
  P.ell(17, 14, 14, 3.5, "#fff4dc");
  P.ellIn(14, 13, 7, 1.5, "#ffffff");
  P.outline(K);
  P.set(10, 14, "#5fd067");
  P.set(26, 15, "#5fd067");
  steam(P, [8, 13], 5);
  P.flush();
}

/** 寶箱 → a treasure-chest lunch box: rice, egg, sausage and greens. */
function dishBento(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 26);
  P.rect(3, 2, 30, 8, "#b5733a");
  P.rect(3, 9, 30, 15, "#9a5a2a");
  P.rect(5, 11, 26, 11, "#5a2a1a");
  P.rect(6, 12, 11, 9, "#fff8ec");
  P.rect(18, 12, 6, 4, "#ffd84a");
  P.rect(18, 17, 6, 4, "#ff7a5a");
  P.rect(25, 12, 5, 9, "#5fd067");
  P.rect(5, 2, 2, 8, "#ffcf4a");
  P.rect(29, 2, 2, 8, "#ffcf4a");
  P.outline(K);
  P.set(11, 15, "#e8463c");
  P.rect(20, 13, 2, 2, "#ff9a3c");
  P.set(19, 19, "#fff");
  P.set(27, 14, "#3fa65a");
  P.flush();
}

/** 蜘蛛 → a puff of spider-silk candy floss on a stick. */
function dishCottonCandy(cv: HTMLCanvasElement) {
  const P = new Px(cv, 26, 32);
  P.rect(12, 18, 2, 13, "#e8d8b0");
  P.ell(13, 10, 10, 9, "#fff4fa");
  P.ell(8, 14, 5, 4, "#fff4fa");
  P.ell(18, 14, 5, 4, "#fff4fa");
  P.shade(13, 10, 10, 9, "#ffc8e0", 2, 2);
  P.ellIn(10, 6, 4, 2.5, "#ffffff");
  P.outline(K);
  for (const [x, y] of [[7, 9], [15, 7], [18, 13], [11, 15]]) P.set(x, y, "#e8c0f0");
  P.flush();
}

/** 蝸牛 → snail shells baked with bubbling cheese. */
function dishEscargot(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 24);
  plate(P, 18, 34);
  for (const x of [9, 18, 27]) {
    P.ell(x, 13, 5, 5, "#d88a38");
    P.ellIn(x, 13, 3, 3, "#f0a850");
    P.ellIn(x, 13, 1.2, 1.2, "#c97a2a");
    P.ell(x, 9, 4, 2, "#ffd84a");
  }
  P.outline(K);
  for (const [x, y] of [[8, 8], [19, 8], [28, 9]]) P.set(x, y, "#fff6c0");
  for (const [x, y] of [[11, 9], [16, 9], [26, 8]]) P.set(x, y, "#5fd067");
  steam(P, [13, 22], 0);
  P.flush();
}

/** 鬼火 → crème brûlée with a little blue flame dancing on the caramel. */
function dishBrulee(cv: HTMLCanvasElement) {
  const P = new Px(cv, 30, 26);
  P.rect(3, 15, 24, 8, "#fff4dc");
  P.ell(15, 23, 12, 2, "#fff4dc");
  P.rect(3, 15, 24, 1, "#e8d8b0");
  for (let x = 4; x < 27; x += 3) P.rect(x, 16, 1, 7, "#e8d8b0");
  P.ell(15, 14, 12, 2.5, "#e8a83a");
  P.ellIn(13, 13, 6, 1, "#ffcf6a");
  P.grid(["..f..", ".ff..", ".fff.", "fffff", ".fff."], { f: "#5ab0f0" }, 13, 5);
  P.outline(K);
  P.rect(14, 8, 2, 2, "#c8ecff");
  P.set(9, 14, "#c97a2a");
  P.set(20, 14, "#c97a2a");
  P.flush();
}

/** 魔像 → a stone hot pot, still bubbling. */
function dishStonePot(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 26);
  bowl(P, 10, 15, "#8a8aa0", "#6a6a80");
  P.ell(18, 10, 15, 3.5, "#e8763c");
  P.ellIn(16, 9, 8, 1.5, "#ffa060");
  P.outline(K);
  P.rect(10, 9, 3, 2, "#5fd067");
  P.rect(22, 10, 3, 1, "#fff4dc");
  P.set(16, 10, "#ffcf4a");
  for (const [x, y] of [[8, 16], [26, 19], [14, 20]]) P.set(x, y, "#6a6a80");
  for (const [x, y] of [[13, 6], [21, 5], [25, 7]]) {
    P.set(x, y, "#fff6c0");
    P.set(x + 1, y + 1, "#fff6c0");
  }
  steam(P, [9, 28], 1);
  P.flush();
}

/** 水母 → cold jellyfish strands dressed with chili and coriander. */
function dishJellySalad(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 22);
  plate(P, 16, 34);
  P.ell(18, 13, 12, 5, "#e8dcf8");
  P.cut((_x, y) => y > 16);
  P.outline(K);
  for (let x = 9; x < 28; x += 2) for (let y = 10; y < 16; y++) if ((x + y) % 3 === 0) P.set(x, y, "#c9a0f0");
  for (const [x, y] of [[12, 10], [20, 9], [25, 12], [15, 13]]) P.set(x, y, "#e8463c");
  for (const [x, y] of [[10, 12], [17, 10], [23, 14], [27, 11]]) P.set(x, y, "#3fa65a");
  P.flush();
}

/** 青蛙 → three-cup frog legs in a clay pot, with basil. */
function dishThreeCup(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 26);
  bowl(P, 11, 14, "#3a3a4a", "#26263a");
  P.rect(2, 13, 3, 2, "#3a3a4a");
  P.rect(31, 13, 3, 2, "#3a3a4a");
  P.ell(18, 11, 14, 3.5, "#8a4a22");
  for (const [x, y] of [[11, 9], [17, 8], [23, 9], [14, 11], [21, 11]]) P.ell(x, y, 2.5, 1.8, "#b5733a");
  P.outline(K);
  for (const [x, y] of [[13, 8], [19, 7], [25, 10], [10, 11]]) {
    P.set(x, y, "#3fa65a");
    P.set(x + 1, y, "#5fd067");
  }
  P.set(16, 10, "#fff4dc");
  steam(P, [10, 18, 25], 1);
  P.flush();
}

/** 蠟燭 → a cheese fondue pot over a candle, a bread cube on a fork. */
function dishFondue(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 30);
  bowl(P, 9, 12, "#c94848", "#a03838");
  P.ell(17, 9, 12, 3, "#ffd84a");
  P.ellIn(15, 8, 6, 1.2, "#fff0a0");
  // After the bowl: bowl() trims everything under its base.
  P.rect(26, 2, 1, 12, "#d8d4ee");
  P.rect(24, 1, 5, 4, "#e8b870");
  P.rect(15, 24, 4, 4, "#fff4dc");
  P.grid([".y.", "yoy", ".O."], TORCH_PAL, 15, 20);
  P.rect(8, 28, 18, 1, "#4a3a5e");
  P.outline(K);
  P.set(25, 2, "#c99a4a");
  P.set(26, 13, "#ffd84a");
  P.flush();
}

/** 曼德拉草 → a root-vegetable stew with a leafy top. */
function dishRootStew(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 26);
  P.rect(22, 3, 2, 7, "#3fa65a");
  P.ell(20, 4, 3, 1.6, "#6fd36a");
  P.ell(26, 4, 3, 1.6, "#6fd36a");
  bowl(P, 12, 14);
  P.ell(17, 12, 14, 3.5, "#c97a3a");
  for (const [x, y] of [[10, 11], [16, 12], [24, 11]]) P.ell(x, y, 2.2, 1.5, "#e0b888");
  P.rect(13, 10, 3, 2, "#ff9a3c");
  P.outline(K);
  P.set(19, 11, "#5fd067");
  steam(P, [8, 12], 3);
  P.flush();
}

/** 眼球 → sweet rice balls that look back at you, in a syrup bowl. */
function dishTangyuan(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 26);
  bowl(P, 12, 14, "#4a86ff", "#2f5fd0");
  P.ell(17, 12, 14, 3.5, "#fff0d0");
  for (const [x, y] of [[11, 9], [18, 8], [24, 10]]) P.ell(x, y, 3.5, 3.2, "#fffaf0");
  P.outline(K);
  for (const [x, y] of [[11, 9], [18, 8], [24, 10]]) {
    P.rect(x - 1, y - 1, 2, 2, "#4a86ff");
    P.set(x - 1, y - 1, K);
  }
  P.rect(16, 4, 1, 1, "#ff6b6b");
  steam(P, [6, 28], 4);
  P.flush();
}

/** 螃蟹 → a whole steamed crab on a plate, a lemon wedge on the side. */
function dishCrab(cv: HTMLCanvasElement) {
  const P = new Px(cv, 38, 24);
  plate(P, 18, 36);
  for (let i = 0; i < 3; i++) {
    P.rect(6 + i, 14 + i * 2, 4, 1, "#d8503c");
    P.rect(28 - i, 14 + i * 2, 4, 1, "#d8503c");
  }
  P.ell(7, 7, 3.5, 3, "#ff6b4a");
  P.ell(31, 7, 3.5, 3, "#ff6b4a");
  P.rect(8, 9, 2, 5, "#ff6b4a");
  P.rect(28, 9, 2, 5, "#ff6b4a");
  P.ell(19, 14, 11, 6, "#ff6b4a");
  P.shade(19, 14, 11, 6, "#d8503c", 2, 2);
  P.ell(33, 18, 2.5, 1.6, "#ffe066");
  P.outline(K);
  P.rect(14, 11, 2, 1, "#ffb8a0");
  P.set(16, 13, K);
  P.set(22, 13, K);
  steam(P, [14, 23], 1);
  P.flush();
}

/** 骰子 → cubes of tofu with sauce dots like a die's pips. */
function dishTofu(cv: HTMLCanvasElement) {
  const P = new Px(cv, 36, 22);
  plate(P, 16, 34);
  for (const [x, y] of [[7, 9], [15, 7], [23, 9], [11, 12], [20, 12]]) {
    P.rect(x, y, 6, 6, "#fffaf0");
    P.rect(x + 4, y, 2, 6, "#e8e0d0");
  }
  P.outline(K);
  for (const [x, y] of [[9, 11], [17, 9], [18, 10], [25, 11], [13, 14], [22, 14], [23, 15]]) P.set(x, y, "#8a4a22");
  P.rect(15, 15, 2, 1, "#5fd067");
  P.flush();
}

/** 南瓜 → a bowl of pumpkin soup with a swirl of cream. */
function dishPumpkinSoup(cv: HTMLCanvasElement) {
  const P = new Px(cv, 34, 24);
  bowl(P, 10, 14);
  P.ell(17, 10, 14, 3.5, "#ff9a3c");
  P.ellIn(15, 9, 8, 1.5, "#ffb860");
  P.outline(K);
  for (const [x, y] of [[13, 10], [14, 9], [15, 9], [16, 9], [17, 10], [18, 11], [19, 11], [20, 10]]) P.set(x, y, "#fff8ec");
  P.set(24, 10, "#3fa65a");
  steam(P, [10, 16, 22], 1);
  P.flush();
}

/** 仙人掌 → a green cactus smoothie in a glass with a straw and a pink flower. */
function dishSmoothie(cv: HTMLCanvasElement) {
  const P = new Px(cv, 26, 32);
  P.rect(16, 1, 2, 10, "#ff8fb1");
  P.rect(16, 1, 5, 2, "#ff8fb1");
  P.ell(13, 9, 9, 3, "#a8f0a0");
  P.grid(["gggggggggggggggggg", ".gggggggggggggggg.", ".gggggggggggggggg.", "..gggggggggggggg..", "..gggggggggggggg..", "...gggggggggggg...", "...gggggggggggg...", "....gggggggggg....", "....gggggggggg....", ".....gggggggg.....", ".....gggggggg.....", "......gggggg......", ".......gggg.......", ".......gggg.......", ".....gggggggg....."], { g: "#5fd067" }, 4, 12);
  P.ell(9, 7, 2.2, 1.8, "#ff8fb1");
  P.outline(K);
  P.set(9, 7, "#ffcf4a");
  P.rect(7, 13, 2, 5, "#c8f8c0");
  for (const [x, y] of [[12, 15], [16, 18], [11, 20]]) P.set(x, y, "#3fa65a");
  P.flush();
}

/** 大王烏賊 → a whole grilled squid on a stick, glazed and charred. */
function dishSquid(cv: HTMLCanvasElement) {
  const P = new Px(cv, 30, 34);
  P.rect(14, 22, 2, 11, "#b07a4f");
  for (let i = 0; i < 5; i++) P.rect(8 + i * 3, 18, 2, 7 + (i % 2) * 2, "#c9563a");
  P.ell(15, 10, 8, 10, "#e8763c");
  P.grid(["k.....k", "kk...kk"], { k: "#e8763c" }, 12, 0);
  P.shade(15, 10, 8, 10, "#b5442a", 2, 2);
  P.outline(K);
  for (const y of [7, 11, 15]) for (let x = 10; x < 21; x += 2) P.set(x, y, "#8a2a1a");
  P.rect(11, 4, 2, 3, "#ffb080");
  steam(P, [7, 22], 1);
  P.flush();
}

/** 不死鳥 → a whole roast bird on a plate, still flickering. */
function dishRoastChicken(cv: HTMLCanvasElement) {
  const P = new Px(cv, 40, 28);
  plate(P, 22, 38);
  P.rect(6, 11, 6, 3, "#c97a2a");
  P.ell(5, 12, 2, 2, "#fff4dc");
  P.rect(28, 11, 6, 3, "#c97a2a");
  P.ell(35, 12, 2, 2, "#fff4dc");
  P.ell(20, 15, 12, 8, "#e8a03a");
  P.cut((_x, y) => y > 22);
  P.shade(20, 15, 12, 8, "#b5682a", 2, 2);
  P.ellIn(16, 11, 5, 2.5, "#ffc870");
  P.grid(["..y..y..", ".yoy.yoy", "yoOoyoOy"], TORCH_PAL, 16, 2);
  P.outline(K);
  for (const [x, y] of [[9, 21], [30, 21], [12, 22]]) P.set(x, y, "#5fd067");
  P.set(26, 21, "#ff6b6b");
  P.flush();
}

const DRAW: Record<SpriteKind, (cv: HTMLCanvasElement, variant: number, blink: boolean) => void> = {
  slime: (cv, _v, b) => slime(cv, b),
  "slime-lost": (cv, _v, b) => slimeLost(cv, b),
  "slime-king": (cv, _v, b) => slimeKing(cv, b),
  ghost: (cv, _v, b) => ghost(cv, b),
  "ghost-cry": (cv, _v, b) => ghostCry(cv, b),
  dragon: (cv, _v, b) => dragon(cv, b),
  mushroom: (cv, _v, b) => mushroom(cv, b),
  bat: (cv, _v, b) => bat(cv, b),
  skeleton: (cv, _v, b) => skeleton(cv, b),
  mimic: (cv, _v, b) => mimic(cv, b),
  spider: (cv, _v, b) => spider(cv, b),
  snail: (cv, _v, b) => snail(cv, b),
  wisp: (cv, _v, b) => wisp(cv, b),
  golem: (cv, _v, b) => golem(cv, b),
  jellyfish: (cv, _v, b) => jellyfish(cv, b),
  frog: (cv, _v, b) => frog(cv, b),
  candle: (cv, _v, b) => candle(cv, b),
  mandrake: (cv) => mandrake(cv),
  eyeball: (cv, _v, b) => eyeball(cv, b),
  crab: (cv, _v, b) => crab(cv, b),
  dice: (cv, _v, b) => dice(cv, b),
  pumpkin: (cv, _v, b) => pumpkin(cv, b),
  cactus: (cv, _v, b) => cactus(cv, b),
  kraken: (cv, _v, b) => kraken(cv, b),
  phoenix: (cv, _v, b) => phoenix(cv, b),
  owl: (cv, _v, b) => owl(cv, b),
  hero: (cv, v, b) => hero(cv, v, b),
  crown: (cv) => crown(cv),
  heart: (cv, v) => heart(cv, v === 1),
  torch: (cv, v) => torch(cv, v),
  campfire: (cv, v) => campfire(cv, v),
  door: (cv) => door(cv),
  cloud: (cv) => cloud(cv),
  zz: (cv) => zz(cv),
  pot: (cv, v) => pot(cv, v),
  smoke: (cv) => smoke(cv),
  "dish-jelly": (cv) => dishJelly(cv),
  "dish-stew": (cv) => dishStew(cv),
  "dish-tower": (cv) => dishTower(cv),
  "dish-ice": (cv) => dishIce(cv),
  "dish-riceball": (cv) => dishRiceball(cv),
  "dish-skewer": (cv) => dishSkewer(cv),
  "dish-mushroom-skewer": (cv) => dishMushroomSkewer(cv),
  "dish-wings": (cv) => dishWings(cv),
  "dish-bone-soup": (cv) => dishBoneSoup(cv),
  "dish-bento": (cv) => dishBento(cv),
  "dish-cotton-candy": (cv) => dishCottonCandy(cv),
  "dish-escargot": (cv) => dishEscargot(cv),
  "dish-brulee": (cv) => dishBrulee(cv),
  "dish-stone-pot": (cv) => dishStonePot(cv),
  "dish-jelly-salad": (cv) => dishJellySalad(cv),
  "dish-three-cup": (cv) => dishThreeCup(cv),
  "dish-fondue": (cv) => dishFondue(cv),
  "dish-root-stew": (cv) => dishRootStew(cv),
  "dish-tangyuan": (cv) => dishTangyuan(cv),
  "dish-crab": (cv) => dishCrab(cv),
  "dish-tofu": (cv) => dishTofu(cv),
  "dish-pumpkin-soup": (cv) => dishPumpkinSoup(cv),
  "dish-smoothie": (cv) => dishSmoothie(cv),
  "dish-squid": (cv) => dishSquid(cv),
  "dish-roast-chicken": (cv) => dishRoastChicken(cv),
  ...(Object.fromEntries(ACCESSORIES.map((a) => [`acc-${a}`, (cv: HTMLCanvasElement) => accessory(cv, a)])) as Record<`acc-${Accessory}`, (cv: HTMLCanvasElement) => void>),
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
