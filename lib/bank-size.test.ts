import { describe, expect, it } from "vitest";
import { bankSize, bankSizeWarning, bankSizeWarningText } from "./bank-size";
import { BANK } from "./question-bank-data";

describe("bankSizeWarning", () => {
  const size = { pools: [12, 16, 12, 12, 12], rooms: [1, 2, 2, 3, 4, 4, 5, 5] as const };

  it("stays quiet when every room pool covers the teams and the total covers teams x 9", () => {
    expect(bankSizeWarning({ ...size, rooms: [...size.rooms] }, 7)).toBeNull();
    expect(bankSizeWarning({ ...size, rooms: [...size.rooms] }, 0)).toBeNull();
  });

  it("warns on the total alone once it is below teams x 9", () => {
    expect(bankSizeWarning({ ...size, rooms: [...size.rooms] }, 8)).toEqual({ thin: [], total: 64, needed: 72 });
  });

  it("lists each room difficulty with fewer questions than teams, once, and ignores pools no room uses", () => {
    const w = bankSizeWarning({ pools: [1, 40, 3, 40, 40], rooms: [3, 2, 3] }, 4);
    expect(w).toEqual({ thin: [{ difficulty: 3, count: 3 }], total: 124, needed: 36 });
    expect(bankSizeWarningText(w!, 4)).toBe("題目可能不夠：難度 3 只有 3 題（4 隊）。同一場可能重複出題，甚至兩隊同時拿到同一題。");
  });

  it("says both reasons when both hold", () => {
    const w = bankSizeWarning({ pools: [4, 0, 0, 0, 0], rooms: [1] }, 8)!;
    expect(bankSizeWarningText(w, 8)).toBe("題目可能不夠：難度 1 只有 4 題，房間題共 4 題，少於建議的 72 題（8 隊）。同一場可能重複出題，甚至兩隊同時拿到同一題。");
  });

  it("reads the counts off a bank", () => {
    const s = bankSize(BANK);
    expect(s.pools).toEqual([1, 2, 3, 4, 5].map((d) => BANK.pools[d as 1].length));
    expect(s.rooms).toEqual(BANK.rooms.map((r) => r.difficulty));
  });
});
