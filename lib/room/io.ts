/**
 * What the game room needs from whatever carries its messages (Cloudflare, PartyKit, a test).
 * Kept this small on purpose: the room logic imports no platform types.
 */
export interface Conn {
  readonly id: string;
  send(message: string): void;
  close(): void;
}

export interface RoomIO {
  /** Send to every open connection. */
  broadcast(message: string): void;
  /** Server-only settings (secrets). Never sent to a browser. */
  env?: { ANTHROPIC_API_KEY?: string };
}
