"use client";

import { useState } from "react";
import type { HostPick } from "@/lib/protocol";
import { Panel, PixelButton } from "@/components/pixel";

/** The host picks a target's next question (HOST_QUEUE_QUESTION). The list only ever reaches the host page. */
export function QuestionPicker({
  title,
  note,
  questions,
  current,
  teamName,
  onPick,
  onClose,
}: {
  title: string;
  note: string;
  questions: HostPick[];
  /** The target's queued pick, if any: shown as chosen, not as blocked. */
  current: string | undefined;
  teamName: (id: string) => string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = q ? questions.filter((x) => x.label.includes(q) || x.answer.includes(q)) : questions;
  const why = (b: NonNullable<HostPick["block"]>) =>
    b.kind === "revealed" ? "已公布" : b.kind === "held" ? (b.teamId === "boss" ? "王房正在用" : `${teamName(b.teamId)}正在答`) : `已排給${b.teamId === "boss" ? "王房" : teamName(b.teamId)}`;
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <Panel tone="lav" className="max-h-[85vh] w-full overflow-y-auto p-4">
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[19px]">{title}</span>
            <PixelButton onClick={onClose} className="!m-0 !px-4 !py-1 text-[16px]">
              關閉
            </PixelButton>
          </div>
          <div className="text-[13px]">{note}</div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋題目或答案" className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
          {shown.length === 0 && <div className="text-[14px]">沒有符合的題目</div>}
          {shown.map((x) => {
            const mine = x.id === current;
            const blocked = x.block && !mine;
            return (
              <button
                key={x.id}
                type="button"
                disabled={!!blocked}
                onClick={() => onPick(x.id)}
                // Blocked rows use DESIGN.md's faded-tile tokens, with the reason in full ink so it stays readable.
                className={`flex w-full items-start gap-2 border-[3px] p-2 text-left ${blocked ? "border-[var(--dim-line)] bg-[var(--cream2)] text-[var(--dim-ink)]" : "border-[var(--k)] bg-[var(--cream)]"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">{x.label}</span>
                  <span className="block text-[12px]" style={blocked ? undefined : { color: "#2f6a2c" }}>答案：{x.answer}</span>
                </span>
                {(blocked || mine) && <span className="flex-none text-[13px]" style={{ color: mine ? "#2f6a2c" : "var(--ink)" }}>{mine ? "目前選的" : why(x.block!)}</span>}
              </button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
