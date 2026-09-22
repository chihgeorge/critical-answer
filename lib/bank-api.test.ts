import { describe, it, expect, vi } from "vitest";
import { handleBankApi, bankOrFallback, type BankApiDeps } from "./bank-api";
import { BANK, type Bank } from "./question-bank";

const KEY = "owner-key-0123456789abcdef";

function deps(over: Partial<BankApiDeps> = {}): BankApiDeps {
  return {
    ownerKey: KEY,
    allowedOrigins: "https://app.example.com",
    getBank: vi.fn(async () => BANK),
    putBank: vi.fn(async (b: unknown) => b as Bank),
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
});

describe("handleBankApi: GET", () => {
  it("returns the bank from deps.getBank()", async () => {
    const getBank = vi.fn(async () => BANK);
    const res = await handleBankApi(req("GET", { auth: `Bearer ${KEY}` }), deps({ getBank }));
    expect(getBank).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual(BANK);
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
    const bigBody = { text: "x".repeat(250_000) };
    const request = new Request("https://worker.example.com/api/bank", {
      method: "PUT",
      headers: { Authorization: `Bearer ${KEY}` }, // no Content-Length at all
      body: JSON.stringify(bigBody),
    });
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

  it("propagates a putBank validation failure as 400 with its message", async () => {
    const putBank = vi.fn(async () => {
      throw new Error("Invalid question bank: no rooms");
    });
    const res = await handleBankApi(req("PUT", { auth: `Bearer ${KEY}`, body: { rooms: [] } }), deps({ putBank }));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/no rooms/);
  });

  it("saves and returns the validated bank on success", async () => {
    const putBank = vi.fn(async (b: unknown) => b as Bank);
    const res = await handleBankApi(req("PUT", { auth: `Bearer ${KEY}`, body: BANK }), deps({ putBank }));
    expect(res.status).toBe(200);
    expect(putBank).toHaveBeenCalledWith(BANK);
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
