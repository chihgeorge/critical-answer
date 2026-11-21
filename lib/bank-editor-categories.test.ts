import { describe, expect, it } from "vitest";
import type { Difficulty } from "./game-state";
import type { BankQuestion } from "./question-bank";
import {
  NO_FILTER,
  UNCATEGORIZED,
  canShift,
  categoryChips,
  difficultyChips,
  fallback,
  pick,
  playOrder,
  shiftWithinDifficulty,
  shownList,
  withAdded,
} from "./bank-editor-categories";

const q = (id: string, difficulty?: Difficulty, category?: string): BankQuestion =>
  ({ id, kind: "text", content: { kind: "text", value: id }, answer: id, ...(difficulty ? { difficulty } : {}), ...(category ? { category } : {}) }) as BankQuestion;

// Bank order: a(動漫,3) b(電影,1) c(動漫,1) d(none,3) e(動漫,5)
const qs = [q("a", undefined, "動漫"), q("b", 1, "電影"), q("c", 1, "動漫"), q("d"), q("e", 5, "動漫")];
const cats = Object.fromEntries(qs.map((x) => [x.id, x.category]));
const ids = (list: BankQuestion[]) => list.map((x) => x.id);
const summary = (chips: { label: string; count: number; picked: boolean }[]) => chips.map((c) => `${c.picked ? "*" : ""}${c.label}:${c.count}`);

describe("bank editor boss filter", () => {
  it("lists a phase easiest first, ties in bank order, unset difficulty as 3", () => {
    expect(ids(playOrder(qs))).toEqual(["b", "c", "a", "d", "e"]);
    expect(ids(shownList(qs, NO_FILTER, cats))).toEqual(["b", "c", "a", "d", "e"]);
  });

  it("counts each row's chips under the other row's pick, categories first-seen with 未分類 last", () => {
    expect(summary(difficultyChips(qs, NO_FILTER, cats))).toEqual(["*全部:5", "難度 1:2", "難度 3:2", "難度 5:1"]);
    expect(summary(categoryChips(qs, NO_FILTER, cats))).toEqual(["*全部:5", "動漫:3", "電影:1", "未分類:1"]);
    const anime = pick(qs, NO_FILTER, "category", "動漫", cats);
    expect(summary(difficultyChips(qs, anime, cats))).toEqual(["*全部:3", "難度 1:1", "難度 3:1", "難度 5:1"]);
    const both = pick(qs, anime, "difficulty", 1, cats);
    expect(ids(shownList(qs, both, cats))).toEqual(["c"]);
    // 未分類 has no difficulty-1 question, so its chip is hidden.
    expect(summary(categoryChips(qs, both, cats))).toEqual(["全部:2", "*動漫:1", "電影:1"]);
  });

  it("picks open page 1 and the picked chip counts the shown list", () => {
    const f = pick(qs, { ...NO_FILTER, page: 3 }, "category", UNCATEGORIZED, cats);
    expect(f.page).toBe(0);
    expect(f.shown).toEqual(["d"]);
    expect(categoryChips(qs, f, cats).find((c) => c.picked)?.count).toBe(shownList(qs, f, cats).length);
    expect(pick(qs, f, "category", null, cats)).toEqual(NO_FILTER);
  });

  it("keeps the shown rows and their order after an edit under a filter, and adds new ones", () => {
    const f = pick(qs, NO_FILTER, "category", "動漫", cats);
    expect(ids(shownList(qs, f, cats))).toEqual(["c", "a", "e"]);
    // c moves to difficulty 5 and loses its category: it stays, in the same place.
    const edited = qs.map((x) => (x.id === "c" ? { ...x, difficulty: 5 as const, category: undefined } : x));
    const editedCats = { ...cats, c: undefined };
    expect(ids(shownList(edited, f, editedCats))).toEqual(["c", "a", "e"]);
    expect(categoryChips(edited, f, editedCats).find((c) => c.picked)?.count).toBe(3);
    const added = [...qs, q("n")];
    expect(ids(shownList(added, withAdded(f, "n"), cats))).toEqual(["c", "a", "e", "n"]);
  });

  it("drops deleted or undone ids, and falls back category first, then difficulty", () => {
    const f = pick(qs, pick(qs, NO_FILTER, "category", "電影", cats), "difficulty", 1, cats);
    const gone = qs.filter((x) => x.id !== "b");
    expect(shownList(gone, f, cats)).toEqual([]);
    const back = fallback(gone, f, cats);
    expect(back.category).toBeNull();
    expect(back.difficulty).toBe(1);
    expect(ids(shownList(gone, back, cats))).toEqual(["c"]);
    expect(fallback([q("z", 4)], f, cats)).toEqual(NO_FILTER);
    expect(fallback(qs, f, cats)).toBe(f);
  });

  it("hides a row whose one chip holds every question, unless picked; no category row without categories", () => {
    const flat = [q("x"), q("y")];
    expect(difficultyChips(flat, NO_FILTER, {})).toEqual([]);
    expect(categoryChips(flat, NO_FILTER, {})).toEqual([]);
    const picked = { ...NO_FILTER, difficulty: 3 as const, shown: ["x", "y"] };
    expect(summary(difficultyChips(flat, picked, {}))).toEqual(["全部:2", "*難度 3:2"]);
    // The picked value edited away under the filter: its chip stays, so 全部 can still be tapped.
    const gone = { ...NO_FILTER, difficulty: 5 as const, shown: ["x"] };
    expect(summary(difficultyChips(flat, gone, {}))).toEqual(["全部:2", "難度 3:2", "*難度 5:1"]);
    const goneCat = { ...NO_FILTER, category: "動漫", shown: ["x"] };
    expect(summary(categoryChips([q("x", undefined, "電影"), q("y", undefined, "電影")], goneCat, { x: "電影", y: "電影" }))).toEqual(["全部:2", "電影:2", "*動漫:1"]);
  });

  it("↑/↓ swap only within one difficulty and leave every other question in place", () => {
    expect(canShift(qs, "b", -1)).toBe(false); // first of difficulty 1
    expect(canShift(qs, "c", 1)).toBe(false); // last of difficulty 1
    expect(canShift(qs, "a", 1)).toBe(true);
    expect(ids(shiftWithinDifficulty(qs, "a", 1))).toEqual(["d", "b", "c", "a", "e"]);
    expect(ids(shiftWithinDifficulty(qs, "c", -1))).toEqual(["a", "c", "b", "d", "e"]);
    expect(ids(shiftWithinDifficulty(qs, "e", 1))).toEqual(ids(qs));
  });
});
