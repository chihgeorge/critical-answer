import { DurableObject } from "cloudflare:workers";
import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";
import { entryGate } from "../lib/gate";
import { positiveMs } from "../lib/room/positive-ms";
import { DungeonRoom } from "../lib/room/dungeon-room";
import { BankStore, BankConflictError, type VersionedBank } from "../lib/bank-store";
import { bankOrFallback, handleBankApi, type BankConflict } from "../lib/bank-api";

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
  private store: BankStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BankStore({
      get: (key) => ctx.storage.get(key),
      put: (key, value) => ctx.storage.put(key, value),
    });
    // Seed-on-first-read otherwise races: two requests arriving before storage has ever been
    // written could both see it empty and both write the seed. Both writes are identical today
    // (same bundled JSON), so it's harmless as written, but blockConcurrencyWhile is the platform's
    // own documented fix and forces the seed to happen once, before any request is handled
    // (adversarial review, 2026-09-22).
    ctx.blockConcurrencyWhile(async () => {
      await this.store.getVersionedBank();
    });
  }

  getBank() {
    return this.store.getBank();
  }

  getVersionedBank(): Promise<VersionedBank> {
    return this.store.getVersionedBank();
  }

  /** Catches BankConflictError itself — same JS realm as where it's thrown, where `instanceof`
   * is reliable — and returns a plain discriminated result instead of letting the error cross the
   * RPC boundary to lib/bank-api.ts, where its class identity would not survive. */
  async putBank(candidate: unknown, expectedVersion: number): Promise<VersionedBank | BankConflict> {
    try {
      return await this.store.putBank(candidate, expectedVersion);
    } catch (err) {
      if (err instanceof BankConflictError) return { conflict: true, currentVersion: err.currentVersion };
      throw err;
    }
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
        // Undefined (bankOrFallback swallowed a fetch failure) falls through to DungeonRoom's own
        // bundled-bank default: an existing room's restore() overrides this with its own saved bank
        // regardless. See docs/designs/question-bank-editor.md, decision 7.
        bank: await bankOrFallback(() => this.env.bank.get(this.env.bank.idFromName(BANK_DO_NAME)).getBank()),
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return Response.json({ ok: true });
    if (pathname === "/api/bank" || pathname.startsWith("/api/bank/")) {
      const stub = env.bank.get(env.bank.idFromName(BANK_DO_NAME));
      return handleBankApi(request, {
        ownerKey: env.OWNER_KEY,
        allowedOrigins: env.ALLOWED_ORIGINS ?? "",
        getVersionedBank: () => stub.getVersionedBank(),
        putBank: (candidate, expectedVersion) => stub.putBank(candidate, expectedVersion),
      });
    }

    const gate = (req: Request, lobby: { party: string }) => entryGate(req, lobby, env.ALLOWED_ORIGINS ?? "");
    return (await routePartykitRequest(request, env, { onBeforeConnect: gate, onBeforeRequest: gate })) ?? notFound();
  },
} satisfies ExportedHandler<Env>;
