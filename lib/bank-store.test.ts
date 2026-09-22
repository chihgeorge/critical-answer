import { describe, it, expect } from "vitest";
import { BankStore, type BankStorage } from "./bank-store";
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
  rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, questions: [{ id: "r0-q1", text: "1+1?", answer: "2" }] }],
  boss: { monster: { name: "巨龍", sprite: "dragon", hue: 0 }, maxHp: 10, questions: [{ id: "b-q1", text: "2+2?", answer: "4" }] },
};

describe("BankStore.getBank", () => {
  it("seeds itself from the bundled bank on first read (empty storage)", async () => {
    const storage = memoryStorage();
    const store = new BankStore(storage);
    const bank = await store.getBank();
    expect(bank).toEqual(BANK);
    // The seed is persisted, not re-computed every call.
    expect(await storage.get("bank")).toEqual(BANK);
  });

  it("returns the stored bank unchanged when one already exists", async () => {
    const storage = memoryStorage(validBank);
    const bank = await new BankStore(storage).getBank();
    expect(bank).toEqual(validBank);
  });

  it("falls back to the bundled bank when storage holds something corrupt, without throwing", async () => {
    const storage = memoryStorage({ rooms: "not an array" });
    const bank = await new BankStore(storage).getBank();
    expect(bank).toEqual(BANK);
  });
});

describe("BankStore.putBank", () => {
  it("validates and stores a valid bank, returning it", async () => {
    const storage = memoryStorage();
    const store = new BankStore(storage);
    const result = await store.putBank(validBank);
    expect(result).toEqual(validBank);
    expect(await storage.get("bank")).toEqual(validBank);
  });

  it("rejects an invalid bank and leaves the previous one in place", async () => {
    const storage = memoryStorage(validBank);
    const store = new BankStore(storage);
    await expect(store.putBank({ rooms: [] })).rejects.toThrow(/invalid question bank/i);
    expect(await storage.get("bank")).toEqual(validBank);
  });

  it("rejects a duplicate question id across rooms", async () => {
    const dup: Bank = { ...validBank, boss: { ...validBank.boss, questions: [{ id: "r0-q1", text: "dup?", answer: "x" }] } };
    const store = new BankStore(memoryStorage());
    await expect(store.putBank(dup)).rejects.toThrow(/duplicate question id/i);
  });
});
