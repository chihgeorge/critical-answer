import { describe, it, expect } from "vitest";
import { blankQuestion, withCategory, withField } from "./bank-editor-question";
import { allQuestions, parseBank, type BankQuestion } from "./question-bank";

const base: BankQuestion = { kind: "text", id: "b-a", content: { kind: "text", value: "前奏" }, answer: "答案", category: "動漫" };
/** What 儲存全部變更 sends and the next load parses back. */
const saveAndReload = (q: BankQuestion) =>
  allQuestions(parseBank(JSON.parse(JSON.stringify({ rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [q] }], boss: { monster: "dragon", phases: [{ maxHp: 1, questions: [{ ...base, id: "b-z" }] }] } }))))[0];

describe("bank editor: question category (boss-music-buzzer.md M5)", () => {
  it("category survives a kind change and save/reload, and a blank category is removed", () => {
    for (const kind of ["multipleChoice", "sort", "text"] as const) expect(blankQuestion(base, kind).category).toBe("動漫");
    for (const kind of ["multipleChoice", "sort", "text"] as const) expect(blankQuestion({ ...base, difficulty: 2 }, kind).difficulty).toBe(2);
    const back = { ...blankQuestion(blankQuestion(base, "sort"), "text"), answer: "答案" } as BankQuestion;
    expect(saveAndReload(back).category).toBe("動漫");
    const blank = withCategory(base, "   ");
    expect("category" in blank).toBe(false);
    expect(withCategory(blank, "遊戲").category).toBe("遊戲");
    // A raw blank category (an older editor, a hand-edited file) is read as none.
    expect(saveAndReload({ ...base, category: "  " }).category).toBeUndefined();
  });

  it("withField edits one field and keeps the answer as the fields joined (multi-field.md F1)", () => {
    const q: BankQuestion = { ...base, answer: "晴天／周杰倫", fields: [{ label: "歌名", answer: "晴天" }, { label: "歌手", answer: "周杰倫" }] };
    const next = withField(q, 1, { answer: "Jay" });
    expect(next).toMatchObject({ answer: "晴天／Jay", fields: [{ label: "歌名", answer: "晴天" }, { label: "歌手", answer: "Jay" }] });
    expect(withField(base, 0, { answer: "x" })).toBe(base);
  });
});
