import type { Bank, BankQuestion } from "./question-bank";

/** Test helper (vitest and e2e/answer.ts): the same bank with every multipleChoice question turned into a text question whose
 * answer is the correct option. The bundled bank is all multipleChoice, which the host can't judge,
 * so room tests that drive turns with HOST_JUDGE play this version of it. */
export function asTextBank(bank: Bank): Bank {
  const toText = (q: BankQuestion): BankQuestion =>
    q.kind === "multipleChoice" ? { kind: "text", id: q.id, content: q.content, answer: q.options[q.correctIndex] } : q;
  return {
    ...bank,
    rooms: bank.rooms.map((r) => ({ ...r, questions: r.questions.map(toText) })),
    boss: { ...bank.boss, questions: bank.boss.questions.map(toText) },
  };
}
