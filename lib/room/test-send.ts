// Test-only helper for the room tests: send one message, then roll a correct answer's dish die (the host's 🎲 擲料理骰
// under its reveal) and let it land at once, as if its 2 s beat had passed (class-dice-rework.md). Most room tests judge
// an answer right and look at the scored state; the tests about the dish die's own beat call room.onMessage directly.
import type { DungeonRoom } from "./dungeon-room";
import type { AnswerReveal, PendingRoll } from "../protocol";

type Conn = Parameters<DungeonRoom["onMessage"]>[1];

/** Lands a dish die that is in its beat (not a 改成答對's, which pays a ledger entry). A room with no fixed die shows a
 * plain 10 (no multiplier): the tests' `() => 0` rng would roll a 1, burning every dish. */
export function settleDish(room: DungeonRoom): void {
  const r = room as unknown as { pendingRoll: PendingRoll | null; fixedDie?: number; reveal: AnswerReveal | null; resolveRoll(): void; rollDishNext(): void };
  // The answer's reveal comes first; the host's 🎲 擲料理骰 rolls the die.
  if (r.reveal?.dishNext && !r.pendingRoll) r.rollDishNext();
  if (r.pendingRoll?.kind !== "dish" || r.pendingRoll.rejudge) return;
  if (r.fixedDie === undefined && !r.pendingRoll.values) r.pendingRoll = { ...r.pendingRoll, value: 10 };
  r.resolveRoll();
}

export function sendSettled(room: DungeonRoom, conn: Conn, msg: object): void {
  room.onMessage(JSON.stringify(msg), conn);
  settleDish(room);
}
