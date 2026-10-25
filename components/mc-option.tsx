import type { ButtonHTMLAttributes, ReactNode } from "react";

/** How one option tile looks (docs/designs/phone-answering.md D5–D9, D12, D14). */
export type OptionLook = "plain" | "sel" | "lock" | "ok" | "bad" | "dim";

export const optionLetter = (i: number) => String.fromCharCode(65 + i);

/** One A–D option tile: a letter chip, the text, and an optional right-hand label (◀ 已選, ✕ 答錯…). */
export function McOption({
  index,
  text,
  look = "plain",
  label,
  className,
  ...rest
}: { index: number; text: ReactNode; look?: OptionLook; label?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={["px-opt", look !== "plain" && look, className].filter(Boolean).join(" ")} {...rest}>
      <b>{optionLetter(index)}</b>
      <span className="min-w-0">{text}</span>
      {label && <i>{label}</i>}
    </button>
  );
}
