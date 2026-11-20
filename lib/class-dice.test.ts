import { describe, expect, it } from "vitest";
import { checkChip, clericEffect, hostCheckLine, hostCheckText, dishEffect, dishPhoneLine, mageEffect, rollStatus, sneakEffect, warriorEffect } from "./class-dice";

// Value: protects=each tier's words match the rules (docs/rules.md 職業技能擲骰, class-dice-rework.md); fails_when=a tier
// boundary (1, 2–6, 7–19, 20) shows another tier's effect, or a chef's dish die reads like everyone's; seam=none
describe("class dice words", () => {
  it("names every dish die tier with its multiplier, a chef's own on 7–19 and 20", () => {
    expect([1, 2, 7, 20].map((v) => dishEffect(v, false))).toEqual(["燒焦了！獎勵 ×0.1", "上菜，獎勵不變", "上菜，獎勵不變", "傳說級料理！獎勵 ×1.5"]);
    expect([1, 6, 19, 20].map((v) => dishEffect(v, true))).toEqual(["燒焦了！獎勵 ×0.1", "上菜，獎勵不變", "上菜！提鮮 ×1.2", "傳說級料理！獎勵 ×2"]);
    expect(dishPhoneLine(1, -18, 2, "飽足感")).toBe("🍳 焦黑！+2 飽足感"); // only the result (owner review, 2026-11-20)
    expect(dishPhoneLine(12, 4, 24, "飽足感")).toBe("🍳 提鮮加成 20 → 24 飽足感");
    expect(dishPhoneLine(12, 0, 20, "飽足感")).toBe("🍳 料理骰 12：上菜");
    // A 2–6 pays as usual: served for anyone, only a chef hears it got no bonus (owner 2026-11-18).
    expect(dishPhoneLine(4, 0, 20, "飽足感")).toBe("🍳 料理骰 4：上菜");
    expect(dishPhoneLine(4, 0, 20, "飽足感", true)).toBe("🍳 料理骰 4：上菜（沒加成）");
    expect(dishPhoneLine(20, 20, 40, "飽足感")).toBe("🍳 傳說級！ 20 → 40 飽足感");
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

describe("checkChip", () => {
  // Value: protects=the big screen says how a persuasion check ended and never shows a bare 「（+1）」 (QA 2026-11-19, L7);
  // fails_when=the chip keeps the DC after the roll, or drops the word for the bonus.
  it("shows the DC with its bonus before the roll, then the result", () => {
    expect(checkChip({ bonus: 1, dc: 10 })).toEqual({ text: "🗣️ 說服擲骰檢定 10（加值 +1）", tone: "warn" });
    expect(checkChip({ bonus: 1, dc: 10 }, { value: 1, bonus: 1, dc: 10, passed: false })).toEqual({ text: "🗣️ 擲出 1：被轟出門", tone: "danger" });
    expect(checkChip({ bonus: 4, dc: 8 }, { value: 3, bonus: 4, dc: 8, passed: false }).text).toBe("🗣️ 說服失敗：3+4=7<8");
    expect(checkChip({ bonus: 4, dc: 8 }, { value: 5, bonus: 4, dc: 8, passed: true })).toEqual({ text: "🗣️ 說服成功：5+4=9≥8", tone: "ok" });
  });
});

describe("hostCheckLine", () => {
  // Value: protects=the host page tells a pass or fail and the hint it earned, for a host who cannot hear the narrator
  // (#438 audit); fails_when=the host sees no result, or the hint shows while the 說服成功 card still holds it; seam=none
  it("says the result, then the hint once the card is over", () => {
    expect(hostCheckLine({ value: 3, bonus: 4, dc: 8, passed: false }, false)).toBe("🗣️ 說服失敗：3+4=7<8・直接作答");
    expect(hostCheckLine({ value: 5, bonus: 4, dc: 8, passed: true, hint: "萬" }, true)).toBe("🗣️ 說服成功：5+4=9≥8・稍後出題");
    expect(hostCheckLine({ value: 5, bonus: 4, dc: 8, passed: true, hint: "萬" }, false)).toBe("🗣️ 說服成功：5+4=9≥8・提示第一個字「萬」");
    expect(hostCheckLine({ value: 5, bonus: 4, dc: 8, passed: true }, false)).toBe("🗣️ 說服成功：5+4=9≥8");
  });
});

describe("hostCheckText", () => {
  // Value: protects=the host sees 「稍後出題」 while the 說服成功 card is up, when STATE has no question yet (#443 / qa-c4 #5);
  // fails_when=the line only appears after the card, or a stale check shows when no card is up; seam=none
  const pass = { value: 5, bonus: 4, dc: 8, passed: true, hint: "萬" };
  const checks = { "q1:T0": pass, "q2:T0": { value: 20, bonus: 0, dc: 8, passed: true } }; // pregate-literal: a natural 20, not the HP cap
  it("finds the check by the turn's question during the card, and shows the hint after it", () => {
    expect(hostCheckText(checks, "T0", null, "q1", true)).toBe("🗣️ 說服成功：5+4=9≥8・稍後出題");
    expect(hostCheckText(checks, "T0", { id: "q1" }, "q1", false)).toBe("🗣️ 說服成功：5+4=9≥8・提示第一個字「萬」");
    expect(hostCheckText(checks, "T0", { id: "q1", memorize: true }, "q1", false)).toBe("🗣️ 說服成功：5+4=9≥8・稍後出題");
  });
  it("shows nothing without a question outside the card, for a 1 or a 20, or with no check", () => {
    expect(hostCheckText(checks, "T0", null, "q1", false)).toBeNull();
    expect(hostCheckText(checks, "T0", { id: "q2" }, "q2", false)).toBeNull();
    expect(hostCheckText(checks, "T1", { id: "q1" }, "q1", false)).toBeNull();
    expect(hostCheckText(undefined, "T0", null, undefined, true)).toBeNull();
  });
});
