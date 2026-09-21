import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";
import { entryGate } from "../lib/gate";

export interface Env {
  /** The binding is named "main" on purpose: partysocket's default path is /parties/main/<room>. */
  main: DurableObjectNamespace<Room>;
  /** Comma-separated origins allowed to open a WebSocket, see lib/origin.ts. Unset means no browser page. */
  ALLOWED_ORIGINS?: string;
}

/**
 * Spike room (plan task T1): proves routing, the SQLite-backed Durable Object migration, sockets and the
 * entry rules on a real deploy. It is replaced by the real game room in T2.
 */
export class Room extends Server<Env> {
  // The room keeps connections in memory, so it must not hibernate.
  static options = { hibernate: false };

  async onConnect(conn: Connection) {
    // Storage that survives a restart of the object: what the migration and persistence rely on.
    const visits = ((await this.ctx.storage.get<number>("visits")) ?? 0) + 1;
    this.ctx.storage.put("visits", visits);
    conn.send(JSON.stringify({ type: "HELLO", room: this.name, visits }));
  }

  onMessage(_conn: Connection, message: WSMessage) {
    if (typeof message === "string") this.broadcast(JSON.stringify({ type: "ECHO", text: message.slice(0, 200) }));
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
