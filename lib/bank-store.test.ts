import { describe, it, expect, vi } from "vitest";
import { BANK_FORMAT, BankStore, formatOf, LEGACY_IMAGE_DELAY_MS, legacyImageKeys, type BankStorage } from "./bank-store";
import { type Bank } from "./question-bank";
import { BANK } from "./question-bank-data";

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
  pools: { 1: [{ kind: "text", id: "r0-q1", content: { kind: "text", value: "1+1?" }, answer: "2" }], 2: [], 3: [], 4: [], 5: [] },
  rooms: [{ monster: "slime-soft", difficulty: 1, reward: 10 }],
  boss: { monster: "dragon", hitReward: 10, phases: [{ name: "", rule: "", maxHp: 10, questions: [{ kind: "text", id: "b-q1", content: { kind: "text", value: "2+2?" }, answer: "4" }] }] },
};

describe("BankStore.getVersionedBank", () => {
  it("seeds itself from the bundled bank at version 1 on first read (empty storage)", async () => {
    const storage = memoryStorage();
    const store = new BankStore(storage);
    const { bank } = await store.getVersionedBank();
    expect(bank).toEqual(BANK);
    // The seed is persisted, not re-computed every call.
    expect(await storage.get("bank")).toEqual({ bank: BANK, version: 1, format: formatOf(BANK) });
  });

  it("returns the stored bank and version unchanged when one already exists", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 7 });
    const versioned = await new BankStore(storage).getVersionedBank();
    expect(versioned).toEqual({ bank: validBank, version: 7 });
  });

  it("reads a bank stored before pools as pools, and saves it back", async () => {
    // Every stored bank in production is in the pre-pool shape until its first save after deploy.
    const { rooms: [room], boss } = validBank;
    const legacy = { rooms: [{ monster: room.monster, baseDifficulty: 1, reward: 10, questions: validBank.pools[1] }], boss };
    const store = new BankStore(memoryStorage({ format: BANK_FORMAT, bank: legacy, version: 2 })); // pregate-literal: BANK_FORMAT=2 the 2 here is the stored version, not the format
    const { bank } = await store.getVersionedBank();
    expect(bank.pools[1].map((q) => q.id)).toEqual(["r0-q1"]);
    await expect(store.putBank(bank, 2)).resolves.toBeDefined();
  });

  it("falls back to the bundled bank at version 1 when storage holds something corrupt, without throwing", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: { rooms: "not an array" }, version: 3 }); // pregate-literal: BANK_FORMAT=3 the 3 here is the stored version, not the format
    const versioned = await new BankStore(storage).getVersionedBank();
    expect(versioned).toEqual({ bank: BANK, version: 1, unreadable: true });
  });

  it("treats a missing version field as 1 (backward-compatible with a pre-version save)", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank });
    const versioned = await new BankStore(storage).getVersionedBank();
    expect(versioned.version).toBe(1);
  });
});

describe("BankStore.putBank", () => {
  it("validates and stores a valid bank at the expected version, returning it at version+1", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 });
    const store = new BankStore(storage);
    const result = await store.putBank(validBank, 1);
    expect(result).toEqual({ bank: validBank, version: 2 });
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 2, format: formatOf(validBank) }); // pregate-literal: BANK_FORMAT=2 the 2 here is the version after one save, not the format
  });

  it("refuses to save over a stored bank it cannot read, and keeps it (a rollback below a newer format)", async () => {
    // The fallback bank is version 1, so a save at version 1 would otherwise replace every custom question.
    const stored = { bank: { rooms: "a format this version can't read" }, version: 7, format: BANK_FORMAT };
    const storage = memoryStorage(stored);
    await expect(new BankStore(storage).putBank(validBank, 1)).rejects.toThrow(/unreadable/);
    expect(await storage.get("bank")).toEqual(stored);
  });

  it("refuses to save over a stored bank in a newer format, even one its parseBank accepts", async () => {
    // A newer format that only adds fields would parse fine here, and a save would drop those fields.
    const stored = { bank: validBank, version: 3, format: BANK_FORMAT + 1 };
    const storage = memoryStorage(stored);
    const store = new BankStore(storage);
    expect(await store.getVersionedBank()).toEqual({ bank: BANK, version: 1, unreadable: true });
    await expect(store.putBank(validBank, 1)).rejects.toThrow(/unreadable/);
    expect(await storage.get("bank")).toEqual(stored);
  });

  it("treats a format that is not a known number as unreadable too", async () => {
    for (const format of ["2", null, Number.NaN, {}]) {
      const stored = { bank: validBank, version: 3, format };
      const storage = memoryStorage(stored);
      await expect(new BankStore(storage).putBank(validBank, 3)).rejects.toThrow(/unreadable/);
    }
  });

  it("saves against the freshly-seeded version 1 on an empty store", async () => {
    const store = new BankStore(memoryStorage());
    const result = await store.putBank(validBank, 1);
    expect(result).toMatchObject({ version: 2 });
  });

  it("returns a conflict for a stale version, naming the current version, and saves nothing", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 5 });
    const store = new BankStore(storage);
    expect(await store.putBank(validBank, 3)).toEqual({ conflict: true, currentVersion: 5 });
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 5, format: BANK_FORMAT }); // unchanged
  });

  it("rejects an invalid bank and leaves the previous one in place", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 });
    const store = new BankStore(storage);
    await expect(store.putBank({ rooms: [] }, 1)).rejects.toThrow(/invalid question bank/i);
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 1, format: BANK_FORMAT });
  });

  it("still loads a stored multipleChoice question with 5 options, but refuses to save one (the TV has 4 tiles)", async () => {
    const five = { kind: "multipleChoice" as const, id: "mc5", content: { kind: "text" as const, value: "?" }, options: ["A", "B", "C", "D", "E"], correctIndex: 0 };
    const legacy: Bank = { ...validBank, pools: { ...validBank.pools, 1: [...validBank.pools[1], five] } };
    const storage = memoryStorage({ format: BANK_FORMAT, bank: legacy, version: 3 });
    const store = new BankStore(storage);
    expect(await store.getVersionedBank()).toEqual({ bank: legacy, version: 3 });
    await expect(store.putBank(legacy, 3)).rejects.toThrow(/more than 4 options/);
    expect(await storage.get("bank")).toEqual({ bank: legacy, version: 3, format: BANK_FORMAT });
  });

  // Regression: boss HP had no upper bound, and the big screen draws one heart per HP
  // Found by /review on 2026-10-28
  it.each([[21], [2.5]])("refuses to save a boss phase with %s HP (a whole number from 1 to 20), and keeps the stored bank", async (maxHp) => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 });
    const store = new BankStore(storage);
    const big: Bank = { ...validBank, boss: { ...validBank.boss, phases: [{ ...validBank.boss.phases[0], maxHp }] } };
    await expect(store.putBank(big, 1)).rejects.toThrow(/hp must be a whole number from 1 to 20/);
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 1, format: BANK_FORMAT });
  });

  // Value: protects=no saved question has an id the phones' messages would refuse (MAX_ID); fails_when=assertSavable stops checking id length; why_new=parseBank accepts any length; seam=none; no_claim=banks stored before this check
  it("refuses to save a question id longer than 64 characters, and keeps the stored bank", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 });
    const store = new BankStore(storage);
    const [q, ...rest] = validBank.pools[1];
    const long: Bank = { ...validBank, pools: { ...validBank.pools, 1: [{ ...q, id: "x".repeat(65) }, ...rest] } };
    await expect(store.putBank(long, 1)).rejects.toThrow(/longer than 64 characters/);
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 1, format: BANK_FORMAT });
  });

  // Value: protects=20 HP, the documented top, still saves; fails_when=the bound turns into >= or MAX_BOSS_HP drops;
  // why_new=the rows above only test refusals; seam=none; no_claim=the editor's own input limits (e2e)
  it("saves a boss phase with exactly 20 HP", async () => {
    const store = new BankStore(memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 }));
    const top: Bank = { ...validBank, boss: { ...validBank.boss, phases: [{ ...validBank.boss.phases[0], maxHp: 20 }] } };
    await expect(store.putBank(top, 1)).resolves.toMatchObject({ version: 2 });
  });

  it("rejects a duplicate question id across rooms", async () => {
    const dup: Bank = { ...validBank, boss: { ...validBank.boss, phases: [{ ...validBank.boss.phases[0], questions: [{ kind: "text", id: "r0-q1", content: { kind: "text", value: "dup?" }, answer: "x" }] }] } };
    const store = new BankStore(memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 }));
    await expect(store.putBank(dup, 1)).rejects.toThrow(/duplicate question id/i);
  });

  it("checks the version before validating the candidate — a stale save with a bad bank still reports the conflict", async () => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 2 }); // pregate-literal: BANK_FORMAT=2 the 2 here is the stored version, not the format
    const store = new BankStore(storage);
    expect(await store.putBank({ rooms: [] }, 1)).toEqual({ conflict: true, currentVersion: 2 });
  });
});

describe("BankStore: orphaned images wait out running games before they're deleted", () => {
  const KEY = "44444444-4444-4444-4444-444444444444";
  const bankWithImage: Bank = {
    ...validBank,
    pools: { ...validBank.pools, 1: [{ kind: "text", id: "r0-q1", content: { kind: "image", value: KEY }, answer: "松鼠" }] },
  };
  const DELAY = 1000;

  /** A store on a fake clock, with its alarm and deletions recorded. */
  function setup(seed: unknown = { format: BANK_FORMAT, bank: bankWithImage, version: 1 }) {
    let t = 0;
    const alarms: number[] = [];
    const storage = { ...memoryStorage(seed), setAlarm: async (at: number) => void alarms.push(at) };
    const onImagesOrphaned = vi.fn<(keys: string[]) => Promise<void>>(async () => {});
    const store = new BankStore(storage, onImagesOrphaned, { cleanupDelayMs: DELAY, now: () => t });
    return { store, storage, alarms, onImagesOrphaned, at: (ms: number) => void (t = ms) };
  }

  it("does not delete an image at save time — a room mid-game may still be showing it", async () => {
    const { store, alarms, onImagesOrphaned } = setup();
    await store.putBank(validBank, 1); // validBank's r0-q1 is text — no longer references the image key
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    expect(alarms).toEqual([DELAY]);
  });

  it("deletes it when the alarm fires after the wait, and not before", async () => {
    const { store, storage, onImagesOrphaned, at } = setup();
    await store.putBank(validBank, 1);
    at(DELAY - 1);
    await store.runImageCleanup();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    at(DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).toHaveBeenCalledWith([KEY]);
    expect(await storage.get("pendingImageDeletes")).toEqual([]);
  });

  it("deletes nothing while the stored bank is unreadable (the fallback bank is not what's stored)", async () => {
    const { store, storage, alarms, onImagesOrphaned, at } = setup({ format: BANK_FORMAT, bank: { rooms: "a format this version can't read" }, version: 3 });
    await storage.put("pendingImageDeletes", [{ key: KEY, deleteAt: 0 }]);
    at(DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    expect(await storage.get("pendingImageDeletes")).toEqual([{ key: KEY, deleteAt: 0 }]);
    expect(alarms).toEqual([2 * DELAY]); // re-armed, so the queue is not stranded once the bank is readable again

    // Readable again (a roll-forward): the re-armed alarm finishes the job.
    await storage.put("bank", { bank: validBank, version: 4, format: BANK_FORMAT });
    at(2 * DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).toHaveBeenCalledWith([KEY]);
    expect(await storage.get("pendingImageDeletes")).toEqual([]);
  });

  it("never deletes an image that a later save put back in the bank", async () => {
    const { store, onImagesOrphaned, at } = setup();
    await store.putBank(validBank, 1);
    await store.putBank(bankWithImage, 2); // undo: the image is back
    at(DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
  });

  it("restarts the wait when an image is removed, put back, and removed again", async () => {
    const { store, alarms, onImagesOrphaned, at } = setup();
    await store.putBank(validBank, 1);
    await store.putBank(bankWithImage, 2);
    at(500); // a room started now copies the bank with the image in it
    await store.putBank(validBank, 3);
    at(DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    expect(alarms.at(-1)).toBe(500 + DELAY);
    at(500 + DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).toHaveBeenCalledWith([KEY]);
  });

  it("re-arms the alarm for what is still waiting after deleting what is due", async () => {
    const OTHER = "55555555-5555-5555-5555-555555555555";
    const twoImages: Bank = {
      ...bankWithImage,
      boss: { ...validBank.boss, phases: [{ ...validBank.boss.phases[0], questions: [{ kind: "text", id: "b-q1", content: { kind: "image", value: OTHER }, answer: "4" }] }] },
    };
    const { store, alarms, onImagesOrphaned, at } = setup({ format: BANK_FORMAT, bank: twoImages, version: 1 });
    await store.putBank(bankWithImage, 1); // drops OTHER at t=0
    at(300);
    await store.putBank(validBank, 2); // drops KEY at t=300
    at(DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).toHaveBeenCalledWith([OTHER]);
    expect(alarms.at(-1)).toBe(300 + DELAY);
  });

  it("deletes an uploaded image the editor never saved, once the wait is over", async () => {
    const { store, onImagesOrphaned, at } = setup({ format: BANK_FORMAT, bank: validBank, version: 1 });
    const UPLOAD = "66666666-6666-6666-6666-666666666666";
    await store.queueUploadedImage(UPLOAD);
    at(DELAY - 1);
    await store.runImageCleanup();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    at(DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).toHaveBeenCalledWith([UPLOAD]);
  });

  it("keeps an uploaded image that a save put in the bank, and drops it from the queue", async () => {
    const { store, storage, onImagesOrphaned, at } = setup({ format: BANK_FORMAT, bank: validBank, version: 1 });
    await store.queueUploadedImage(KEY);
    await store.putBank(bankWithImage, 1); // the editor saved it
    at(DELAY);
    await store.runImageCleanup();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    expect(await storage.get("pendingImageDeletes")).toEqual([]);
  });

  it("queues nothing when the same image key is still referenced after the save", async () => {
    const { store, storage, alarms } = setup();
    await store.putBank(bankWithImage, 1);
    expect(await storage.get("pendingImageDeletes")).toBeUndefined();
    expect(alarms).toEqual([]);
  });

  it("does not throw on cleanup when no callback was provided", async () => {
    const store = new BankStore(memoryStorage({ format: BANK_FORMAT, bank: bankWithImage, version: 1 }), undefined, { cleanupDelayMs: 0 });
    await store.putBank(validBank, 1);
    await expect(store.runImageCleanup()).resolves.toBeUndefined();
  });

  it("logs a failing delete instead of throwing out of the alarm", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, onImagesOrphaned, at } = setup();
    onImagesOrphaned.mockRejectedValueOnce(new Error("R2 delete failed"));
    await store.putBank(validBank, 1);
    at(DELAY);
    await expect(store.runImageCleanup()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("image_cleanup_failed"));
    spy.mockRestore();
  });
});

describe("BankStore: a stored bank from before the monster catalog (docs/designs/monster-catalog.md §5)", () => {
  const OLD_KEY = "55555555-5555-5555-5555-555555555555";
  const KEPT_KEY = "66666666-6666-6666-6666-666666666666";
  const oldBank = {
    pools: { 1: [{ kind: "text", id: "o1", content: { kind: "image", value: OLD_KEY }, answer: "a" }, { kind: "text", id: "o2", content: { kind: "image", value: KEPT_KEY }, answer: "b" }] },
    rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, difficulty: 1, reward: 10 }],
    boss: { monster: { name: "巨龍", sprite: "dragon", hue: 0 }, hitReward: 10, phases: [{ maxHp: 3, questions: [{ kind: "text", id: "ob", content: { kind: "text", value: "?" }, answer: "c" }] }] },
  };

  // Value: protects=an older-format bank loads as the default bank with its stored version and the `outdated` flag; fails_when=format < 3 is parsed, or treated as unreadable, or loses its version; why_new=new state; seam=none; no_claim=a real Durable Object (memory storage)
  // Value: protects=the live bank across the format-4 bump (sort questions): a format-3 bank still loads as is;
  // fails_when=bumping BANK_FORMAT turns every format-3 bank into the bundled one; seam=none; no_claim=a real Durable Object
  // Value: protects=a rollback after this version: a bank without a sort question is still stored at format 3, one
  // with a sort question at 4; fails_when=every save writes 4 (a rollback silently swaps in the default bank) or a sort
  // bank is written at 3 (older code drops its sort questions on save); seam=none; no_claim=a real Durable Object
  it("stores format 4 only for a bank with a sort question", async () => {
    expect(formatOf(validBank)).toBe(3);
    const sorted = { ...validBank, pools: { ...validBank.pools, 1: [{ kind: "sort" as const, id: "s1", content: { kind: "text" as const, value: "排" }, items: ["A", "B", "C", "D"] }] } };
    expect(formatOf(sorted)).toBe(BANK_FORMAT);
    const storage = memoryStorage({ format: 3, bank: validBank, version: 1 });
    await new BankStore(storage).putBank(sorted, 1);
    expect(await storage.get("bank")).toMatchObject({ version: 2, format: BANK_FORMAT });
  });

  it("still reads a format-3 bank as is", async () => {
    expect(await new BankStore(memoryStorage({ bank: validBank, version: 6, format: 3 })).getVersionedBank()).toEqual({ bank: validBank, version: 6 });
  });

  it("reads format 2, and a bank with no format, as outdated with the stored version", async () => {
    expect(await new BankStore(memoryStorage({ bank: oldBank, version: 9, format: 2 })).getVersionedBank()).toEqual({ bank: BANK, version: 9, outdated: 2 });
    expect(await new BankStore(memoryStorage({ bank: oldBank, version: 4 })).getVersionedBank()).toEqual({ bank: BANK, version: 4, outdated: 1 });
  });

  // Value: protects=the reseed after launch: a save over an outdated bank succeeds at format 3 and version+1, a stale version still conflicts, and the old bank's images it no longer uses are queued for 14 days (the owner may still convert and save the backup back); fails_when=putBank refuses outdated, skips the version check, forgets the old images or gives them the usual delay; why_new=new state; seam=none; no_claim=a real Durable Object (memory storage)
  it("lets a save overwrite it, checking the version and queueing the old images", async () => {
    const alarms: number[] = [];
    const storage = { ...memoryStorage({ bank: oldBank, version: 9, format: 2 }), setAlarm: async (at: number) => void alarms.push(at) };
    const store = new BankStore(storage, undefined, { cleanupDelayMs: 1000, now: () => 0 });
    const next: Bank = { ...validBank, pools: { ...validBank.pools, 1: [{ kind: "text", id: "n1", content: { kind: "image", value: KEPT_KEY }, answer: "b" }] } };
    expect(await store.putBank(next, 8)).toEqual({ conflict: true, currentVersion: 9 });
    expect(await store.putBank(next, 9)).toEqual({ bank: next, version: 10 });
    expect(await storage.get("bank")).toEqual({ bank: next, version: 10, format: formatOf(next) });
    expect(await storage.get("pendingImageDeletes")).toEqual([{ key: OLD_KEY, deleteAt: LEGACY_IMAGE_DELAY_MS }]); // 14 days, not the usual delay
    // Value: protects=the old bank survives the overwrite on the server; fails_when=putBank drops it; why_new=adversarial review (no server-side copy); seam=none; no_claim=a way to read it back
    expect(await storage.get("legacyBank")).toEqual({ bank: oldBank, format: 2, version: 9 });
  });

  // Value: protects=image cleanup waits while the bank is outdated; fails_when=cleanup deletes by the default bank and drops images the old bank uses; why_new=new state; seam=none; no_claim=a real alarm
  it("deletes no images while outdated, keeps the queue and re-arms", async () => {
    const onImagesOrphaned = vi.fn<(keys: string[]) => Promise<void>>(async () => {});
    const alarms: number[] = [];
    const storage = { ...memoryStorage({ bank: oldBank, version: 9, format: 2 }), setAlarm: async (at: number) => void alarms.push(at) };
    await storage.put("pendingImageDeletes", [{ key: OLD_KEY, deleteAt: 0 }]);
    await new BankStore(storage, onImagesOrphaned, { now: () => 5, cleanupDelayMs: 100 }).runImageCleanup();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    expect(alarms).toEqual([105]);
    expect(await storage.get("pendingImageDeletes")).toEqual([{ key: OLD_KEY, deleteAt: 0 }]);
  });

  // Value: protects=an outdated bank's images are found however the old format nests them, and odd shapes never throw; fails_when=the walk skips arrays or nested objects, or keeps empty/non-string values; why_new=new legacyImageKeys; seam=none; no_claim=every past format's layout
  it("finds image keys anywhere in a raw value, skipping other shapes", () => {
    expect([...legacyImageKeys(oldBank)].sort()).toEqual([OLD_KEY, KEPT_KEY].sort());
    expect([...legacyImageKeys({ a: [{ kind: "image", value: 3 }, { kind: "image", value: "" }, null, "x"] })]).toEqual([]);
  });
});
