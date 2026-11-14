import { describe, it, expect } from "vitest";
import { copyQuestion, moveQuestion, moveRefusal, newQuestionId, questionSummary, questionsAt, removeQuestion, restoreQuestion, restoreToSaved, searchBank, SEARCH_LIMIT, shiftQuestion, withQuestions, type Location } from "./bank-editor-list";
import { bankProblems } from "./bank-editor-problems";
import { BANK } from "./question-bank-data";
import { parseBank, type Bank, type BankQuestion } from "./question-bank";

const text = (id: string, value: string, answer = "答案"): BankQuestion => ({ kind: "text", id, content: { kind: "text", value }, answer });
const mc: BankQuestion = { kind: "multipleChoice", id: "p2-mc", content: { kind: "text", value: "哪個是水果？" }, options: ["石頭", "測果"], correctIndex: 1 };
const song: BankQuestion = { kind: "text", id: "boss-song", content: { kind: "youtube", value: "3JWTaaS7LdU", audioOnly: true }, prompt: "測這首歌？", answer: "晴天／測歌手", fields: [{ label: "歌名", answer: "晴天" }, { label: "歌手", answer: "測歌手" }] };
const tap: BankQuestion = { kind: "timing", id: "boss-tap", content: { kind: "youtube", value: "3JWTaaS7LdU", start: 170, end: 200, audioOnly: true }, target: 190 };

/** The bundled bank with pool 2 and the boss replaced: phase 1 plain, phase 2 a buzzer phase. */
function bank(pool2: BankQuestion[] = [text("p2-a", "測試山題？", "測峰"), mc]): Bank {
  return {
    ...BANK,
    pools: { ...BANK.pools, 2: pool2 },
    boss: {
      ...BANK.boss,
      phases: [
        { name: "", rule: "", maxHp: 3, questions: [{ ...text("boss-1", "首領題"), difficulty: 3 }] },
        { name: "搶答", rule: "聽歌", maxHp: 3, buzzer: true, questions: [song, tap] },
      ],
    },
  };
}
const pool = (d: 1 | 2 | 3 | 4 | 5): Location => ({ kind: "pool", difficulty: d });
const phase = (n: number): Location => ({ kind: "boss", phase: n });

describe("bank editor list: summary rows (editor-ux #2)", () => {
  it("shows kind, media, name and answer for each kind", () => {
    expect(questionSummary(text("a", "測試山題？", "測峰"))).toEqual({ kind: "填空", media: "", name: "測試山題？", answer: "測峰" });
    expect(questionSummary(mc)).toMatchObject({ kind: "選擇", answer: "✓ 測果" });
    expect(questionSummary({ ...mc, correctIndex: -1 } as BankQuestion).answer).toBe("沒標正解");
    expect(questionSummary({ kind: "sort", id: "s", content: { kind: "text", value: "排" }, items: ["甲", "乙", "丙", "丁"] }).answer).toBe("甲→乙→丙→丁");
    expect(questionSummary(song)).toMatchObject({ media: "▶", name: "測這首歌？", answer: "晴天／測歌手" });
    expect(questionSummary(tap)).toMatchObject({ kind: "卡點", answer: "3:10.00" });
  });
});

describe("bank editor list: search the whole bank", () => {
  it("finds a question in any pool or phase by its text, answer, option, field or 題幹, case-insensitive", () => {
    const b = bank();
    expect(searchBank(b, "測峰")).toEqual([{ tab: 2, questionId: "p2-a", where: "難度 2 第 1 題", name: "測試山題？" }]);
    expect(searchBank(b, "測果").map((h) => h.questionId)).toEqual(["p2-mc"]);
    expect(searchBank(b, "測歌手")[0]).toMatchObject({ tab: "boss", questionId: "boss-song", where: "首領第 2 階段 第 1 題" });
    expect(searchBank(b, "測這首").map((h) => h.questionId)).toEqual(["boss-song"]);
    expect(searchBank({ ...b, pools: { ...b.pools, 2: [text("x", "Pokemon 問題")] } }, "POKEMON")).toHaveLength(1);
    expect(searchBank(b, "   ")).toEqual([]);
    // A media id is not searched.
    expect(searchBank(b, "3JWTaaS7LdU")).toEqual([]);
  });

  it("stops one past SEARCH_LIMIT hits, and exactly SEARCH_LIMIT matches stay SEARCH_LIMIT", () => {
    const many = Array.from({ length: 30 }, (_, i) => text(`p2-${i}`, `同一個字 ${i}`));
    expect(searchBank(bank(many), "同一個字")).toHaveLength(SEARCH_LIMIT + 1);
    expect(searchBank(bank(many.slice(0, SEARCH_LIMIT)), "同一個字")).toHaveLength(SEARCH_LIMIT);
  });
});

describe("bank editor list: move, shift, copy, delete and undo (editor-ux #3)", () => {
  it("refuses only what a save would refuse there", () => {
    const b = bank();
    expect(moveRefusal(b, mc, phase(1))).toBe("搶答階段只能放填空題或卡點題");
    expect(moveRefusal(b, tap, pool(3))).toBe("卡點題只能放在搶答階段");
    expect(moveRefusal(b, tap, phase(0))).toBe("卡點題只能放在搶答階段");
    expect(moveRefusal(b, song, pool(1))).toBe("有答案欄位的題目只能放在搶答階段的聽歌題");
    expect(moveRefusal(b, mc, pool(4))).toBeNull();
    expect(moveRefusal(b, text("x", "y"), phase(1))).toBeNull();
  });

  it("moves to the end of another group keeping the id, and fixes the difficulty a pool may not have", () => {
    const b = bank();
    const toPool = moveQuestion(b, phase(0), "boss-1", pool(4));
    expect(questionsAt(toPool, phase(0))).toEqual([]);
    expect(questionsAt(toPool, pool(4)).at(-1)).toEqual(text("boss-1", "首領題"));
    const toBoss = moveQuestion(b, pool(2), "p2-a", phase(0));
    expect(questionsAt(toBoss, phase(0)).at(-1)).toMatchObject({ id: "p2-a", difficulty: 2 });
    expect(questionsAt(toBoss, pool(2)).map((q) => q.id)).toEqual(["p2-mc"]);
    // The default boss difficulty is stored as none.
    expect(questionsAt(moveQuestion(b, pool(5), BANK.pools[5][0].id, phase(0)), phase(0)).at(-1)!.difficulty).toBeUndefined();
    expect(moveQuestion(b, pool(2), "nope", pool(3))).toBe(b);
    // What a move makes, the server takes.
    const moved = moveQuestion(moveQuestion(b, phase(0), "boss-1", pool(4)), pool(2), "p2-mc", phase(0));
    expect(bankProblems(moved)).toEqual([]);
    expect(() => parseBank(JSON.parse(JSON.stringify(moved)))).not.toThrow();
  });

  it("shifts within a group and stops at either end", () => {
    const b = bank();
    expect(questionsAt(shiftQuestion(b, pool(2), "p2-mc", -1), pool(2)).map((q) => q.id)).toEqual(["p2-mc", "p2-a"]);
    expect(shiftQuestion(b, pool(2), "p2-a", -1)).toBe(b);
    expect(shiftQuestion(b, pool(2), "p2-mc", 1)).toBe(b);
  });

  it("copies right after with a new id that no question has, as a deep copy", () => {
    const b = bank();
    const rolls = ["a", "a", "b"];
    expect(newQuestionId(b, pool(2), () => rolls.shift()!)).toBe("p2-b"); // p2-a is taken: rolled again
    expect(newQuestionId(b, phase(1), () => "x")).toBe("boss-x");
    const list = questionsAt(copyQuestion(b, pool(2), "p2-mc", "p2-new"), pool(2));
    expect(list.map((q) => q.id)).toEqual(["p2-a", "p2-mc", "p2-new"]);
    expect(list[2]).toEqual({ ...mc, id: "p2-new" });
    expect(list[2].kind === "multipleChoice" && mc.kind === "multipleChoice" && list[2].options !== mc.options).toBe(true);
  });

  it("puts a deleted question back where it was, or at the end of a shorter group, once", () => {
    const b = bank();
    const r = removeQuestion(b, pool(2), "p2-a")!;
    expect(questionsAt(r.bank, pool(2)).map((q) => q.id)).toEqual(["p2-mc"]);
    const back = restoreQuestion(r.bank, r.removed);
    expect(questionsAt(back, pool(2)).map((q) => q.id)).toEqual(["p2-a", "p2-mc"]);
    expect(restoreQuestion(back, r.removed)).toBe(back);
    const late = removeQuestion(b, pool(2), "p2-mc")!;
    const emptied = removeQuestion(late.bank, pool(2), "p2-a")!.bank;
    expect(questionsAt(restoreQuestion(emptied, late.removed), pool(2)).map((q) => q.id)).toEqual(["p2-mc"]);
    expect(removeQuestion(b, pool(2), "nope")).toBeNull();
    // A phase that is gone takes nothing back.
    const gone = removeQuestion(b, phase(1), "boss-tap")!;
    const fewer = { ...gone.bank, boss: { ...gone.bank.boss, phases: gone.bank.boss.phases.slice(0, 1) } };
    expect(restoreQuestion(fewer, gone.removed)).toBe(fewer);
  });

  it("gives back the saved bank itself when 復原 undoes the only change, so nothing shows as unsaved", () => {
    const saved = bank();
    const r = removeQuestion(saved, pool(2), "p2-a")!;
    expect(restoreToSaved(r.bank, r.removed, saved)).toBe(saved);
    // Another edit made meanwhile stays an unsaved bank.
    const edited = withQuestions(r.bank, pool(2), [text("p2-mc", "改過")]);
    const back = restoreToSaved(edited, r.removed, saved);
    expect(back).not.toBe(saved);
    expect(questionsAt(back, pool(2)).map((q) => q.id)).toEqual(["p2-a", "p2-mc"]);
    expect(restoreToSaved(r.bank, r.removed, null)).not.toBe(saved);
  });
});
