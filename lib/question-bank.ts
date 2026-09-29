// The question bank: one monster per room, several questions per room, one boss.
// Source of truth is data/question-bank.json — but that raw JSON (with every answer) is loaded
// and parsed only in lib/question-bank-data.ts, a server-only module. This file is pure
// logic/types over an already-in-memory Bank and is safe to import from client components (e.g.
// app/bank-editor/page.tsx needs MIN_OPTIONS/allQuestions) — the browser only ever gets
// PublicQuestion (built by publicQuestion() below), which has no answer.
//
// This split exists because of a real regression: app/bank-editor/page.tsx importing this file
// used to also pull in the top-level `export const BANK = parseBank(bankJson)` below, and
// Turbopack/webpack can't tree-shake a side-effecting top-level statement — so the ENTIRE bank,
// every question's answer included, shipped in that page's public client JS bundle, bypassing
// the OWNER_KEY gate entirely (a static JS asset has no auth). Caught by CI's
// scripts/check-bundle.sh, which failed on every push since. Never re-add a top-level parsed
// BANK constant (or the bankJson import) to this file — that import belongs only in
// lib/question-bank-data.ts.

import type { Difficulty, RoomTemplate } from "./game-state";
import type { PublicMediaContent, PublicQuestion } from "./protocol";
import type { SpriteKind } from "./sprite-kind";
import { YOUTUBE_ID_RE } from "./youtube";

/** A question's (or explanation's) content: text, an uploaded image, or a YouTube video —
 * interchangeable, picked at write time (docs/designs/question-media-content.md's D1: `content`
 * REPLACES the old fixed `text` prompt, it doesn't decorate it — a `kind: "image"` question shows
 * only the image, no separate prompt line). */
export interface MediaContent {
  kind: "text" | "image" | "youtube";
  value: string;
}

/** `kind` is required on every question (not optional/defaulted) — see
 * docs/designs/multiple-choice-questions.md decision 1 for why, and the
 * accepted risk of making it required instead of backward-compatible.
 * The standalone `image` kind retired (D1) — an image is now one `content`/`explanation` media
 * type available on either remaining kind, not its own top-level kind. */
export type BankQuestion =
  | { kind: "text"; id: string; content: MediaContent; answer: string; explanation?: MediaContent }
  | { kind: "multipleChoice"; id: string; content: MediaContent; options: string[]; correctIndex: number; explanation?: MediaContent };

export interface BankMonster {
  name: string;
  sprite: SpriteKind;
  /** CSS hue-rotate degrees, so one sprite can play several monsters. */
  hue: number;
}
export interface Bank {
  rooms: { monster: BankMonster; baseDifficulty: Difficulty; questions: BankQuestion[] }[];
  boss: { monster: BankMonster; maxHp: number; questions: BankQuestion[] };
}

const SPRITES: SpriteKind[] = ["slime", "slime-lost", "slime-king", "ghost", "ghost-cry", "dragon"];
/** Exported so app/bank-editor/page.tsx's client-side pre-save check can't silently drift from
 * this server-side minimum. */
export const MIN_OPTIONS = 2;
const fail = (why: string): never => {
  throw new Error(`Invalid question bank: ${why}`);
};

function parseMonster(raw: unknown, where: string): BankMonster {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m.name !== "string" || !m.name.trim()) fail(`${where} monster has no name`);
  if (!SPRITES.includes(m!.sprite as SpriteKind)) fail(`${where} monster has unknown sprite ${String(m!.sprite)}`);
  return { name: m!.name as string, sprite: m!.sprite as SpriteKind, hue: typeof m!.hue === "number" ? m!.hue : 0 };
}

/** Every real image `value` is a `crypto.randomUUID()` minted by the upload endpoint
 * (worker/index.ts) — requiring that shape here closes off a hand-crafted key like
 * "/evil.example/x", which would otherwise build a protocol-relative image URL (imageUrlOf
 * below) that every player's phone and the shared screen load as-is (adversarial review finding,
 * carried forward from the retired `image` kind — /plan-eng-review R2-2). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates and normalizes one content/explanation slot. Called from both call sites below
 * (content and explanation, on both question kinds) so kind-specific validation can't drift
 * apart via copy-paste — a lesson the design doc's own review caught (R2-2 / Outside Voice). */
function parseMediaContent(raw: unknown, where: string): MediaContent {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== "object") fail(`${where} has no content`);
  const { kind, value } = m!;
  if (typeof value !== "string" || !value.trim()) fail(`${where} content has no value`);
  if (kind === "text") return { kind: "text", value: value as string };
  if (kind === "image") {
    if (!UUID_RE.test(value as string)) fail(`${where} has an invalid image key`);
    return { kind: "image", value: value as string };
  }
  if (kind === "youtube") {
    if (!YOUTUBE_ID_RE.test(value as string)) fail(`${where} has an invalid YouTube video id`);
    return { kind: "youtube", value: value as string };
  }
  return fail(`${where} content has unknown kind ${String(kind)}`);
}

/** Accepts either the current `content: MediaContent` shape, or a legacy bare `text: string`
 * field (every question before this schema change) or a legacy `image`-kind's `imageKey` (before
 * the standalone `image` kind retired) — converted to the new shape on read, in the same
 * bank-loading path every save already goes through. See docs/designs/question-media-content.md's
 * migration decision: a backward-read shim here, not a separate migration script. */
function parseContent(r: Record<string, unknown>, where: string): MediaContent {
  if (r.content !== undefined) return parseMediaContent(r.content, where);
  if (typeof r.imageKey === "string") return parseMediaContent({ kind: "image", value: r.imageKey }, where);
  if (typeof r.text === "string") return parseMediaContent({ kind: "text", value: r.text }, where);
  return fail(`${where} has no content`);
}

function parseExplanation(r: Record<string, unknown>, where: string): MediaContent | undefined {
  if (r.explanation === undefined) return undefined;
  return parseMediaContent(r.explanation, `${where} explanation`);
}

function parseTextQuestion(r: Record<string, unknown>, id: string): BankQuestion {
  const { answer } = r;
  if (typeof answer !== "string" || !answer.trim()) fail(`question ${id} has an empty answer`);
  const content = parseContent(r, `question ${id}`);
  const explanation = parseExplanation(r, `question ${id}`);
  return { kind: "text", id, content, answer: answer as string, ...(explanation ? { explanation } : {}) };
}

function parseMultipleChoiceQuestion(r: Record<string, unknown>, id: string): BankQuestion {
  const rawOptions = r.options;
  if (!Array.isArray(rawOptions) || rawOptions.length < MIN_OPTIONS) fail(`question ${id} needs at least ${MIN_OPTIONS} options`);
  const options = rawOptions as unknown[];
  if (!options.every((o) => typeof o === "string" && o.trim())) fail(`question ${id} has an empty option`);
  const correctIndex = r.correctIndex;
  if (typeof correctIndex !== "number" || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    fail(`question ${id} has correctIndex out of range`);
  }
  const content = parseContent(r, `question ${id}`);
  const explanation = parseExplanation(r, `question ${id}`);
  return {
    kind: "multipleChoice",
    id,
    content,
    options: options as string[],
    correctIndex: correctIndex as number,
    ...(explanation ? { explanation } : {}),
  };
}

function parseQuestions(raw: unknown, where: string, seen: Set<string>): BankQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(`${where} has no questions`);
  return (raw as Record<string, unknown>[]).map((r) => {
    const { id, kind } = r;
    if (typeof id !== "string" || !id) fail(`${where} has a question without an id`);
    if (seen.has(id as string)) fail(`duplicate question id ${String(id)}`);
    seen.add(id as string);
    // "image" is a legacy top-level kind (pre-D1): it converts to a text-kind question whose
    // content happens to be an image, same as parseContent's imageKey fallback handles it.
    if (kind === "text" || kind === "image") return parseTextQuestion(r, id as string);
    if (kind === "multipleChoice") return parseMultipleChoiceQuestion(r, id as string);
    return fail(`question ${String(id)} has unknown kind ${String(kind)}`);
  });
}

/** Validate untrusted JSON into a Bank. Throws (loudly, at startup) on the first problem. */
export function parseBank(raw: unknown): Bank {
  const b = raw as Record<string, unknown> | null;
  if (!b || typeof b !== "object") fail("not an object");
  if (!Array.isArray(b!.rooms) || b!.rooms.length === 0) fail("no rooms");
  const seen = new Set<string>();
  const rooms = (b!.rooms as Record<string, unknown>[]).map((r, i) => {
    const d = r.baseDifficulty;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 5) fail(`room ${i} has difficulty ${String(d)}`);
    return {
      monster: parseMonster(r.monster, `room ${i}`),
      baseDifficulty: d as Difficulty,
      questions: parseQuestions(r.questions, `room ${i}`, seen),
    };
  });
  const boss = b!.boss as Record<string, unknown> | null;
  if (!boss) fail("no boss");
  if (typeof boss!.maxHp !== "number" || boss!.maxHp < 1) fail("boss has no hp");
  return {
    rooms,
    boss: {
      monster: parseMonster(boss!.monster, "boss"),
      maxHp: boss!.maxHp as number,
      questions: parseQuestions(boss!.questions, "boss", seen),
    },
  };
}

export function roomTemplates(bank: Bank): RoomTemplate[] {
  return bank.rooms.map((r) => ({ baseDifficulty: r.baseDifficulty, questionIds: r.questions.map((q) => q.id) }));
}

export function bossQuestionIds(bank: Bank): string[] {
  return bank.boss.questions.map((q) => q.id);
}

/** Every question in a bank, rooms then boss — the "flatten the whole bank" expression every
 * whole-bank scan (allAnswers, validationError, imageKeysOf) needs, in one place. */
export function allQuestions(bank: Bank): BankQuestion[] {
  return [...bank.rooms.flatMap((r) => r.questions), ...bank.boss.questions];
}

export function findQuestion(bank: Bank, id: string) {
  for (const [roomIndex, r] of bank.rooms.entries()) {
    const q = r.questions.find((x) => x.id === id);
    if (q) return { ...q, roomIndex, boss: false as const, monster: r.monster, baseDifficulty: r.baseDifficulty };
  }
  const q = bank.boss.questions.find((x) => x.id === id);
  return q ? { ...q, roomIndex: -1, boss: true as const, monster: bank.boss.monster, baseDifficulty: 5 as Difficulty } : undefined;
}

/** The correct answer's display text, regardless of kind — callers that only need to show or compare
 * the answer (HOST_ANSWER, the narration answer-leak check) don't need to branch on kind themselves. */
export function answerText(q: BankQuestion): string {
  if (q.kind === "multipleChoice") return q.options[q.correctIndex];
  return q.answer;
}

/** Builds a wire-safe `PublicMediaContent` from an internal `MediaContent` — `image`'s stored key
 * becomes a public R2 URL, `youtube`'s stored value becomes the wire's `videoId` field, `text`
 * passes through. Warns loudly (not just failing silently client-side via the broken-image
 * fallback) if `imageBaseUrl` is missing or still the unconfigured placeholder — a forgotten
 * R2_PUBLIC_BASE_URL / bucket public-access setup step would otherwise only ever show up as a
 * mysteriously hidden image, with nothing in the Worker's own logs pointing at the real cause
 * (adversarial review finding, carried forward from the retired `image` kind). */
export function publicMediaContent(c: MediaContent, imageBaseUrl: string, questionId: string): PublicMediaContent {
  if (c.kind === "text") return { kind: "text", value: c.value };
  if (c.kind === "youtube") return { kind: "youtube", videoId: c.value };
  if (!imageBaseUrl || imageBaseUrl.includes("REPLACE-ME")) {
    console.error(JSON.stringify({ event: "image_base_url_missing", questionId }));
  }
  return { kind: "image", url: `${imageBaseUrl}/${c.value}` };
}

/** The part of a question every screen may see while it's in play. `difficulty` is the team's
 * current one (flee lowers it). Built by explicit field-picking, never `...q` — that discipline
 * is what keeps `answer`/`correctIndex`/`explanation` off every client; extend it the same way
 * for any future field, never spread the server-only shape. */
export function publicQuestion(bank: Bank, id: string, difficulty: number, imageBaseUrl: string): PublicQuestion | null {
  const q = findQuestion(bank, id);
  if (!q) return null;
  return {
    id: q.id,
    content: publicMediaContent(q.content, imageBaseUrl, q.id),
    difficulty: q.boss ? 5 : difficulty,
    boss: q.boss,
    monster: { name: q.monster.name, sprite: q.monster.sprite, hue: q.monster.hue },
    ...(q.kind === "multipleChoice" ? { options: q.options } : {}),
  };
}

/** The public-safe explanation for a question that was just answered CORRECTLY — built
 * separately from publicQuestion() (never attached to the in-play question, which would leak it
 * before the answer is judged). Returns undefined when the question has none. See AnswerReveal in
 * lib/protocol.ts and its D2/D5 decisions. */
export function publicExplanation(bank: Bank, id: string, imageBaseUrl: string): PublicMediaContent | undefined {
  const q = findQuestion(bank, id);
  return q?.explanation ? publicMediaContent(q.explanation, imageBaseUrl, q.id) : undefined;
}

/** Every R2 object key referenced anywhere in a bank (content OR explanation, on either
 * surviving kind) — used to diff an old bank against a new one after a save, so orphaned images
 * (deleted question, replaced image, media type switched away from image) can be cleaned up
 * without per-question change tracking. See docs/designs/image-question-type.md's original "R2
 * cleanup mechanism" decision — walking `content`/`explanation` here instead of a top-level
 * `image` kind is what keeps that mechanism correct after D1 retired the standalone kind
 * (Outside Voice finding, /plan-eng-review: this function silently returning nothing for every
 * bank would have made the very next save delete every live image). */
export function imageKeysOf(bank: Bank): Set<string> {
  const keys = new Set<string>();
  for (const q of allQuestions(bank)) {
    if (q.content.kind === "image") keys.add(q.content.value);
    if (q.explanation?.kind === "image") keys.add(q.explanation.value);
  }
  return keys;
}
