import { describe, it, expect } from "vitest";
import { asTextBank } from "./text-bank";
import type { Bank } from "./question-bank";

describe("asTextBank", () => {
  it("turns multipleChoice into text with the correct option as the answer, keeping the explanation", () => {
    const content = { kind: "text", value: "Q" } as const;
    const explanation = { kind: "text", value: "why" } as const;
    const bank = {
      pools: { 1: [{ kind: "multipleChoice", id: "a", content, options: ["x", "y"], correctIndex: 1, explanation }], 2: [], 3: [], 4: [], 5: [] },
      rooms: [],
      boss: { phases: [{ questions: [{ kind: "text", id: "b", content, answer: "z" }] }] },
    } as unknown as Bank;
    const out = asTextBank(bank);
    expect(out.pools[1][0]).toEqual({ kind: "text", id: "a", content, answer: "y", explanation });
    expect(out.boss.phases[0].questions[0]).toBe(bank.boss.phases[0].questions[0]);
  });

  it("replaces the answer of text questions too when an answer is given, so a test never draws a question with another answer", () => {
    const content = { kind: "text", value: "Q" } as const;
    const bank = {
      pools: { 1: [{ kind: "text", id: "a", content, answer: "重設用答案" }], 2: [], 3: [], 4: [], 5: [] },
      rooms: [],
      boss: { phases: [{ questions: [{ kind: "text", id: "b", content, answer: "z" }] }] },
    } as unknown as Bank;
    const out = asTextBank(bank, "馬");
    expect(out.pools[1][0]).toEqual({ kind: "text", id: "a", content, answer: "馬" });
    expect(out.boss.phases[0].questions[0]).toEqual({ kind: "text", id: "b", content, answer: "馬" });
  });
});
