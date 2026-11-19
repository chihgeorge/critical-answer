// The bank editor's question list (app/bank-editor/page.tsx, editor-ux #2 and #3): each question's one-line summary,
// the whole-bank search, and moving, copying and deleting a question with undo. Pure, so it has unit tests.
// Client-safe: types and helpers only, never the parsed bank (CLAUDE.md, check:bundle).
import { DIFFICULTIES, type Bank, type BankQuestion } from "./question-bank";
import { DEFAULT_BOSS_DIFFICULTY, type Difficulty } from "./game-state";
import { placementError, questionName, type EditorTab } from "./bank-editor-problems";
import { formatSongTime } from "./tap-clock";

/** A group of questions: a difficulty pool, or one boss phase (0-based). */
export type Location = { kind: "pool"; difficulty: Difficulty } | { kind: "boss"; phase: number };

export const questionsAt = (b: Bank, loc: Location): BankQuestion[] => (loc.kind === "boss" ? (b.boss.phases[loc.phase]?.questions ?? []) : b.pools[loc.difficulty]);

export const withQuestions = (b: Bank, loc: Location, questions: BankQuestion[]): Bank =>
  loc.kind === "boss"
    ? { ...b, boss: { ...b.boss, phases: b.boss.phases.map((p, i) => (i === loc.phase ? { ...p, questions } : p)) } }
    : { ...b, pools: { ...b.pools, [loc.difficulty]: questions } };

export const groupName = (loc: Location): string => (loc.kind === "pool" ? `難度 ${loc.difficulty}` : `首領第 ${loc.phase + 1} 階段`);
export const tabOf = (loc: Location): EditorTab => (loc.kind === "pool" ? loc.difficulty : "boss");
export const sameGroup = (a: Location, b: Location): boolean =>
  a.kind === "pool" ? b.kind === "pool" && a.difficulty === b.difficulty : b.kind === "boss" && a.phase === b.phase;

/** Every group in tab order: the five pools, then each boss phase. */
export const allGroups = (b: Bank): Location[] => [
  ...DIFFICULTIES.map((difficulty): Location => ({ kind: "pool", difficulty })),
  ...b.boss.phases.map((_, phase): Location => ({ kind: "boss", phase })),
];

const KIND_NAME: Record<BankQuestion["kind"], string> = { text: "填空", multipleChoice: "選擇", sort: "排序", timing: "卡點" };
const MEDIA_MARK: Record<BankQuestion["content"]["kind"], string> = { text: "", image: "🖼", youtube: "▶", video: "▶", audio: "🔊", instagram: "📷" };

/** One question's summary row: its kind, a media mark, its name (questionName) and its answer, or what the answer still lacks. */
export function questionSummary(q: BankQuestion): { kind: string; media: string; name: string; answer: string } {
  const answer =
    q.kind === "text" ? q.answer.trim()
    : q.kind === "multipleChoice" ? (q.options[q.correctIndex]?.trim() ? `✓ ${q.options[q.correctIndex].trim()}` : "沒標正解")
    : q.kind === "sort" ? (q.items.some((i) => i.trim()) ? q.items.map((i) => i.trim()).join("→") : "")
    : Number.isFinite(q.target) && q.target > 0 ? formatSongTime(q.target * 1000) : "";
  return { kind: KIND_NAME[q.kind], media: MEDIA_MARK[q.content.kind], name: questionName(q), answer };
}

/** The text a search looks at: the question, 題幹, answer and answer fields, options, sort items, a text explanation
 * and the category. Never a media key or link. */
function searchText(q: BankQuestion): string[] {
  return [
    q.content.kind === "text" ? q.content.value : "",
    q.prompt ?? "",
    q.kind === "text" ? q.answer : "",
    ...(q.kind === "text" ? (q.fields ?? []).flatMap((f) => [f.label, f.answer]) : []),
    ...(q.kind === "multipleChoice" ? q.options : []),
    ...(q.kind === "sort" ? q.items : []),
    q.kind === "timing" ? (q.label ?? "") : "",
    q.explanation?.kind === "text" ? q.explanation.value : "",
    q.category ?? "",
  ];
}

export interface SearchHit {
  tab: EditorTab;
  questionId: string;
  /** 「難度 2 第 5 題」 */
  where: string;
  name: string;
}

export const SEARCH_LIMIT = 20;

/** Questions anywhere in the bank whose text holds `query` (case-insensitive), in tab order: at most SEARCH_LIMIT + 1, so a caller can tell "more than SEARCH_LIMIT" apart from exactly SEARCH_LIMIT. */
export function searchBank(bank: Bank, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const loc of allGroups(bank)) {
    for (const [i, q] of questionsAt(bank, loc).entries()) {
      if (hits.length > SEARCH_LIMIT) return hits;
      if (searchText(q).some((t) => t.toLowerCase().includes(needle))) hits.push({ tab: tabOf(loc), questionId: q.id, where: `${groupName(loc)} 第 ${i + 1} 題`, name: questionName(q) });
    }
  }
  return hits;
}

/** Why `q` may not move into group `to`, or null (the placement rules a save checks). */
export function moveRefusal(bank: Bank, q: BankQuestion, to: Location): string | null {
  if (to.kind === "pool") return placementError(q, false);
  const phase = bank.boss.phases[to.phase];
  return phase ? placementError(q, !!phase.buzzer) : "沒有這個階段";
}

/** `q` as it fits group `to`: a pool question has no difficulty of its own (parseBank refuses one), and a pool question
 * moving to the boss keeps its pool's difficulty as its own (the default, DEFAULT_BOSS_DIFFICULTY, is stored as none). */
function placed(q: BankQuestion, from: Location, to: Location): BankQuestion {
  const next = { ...q };
  delete next.difficulty;
  if (to.kind === "pool") return next;
  const d = from.kind === "pool" ? from.difficulty : q.difficulty;
  return d !== undefined && d !== DEFAULT_BOSS_DIFFICULTY ? { ...next, difficulty: d } : next;
}

/** The bank with question `id` moved from group `from` to the end of group `to`, keeping its id (ids are unique
 * across the bank, so it never clashes there). Unchanged when the question is not in `from`. */
export function moveQuestion(bank: Bank, from: Location, id: string, to: Location): Bank {
  const q = questionsAt(bank, from).find((x) => x.id === id);
  if (!q || sameGroup(from, to)) return bank;
  const without = withQuestions(bank, from, questionsAt(bank, from).filter((x) => x.id !== id));
  return withQuestions(without, to, [...questionsAt(without, to), placed(q, from, to)]);
}

/** The bank with question `id` one place up (-1) or down (+1) in its group; unchanged at either end. */
export function shiftQuestion(bank: Bank, loc: Location, id: string, delta: -1 | 1): Bank {
  const list = questionsAt(bank, loc);
  const i = list.findIndex((q) => q.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return bank;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return withQuestions(bank, loc, next);
}

/** A new question id for group `loc` (「p2-1a2b3c4d」 or 「boss-1a2b3c4d」) that no question in the bank has yet. */
export function newQuestionId(bank: Bank, loc: Location, random: () => string = () => crypto.randomUUID().slice(0, 8)): string {
  const taken = new Set(allGroups(bank).flatMap((g) => questionsAt(bank, g).map((q) => q.id)));
  const prefix = loc.kind === "boss" ? "boss" : `p${loc.difficulty}`;
  for (;;) {
    const id = `${prefix}-${random()}`;
    if (!taken.has(id)) return id;
  }
}

/** The bank with a copy of question `id` right after it, under `newId`. */
export function copyQuestion(bank: Bank, loc: Location, id: string, newId: string): Bank {
  const list = questionsAt(bank, loc);
  const i = list.findIndex((q) => q.id === id);
  if (i < 0) return bank;
  return withQuestions(bank, loc, [...list.slice(0, i + 1), { ...structuredClone(list[i]), id: newId }, ...list.slice(i + 1)]);
}

/** A deleted question and where it was, for 復原. */
export interface Removed {
  loc: Location;
  index: number;
  question: BankQuestion;
}

/** The bank without question `id`, and what 復原 needs to put it back; null when it is not there. */
export function removeQuestion(bank: Bank, loc: Location, id: string): { bank: Bank; removed: Removed } | null {
  const list = questionsAt(bank, loc);
  const index = list.findIndex((q) => q.id === id);
  if (index < 0) return null;
  return { bank: withQuestions(bank, loc, list.filter((q) => q.id !== id)), removed: { loc, index, question: list[index] } };
}

/** The bank with a removed question back at its place (or its group's end, when the group got shorter since). */
export function restoreQuestion(bank: Bank, r: Removed): Bank {
  if (r.loc.kind === "boss" && !bank.boss.phases[r.loc.phase]) return bank;
  const list = questionsAt(bank, r.loc);
  if (list.some((q) => q.id === r.question.id)) return bank;
  const at = Math.min(r.index, list.length);
  return withQuestions(bank, r.loc, [...list.slice(0, at), r.question, ...list.slice(at)]);
}

/** restoreQuestion, but `saved` itself when that puts the bank back as last loaded or saved: the editor marks unsaved
 * edits by object identity (`bank !== saved`), so a 復原 of the only change shows 沒有修改 again. */
export function restoreToSaved(bank: Bank, r: Removed, saved: Bank | null): Bank {
  const next = restoreQuestion(bank, r);
  return saved && JSON.stringify(next) === JSON.stringify(saved) ? saved : next;
}

/** The bank an earlier 另存成新題庫 made but could not save into, while it is still listed: pressing it again saves into
 * that one instead of making another empty bank. */
export const saveAsLeftover = (made: string | null, banks: { id: string }[]): string | null => (made !== null && banks.some((b) => b.id === made) ? made : null);
