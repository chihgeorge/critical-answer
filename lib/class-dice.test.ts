import { describe, expect, it } from "vitest";
import { answerEffect, answerReader, clericEffect, critEffect, mageEffect, skillLine, warriorEffect } from "./class-dice";

// Value: protects=each tier's words match the rules (docs/rules.md 職業技能擲骰) and the right team reads the answer die;
// fails_when=a tier boundary (1, 2–6, 7–19, 20) shows another tier's effect, or an unarmed thief reads the die; seam=none
describe("class dice words", () => {
  it("names every crit tier and its actual adjustment", () => {
    expect([1, 2, 7, 20].map((v) => critEffect(v))).toEqual([
      "1 大失敗：照常答對，獎勵不變",
      "2 小失敗：照常答對，獎勵不變",
      "7 小成功：照常答對，獎勵不變",
      "20 大成功：獎勵多一半",
    ]);
    expect(critEffect(20, true)).toContain("首領多扣 1 顆愛心");
  });
  it("names each tier's effect at its boundaries", () => {
    expect([1, 2, 6, 7, 19, 20].map((v) => mageEffect("multipleChoice", v))).toEqual([
      "法術沒效，次數照扣",
      "刪掉 1 個錯的，次數退回",
      "刪掉 1 個錯的，次數退回",
      "刪掉 2 個錯的",
      "刪掉 2 個錯的",
      "錯的全部刪光！",
    ]);
    expect(clericEffect(20)).toBe("神蹟！再答一次，次數不扣");
    expect([1, 4, 12, 20].map(warriorEffect)).toEqual(["1 大失敗……答錯，扣掉這題的獎勵", "4，差一點……答錯", "12 命中！拿 8 成", "20 大成功！雙倍"]);
    expect([1, 4, 12, 20].map((v) => answerEffect("chef", v))).toEqual(["🍳 料理 ×0.1", "🍳 料理 ×0.8", "🍳 料理 ×1.3", "🍳 料理 ×2"]);
    expect(answerEffect("thief", 12)).toBe("偷襲成功！獎勵 ×1.5");
    expect(answerEffect(undefined, 20)).toBeNull();
    expect(skillLine("mage", "甲隊", 20)).toBe("🔮 甲隊施法擲出 20，大成功！");
  });

  it("lets a chef always, and a thief only with 偷襲 armed, read the answer die", () => {
    expect(answerReader({ classId: "chef" })).toBe("chef");
    expect(answerReader({ classId: "thief", sneakArmed: true })).toBe("thief");
    expect(answerReader({ classId: "thief" })).toBeUndefined();
    expect(answerReader(undefined)).toBeUndefined();
  });
});
