// Shared by the narration (Worker) and the pages, so it imports nothing.
const ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 2 -> 二, for 第二階段. */
export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? String(n);
}
