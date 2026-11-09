import { DurableObject } from "cloudflare:workers";
import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";
import { entryGate } from "../lib/gate";
import { positiveMs } from "../lib/room/positive-ms";
import { RateLimiter } from "../lib/room/rate-limit";
import { DungeonRoom, EXPIRE_MS, fixedDie } from "../lib/room/dungeon-room";
import { BankStore, IMAGE_CLEANUP_MARGIN_MS, type BankConflict, type VersionedBank } from "../lib/bank-store";
import { bankOrFallback, handleBankApi, handleGameLogsApi } from "../lib/bank-api";
import { appendGameLog, readGameLogs, type GameLog } from "../lib/game-log";
import { handleBankImageApi } from "../lib/bank-image-api";
import { handleClientError } from "../lib/client-error-api";

export interface Env {
  /** The binding is named "main" on purpose: partysocket's default path is /parties/main/<room>. */
  main: DurableObjectNamespace<Room>;
  /** The question bank's Durable Object. Reached only through /api/bank/* below, never through
   * routePartykitRequest — see lib/gate.ts's header comment on why a new DO binding must not be
   * left reachable at /parties/<binding>/<id> without its own auth. */
  bank: DurableObjectNamespace<BankStoreDO>;
  /** Question-bank image storage (docs/designs/image-question-type.md). Public read access is
   * configured on the bucket itself (its r2.dev subdomain), a one-time manual Cloudflare dashboard
   * step, not something this Worker's deploy performs. */
  images: R2Bucket;
  /** The bucket's public read base URL (e.g. an r2.dev URL), prepended to a stored image key to
   * build a renderable URL — never baked into stored bank data, same env-not-data split as
   * PARTY_HOST (lib/party-host.ts). Not a secret. */
  R2_PUBLIC_BASE_URL?: string;
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
  /** e2e only (playwright.config.ts): every d20 lands on this value, so a test knows the roll. Never set in production. */
  E2E_DIE?: string;
  /** e2e only (playwright.config.ts): the team with this exact name always walks into an event room; no other team does. Never set in production. */
  E2E_EVENT_TEAM?: string;
  /** e2e only (playwright.config.ts): "left" or "right", the door that always hides ⚔️ at a fork. Never set in production. */
  E2E_MONSTER_SIDE?: string;
  /** How long the 擲先攻 order holds before the first question, in ms (e2e shortens it). */
  INITIATIVE_HOLD_MS?: string;
}

/** Cloudflare adapter for the question bank: one singleton Durable Object holding it, exposed over
 * RPC (never HTTP) to this file's own fetch handler and to Room.onStart(). All storage/validation
 * logic lives in lib/bank-store.ts, which knows nothing about this platform. */
export class BankStoreDO extends DurableObject<Env> {
  private store: BankStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new BankStore(
      ctx.storage,
      // R2 access lives only here (this class), never in lib/bank-store.ts — same
      // platform-abstraction discipline as the rest of this file's DO/RPC split. BankStore calls
      // this from runImageCleanup() (this DO's alarm, below), which catches and logs a failed delete.
      (keys) => env.images.delete(keys),
      // An orphaned image waits until every room that could have copied the old bank has expired.
      // Same expiry the rooms use (Room.onStart below, and DungeonRoom's own max(expire, idle)), so
      // changing ROOM_EXPIRE_MS moves both. A room kept busy for longer than this (activity keeps
      // pushing its expiry back) can still lose an image it copied — rare enough to accept.
      {
        cleanupDelayMs:
          Math.max(positiveMs(env.ROOM_EXPIRE_MS) ?? EXPIRE_MS, positiveMs(env.ROOM_IDLE_MS) ?? 0) + IMAGE_CLEANUP_MARGIN_MS,
      },
    );
    // Seed-on-first-read otherwise races: two requests arriving before storage has ever been
    // written could both see it empty and both write the seed. Both writes are identical today
    // (same bundled JSON), so it's harmless as written, but blockConcurrencyWhile is the platform's
    // own documented fix and forces the seed to happen once, before any request is handled
    // (adversarial review, 2026-09-22).
    ctx.blockConcurrencyWhile(async () => {
      await this.store.getVersionedBank();
    });
  }

  /** Deletes queued orphaned images whose wait is over (see BankStore.runImageCleanup). */
  async alarm() {
    await this.store.runImageCleanup();
  }

  /** Called right after an upload lands in R2: see BankStore.queueUploadedImage. */
  imageUploaded(key: string): Promise<void> {
    return this.store.queueUploadedImage(key);
  }

  getVersionedBank(): Promise<VersionedBank> {
    return this.store.getVersionedBank();
  }

  putBank(candidate: unknown, expectedVersion: number): Promise<VersionedBank | BankConflict> {
    return this.store.putBank(candidate, expectedVersion);
  }

  /** Finished games' records (lib/game-log.ts) live next to the bank: one owner, one place to read them. */
  appendGameLog(log: GameLog): Promise<void> {
    return appendGameLog(this.ctx.storage, log);
  }

  gameLogs(): Promise<GameLog[]> {
    return readGameLogs(this.ctx.storage);
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
  /**
   * Open sockets, by object. partyserver's own list is keyed by the client's connection id (partysocket's _pk, the
   * same on every reconnect) and an old socket's late close deletes that id, so after a Wi-Fi blip the reconnected
   * TV or phone would silently stop getting broadcasts and escape the idle close. Broadcast and closeAll use this.
   */
  private sockets = new Set<Connection>();
  /** Per-socket message budget: a flood from one socket is dropped before the room parses it. */
  private limiter = new RateLimiter();

  /** Open sockets only; a socket that errored without a close event is dropped here. */
  private *openSockets() {
    for (const conn of this.sockets) {
      if (conn.readyState === WebSocket.READY_STATE_OPEN) yield conn;
      else this.sockets.delete(conn);
    }
  }

  /** Runs once each time the object starts, before any connection is served: read the saved room back. */
  async onStart() {
    this.game = new DungeonRoom(
      {
        broadcast: (message) => {
          for (const conn of this.openSockets()) {
            try {
              conn.send(message);
            } catch {
              conn.close(1011, "Unexpected error"); // as partyserver's own broadcast does
            }
          }
        },
        env: this.env,
        // The room saves without awaiting; Cloudflare holds its messages until the write is durable.
        storage: this.ctx.storage,
        logGame: (log) => this.env.bank.getByName(BANK_DO_NAME).appendGameLog(log),
        closeAll: (code, reason) => {
          for (const conn of [...this.openSockets()]) conn.close(code, reason);
        },
      },
      undefined,
      {
        idleMs: positiveMs(this.env.ROOM_IDLE_MS),
        expireMs: positiveMs(this.env.ROOM_EXPIRE_MS),
        fixedDie: fixedDie(this.env.E2E_DIE),
        e2eEventTeam: this.env.E2E_EVENT_TEAM || undefined,
        e2eMonsterSide: this.env.E2E_MONSTER_SIDE === "left" || this.env.E2E_MONSTER_SIDE === "right" ? this.env.E2E_MONSTER_SIDE : undefined,
        initiativeHoldMs: positiveMs(this.env.INITIATIVE_HOLD_MS),
        // Undefined (bankOrFallback swallowed a fetch failure) falls through to DungeonRoom's own
        // bundled-bank default: an existing room's restore() overrides this with its own saved bank
        // regardless. See docs/designs/question-bank-editor.md, decision 7.
        // gstack-shortcut(dec-f5965fd8): fetched on every wake even when restore() then uses the
        // snapshot's bank, because reset() reuses this one; upgrade when wake latency or BankStore
        // availability matters: a lazy loadBank for the no-snapshot, discarded and reset paths (TODOS.md).
        bank: await bankOrFallback(async () => (await this.env.bank.getByName(BANK_DO_NAME).getVersionedBank()).bank),
      },
    );
    await this.game.restore();
  }

  onAlarm() {
    return this.game.onAlarm();
  }

  onConnect(conn: Connection) {
    this.sockets.add(conn);
    this.game.onConnect(conn);
  }

  onMessage(conn: Connection, message: WSMessage) {
    // The protocol is JSON text; a binary frame is not a message we understand.
    if (typeof message === "string" && this.limiter.allow(conn)) this.game.onMessage(message, conn);
  }

  onClose(conn: Connection) {
    this.sockets.delete(conn);
    this.game.onClose(conn);
  }

  /** A socket that errors may never get a close event: without this it would keep its slot and its team online.
   * Closed too, so the phone or TV sees it and reconnects instead of sitting there cut off. */
  onError(conn: Connection) {
    try {
      conn.close(1011, "Unexpected error");
    } catch {
      // already closing
    }
    this.onClose(conn);
  }
}

const notFound = () => new Response("Not found", { status: 404 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return Response.json({ ok: true });
    if (pathname === "/api/client-error") return handleClientError(request, env.ALLOWED_ORIGINS ?? "");
    // /api/bank/image is dispatched to its own handler BEFORE the /api/bank/* prefix check below
    // would otherwise swallow it — handleBankApi only branches on HTTP method, not path, so a
    // request here must never fall through to it (docs/designs/image-question-type.md's
    // "Routing" decision, caught by outside-voice review against this exact code).
    if (pathname === "/api/bank/image") {
      return handleBankImageApi(request, {
        ownerKey: env.OWNER_KEY,
        allowedOrigins: env.ALLOWED_ORIGINS ?? "",
        putImage: async (bytes, contentType) => {
          const key = crypto.randomUUID();
          // Object keys are server-generated UUIDs — content at a given key never changes, so a
          // long-lived immutable cache is safe. Every viewer (every phone on /play, the shared
          // /screen) re-fetches the same image, so this matters for real: without it there's no
          // caching directive at all.
          await env.images.put(key, bytes, { httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" } });
          // Queue it for deletion unless a save puts it in the bank first, so an upload the editor
          // never saves doesn't stay in R2 forever. Best-effort: the upload itself already worked,
          // and a failure here only means this one image might leak, as every upload did before.
          try {
            await env.bank.getByName(BANK_DO_NAME).imageUploaded(key);
          } catch (err) {
            console.error(JSON.stringify({ event: "image_upload_queue_failed", key, error: String(err) }));
          }
          return { key };
        },
        bankUnreadable: async () => !!(await env.bank.getByName(BANK_DO_NAME).getVersionedBank()).unreadable,
      });
    }
    if (pathname === "/api/game-logs") {
      return handleGameLogsApi(request, {
        ownerKey: env.OWNER_KEY,
        allowedOrigins: env.ALLOWED_ORIGINS ?? "",
        readLogs: () => env.bank.getByName(BANK_DO_NAME).gameLogs(),
      });
    }
    if (pathname === "/api/bank" || pathname.startsWith("/api/bank/")) {
      const stub = env.bank.getByName(BANK_DO_NAME);
      return handleBankApi(request, {
        ownerKey: env.OWNER_KEY,
        allowedOrigins: env.ALLOWED_ORIGINS ?? "",
        getVersionedBank: () => stub.getVersionedBank(),
        putBank: (candidate, expectedVersion) => stub.putBank(candidate, expectedVersion),
      });
    }

    const gate = (req: Request, lobby: { className: string; name: string }) => entryGate(req, lobby, env.ALLOWED_ORIGINS ?? "");
    return (await routePartykitRequest(request, env, { onBeforeConnect: gate, onBeforeRequest: gate })) ?? notFound();
  },
} satisfies ExportedHandler<Env>;
