import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";
import { entryGate } from "../lib/gate";
import { DungeonRoom } from "../lib/room/dungeon-room";

export interface Env {
  /** The binding is named "main" on purpose: partysocket's default path is /parties/main/<room>. */
  main: DurableObjectNamespace<Room>;
  /** Comma-separated origins allowed to open a WebSocket, see lib/origin.ts. Unset means no browser page. */
  ALLOWED_ORIGINS?: string;
  /** Milliseconds without activity before a room closes its connections (default 2 hours). */
  ROOM_IDLE_MS?: string;
  /** Milliseconds without activity before a room is forgotten and its code freed (default 24 hours). */
  ROOM_EXPIRE_MS?: string;
  /** Secret for AI narration (wrangler secret put ANTHROPIC_API_KEY). Without it the room uses scripted lines. */
  ANTHROPIC_API_KEY?: string;
}

/**
 * Cloudflare adapter for the game room: one Durable Object per room code. All game logic lives in
 * lib/room/dungeon-room.ts, which knows nothing about this platform.
 */
export class Room extends Server<Env> {
  // The room keeps its connections in memory, so it must not hibernate.
  static options = { hibernate: false };

  private game!: DungeonRoom;

  /** Runs once each time the object starts, before any connection is served: read the saved room back. */
  async onStart() {
    const ms = (v: string | undefined) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
    this.game = new DungeonRoom(
      {
        broadcast: (message) => this.broadcast(message),
        env: this.env,
        // The room saves without awaiting; Cloudflare holds its messages until the write is durable.
        storage: {
          get: (key) => this.ctx.storage.get(key),
          put: (key, value) => this.ctx.storage.put(key, value),
          setAlarm: (at) => this.ctx.storage.setAlarm(at),
          deleteAlarm: () => this.ctx.storage.deleteAlarm(),
          deleteAll: () => this.ctx.storage.deleteAll(),
        },
        closeAll: (code, reason) => {
          for (const conn of this.getConnections()) conn.close(code, reason);
        },
      },
      undefined,
      { idleMs: ms(this.env.ROOM_IDLE_MS), expireMs: ms(this.env.ROOM_EXPIRE_MS) },
    );
    await this.game.restore();
  }

  onAlarm() {
    return this.game.onAlarm();
  }

  onConnect(conn: Connection) {
    this.game.onConnect(conn);
  }

  onMessage(conn: Connection, message: WSMessage) {
    // The protocol is JSON text; a binary frame is not a message we understand.
    if (typeof message === "string") this.game.onMessage(message, conn);
  }

  onClose(conn: Connection) {
    this.game.onClose(conn);
  }
}

const notFound = () => new Response("Not found", { status: 404 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/healthz") return Response.json({ ok: true });

    const gate = (req: Request, lobby: { party: string }) => entryGate(req, lobby, env.ALLOWED_ORIGINS ?? "");
    return (await routePartykitRequest(request, env, { onBeforeConnect: gate, onBeforeRequest: gate })) ?? notFound();
  },
} satisfies ExportedHandler<Env>;
