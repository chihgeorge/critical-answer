import type { Bank, BankQuestion } from "./question-bank";

/** Test helper (vitest and e2e/answer.ts): the same bank with every multipleChoice question turned into a text question whose
 * answer is the correct option. The bundled bank is all multipleChoice, which the host can't judge,
 * so room tests that drive turns with HOST_JUDGE play this version of it. `answer` replaces every answer when given. */
export function asTextBank(bank: Bank, answer?: string): Bank {
  const toText = (q: BankQuestion): BankQuestion =>
    q.kind === "multipleChoice"
      ? { kind: "text", id: q.id, content: q.content, answer: answer ?? q.options[q.correctIndex], ...(q.explanation ? { explanation: q.explanation } : {}) }
      : q;
  return {
    ...bank,
    pools: Object.fromEntries(Object.entries(bank.pools).map(([d, qs]) => [d, qs.map(toText)])) as Bank["pools"],
    boss: { ...bank.boss, phases: bank.boss.phases.map((p) => ({ ...p, questions: p.questions.map(toText) })) },
  };
}
