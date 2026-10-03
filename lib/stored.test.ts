import { describe, it, expect, vi, afterEach } from "vitest";
import { readStored, writeStored } from "./stored";

afterEach(() => vi.unstubAllGlobals());

describe("readStored / writeStored", () => {
  it("round-trips a value, and reads null for a key that was never written", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    writeStored("k", "v");
    expect(readStored("k")).toBe("v");
    expect(readStored("missing")).toBeNull();
  });

  it("never throws when storage is blocked (private browsing): reads null, writes are dropped", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(readStored("k")).toBeNull();
    expect(() => writeStored("k", "v")).not.toThrow();
  });
});
