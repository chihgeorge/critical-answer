import { describe, it, expect, vi } from "vitest";
import { handleBankApi, bankOrFallback, MAX_BANK_BODY_BYTES, type BankApiDeps } from "./bank-api";
import type { VersionedBank } from "./bank-store";
import { BANK } from "./question-bank-data";

const VERSIONED: VersionedBank = { bank: BANK, version: 1 };

/** A syntactically valid `{"version":1,"bank":"...padding..."}` body whose UTF-8 byte length is
 * exactly `totalBytes` — every character here is ASCII, so JS string length and UTF-8 byte length
 * coincide for the padding. `bank`'s value doesn't need to be a real Bank: putBank is mocked in
 * every test that uses this, so shape validation never runs. */
function jsonBodyOfBytes(totalBytes: number): string {
  const prefix = '{"version":1,"bank":"';
  const suffix = '"}';
  const overhead = prefix.length + suffix.length;
  return prefix + "a".repeat(totalBytes - overhead) + suffix;
}

const KEY = "owner-key-0123456789abcdef";

function deps(over: Partial<BankApiDeps> = {}): BankApiDeps {
  return {
    ownerKey: KEY,
    allowedOrigins: "https://app.example.com",
    getVersionedBank: vi.fn(async () => VERSIONED),
    putBank: vi.fn(async () => ({ bank: BANK, version: 2 })),
    ...over,
  };
}

const req = (method: string, opts: { auth?: string; origin?: string; body?: unknown; contentLength?: number } = {}) => {
  const headers = new Headers();
  if (opts.auth) headers.set("Authorization", opts.auth);
  if (opts.origin) headers.set("Origin", opts.origin);
  if (opts.contentLength !== undefined) headers.set("Content-Length", String(opts.contentLength));
  return new Request("https://worker.example.com/api/bank", {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
};

describe("handleBankApi: auth", () => {
  it("rejects a missing Authorization header (403)", async () => {
    const res = await handleBankApi(req("GET"), deps());
    expect(res.status).toBe(403);
  });

  it("rejects a wrong key (403)", async () => {
    const res = await handleBankApi(req("GET", { auth: "Bearer wrong" }), deps());
    expect(res.status).toBe(403);
  });

  it("rejects any key when OWNER_KEY is unset (fail closed)", async () => {
    const res = await handleBankApi(req("GET", { auth: `Bearer ${KEY}` }), deps({ ownerKey: undefined }));
    expect(res.status).toBe(403);
  });

  it("accepts the correct key", async () => {
    const res = await handleBankApi(req("GET", { auth: `Bearer ${KEY}` }), deps());
    expect(res.status).toBe(200);
  });
});

describe("handleBankApi: weak owner key", () => {
  it("logs a warning but still serves the request when OWNER_KEY is shorter than the minimum", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleBankApi(req("GET", { auth: "Bearer short" }), deps({ ownerKey: "short" }));
    expect(res.status).toBe(200); // a short key still works for auth — this only logs, never blocks
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("weak_owner_key"));
    spy.mockRestore();
  });

  it("does not log when OWNER_KEY meets the minimum length", async () => {
    const longKey = "a".repeat(32);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleBankApi(req("GET", { auth: `Bearer ${longKey}` }), deps({ ownerKey: longKey }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("handleBankApi: CORS", () => {
  it("answers OPTIONS with the CORS headers for an allowed origin, before checking auth", async () => {
    const res = await handleBankApi(req("OPTIONS", { origin: "https://app.example.com" }), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("omits CORS headers for a disallowed origin", async () => {
    const res = await handleBankApi(req("GET", { auth: `Bearer ${KEY}`, origin: "https://evil.example.com" }), deps());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("preflights a disallowed origin with 204 but no Access-Control-Allow-Origin — the browser, not this endpoint, blocks the real request", async () => {
    const res = await handleBankApi(req("OPTIONS", { origin: "https://evil.example.com" }), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("handleBankApi: GET", () => {
  it("returns the bank and version from deps.getVersionedBank()", async () => {
    const getVersionedBank = vi.fn(async () => VERSIONED);
    const res = await handleBankApi(req("GET", { auth: `Bearer ${KEY}` }), deps({ getVersionedBank }));
    expect(getVersionedBank).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual(VERSIONED);
  });
});

describe("handleBankApi: PUT", () => {
  it("rejects a body over the size limit before reading it (413)", async () => {
    const putBank = vi.fn();
    const res = await handleBankApi(req("PUT", { auth: `Bearer ${KEY}`, contentLength: 300_000 }), deps({ putBank }));
    expect(res.status).toBe(413);
    expect(putBank).not.toHaveBeenCalled();
  });

  it("rejects an oversized body even when Content-Length is missing or lied about (413)", async () => {
    const putBank = vi.fn();
    const bigBody = { version: 1, bank: { text: "x".repeat(250_000) } };
    const request = new Request("https://worker.example.com/api/bank", {
      method: "PUT",
      headers: { Authorization: `Bearer ${KEY}` }, // no Content-Length at all
      body: JSON.stringify(bigBody),
    });
    const res = await handleBankApi(request, deps({ putBank }));
    expect(res.status).toBe(413);
    expect(putBank).not.toHaveBeenCalled();
  });

  it("accepts a body of exactly the byte limit, with no Content-Length header", async () => {
    const putBank = vi.fn(async () => ({ bank: BANK, version: 2 }));
    const request = new Request("https://worker.example.com/api/bank", {
      method: "PUT",
      headers: { Authorization: `Bearer ${KEY}` },
      body: jsonBodyOfBytes(MAX_BANK_BODY_BYTES),
    });
    const res = await handleBankApi(request, deps({ putBank }));
    expect(res.status).toBe(200);
    expect(putBank).toHaveBeenCalledOnce();
  });

  it("rejects a body exactly one byte over the limit, with no Content-Length header", async () => {
    const putBank = vi.fn();
    const request = new Request("https://worker.example.com/api/bank", {
      method: "PUT",
      headers: { Authorization: `Bearer ${KEY}` },
      body: jsonBodyOfBytes(MAX_BANK_BODY_BYTES + 1),
    });
    const res = await handleBankApi(request, deps({ putBank }));
    expect(res.status).toBe(413);
    expect(putBank).not.toHaveBeenCalled();
  });

  it("rejects a CJK body over the byte limit even though its JS string length is well under it", async () => {
    // '題' is 1 UTF-16 code unit but 3 UTF-8 bytes — a naive `.length` check would let this
    // through (67,000 chars is far below MAX_BANK_BODY_BYTES), but the real byte count doesn't.
    const putBank = vi.fn();
    const text = "題".repeat(67_000); // ~201,000 UTF-8 bytes, .length is only 67,000
    const request = new Request("https://worker.example.com/api/bank", {
      method: "PUT",
      headers: { Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ version: 1, bank: { text } }),
    });
    expect(text.length).toBeLessThan(MAX_BANK_BODY_BYTES);
    const res = await handleBankApi(request, deps({ putBank }));
    expect(res.status).toBe(413);
    expect(putBank).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON (400)", async () => {
    const request = new Request("https://worker.example.com/api/bank", {
      method: "PUT",
      headers: { Authorization: `Bearer ${KEY}` },
      body: "{not json",
    });
    const res = await handleBankApi(request, deps());
    expect(res.status).toBe(400);
  });

  it("rejects a body with no version field (400), without calling putBank", async () => {
    const putBank = vi.fn();
    const res = await handleBankApi(req("PUT", { auth: `Bearer ${KEY}`, body: { bank: BANK } }), deps({ putBank }));
    expect(res.status).toBe(400);
    expect(putBank).not.toHaveBeenCalled();
  });

  it("propagates a putBank validation failure as 400 with its message", async () => {
    const putBank = vi.fn(async () => {
      throw new Error("Invalid question bank: no rooms");
    });
    const res = await handleBankApi(req("PUT", { auth: `Bearer ${KEY}`, body: { version: 1, bank: { rooms: [] } } }), deps({ putBank }));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/no rooms/);
  });

  it("reports a version conflict (deps.putBank's discriminated result) as 409 with the current version, not a generic 400", async () => {
    // Deliberately a *returned* conflict result, not a thrown BankConflictError: that class
    // doesn't survive the real Durable Object RPC boundary intact (verified live against
    // wrangler dev — instanceof fails on the far side even though .message doesn't), so the RPC
    // contract (BankApiDeps.putBank) is a discriminated result, and this is what an implementation
    // of it must return for a conflict.
    const putBank = vi.fn(async () => ({ conflict: true as const, currentVersion: 5 }));
    const res = await handleBankApi(req("PUT", { auth: `Bearer ${KEY}`, body: { version: 1, bank: BANK } }), deps({ putBank }));
    expect(res.status).toBe(409);
    const body: { error: string; currentVersion: number } = await res.json();
    expect(body.currentVersion).toBe(5);
  });

  it("saves and returns the validated bank and new version on success", async () => {
    const putBank = vi.fn(async () => ({ bank: BANK, version: 2 }));
    const res = await handleBankApi(req("PUT", { auth: `Bearer ${KEY}`, body: { version: 1, bank: BANK } }), deps({ putBank }));
    expect(res.status).toBe(200);
    expect(putBank).toHaveBeenCalledWith(BANK, 1);
    expect(await res.json()).toEqual({ bank: BANK, version: 2 });
  });
});

describe("handleBankApi: method routing", () => {
  it("rejects an unsupported method (405)", async () => {
    const res = await handleBankApi(req("DELETE", { auth: `Bearer ${KEY}` }), deps());
    expect(res.status).toBe(405);
  });
});

describe("bankOrFallback", () => {
  it("returns the loaded bank on success", async () => {
    await expect(bankOrFallback(async () => BANK)).resolves.toEqual(BANK);
  });

  it("returns undefined (never throws) when the loader fails", async () => {
    await expect(
      bankOrFallback(async () => {
        throw new Error("BankStore unreachable");
      }),
    ).resolves.toBeUndefined();
  });
});
