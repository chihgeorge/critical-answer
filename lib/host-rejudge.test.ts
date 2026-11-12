import { describe, expect, it } from "vitest";
import { laterCorrect, questionOrdinals, rejudgeButton, rejudgeChange, undoRow } from "./host-rejudge";

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

  it("labels only the undo's newest 答錯 row as the full 改判答對", () => {
    const undo = { teamId: "a", questionId: "q2" };
    const list = [e(0, "a", "q2", false), e(1, "b", "q2", false), e(2, "a", "q2", false)];
    expect(undoRow(list, list[2], undo)).toBe(true);
    expect(undoRow(list, list[0], undo)).toBe(false); // an older try
    expect(undoRow(list, list[1], undo)).toBe(false); // another team
    expect(undoRow(list, list[2], undefined)).toBe(false); // undo closed
    expect(undoRow([e(0, "a", "q2", true)], e(0, "a", "q2", true), undo)).toBe(false);
    // Value: protects=the label only on the undo's question; fails_when=undoRow drops its questionId check; why_new=no row above has the undo's team on another question; seam=none; no_claim=the room's routing (host-score-rejudge.test.ts).
    expect(undoRow([e(0, "a", "q1", false)], e(0, "a", "q1", false), undo)).toBe(false); // same team, another question
  });

  it("names the button: points either way, or the full 改判答對 on the undo's row", () => {
    // Value: protects=the drawer's button text; fails_when=the undo row shows +N or another row claims the undo; why_new=undoRow alone does not pick the words; seam=none; no_claim=the room's routing (host-score-rejudge.test.ts).
    const list = [e(0, "a", "q1", true), e(1, "a", "q2", false), e(2, "b", "q2", false)];
    const undo = { teamId: "a", questionId: "q2", fields: false };
    expect(rejudgeButton(list, list[0], 25, undo)).toBe("改成答錯（−10）");
    expect(rejudgeButton(list, list[1], 25, undo)).toBe("改成答對（照答對往前走）");
    expect(rejudgeButton(list, list[1], 25, { ...undo, fields: true })).toBe("改成答對（重新逐欄判定）");
    expect(rejudgeButton(list, list[2], 25, undo)).toBe("改成答對（+10）");
    expect(rejudgeButton(list, list[1], 25, undefined)).toBe("改成答對（+10）");
  });
});
