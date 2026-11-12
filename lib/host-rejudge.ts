// 改判's list in ⚙ 更多 › 修正 (docs/hosting.md): what each row shows, worked out from HOST_PICKS `judged`.
// Pure and client-safe: the reward math mirrors game-state hostRejudge.
import type { JudgedEntry } from "./protocol";

/** 第 n 題: each question id numbered 1, 2, 3… in the order it was first judged, so two teams on one question share n. */
export function questionOrdinals(judged: Pick<JudgedEntry, "questionId">[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const j of judged) if (!n.has(j.questionId)) n.set(j.questionId, n.size + 1);
  return n;
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
export function rejudgeButton(judged: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index">[], j: Pick<JudgedEntry, "teamId" | "questionId" | "correct" | "index" | "points" | "taken">, reward: number, undo: { teamId: string; questionId: string; fields: boolean } | undefined): string {
  const change = rejudgeChange(j, reward);
  if (j.correct) return `改成答錯（−${-change}）`;
  if (undoRow(judged, j, undo)) return `改成答對（${undo!.fields ? "重新逐欄判定" : "照答對往前走"}）`;
  return `改成答對（+${change}）`;
}
