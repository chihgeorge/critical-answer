import type { MageHintKind } from "@/lib/game-state";

/** A mage's public hint (class dice): the first character or item, or what `kind` says it is: the letter count, or the
 * whole answer or order. */
export function MageHint({ hint, kind, testId, className = "px-bar !text-[19px]", sort = false }: { hint?: string; kind?: MageHintKind; testId: string; className?: string; sort?: boolean }) {
  if (hint === undefined) return null;
  const text = kind === "count" ? `🔮 答案有 ${hint} 個字` : kind === "whole" ? (sort ? `🔮 順序：${hint}` : `🔮 答案：${hint}`) : sort ? `🔮 第 1 個：${hint}` : `🔮 第一個字：${hint}`;
  return (
    <div className={className} role="status" data-testid={testId} style={{ background: "#c9b3ff", color: "var(--k)" }}>
      {text}
    </div>
  );
}
