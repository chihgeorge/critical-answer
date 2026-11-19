"use client";

// The how-to-play slideshow (docs/designs/how-to-play.md D4–D11): INTRO_PAGES pages on the big screen, turned by the host.
// Pages 3–5 teach the classes, the persuasion check and the crit die (#367).
import type { ReactNode } from "react";
import { DialogueBox, LabelChip, Panel, Sprite, TurnRibbon } from "@/components/pixel";
import { CHECK_BONUS, CHECK_DC, CLASS_ICONS, CLASS_IDS, CLASS_LABELS } from "@/lib/game-state";
import { INTRO_PAGES, scoreName } from "@/lib/protocol";

/** Per page: the topic the host and phone show, the big text, the owl's line and the host's script (D4, D7). */
export const INTRO_PAGE_TEXT: { topic: string; big: string; owl: string; script: string }[] = [
  {
    topic: "輪流上陣",
    big: "各隊輪流上陣，輪到誰，怪物就找誰",
    owl: "冒險者們，先聽我說規則……主持人會唸題目。",
    script: "每一隊輪流出場。輪到哪一隊，大螢幕上方會寫，怪物就找那一隊。",
  },
  {
    topic: "用手機作答",
    big: "選擇題＝攻擊擲暴擊；一般房填空題＝說服先擲檢定",
    owl: "選擇題點了要鎖定，填空題打字送出。擲骰的事，接下來三頁說給你聽。",
    script: "選擇題點選後按「鎖定答案」；填空題打字送出，由我來判對錯。擲骰怎麼玩，接下來三頁說明。",
  },
  {
    topic: "職業",
    big: "每隊選一個職業，各有一招技能",
    owl: "法師給提示、牧師答錯再來、盜賊偷襲加碼、廚師加分、戰士擲骰代答。",
    script: "大廳時用手機選職業。法師施法給提示，牧師答錯可以祈禱再答，盜賊先偷襲、答對加碼，廚師答對自動加分，戰士可以擲骰代替答題。用技能都要擲骰，點數越高越好。",
  },
  {
    topic: "說服擲骰檢定",
    big: "一般房填空題先擲骰，達到擲骰檢定就送第一個字",
    owl: "擲到 20 直接說服成功，免答！擲到 1，答對只拿一半。",
    script: "填空題要先按手機上的「🎲 擲骰說服」：擲 d20，加上職業加值，達到怪物頭上的擲骰檢定，就送答案第一個字。擲到 20 怪物直接讓路，免答算答對；擲到 1，這題答對只拿一半。首領房不用擲說服骰。",
  },
  {
    topic: "暴擊骰",
    big: "選擇題答對擲暴擊骰，20 是大成功，多拿一半",
    owl: "答對了就擲暴擊骰，祈禱擲到 20 吧！",
    script: "選擇題和排序題答對，大螢幕先說明要擲暴擊骰，再擲一顆 d20；骰子停下後才公布結果：擲到 20 是大成功，這題多拿一半分數；其他點數照常拿分。主持人可以在大廳關掉暴擊骰。",
  },
  {
    topic: "答錯怎麼辦",
    big: "答錯可以下輪再答，或逃跑換一隻怪、換簡單一點的題",
    owl: "答錯別慌！可以下輪再答，或逃跑換一隻怪物。",
    script: "答錯了可以選下輪再答：先換下一隊，下一輪再答同一題；或逃跑換一隻怪物，換一題簡單一點的。",
  },
  {
    topic: "怎麼贏",
    big: "打倒首領會結束冒險，但分數最高的隊伍才是冠軍",
    owl: "準備好了嗎？主持人再按一次 ▶，冒險開始！",
    script: "打倒首領冒險就結束，但最後看分數，最高的隊伍才是冠軍。",
  },
];

/** 「第 n／7 頁：<topic>」, the phone's live status line (eng D7). */
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

function Picture({ page, cuisine }: { page: number; cuisine: boolean }) {
  const hop = "px-hop";
  if (page === 1)
    return (
      <div className="flex flex-col items-center gap-3">
        {/* The order is rolled after the intro (擲先攻), so no team is named yet. */}
        <TurnRibbon>▼ 輪到：擲先攻第一名</TurnRibbon>
        <div className="flex items-end gap-24">
          <Sprite kind="hero" variant={0} scale={4} className={hop} />
          <Sprite kind="slime" scale={4} className={hop} />
        </div>
      </div>
    );
  if (page === 2)
    return (
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
    );
  if (page === 3)
    return (
      <div className="flex items-end gap-6">
        {CLASS_IDS.map((c, i) => (
          <div key={c} className="flex flex-col items-center gap-1 text-[18px]">
            <Sprite kind="hero" variant={i} cls={c} scale={3} className={hop} />
            <span>{CLASS_ICONS[c]} {CLASS_LABELS[c]}</span>
          </div>
        ))}
      </div>
    );
  if (page === 4) {
    const [die, bonus, dc] = [10, CHECK_BONUS.thief, CHECK_DC[2]];
    return (
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
    );
  }
  if (page === 5)
    return (
      <div className="flex gap-6 text-[18px]">
        {[["1", "還是打中了"], ["2–19", "答對！"], ["20", "大成功・多拿一半"]].map(([n, t], i) => (
          <div key={n} className="flex flex-col items-center gap-1">
            <div className="px-num text-[20px]" style={{ background: i === 2 ? "var(--turn)" : "var(--cream)", border: "3px solid var(--k)", padding: "6px 12px" }}>🎲 {n}</div>
            {t}
          </div>
        ))}
      </div>
    );
  if (page === 6)
    return (
      <div className="flex flex-col items-center gap-2">
        <Sprite kind="slime" scale={4} className={hop} />
        <div className="text-[22px]" style={{ color: "var(--danger)" }}>✕ 答錯</div>
        <div className="flex gap-10 text-[16px]">
          <div className="flex flex-col items-center gap-1">{miniBtn("var(--warn)", "下輪再答", 130)}先換下一隊</div>
          <div className="flex flex-col items-center gap-1">{miniBtn("var(--lav)", "逃跑", 130)}換一隻怪，換簡單題</div>
        </div>
      </div>
    );
  return (
    <div className="flex items-end gap-12 text-[18px]">
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <Sprite kind="slime" scale={3} className={hop} />
          {cuisine && <span className="text-[34px]" aria-hidden>→ 🍲</span>}
        </div>
        <span>
          答對：<span className="px-num text-[14px]" style={{ color: "var(--ok2)" }}>+20</span> {scoreName(cuisine)}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Sprite kind="door" scale={3} />
        <span>首領房</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Sprite kind="crown" scale={4} className={hop} />
        <span>分數最高的隊伍贏</span>
      </div>
    </div>
  );
}

/** The slideshow on the 960×540 stage. Pages swap at once (D10); the sprites hop unless motion is reduced. */
export function HowToPlay({ page, cuisine }: { page: number; cuisine: boolean }) {
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
        <Picture page={page} cuisine={cuisine} />
        <div style={{ fontSize: 34, lineHeight: 1.25 }}>{text.big}</div>
      </Panel>
      <DialogueBox className="absolute" style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }} lines={[text.owl]} />
    </div>
  );
}
