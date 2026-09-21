import type * as Party from "partykit/server";
import { DungeonRoom } from "../lib/room/dungeon-room";

/**
 * PartyKit adapter for the game room. Temporary: E2E and the LAN playtest still run on PartyKit until
 * the toolchain moves to `wrangler dev` (plan task T3), which deletes this file with the partykit package.
 * All game logic lives in lib/room/dungeon-room.ts; the Cloudflare adapter is worker/index.ts.
 */
export default class PartyKitRoom implements Party.Server {
  private inner: DungeonRoom;

  constructor(readonly room: Party.Room) {
    this.inner = new DungeonRoom({
      broadcast: (message) => room.broadcast(message),
      env: room.env as { ANTHROPIC_API_KEY?: string },
    });
  }

  onConnect(conn: Party.Connection) {
    this.inner.onConnect(conn);
  }

  onMessage(message: string, sender: Party.Connection) {
    this.inner.onMessage(message, sender);
  }

  onClose(conn: Party.Connection) {
    this.inner.onClose(conn);
  }
}
