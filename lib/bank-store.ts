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
import { allQuestions, assertSavable, bossQuestions, parseBank, imageKeysOf, type Bank } from "./question-bank";
import type { RoomStorage } from "./room/io";
import { DEFAULT_BANK_ENTRY } from "./protocol";
import { BANK_NOT_FOUND } from "./bank-api";

/** The default bank's id. It keeps the storage keys every deploy before multi-bank used ("bank", "legacyBank"),
 * so an upgrade reads the same stored bank and old callers without an id get it (docs/designs/multi-bank.md). */
export const DEFAULT_BANK_ID = DEFAULT_BANK_ENTRY.id;
export const DEFAULT_BANK_NAME = DEFAULT_BANK_ENTRY.name;
/** The owner's own banks (not the default), in the order they were made. */
const INDEX_KEY = "banks";
export const MAX_CUSTOM_BANKS = 20;
export const MAX_BANK_NAME = 30;
export { BANK_NOT_FOUND };
const bankKey = (id: string) => (id === DEFAULT_BANK_ID ? "bank" : `bank:${id}`);
/** The stored bank as it was before a save overwrote an outdated one: the owner's backup if they missed docs/question-bank.md's. */
const legacyKey = (id: string) => (id === DEFAULT_BANK_ID ? "legacyBank" : `legacyBank:${id}`);

/** A new 「空白」 bank: the least a bank needs to save (one room with one question, a boss with one), as examples to edit. */
export const BLANK_BANK: Bank = {
  pools: { 1: [{ kind: "text", id: "r0-q1", content: { kind: "text", value: "範例題：1 + 1 = ?" }, answer: "2" }], 2: [], 3: [], 4: [], 5: [] },
  rooms: [{ monster: "slime-soft", difficulty: 1, reward: 10 }],
  boss: { monster: "dragon", hitReward: 10, phases: [{ name: "", rule: "", maxHp: 10, questions: [{ kind: "text", id: "b-q1", content: { kind: "text", value: "範例魔王題：2 + 2 = ?" }, answer: "4" }] }] },
};

export interface BankEntry {
  id: string;
  name: string;
}
/** The stored bank's format. Bump it when older code reading a newly saved bank would lose data on
 * its next save (e.g. a new field its parseBank drops): older code sees a higher number, treats the
 * stored bank as unreadable and refuses to save. A stored bank without one is format 1. */
export const BANK_FORMAT = 11;
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
/** The format that added a music question's answer fields (multi-field.md). */
const FIELDS_FORMAT = 7;
/** The format that added Instagram explanations (instagram-explanations.md). */
const INSTAGRAM_FORMAT = 8;
/** The format that added a boss question's own difficulty. */
const DIFFICULTY_FORMAT = 9;
/** The format that added uploaded video/audio (uploaded-media.md). */
const MEDIA_FORMAT = 10;
/** The format that added timing questions (timing-tap.md). */
const TIMING_FORMAT = 11;
const isUpload = (c: { kind: string } | undefined) => c?.kind === "video" || c?.kind === "audio";
/** The format a bank is stored at: the oldest whose code keeps everything in it. 11 for a timing question, 10 for an uploaded video/audio, 9 for a boss question's own
 * difficulty, 8 for an Instagram explanation
 * (instagram-explanations.md), 7 for a music question's answer fields
 * (multi-field.md), 6 for a question category (boss-music-buzzer.md), 5 for a buzzer phase (boss-buzzer.md), 4 for a sort question, else 3, so a rollback to the
 * previous version still reads it (/review, 2026-11-07). */
export const formatOf = (bank: Bank): number =>
  allQuestions(bank).some((q) => q.kind === "timing") ? TIMING_FORMAT : allQuestions(bank).some((q) => isUpload(q.content) || isUpload(q.explanation)) ? MEDIA_FORMAT : bossQuestions(bank).some((q) => q.difficulty !== undefined) ? DIFFICULTY_FORMAT : allQuestions(bank).some((q) => q.explanation?.kind === "instagram") ? INSTAGRAM_FORMAT : allQuestions(bank).some((q) => q.kind === "text" && q.fields) ? FIELDS_FORMAT : allQuestions(bank).some((q) => q.category) ? CATEGORY_FORMAT : bank.boss.phases.some((p) => p.buzzer) ? BUZZER_FORMAT : allQuestions(bank).some((q) => q.kind === "sort") ? SORT_FORMAT : OLDEST_PARSED_FORMAT;
/** R2 keys the banks stopped referencing, waiting out `cleanupDelayMs` before they're deleted. A new key since
 * multi-bank: code from before it reads only the default bank, so after a rollback it would delete files only a
 * custom bank uses. It never sees this queue (a leak instead of a loss); the old key is still read and merged. */
const PENDING_KEY = "pendingMediaDeletes";
const OLD_PENDING_KEY = "pendingImageDeletes";
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
export type BankStorage = Pick<RoomStorage, "get" | "put" | "setAlarm"> & { delete(key: string): unknown };

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
    const list = (raw: unknown) => (Array.isArray(raw) ? (raw as PendingDelete[]) : []);
    const now = list(await this.storage.get(PENDING_KEY));
    const queued = new Set(now.map((p) => p.key));
    return [...now, ...list(await this.storage.get(OLD_PENDING_KEY)).filter((p) => !queued.has(p.key))];
  }

  /** Saves the queue and points the alarm at its earliest entry. */
  private async setPending(pending: PendingDelete[]): Promise<void> {
    await this.storage.put(PENDING_KEY, pending);
    await this.storage.delete(OLD_PENDING_KEY);
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
    // Every bank counts: a file one bank dropped may still be in another (a copy shares its files).
    const banks = await Promise.all((await this.listBanks()).map((b) => this.read(b.id)));
    const stuck = banks.find((b) => b.unreadable || b.outdated);
    // The fallback bank is not what's stored: deleting by it would drop images the stored bank still uses.
    // Try again later; this alarm is spent, and the queue would otherwise wait for the next save or upload.
    if (stuck) {
      const bankIds = (await this.listBanks()).filter((_, i) => banks[i].unreadable || banks[i].outdated).map((b) => b.id);
      console.warn(JSON.stringify({ event: "image_cleanup_deferred", reason: stuck.unreadable ? "unreadable" : "outdated", bankIds, pending: pending.length }));
      return void (await this.storage.setAlarm?.(now + this.cleanupDelayMs));
    }
    const inUse = new Set(banks.flatMap((b) => [...imageKeysOf(b.current.bank)]));
    const due = pending.filter((p) => p.deleteAt <= now && !inUse.has(p.key)).map((p) => p.key);
    // Marked before the next await, so the guard does not depend on which awaits let a save in.
    for (const k of due) this.deleting.add(k);
    try {
      // Back in the bank: drop it from the queue; the save that removes it again re-queues it.
      await this.setPending(pending.filter((p) => p.deleteAt > now && !inUse.has(p.key)));
      if (due.length > 0 && this.onImagesOrphaned) {
        try {
          await this.onImagesOrphaned(due);
        } catch (err) {
          console.error(JSON.stringify({ event: "image_cleanup_failed", keys: due, error: String(err) }));
        }
      }
    } finally {
      for (const k of due) this.deleting.delete(k);
    }
  }

  /** A bank plus its version (the default bank without an id). The editor round-trips the version on save so a
   * conflicting concurrent save is caught instead of silently overwritten. Throws BANK_NOT_FOUND for an unknown id. */
  async getVersionedBank(id: string = DEFAULT_BANK_ID): Promise<VersionedBank> {
    const { current, unreadable, outdated } = await this.read(id);
    return unreadable ? { ...current, unreadable: true } : outdated ? { ...current, outdated: outdated.format } : current;
  }

  private async customBanks(): Promise<BankEntry[]> {
    const raw = await this.storage.get(INDEX_KEY);
    return Array.isArray(raw) ? (raw as BankEntry[]) : [];
  }

  /** Every bank's id and name, the default first. Names only: safe to show a host. */
  async listBanks(): Promise<BankEntry[]> {
    return [{ id: DEFAULT_BANK_ID, name: DEFAULT_BANK_NAME }, ...(await this.customBanks())];
  }

  private async checkName(name: unknown, exceptId?: string): Promise<string> {
    const n = typeof name === "string" ? name.trim() : "";
    if (!n) throw new Error("題庫名稱不能空白");
    if (Array.from(n).length > MAX_BANK_NAME) throw new Error(`題庫名稱最多 ${MAX_BANK_NAME} 個字`);
    if ((await this.listBanks()).some((b) => b.name === n && b.id !== exceptId)) throw new Error(`已經有叫「${n}」的題庫`);
    return n;
  }

  private async customIndex(id: string): Promise<{ list: BankEntry[]; i: number }> {
    const list = await this.customBanks();
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) throw new Error(id === DEFAULT_BANK_ID ? "預設題庫不能改名或刪除" : `${BANK_NOT_FOUND}: ${id}`);
    return { list, i };
  }

  /** A new custom bank at version 1: a copy of bank `copyFrom`, else `blank`. Its files are in use by the copied bank
   * already, so nothing joins the cleanup queue. */
  async createBank(name: unknown, copyFrom: string | undefined, blank: Bank = BLANK_BANK): Promise<BankEntry> {
    const n = await this.checkName(name);
    const list = await this.customBanks();
    if (list.length >= MAX_CUSTOM_BANKS) throw new Error(`最多 ${MAX_CUSTOM_BANKS} 份自訂題庫`);
    let bank = blank;
    if (copyFrom !== undefined) {
      const src = await this.read(copyFrom);
      if (src.unreadable || src.outdated) throw new Error("這份題庫現在讀不出來，不能複製");
      bank = src.current.bank;
    }
    const entry = { id: crypto.randomUUID(), name: n };
    await this.storage.put(bankKey(entry.id), { bank, version: 1, format: formatOf(bank) });
    await this.storage.put(INDEX_KEY, [...list, entry]);
    return entry;
  }

  async renameBank(id: string, name: unknown): Promise<BankEntry> {
    const n = await this.checkName(name, id);
    const { list, i } = await this.customIndex(id);
    const entry = { id, name: n };
    await this.storage.put(INDEX_KEY, list.map((b, j) => (j === i ? entry : b)));
    return entry;
  }

  /** Removes a custom bank. Its files are queued like a save's orphans (rooms that copied it may still show them);
   * runImageCleanup keeps any another bank still uses. */
  async deleteBank(id: string): Promise<void> {
    const { list, i } = await this.customIndex(id);
    const { current, unreadable, outdated } = await this.read(id);
    // The fallback bank is not what's stored: walk the raw stored value for its files instead.
    const raw = unreadable || outdated ? ((await this.storage.get(bankKey(id))) as { bank?: unknown } | undefined)?.bank : undefined;
    const keys = [...(unreadable || outdated ? legacyImageKeys(raw) : imageKeysOf(current.bank))];
    await this.storage.put(INDEX_KEY, list.filter((_, j) => j !== i));
    await this.storage.delete(bankKey(id));
    await this.storage.delete(legacyKey(id));
    if (keys.length > 0) {
      const pending = await this.getPending();
      const deleteAt = this.now() + this.cleanupDelayMs;
      // A key already waiting longer (an overwritten outdated bank's 14 days) keeps its later time.
      const later = new Map(pending.map((p) => [p.key, p.deleteAt]));
      const again = new Set(keys);
      await this.setPending([...pending.filter((p) => !again.has(p.key)), ...keys.map((key) => ({ key, deleteAt: Math.max(deleteAt, later.get(key) ?? 0) }))]);
    }
  }

  private async read(id: string = DEFAULT_BANK_ID): Promise<{ current: VersionedBank; unreadable: boolean; outdated?: { format: number; raw: unknown } }> {
    if (id !== DEFAULT_BANK_ID && !(await this.customBanks()).some((b) => b.id === id)) throw new Error(`${BANK_NOT_FOUND}: ${id}`);
    const raw = await this.storage.get(bankKey(id));
    if (raw === undefined) {
      // Only the default bank seeds itself; a listed custom bank with nothing stored is damaged.
      if (id !== DEFAULT_BANK_ID) return { current: { bank: BANK, version: 1 }, unreadable: true };
      const seeded: VersionedBank = { bank: BANK, version: 1 };
      await this.storage.put(bankKey(id), { ...seeded, format: formatOf(BANK) });
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
      console.error(JSON.stringify({ event: "bank_store_corrupt", bankId: id, error: String(err) }));
      return { current: { bank: BANK, version: 1 }, unreadable: true };
    }
  }

  /** Validates and replaces the whole bank atomically, but only if `expectedVersion` still
   * matches what's stored. Returns a `BankConflict` on a stale version, throws when the stored bank
   * is unreadable (nothing may overwrite it) or parseBank's error on invalid input — either way
   * nothing is saved, the previous bank stands. */
  async putBank(candidate: unknown, expectedVersion: number, id: string = DEFAULT_BANK_ID): Promise<VersionedBank | BankConflict> {
    const { current, unreadable, outdated } = await this.read(id);
    // The fallback bank is not what's stored (e.g. a rollback to code that can't read a newer
    // format): saving it at version 1 would overwrite every custom question.
    if (unreadable) throw new Error("stored bank is unreadable by this version; refusing to overwrite it");
    if (current.version !== expectedVersion) return { conflict: true, currentVersion: current.version };
    const validated = parseBank(candidate);
    assertSavable(validated);
    // An outdated bank was never parsed: its images come from walking the raw stored value.
    const oldKeys = outdated ? legacyImageKeys(outdated.raw) : imageKeysOf(current.bank);
    const newKeys = imageKeysOf(validated);
    const gone = [...newKeys].filter((k) => this.deleting.has(k));
    if (gone.length > 0) throw new Error(`圖片已過期、正在刪除，請重新上傳：${gone.join(", ")}`);
    // A key that is neither in the bank nor queued may already be deleted from R2 (the queue drops it once it's done).
    // A file another bank uses is still in R2 too.
    const known = new Set([...(await this.getPending()).map((p) => p.key), ...(await this.otherBanksKeys(id))]);
    const unknown = [...newKeys].filter((k) => !oldKeys.has(k) && !known.has(k));
    if (unknown.length > 0) throw new Error(`圖片已過期，請重新上傳：${unknown.join(", ")}`);
    const next: VersionedBank = { bank: validated, version: current.version + 1 };
    if (outdated) await this.storage.put(legacyKey(id), { bank: outdated.raw, format: outdated.format, version: current.version });
    await this.storage.put(bankKey(id), { ...next, format: formatOf(validated) });
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

  /** Files the readable banks other than `id` use. */
  private async otherBanksKeys(id: string): Promise<string[]> {
    const others = (await this.listBanks()).filter((b) => b.id !== id);
    return (await Promise.all(others.map((b) => this.read(b.id)))).flatMap((b) => (b.unreadable || b.outdated ? [] : [...imageKeysOf(b.current.bank)]));
  }
}

/** Every `value` of a `kind` image, video or audio object anywhere in `raw`: the files of a stored bank too old (or too new) to
 * parse. Other shapes are skipped, never thrown on. */
export function legacyImageKeys(raw: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(raw)) for (const v of raw) legacyImageKeys(v, keys);
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ((o.kind === "image" || o.kind === "video" || o.kind === "audio") && typeof o.value === "string" && o.value) keys.add(o.value);
    for (const v of Object.values(o)) legacyImageKeys(v, keys);
  }
  return keys;
}
