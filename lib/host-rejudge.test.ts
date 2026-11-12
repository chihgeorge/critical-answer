import { describe, expect, it } from "vitest";
import { laterCorrect, questionOrdinals, rejudgeChange } from "./host-rejudge";

const e = (index: number, teamId: string, questionId: string, correct: boolean) => ({ index, teamId, questionId, correct, points: 10 });

describe("改判 list helpers", () => {
  it("numbers questions by first judgment, shared across teams", () => {
    const n = questionOrdinals([{ questionId: "q7" }, { questionId: "q7" }, { questionId: "q2" }, { questionId: "q7" }]);
    expect([...n]).toEqual([["q7", 1], ["q2", 2]]);
  });

  it("shows what a press really moves: the 0 floor going down, taken coming back", () => {
    expect(rejudgeChange({ correct: true, points: 10 }, 25)).toBe(-10);
    expect(rejudgeChange({ correct: true, points: 10 }, 3)).toBe(-3);
    expect(rejudgeChange({ correct: false, points: 12 }, 0)).toBe(12);
    expect(rejudgeChange({ correct: false, points: 10, taken: 3 }, 0)).toBe(3);
    expect(rejudgeChange({ correct: true, points: 10, taken: 3 }, 50)).toBe(-3);
  });

  it("tags an 答錯 row only when the same team answered the same question right later", () => {
    const list = [e(0, "a", "q1", false), e(1, "b", "q1", true), e(2, "a", "q1", true), e(3, "a", "q2", false)];
    expect(laterCorrect(list, list[0])).toBe(true);
    expect(laterCorrect(list, list[3])).toBe(false);
    expect(laterCorrect(list, list[2])).toBe(false);
    expect(laterCorrect([e(0, "a", "q1", false), e(1, "b", "q1", true)], e(0, "a", "q1", false))).toBe(false);
  });
});
