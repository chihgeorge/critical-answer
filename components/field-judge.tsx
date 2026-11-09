"use client";

import { useState } from "react";
import { PixelButton } from "@/components/pixel";

/** A music question with fields (docs/designs/multi-field.md F5): ✓ or ✗ on every field, then 送出判定. Any ✓ is a hit
 * scaled by the share right; all ✗ is a wrong buzz. Mount it per buzz, so a new buzz starts unmarked. */
export function FieldJudge({ labels, typed, disabled, onJudge }: { labels: string[]; typed?: string[]; disabled: boolean; onJudge: (fields: boolean[]) => void }) {
  const [marks, setMarks] = useState<(boolean | undefined)[]>(() => labels.map(() => undefined));
  const done = marks.every((m) => m !== undefined);
  const right = marks.filter(Boolean).length;
  const mark = (i: number, v: boolean) => setMarks((m) => m.map((x, j) => (j === i ? v : x)));
  return (
    <div data-testid="host-field-judge" className="flex flex-col gap-1">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1 text-[16px]" style={{ background: "var(--cream2)" }}>
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {label}
            {typed?.[i] && <span className="text-[14px]">：{typed[i]}</span>}
          </div>
          <PixelButton variant="ok" className="!m-0 !min-h-[44px] !px-3 text-[16px]" aria-pressed={marks[i] === true} aria-label={`${label} 答對`} style={marks[i] === true ? undefined : { opacity: 0.5 }} onClick={() => mark(i, true)}>
            ✓
          </PixelButton>
          <PixelButton variant="retry" className="!m-0 !min-h-[44px] !px-3 text-[16px]" aria-pressed={marks[i] === false} aria-label={`${label} 答錯`} style={marks[i] === false ? undefined : { opacity: 0.5 }} onClick={() => mark(i, false)}>
            ✗
          </PixelButton>
        </div>
      ))}
      <PixelButton variant={right > 0 ? "ok" : "retry"} disabled={disabled || !done} onClick={() => onJudge(marks.map(Boolean))}>
        {!done ? "每一欄都標完再送出" : right === labels.length ? "送出判定：全對" : right === 0 ? "送出判定：全錯（這題不能再搶）" : `送出判定：對 ${right}/${labels.length}`}
      </PixelButton>
    </div>
  );
}
