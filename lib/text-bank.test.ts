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
      boss: { questions: [{ kind: "text", id: "b", content, answer: "z" }] },
    } as unknown as Bank;
    const out = asTextBank(bank);
    expect(out.pools[1][0]).toEqual({ kind: "text", id: "a", content, answer: "y", explanation });
    expect(out.boss.questions[0]).toBe(bank.boss.questions[0]);
  });
});
