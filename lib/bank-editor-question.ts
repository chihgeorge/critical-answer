// The bank editor's pure question edits (app/bank-editor/page.tsx), here so they have unit tests. Client-safe: types
// and constants only, never the parsed bank (CLAUDE.md, check:bundle).
import { SORT_ITEMS } from "./sort-order";
import { fieldsAnswer, type AnswerField, type BankQuestion } from "./question-bank";

// Sentinel for "no correct option marked yet" — happens right after switching a question to
// multipleChoice, or after deleting the option that was marked correct. Never a valid saved
// state: the editor's validate() blocks 儲存全部變更 while any question is stuck at this value.
export const UNSET_CORRECT_INDEX = -1;

/** A fresh question of the given outer kind, keeping only `id`/`content` — switching kind never
 * carries over the other kind's fields (no auto-conversion; the two kinds' extra fields aren't
 * comparable). The standalone `image` kind retired (D1) — content/explanation media type is
 * chosen independently via MediaPicker, not by the outer kind selector. */
export function blankQuestion(q: BankQuestion, kind: BankQuestion["kind"]): BankQuestion {
  // explanation carries over just like content does — dropping it here would silently discard
  // an uploaded image/video with no warning at all, bypassing MediaPicker's own confirm() gate
  // entirely (adversarial review finding, /ship).
  // The prompt (題幹) belongs to the content, so it carries over too, and so does the category.
  const prompt = { ...(q.prompt !== undefined ? { prompt: q.prompt } : {}), ...(q.category !== undefined ? { category: q.category } : {}) };
  if (kind === "text") return { kind: "text", id: q.id, content: q.content, ...prompt, answer: "", explanation: q.explanation };
  if (kind === "sort") return { kind: "sort", id: q.id, content: q.content, ...prompt, items: Array<string>(SORT_ITEMS).fill(""), explanation: q.explanation };
  return {
    kind: "multipleChoice",
    id: q.id,
    content: q.content,
    ...prompt,
    options: ["", ""],
    correctIndex: UNSET_CORRECT_INDEX,
    explanation: q.explanation,
  };
}

/** `q` with the 類別 field set to `category` as typed; a blank one removes the category. */
export function withCategory(q: BankQuestion, category: string): BankQuestion {
  const next = { ...q };
  if (category.trim()) next.category = category;
  else delete next.category;
  return next;
}

/** `q` with field `i` patched and `answer` kept as the fields joined (multi-field.md F1). */
export function withField(q: BankQuestion, i: number, patch: Partial<AnswerField>): BankQuestion {
  if (q.kind !== "text" || !q.fields) return q;
  const fields = q.fields.map((f, j) => (j === i ? { ...f, ...patch } : f));
  return { ...q, fields, answer: fieldsAnswer(fields) };
}
