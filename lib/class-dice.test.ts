import { describe, expect, it } from "vitest";
import { clericEffect, dishEffect, dishPhoneLine, mageEffect, rollStatus, sneakEffect, warriorEffect } from "./class-dice";

// Value: protects=each tier's words match the rules (docs/rules.md 職業技能擲骰, class-dice-rework.md); fails_when=a tier
// boundary (1, 2–6, 7–19, 20) shows another tier's effect, or a chef's dish die reads like everyone's; seam=none
describe("class dice words", () => {
  it("names every dish die tier with its multiplier, a chef's own on 7–19 and 20", () => {
    expect([1, 2, 7, 20].map((v) => dishEffect(v, false))).toEqual(["燒焦了！獎勵 ×0.1", "失手了，獎勵不變", "上菜，獎勵不變", "傳說級料理！獎勵 ×1.5"]);
    expect([1, 6, 19, 20].map((v) => dishEffect(v, true))).toEqual(["燒焦了！獎勵 ×0.1", "失手了，獎勵不變", "上菜！廚師 ×1.2", "傳說級料理！獎勵 ×2"]);
    expect(dishPhoneLine(1, -9, false)).toBe("🍳 料理骰 1：焦黑殘渣 −9");
    expect(dishPhoneLine(12, 2, true)).toBe("🍳 料理骰 12：上菜（廚師 +2）");
    expect(dishPhoneLine(12, 0, false)).toBe("🍳 料理骰 12：上菜");
    expect(dishPhoneLine(20, 5, false)).toBe("🍳 料理骰 20：傳說級料理 +5");
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
    expect([1, 4, 12, 20].map((v) => sneakEffect(v, 2))).toEqual(["被發現了（−2 分）", "沒抓到時機", "答對 ×1.5、首領 −2", "答對 ×2、首領 −3"]);
  });

  // Value: protects=a phone never shows a die's value before the big screen's die lands (#328 m2);
  // fails_when=rollStatus names a number again; seam=none; no_claim=the D20 sprite (page.tsx passes "?")
  it("never names the value on the phone while the big screen rolls", () => {
    for (const kind of ["dish", "check", "mage", "cleric", "thief", "warrior", undefined]) expect(rollStatus(kind)).not.toMatch(/\d/);
    expect(rollStatus("kill")).toContain("4d20");
  });
});
