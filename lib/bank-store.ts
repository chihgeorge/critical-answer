// The question bank's persistent home: owner-editable, backed by one Durable Object.
//
// Platform-agnostic on purpose (same split as dungeon-room.ts): this file knows nothing about
// Cloudflare. worker/index.ts's BankStoreDO wires it to a real Durable Object and exposes it
// over RPC to the Worker's own fetch handler and to Room.onStart() (never over HTTP directly —
// see lib/gate.ts's header comment on why a new DO binding must not be reachable at
// /parties/<binding>/<id>).
//
//   BankStore.getBank() / getVersionedBank()      BankStore.putBank(candidate, expectedVersion)
//     │                                              │
//     ├─ storage empty? ─yes─> seed from              ├─ expectedVersion !== stored.version?
//     │                        bundled JSON, v1              └─throws BankConflictError─>
//     │         │                                              (nothing saved — see decision below)
//     │         └─> store it, return it                 ├─ parseBank(candidate) ─throws─>
//     ├─ storage has a value                                    caller sees the error, nothing saved
//     │    ├─ parseBank(raw.bank) ok  ─> return it        ↓ ok
//     │    └─ throws (corrupt storage) ─> log it,   store {bank, version: version+1}, return it
//     │        fall back to the bundled bank, v1
//     │        (never crash the caller — a room starting
//     │        a game must still be able to get a bank)
//
// Why a version at all: two editor tabs (or a save racing a fresh load) both PUT-ing the whole
// bank is a last-write-wins clobber with no error and no trace — the first tab's edits just
// vanish. `version` turns that into a loud, recoverable 409 instead of a silent loss (adversarial
// review, 2026-09-22).

import bankJson from "../data/question-bank.json";
import { parseBank, imageKeysOf, type Bank } from "./question-bank";

const BANK_KEY = "bank";

/** The subset of Durable Object storage BankStore needs. Same shape as RoomStorage's get/put. */
export interface BankStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): void | Promise<void>;
}

export interface VersionedBank {
  bank: Bank;
  /** Starts at 1 on first seed, increments by 1 on every successful save. */
  version: number;
}

/** Thrown by `putBank` when `expectedVersion` doesn't match what's actually stored — someone
 * else's save landed first. The caller's edits are NOT saved; `currentVersion` lets a client
 * decide whether to reload and retry. */
export class BankConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super("Bank was changed by someone else since you loaded it. Reload and try again.");
  }
}

export class BankStore {
  /** `onImagesOrphaned`: called with any R2 object key that was referenced by the previous bank
   * but not the newly-saved one, after a successful putBank — see docs/designs/image-question-type.md's
   * "R2 cleanup mechanism" decision. Optional and best-effort: a failure here must never fail the
   * save itself (the bank write already succeeded; a missed cleanup is wasted storage, not data loss). */
  constructor(
    private storage: BankStorage,
    private onImagesOrphaned?: (keys: string[]) => Promise<void>,
  ) {}

  private async getStored(): Promise<VersionedBank> {
    const raw = await this.storage.get(BANK_KEY);
    if (raw === undefined) {
      const seeded: VersionedBank = { bank: parseBank(bankJson), version: 1 };
      await this.storage.put(BANK_KEY, seeded);
      return seeded;
    }
    try {
      const r = raw as { bank?: unknown; version?: unknown };
      return { bank: parseBank(r.bank), version: typeof r.version === "number" ? r.version : 1 };
    } catch (err) {
      // Corrupt storage must not crash whatever called this (a room trying to start a game, the
      // editor trying to load) — same class of defensive fallback as dungeon-room.ts's restore().
      console.error(JSON.stringify({ event: "bank_store_corrupt", error: String(err) }));
      return { bank: parseBank(bankJson), version: 1 };
    }
  }

  /** The current bank only — for callers that don't need to detect conflicts (Room.onStart()'s
   * bank-fetch-with-fallback; a room's own snapshot is the source of truth after that anyway). */
  async getBank(): Promise<Bank> {
    return (await this.getStored()).bank;
  }

  /** The current bank plus its version, for the editor: round-trip the version on save so a
   * conflicting concurrent save is caught instead of silently overwritten. */
  async getVersionedBank(): Promise<VersionedBank> {
    return this.getStored();
  }

  /** Validates and replaces the whole bank atomically, but only if `expectedVersion` still
   * matches what's stored. Throws `BankConflictError` on a stale version, or parseBank's error on
   * invalid input — either way nothing is saved, the previous bank stands. */
  async putBank(candidate: unknown, expectedVersion: number): Promise<VersionedBank> {
    const current = await this.getStored();
    if (current.version !== expectedVersion) throw new BankConflictError(current.version);
    const validated = parseBank(candidate);
    const next: VersionedBank = { bank: validated, version: current.version + 1 };
    await this.storage.put(BANK_KEY, next);
    if (this.onImagesOrphaned) {
      const oldKeys = imageKeysOf(current.bank);
      const newKeys = imageKeysOf(validated);
      const orphaned = [...oldKeys].filter((k) => !newKeys.has(k));
      if (orphaned.length > 0) {
        // Best-effort AND fire-and-forget: the bank write above already succeeded, so a cleanup
        // failure here is wasted R2 storage, never data loss — and awaiting it would make every
        // save that touches images wait on an R2 round trip that doesn't participate in the
        // Durable Object's storage input-gate, needlessly delaying the caller's response and
        // any concurrent request queued behind this one (adversarial review finding). The
        // worker/index.ts caller wraps this in ctx.waitUntil() so it survives past this
        // function's return instead of being cut off. This .catch is a defensive fallback for a
        // badly-behaved injected callback (one that rejects before reaching its own try/catch) —
        // worker/index.ts's real R2 delete failures are already caught and logged inside
        // lib/image-cleanup.ts's deleteOrphanedImages, so this rarely fires in production
        // (adversarial review finding: the comment previously implied otherwise).
        void this.onImagesOrphaned(orphaned).catch((err: unknown) => {
          console.error(JSON.stringify({ event: "image_cleanup_failed", keys: orphaned, error: String(err) }));
        });
      }
    }
    return next;
  }
}
