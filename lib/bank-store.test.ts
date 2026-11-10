import { describe, it, expect, vi } from "vitest";
import { BANK_FORMAT, BankStore, formatOf, LEGACY_IMAGE_DELAY_MS, legacyImageKeys, type BankStorage } from "./bank-store";
import { assertSavable, type Bank } from "./question-bank";
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

  it("treats a version that is present but not an integer as unreadable, not as 1 (a save at 1 would overwrite it)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const version of ["5", null, 1.5]) {
      const store = new BankStore(memoryStorage({ format: BANK_FORMAT, bank: validBank, version }));
      expect((await store.getVersionedBank()).unreadable).toBe(true);
      await expect(store.putBank(validBank, 1)).rejects.toThrow(/unreadable/);
    }
    spy.mockRestore();
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
    const stored = { bank: validBank, version: 7, format: BANK_FORMAT + 1 };
    const storage = memoryStorage(stored);
    const store = new BankStore(storage);
    expect(await store.getVersionedBank()).toEqual({ bank: BANK, version: 1, unreadable: true });
    await expect(store.putBank(validBank, 1)).rejects.toThrow(/unreadable/);
    expect(await storage.get("bank")).toEqual(stored);
  });

  it("a bank with a category is stored at the category format, which code one format older refuses and keeps (rollback)", async () => {
    const categorized: Bank = { ...validBank, pools: { ...validBank.pools, 1: [{ ...validBank.pools[1][0], category: "動漫" }] } };
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 });
    await new BankStore(storage).putBank(categorized, 1);
    const stored = (await storage.get("bank")) as { format: number };
    // The category format sits two below BANK_FORMAT, since answer fields (multi-field.md) and Instagram explanations came after it.
    expect(stored.format).toBe(BANK_FORMAT - 2);
    // Code at the format before reads it as this code reads a format ahead of its own: unreadable, and a save may not replace it.
    const ahead = memoryStorage({ ...stored, format: BANK_FORMAT + 1 });
    const older = new BankStore(ahead);
    expect(await older.getVersionedBank()).toMatchObject({ unreadable: true });
    await expect(older.putBank(validBank, 1)).rejects.toThrow(/unreadable/);
    expect(await ahead.get("bank")).toEqual({ ...stored, format: BANK_FORMAT + 1 });
  });

  it("treats a format that is not a known number as unreadable too", async () => {
    for (const format of ["2", null, Number.NaN, {}]) {
      const stored = { bank: validBank, version: 7, format };
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
    const storage = memoryStorage({ format: BANK_FORMAT, bank: legacy, version: 7 });
    const store = new BankStore(storage);
    expect(await store.getVersionedBank()).toEqual({ bank: legacy, version: 7 });
    await expect(store.putBank(legacy, 7)).rejects.toThrow(/more than 4 options/);
    expect(await storage.get("bank")).toEqual({ bank: legacy, version: 7, format: BANK_FORMAT });
  });

  // Regression: boss HP had no upper bound; the big screen draws hearts up to MAX_HEARTS, then a bar, and 60 is the cap (multi-field.md E5)
  // Found by /review on 2026-10-28
  it.each([[61], [2.5]])("refuses to save a boss phase with %s HP (a whole number from 1 to 60), and keeps the stored bank", async (maxHp) => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 });
    const store = new BankStore(storage);
    const big: Bank = { ...validBank, boss: { ...validBank.boss, phases: [{ ...validBank.boss.phases[0], maxHp }] } };
    await expect(store.putBank(big, 1)).rejects.toThrow(/hp must be a whole number from 1 to 60/);
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

  // Value: protects=the big screen's phase card stays short enough to leave the new boss visible (/qa 2026-10-28 ISSUE-002);
  // fails_when=assertSavable stops checking phase name or rule length, or the bound turns into >=; why_new=parseBank accepts any length; seam=none;
  // no_claim=banks stored before this check (they still load, see the test below)
  it.each([
    ["name", { name: "名".repeat(13), rule: "規" }, /phase 2 name is over 12 characters/],
    ["rule", { name: "名", rule: "規".repeat(41) }, /phase 2 rule is over 40 characters/],
    ["name and rule at the cap", { name: "名".repeat(12), rule: "規".repeat(40) }, null],
  ])("boss phase %s: saves only within 12 / 40 characters, and keeps the stored bank on a refusal", async (_, text, refusal) => {
    const storage = memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 });
    const store = new BankStore(storage);
    const p2 = { ...text, maxHp: 1, questions: [{ kind: "text" as const, id: "p2-q1", content: { kind: "text" as const, value: "?" }, answer: "x" }] };
    const bank: Bank = { ...validBank, boss: { ...validBank.boss, phases: [validBank.boss.phases[0], p2] } };
    if (!refusal) return expect(store.putBank(bank, 1)).resolves.toMatchObject({ version: 2 });
    await expect(store.putBank(bank, 1)).rejects.toThrow(refusal);
    expect(await storage.get("bank")).toEqual({ bank: validBank, version: 1, format: BANK_FORMAT });
  });

  // Value: protects=assertSavable counts a phase name and rule after trimming, as the editor's check does (one count, not two);
  // fails_when=assertSavable counts untrimmed text; why_new=putBank trims first, so only a direct call reaches untrimmed text; seam=none; no_claim=the editor
  it("counts a boss phase name and rule after trimming, as the editor does", () => {
    const p2 = { name: `  ${"名".repeat(12)}  `, rule: ` ${"規".repeat(40)} `, maxHp: 1, questions: [] };
    expect(() => assertSavable({ ...validBank, boss: { ...validBank.boss, phases: [validBank.boss.phases[0], p2] } })).not.toThrow();
    expect(() => assertSavable({ ...validBank, boss: { ...validBank.boss, phases: [validBank.boss.phases[0], { ...p2, name: ` ${"名".repeat(13)} ` }] } })).toThrow(/name is over 12/);
  });

  // Value: protects=a bank stored before the phase caps still loads (else rooms fall back to the bundled bank); fails_when=the cap moves into parseBank;
  // why_new=the rows above only test saving; seam=none; no_claim=the editor's own save check
  it("still loads a stored bank whose boss phase name and rule are over the caps", async () => {
    const p2 = { name: "名".repeat(25), rule: "規".repeat(60), maxHp: 1, questions: [{ kind: "text" as const, id: "p2-q1", content: { kind: "text" as const, value: "?" }, answer: "x" }] };
    const old: Bank = { ...validBank, boss: { ...validBank.boss, phases: [validBank.boss.phases[0], p2] } };
    const store = new BankStore(memoryStorage({ format: BANK_FORMAT, bank: old, version: 1 }));
    expect((await store.getVersionedBank()).bank.boss.phases[1].name).toBe("名".repeat(25));
  });

  // Value: protects=60 HP, the documented top (multi-field.md E5), still saves; fails_when=the bound turns into >= or MAX_BOSS_HP drops;
  // why_new=the rows above only test refusals; seam=none; no_claim=the editor's own input limits (e2e)
  it("saves a boss phase with exactly 60 HP", async () => {
    const store = new BankStore(memoryStorage({ format: BANK_FORMAT, bank: validBank, version: 1 }));
    const top: Bank = { ...validBank, boss: { ...validBank.boss, phases: [{ ...validBank.boss.phases[0], maxHp: 60 }] } };
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
    const { store, storage, alarms, onImagesOrphaned, at } = setup({ format: BANK_FORMAT, bank: { rooms: "a format this version can't read" }, version: 7 });
    await storage.put("pendingImageDeletes", [{ key: KEY, deleteAt: 0 }]);
    at(DELAY);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await store.runImageCleanup();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("image_cleanup_deferred"));
    err.mockRestore();
    warn.mockRestore();
    expect(onImagesOrphaned).not.toHaveBeenCalled();
    expect(await storage.get("pendingImageDeletes")).toEqual([{ key: KEY, deleteAt: 0 }]);
    expect(alarms).toEqual([2 * DELAY]); // re-armed, so the queue is not stranded once the bank is readable again

    // Readable again (a roll-forward): the re-armed alarm finishes the job.
    // pregate-literal: BANK_FORMAT=4 the 4 is the bank's save version, not its format
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

  it("refuses a save that puts back an image while its delete is in flight, and accepts saves again once it is done", async () => {
    const { store, onImagesOrphaned, at } = setup();
    let finishDelete = () => {};
    onImagesOrphaned.mockImplementationOnce(() => new Promise<void>((resolve) => (finishDelete = resolve)));
    await store.putBank(validBank, 1);
    at(DELAY);
    const cleanup = store.runImageCleanup();
    await vi.waitFor(() => expect(onImagesOrphaned).toHaveBeenCalledWith([KEY]));
    // The R2 delete is awaiting: a stale editor tab saves the image back in.
    await expect(store.putBank(bankWithImage, 2)).rejects.toThrow(KEY);
    await expect(store.putBank(validBank, 2)).resolves.toMatchObject({ version: 3 }); // other saves still work
    finishDelete();
    await cleanup;
    // Released once the delete is done (a re-upload under the same key is not possible in production; this checks the set is cleared).
    await expect(store.putBank(bankWithImage, 3)).resolves.toMatchObject({ version: 4 });
  });

  it("releases the in-flight keys when the delete fails, even with a synchronous throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, onImagesOrphaned, at } = setup();
    onImagesOrphaned.mockImplementationOnce(() => {
      throw new Error("R2 binding broke");
    });
    await store.putBank(validBank, 1);
    at(DELAY);
    await expect(store.runImageCleanup()).resolves.toBeUndefined();
    await expect(store.putBank(bankWithImage, 2)).resolves.toMatchObject({ version: 3 });
    spy.mockRestore();
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
    expect(formatOf(sorted)).toBe(4);
    // A buzzer phase (boss-buzzer.md) is what format-4 code would drop: it stores at 5.
    const buzzer = { ...sorted, boss: { ...validBank.boss, phases: [...validBank.boss.phases, { name: "搶答", rule: "聽前奏搶答", maxHp: 1, buzzer: true as const, questions: [{ kind: "text" as const, id: "z1", content: { kind: "text" as const, value: "聽" }, answer: "歌" }] }] } };
    expect(formatOf(buzzer)).toBe(5);
    // A question category (boss-music-buzzer.md) is what format-5 code would drop: it stores at 6.
    expect(formatOf({ ...buzzer, pools: { ...buzzer.pools, 1: [{ ...buzzer.pools[1][0], category: "動漫" }] } })).toBe(6); // pregate-literal: BANK_FORMAT=6 a category bank stays at format 6
    // A music question's answer fields (multi-field.md) are what format-6 code would drop: they store at 7.
    const fields = [{ label: "歌名", answer: "A" }, { label: "歌手", answer: "B" }];
    expect(formatOf({ ...buzzer, pools: { ...buzzer.pools, 1: [{ kind: "text" as const, id: "f1", content: { kind: "text" as const, value: "聽" }, answer: "A／B", fields }] } })).toBe(7); // pregate-literal: BANK_FORMAT=7 a fields bank stays at format 7
    // An Instagram explanation (instagram-explanations.md) is what format-7 code cannot parse: it stores at 8.
    expect(formatOf({ ...buzzer, pools: { ...buzzer.pools, 1: [{ kind: "text" as const, id: "i1", content: { kind: "text" as const, value: "看" }, answer: "A", explanation: { kind: "instagram" as const, value: "DPPHHjlkTgr" } }] } })).toBe(BANK_FORMAT);
    const storage = memoryStorage({ format: 3, bank: validBank, version: 1 }); // pregate-literal: BANK_FORMAT=3 a format-3 bank on purpose
    await new BankStore(storage).putBank(sorted, 1);
    expect(await storage.get("bank")).toMatchObject({ version: 2, format: 4 });
  });

  it("still reads a format-3 bank as is", async () => {
    expect(await new BankStore(memoryStorage({ bank: validBank, version: 5, format: 3 })).getVersionedBank()).toEqual({ bank: validBank, version: 5 }); // pregate-literal: BANK_FORMAT=3 a format-3 bank on purpose
  });

  it("a bank stored at format 4 (before the buzzer phase) still loads as itself, not outdated", async () => {
    const got = await new BankStore(memoryStorage({ bank: validBank, version: 3, format: 4 })).getVersionedBank();
    expect(got.outdated).toBeUndefined();
    expect(got.unreadable).toBeUndefined();
    expect(got.version).toBe(3);
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await new BankStore(storage, onImagesOrphaned, { now: () => 5, cleanupDelayMs: 100 }).runImageCleanup();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"reason":"outdated"'));
    warn.mockRestore();
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
