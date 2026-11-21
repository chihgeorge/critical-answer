// The bank editor's boss-phase filter (docs/designs/boss-bank-categories.md): difficulty and category chips, the
// list in base play order, and moving a question within its difficulty. Pure: the page holds the state.
import { byDifficulty, type Difficulty } from "./game-state";
import { bossDifficulty, type BankQuestion } from "./question-bank";

/** The 未分類 chip's value: a question with no category. */
export const UNCATEGORIZED = "";

export interface PhaseFilter {
  /** null: 全部. */
  difficulty: Difficulty | null;
  /** null: 全部; UNCATEGORIZED: 未分類. */
  category: string | null;
  /** The ids taken at the last chip pick, in their order then; null while both rows are 全部 (the live list). */
  shown: string[] | null;
  page: number;
}

export const NO_FILTER: PhaseFilter = { difficulty: null, category: null, shown: null, page: 0 };

export const isFiltered = (f: PhaseFilter): boolean => f.difficulty !== null || f.category !== null;

type CategoryOf = Record<string, string | undefined>;

const categoryOfQ = (q: BankQuestion, categoryOf: CategoryOf): string => categoryOf[q.id] ?? UNCATEGORIZED;

/** Easiest first, ties in bank order: the order a game deals the phase with 首領題隨機順序 off. */
export const playOrder = (questions: readonly BankQuestion[]): BankQuestion[] => byDifficulty(questions, bossDifficulty);

const matches = (q: BankQuestion, difficulty: Difficulty | null, category: string | null, categoryOf: CategoryOf) =>
  (difficulty === null || bossDifficulty(q) === difficulty) && (category === null || categoryOfQ(q, categoryOf) === category);

/** The rows on screen, in order: the live play order under 全部, else the ids fixed at the pick (minus any gone). */
export function shownList(questions: readonly BankQuestion[], f: PhaseFilter, categoryOf: CategoryOf): BankQuestion[] {
  if (!isFiltered(f)) return playOrder(questions);
  if (!f.shown) return playOrder(questions).filter((q) => matches(q, f.difficulty, f.category, categoryOf));
  const byId = new Map(questions.map((q) => [q.id, q]));
  return f.shown.flatMap((id) => byId.get(id) ?? []);
}

/** Picking a chip (or 全部) takes the matching ids again and opens page 1. */
export function pick(questions: readonly BankQuestion[], f: PhaseFilter, row: "difficulty" | "category", value: Difficulty | string | null, categoryOf: CategoryOf): PhaseFilter {
  const difficulty = row === "difficulty" ? (value as Difficulty | null) : f.difficulty;
  const category = row === "category" ? (value as string | null) : f.category;
  const next = { difficulty, category, shown: null, page: 0 };
  return isFiltered(next) ? { ...next, shown: shownList(questions, next, categoryOf).map((q) => q.id) } : next;
}

/** A question added under a filter joins the shown list, so it stays in view. */
export const withAdded = (f: PhaseFilter, id: string): PhaseFilter => (f.shown && !f.shown.includes(id) ? { ...f, shown: [...f.shown, id] } : f);

/** When the shown list is empty, the category row goes back to 全部 first, then the difficulty row. */
export function fallback(questions: readonly BankQuestion[], f: PhaseFilter, categoryOf: CategoryOf): PhaseFilter {
  if (!isFiltered(f) || shownList(questions, f, categoryOf).length > 0) return f;
  const lessCategory = pick(questions, f, "category", null, categoryOf);
  return shownList(questions, lessCategory, categoryOf).length > 0 ? lessCategory : NO_FILTER;
}

export interface Chip {
  value: Difficulty | string | null;
  label: string;
  count: number;
  picked: boolean;
}

/** One row's chips: 全部 first, then each value with questions under the other row's pick. The picked chip counts the
 * shown list, so it matches the pager's 共 N. Empty when the row is not worth showing (one chip holding every question). */
function row<V extends Difficulty | string>(values: V[], label: (v: V) => string, count: (v: V | null) => number, picked: V | null, shownCount: number): Chip[] {
  const n = (v: V | null) => (v === picked ? shownCount : count(v));
  // A pick whose value no question has any more (edited away under the filter) keeps its chip, so 全部 stays reachable.
  if (picked !== null && !values.includes(picked)) values = [...values, picked];
  const chips = values.filter((v) => count(v) > 0 || v === picked).map((v) => ({ value: v, label: label(v), count: n(v), picked: v === picked }));
  if (chips.length === 1 && !chips[0].picked && chips[0].count === count(null)) return [];
  return chips.length === 0 ? [] : [{ value: null, label: "全部", count: n(null), picked: picked === null }, ...chips];
}

export function difficultyChips(questions: readonly BankQuestion[], f: PhaseFilter, categoryOf: CategoryOf): Chip[] {
  const shownCount = shownList(questions, f, categoryOf).length;
  const values = [...new Set(questions.map(bossDifficulty))].sort((a, b) => a - b);
  const count = (d: Difficulty | null) => questions.filter((q) => matches(q, d, f.category, categoryOf)).length;
  return row(values, (d) => `難度 ${d}`, count, f.difficulty, shownCount);
}

/** Categories in first-seen bank order, 未分類 last. */
export function categoryChips(questions: readonly BankQuestion[], f: PhaseFilter, categoryOf: CategoryOf): Chip[] {
  const shownCount = shownList(questions, f, categoryOf).length;
  const seen = [...new Set(questions.map((q) => categoryOfQ(q, categoryOf)))];
  const values = [...seen.filter((c) => c !== UNCATEGORIZED), ...(seen.includes(UNCATEGORIZED) ? [UNCATEGORIZED] : [])];
  if (!values.some((c) => c !== UNCATEGORIZED)) return [];
  const count = (c: string | null) => questions.filter((q) => matches(q, f.difficulty, c, categoryOf)).length;
  return row(values, (c) => (c === UNCATEGORIZED ? "未分類" : c), count, f.category, shownCount);
}

/** The question this one swaps with on ↑ (-1) / ↓ (+1): its neighbour of the same difficulty in play order; null at
 * either end of its difficulty. */
function swapPartner(questions: readonly BankQuestion[], id: string, delta: -1 | 1): BankQuestion | null {
  const order = playOrder(questions);
  const i = order.findIndex((q) => q.id === id);
  const other = order[i + delta];
  return i >= 0 && other && bossDifficulty(other) === bossDifficulty(order[i]) ? other : null;
}

export const canShift = (questions: readonly BankQuestion[], id: string, delta: -1 | 1): boolean => swapPartner(questions, id, delta) !== null;

/** Swaps the question's bank position with its same-difficulty neighbour; every other question keeps its place. */
export function shiftWithinDifficulty(questions: readonly BankQuestion[], id: string, delta: -1 | 1): BankQuestion[] {
  const other = swapPartner(questions, id, delta);
  if (!other) return [...questions];
  const a = questions.findIndex((q) => q.id === id);
  const b = questions.findIndex((q) => q.id === other.id);
  const next = [...questions];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
