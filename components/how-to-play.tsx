"use client";

// The how-to-play slideshow (docs/designs/how-to-play.md D4–D11): INTRO_PAGES pages on the big screen, turned by the host.
// Pages 3 and 5–7 teach the dice; their text is in how-to-play-dice.ts.
import type { ReactNode } from "react";
import { DialogueBox, LabelChip, Panel, Sprite, TurnRibbon } from "@/components/pixel";
import { D20 } from "@/components/d20";
import { CHECK_EXAMPLE, CHEF_DISH_LINE, CLASS_DICE_PAGE, CLASS_SKILLS_ROW, DICE_SCALE, DISH_FACES, DISH_PAGE, FILL_IN_PAGE, POTION_PAGE } from "@/components/how-to-play-dice";
import { CLASS_ICONS, CLASS_IDS, CLASS_LABELS } from "@/lib/game-state";
import { INTRO_PAGES } from "@/lib/protocol";

/** Per page: the topic the host and phone show, the big text, the owl's line and the host's script (D4, D7). */
export const INTRO_PAGE_TEXT: { topic: string; big: string; owl: string; script: string }[] = [
  {
    topic: "輪流上陣・用手機作答",
    big: "各隊輪流上陣，輪到的隊伍用手機作答",
    owl: "輪到誰，怪物就找誰。看大螢幕上方，再拿起手機作答！",
    script: "每一隊輪流出場，輪到哪一隊大螢幕上方會寫，那一隊用手機作答。題目有選擇題、填空題、排序題三種，接下來一頁一頁說。",
  },
  {
    topic: "選擇題",
    big: "點一個選項，再按「鎖定答案」",
    owl: "選擇題點一個答案，按鎖定，等主持人公布答案！",
    script: "選擇題在手機上點一個選項，再按「鎖定答案」。我按「公布答案」後遊戲自動判對錯，不用我來判。",
  },
  FILL_IN_PAGE,
  {
    topic: "排序題",
    big: "按住 ☰ 上下拖，排好再鎖定",
    owl: "排序題按住旁邊的三條線上下拖，四個全對才算答對！",
    script: "排序題有四個項目，規則寫在題目裡。按住項目右邊的 ☰ 上下拖拉排好，再按「鎖定答案」。四個位置全對才算答對；答錯只標出哪幾格錯，下輪再答改錯的就好。",
  },
  DISH_PAGE,
  POTION_PAGE,
  CLASS_DICE_PAGE,
  // The last page names one 逃跑, never 同房／換房: the single flee (#413).
  {
    topic: "答錯與怎麼贏",
    big: "答錯可以下輪再答或逃跑；分數最高的隊伍是冠軍",
    owl: "答錯別慌！準備好了嗎？主持人再按一次 ▶，冒險開始！",
    script: "答錯可以下輪再答（先換下一隊），或逃跑：換一隻怪，換簡單題。打倒首領冒險就結束，但最後看分數，最高的隊伍才是冠軍。",
  },
];

/** 「第 n／8 頁：<topic>」, the phone's live status line (eng D7). */
export const introStatus = (page: number) => `第 ${page}／${INTRO_PAGES} 頁：${INTRO_PAGE_TEXT[page - 1]?.topic ?? ""}`;

/** The host page's double-tap guard key for intro page `page`: one key for 下一頁 on every page but the last, so quick
 * page turns are never dropped (#328 m8); the last page's 開始冒險 still waits out the guard. */
export const introPauseKey = (page: number) => (page >= INTRO_PAGES ? "intro-last" : "intro");

/** 「○ ● ○ ○」: which page is up, for the eye only (the host and phone pages mark it aria-hidden). */
export const introDots = (page: number) => Array.from({ length: INTRO_PAGES }, (_, i) => (i + 1 === page ? "●" : "○")).join(" ");

const miniBtn = (bg: string, text: string, width?: number) => (
  <div className="text-center text-[14px]" style={{ background: bg, border: "3px solid var(--k)", boxShadow: "inset 0 -3px 0 rgba(0,0,0,.2)", padding: "2px 0", width }}>
    {text}
  </div>
);

/** The big text under the picture says what each phone shows, so the phones carry no caption. */
function MiniPhone({ children, height = 120 }: { children: ReactNode; height?: number }) {
  return (
    <div className="flex flex-col justify-between" style={{ width: 150, height, background: "#3a2a44", border: "4px solid #000", borderRadius: 10, padding: 8 }}>
      {children}
    </div>
  );
}

const cell = { border: "3px solid var(--k)", padding: "4px 10px", background: "var(--cream)" } as const;

const mcPhone = (picked: number) => (
  <MiniPhone>
    <div className="grid grid-cols-2 gap-1 text-[14px]">
      {["A 火", "B 水", "C 風", "D 土"].map((o, i) => (
        <div key={o} style={{ background: i === picked ? "var(--turn)" : "var(--cream)", border: "2px solid var(--k)", padding: "0 4px" }}>{o}</div>
      ))}
    </div>
    {miniBtn("var(--ok)", "鎖定答案")}
  </MiniPhone>
);

const fillInPhone = (
  <MiniPhone>
    <div className="text-[14px]" style={{ background: "var(--cream)", border: "2px solid var(--k)", padding: "2px 4px", marginTop: 14 }}>海綿寶寶|</div>
    {miniBtn("var(--ok)", "送出")}
  </MiniPhone>
);

/** One die face as the pages draw it; `lit` marks the face that counts. */
/** The game's own d20 face (no 🎲 on the slides); `tone` marks a potion's kept and dropped die. */
const face = (n: number, tone?: "kept" | "dim") => <D20 value={n} size={64} tone={tone} />;

function Picture({ page }: { page: number }) {
  const hop = "px-hop";
  if (page === 1)
    return (
      <div className="flex items-center gap-8">
        <Sprite kind="hero" variant={0} scale={3} className={hop} />
        <div className="flex items-start gap-20">
          {mcPhone(1)}
          {fillInPhone}
        </div>
        <Sprite kind="slime" scale={3} className={hop} />
      </div>
    );
  if (page === 2)
    return (
      <div className="flex items-center gap-6 text-[18px]">
        {mcPhone(2)}
        <span className="text-[26px]">→</span>
        {miniBtn("var(--turn)", "公布答案", 130)}
        <span className="text-[26px]">→</span>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[34px]" style={{ color: "var(--ok)" }}>✓</span>
          自動判對錯
        </div>
      </div>
    );
  if (page === 3) {
    const { die, bonus, dc } = CHECK_EXAMPLE;
    return (
      <div className="flex items-center gap-10 text-[20px]">
        <div className="flex flex-col items-center gap-3">
          <div className="px-chip" style={{ fontSize: 22, padding: "6px 14px", background: "var(--warn)", color: "var(--k)", border: "4px solid var(--k)" }}>
            🗣️ 說服擲骰檢定 {dc}（+{bonus}）
          </div>
          <div className="flex items-center gap-4">
            {face(die)}
            <span className="px-num text-[18px]">{die} + {bonus} = {die + bonus} ≥ {dc}</span>
          </div>
          <span>→ 🔮 第一個字：海</span>
        </div>
        {fillInPhone}
      </div>
    );
  }
  if (page === 4)
    return (
      <div className="flex items-center gap-8 text-[18px]">
        <MiniPhone height={170}>
          {["貓", "狗", "兔", "鼠"].map((o) => (
            <div key={o} className="flex justify-between text-[14px]" style={{ background: "var(--cream)", border: "2px solid var(--k)", padding: "0 6px" }}>
              {o}<span>☰</span>
            </div>
          ))}
          {miniBtn("var(--ok)", "鎖定答案")}
        </MiniPhone>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[30px]">↕</span>
          按住 ☰ 拖曳排順序
        </div>
      </div>
    );
  if (page === 5)
    return (
      <div className="flex flex-col items-center gap-3 text-[18px]">
        <div className="flex gap-6">
          {DISH_FACES.map(([n, t], i) => (
            <div key={n} className="flex flex-col items-center gap-1">
              {face(n === "2–19" ? 12 : Number(n), i === DISH_FACES.length - 1 ? "kept" : undefined)}
              {n} {t}
            </div>
          ))}
        </div>
        <div className="px-chip" style={{ fontSize: 18, padding: "4px 12px" }}>
          {CLASS_ICONS.chef} {CLASS_LABELS.chef}：{CHEF_DISH_LINE}
        </div>
      </div>
    );
  if (page === 6)
    return (
      <div className="flex flex-col items-center gap-3 text-[20px]">
        <div className="px-chip" style={{ fontSize: 22, padding: "6px 14px", background: "var(--lav)", border: "4px solid var(--k)" }}>🧪 已喝下！</div>
        <div className="flex items-center gap-4">
          {face(6, "dim")}
          {face(17, "kept")}
          <span>→ 取高：17</span>
        </div>
      </div>
    );
  if (page === 7)
    return (
      <div className="flex flex-col items-center gap-3 text-[16px]">
        <div className="flex gap-5">
          {CLASS_SKILLS_ROW.map(([c, skill]) => (
            <div key={c} className="flex flex-col items-center gap-1">
              <Sprite kind="hero" variant={CLASS_IDS.indexOf(c)} cls={c} scale={2} className={hop} />
              <span>{CLASS_ICONS[c]} {CLASS_LABELS[c]}</span>
              <span className="text-[20px]">{skill}</span>
            </div>
          ))}
        </div>
        <div className="flex text-[18px]">
          {DICE_SCALE.map(([n, t], i) => (
            <div key={n} className="text-center" style={{ ...cell, background: i === 0 || i === 1 ? "var(--danger)" : i === DICE_SCALE.length - 1 ? "var(--warn)" : "var(--cream)", color: "var(--k)" }}>
              <span className="px-num">{n}</span> {t}
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex items-end gap-16">
      <div className="flex flex-col items-center gap-2">
        <Sprite kind="slime" scale={3} className={hop} />
        <div className="text-[22px]" style={{ color: "var(--danger)" }}>✕ 答錯</div>
        <div className="flex gap-10 text-[16px]">
          <div className="flex flex-col items-center gap-1">{miniBtn("var(--warn)", "下輪再答", 130)}先換下一隊</div>
          <div className="flex flex-col items-center gap-1">{miniBtn("var(--lav)", "逃跑", 130)}換一隻怪，換簡單題</div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 text-[16px]">
        {/* As wide as the slime (crown art 14px × 7 ≈ slime 32px × 3), centred in a gold glow that pulses like the torches (px-glow; still under reduced motion). */}
        <div className="relative">
          <div className="px-glow" style={{ width: 220, height: 220, left: "50%", top: "50%", marginLeft: -110, marginTop: -110, mixBlendMode: "normal", background: "radial-gradient(circle, #ffdd55cc 0%, #ffcf4a66 35%, #0000 70%)" }} />
          <Sprite kind="crown" scale={7} className={hop} style={{ position: "relative" }} />
        </div>
        <span>分數最高的隊伍贏</span>
      </div>
    </div>
  );
}

/** The slideshow on the 960×540 stage. Pages swap at once (D10); the sprites hop unless motion is reduced. */
export function HowToPlay({ page }: { page: number }) {
  const text = INTRO_PAGE_TEXT[page - 1];
  if (!text) return null;
  return (
    <div data-testid="how-to-play" className="absolute inset-0">
      <div className="absolute inset-x-0 text-center" style={{ top: 18, zIndex: 6 }}>
        <LabelChip>
          怎麼玩？ <span className="px-num text-[12px]">{page}/{INTRO_PAGES}</span>
        </LabelChip>
      </div>
      <Panel className="absolute flex flex-col items-center justify-center gap-2 text-center" style={{ left: 60, right: 60, top: 60, height: 320, zIndex: 5 }}>
        <TurnRibbon>{page === 1 ? "輪到：藍鯨隊" : text.topic}</TurnRibbon>
        <Picture page={page} />
        <div style={{ fontSize: 34, lineHeight: 1.25 }}>{text.big}</div>
      </Panel>
      <DialogueBox className="absolute" style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }} lines={[text.owl]} />
    </div>
  );
}
