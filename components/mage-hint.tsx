/** The mage's public first-character hint on a fill-in question (class-abilities.md, issue #106). */
export function MageHint({ hint, testId, className = "px-bar !text-[19px]" }: { hint?: string; testId: string; className?: string }) {
  if (hint === undefined) return null;
  return (
    <div className={className} role="status" data-testid={testId} style={{ background: "#c9b3ff", color: "var(--k)" }}>
      🔮 第一個字：{hint}
    </div>
  );
}
