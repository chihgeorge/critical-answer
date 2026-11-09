// Is a bank big enough for this many teams? Counts only, never question content, so the host page
// can get these numbers in LOBBY and the bank editor can run it on the bank it holds
// (no-repeat research 2026-11-09, strategy 1). Never import the parsed BANK here (CLAUDE.md).

import type { Difficulty } from "./game-state";
import type { Bank } from "./question-bank";

/** `pools[d - 1]`: how many questions difficulty d has. `rooms`: each room's difficulty. */
export interface BankSize {
  pools: number[];
  rooms: Difficulty[];
}

export const bankSize = (bank: Bank): BankSize => ({
  pools: ([1, 2, 3, 4, 5] as const).map((d) => bank.pools[d].length),
  rooms: bank.rooms.map((r) => r.difficulty),
});

export interface BankSizeWarning {
  /** Room difficulties with fewer questions than teams: two teams can get the same question at once. */
  thin: { difficulty: Difficulty; count: number }[];
  /** Every pool together: below the team count, two teams can hold one question at once. */
  total: number;
}

/** null when the bank is big enough for `teams` teams. */
export function bankSizeWarning(size: BankSize, teams: number): BankSizeWarning | null {
  if (teams <= 0) return null;
  const thin = [...new Set(size.rooms)].sort((a, b) => a - b).flatMap((d) => (size.pools[d - 1] < teams ? [{ difficulty: d, count: size.pools[d - 1] }] : []));
  // Every pool, not just the rooms' own: a flee deals from a lower pool and an emptied pool borrows (game-state.ts poolIndexFor).
  const total = size.pools.reduce((a, b) => a + b, 0);
  return thin.length > 0 ? { thin, total } : null;
}

export function bankSizeWarningText(w: BankSizeWarning, teams: number): string {
  const parts = w.thin.map((t) => `難度 ${t.difficulty} 只有 ${t.count} 題`);
  // deal() borrows from another pool before two teams share a question; only a bank smaller than the team count shares.
  const worst = w.total < teams ? "，甚至兩隊同時拿到同一題" : "，或改出別的難度的題";
  return `題目可能不夠：${parts.join("，")}（${teams} 隊）。同一場可能重複出題${worst}。`;
}
