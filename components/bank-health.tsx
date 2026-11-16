"use client";

// The host lobby's pre-game bank check (docs/designs/bank-health-check.md D5): one button, then red rows, yellow rows and
// a count of the rest. Rows come from the room's HOST_BANK_HEALTH; this file never sees a question's answer. Below it,
// the big screen's test load of every clip (docs/designs/screen-media-test.md), rows from HOST_SCREEN_TEST.

import type { HealthRow, ServerMessage } from "@/lib/protocol";
import { PixelButton } from "./pixel";

export type BankHealth = Omit<Extract<ServerMessage, { type: "HOST_BANK_HEALTH" }>, "type">;
export type ScreenTest = Omit<Extract<ServerMessage, { type: "HOST_SCREEN_TEST" }>, "type">;

const redFirst = (rows: HealthRow[]) => [...rows].sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));

/** Red first, then yellow; `ok`: questions with no row of their own (a whole-bank row names no question). */
export function healthSummary(h: BankHealth): { rows: HealthRow[]; red: number; yellow: number; ok: number } {
  const rows = redFirst(h.rows);
  const flagged = new Set(h.rows.flatMap((r) => (r.questionId ? [r.questionId] : [])));
  return { rows, red: rows.filter((r) => r.level === "red").length, yellow: rows.filter((r) => r.level === "yellow").length, ok: Math.max(0, h.questions - flagged.size) };
}

/** The one line above the screen test's rows. */
export function screenTestLine(t: ScreenTest): string {
  const red = t.rows.filter((r) => r.level === "red").length;
  const yellow = t.rows.length - red;
  if (t.total === 0) return "📺 題庫裡沒有影片或聲音";
  if (t.stopped) return `📺 大螢幕斷線，試播停在 ${t.done}／${t.total}`;
  if (t.done < t.total) return `📺 大螢幕試播中… ${t.done}／${t.total}`;
  return t.rows.length === 0 ? `✅ ${t.total} 支都載得出來` : `📺 ${t.total} 支試播完：🔴 ${red} 放不出來 · 🟡 ${yellow} 太久沒載入`;
}

function Rows({ rows }: { rows: HealthRow[] }) {
  // Capped, so a long list never pushes 開始遊戲 off a phone's screen.
  return (
    <ul className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
      {rows.map((r, i) => (
        <li
          key={i}
          className="border-4 border-[var(--k)] bg-white px-2 py-1 text-[14px] leading-snug"
          style={{ borderLeft: `12px solid var(${r.level === "red" ? "--danger" : "--warn"})` }}
        >
          <span className="mr-1 border-2 border-[var(--k)] px-1 font-bold" style={{ background: `var(${r.level === "red" ? "--danger" : "--warn"})` }}>
            {r.level === "red" ? "紅" : "黃"}
          </span>
          {r.problem}
          <div className="text-[12px]" style={{ color: "#6a5a7a" }}>
            {[r.where, r.questionId && `#${r.questionId}`, r.label].filter(Boolean).join(" · ")}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BankHealthPanel({
  health,
  checking,
  disabled,
  onCheck,
  screenTest,
  onScreenTest,
}: {
  health: BankHealth | null;
  checking: boolean;
  disabled: boolean;
  onCheck: () => void;
  screenTest: ScreenTest | null;
  onScreenTest: () => void;
}) {
  const s = health && healthSummary(health);
  return (
    <div data-testid="host-bank-health" className="flex flex-col gap-2">
      <PixelButton className="!m-0 min-h-[48px] text-[18px]" disabled={checking || disabled} onClick={onCheck}>
        {checking ? "檢查中…" : "🩺 檢查題庫"}
      </PixelButton>
      {health && s && (
        <div role="status" className="flex flex-col gap-2">
          <div className="text-[16px] font-bold">
            {s.rows.length === 0 ? `✅ ${s.ok} 題自動檢查沒發現問題` : `🔴 ${s.red} 會壞 · 🟡 ${s.yellow} 要看 · ✅ ${s.ok} 題沒發現問題`}
          </div>
          {s.rows.length > 0 && <Rows rows={s.rows} />}
          <div className="text-[12px]" style={{ color: "#6a5a7a" }}>
            {health.unchecked > 0 && `Instagram 詳解 ${health.unchecked} 題沒辦法自動檢查。`}
            {!health.reloaded && "這次檢查的是房間裡原本那份題庫（沒有重新載入）。"}
            自動檢查看不出地區限制、場地網路和大螢幕的播放能力，到場請按「📺 大螢幕試播影音」。
          </div>
        </div>
      )}
      {/* A second press starts over: the way out of a screen that got stuck. */}
      <PixelButton data-testid="host-screen-test" className="!m-0 min-h-[48px] text-[18px]" disabled={disabled} onClick={onScreenTest}>
        {screenTest ? "📺 重新試播" : "📺 大螢幕試播影音"}
      </PixelButton>
      {screenTest ? (
        <div role="status" data-testid="host-screen-test-result" className="flex flex-col gap-2">
          <div className="text-[16px] font-bold">{screenTestLine(screenTest)}</div>
          {screenTest.rows.length > 0 && <Rows rows={redFirst(screenTest.rows)} />}
          <div className="text-[12px]" style={{ color: "#6a5a7a" }}>試播的是這台大螢幕、這個網路。換場地或換電腦請再按一次。</div>
        </div>
      ) : (
        <div className="text-[12px]" style={{ color: "#6a5a7a" }}>帶金鑰的大螢幕會靜音、看不到畫面地把每支影片和聲音載入一次。</div>
      )}
    </div>
  );
}
