import { describe, it, expect, vi } from "vitest";
import { entryGate } from "./gate";
import { generateRoomCode } from "./room-code";

const req = (origin?: string) => new Request("https://worker.example/parties/x/y", origin ? { headers: { Origin: origin } } : {});

describe("entryGate", () => {
  it("lets the room through", () => {
    expect(entryGate(req(), { className: "main", name: "BCDF" }, "https://app.example")).toBeUndefined();
  });

  it("hides every other Durable Object binding behind a 404, even with an allowed origin", () => {
    for (const className of ["bank", "room", "", "MAIN", "main2"]) {
      expect(entryGate(req("https://app.example"), { className, name: "BCDF" }, "https://app.example")?.status).toBe(404);
    }
  });

  it("rejects a browser page from another origin with a 403 and logs the named event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(entryGate(req("https://evil.example"), { className: "main", name: "BCDF" }, "https://app.example")?.status).toBe(403);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"origin_rejected"'));
    warn.mockRestore();
  });

  // Value: protects=a script cannot open a fresh Durable Object (alarm, snapshot, 24 h of storage) under any name it
  // likes; fails_when=the gate lets through a name generateRoomCode could never make.
  it("lets through only a code generateRoomCode could make", () => {
    for (let i = 0; i < 50; i++) expect(entryGate(req(), { className: "main", name: generateRoomCode() }, "")).toBeUndefined();
    for (const name of ["ABCD", "BCDI", "BCDO", "bcdf", "BCD", "BCDFG", "BCD1", "", "../x", "BCDF "]) {
      expect(entryGate(req(), { className: "main", name }, "")?.status).toBe(404);
    }
  });

  it("checks the route before the origin, so a wrong binding never reveals anything about origins", () => {
    expect(entryGate(req("https://evil.example"), { className: "bank", name: "BCDF" }, "https://app.example")?.status).toBe(404);
  });
});
