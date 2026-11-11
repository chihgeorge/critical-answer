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

import { DEFAULT_BOSS_DIFFICULTY, DEFAULT_BOSS_HIT_REWARD, type Difficulty, type RoomTemplate } from "./game-state";
import { MAX_FIELDS, MAX_ID, type HiddenInstagram, type HiddenVideo, type InstagramVideo, type PublicMediaContent, type PublicQuestion } from "./protocol";
import { catalogMonster, monsterById, variantOf } from "./monster-catalog";
import { YOUTUBE_ID_RE } from "./youtube";
import { INSTAGRAM_SHORTCODE_RE } from "./instagram";
import { SORT_ITEMS } from "./sort-order";

/** A question's (or explanation's) content: text, an uploaded image, or a YouTube video —
 * interchangeable, picked at write time (docs/designs/question-media-content.md's D1: `content`
 * REPLACES the old fixed `text` prompt, it doesn't decorate it — a `kind: "image"` question shows
 * only the image, no separate prompt line). */
export interface MediaContent {
  /** instagram: explanation slot only, `value` is the shortcode (docs/designs/instagram-explanations.md). */
  kind: "text" | "image" | "youtube" | "instagram";
  value: string;
  /** youtube only, content slot only: a music question. The screen covers the video and plays the
   * sound (docs/designs/youtube-questions.md D3). */
  audioOnly?: boolean;
  /** youtube only: the clip, in whole seconds of the video. instagram: `end` alone, the video's length. */
  start?: number;
  end?: number;
}

/** Longest question `prompt`, in characters: the same cap as other free text on the wire. */
export const MAX_PROMPT = 200;

/** `kind` is required on every question (not optional/defaulted) — see
 * docs/designs/multiple-choice-questions.md decision 1 for why, and the
 * accepted risk of making it required instead of backward-compatible.
 * The standalone `image` kind retired (D1) — an image is now one `content`/`explanation` media
 * type available on either remaining kind, not its own top-level kind. */
export type BankQuestion = (
  /** `fields`: a music question's 2–3 answers, judged one by one (docs/designs/multi-field.md); `answer` is then
   * their answers joined with FIELD_SEP. */
  | { kind: "text"; id: string; content: MediaContent; prompt?: string; answer: string; fields?: AnswerField[]; explanation?: MediaContent }
  | { kind: "multipleChoice"; id: string; content: MediaContent; prompt?: string; options: string[]; correctIndex: number; explanation?: MediaContent }
  /** A sort question: `items` in the correct order; the question line (content or prompt) states the rule. */
  | { kind: "sort"; id: string; content: MediaContent; prompt?: string; items: string[]; explanation?: MediaContent }
) & {
  /** Free text the owner groups questions by (動漫, 遊戲音樂…): a buzzer phase's winner picks the next one's
   * (docs/designs/boss-music-buzzer.md). */
  category?: string;
  /** Boss questions only: how hard (1–5), for the check's DC and the phase's order. Absent reads as 5. */
  difficulty?: Difficulty;
};

/** Longest question `category`, in characters: it is a button on a phone. */
export const MAX_CATEGORY = 20;

/** One answer of a music question with fields (docs/designs/multi-field.md F1). */
export interface AnswerField {
  label: string;
  answer: string;
}
export const MIN_FIELDS = 2;
export { MAX_FIELDS };
/** Longest field `label`, in characters: it labels a box on a phone. */
export const MAX_FIELD_LABEL = 10;
/** Joins a question's field answers into its `answer`. */
export const FIELD_SEP = "／";
export const fieldsAnswer = (fields: AnswerField[]): string => fields.map((f) => f.answer.trim()).join(FIELD_SEP);
/** A music question: a fill-in whose content is a YouTube video played as sound only. Only these may have fields, and
 * only in a buzzer phase (docs/designs/multi-field.md). */
export const isMusicQuestion = (q: BankQuestion): boolean => q.kind === "text" && q.content.kind === "youtube" && q.content.audioOnly === true;

/** Judged by the room from the team's lock, never by the host's 答對 (multiple choice and sort). */
export const isAutoJudged = (q: { kind: BankQuestion["kind"] } | undefined): boolean => q?.kind === "multipleChoice" || q?.kind === "sort";

export const DIFFICULTIES = [1, 2, 3, 4, 5] as const satisfies readonly Difficulty[];
export interface BankRoom {
  /** A catalog id (lib/monster-catalog.ts) of a room monster. */
  monster: string;
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
  boss: { monster: string; hitReward: number; phases: BossPhase[] };
  /** Each game draws its own monsters instead of the ones named above (monster-catalog.ts gameMonsters). */
  randomMonsters?: boolean;
}
/** One boss phase with its own HP bar and questions (docs/designs/boss-phases.md). Players learn a
 * phase's name and rule only when it starts, so both are required from the second phase on. */
export interface BossPhase {
  name: string;
  rule: string;
  maxHp: number;
  questions: BankQuestion[];
  /** Every team buzzes in on this phase's questions and answers aloud (docs/designs/boss-buzzer.md D1). Never the
   * first phase, and only fill-in questions (D3): the host judges a spoken answer. */
  buzzer?: true;
}

/** Exported so app/bank-editor/page.tsx's client-side pre-save check can't silently drift from
 * this server-side minimum. */
export const MIN_OPTIONS = 2;
/** The TV wall has four tile spots (app/room/[code]/screen/page.tsx TILE_SPOTS). */
export const MAX_OPTIONS = 4;
/** The big screen draws one heart per HP on the boss's nameplate up to MAX_HEARTS (lib/protocol.ts), a bar above (multi-field.md E5: a phase of
 * multi-field questions loses more than 1 HP a hit). */
export const MAX_BOSS_HP = 60;
/** Longest boss phase `name` and `rule`, in characters: at these the big screen's phase card keeps the title to one
 * line and the rule to two, so the new boss still shows under it (TODOS: /qa 2026-10-28). */
export const MAX_PHASE_NAME = 12;
export const MAX_PHASE_RULE = 40;
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

/** A bank names a catalog monster by id (docs/designs/monster-catalog.md); a room takes a room
 * monster, the boss a boss. A whole monster object is the format before the catalog (D6: rebuild). */
function parseMonster(raw: unknown, where: string, wantBoss: boolean): string {
  if (raw && typeof raw === "object") throw new Error(`題庫格式太舊：${where}.monster 是整隻怪物，這版只接受圖鑑 id（例如 "slime-soft"）。請用題庫編輯器重建。`);
  const m = typeof raw === "string" ? monsterById(raw) : undefined;
  if (!m) fail(`${where}.monster 不是圖鑑裡的怪物：${String(raw)}`);
  if (m!.boss !== wantBoss) fail(`${where}.monster ${m!.id} ${m!.boss ? "只能當首領" : "只能當小怪"}`);
  return m!.id;
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
function parseMediaContent(raw: unknown, where: string, slot: "content" | "explanation"): MediaContent {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== "object") fail(`${where} has no content`);
  const { kind, value, audioOnly, start, end } = m!;
  if (typeof value !== "string" || !value.trim()) fail(`${where} content has no value`);
  if (kind === "image" && !UUID_RE.test(value as string)) fail(`${where} has an invalid image key`);
  else if (kind === "youtube" && !YOUTUBE_ID_RE.test(value as string)) fail(`${where} has an invalid YouTube video id`);
  else if (kind === "instagram" && !INSTAGRAM_SHORTCODE_RE.test(value as string)) fail(`${where} has an invalid Instagram shortcode`);
  else if (kind !== "text" && kind !== "image" && kind !== "youtube" && kind !== "instagram") fail(`${where} content has unknown kind ${String(kind)}`);
  // The embed cannot be played by the host, so a question's own content cannot wait on it (instagram-explanations.md).
  if (kind === "instagram" && slot === "content") fail(`${where} content cannot be an Instagram video, only its explanation can`);
  const clip = audioOnly !== undefined || start !== undefined || end !== undefined;
  if (!clip) return { kind, value } as MediaContent;
  if (kind === "instagram" && (audioOnly !== undefined || start !== undefined)) fail(`${where} has audioOnly/start, which an Instagram video cannot have (only end, its length)`);
  else if (kind !== "youtube" && kind !== "instagram") fail(`${where} has audioOnly/start/end, which only a YouTube video can have`);
  // The explanation plays on its own, outside the host's controls, so it can't hide its picture.
  if (audioOnly !== undefined && slot === "explanation") fail(`${where} explanation cannot be audioOnly`);
  if (audioOnly !== undefined && typeof audioOnly !== "boolean") fail(`${where} audioOnly is not true or false`);
  const second = (v: unknown, name: string) => {
    if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < 0)) fail(`${where} ${name} is not a whole number of seconds`);
  };
  second(start, "start");
  second(end, "end");
  if (typeof end === "number" && end <= ((start as number | undefined) ?? 0)) fail(`${where} end must come after start`);
  return {
    kind: kind as "youtube" | "instagram",
    value: value as string,
    ...(audioOnly === true ? { audioOnly: true } : {}),
    ...(start !== undefined ? { start: start as number } : {}),
    ...(end !== undefined ? { end: end as number } : {}),
  };
}

/** The line shown above an image or a video (D5). A text question already is its own line. */
function parsePrompt(r: Record<string, unknown>, content: MediaContent, where: string): string | undefined {
  const { prompt } = r;
  if (prompt === undefined) return undefined;
  if (typeof prompt !== "string" || !prompt.trim()) fail(`${where} has an empty prompt`);
  if (content.kind === "text") fail(`${where} has a prompt, but its content is already text`);
  if (Array.from(prompt as string).length > MAX_PROMPT) fail(`${where} prompt is over ${MAX_PROMPT} characters`);
  return prompt as string;
}

/** Accepts either the current `content: MediaContent` shape, or a legacy bare `text: string`
 * field (every question before this schema change) or a legacy `image`-kind's `imageKey` (before
 * the standalone `image` kind retired) — converted to the new shape on read, in the same
 * bank-loading path every save already goes through. See docs/designs/question-media-content.md's
 * migration decision: a backward-read shim here, not a separate migration script. */
function parseContent(r: Record<string, unknown>, where: string): MediaContent {
  if (r.content !== undefined) return parseMediaContent(r.content, where, "content");
  if (typeof r.imageKey === "string") return parseMediaContent({ kind: "image", value: r.imageKey }, where, "content");
  if (typeof r.text === "string") return parseMediaContent({ kind: "text", value: r.text }, where, "content");
  return fail(`${where} has no content`);
}

function parseExplanation(r: Record<string, unknown>, where: string): MediaContent | undefined {
  if (r.explanation === undefined) return undefined;
  return parseMediaContent(r.explanation, `${where} explanation`, "explanation");
}

/** A music question's fields (multi-field.md F1): 2–3, each with a label and an answer. Where they may be is parseBank's call. */
function parseFields(v: unknown, id: string): AnswerField[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length < MIN_FIELDS || v.length > MAX_FIELDS) fail(`question ${id} needs ${MIN_FIELDS} to ${MAX_FIELDS} fields`);
  return (v as unknown[]).map((f) => {
    const { label, answer } = (f ?? {}) as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim()) fail(`question ${id} has a field without a label`);
    if (Array.from((label as string).trim()).length > MAX_FIELD_LABEL) fail(`question ${id} field label is longer than ${MAX_FIELD_LABEL} characters`);
    if (typeof answer !== "string" || !answer.trim()) fail(`question ${id} has a field without an answer`);
    return { label: (label as string).trim(), answer: (answer as string).trim() };
  });
}

function parseTextQuestion(r: Record<string, unknown>, id: string): BankQuestion {
  const fields = parseFields(r.fields, id);
  // With fields, `answer` is theirs joined: whatever the JSON says is replaced.
  const answer = fields ? fieldsAnswer(fields) : r.answer;
  if (typeof answer !== "string" || !answer.trim()) fail(`question ${id} has an empty answer`);
  const content = parseContent(r, `question ${id}`);
  const prompt = parsePrompt(r, content, `question ${id}`);
  const explanation = parseExplanation(r, `question ${id}`);
  return { kind: "text", id, content, ...(prompt ? { prompt } : {}), answer: answer as string, ...(fields ? { fields } : {}), ...(explanation ? { explanation } : {}) };
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
  const prompt = parsePrompt(r, content, `question ${id}`);
  const explanation = parseExplanation(r, `question ${id}`);
  return {
    kind: "multipleChoice",
    id,
    content,
    ...(prompt ? { prompt } : {}),
    options: options as string[],
    correctIndex: correctIndex as number,
    ...(explanation ? { explanation } : {}),
  };
}

function parseSortQuestion(r: Record<string, unknown>, id: string): BankQuestion {
  const items = r.items;
  if (!Array.isArray(items) || items.length !== SORT_ITEMS) fail(`question ${id} needs exactly ${SORT_ITEMS} items`);
  if (!(items as unknown[]).every((o) => typeof o === "string" && o.trim())) fail(`question ${id} has an empty item`);
  // Two equal items would make two orders right, and the phone could not tell them apart.
  if (new Set((items as string[]).map((o) => o.trim())).size !== SORT_ITEMS) fail(`question ${id} has the same item twice`);
  const content = parseContent(r, `question ${id}`);
  const prompt = parsePrompt(r, content, `question ${id}`);
  const explanation = parseExplanation(r, `question ${id}`);
  return { kind: "sort", id, content, ...(prompt ? { prompt } : {}), items: items as string[], ...(explanation ? { explanation } : {}) };
}

/** An optional category, trimmed; blank reads as none. */
function parseCategory(v: unknown, id: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") fail(`question ${id} category is not text`);
  const t = (v as string).trim();
  if (Array.from(t).length > MAX_CATEGORY) fail(`question ${id} category is longer than ${MAX_CATEGORY} characters`);
  return t || undefined;
}

function parseQuestions(raw: unknown, where: string, seen: Set<string>, boss = false): BankQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(`${where} has no questions`);
  return (raw as Record<string, unknown>[]).map((r) => {
    const { id, kind } = r;
    if (typeof id !== "string" || !id) fail(`${where} has a question without an id`);
    if (seen.has(id as string)) fail(`duplicate question id ${String(id)}`);
    seen.add(id as string);
    const category = parseCategory(r.category, id as string);
    if (r.difficulty !== undefined && !boss) fail(`question ${String(id)} in ${where} has a difficulty: only a boss question can (a pool is its difficulty)`);
    const difficulty = r.difficulty === undefined ? undefined : parseDifficulty(r.difficulty, `question ${String(id)}`);
    // The default is stored as no difficulty, so a bank that marks nothing below it keeps its older format (bank-store formatOf).
    const extra = { ...(category ? { category } : {}), ...(difficulty && difficulty !== DEFAULT_BOSS_DIFFICULTY ? { difficulty } : {}) };
    // "image" is a legacy top-level kind (pre-D1): it converts to a text-kind question whose
    // content happens to be an image, same as parseContent's imageKey fallback handles it.
    if (kind === "text" || kind === "image") return { ...parseTextQuestion(r, id as string), ...extra };
    if (r.fields !== undefined) fail(`question ${String(id)} has fields, which only a fill-in music question can have`);
    if (kind === "multipleChoice") return { ...parseMultipleChoiceQuestion(r, id as string), ...extra };
    if (kind === "sort") return { ...parseSortQuestion(r, id as string), ...extra };
    return fail(`question ${String(id)} has unknown kind ${String(kind)}`);
  });
}

/** Fields belong to a buzzer phase's music questions only (multi-field.md F1). Returns `qs`. */
function noFields(qs: BankQuestion[], where: string): BankQuestion[] {
  const q = qs.find((x) => x.kind === "text" && x.fields);
  if (q) fail(`question ${q.id} in ${where} has fields: only a buzzer phase's music question (YouTube, sound only) can`);
  return qs;
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
      pools[d] = noFields(parseQuestions(list, `pool ${d}`, seen), `pool ${d}`);
    }
  }
  const rooms = (b!.rooms as Record<string, unknown>[]).map((r, i): BankRoom => {
    const d = parseDifficulty(pooled ? r.difficulty : r.baseDifficulty, `room ${i}`);
    if (pooled && r.questions !== undefined) fail(`room ${i} has questions, but this bank keeps them in pools`);
    if (!pooled) pools[d] = [...pools[d], ...noFields(parseQuestions(r.questions, `room ${i}`, seen), `room ${i}`)];
    return {
      monster: parseMonster(r.monster, `rooms[${i}]`, false),
      difficulty: d,
      reward: parseReward(r.reward, defaultRoomReward(d), `room ${i}`),
    };
  });
  rooms.forEach((r, i) => {
    if (pools[r.difficulty].length === 0) fail(`room ${i} has difficulty ${r.difficulty} but pool ${r.difficulty} has no questions`);
  });
  if (b!.randomMonsters !== undefined && typeof b!.randomMonsters !== "boolean") fail("randomMonsters is not true or false");
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
    const questions = parseQuestions(r.questions, where, seen, true);
    if (r.buzzer !== undefined && typeof r.buzzer !== "boolean") fail(`${where} buzzer is not true or false`);
    if (r.buzzer === true && i === 0) fail("the first boss phase cannot be a buzzer phase");
    if (r.buzzer === true && questions.some((q) => q.kind !== "text")) fail(`${where} is a buzzer phase, so every question in it must be a fill-in`);
    // Fields only on a buzzer phase's music questions (multi-field.md F1).
    noFields(r.buzzer === true ? questions.filter((q) => !isMusicQuestion(q)) : questions, r.buzzer === true ? where : `${where} (not a buzzer phase)`);
    return { name: text(r.name, "name"), rule: text(r.rule, "rule"), maxHp: r.maxHp as number, questions, ...(r.buzzer === true ? { buzzer: true as const } : {}) };
  });
  return {
    pools,
    rooms,
    boss: {
      monster: parseMonster(boss!.monster, "boss", true),
      hitReward: parseReward(boss!.hitReward, DEFAULT_BOSS_HIT_REWARD, "boss"),
      phases,
    },
    ...(b!.randomMonsters === true ? { randomMonsters: true } : {}),
  };
}

/** Save-time only, not in parseBank: a stored bank from before the cap must still load (a load
 * failure falls back to the bundled bank, and the editor's next save would overwrite the real one). */
export function assertSavable(bank: Bank): void {
  const tooMany = allQuestions(bank).find((q) => q.kind === "multipleChoice" && q.options.length > MAX_OPTIONS);
  if (tooMany) fail(`question ${tooMany.id} has more than ${MAX_OPTIONS} options`);
  const hp = bank.boss.phases.findIndex((p) => !Number.isInteger(p.maxHp) || p.maxHp > MAX_BOSS_HP);
  if (hp >= 0) fail(`boss phase ${hp + 1} hp must be a whole number from 1 to ${MAX_BOSS_HP}`);
  // Trimmed, like the editor's check (parseBank trims too; this keeps the two counts the same on their own).
  const longName = bank.boss.phases.findIndex((p) => Array.from(p.name.trim()).length > MAX_PHASE_NAME);
  if (longName >= 0) fail(`boss phase ${longName + 1} name is over ${MAX_PHASE_NAME} characters`);
  const longRule = bank.boss.phases.findIndex((p) => Array.from(p.rule.trim()).length > MAX_PHASE_RULE);
  if (longRule >= 0) fail(`boss phase ${longRule + 1} rule is over ${MAX_PHASE_RULE} characters`);
  // Save time only: a stored bank with a long id must still load, but phones could never answer that question.
  const longId = allQuestions(bank).find((q) => q.id.length > MAX_ID);
  if (longId) fail(`question id ${longId.id} is longer than ${MAX_ID} characters`);
}

/** `monsters`: this game's room monsters by room (gameMonsters); the bank's own when absent. */
export function roomTemplates(bank: Bank, monsters = bank.rooms.map((r) => r.monster)): RoomTemplate[] {
  return bank.rooms.map((r, i) => ({ baseDifficulty: r.difficulty, reward: r.reward, monsterId: monsters[i], dish: catalogMonster(monsters[i]).dish.name }));
}

/** Question ids by pool, `[d - 1]` for difficulty d, the shape GameState.pools keeps. */
export function poolQuestionIds(bank: Bank): string[][] {
  return DIFFICULTIES.map((d) => bank.pools[d].map((q) => q.id));
}

/** A fresh shown order for every multipleChoice and sort question, so a game's answers are not always in the
 * slot the bank wrote them in: `order[shown] = bank index` (Fisher-Yates over `rng`). A sort question's bank
 * order is its answer, so it is never shown in that order. */
export function shuffledOptionOrders(bank: Bank, rng: () => number): Record<string, number[]> {
  const orders: Record<string, number[]> = {};
  for (const q of allQuestions(bank)) {
    if (q.kind === "text") continue;
    const order = (q.kind === "sort" ? q.items : q.options).map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      // Counted down from i, so a constant rng() of 0 (the tests' deterministic rng) keeps the bank order.
      const j = i - Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (q.kind === "sort" && order.every((v, i) => v === i)) order.reverse();
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

export const bossDifficulty = (q: BankQuestion): Difficulty => q.difficulty ?? DEFAULT_BOSS_DIFFICULTY;

/** Each phase's HP and question ids in bank order, the shape GameState's boss keeps (createGame deals easiest first). */
export function bossPhaseStates(bank: Bank): { maxHp: number; questionIds: string[]; buzzer?: true }[] {
  return bank.boss.phases.map((p) => ({ maxHp: p.maxHp, questionIds: p.questions.map((q) => q.id), ...(p.buzzer ? { buzzer: true as const } : {}) }));
}

/** The boss questions that are not difficulty 5, the shape GameState.bossDifficulties keeps. */
export function bossDifficulties(bank: Bank): Record<string, Difficulty> {
  return Object.fromEntries(bossQuestions(bank).flatMap((q) => (bossDifficulty(q) === DEFAULT_BOSS_DIFFICULTY ? [] : [[q.id, bossDifficulty(q)]])));
}

/** Where the persuasion check never comes up (dnd design R-E2): a pool, or the boss, that has questions but no fill-in
 * one, so its turns are all multiple choice. Reads only the bank passed in. */
export function textQuestionGaps(bank: Bank): { difficulties: Difficulty[]; boss: boolean } {
  const noText = (qs: BankQuestion[]) => qs.length > 0 && !qs.some((q) => q.kind === "text");
  return { difficulties: DIFFICULTIES.filter((d) => noText(bank.pools[d])), boss: noText(bossQuestions(bank)) };
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
  return q ? { ...q, boss: true as const, difficulty: bossDifficulty(q) } : undefined;
}

/** The correct answer's display text, regardless of kind — callers that only need to show or compare
 * the answer (HOST_ANSWER, the narration answer-leak check) don't need to branch on kind themselves. */
export function answerText(q: BankQuestion): string {
  if (q.kind === "multipleChoice") return q.options[q.correctIndex];
  if (q.kind === "sort") return q.items.join(" → ");
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
  if (c.kind === "youtube") {
    return {
      kind: "youtube",
      videoId: c.value,
      ...(c.audioOnly ? { audioOnly: true } : {}),
      ...(c.start !== undefined ? { start: c.start } : {}),
      ...(c.end !== undefined ? { end: c.end } : {}),
    };
  }
  // parseMediaContent keeps Instagram out of `content`; an explanation's goes through publicExplanation.
  if (c.kind === "instagram") throw new Error(`question ${questionId}: an Instagram video has no public form`);
  if (!imageBaseUrl || imageBaseUrl.includes("REPLACE-ME")) {
    console.error(JSON.stringify({ event: "image_base_url_missing", questionId }));
  }
  return { kind: "image", url: `${imageBaseUrl}/${c.value}` };
}

/** A question's video as every connection may see it: that it is one, and whether only its sound plays. */
export const hiddenVideo = (c: { audioOnly?: boolean }): HiddenVideo => ({ kind: "youtube", ...(c.audioOnly ? { audioOnly: true as const } : {}) });

/** An Instagram explanation for SCREEN_VIDEO: only the host pages and keyed big screens get it. */
export const instagramVideo = (c: MediaContent): InstagramVideo => ({ kind: "instagram", shortcode: c.value, ...(c.end !== undefined ? { end: c.end } : {}) });

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
  /** This game's variant seed and defeats per catalog id (docs/designs/monster-catalog.md §3). */
  look?: { seed: number; defeats: Record<string, number> },
  /** This game's monster for the room, and its boss (gameMonsters); the bank's own when absent. */
  monsters?: { room?: string; boss: string },
): PublicQuestion | null {
  const found = findQuestion(bank, id);
  if (!found) return null;
  const q = inShownOrder(found, order);
  const m = catalogMonster(q.boss ? (monsters?.boss ?? bank.boss.monster) : (monsters?.room ?? (bank.rooms[roomIndex] ?? bank.rooms[0]).monster));
  const v = look ? variantOf(look.seed, m, look.defeats[m.id] ?? 0) : null;
  const content = publicMediaContent(q.content, imageBaseUrl, q.id);
  return {
    id: q.id,
    // A video's id never rides on the question: its YouTube title gives a music question away (HiddenVideo).
    content: content.kind === "youtube" ? hiddenVideo(content) : content,
    ...(q.prompt ? { prompt: q.prompt } : {}),
    difficulty: q.difficulty,
    boss: q.boss,
    monster: { id: m.id, name: v ? v.title + m.name : m.name, sprite: m.sprite, hue: (m.hue + (v?.hueShift ?? 0)) % 360, ...(v ? { accessory: v.accessory } : {}) },
    ...(q.kind === "multipleChoice" ? { options: q.options } : {}),
    ...(q.kind === "sort" ? { items: sortShownOrder(order).map((i) => q.items[i]) } : {}),
    // The labels only, never the answers (multi-field.md).
    ...(q.kind === "text" && q.fields ? { fields: q.fields.map((f) => f.label) } : {}),
  };
}

/** A sort question's shown order (`[shown] = bank index`): the game's, or, without a valid one (a question added to
 * the bank after the game started), reversed — the bank order is the answer and must never be shown as is.
 * shortcut: reversed is guessable, but only for a question added mid-game; give it a shuffled order if that matters. */
export function sortShownOrder(order: number[] | undefined): number[] {
  const all = Array.from({ length: SORT_ITEMS }, (_, i) => i);
  return order && order.length === SORT_ITEMS && all.every((i) => order.includes(i)) ? order : all.reverse();
}

/** The public-safe explanation for a question that was just answered CORRECTLY — built
 * separately from publicQuestion() (never attached to the in-play question, which would leak it
 * before the answer is judged). Returns undefined when the question has none. See AnswerReveal in
 * lib/protocol.ts and its D2/D5 decisions. */
export function publicExplanation(bank: Bank, id: string, imageBaseUrl: string): PublicMediaContent | HiddenInstagram | undefined {
  const q = findQuestion(bank, id);
  // Its shortcode goes out in SCREEN_VIDEO only, like a question video's id (screen-video-key.md).
  if (q?.explanation?.kind === "instagram") return { kind: "instagram" };
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
