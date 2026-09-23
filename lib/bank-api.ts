// Pure, testable HTTP handling for the question-bank API. Platform-agnostic on purpose, same split
// as dungeon-room.ts/bank-store.ts — worker/index.ts wires this to the real BankStoreDO RPC stub and
// env secrets, but none of the logic here knows Cloudflare exists.

import { tokensEqual } from "./tokens";
import { originAllowed } from "./origin";
import type { VersionedBank } from "./bank-store";
import type { Bank } from "./question-bank";

/** A version conflict, returned rather than thrown. A thrown `BankConflictError` loses its class
 * identity crossing the Durable Object RPC boundary — `instanceof` on the caller side fails even
 * though `.message` survives (verified live against a real wrangler dev instance) — so the RPC
 * contract is a discriminated result instead of relying on exception identity across that
 * boundary. `deps.putBank`'s implementation (worker/index.ts's BankStoreDO) catches
 * BankConflictError itself, same-realm, where `instanceof` is reliable. */
export interface BankConflict {
  conflict: true;
  currentVersion: number;
}

export interface BankApiDeps {
  ownerKey: string | undefined;
  allowedOrigins: string;
  getVersionedBank(): Promise<VersionedBank>;
  putBank(candidate: unknown, expectedVersion: number): Promise<VersionedBank | BankConflict>;
}

// ~4x the bundled bank's size; generous headroom, not unbounded. Exported so tests can probe the
// exact boundary instead of guessing a value that could silently drift from this one.
export const MAX_BANK_BODY_BYTES = 200_000;

/** Below this, brute-forcing OWNER_KEY over an unthrottled Worker endpoint (no rate limiting —
 * see docs/designs/question-bank-editor.md's NOT in scope) stops being a documentation-only risk.
 * This never refuses service, just makes a weak secret visible in the Worker's own logs. */
const MIN_OWNER_KEY_LENGTH = 32;

/** The editor UI is a separate origin (the Next.js frontend), unlike the WebSocket room paths which
 * don't need CORS at all. Reuses the same ALLOWED_ORIGINS the WS Origin check uses. Exported for
 * bank-image-api.ts, which needs the same CORS story (plus POST) for its own endpoint. */
export function corsHeaders(origin: string | null, allowed: string, methods = "GET, PUT, OPTIONS"): HeadersInit {
  if (!origin || !originAllowed(origin, allowed)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

/** Bearer-token owner-key check shared by every /api/bank/* endpoint. Returns a 403 Response if
 * the request isn't authorized, or null to continue. Logs (never blocks) a too-short configured
 * key — see MIN_OWNER_KEY_LENGTH's doc comment. */
export function ownerAuthResponse(request: Request, ownerKey: string | undefined, cors: HeadersInit): Response | null {
  if (ownerKey && ownerKey.length < MIN_OWNER_KEY_LENGTH) {
    console.error(JSON.stringify({ event: "weak_owner_key", length: ownerKey.length, minimum: MIN_OWNER_KEY_LENGTH }));
  }
  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!ownerKey || !tokensEqual(ownerKey, presented)) {
    return new Response("Forbidden", { status: 403, headers: cors });
  }
  return null;
}

/** Owner-only question-bank CRUD over HTTP. Deliberately not wired through routePartykitRequest —
 * see lib/gate.ts's header comment and worker/index.ts's Env.bank doc comment for why a new
 * Durable Object binding needs its own route instead of joining that whitelist. */
export async function handleBankApi(request: Request, deps: BankApiDeps): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, deps.allowedOrigins);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const authError = ownerAuthResponse(request, deps.ownerKey, cors);
  if (authError) return authError;

  if (request.method === "GET") {
    return Response.json(await deps.getVersionedBank(), { headers: cors });
  }
  if (request.method === "PUT") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > MAX_BANK_BODY_BYTES) return new Response("Payload too large", { status: 413, headers: cors });
    // Content-Length is attacker-controlled (a chunked-encoding or spoofed request can omit or lie
    // about it): the real check is on bytes actually read, not the header the client claims.
    let text: string;
    try {
      text = await request.text();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: cors });
    }
    if (new TextEncoder().encode(text).length > MAX_BANK_BODY_BYTES) {
      return new Response("Payload too large", { status: 413, headers: cors });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: cors });
    }
    const { bank, version } = (parsed ?? {}) as { bank?: unknown; version?: unknown };
    if (typeof version !== "number") {
      return new Response("Missing version — GET the bank first and send back its version", { status: 400, headers: cors });
    }
    try {
      const result = await deps.putBank(bank, version);
      if ("conflict" in result) {
        return Response.json(
          { error: "Bank was changed by someone else since you loaded it. Reload and try again.", currentVersion: result.currentVersion },
          { status: 409, headers: cors },
        );
      }
      return Response.json(result, { headers: cors });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "Invalid bank", { status: 400, headers: cors });
    }
  }
  return new Response("Method not allowed", { status: 405, headers: cors });
}

/** A new room's starting bank: the live one, or undefined (the caller's own bundled-bank default) if
 * unreachable — BankStore redeploying, cold-start latency, an editor bug. A live game must never fail
 * to start because the question-bank editor is having a bad day. */
export async function bankOrFallback(getBank: () => Promise<Bank>): Promise<Bank | undefined> {
  try {
    return await getBank();
  } catch (err) {
    console.error(JSON.stringify({ event: "bank_fetch_failed", error: String(err) }));
    return undefined;
  }
}
