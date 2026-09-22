/**
 * WebSocket close codes the room uses (4000-4999 is the range an application may define).
 * The client must not reconnect on this one: the room closed the connection on purpose to stop
 * billing for a page nobody is using. The game itself is saved; a click reconnects.
 */
export const CLOSE_IDLE = 4001;

/** True for the one close code every page must treat as "resting", not a network hiccup. */
export function isIdleClose(event: CloseEvent): boolean {
  return event.code === CLOSE_IDLE;
}

/** The one wording for the "resting" notice, shared so the three pages can never drift apart on it. */
export const RESTED_NOTICE = "房間休息中：太久沒有動作，連線已暫停，遊戲進度都還在。";
export const RESTED_RECONNECT_LABEL = "重新連線";
