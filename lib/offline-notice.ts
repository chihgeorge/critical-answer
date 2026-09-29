// What a phone tells its team after it reconnects: whether the game moved on while it was away.
// Pure, so it's unit-tested; app/room/[code]/play/page.tsx records the snapshot at the drop.

/** What the phone knew when its connection dropped. */
export interface DropSnapshot {
  /** STATE.eventId last seen before the drop. */
  eventId: number;
  /** Whether it was this team's turn at that moment. */
  wasMyTurn: boolean;
}

/**
 * The notice to show once the first STATE after reconnecting arrives, or null when nothing
 * happened meanwhile. The room skips an offline team's turn, so a judgment during the gap while it
 * was this team's turn means the turn went to someone else.
 */
export function offlineNotice(drop: DropSnapshot, nowEventId: number): string | null {
  const missed = nowEventId - drop.eventId;
  if (missed <= 0) return null;
  if (drop.wasMyTurn) return "斷線時剛好輪到你們，這一回合被跳過了。";
  return `斷線期間遊戲進行了 ${missed} 次判定。`;
}

/** Shown while the phone or the big screen is disconnected (and not resting on purpose). */
export const DISCONNECTED_NOTICE = "連線中斷，重新連線中…";
