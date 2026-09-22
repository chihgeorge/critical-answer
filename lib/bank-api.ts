// Pure, testable HTTP handling for the question-bank API. Platform-agnostic on purpose, same split
// as dungeon-room.ts/bank-store.ts — worker/index.ts wires this to the real BankStoreDO RPC stub and
// env secrets, but none of the logic here knows Cloudflare exists.

import { tokensEqual } from "./tokens";
import { originAllowed } from "./origin";
import type { Bank } from "./question-bank";

export interface BankApiDeps {
  ownerKey: string | undefined;
  allowedOrigins: string;
  getBank(): Promise<Bank>;
  putBank(candidate: unknown): Promise<Bank>;
}

// ~4x the bundled bank's size; generous headroom, not unbounded. Exported so tests can probe the
// exact boundary instead of guessing a value that could silently drift from this one.
export const MAX_BANK_BODY_BYTES = 200_000;

/** The editor UI is a separate origin (the Next.js frontend), unlike the WebSocket room paths which
 * don't need CORS at all. Reuses the same ALLOWED_ORIGINS the WS Origin check uses. */
function corsHeaders(origin: string | null, allowed: string): HeadersInit {
  if (!origin || !originAllowed(origin, allowed)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

/** Owner-only question-bank CRUD over HTTP. Deliberately not wired through routePartykitRequest —
 * see lib/gate.ts's header comment and worker/index.ts's Env.bank doc comment for why a new
 * Durable Object binding needs its own route instead of joining that whitelist. */
export async function handleBankApi(request: Request, deps: BankApiDeps): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, deps.allowedOrigins);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!deps.ownerKey || !tokensEqual(deps.ownerKey, presented)) {
    return new Response("Forbidden", { status: 403, headers: cors });
  }

  if (request.method === "GET") {
    return Response.json(await deps.getBank(), { headers: cors });
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
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: cors });
    }
    try {
      return Response.json(await deps.putBank(body), { headers: cors });
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
