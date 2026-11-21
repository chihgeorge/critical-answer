// The bank editor's boss-phase filter (docs/designs/boss-bank-categories.md): difficulty and category chips over the
// phase in bank order (its play order). Pure: the page holds the state.
import type { Difficulty } from "./game-state";
import { bossDifficulty, type BankQuestion } from "./question-bank";

/** The 未分類 chip's value: a question with no category. */
export const UNCATEGORIZED = "";

export interface PhaseFilter {
  /** null: 全部. */
  difficulty: Difficulty | null;
  /** null: 全部; UNCATEGORIZED: 未分類. */
  category: string | null;
  /** The ids taken at the last chip pick; null while both rows are 全部 (the live list). */
  shown: string[] | null;
  page: number;
}

export const NO_FILTER: PhaseFilter = { difficulty: null, category: null, shown: null, page: 0 };

export const isFiltered = (f: PhaseFilter): boolean => f.difficulty !== null || f.category !== null;

type CategoryOf = Record<string, string | undefined>;

const categoryOfQ = (q: BankQuestion, categoryOf: CategoryOf): string => categoryOf[q.id] ?? UNCATEGORIZED;

const matches = (q: BankQuestion, difficulty: Difficulty | null, category: string | null, categoryOf: CategoryOf) =>
  (difficulty === null || bossDifficulty(q) === difficulty) && (category === null || categoryOfQ(q, categoryOf) === category);

/** The rows on screen, in bank order: every question under 全部, else the ids fixed at the pick (minus any gone), so
 * a ↑/↓ under a filter shows right away. */
export function shownList(questions: readonly BankQuestion[], f: PhaseFilter, categoryOf: CategoryOf): BankQuestion[] {
  if (!isFiltered(f)) return [...questions];
  if (!f.shown) return questions.filter((q) => matches(q, f.difficulty, f.category, categoryOf));
  const shown = new Set(f.shown);
  return questions.filter((q) => shown.has(q.id));
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
