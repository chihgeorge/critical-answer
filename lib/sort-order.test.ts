import { describe, it, expect } from "vitest";
import { initialSortOrder, sortAnswer, SORT_ORDERS, sortCode, sortOrderOf, sortSlots } from "./sort-order";

// Value: protects=a sort order and its one-number pick round-trip, and per-place marks follow the game's shown order;
// fails_when=two orders share a code, a code decodes to another order, or marks compare shown instead of bank indices;
// seam=none; no_claim=the room's use of it (dungeon-room.test.ts)
describe("sort-order", () => {
  it("numbers every order of four items once, and back", () => {
    expect(SORT_ORDERS).toHaveLength(24);
    for (let c = 0; c < 24; c++) expect(sortCode(sortOrderOf(c)!)).toBe(c);
    expect(sortCode([0, 0, 1, 2])).toBe(-1);
    expect(sortOrderOf(24)).toBeUndefined();
  });

  it("marks each place right when the bank item there belongs there", () => {
    // shown D C B A over bank A B C D: shown index 3 is bank A.
    const reversed = [3, 2, 1, 0];
    expect(sortSlots(sortCode([3, 2, 1, 0]), reversed)).toEqual([true, true, true, true]);
    expect(sortSlots(sortCode([3, 2, 0, 1]), reversed)).toEqual([true, true, false, false]);
    expect(sortSlots(sortCode([0, 1, 2, 3]))).toEqual([true, true, true, true]);
    // Fails closed: a code that is no order is never all right.
    expect(sortSlots(24)).toEqual([false, false, false, false]);
    expect(sortSlots(-1)).toEqual([false, false, false, false]);
  });
});

describe("public sort answers", () => {
  const items = ["D", "B", "A", "C"];
  it("starts letter items at ABCD while preserving public indices", () => {
    expect(initialSortOrder(items)).toEqual([2, 1, 3, 0]);
    expect(sortAnswer(items, sortCode(initialSortOrder(items)))).toBe("A → B → C → D");
    expect(initialSortOrder(["魚", "肉", "菜", "蛋"])).toEqual([0, 1, 2, 3]);
  });
  it("keeps a saved attempt and displays exactly its submitted order", () => {
    const code = sortCode([1, 0, 3, 2]);
    expect(initialSortOrder(items, code)).toEqual([1, 0, 3, 2]);
    expect(sortAnswer(items, code)).toBe("B → D → C → A");
    expect(sortAnswer(items, -1)).toBe("");
  });
});
