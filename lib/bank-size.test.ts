import { describe, expect, it } from "vitest";
import { bankSize, bankSizeWarning, bankSizeWarningText } from "./bank-size";
import { BANK } from "./question-bank-data";

describe("bankSizeWarning", () => {
  const size = { pools: [12, 16, 12, 12, 12], rooms: [1, 2, 2, 3, 4, 4, 5, 5] as const };

  it("stays quiet when every room pool covers the teams, whatever the total", () => {
    expect(bankSizeWarning({ ...size, rooms: [...size.rooms] }, 7)).toBeNull();
    expect(bankSizeWarning({ ...size, rooms: [...size.rooms] }, 0)).toBeNull();
    // 64 questions for 8 teams: below teams x 9, which no longer warns (only a thin room pool does).
    expect(bankSizeWarning({ ...size, rooms: [...size.rooms] }, 8)).toBeNull();
  });

  it("stays quiet at the exact boundary: a room pool of exactly as many questions as teams", () => {
    expect(bankSizeWarning({ pools: [4, 32, 0, 0, 0], rooms: [1, 2] }, 4)).toBeNull();
    expect(bankSizeWarning({ pools: [3, 0, 0, 0, 0], rooms: [1] }, 4)?.thin).toEqual([{ difficulty: 1, count: 3 }]);
  });

  it("lists each room difficulty with fewer questions than teams, once, and ignores pools no room uses", () => {
    const w = bankSizeWarning({ pools: [1, 40, 3, 40, 40], rooms: [3, 2, 3] }, 4);
    expect(w).toEqual({ thin: [{ difficulty: 3, count: 3 }], total: 124 });
    expect(bankSizeWarningText(w!, 4)).toBe("題目可能不夠：難度 3 只有 3 題（4 隊）。同一場可能重複出題，或改出別的難度的題。");
  });

  it("says two teams may share a question when the whole bank is smaller than the team count", () => {
    const w = bankSizeWarning({ pools: [4, 0, 0, 0, 0], rooms: [1] }, 8)!;
    expect(bankSizeWarningText(w, 8)).toBe("題目可能不夠：難度 1 只有 4 題（8 隊）。同一場可能重複出題，甚至兩隊同時拿到同一題。");
  });

  it("reads the counts off a bank", () => {
    const s = bankSize(BANK);
    expect(s.pools).toEqual([1, 2, 3, 4, 5].map((d) => BANK.pools[d as 1].length));
    expect(s.rooms).toEqual(BANK.rooms.map((r) => r.difficulty));
  });
});
