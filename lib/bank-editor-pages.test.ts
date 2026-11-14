import { describe, it, expect } from "vitest";
import { pageOf, questionPage } from "./bank-editor-pages";

describe("questionPage", () => {
  it("slices 10 at a time and counts the pages", () => {
    expect(questionPage(34, 0)).toEqual({ page: 0, pages: 4, start: 0, end: 10 });
    expect(questionPage(34, 1)).toEqual({ page: 1, pages: 4, start: 10, end: 20 });
    expect(questionPage(34, 3)).toEqual({ page: 3, pages: 4, start: 30, end: 34 });
    expect(questionPage(20, 1)).toEqual({ page: 1, pages: 2, start: 10, end: 20 });
  });
  it("clamps a page past the end (the last page's only question was deleted) and below 0", () => {
    expect(questionPage(20, 2)).toEqual({ page: 1, pages: 2, start: 10, end: 20 });
    expect(questionPage(5, -1)).toEqual({ page: 0, pages: 1, start: 0, end: 5 });
  });
  it("gives an empty group one empty page", () => {
    expect(questionPage(0, 3)).toEqual({ page: 0, pages: 1, start: 0, end: 0 });
  });
});

describe("pageOf", () => {
  it("puts the 11th question (index 10) on page 2, the 10th on page 1", () => {
    expect(pageOf(9)).toBe(0);
    expect(pageOf(10)).toBe(1);
    expect(pageOf(34)).toBe(3);
  });
});
