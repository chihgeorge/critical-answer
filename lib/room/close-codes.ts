/**
 * WebSocket close codes the room uses (4000-4999 is the range an application may define).
 * The client must not reconnect on this one: the room closed the connection on purpose to stop
 * billing for a page nobody is using. The game itself is saved; a click reconnects.
 */
export const CLOSE_IDLE = 4001;
