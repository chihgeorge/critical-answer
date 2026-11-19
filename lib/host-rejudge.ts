// 改判's list in ⚙ 更多 › 修正 (docs/hosting.md): what each row shows, worked out from HOST_PICKS `judged`.
// Pure and client-safe: the reward math mirrors game-state hostRejudge.
import type { JudgedEntry } from "./protocol";

/** 第 n 題: each question id numbered 1, 2, 3… in the order it was last judged, so two teams on one question share n,
 * and a question retried after 下輪再答 moves up with its newest judgment (#328 m6). */
export function questionOrdinals(judged: Pick<JudgedEntry, "questionId">[]): Map<string, number> {
  const last = new Map<string, number>();
  judged.forEach((j, i) => {
    last.delete(j.questionId); // re-inserted last: a Map keeps insertion order
    last.set(j.questionId, i);
  });
  return new Map([...last.keys()].map((id, i) => [id, i + 1]));
}

/** The list's rows, newest question first, each question's rows together (newest first): the numbers only go down. */
export function rejudgeRows<T extends Pick<JudgedEntry, "questionId">>(judged: T[]): T[] {
  const n = questionOrdinals(judged);
  return judged.map((j, i) => ({ j, i })).sort((a, b) => n.get(b.j.questionId)! - n.get(a.j.questionId)! || b.i - a.i).map(({ j }) => j);
}

/** What pressing the row's button does to the team's reward now: 改成答錯 takes min(taken ?? N, reward), 改成答對 gives
 * back taken ?? N. Signed: negative for 改成答錯. */
export function rejudgeChange(j: Pick<JudgedEntry, "correct" | "points" | "taken">, reward: number): number {
  const n = j.taken ?? j.points;
  return j.correct ? -Math.min(n, reward) : n;
}

/** An 答錯 row whose team answered the same question right later: 改成答對 would pay that question twice. */
export function laterCorrect(judged: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index">[], j: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index">): boolean {
  return !j.correct && judged.some((k) => k.index > j.index && k.correct && k.teamId === j.teamId && k.questionId === j.questionId);
}

/** The newest row of STATE's undoWrong team and question, a 答錯: its 改成答對 runs that full 改判答對 (the room decides,
 * dungeon-room rejudgeIsUndo); this only picks the label. */
export function undoRow(judged: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index">[], j: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index">, undo: { teamId: string; questionId: string } | undefined): boolean {
  return !j.correct && undo?.teamId === j.teamId && undo.questionId === j.questionId && !judged.some((k) => k.index > j.index && k.teamId === j.teamId && k.questionId === j.questionId);
}

/** The row's button: 改成答錯（−N）, 改成答對（+N）, or on undoRow the full 改判答對 (fields: a music question judged
 * field by field again). */
export function rejudgeButton(judged: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index">[], j: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index" | "points" | "taken" | "reads">, reward: number, undo: { teamId: string; questionId: string; fields: boolean } | undefined): string {
  const change = rejudgeChange(j, reward);
  if (j.correct) return `改成答錯（−${-change}）`;
  if (undoRow(judged, j, undo)) return `改成答對（${undo!.fields ? "重新逐欄判定" : "照答對往前走"}）`;
  // A chef's or armed thief's first 改成答對 is paid from an answer die rolled then (game-state rejudgeNeedsDie).
  if (j.reads && j.taken === undefined) return "改成答對（擲答對骰）";
  return `改成答對（+${change}）`;
}
