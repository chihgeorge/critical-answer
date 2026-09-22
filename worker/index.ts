import { DurableObject } from "cloudflare:workers";
import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";
import { entryGate } from "../lib/gate";
import { originAllowed } from "../lib/origin";
import { positiveMs } from "../lib/room/positive-ms";
import { DungeonRoom } from "../lib/room/dungeon-room";
import { BankStore } from "../lib/bank-store";
import { tokensEqual } from "../lib/tokens";

export interface Env {
  /** The binding is named "main" on purpose: partysocket's default path is /parties/main/<room>. */
  main: DurableObjectNamespace<Room>;
  /** The question bank's Durable Object. Reached only through /api/bank/* below, never through
   * routePartykitRequest — see lib/gate.ts's header comment on why a new DO binding must not be
   * left reachable at /parties/<binding>/<id> without its own auth. */
  bank: DurableObjectNamespace<BankStoreDO>;
  /** Comma-separated origins allowed to open a WebSocket, see lib/origin.ts. Unset means no browser page. */
  ALLOWED_ORIGINS?: string;
  /** Milliseconds without activity before a room closes its connections (default 2 hours). */
  ROOM_IDLE_MS?: string;
  /** Milliseconds without activity before a room is forgotten and its code freed (default 24 hours). */
  ROOM_EXPIRE_MS?: string;
  /** Secret for AI narration (wrangler secret put ANTHROPIC_API_KEY). Without it the room uses scripted lines. */
  ANTHROPIC_API_KEY?: string;
  /** Secret gating the question-bank editor (wrangler secret put OWNER_KEY, >=32 random bytes). There is
   * exactly one owner, so this is a single fixed key, not a per-room trust-on-first-use token like host claims. */
  OWNER_KEY?: string;
}

/** Cloudflare adapter for the question bank: one singleton Durable Object holding it, exposed over
 * RPC (never HTTP) to this file's own fetch handler and to Room.onStart(). All storage/validation
 * logic lives in lib/bank-store.ts, which knows nothing about this platform. */
export class BankStoreDO extends DurableObject<Env> {
  private store = new BankStore({
    get: (key) => this.ctx.storage.get(key),
    put: (key, value) => this.ctx.storage.put(key, value),
  });

  getBank() {
    return this.store.getBank();
  }

  putBank(candidate: unknown) {
    return this.store.putBank(candidate);
  }
}

const BANK_DO_NAME = "singleton"; // one bank this round — see docs/designs/question-bank-editor.md NOT in scope

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
      {
        idleMs: positiveMs(this.env.ROOM_IDLE_MS),
        expireMs: positiveMs(this.env.ROOM_EXPIRE_MS),
        // Undefined (not fetched here) falls through to DungeonRoom's own bundled-bank default:
        // an existing room's restore() overrides this with its own saved bank regardless.
        bank: await fetchBank(this.env),
      },
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

/** A new room's starting bank: the live one from BankStore, or the bundled default if BankStore is
 * unreachable (redeploying, an editor bug, cold-start latency). A live game must never fail to start
 * because the question-bank editor is having a bad day — see docs/designs/question-bank-editor.md,
 * decision 7. Once a room is built it keeps its own snapshot's bank and never calls this again. */
async function fetchBank(env: Env) {
  try {
    const stub = env.bank.get(env.bank.idFromName(BANK_DO_NAME));
    return await stub.getBank();
  } catch (err) {
    console.error(JSON.stringify({ event: "bank_fetch_failed", error: String(err) }));
    return undefined; // DungeonRoom's own constructor default (the bundled BANK) takes over.
  }
}

/** CORS for /api/bank/*: the editor UI is a separate origin (the Next.js frontend), unlike the WebSocket
 * room paths above which don't need CORS at all. Reuses the same ALLOWED_ORIGINS the WS Origin check uses. */
function corsHeaders(origin: string | null, allowed: string): HeadersInit {
  if (!origin || !originAllowed(origin, allowed)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

const MAX_BANK_BODY_BYTES = 200_000; // ~4x the bundled bank's size; generous headroom, not unbounded

/** Owner-only question-bank CRUD. Deliberately its own route, not routePartykitRequest — see the Env.bank
 * doc comment and lib/gate.ts's header comment on why a new DO binding needs this. */
async function handleBankApi(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, env.ALLOWED_ORIGINS ?? "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const ownerKey = env.OWNER_KEY;
  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!ownerKey || !tokensEqual(ownerKey, presented)) {
    return new Response("Forbidden", { status: 403, headers: cors });
  }

  const stub = env.bank.get(env.bank.idFromName(BANK_DO_NAME));
  if (request.method === "GET") {
    return Response.json(await stub.getBank(), { headers: cors });
  }
  if (request.method === "PUT") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > MAX_BANK_BODY_BYTES) return new Response("Payload too large", { status: 413, headers: cors });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: cors });
    }
    try {
      return Response.json(await stub.putBank(body), { headers: cors });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "Invalid bank", { status: 400, headers: cors });
    }
  }
  return new Response("Method not allowed", { status: 405, headers: cors });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return Response.json({ ok: true });
    if (pathname === "/api/bank" || pathname.startsWith("/api/bank/")) return handleBankApi(request, env);

    const gate = (req: Request, lobby: { party: string }) => entryGate(req, lobby, env.ALLOWED_ORIGINS ?? "");
    return (await routePartykitRequest(request, env, { onBeforeConnect: gate, onBeforeRequest: gate })) ?? notFound();
  },
} satisfies ExportedHandler<Env>;
