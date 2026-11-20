// Test-only helper for the room tests: send one message, then roll a correct answer's dish die (the host's 🎲 擲料理骰
// under its reveal) and let it land at once, as if its 2 s beat had passed (class-dice-rework.md). Most room tests judge
// an answer right and look at the scored state; the tests about the dish die's own beat call room.onMessage directly.
import { CHECK_GRACE_MS, type DungeonRoom } from "./dungeon-room";
import type { AnswerReveal, PendingRoll } from "../protocol";
import { checkKey, type GameState } from "../game-state";

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

/** Lands the persuasion check the room rolled by itself (autoCheck) at once, as if its beat had passed. A room with no
 * fixed die gets a plain failed check (2: no hint, no 20, no 1), so a test that is not about the check sees its question
 * as before the check rolled itself; a test about the check sets room.fixedDie before the question comes up, or
 * room.holdCheck to watch the beat. */
export function settleCheck(room: DungeonRoom): void {
  const r = room as unknown as { pendingRoll: PendingRoll | null; fixedDie?: number; game: GameState; resolveRoll(): void; unpace(k: string): void; broadcastState(): void; keepUndoOpen(g: GameState): void; checkGraceTimer: ReturnType<typeof setTimeout> | null; undo: { at: number } | null };
  // holdCheck: a test about the check's own beat lands it with its timers.
  if ((room as unknown as { holdCheck?: boolean }).holdCheck) return;
  // A 答錯's CHECK_GRACE_MS passes at once too: the room refuses a judge for the next team until its check rolls.
  if (r.checkGraceTimer) {
    clearTimeout(r.checkGraceTimer);
    r.checkGraceTimer = null;
    if (r.undo) r.undo.at -= CHECK_GRACE_MS;
    r.broadcastState();
  }
  const roll = r.pendingRoll;
  if (roll?.kind !== "check") return;
  if (r.fixedDie !== undefined) return r.resolveRoll();
  // Silent: no 說服失敗 line or cue, which a test about something else does not expect in its narration.
  const key = checkKey(roll.questionId, roll.teamId);
  const { bonus, dc } = r.game.checks![key];
  r.keepUndoOpen({ ...r.game, checks: { ...r.game.checks, [key]: { value: 2, bonus, dc, passed: false } } });
  r.pendingRoll = null;
  r.unpace("lock");
  r.broadcastState();
}

export function sendSettled(room: DungeonRoom, conn: Conn, msg: object): void {
  // First a check a timer's STATE rolled since (a door or card beat ending), then one this message rolls.
  settleCheck(room);
  room.onMessage(JSON.stringify(msg), conn);
  settleCheck(room);
  settleDish(room);
}
