// Local design preview for the chef's d20 dish art. Not part of CI: it needs Google Chrome (set CHROME to its binary).
//   node --no-warnings scripts/dish-art-preview.ts [out-dir]   PNG contact sheets; the default out-dir is local only:
//                                                              ~/.gstack/projects/chihgeorge-critical-answer/research/dish-art
//   node --no-warnings scripts/dish-art-preview.ts --hash      one hash over every dish (and its empty plate) that is not new, to prove they did not change
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

type Art = typeof import("../lib/pixel-art.ts") & typeof import("../lib/monster-catalog.ts") & typeof import("../lib/sprite-kind.ts");
type Kind = import("../lib/sprite-kind.ts").SpriteKind;
type Cell = { kind: Kind; scale: number; glow?: "rays" | "soft"; bites?: number; label: string; sub?: string };
type Sheet = { file: string; title: string; cols: number; cellW: number; cellH: number; bg?: string; cells: Cell[] };

/** Suggested legendary names (a natural 20), for the owner to pick from; the catalog is another lane's. */
const LEGEND_NAME: Record<string, string> = {
  "dish-jelly": "星辰琉璃史萊姆凍",
  "dish-stew": "迷途星河濃湯",
  "dish-tower": "王者皇冠果凍塔",
  "dish-ice": "極光彩虹幽靈冰",
  "dish-riceball": "喜極而泣黃金飯糰",
  "dish-skewer": "炎帝龍息黃金串",
  "dish-mushroom-skewer": "仙境金斑蘑菇串",
  "dish-wings": "夜空蜜汁黃金翅",
  "dish-bone-soup": "千年龍骨白玉湯",
  "dish-bento": "黃金寶藏滿漢便當",
  "dish-cotton-candy": "彩虹雲朵蛛絲糖",
  "dish-escargot": "金殼松露焗蝸牛",
  "dish-brulee": "永恆鬼火皇家布蕾",
  "dish-stone-pot": "熔岩之心石燒鍋",
  "dish-jelly-salad": "深海螢光水母絲",
  "dish-three-cup": "九層塔之王三杯田雞",
  "dish-fondue": "不滅燭火起司瀑布",
  "dish-root-stew": "靜默之根黃金燉",
  "dish-tangyuan": "千里眼寶石湯圓",
  "dish-crab": "黃金鉗帝王清蒸蟹",
  "dish-tofu": "天選六點黃金豆腐",
  "dish-pumpkin-soup": "午夜南瓜黃金濃湯",
  "dish-smoothie": "沙漠綠洲彩虹冰沙",
  "dish-squid": "深淵霸主黃金烤魷魚",
  "dish-roast-chicken": "浴火重生鳳凰全雞",
};

const bundle = (
  await build({
    stdin: { contents: 'export * from "./lib/pixel-art.ts"; export * from "./lib/monster-catalog.ts"; export * from "./lib/sprite-kind.ts";', resolveDir: process.cwd() },
    bundle: true,
    format: "iife",
    globalName: "PA",
    write: false,
  })
).outputFiles[0].text;
const PA = new Function(`${bundle}; return PA;`)() as Art;

if (process.argv[2] === "--hash") {
  const hash = createHash("sha256");
  let data: Uint8ClampedArray = new Uint8ClampedArray(0);
  const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img: { data: Uint8ClampedArray }) => (data = img.data) };
  const old = (Object.keys(PA.SPRITE_SIZE) as Kind[]).filter((k) => /^dish-|^pot$|^smoke$/.test(k) && !k.endsWith("-legend") && k !== "dish-burnt");
  for (const kind of old)
    for (const variant of [0, 1]) {
      PA.drawSprite({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, kind, variant);
      hash.update(kind).update(data);
      PA.drawEmptyPlate({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, kind);
      hash.update(data);
    }
  console.log(old.length, "sprites", hash.digest("hex"));
  process.exit(0);
}

/** Runs in the page: draws one sheet's cells, each dish standing on the bottom of its cell. */
function page(PA: Art, sheet: Sheet) {
  const el = (css: string, ...kids: (Node | string)[]) => {
    const e = document.createElement("div");
    e.style.cssText = css;
    e.append(...kids);
    return e;
  };
  const sprite = (c: Cell, kind = c.kind) => {
    const cv = document.createElement("canvas");
    if ((c.bites ?? 0) >= 4 && kind === c.kind) PA.drawEmptyPlate(cv, kind);
    else {
      PA.drawSprite(cv, kind);
      if (kind === c.kind) PA.biteSprite(cv, c.bites ?? 0);
    }
    cv.style.cssText = `width:${cv.width * c.scale}px;height:${cv.height * c.scale}px;image-rendering:pixelated;position:absolute;left:50%;bottom:0;transform:translateX(-50%)`;
    return cv;
  };
  const ink = sheet.bg ? "#2a1533" : "#fff4dc";
  document.body.style.cssText = `margin:0;padding:24px;background:${sheet.bg ?? "#241a3f"};color:${ink};font:600 18px "PingFang TC",sans-serif`;
  document.body.append(el("font-size:26px;margin-bottom:16px", sheet.title));
  const grid = el(`display:grid;grid-template-columns:repeat(${sheet.cols},${sheet.cellW}px)`);
  for (const c of sheet.cells) {
    const stage = el(`position:relative;height:${sheet.cellH - 64}px`);
    if (c.glow === "rays") stage.append(sprite(c, "legend-rays"));
    if (c.glow === "soft") {
      const d = 60 * c.scale;
      stage.append(el(`position:absolute;left:50%;bottom:${-d / 4}px;width:${d}px;height:${d}px;transform:translateX(-50%);background:radial-gradient(circle,#ffd23ecc 0%,#ffb04a77 38%,#0000 70%)`));
    }
    stage.append(sprite(c));
    grid.append(el(`height:${sheet.cellH}px;text-align:center;overflow:hidden`, stage, el("margin-top:8px;white-space:nowrap", c.label), el("font-size:13px;opacity:.7;font-weight:400", c.sub ?? "")));
  }
  document.body.append(grid);
}

const dishes = Object.entries(PA.DISH_SPRITE).map(([sprite, kind]) => ({ kind: kind as Kind, name: PA.MONSTERS.find((m) => m.sprite === sprite)?.dish.name ?? kind }));
const legend = (kind: Kind) => `${kind}-legend` as Kind;
const pairs = (scale: (k: Kind) => number): Cell[] =>
  dishes.flatMap(({ kind, name }) => [
    { kind, scale: scale(kind), label: name, sub: "2–19" },
    { kind: legend(kind), scale: scale(kind), label: LEGEND_NAME[kind], sub: "20 傳說" },
  ]);
const few: Kind[] = ["dish-jelly", "dish-wings", "dish-pumpkin-soup", "dish-roast-chicken"];
const burntRow = (scale: (k: Kind) => number): Cell[] => [
  { kind: "dish-burnt", scale: scale("dish-burnt"), label: "焦黑殘渣", sub: "1（新圖）" },
  { kind: "dish-rotten", scale: scale("dish-rotten"), label: "黑暗料理", sub: "寶箱事件（對照）" },
  ...few.map((kind) => ({ kind, scale: scale(kind), label: dishes.find((d) => d.kind === kind)!.name, sub: "2–19" })),
];
const styleRow = (kind: Kind, scale: number): Cell[] => [
  { kind, scale, label: "原版", sub: kind },
  { kind: legend(kind), scale, glow: "rays", label: "A 像素光芒", sub: "背後一張會閃的光芒圖" },
  { kind: legend(kind), scale, glow: "soft", label: "B 柔光暈", sub: "背後 CSS 漸層光" },
  { kind: legend(kind), scale, label: "C 只有菜", sub: "金盤＋星光＋加料" },
];
const sheets: Sheet[] = [
  { file: "q1-legend-style.png", title: "傳說料理（骰 20）的風格：A / B / C", cols: 4, cellW: 340, cellH: 280, cells: [...(["dish-jelly", "dish-pumpkin-soup", "dish-roast-chicken"] as Kind[]).flatMap((k) => styleRow(k, PA.dishScale(k))), ...styleRow("dish-jelly", 2)] },
  { file: "burnt.png", title: "骰 1：焦黑殘渣（上：大螢幕比例；中：手機比例；下：被吃掉的過程）", cols: 6, cellW: 260, cellH: 230, cells: [...burntRow(PA.dishScale), ...burntRow(() => 2), ...[0, 1, 2, 3, 4].map((bites) => ({ kind: "dish-burnt" as Kind, scale: PA.dishScale("dish-burnt"), bites, label: bites === 4 ? "空盤" : `咬 ${bites} 口` }))] },
  { file: "legend-stage.png", title: "每道菜：一般（2–19）與傳說（20），大螢幕比例", cols: 6, cellW: 300, cellH: 250, cells: pairs(PA.dishScale) },
  { file: "legend-phone.png", title: "每道菜：一般與傳說，手機比例（×2，淺色底）", cols: 10, cellW: 170, cellH: 150, bg: "#fff4dc", cells: pairs(() => 2) },
  { file: "legend-bites.png", title: "傳說料理被吃掉的過程（檢查用）", cols: 10, cellW: 150, cellH: 170, cells: dishes.flatMap(({ kind }) => [0, 1, 2, 3, 4].map((bites) => ({ kind: legend(kind), scale: 3, bites, label: bites ? "" : LEGEND_NAME[kind].slice(-4) }))) },
];

const out = process.argv[2] ?? join(homedir(), ".gstack/projects/chihgeorge-critical-answer/research/dish-art");
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "dish-art-"));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
for (const sheet of sheets) {
  const html = join(tmp, `${sheet.file}.html`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>${bundle}\n(${page.toString()})(PA, ${JSON.stringify(sheet)})</script>`);
  const size = `${sheet.cols * sheet.cellW + 48},${Math.ceil(sheet.cells.length / sheet.cols) * sheet.cellH + 110}`;
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${size}`, `--screenshot=${join(out, sheet.file)}`, `file://${html}`], { stdio: "ignore" });
  console.log(join(out, sheet.file));
}
