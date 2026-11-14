// The bank editor's unsaved draft (app/bank-editor/page.tsx): kept in this browser's localStorage per bank, so a phone
// tab the system closed, or a crash, does not lose half an hour of edits. Never holds the owner key: only the bank and
// the version it was edited from. Client-safe: types and pure helpers only (CLAUDE.md, check:bundle).
import { DIFFICULTIES, type Bank } from "./question-bank";

/** Bump when the stored shape changes: an older draft is then ignored, not misread. */
const DRAFT_FORMAT = 1;
export const draftKey = (bankId: string) => `bank-editor-draft:${bankId}`;

export interface BankDraft {
  /** The server version the edits started from. */
  version: number;
  /** When it was last written (ms since epoch). */
  savedAt: number;
  bank: Bank;
}

// The editor holds NaN for a time or a seconds box it cannot read (so 儲存 refuses it); JSON would make it null.
// Revived only on those number keys, so a text that happens to read "__NaN__" stays text.
const NAN = "__NaN__";
const NUMBER_KEYS = new Set(["start", "end", "target", "memorySeconds"]);

export function encodeDraft(d: BankDraft): string {
  return JSON.stringify({ format: DRAFT_FORMAT, ...d }, (_, v: unknown) => (typeof v === "number" && Number.isNaN(v) ? NAN : v));
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStrings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
const isContent = (c: unknown) => isObj(c) && typeof c.kind === "string" && typeof c.value === "string";

/** Enough of a question's shape for the editor to render it; the save check and the server judge the rest. */
function isQuestion(q: unknown): boolean {
  if (!isObj(q) || typeof q.id !== "string" || !isContent(q.content)) return false;
  if (q.explanation !== undefined && !isContent(q.explanation)) return false;
  if (q.kind === "text") return typeof q.answer === "string" && (q.fields === undefined || (Array.isArray(q.fields) && q.fields.every((f) => isObj(f) && typeof f.label === "string" && typeof f.answer === "string")));
  if (q.kind === "multipleChoice") return isStrings(q.options) && typeof q.correctIndex === "number";
  if (q.kind === "sort") return isStrings(q.items);
  return q.kind === "timing" && typeof q.target === "number";
}

function isBank(b: unknown): b is Bank {
  if (!isObj(b) || !isObj(b.pools) || !Array.isArray(b.rooms) || !isObj(b.boss) || !Array.isArray(b.boss.phases)) return false;
  const pools = b.pools;
  if (!DIFFICULTIES.every((d) => Array.isArray(pools[d]) && (pools[d] as unknown[]).every(isQuestion))) return false;
  if (!b.rooms.every((r) => isObj(r) && typeof r.difficulty === "number")) return false;
  return b.boss.phases.every((p) => isObj(p) && typeof p.name === "string" && typeof p.rule === "string" && Array.isArray(p.questions) && p.questions.every(isQuestion));
}

/** The stored draft, or null when there is none or it is unreadable, from another format or not a bank. */
export function decodeDraft(raw: string | null): BankDraft | null {
  if (!raw) return null;
  try {
    const d: unknown = JSON.parse(raw, (k, v: unknown) => (v === NAN && NUMBER_KEYS.has(k) ? NaN : v));
    if (!isObj(d) || d.format !== DRAFT_FORMAT || typeof d.version !== "number" || typeof d.savedAt !== "number" || !isBank(d.bank)) return null;
    return { version: d.version, savedAt: d.savedAt, bank: d.bank };
  } catch {
    return null;
  }
}

/** The draft worth offering after a load: none when it matches what the server has. `stale` when the server was saved
 * again after the draft's edits started (another tab or device): restoring it then replaces that later save. */
export function draftToOffer(raw: string | null, server: Bank, serverVersion: number): { draft: BankDraft; stale: boolean } | null {
  const draft = decodeDraft(raw);
  if (!draft || JSON.stringify(draft.bank) === JSON.stringify(server)) return null;
  return { draft, stale: draft.version !== serverVersion };
}
