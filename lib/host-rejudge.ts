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
