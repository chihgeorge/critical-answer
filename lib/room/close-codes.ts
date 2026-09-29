/**
 * WebSocket close codes the room uses (4000-4999 is the range an application may define).
 * The client must not reconnect on this one: the room closed the connection on purpose to stop
 * billing for a page nobody is using. The game itself is saved; a click reconnects.
 */
export const CLOSE_IDLE = 4001;
/** Like CLOSE_IDLE (don't reconnect by yourself), but the room was idle long enough to be forgotten:
 * its game is gone, and reconnecting lands in a brand-new empty lobby. */
export const CLOSE_EXPIRED = 4002;

/** Why the room closed this connection on purpose, or null for anything else (a network hiccup,
 * which the page just reconnects from). Every page stops reconnecting on either kind. */
export type RestKind = "idle" | "expired";
export function restKindOf(event: CloseEvent): RestKind | null {
  return event.code === CLOSE_IDLE ? "idle" : event.code === CLOSE_EXPIRED ? "expired" : null;
}

/** The one wording for each notice, shared so the three pages can never drift apart on it. */
export const RESTED_NOTICE = "房間休息中：太久沒有動作，連線已暫停，遊戲進度都還在。";
export const EXPIRED_NOTICE = "房間已過期：太久沒有動作，上一場遊戲已經清除。重新連線會開一個新的空房間。";
export function restNoticeFor(kind: RestKind): string {
  return kind === "expired" ? EXPIRED_NOTICE : RESTED_NOTICE;
}
export const RESTED_RECONNECT_LABEL = "重新連線";
