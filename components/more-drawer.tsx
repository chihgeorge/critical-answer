"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getHostToken } from "@/lib/room-code";
import type { ClientMessage } from "@/lib/protocol";
import { BOSS_THRESHOLD } from "@/lib/turn-info";
import { Panel, PixelButton } from "@/components/pixel";
import { Qr } from "@/components/qr";

/** The host's own link carries the token, so it is shown here and never on /screen or /play. */
export function MoreDrawer({
  origin,
  code,
  onClose,
  send,
  lines,
  aiOn,
  ai,
  bossable,
  nextLine,
  playing,
}: {
  /** The page's origin ("" before hydration). */
  origin: string;
  code: string;
  onClose: () => void;
  send: (msg: ClientMessage) => void;
  /** The current narration's segments (1-3). The edit box below only ever rewrites the first
   * one, so hosts need to know there may be more they can't reach. */
  lines: string[];
  aiOn: boolean;
  /** The AI key and limit settings, mid-game (in the lobby they sit on the page itself). */
  ai: ReactNode;
  /** Teams in play and not yet in the boss room: the host may send one there (scoring-and-score-pools.md S13). */
  bossable: { id: string; name: string }[];
  /** The line queued for the next narration ("" for none), or null until the room says it supports one (host-next-line.md D5). */
  nextLine: string | null;
  /** A game is under way, so 結束冒險 can end it. */
  playing: boolean;
}) {
  const currentLine = lines[0] ?? "";
  const totalSegments = lines.length;
  const [notes, setNotes] = useState("");
  const [line, setLine] = useState(currentLine);
  // A new narration line while the drawer is open replaces the draft, so 送出 never puts an old line back.
  const [seenLine, setSeenLine] = useState(currentLine);
  if (currentLine !== seenLine) {
    setSeenLine(currentLine);
    setLine(currentLine);
  }
  const [nextDraft, setNextDraft] = useState("");
  // Cleared once the room confirms a queued line, so an ERROR (game over, only punctuation) keeps what was typed.
  const [seenNextLine, setSeenNextLine] = useState(nextLine);
  if (nextLine !== seenNextLine) {
    setSeenNextLine(nextLine);
    if (nextLine) setNextDraft("");
  }
  // 送王房 cannot be undone, so the first tap only arms it for 3 s.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const token = getHostToken(code);
  const hostUrl = token ? `${origin}/room/${code}/host#k=${token}` : "";
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <Panel tone="lav" className="max-h-[85vh] w-full overflow-y-auto p-4">
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[20px]">更多</span>
            <PixelButton onClick={onClose} className="!m-0 !px-4 !py-1 text-[16px]">
              關閉
            </PixelButton>
          </div>
          {bossable.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="text-[15px]">{`送隊伍進王房（不用等到 ${BOSS_THRESHOLD} 分，送了不能退回）`}</div>
              {bossable.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[16px]">{t.name}</span>
                  <PixelButton
                    onClick={() => {
                      if (armed !== t.id) return setArmed(t.id);
                      setArmed(null);
                      send({ type: "HOST_SEND_TO_BOSS", teamId: t.id });
                    }}
                    className="!m-0 min-h-[44px] !px-3 !py-1 text-[15px]"
                  >
                    {armed === t.id ? "確定送？" : "送王房"}
                  </PixelButton>
                </div>
              ))}
            </section>
          )}
          {playing && (
            <section className="flex flex-col gap-2">
              <div className="text-[15px]">時間到了？現在就結束，照目前的分數排名，大螢幕出頒獎台和後記。</div>
              <PixelButton
                onClick={() => {
                  // Ending cannot be undone, so the first tap only arms it for 3 s, like 送王房.
                  if (armed !== "end") return setArmed("end");
                  setArmed(null);
                  send({ type: "HOST_END_GAME" });
                  onClose();
                }}
                className="!m-0 min-h-[44px] !px-4 !py-2 text-[16px]"
              >
                {armed === "end" ? "確定結束？" : "結束冒險"}
              </PixelButton>
            </section>
          )}
          {ai && <section>{ai}</section>}
          <section className="flex flex-col gap-2">
            <div className="text-[15px]">導演筆記{aiOn ? "（AI 每次寫旁白都會參考）" : "（AI 旁白已關閉，只會記錄）"}</div>
            <div className="text-[13px]">只影響語氣與風格，不是逐字台詞。想改已經出現的那一句，用下面的「改寫目前旁白」。</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} placeholder="例如：用武俠口吻，紅隊是一群恐龍" className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
            <PixelButton onClick={() => send({ type: "HOST_SET_NOTES", notes })} className="!m-0 !px-4 !py-2 text-[16px]">
              儲存導演筆記
            </PixelButton>
          </section>
          {nextLine !== null && (
            <section className="flex flex-col gap-2">
              <div className="text-[15px]">下一句這樣說（最多 40 字）</div>
              <div className="text-[13px]">下一次旁白的第二句會說出這句（AI 可能在前後加幾個字），說完就清掉。</div>
              {nextLine && (
                <div className="flex items-center gap-2 border-4 border-dashed border-[var(--k)] bg-[var(--turn)] p-2 text-[15px]">
                  <span className="flex-1 break-all">已排入：{nextLine}</span>
                  <PixelButton onClick={() => send({ type: "HOST_NEXT_LINE", line: "" })} className="!m-0 min-h-[44px] !px-3 !py-1 text-[15px]">
                    取消
                  </PixelButton>
                </div>
              )}
              <input value={nextDraft} onChange={(e) => setNextDraft(e.target.value)} maxLength={40} placeholder={nextLine ? "再排一句會蓋掉上面這句" : "例如：不怕死的冒險者不知道珍珠是什麼意思？"} className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
              <PixelButton
                onClick={() => send({ type: "HOST_NEXT_LINE", line: nextDraft })}
                disabled={!nextDraft.trim()}
                className="!m-0 !px-4 !py-2 text-[16px]"
              >
                排進下一句
              </PixelButton>
            </section>
          )}
          <section className="flex flex-col gap-2">
            <div className="text-[15px]">改寫第一句旁白{totalSegments > 1 ? `（共 ${totalSegments} 句，只能改第一句，最多 40 字）` : "（最多 40 字）"}</div>
            <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={40} disabled={!currentLine} className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
            <PixelButton onClick={() => send({ type: "HOST_EDIT_NARRATION", line })} disabled={!currentLine || !line.trim()} className="!m-0 !px-4 !py-2 text-[16px]">
              送出，立刻換上大螢幕
            </PixelButton>
          </section>
          <section>
            <PixelButton onClick={() => send({ type: "HOST_GET_TRANSCRIPT" })} className="!m-0 !px-4 !py-2 text-[16px]">
              下載旁白紀錄（JSON）
            </PixelButton>
            <div className="mt-3 text-[13px]">每一句旁白的事件、分數、來源與延遲。伺服器重啟後會消失。</div>
          </section>
          {hostUrl && (
            <section className="flex items-center gap-3">
              <Qr text={hostUrl} size={120} alt="主持人 QR" />
              <div className="text-[14px]">
                <div className="text-[15px]">用另一台裝置主持</div>
                <div>這個連結擁有主持權，不要給玩家。</div>
              </div>
            </section>
          )}
        </div>
      </Panel>
    </div>
  );
}
