import { describe, it, expect } from "vitest";
import { BankStore, BankConflictError, type BankStorage } from "./bank-store";
import { BANK, type Bank } from "./question-bank";

/** In-memory stand-in for a Durable Object's storage, same convention as lib/room's tests. */
function memoryStorage(seed?: unknown): BankStorage {
  const data = new Map<string, unknown>();
  if (seed !== undefined) data.set("bank", seed);
  return {
    get: async (k) => structuredClone(data.get(k)),
    put: async (k, v) => void data.set(k, structuredClone(v)),
  };
}

const validBank: Bank = {
  rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, questions: [{ kind: "text", id: "r0-q1", text: "1+1?", answer: "2" }] }],
  boss: { monster: { name: "巨龍", sprite: "dragon", hue: 0 }, maxHp: 10, questions: [{ kind: "text", id: "b-q1", text: "2+2?", answer: "4" }] },
};

describe("BankStore.getBank / getVersionedBank", () => {
  it("seeds itself from the bundled bank at version 1 on first read (empty storage)", async () => {
    const storage = memoryStorage();
    const store = new BankStore(storage);
    const bank = await store.getBank();
    expect(bank).toEqual(BANK);
    // The seed is persisted, not re-computed every call.
    expect(await storage.get("bank")).toEqual({ bank: BANK, version: 1 });
  });

  it("returns the stored bank and version unchanged when one already exists", async () => {
    const storage = memoryStorage({ bank: validBank, version: 7 });
    const versioned = await new BankStore(storage).getVersionedBank();
    expect(versioned).toEqual({ bank: validBank, version: 7 });
  });

  it("falls back to the bundled bank at version 1 when storage holds something corrupt, without throwing", async () => {
    const storage = memoryStorage({ bank: { rooms: "not an array" }, version: 3 });
    const versioned = await new BankStore(storage).getVersionedBank();
    expect(versioned).toEqual({ bank: BANK, version: 1 });
  });

  it("treats a missing version field as 1 (backward-compatible with a pre-version save)", async () => {
    const storage = memoryStorage({ bank: validBank });
    const versioned = await new BankStore(storage).getVersionedBank();
    expect(versioned.version).toBe(1);
  });
});

describe("BankStore.putBank", () => {
  it("validates and stores a valid bank at the expected version, returning it at version+1", async () => {
    const storage = memoryStorage({ bank: validBank, version: 1 });
    const store = new BankStore(storage);
    const result = await store.putBank(validBank, 1);
    expect(result).toEqual({ bank: validBank, version: 2 });
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 2 });
  });

  it("saves against the freshly-seeded version 1 on an empty store", async () => {
    const store = new BankStore(memoryStorage());
    const result = await store.putBank(validBank, 1);
    expect(result.version).toBe(2);
  });

  it("rejects a stale version with BankConflictError, naming the current version, and saves nothing", async () => {
    const storage = memoryStorage({ bank: validBank, version: 5 });
    const store = new BankStore(storage);
    const err = await store.putBank(validBank, 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BankConflictError);
    expect((err as BankConflictError).currentVersion).toBe(5);
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 5 }); // unchanged
  });

  it("rejects an invalid bank and leaves the previous one in place", async () => {
    const storage = memoryStorage({ bank: validBank, version: 1 });
    const store = new BankStore(storage);
    await expect(store.putBank({ rooms: [] }, 1)).rejects.toThrow(/invalid question bank/i);
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 1 });
  });

  it("rejects a duplicate question id across rooms", async () => {
    const dup: Bank = { ...validBank, boss: { ...validBank.boss, questions: [{ kind: "text", id: "r0-q1", text: "dup?", answer: "x" }] } };
    const store = new BankStore(memoryStorage({ bank: validBank, version: 1 }));
    await expect(store.putBank(dup, 1)).rejects.toThrow(/duplicate question id/i);
  });

  it("checks the version before validating the candidate — a stale save with a bad bank still reports the conflict", async () => {
    const storage = memoryStorage({ bank: validBank, version: 2 });
    const store = new BankStore(storage);
    await expect(store.putBank({ rooms: [] }, 1)).rejects.toThrow(BankConflictError);
  });
});
