// The question bank's persistent home: owner-editable, backed by one Durable Object.
//
// Platform-agnostic on purpose (same split as dungeon-room.ts): this file knows nothing about
// Cloudflare. worker/index.ts's BankStoreDO wires it to a real Durable Object and exposes it
// over RPC to the Worker's own fetch handler and to Room.onStart() (never over HTTP directly —
// see lib/gate.ts's header comment on why a new DO binding must not be reachable at
// /parties/<binding>/<id>).
//
//   BankStore.getVersionedBank()                   BankStore.putBank(candidate, expectedVersion)
//     │                                              ├─ stored bank unreadable (see left)? ─throws─>
//     │                                              │    nothing saved: the fallback is not what's stored
//     ├─ storage empty? ─yes─> seed from              ├─ expectedVersion !== stored.version?
//     │                        bundled JSON, v1              └─returns {conflict, currentVersion}─>
//     │         │                                              (nothing saved — see decision below)
//     │         └─> store it, return it                 ├─ parseBank(candidate) ─throws─>
//     ├─ storage has a value                                    caller sees the error, nothing saved
//     │    ├─ parseBank(raw.bank) ok  ─> return it        ↓ ok
//     │    └─ throws (corrupt storage) ─> log it,   store {bank, version: version+1}, return it
//     │        fall back to the bundled bank, v1
//     │        (never crash the caller — a room starting
//     │        a game must still be able to get a bank)
//     │        Saves and image cleanup refuse in this state (e.g. after a rollback below a newer
//     │        bank format); a roll-forward or a fixed stored bank is the way out.
//
// Why a version at all: two editor tabs (or a save racing a fresh load) both PUT-ing the whole
// bank is a last-write-wins clobber with no error and no trace — the first tab's edits just
// vanish. `version` turns that into a loud, recoverable 409 instead of a silent loss (adversarial
// review, 2026-09-22).
//
// Orphaned images (R2 keys the new bank no longer references) are queued in storage, not deleted
// on save: rooms copy the bank when they start, so a game in progress may still show an image
// the owner just replaced. The Durable Object alarm calls runImageCleanup() once they have waited
// out the room expiry (TODOS.md P2, fixed 2026-09-29). Fresh uploads join the same queue
// (queueUploadedImage), so one the editor never saves is deleted too.

import { BANK } from "./question-bank-data";
import { allQuestions, assertSavable, parseBank, imageKeysOf, type Bank } from "./question-bank";
import type { RoomStorage } from "./room/io";

const BANK_KEY = "bank";
/** The stored bank as it was before a save overwrote an outdated one: the owner's backup if they missed docs/question-bank.md's. */
const LEGACY_BANK_KEY = "legacyBank";
/** The stored bank's format. Bump it when older code reading a newly saved bank would lose data on
 * its next save (e.g. a new field its parseBank drops): older code sees a higher number, treats the
 * stored bank as unreadable and refuses to save. A stored bank without one is format 1. */
export const BANK_FORMAT = 7;
/** A stored format older than this is not parsed (format 2 names whole monsters, format 3 catalog ids;
 * docs/designs/monster-catalog.md §5): the bundled bank comes back `outdated` with the stored version, and a
 * save may overwrite it. Format 4 only added sort questions, so format 3 still reads as is. */
const OLDEST_PARSED_FORMAT = 3;
/** The format that added sort questions. */
const SORT_FORMAT = 4;
/** The format that added buzzer phases (boss-buzzer.md). */
const BUZZER_FORMAT = 5;
/** The format that added question categories (boss-music-buzzer.md). */
const CATEGORY_FORMAT = 6;
/** The format a bank is stored at: the oldest whose code keeps everything in it. 7 for a music question's answer fields
 * (multi-field.md), 6 for a question category (boss-music-buzzer.md), 5 for a buzzer phase (boss-buzzer.md), 4 for a sort question, else 3, so a rollback to the
 * previous version still reads it (/review, 2026-11-07). */
export const formatOf = (bank: Bank): number =>
  allQuestions(bank).some((q) => q.kind === "text" && q.fields) ? BANK_FORMAT : allQuestions(bank).some((q) => q.category) ? CATEGORY_FORMAT : bank.boss.phases.some((p) => p.buzzer) ? BUZZER_FORMAT : allQuestions(bank).some((q) => q.kind === "sort") ? SORT_FORMAT : OLDEST_PARSED_FORMAT;
/** R2 keys the bank stopped referencing, waiting out `cleanupDelayMs` before they're deleted. */
const PENDING_KEY = "pendingImageDeletes";
/** Default wait before an orphaned image is deleted: a room's longest life (24 hours with every extension) plus an
 * hour of margin. worker/index.ts passes the real one (roomMaxLifeMs) + the same margin. */
export const IMAGE_CLEANUP_MARGIN_MS = 60 * 60 * 1000;
const DEFAULT_CLEANUP_DELAY_MS = 24 * 60 * 60 * 1000 + IMAGE_CLEANUP_MARGIN_MS;
/** How long the images of an overwritten outdated bank wait instead: the owner may still convert the
 * backup and save it back, or roll back to it (docs/designs/monster-catalog.md §6). */
export const LEGACY_IMAGE_DELAY_MS = 14 * 24 * 60 * 60 * 1000;

/** The subset of Durable Object storage BankStore needs. `setAlarm` schedules the alarm whose handler
 * calls `runImageCleanup()`; without it the queue is still kept, and cleanup only happens when
 * something calls `runImageCleanup()`. */
export type BankStorage = Pick<RoomStorage, "get" | "put" | "setAlarm">;

interface PendingDelete {
  key: string;
  deleteAt: number;
}

export interface VersionedBank {
  bank: Bank;
  /** Starts at 1 on first seed, increments by 1 on every successful save. */
  version: number;
  /** Set when the stored bank can't be read by this version: `bank` is then the bundled fallback,
   * and saves and uploads are refused (docs/question-bank.md 「題庫卡住時怎麼救」). */
  unreadable?: true;
  /** Set to the stored format when it is older than BANK_FORMAT: `bank` is then the bundled default,
   * `version` the stored one, and a save overwrites the old bank (docs/designs/monster-catalog.md §5). */
  outdated?: number;
}

/** Returned by `putBank` when `expectedVersion` doesn't match what's actually stored — someone
 * else's save landed first. The caller's edits are NOT saved; `currentVersion` lets a client
 * decide whether to reload and retry. Returned, not thrown: an error's class identity does not
 * survive the Durable Object RPC boundary (verified live against wrangler dev), a plain object does. */
export interface BankConflict {
  conflict: true;
  currentVersion: number;
}

export class BankStore {
  private cleanupDelayMs: number;
  private now: () => number;
  /** Keys runImageCleanup is deleting right now: R2 I/O lets a save run in between, and it must not put one back. */
  private deleting = new Set<string>();

  /** `onImagesOrphaned`: deletes R2 objects the bank no longer references — see
   * docs/designs/image-question-type.md's "R2 cleanup mechanism" decision. It is NOT called at save
   * time: every room in progress plays from its own copy of the bank, so an image the new bank dropped
   * may still be on screen in a running game. putBank only queues the key; `runImageCleanup()` (the
   * Durable Object alarm) deletes it once `cleanupDelayMs` has passed, i.e. once every room that could
   * have copied the old bank has expired. Best-effort: a failed delete is wasted storage, not data loss. */
  constructor(
    private storage: BankStorage,
    private onImagesOrphaned?: (keys: string[]) => Promise<void>,
    opts: { cleanupDelayMs?: number; now?: () => number } = {},
  ) {
    this.cleanupDelayMs = opts.cleanupDelayMs ?? DEFAULT_CLEANUP_DELAY_MS;
    this.now = opts.now ?? Date.now;
  }

  private async getPending(): Promise<PendingDelete[]> {
    const raw = await this.storage.get(PENDING_KEY);
    return Array.isArray(raw) ? (raw as PendingDelete[]) : [];
  }

  /** Saves the queue and points the alarm at its earliest entry. */
  private async setPending(pending: PendingDelete[]): Promise<void> {
    await this.storage.put(PENDING_KEY, pending);
    if (pending.length > 0) await this.storage.setAlarm?.(Math.min(...pending.map((p) => p.deleteAt)));
  }

  /** Queues a just-uploaded image for deletion, as if a save had orphaned it. Once a save puts it in
   * the bank, runImageCleanup() finds it in use and drops it from the queue; an upload that never
   * makes it into a saved bank (tab closed, browser crash, a 409 on save) is deleted when the wait
   * is over, instead of sitting in R2 forever. */
  async queueUploadedImage(key: string): Promise<void> {
    const pending = (await this.getPending()).filter((p) => p.key !== key);
    await this.setPending([...pending, { key, deleteAt: this.now() + this.cleanupDelayMs }]);
  }

  /** Deletes every queued image whose wait is over, unless a later save put it back in the bank
   * (an undo, or the same image re-added). Called by the Durable Object alarm; re-arms the alarm for
   * whatever is still waiting. */
  async runImageCleanup(): Promise<void> {
    const pending = await this.getPending();
    if (pending.length === 0) return;
    const now = this.now();
    const { current, unreadable, outdated } = await this.read();
    // The fallback bank is not what's stored: deleting by it would drop images the stored bank still uses.
    // Try again later; this alarm is spent, and the queue would otherwise wait for the next save or upload.
    if (unreadable || outdated) {
      console.warn(JSON.stringify({ event: "image_cleanup_deferred", reason: unreadable ? "unreadable" : "outdated", pending: pending.length }));
      return void (await this.storage.setAlarm?.(now + this.cleanupDelayMs));
    }
    const inUse = imageKeysOf(current.bank);
    const due = pending.filter((p) => p.deleteAt <= now && !inUse.has(p.key)).map((p) => p.key);
    // Back in the bank: drop it from the queue; the save that removes it again re-queues it.
    await this.setPending(pending.filter((p) => p.deleteAt > now && !inUse.has(p.key)));
    if (due.length > 0 && this.onImagesOrphaned) {
      for (const k of due) this.deleting.add(k);
      await this.onImagesOrphaned(due)
        .catch((err: unknown) => {
          console.error(JSON.stringify({ event: "image_cleanup_failed", keys: due, error: String(err) }));
        })
        .finally(() => due.forEach((k) => this.deleting.delete(k)));
    }
  }

  /** The current bank plus its version. The editor round-trips the version on save so a
   * conflicting concurrent save is caught instead of silently overwritten. */
  async getVersionedBank(): Promise<VersionedBank> {
    const { current, unreadable, outdated } = await this.read();
    return unreadable ? { ...current, unreadable: true } : outdated ? { ...current, outdated: outdated.format } : current;
  }

  private async read(): Promise<{ current: VersionedBank; unreadable: boolean; outdated?: { format: number; raw: unknown } }> {
    const raw = await this.storage.get(BANK_KEY);
    if (raw === undefined) {
      const seeded: VersionedBank = { bank: BANK, version: 1 };
      await this.storage.put(BANK_KEY, { ...seeded, format: formatOf(BANK) });
      return { current: seeded, unreadable: false };
    }
    try {
      const r = raw as { bank?: unknown; version?: unknown; format?: unknown };
      // Fails closed: anything but a missing format or one this code knows could be a newer writer's.
      if (r.format !== undefined && !(typeof r.format === "number" && r.format <= BANK_FORMAT)) throw new Error(`stored bank format ${String(r.format)} is not one this version (${BANK_FORMAT}) can read`);
      const format = (r.format as number | undefined) ?? 1;
      // A missing version is a pre-version save (1); any other non-integer is corrupt, not 1 (a save at 1 would overwrite it).
      const version = r.version === undefined ? 1 : r.version;
      if (!Number.isSafeInteger(version)) throw new Error(`stored bank version ${String(r.version)} is not an integer`);
      if (format < OLDEST_PARSED_FORMAT) return { current: { bank: BANK, version: version as number }, unreadable: false, outdated: { format, raw: r.bank } };
      return { current: { bank: parseBank(r.bank), version: version as number }, unreadable: false };
    } catch (err) {
      // Corrupt storage must not crash whatever called this (a room trying to start a game, the
      // editor trying to load) — same class of defensive fallback as dungeon-room.ts's restore().
      console.error(JSON.stringify({ event: "bank_store_corrupt", error: String(err) }));
      return { current: { bank: BANK, version: 1 }, unreadable: true };
    }
  }

  /** Validates and replaces the whole bank atomically, but only if `expectedVersion` still
   * matches what's stored. Returns a `BankConflict` on a stale version, throws when the stored bank
   * is unreadable (nothing may overwrite it) or parseBank's error on invalid input — either way
   * nothing is saved, the previous bank stands. */
  async putBank(candidate: unknown, expectedVersion: number): Promise<VersionedBank | BankConflict> {
    const { current, unreadable, outdated } = await this.read();
    // The fallback bank is not what's stored (e.g. a rollback to code that can't read a newer
    // format): saving it at version 1 would overwrite every custom question.
    if (unreadable) throw new Error("stored bank is unreadable by this version; refusing to overwrite it");
    if (current.version !== expectedVersion) return { conflict: true, currentVersion: current.version };
    const validated = parseBank(candidate);
    assertSavable(validated);
    const gone = [...imageKeysOf(validated)].filter((k) => this.deleting.has(k));
    if (gone.length > 0) throw new Error(`圖片已過期、正在刪除，請重新上傳：${gone.join(", ")}`);
    const next: VersionedBank = { bank: validated, version: current.version + 1 };
    if (outdated) await this.storage.put(LEGACY_BANK_KEY, { bank: outdated.raw, format: outdated.format, version: current.version });
    await this.storage.put(BANK_KEY, { ...next, format: formatOf(validated) });
    // An outdated bank was never parsed: its images come from walking the raw stored value.
    const oldKeys = outdated ? legacyImageKeys(outdated.raw) : imageKeysOf(current.bank);
    const newKeys = imageKeysOf(validated);
    const orphaned = [...oldKeys].filter((k) => !newKeys.has(k));
    if (orphaned.length > 0) {
      // Queued, not deleted: a room mid-game may still show this image (see the constructor's comment).
      // A key that was already queued gets the new, later deleteAt: it may have been put back in
      // between, and a room started since then holds it too.
      const again = new Set(orphaned);
      const deleteAt = this.now() + (outdated ? Math.max(this.cleanupDelayMs, LEGACY_IMAGE_DELAY_MS) : this.cleanupDelayMs);
      const pending = (await this.getPending()).filter((p) => !again.has(p.key));
      await this.setPending([...pending, ...orphaned.map((key) => ({ key, deleteAt }))]);
    }
    return next;
  }
}

/** Every `value` of a `kind: "image"` object anywhere in `raw`: the images of a stored bank too old to
 * parse. Other shapes are skipped, never thrown on. */
export function legacyImageKeys(raw: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(raw)) for (const v of raw) legacyImageKeys(v, keys);
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.kind === "image" && typeof o.value === "string" && o.value) keys.add(o.value);
    for (const v of Object.values(o)) legacyImageKeys(v, keys);
  }
  return keys;
}
