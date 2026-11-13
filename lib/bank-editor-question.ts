// The bank editor's pure question edits (app/bank-editor/page.tsx), here so they have unit tests. Client-safe: types
// and constants only, never the parsed bank (CLAUDE.md, check:bundle).
import { SORT_ITEMS } from "./sort-order";
import { DEFAULT_MEMORY_SECONDS, fieldsAnswer, isClip, MAX_TAP_LABEL, type AnswerField, type BankQuestion, type MediaContent } from "./question-bank";
import { TAP_GRACE_S } from "./tap-clock";

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
  // The prompt (題幹) belongs to the content, so it carries over too, and so do the category and a boss question's difficulty.
  const prompt = {
    ...(q.prompt !== undefined ? { prompt: q.prompt } : {}),
    ...(q.category !== undefined ? { category: q.category } : {}),
    ...(q.difficulty !== undefined ? { difficulty: q.difficulty } : {}),
    // 記憶題 belongs to the content too (memory-questions.md).
    ...(q.memory ? { memory: q.memory } : {}),
    ...(q.memorySeconds !== undefined ? { memorySeconds: q.memorySeconds } : {}),
  };
  if (kind === "text") return { kind: "text", id: q.id, content: q.content, ...prompt, answer: "", explanation: q.explanation };
  // A timing question is heard live, never memorised first (timing-tap.md): the memory setup stays behind.
  if (kind === "timing") {
    const next: BankQuestion = { kind: "timing", id: q.id, content: q.content, ...prompt, target: 0, explanation: q.explanation };
    delete next.memory;
    delete next.memorySeconds;
    return next;
  }
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

/** `q` with new content, kept valid: text content has no prompt and cannot be a memory question; an image memory
 * question gets its seconds, a clip loses them (memory-questions.md). */
export function withContent(q: BankQuestion, content: MediaContent): BankQuestion {
  const next = { ...q, content };
  if (content.kind === "text") {
    delete next.prompt;
    delete next.memory;
    delete next.memorySeconds;
  } else if (next.memory && content.kind === "image") next.memorySeconds ??= DEFAULT_MEMORY_SECONDS;
  else delete next.memorySeconds;
  return next;
}

/** `q` as a memory question or not: ticked on an image, it shows for DEFAULT_MEMORY_SECONDS until changed. */
export function withMemory(q: BankQuestion, on: boolean): BankQuestion {
  const next = { ...q };
  delete next.memory;
  delete next.memorySeconds;
  if (!on) return next;
  return { ...next, memory: true, ...(q.content.kind === "image" ? { memorySeconds: q.memorySeconds ?? DEFAULT_MEMORY_SECONDS } : {}) };
}

/** Whether `q`'s content may be a memory question: an image or a clip. */
export const canBeMemory = (q: BankQuestion): boolean => q.kind !== "timing" && (q.content.kind === "image" || isClip(q.content));

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

/** What is wrong with a timing question's fields, in the editor's words (timing-tap.md 畫面), or null; the same rules as
 * parseBank's, so the save check and the line under the field agree. */
export function timingFieldError(q: BankQuestion): string | null {
  if (q.kind !== "timing") return null;
  const c = q.content;
  if (c.kind !== "youtube" && c.kind !== "video" && c.kind !== "audio") return "卡點題的內容只能是 YouTube 或上傳的影音";
  if (!Number.isFinite(q.target) || q.target < (c.start ?? 0)) return "目標要在片段開頭之後";
  if (Math.abs(q.target * 1000 - Math.round(q.target * 1000)) > 1e-6) return "目標秒數最多 3 位小數";
  if (c.end !== undefined && q.target + TAP_GRACE_S > c.end) return `目標要比片段結尾早 ${TAP_GRACE_S} 秒以上`;
  if (Array.from((q.label ?? "").trim()).length > MAX_TAP_LABEL) return `label 最多 ${MAX_TAP_LABEL} 個字`;
  return null;
}
