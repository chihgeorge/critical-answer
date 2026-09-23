/**
 * What the game room needs from whatever carries its messages (Cloudflare, PartyKit, a test).
 * Kept this small on purpose: the room logic imports no platform types.
 */
export interface Conn {
  readonly id: string;
  send(message: string): void;
  close(): void;
}

/** Durable key-value storage for one room. `put` is not awaited: see DungeonRoom.persist. */
export interface RoomStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): void | Promise<void>;
  /** Wake the room at this time (ms since epoch), replacing any earlier alarm. */
  setAlarm?(at: number): void | Promise<void>;
  deleteAlarm?(): void | Promise<void>;
  /** Forget everything this room saved. */
  deleteAll?(): void | Promise<void>;
}

export interface RoomIO {
  /** Send to every open connection. */
  broadcast(message: string): void;
  /** Server-only settings (secrets and env vars). Never sent to a browser.
   * `R2_PUBLIC_BASE_URL` is not a secret — it's the public read base for the image bucket
   * (e.g. an r2.dev URL), needed to turn a stored image key into a renderable URL. */
  env?: { ANTHROPIC_API_KEY?: string; R2_PUBLIC_BASE_URL?: string };
  /** Where the room saves itself. Without it (tests, the temporary PartyKit adapter) the room lives in memory only. */
  storage?: RoomStorage;
  /** Close every open connection with an application close code (see close-codes.ts). */
  closeAll?(code: number, reason: string): void;
}
