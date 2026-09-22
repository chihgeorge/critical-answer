// The question bank's persistent home: owner-editable, backed by one Durable Object.
//
// Platform-agnostic on purpose (same split as dungeon-room.ts): this file knows nothing about
// Cloudflare. worker/index.ts's BankStoreDO wires it to a real Durable Object and exposes it
// over RPC to the Worker's own fetch handler and to Room.onStart() (never over HTTP directly —
// see lib/gate.ts's header comment on why a new DO binding must not be reachable at
// /parties/<binding>/<id>).
//
//   BankStore.getBank()                    BankStore.putBank(candidate)
//     │                                       │
//     ├─ storage empty? ─yes─> seed from       ├─ parseBank(candidate) ─throws─> caller sees the error
//     │                        bundled JSON            │                        (bank left unchanged)
//     │         │                                       ↓ ok
//     │         └─> store it, return it            store it, return the validated bank
//     ├─ storage has a value
//     │    ├─ parseBank(raw) ok  ─> return it
//     │    └─ parseBank(raw) throws (corrupt storage) ─> log it, fall back to the bundled bank
//     │                                                   (never crash the caller — a room starting
//     │                                                   a game must still be able to get a bank)

import bankJson from "../data/question-bank.json";
import { parseBank, type Bank } from "./question-bank";

const BANK_KEY = "bank";

/** The subset of Durable Object storage BankStore needs. Same shape as RoomStorage's get/put. */
export interface BankStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): void | Promise<void>;
}

export class BankStore {
  constructor(private storage: BankStorage) {}

  /** The current bank. Seeds itself from the bundled JSON on the very first call (empty storage) — no
   * separate migration step to remember at deploy time. */
  async getBank(): Promise<Bank> {
    const raw = await this.storage.get(BANK_KEY);
    if (raw === undefined) {
      const seeded = parseBank(bankJson);
      await this.storage.put(BANK_KEY, seeded);
      return seeded;
    }
    try {
      return parseBank(raw);
    } catch (err) {
      // Corrupt storage must not crash whatever called this (a room trying to start a game, the
      // editor trying to load) — same class of defensive fallback as dungeon-room.ts's restore().
      console.error(JSON.stringify({ event: "bank_store_corrupt", error: String(err) }));
      return parseBank(bankJson);
    }
  }

  /** Validates and replaces the whole bank atomically. Throws on invalid input — nothing is saved,
   * the previous bank stands, so a bad edit never leaves the store half-written. */
  async putBank(candidate: unknown): Promise<Bank> {
    const validated = parseBank(candidate);
    await this.storage.put(BANK_KEY, validated);
    return validated;
  }
}
