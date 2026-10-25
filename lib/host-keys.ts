// Keyboard shortcuts for the host page's judge buttons, for a host on a laptop. Pure, so the
// mapping and the "leave this key alone" rules are unit-tested; app/room/[code]/host/page.tsx
// listens for keydown and runs the matching button's own handler (with its own enabled check).

export type HostKeyAction = "correct" | "retry" | "flee" | "next";

/** The parts of a KeyboardEvent this needs, so a test can pass a plain object. */
export interface KeyLike {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The focused element's tag and editability, when there is one. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

/** Which button a key presses, or null to leave the key to the browser. `revealing`: the answer is
 * on show, so the only button is 下一題. Only plain 1/2/3 (and Enter for 下一題), never with a
 * modifier (Ctrl+1 switches browser tabs), never held down, never while typing in a field.
 * `mc`: a multipleChoice turn, judged by the team's lock (docs/designs/phone-answering.md D13), so 1
 * does nothing and 2 / 3 only work once the host's stuck row is showing. */
export function hostKeyAction(e: KeyLike, revealing: boolean, mc?: { stuck: boolean }): HostKeyAction | null {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  const tag = e.target?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return null;
  if (revealing) return e.key === "1" || e.key === "Enter" ? "next" : null;
  if (mc && (e.key === "1" || !mc.stuck)) return null;
  if (e.key === "1") return "correct";
  if (e.key === "2") return "retry";
  if (e.key === "3") return "flee";
  return null;
}
