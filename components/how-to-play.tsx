"use client";

// The how-to-play slideshow (docs/designs/how-to-play.md D4–D11): INTRO_PAGES pages on the big screen, turned by the host.
// Page 2 teaches the persuasion check and the dish die, page 3 when each class rolls; their dice text is in how-to-play-dice.ts.
import type { ReactNode } from "react";
import { DialogueBox, LabelChip, Panel, Sprite, TurnRibbon } from "@/components/pixel";
import { CHECK_EXAMPLE, DISH_FACES, DICE_PAGES, DICE_ROWS, DICE_TABLE_HEAD } from "@/components/how-to-play-dice";
import { CLASS_ICONS, CLASS_IDS, CLASS_LABELS } from "@/lib/game-state";
import { INTRO_PAGES } from "@/lib/protocol";

/** Per page: the topic the host and phone show, the big text, the owl's line and the host's script (D4, D7). */
export const INTRO_PAGE_TEXT: { topic: string; big: string; owl: string; script: string }[] = [
  {
    topic: "輪流上陣・用手機作答",
    big: "各隊輪流上陣，輪到的隊伍用手機作答",
    owl: "輪到誰，怪物就找誰。選擇題點了要鎖定，填空題打字送出。",
    script: "每一隊輪流出場，輪到哪一隊大螢幕上方會寫。選擇題點選後按「鎖定答案」；一般房填空題先擲說服檢定，再打字送出，由我來判對錯。",
  },
  ...DICE_PAGES,
  {
    topic: "答錯與怎麼贏",
    big: "答錯可以下輪再答或逃跑；分數最高的隊伍是冠軍",
    owl: "答錯別慌！準備好了嗎？主持人再按一次 ▶，冒險開始！",
    script: "答錯可以下輪再答（先換下一隊），或逃跑換一隻怪物，換一題簡單一點的。打倒首領冒險就結束，但最後看分數，最高的隊伍才是冠軍。",
  },
];

/** 「第 n／4 頁：<topic>」, the phone's live status line (eng D7). */
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
function MiniPhone({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col justify-between" style={{ width: 150, height: 120, background: "#3a2a44", border: "4px solid #000", borderRadius: 10, padding: 8 }}>
      {children}
    </div>
  );
}

const cell = { border: "2px solid var(--k)", padding: "1px 8px", background: "var(--cream)" } as const;

function Picture({ page }: { page: number }) {
  const hop = "px-hop";
  if (page === 1)
    return (
      <div className="flex flex-col items-center gap-3">
        {/* The order is rolled after the intro (擲先攻), so no team is named yet. */}
        <TurnRibbon>▼ 輪到：擲先攻第一名</TurnRibbon>
        <div className="flex items-center gap-8">
          <Sprite kind="hero" variant={0} scale={3} className={hop} />
          <div className="flex items-start gap-20">
            <MiniPhone>
              <div className="grid grid-cols-2 gap-1 text-[14px]">
                {["A 火", "B 水", "C 風", "D 土"].map((o, i) => (
                  <div key={o} style={{ background: i === 1 ? "var(--turn)" : "var(--cream)", border: "2px solid var(--k)", padding: "0 4px" }}>{o}</div>
                ))}
              </div>
              {miniBtn("var(--ok)", "鎖定答案")}
            </MiniPhone>
            <MiniPhone>
              <div className="text-[14px]" style={{ background: "var(--cream)", border: "2px solid var(--k)", padding: "2px 4px", marginTop: 14 }}>海綿寶寶|</div>
              {miniBtn("var(--ok)", "送出")}
            </MiniPhone>
          </div>
          <Sprite kind="slime" scale={3} className={hop} />
        </div>
      </div>
    );
  if (page === 2) {
    const { die, bonus, dc } = CHECK_EXAMPLE;
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-col items-center gap-3 text-[20px]">
          <div className="px-chip" style={{ fontSize: 22, padding: "6px 14px", background: "var(--warn)", color: "var(--k)", border: "4px solid var(--k)" }}>
            🗣️ 說服擲骰檢定 {dc}（+{bonus}）
          </div>
          <div className="flex items-center gap-4">
            <Sprite kind="dice" scale={2} className={hop} />
            <span className="px-num text-[18px]">{die} + {bonus} = {die + bonus} ≥ {dc}</span>
            <span>→ 🔮 第一個字：海</span>
          </div>
        </div>
        <div className="flex gap-6 text-[18px]">
          {DISH_FACES.map(([n, t], i) => (
            <div key={n} className="flex flex-col items-center gap-1">
              <div className="px-num text-[20px]" style={{ background: i === DISH_FACES.length - 1 ? "var(--turn)" : "var(--cream)", border: "3px solid var(--k)", padding: "6px 12px" }}>🎲 {n}</div>
              {t}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (page === 3)
    return (
      <div className="grid text-left text-[16px]" style={{ gridTemplateColumns: "auto auto auto", gap: 2 }}>
        {DICE_TABLE_HEAD.map((h) => (
          <div key={h} style={{ ...cell, background: "var(--turn)" }}>{h}</div>
        ))}
        {DICE_ROWS.map(([c, when, ok]) => (
          <div key={c} className="contents">
            <div className="flex items-center gap-1" style={cell}>
              <Sprite kind="hero" variant={CLASS_IDS.indexOf(c)} cls={c} scale={1} />
              {CLASS_ICONS[c]} {CLASS_LABELS[c]}
            </div>
            <div style={cell}>{when}</div>
            <div style={cell}>{ok}</div>
          </div>
        ))}
      </div>
    );
  return (
    <div className="flex items-end gap-16">
      <div className="flex flex-col items-center gap-2">
        <Sprite kind="slime" scale={4} className={hop} />
        <div className="text-[22px]" style={{ color: "var(--danger)" }}>✕ 答錯</div>
        <div className="flex gap-10 text-[16px]">
          <div className="flex flex-col items-center gap-1">{miniBtn("var(--warn)", "下輪再答", 130)}先換下一隊</div>
          <div className="flex flex-col items-center gap-1">{miniBtn("var(--lav)", "逃跑", 130)}換一隻怪，換簡單題</div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 text-[16px]">
        <Sprite kind="crown" scale={4} className={hop} />
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
      <Panel className="absolute flex flex-col items-center justify-center gap-4 text-center" style={{ left: 60, right: 60, top: 60, height: 300, zIndex: 5 }}>
        <Picture page={page} />
        <div style={{ fontSize: 34, lineHeight: 1.25 }}>{text.big}</div>
      </Panel>
      <DialogueBox className="absolute" style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }} lines={[text.owl]} />
    </div>
  );
}
