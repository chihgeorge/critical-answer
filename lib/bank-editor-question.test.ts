import { describe, it, expect } from "vitest";
import { blankQuestion, canBeMemory, lostOnKindChange, timingFieldError, withCategory, withContent, withField, withMemory } from "./bank-editor-question";
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

describe("bank editor: timing question fields (timing-tap.md)", () => {
  const clip = { kind: "youtube" as const, value: "3JWTaaS7LdU", start: 170, end: 200, audioOnly: true as const };
  const q = (target: number, extra: Record<string, unknown> = {}) => ({ kind: "timing", id: "b-t", content: clip, target, ...extra }) as BankQuestion;
  it("says what is wrong in the editor's words, and nothing for a good one", () => {
    expect(blankQuestion(base, "timing")).toMatchObject({ kind: "timing", target: 0, category: "動漫" });
    expect(timingFieldError(q(190.35, { label: "蹬" }))).toBeNull();
    expect(timingFieldError(q(169))).toBe("目標要在片段開頭之後");
    expect(timingFieldError(q(198.5))).toBe("目標要比片段結尾早 2 秒以上");
    expect(timingFieldError(q(190, { label: "一二三四五六七八九十一" }))).toBe("label 最多 10 個字");
    expect(timingFieldError(q(1, { content: { kind: "text", value: "x" } }))).toBe("卡點題的內容只能是 YouTube 或上傳的影音");
    expect(timingFieldError(base)).toBeNull();
    expect(timingFieldError(q(190.3501))).toBe("目標秒數最多 3 位小數");
    // Never a memory question: switching to timing drops the setup, and the box is not offered.
    const mem = { ...base, content: clip, prompt: "聽", memory: true } as BankQuestion;
    expect(blankQuestion(mem, "timing")).not.toHaveProperty("memory");
    expect(canBeMemory(q(190))).toBe(false);
  });
});

describe("bank editor: 記憶題 (memory-questions.md)", () => {
  const img: BankQuestion = { kind: "multipleChoice", id: "m1", content: { kind: "image", value: "11111111-2222-3333-4444-555555555555" }, prompt: "幾隻？", options: ["1", "2"], correctIndex: 0 };
  it("ticking writes the default seconds on an image, none on a clip; unticking removes both", () => {
    expect(withMemory(img, true)).toMatchObject({ memory: true, memorySeconds: 10 });
    expect(withMemory({ ...img, content: { kind: "youtube", value: "dQw4w9WgXcQ" } }, true)).not.toHaveProperty("memorySeconds");
    const off = withMemory(withMemory(img, true), false);
    expect(off).not.toHaveProperty("memory");
    expect(off).not.toHaveProperty("memorySeconds");
  });
  it("a content switch keeps the setup valid; a kind switch carries it", () => {
    const on = withMemory(img, true);
    expect(withContent(on, { kind: "text", value: "題目" })).not.toHaveProperty("memory");
    expect(withContent(on, { kind: "audio", value: "11111111-2222-3333-4444-555555555555" })).toMatchObject({ memory: true });
    expect(withContent(on, { kind: "audio", value: "11111111-2222-3333-4444-555555555555" })).not.toHaveProperty("memorySeconds");
    expect(withContent(withMemory({ ...img, content: { kind: "youtube", value: "dQw4w9WgXcQ" } }, true), img.content)).toMatchObject({ memorySeconds: 10 });
    expect(blankQuestion(on, "sort")).toMatchObject({ memory: true, memorySeconds: 10 });
    expect(canBeMemory(img)).toBe(true);
    expect(canBeMemory({ ...img, content: { kind: "text", value: "x" } })).toBe(false);
  });
});

describe("bank editor: changing kind keeps the answer (editor-ux #6)", () => {
  const mc = (options: string[], correctIndex: number) => ({ ...base, kind: "multipleChoice", options, correctIndex }) as BankQuestion;
  const sort = (items: string[]) => ({ ...base, kind: "sort", items }) as BankQuestion;
  it("carries the answer where the new kind can hold it", () => {
    expect(blankQuestion(base, "multipleChoice")).toMatchObject({ options: ["答案", ""], correctIndex: 0 });
    expect(blankQuestion({ ...base, answer: " " }, "multipleChoice")).toMatchObject({ options: ["", ""], correctIndex: -1 });
    expect(blankQuestion(base, "sort")).toMatchObject({ items: ["答案", "", "", ""] });
    expect(blankQuestion(mc(["甲", "乙", "丙"], 1), "text")).toMatchObject({ answer: "乙" });
    expect(blankQuestion(mc(["甲", "乙"], -1), "text")).toMatchObject({ answer: "" });
    expect(blankQuestion(mc(["甲", "乙", "丙"], 1), "sort")).toMatchObject({ items: ["甲", "乙", "丙", ""] });
    expect(blankQuestion(sort(["甲", "", "丙", "丁"]), "multipleChoice")).toMatchObject({ options: ["甲", "丙", "丁"], correctIndex: -1 });
    expect(blankQuestion(sort(["甲", "", "", ""]), "multipleChoice")).toMatchObject({ options: ["甲", ""] });
    expect(blankQuestion(sort(["甲", "乙", "丙", "丁"]), "text")).toMatchObject({ answer: "" });
  });

  it("says when a change drops something typed, and only then", () => {
    expect(lostOnKindChange(base, "multipleChoice")).toBe(false);
    expect(lostOnKindChange(base, "sort")).toBe(false);
    expect(lostOnKindChange(base, "timing")).toBe(true);
    expect(lostOnKindChange({ ...base, answer: "" }, "timing")).toBe(false);
    expect(lostOnKindChange(mc(["甲", ""], 0), "text")).toBe(false);
    expect(lostOnKindChange(mc(["甲", "乙"], 0), "text")).toBe(true);
    expect(lostOnKindChange(mc(["甲", "乙", "丙", "丁"], 0), "sort")).toBe(false);
    expect(lostOnKindChange(sort(["甲", "乙", "丙", "丁"]), "multipleChoice")).toBe(false);
    expect(lostOnKindChange(sort(["甲", "", "", ""]), "text")).toBe(true);
    expect(lostOnKindChange({ ...base, fields: [{ label: "歌名", answer: "晴天" }, { label: "歌手", answer: "周杰倫" }] }, "multipleChoice")).toBe(true);
    expect(lostOnKindChange({ kind: "timing", id: "t", content: base.content, target: 3 } as BankQuestion, "text")).toBe(true);
    expect(lostOnKindChange({ kind: "timing", id: "t", content: base.content, target: 0 } as BankQuestion, "text")).toBe(false);
  });
});
