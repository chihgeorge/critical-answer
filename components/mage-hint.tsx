/** The mage's public first-character hint on a fill-in question (class-abilities.md, issue #106). `sort`: a sort
 * question, where the hint is its whole first item. */
export function MageHint({ hint, testId, className = "px-bar !text-[19px]", sort = false }: { hint?: string; testId: string; className?: string; sort?: boolean }) {
  if (hint === undefined) return null;
  return (
    <div className={className} role="status" data-testid={testId} style={{ background: "#c9b3ff", color: "var(--k)" }}>
      {sort ? `🔮 第 1 個：${hint}` : `🔮 第一個字：${hint}`}
    </div>
  );
}
