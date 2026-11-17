import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

/** How one option tile looks (docs/designs/phone-answering.md D5–D9, D12, D14). */
export type OptionLook = "plain" | "sel" | "lock" | "ok" | "bad" | "dim";

export const optionLetter = (i: number) => String.fromCharCode(65 + i);

/** One A–D option tile: a letter chip, the text, and an optional right-hand label (◀ 已選, ✕ 答錯…). `badge`
 * replaces the letter (a sort question's place, 1–4). `still`: a display-only tile (the TV wall), a plain element, not a button. */
export function McOption({
  index,
  text,
  look = "plain",
  label,
  badge,
  className,
  still = false,
  ...rest
}: { index: number; text: ReactNode; look?: OptionLook; label?: ReactNode; badge?: ReactNode; still?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["px-opt", look !== "plain" && look, className].filter(Boolean).join(" ");
  const body = (
    <>
      <b>{badge ?? optionLetter(index)}</b>
      <span className="min-w-0">{text}</span>
      {label && <i>{label}</i>}
    </>
  );
  return still ? (
    <div className={cls} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {body}
    </div>
  ) : (
    <button type="button" className={cls} {...rest}>
      {body}
    </button>
  );
}
