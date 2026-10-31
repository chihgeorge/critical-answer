import { describe, it, expect, vi } from "vitest";
import { handleClientError, MAX_CLIENT_ERROR_BYTES } from "./client-error-api";

const ALLOWED = "https://app.example.com";
const post = (body: string, origin: string | null = ALLOWED) =>
  new Request("https://worker.example.com/api/client-error", { method: "POST", body, headers: origin ? { Origin: origin } : {} });

describe("handleClientError", () => {
  it("logs one cleaned JSON line and answers 204", async () => {
    const log = vi.fn();
    const res = await handleClientError(post(JSON.stringify({ message: "boom\nfake line", digest: "abc", path: "/room/ABCD/screen" })), ALLOWED, log);
    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "client_error", message: "boom fake line", digest: "abc", path: "/room/ABCD/screen" });
  });

  it("cuts long fields", async () => {
    const log = vi.fn();
    await handleClientError(post(JSON.stringify({ message: "x".repeat(900), path: "/" + "p".repeat(400) })), ALLOWED, log);
    const line = JSON.parse(log.mock.calls[0][0]);
    expect(line.message).toHaveLength(500);
    expect(line.path).toHaveLength(200);
  });

  it("refuses another site, other methods, bad JSON and oversized bodies without logging", async () => {
    const log = vi.fn();
    expect((await handleClientError(post("{}", "https://evil.example.com"), ALLOWED, log)).status).toBe(403);
    expect((await handleClientError(new Request("https://worker.example.com/api/client-error"), ALLOWED, log)).status).toBe(405);
    expect((await handleClientError(post("not json"), ALLOWED, log)).status).toBe(400);
    expect((await handleClientError(post("null"), ALLOWED, log)).status).toBe(400);
    expect((await handleClientError(post("a".repeat(MAX_CLIENT_ERROR_BYTES + 1)), ALLOWED, log)).status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });

  it("cuts off a chunked body with no Content-Length at the cap", async () => {
    const log = vi.fn();
    const big = new TextEncoder().encode("a".repeat(1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({ pull: (c) => (sent++ < 100 ? c.enqueue(big) : c.close()) });
    const req = new Request("https://worker.example.com/api/client-error", { method: "POST", body, headers: { Origin: ALLOWED }, duplex: "half" } as RequestInit);
    expect((await handleClientError(req, ALLOWED, log)).status).toBe(413);
    expect(sent).toBeLessThan(10);
    expect(log).not.toHaveBeenCalled();
  });
});
