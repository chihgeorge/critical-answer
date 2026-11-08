// A sort question's answer as one number, so it rides the multiple-choice pick and lock unchanged
// (`optionIndex`, `currentSelection`, `eliminated`): the index of a top-to-bottom order of shown item
// indices among every order of SORT_ITEMS items. Pure, safe for client components.

/** A sort question always has exactly this many items. */
export const SORT_ITEMS = 4;

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

/** Every order of SORT_ITEMS shown indices; a sort pick is an index into this list. */
export const SORT_ORDERS: readonly number[][] = permutations(SORT_ITEMS);

/** The pick for `order` (shown indices, top to bottom), or -1 when it is not an order of SORT_ITEMS items. */
export function sortCode(order: number[]): number {
  return SORT_ORDERS.findIndex((o) => o.length === order.length && o.every((v, i) => v === order[i]));
}

/** The shown indices, top to bottom, a pick stands for; undefined when out of range. */
export function sortOrderOf(code: number): number[] | undefined {
  return SORT_ORDERS[code];
}

/** Per slot, top to bottom: whether the team put the right item there. The bank keeps the items in the correct
 * order, so slot k is right when the shown item placed there is bank item k. `shownToBank[shown] = bank index` is
 * the game's option order; without one the shown order is the bank order. */
export function sortSlots(code: number, shownToBank?: number[]): boolean[] {
  const order = sortOrderOf(code);
  // Fails closed: a code that is no order marks every place wrong, never an empty (all-true) list.
  if (!order) return Array<boolean>(SORT_ITEMS).fill(false);
  return order.map((shown, k) => (shownToBank?.[shown] ?? shown) === k);
}
