import { describe, it, expect } from "vitest";
import { SORT_ORDERS, sortCode, sortOrderOf, sortSlots } from "./sort-order";

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
  });
});
