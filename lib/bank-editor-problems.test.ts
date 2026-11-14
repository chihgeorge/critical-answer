import { describe, it, expect } from "vitest";
import { bankProblems, locateQuestion, questionName, serverProblem } from "./bank-editor-problems";
import { BANK } from "./question-bank-data";
import type { Bank, BankQuestion } from "./question-bank";

const text = (id: string, value: string, answer = "答案"): BankQuestion => ({ kind: "text", id, content: { kind: "text", value }, answer });
/** The bundled bank with pool 2 and the boss replaced, so places and numbers are known. */
function bank(pool2: BankQuestion[], phases?: Bank["boss"]["phases"]): Bank {
  return {
    ...BANK,
    pools: { ...BANK.pools, 2: pool2 },
    boss: { ...BANK.boss, phases: phases ?? [{ name: "", rule: "", maxHp: 3, questions: [text("boss-1", "首領題")] }] },
  };
}
const twelve = (): BankQuestion[] => Array.from({ length: 12 }, (_, i) => text(`p2-${i}`, `第 ${i + 1} 題`));

describe("bank editor: save problems name the place, never the id", () => {
  it("the bundled bank has none", () => {
    expect(bankProblems(BANK)).toEqual([]);
  });

  it("finds every broken question, in tab order, with its group and number and the id kept for the jump", () => {
    const pool = twelve();
    pool[11] = text("p2-29b7ed6d", "");
    pool[3] = { ...text("p2-3", "選擇題"), kind: "multipleChoice", options: ["甲", "乙"], correctIndex: -1 } as BankQuestion;
    const problems = bankProblems(bank(pool));
    expect(problems).toEqual([
      { tab: 2, questionId: "p2-3", message: "難度 2 第 4 題「選擇題」還沒標記正解" },
      { tab: 2, questionId: "p2-29b7ed6d", message: "難度 2 第 12 題「（空白題）」的內容還沒填完（是空的）" },
    ]);
    expect(problems.map((p) => p.message).join()).not.toContain("29b7ed6d");
  });

  it("a fill-in with an empty answer and a boss phase with no questions are caught before the server", () => {
    const pool = twelve();
    pool[0] = text("p2-0", "第 1 題", "  ");
    const problems = bankProblems(bank(pool, [{ name: "", rule: "", maxHp: 3, questions: [text("boss-1", "首領題")] }, { name: "二", rule: "規則", maxHp: 3, questions: [] }]));
    expect(problems).toEqual([
      { tab: 2, questionId: "p2-0", message: "難度 2 第 1 題「第 1 題」的答案是空白" },
      { tab: "boss", phase: 1, message: "首領第 2 階段還沒有題目" },
    ]);
  });

  it("a room on an empty pool points at that pool", () => {
    expect(bankProblems(bank([]))[0]).toMatchObject({ tab: 2, message: expect.stringMatching(/難度 2 題庫沒有題目$/) });
  });

  it("a question is named by its text, else its 題幹, else its media, cut at 20 characters", () => {
    expect(questionName(text("a", "一二三四五六七八九十一二三四五六七八九十一"))).toBe("一二三四五六七八九十一二三四五六七八九十…");
    const image: BankQuestion = { kind: "text", id: "b", content: { kind: "image", value: "0b0e8f4c-uuid" }, answer: "x" };
    expect(questionName(image)).toBe("（圖片題）");
    expect(questionName({ ...image, prompt: "這是誰？" })).toBe("這是誰？");
  });
});

describe("bank editor: where a question is", () => {
  it("finds pool and boss questions, and null once gone", () => {
    const b = bank(twelve(), [{ name: "", rule: "", maxHp: 3, questions: [text("boss-1", "甲")] }, { name: "二", rule: "規", maxHp: 3, questions: [text("boss-2", "乙"), text("boss-3", "丙")] }]);
    expect(locateQuestion(b, "p2-11")).toMatchObject({ tab: 2, index: 11, where: "難度 2 第 12 題" });
    expect(locateQuestion(b, "boss-3")).toMatchObject({ tab: "boss", index: 1, where: "首領第 2 階段第 2 題" });
    expect(locateQuestion(b, "nope")).toBeNull();
  });
});

describe("bank editor: a server refusal in Chinese", () => {
  const b = bank(twelve());
  it("names the question's place for a known parseBank reason and keeps the id for the jump", () => {
    expect(serverProblem(b, 400, "Invalid question bank: question p2-4 has an empty answer")).toEqual({ tab: 2, questionId: "p2-4", message: "伺服器不接受：難度 2 第 5 題「第 5 題」的答案是空白" });
  });
  it("keeps an unknown reason as detail, after a Chinese lead", () => {
    expect(serverProblem(b, 400, "Invalid question bank: question p2-0: target 3 is before the clip start 5")).toMatchObject({
      tab: 2,
      message: "伺服器不接受這份題庫：難度 2 第 1 題「第 1 題」（question p2-0: target 3 is before the clip start 5）",
    });
    expect(serverProblem(b, 400, "Invalid JSON")).toEqual({ message: "伺服器不接受這份題庫（Invalid JSON）" });
  });
  it("a rejected key or a too-large bank says so, whatever the body", () => {
    expect(serverProblem(b, 403, "Forbidden").message).toMatch(/^站長金鑰不對/);
    expect(serverProblem(b, 413, "Payload too large").message).toMatch(/^題庫太大/);
  });
  // Regression: a save into a bank deleted in another tab showed the raw "bank not found: <id>" (/qa 2026-11-14)
  it("a bank deleted elsewhere says so in Chinese, never its id", () => {
    expect(serverProblem(b, 404, "bank not found: 3a95c433-dade-445d-b6ef-857083cf3529")).toEqual({ message: "這份題庫已經在別的分頁或裝置被刪掉了，存不進去。" });
  });
});
