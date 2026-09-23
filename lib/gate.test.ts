import { describe, it, expect, vi } from "vitest";
import { entryGate } from "./gate";

const req = (origin?: string) => new Request("https://worker.example/parties/x/y", origin ? { headers: { Origin: origin } } : {});

describe("entryGate", () => {
  it("lets the room through", () => {
    expect(entryGate(req(), { className: "main" }, "https://app.example")).toBeUndefined();
  });

  it("hides every other Durable Object binding behind a 404, even with an allowed origin", () => {
    for (const className of ["bank", "room", "", "MAIN", "main2"]) {
      expect(entryGate(req("https://app.example"), { className }, "https://app.example")?.status).toBe(404);
    }
  });

  it("rejects a browser page from another origin with a 403 and logs the named event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(entryGate(req("https://evil.example"), { className: "main" }, "https://app.example")?.status).toBe(403);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"origin_rejected"'));
    warn.mockRestore();
  });

  it("checks the route before the origin, so a wrong binding never reveals anything about origins", () => {
    expect(entryGate(req("https://evil.example"), { className: "bank" }, "https://app.example")?.status).toBe(404);
  });
});
