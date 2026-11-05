// Keyboard shortcuts for the host page's judge buttons, for a host on a laptop. Pure, so the
// mapping and the "leave this key alone" rules are unit-tested; app/room/[code]/host/page.tsx
// listens for keydown and runs the matching button's own handler (with its own enabled check).

import type { SpectatorView } from "./game-state";

/** "wrong": a cleric's one 答錯 key, which waits for its choice; "pray": 祈禱 in that wait (#106). */
type HostKeyAction = "correct" | "retry" | "flee" | "next" | "wrong" | "pray";

/** The parts of a KeyboardEvent this needs, so a test can pass a plain object. */
interface KeyLike {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The focused element's tag and editability, when there is one. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

/** Where a cleric's fill-in turn stands for the host's keys (#106): "before" while a 答錯 would wait for the team
 * (one 答錯 key), "wait" while it waits (祈禱 / 重答 / 逃跑). Undefined otherwise, so the host keeps 答錯・重答 / 答錯・逃跑. */
export function clericStage(view: Pick<SpectatorView, "teams" | "pendingWrong">, teamId: string): "before" | "wait" | undefined {
  const wrong = view.pendingWrong;
  if (wrong?.teamId === teamId && wrong.optionIndex === null) return "wait";
  return view.teams.find((t) => t.id === teamId)?.mayPray ? "before" : undefined;
}

/** The digit on each judge button, per clericStage ("plain" for any other turn). The host page prints these. */
export const HOST_KEYS = {
  plain: { correct: "1", retry: "2", flee: "3" },
  before: { correct: "1", wrong: "2" },
  wait: { pray: "2", retry: "3", flee: "4" },
  /** 下一題 while the answer is on show (Enter works too). */
  next: "1",
} as const;

/** A key left to the browser: with a modifier (Ctrl+1 switches browser tabs), held down, or typed into a field. */
function ignoredKey(e: KeyLike): boolean {
  const tag = e.target?.tagName?.toUpperCase();
  return !!(e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target?.isContentEditable) || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Which button a key presses (HOST_KEYS), or null to leave the key to the browser (ignoredKey). `revealing`: the answer is
 * on show, so the only button is 下一題.
 * `mc`: a multipleChoice turn, judged by the team's lock (docs/designs/phone-answering.md D13), so 1
 * does nothing and 2 / 3 only work once the host's stuck row is showing. `cleric` (clericStage):
 * "before" makes 2 the one 答錯 and 3 nothing; "wait" makes 2 / 3 / 4 祈禱 / 重答 / 逃跑 and 1 nothing. */
export function hostKeyAction(e: KeyLike, revealing: boolean, mc?: { stuck: boolean }, cleric?: "before" | "wait"): HostKeyAction | null {
  if (ignoredKey(e)) return null;
  if (revealing) return e.key === HOST_KEYS.next || e.key === "Enter" ? "next" : null;
  if (mc && (e.key === HOST_KEYS.plain.correct || !mc.stuck)) return null;
  const keys: Partial<Record<HostKeyAction, string>> = HOST_KEYS[cleric ?? "plain"];
  return (Object.keys(keys) as HostKeyAction[]).find((a) => keys[a] === e.key) ?? null;
}

/** The how-to-play slideshow's keys (docs/designs/how-to-play.md D7): → or Enter for the next page, ← for the
 * previous one. Same "leave it alone" rules as hostKeyAction (ignoredKey). */
export function introKeyAction(e: KeyLike): "next" | "prev" | null {
  if (ignoredKey(e)) return null;
  const tag = e.target?.tagName?.toUpperCase();
  if (e.key === "ArrowRight") return "next";
  // Enter on a focused button or link is that control's own click (◀ 上一頁 must go back).
  if (e.key === "Enter") return tag === "BUTTON" || tag === "A" ? null : "next";
  if (e.key === "ArrowLeft") return "prev";
  return null;
}
