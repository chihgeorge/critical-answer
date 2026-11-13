"use client";

// The host lobby's pre-game bank check (docs/designs/bank-health-check.md D5): one button, then red rows, yellow rows and
// a count of the rest. Rows come from the room's HOST_BANK_HEALTH; this file never sees a question's answer.

import type { HealthRow, ServerMessage } from "@/lib/protocol";
import { PixelButton } from "./pixel";

export type BankHealth = Omit<Extract<ServerMessage, { type: "HOST_BANK_HEALTH" }>, "type">;

/** Red first, then yellow; `ok`: questions with no row of their own (a whole-bank row names no question). */
export function healthSummary(h: BankHealth): { rows: HealthRow[]; red: number; yellow: number; ok: number } {
  const rows = [...h.rows].sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
  const flagged = new Set(h.rows.flatMap((r) => (r.questionId ? [r.questionId] : [])));
  return { rows, red: rows.filter((r) => r.level === "red").length, yellow: rows.filter((r) => r.level === "yellow").length, ok: Math.max(0, h.questions - flagged.size) };
}

export function BankHealthPanel({ health, checking, disabled, onCheck }: { health: BankHealth | null; checking: boolean; disabled: boolean; onCheck: () => void }) {
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
          {/* Capped, so a long list never pushes 開始遊戲 off a phone's screen. */}
          {s.rows.length > 0 && (
            <ul className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
              {s.rows.map((r, i) => (
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
          )}
          <div className="text-[12px]" style={{ color: "#6a5a7a" }}>
            {health.unchecked > 0 && `Instagram 詳解 ${health.unchecked} 題沒辦法自動檢查。`}
            {!health.reloaded && "這次檢查的是房間裡原本那份題庫（沒有重新載入）。"}
            自動檢查看不出地區限制、場地網路和大螢幕的播放能力，到場請在大螢幕實際播一輪。
          </div>
        </div>
      )}
    </div>
  );
}
