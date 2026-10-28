// The question bank: questions in five pools by difficulty, rooms that each name a monster, a
// difficulty and a reward, and one boss (docs/designs/scoring-and-score-pools.md).
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

import { DEFAULT_BOSS_HIT_REWARD, type Difficulty, type RoomTemplate } from "./game-state";
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
export const DIFFICULTIES = [1, 2, 3, 4, 5] as const satisfies readonly Difficulty[];
export interface BankRoom {
  monster: BankMonster;
  /** The pool this room deals from, and the progress points a correct answer here earns. */
  difficulty: Difficulty;
  /** Reward points for defeating the room's monster (docs/designs/scoring-and-score-pools.md S5). */
  reward: number;
}
export interface Bank {
  /** Questions by difficulty (S11); a room draws from the pool of its difficulty. */
  pools: Record<Difficulty, BankQuestion[]>;
  rooms: BankRoom[];
  /** `hitReward`: reward points per boss hit (S6). */
  boss: { monster: BankMonster; hitReward: number; phases: BossPhase[] };
}
/** One boss phase with its own HP bar and questions (docs/designs/boss-phases.md). Players learn a
 * phase's name and rule only when it starts, so both are required from the second phase on. */
export interface BossPhase {
  name: string;
  rule: string;
  maxHp: number;
  questions: BankQuestion[];
}

const SPRITES: SpriteKind[] = ["slime", "slime-lost", "slime-king", "ghost", "ghost-cry", "dragon"];
/** Exported so app/bank-editor/page.tsx's client-side pre-save check can't silently drift from
 * this server-side minimum. */
export const MIN_OPTIONS = 2;
/** The TV wall has four tile spots (app/room/[code]/screen/page.tsx TILE_SPOTS). */
export const MAX_OPTIONS = 4;
const fail = (why: string): never => {
  throw new Error(`Invalid question bank: ${why}`);
};
/** A bank saved before rewards existed has none: a room pays difficulty x 10, a boss hit 10 (S8). */
const defaultRoomReward = (d: Difficulty) => d * 10;
function parseReward(v: unknown, fallback: number, where: string): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`${where} has reward ${String(v)}`);
  return v as number;
}

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
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates and normalizes one content/explanation slot. Called from both call sites below
 * (content and explanation, on both question kinds) so kind-specific validation can't drift
 * apart via copy-paste — a lesson the design doc's own review caught (R2-2 / Outside Voice). */
function parseMediaContent(raw: unknown, where: string): MediaContent {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== "object") fail(`${where} has no content`);
  const { kind, value } = m!;
  if (typeof value !== "string" || !value.trim()) fail(`${where} content has no value`);
  if (kind === "image" && !UUID_RE.test(value as string)) fail(`${where} has an invalid image key`);
  else if (kind === "youtube" && !YOUTUBE_ID_RE.test(value as string)) fail(`${where} has an invalid YouTube video id`);
  else if (kind !== "text" && kind !== "image" && kind !== "youtube") fail(`${where} content has unknown kind ${String(kind)}`);
  return { kind, value } as MediaContent;
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

function parseDifficulty(d: unknown, where: string): Difficulty {
  if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 5) fail(`${where} has difficulty ${String(d)}`);
  return d as Difficulty;
}

/** Validate untrusted JSON into a Bank. Throws (loudly, at startup) on the first problem.
 * Reads the pooled format, and also the older one where each room held its own questions and a
 * `baseDifficulty`: those questions join the pool of that difficulty, so a bank stored before pools
 * keeps working with no manual step. */
export function parseBank(raw: unknown): Bank {
  const b = raw as Record<string, unknown> | null;
  if (!b || typeof b !== "object") fail("not an object");
  if (!Array.isArray(b!.rooms) || b!.rooms.length === 0) fail("no rooms");
  const seen = new Set<string>();
  const pools = { 1: [], 2: [], 3: [], 4: [], 5: [] } as Record<Difficulty, BankQuestion[]>;
  const pooled = b!.pools !== undefined;
  if (pooled) {
    const raw = b!.pools as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("pools is not an object");
    for (const [key, list] of Object.entries(raw!)) {
      const d = parseDifficulty(Number(key), `pool ${key}`);
      if (key !== String(d)) fail(`pool key ${key} is not one of 1–5`); // "01" would overwrite pool 1
      // An empty pool is fine; a room that needs it is caught below.
      if (Array.isArray(list) && list.length === 0) continue;
      pools[d] = parseQuestions(list, `pool ${d}`, seen);
    }
  }
  const rooms = (b!.rooms as Record<string, unknown>[]).map((r, i): BankRoom => {
    const d = parseDifficulty(pooled ? r.difficulty : r.baseDifficulty, `room ${i}`);
    if (pooled && r.questions !== undefined) fail(`room ${i} has questions, but this bank keeps them in pools`);
    if (!pooled) pools[d] = [...pools[d], ...parseQuestions(r.questions, `room ${i}`, seen)];
    return {
      monster: parseMonster(r.monster, `room ${i}`),
      difficulty: d,
      reward: parseReward(r.reward, defaultRoomReward(d), `room ${i}`),
    };
  });
  rooms.forEach((r, i) => {
    if (pools[r.difficulty].length === 0) fail(`room ${i} has difficulty ${r.difficulty} but pool ${r.difficulty} has no questions`);
  });
  const boss = b!.boss as Record<string, unknown> | null;
  if (!boss) fail("no boss");
  // A bank from before phases holds one bar and one question list on the boss itself: that is phase 1.
  const rawPhases = boss!.phases === undefined ? [{ maxHp: boss!.maxHp, questions: boss!.questions }] : boss!.phases;
  if (!Array.isArray(rawPhases) || rawPhases.length === 0) fail("boss has no phases");
  const phases = (rawPhases as Record<string, unknown>[]).map((r, i): BossPhase => {
    const where = i === 0 ? "boss" : `boss phase ${i + 1}`;
    if (typeof r?.maxHp !== "number" || r.maxHp < 1) fail(`${where} has no hp`);
    const text = (v: unknown, what: string) => {
      if (v !== undefined && typeof v !== "string") fail(`${where} ${what} is not text`);
      const t = ((v as string | undefined) ?? "").trim();
      if (i > 0 && !t) fail(`${where} has no ${what}`);
      return t;
    };
    return { name: text(r.name, "name"), rule: text(r.rule, "rule"), maxHp: r.maxHp as number, questions: parseQuestions(r.questions, where, seen) };
  });
  return {
    pools,
    rooms,
    boss: {
      monster: parseMonster(boss!.monster, "boss"),
      hitReward: parseReward(boss!.hitReward, DEFAULT_BOSS_HIT_REWARD, "boss"),
      phases,
    },
  };
}

/** Save-time only, not in parseBank: a stored bank from before the cap must still load (a load
 * failure falls back to the bundled bank, and the editor's next save would overwrite the real one). */
export function assertSavable(bank: Bank): void {
  const tooMany = allQuestions(bank).find((q) => q.kind === "multipleChoice" && q.options.length > MAX_OPTIONS);
  if (tooMany) fail(`question ${tooMany.id} has more than ${MAX_OPTIONS} options`);
}

export function roomTemplates(bank: Bank): RoomTemplate[] {
  return bank.rooms.map((r) => ({ baseDifficulty: r.difficulty, reward: r.reward }));
}

/** Question ids by pool, `[d - 1]` for difficulty d, the shape GameState.pools keeps. */
export function poolQuestionIds(bank: Bank): string[][] {
  return DIFFICULTIES.map((d) => bank.pools[d].map((q) => q.id));
}

/** A fresh shown order for every multipleChoice question, so a game's answers are not always in the
 * slot the bank wrote them in: `order[shown] = bank index` (Fisher-Yates over `rng`). */
export function shuffledOptionOrders(bank: Bank, rng: () => number): Record<string, number[]> {
  const orders: Record<string, number[]> = {};
  for (const q of allQuestions(bank)) {
    if (q.kind !== "multipleChoice") continue;
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      // Counted down from i, so a constant rng() of 0 (the tests' deterministic rng) keeps the bank order.
      const j = i - Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    orders[q.id] = order;
  }
  return orders;
}

/** The question as this game shows it: options in `order`, correctIndex moved with them. Without an
 * order (a text question, or a bank question added after the game started), or with a broken one, it is unchanged. */
export function inShownOrder<Q extends BankQuestion>(q: Q, order: number[] | undefined): Q {
  // Anything but a permutation of 0..n-1 (a corrupt saved order) would blank options and lose the answer.
  if (q.kind !== "multipleChoice" || !order || order.length !== q.options.length || !q.options.every((_, i) => order.includes(i))) return q;
  return { ...q, options: order.map((i) => q.options[i]), correctIndex: order.indexOf(q.correctIndex) };
}

/** Every boss question, all phases in order. */
export function bossQuestions(bank: Bank): BankQuestion[] {
  return bank.boss.phases.flatMap((p) => p.questions);
}

/** Each phase's HP and question ids, the shape GameState's boss keeps. */
export function bossPhaseStates(bank: Bank): { maxHp: number; questionIds: string[] }[] {
  return bank.boss.phases.map((p) => ({ maxHp: p.maxHp, questionIds: p.questions.map((q) => q.id) }));
}

/** Every question in a bank, pools 1 to 5 then boss — the "flatten the whole bank" expression every
 * whole-bank scan (allAnswers, validationError, imageKeysOf) needs, in one place. */
export function allQuestions(bank: Bank): BankQuestion[] {
  return [...DIFFICULTIES.flatMap((d) => bank.pools[d]), ...bossQuestions(bank)];
}

export function findQuestion(bank: Bank, id: string) {
  for (const d of DIFFICULTIES) {
    const q = bank.pools[d].find((x) => x.id === id);
    if (q) return { ...q, boss: false as const, difficulty: d };
  }
  const q = bossQuestions(bank).find((x) => x.id === id);
  return q ? { ...q, boss: true as const, difficulty: 5 as Difficulty } : undefined;
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

/** The part of a question every screen may see while it's in play. `difficulty` is the pool the
 * question came from (what a correct answer scores); the monster is the one in the team's room (`roomIndex`), since a pool
 * question can come up in any room of its difficulty. `order` is the game's shown option order.
 * Built by explicit field-picking, never `...q` — that discipline
 * is what keeps `answer`/`correctIndex`/`explanation` off every client; extend it the same way
 * for any future field, never spread the server-only shape. */
export function publicQuestion(
  bank: Bank,
  id: string,
  roomIndex: number,
  imageBaseUrl: string,
  order?: number[],
): PublicQuestion | null {
  const found = findQuestion(bank, id);
  if (!found) return null;
  const q = inShownOrder(found, order);
  const monster = q.boss ? bank.boss.monster : (bank.rooms[roomIndex] ?? bank.rooms[0]).monster;
  return {
    id: q.id,
    content: publicMediaContent(q.content, imageBaseUrl, q.id),
    difficulty: q.difficulty,
    boss: q.boss,
    monster: { name: monster.name, sprite: monster.sprite, hue: monster.hue },
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
