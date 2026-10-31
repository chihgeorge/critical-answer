// Keyboard shortcuts for the host page's judge buttons, for a host on a laptop. Pure, so the
// mapping and the "leave this key alone" rules are unit-tested; app/room/[code]/host/page.tsx
// listens for keydown and runs the matching button's own handler (with its own enabled check).

import type { SpectatorView } from "./game-state";

/** "wrong": a cleric's one 答錯 key, which waits for its choice; "pray": 祈禱 in that wait (#106). */
export type HostKeyAction = "correct" | "retry" | "flee" | "next" | "wrong" | "pray";

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

/** Where a cleric's fill-in turn stands for the host's keys (#106): "before" while a 答錯 would wait for the team
 * (one 答錯 key), "wait" while it waits (祈禱 / 重答 / 逃跑). Undefined otherwise, and always on a view from a Worker
 * before #106 (no mayPray), so the host keeps 答錯・重答 / 答錯・逃跑 there. */
export function clericStage(view: Pick<SpectatorView, "teams" | "pendingWrong">, teamId: string): "before" | "wait" | undefined {
  const wrong = view.pendingWrong;
  if (wrong?.teamId === teamId && wrong.optionIndex === null) return "wait";
  return view.teams.find((t) => t.id === teamId)?.mayPray ? "before" : undefined;
}

/** Which button a key presses, or null to leave the key to the browser. `revealing`: the answer is
 * on show, so the only button is 下一題. Only plain 1/2/3/4 (and Enter for 下一題), never with a
 * modifier (Ctrl+1 switches browser tabs), never held down, never while typing in a field.
 * `mc`: a multipleChoice turn, judged by the team's lock (docs/designs/phone-answering.md D13), so 1
 * does nothing and 2 / 3 only work once the host's stuck row is showing. `cleric` (clericStage):
 * "before" makes 2 the one 答錯 and 3 nothing; "wait" makes 2 / 3 / 4 祈禱 / 重答 / 逃跑 and 1 nothing. */
export function hostKeyAction(e: KeyLike, revealing: boolean, mc?: { stuck: boolean }, cleric?: "before" | "wait"): HostKeyAction | null {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  const tag = e.target?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return null;
  if (revealing) return e.key === "1" || e.key === "Enter" ? "next" : null;
  if (mc && (e.key === "1" || !mc.stuck)) return null;
  if (cleric === "wait") return e.key === "2" ? "pray" : e.key === "3" ? "retry" : e.key === "4" ? "flee" : null;
  if (cleric === "before") return e.key === "1" ? "correct" : e.key === "2" ? "wrong" : null;
  if (e.key === "1") return "correct";
  if (e.key === "2") return "retry";
  if (e.key === "3") return "flee";
  return null;
}
