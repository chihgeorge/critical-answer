// The words for the class dice and the dish die (docs/designs/class-dice-rework.md): what each tier of a die does, for
// the big screen's roll, the phones and the narrator. Pure and bank-free, so a client may import it.

import { SNEAK_CRIT_MULTIPLIER, SNEAK_REWARD_MULTIPLIER, WARRIOR_HIT_SHARE, dishMultiplier, dishTier, skillTier } from "./game-state";

/** The question a mage casts on, as the screens know it. */
export type CastOn = "multipleChoice" | "text" | "sort";

const MAGE: Record<CastOn, readonly [string, string, string, string]> = {
  multipleChoice: ["法術沒效，次數照扣", "刪掉 1 個錯的，次數退回", "刪掉 2 個錯的", "錯的全部刪光！"],
  text: ["法術沒效，次數照扣", "告訴你答案有幾個字，次數退回", "告訴你第一個字", "直接給答案！"],
  sort: ["法術沒效，次數照扣", "沒看到東西，次數退回", "告訴你第 1 個", "整個順序都給你！"],
};
const CLERIC = ["祈禱沒回應，次數照扣", "沒有回應……次數照扣", "神聽到了！再答一次", "神蹟！再答一次，次數不扣"] as const;

/** What the mage's skill die `value` does on `on`. */
export function mageEffect(on: CastOn, value: number): string {
  return MAGE[on][skillTier(value)];
}

/** What the cleric's prayer die `value` does. */
export function clericEffect(value: number): string {
  return CLERIC[skillTier(value)];
}

/** What the thief's sneak die `value` does, rolled as 偷襲 is pressed; `penalty`: what a 1 takes. */
export function sneakEffect(value: number, penalty = 0): string {
  const t = skillTier(value);
  return t === 0
    ? `被發現了（−${penalty} 分）`
    : t === 1
      ? "沒抓到時機"
      : t === 2
        ? `答對 ×${SNEAK_REWARD_MULTIPLIER}、首領 −2`
        : `答對 ×${SNEAK_CRIT_MULTIPLIER}、首領 −3`;
}

/** What the dish die `value` does to a correct answer's reward, for a chef or anyone else. */
export function dishEffect(value: number, chef: boolean): string {
  const t = skillTier(value);
  const m = dishMultiplier(chef, value);
  return t === 0 ? `燒焦了！獎勵 ×${m}` : t === 1 ? "上菜，獎勵不變" : t === 2 ? (chef ? `上菜！提鮮 ×${m}` : "上菜，獎勵不變") : `傳說級料理！獎勵 ×${m}`;
}

/** What a dish die that changed the score is called before its 「原本 → 現在」: a 1, a 20, or a chef's 7–19. */
export function dishChangeLabel(value: number | undefined): string {
  return value === 1 ? "焦黑！" : value === 20 ? "傳說級！" : "提鮮加成";
}

/** The phone's line for the dish die once its answer is scored: `bonus` is what it changed (negative on a 1), `points`
 * the answer's whole score after it, `unit` the score's name. A change reads 「原本 → 現在」 (owner, 2026-11-18). A 2–6
 * reads as served: only a chef's says it got no bonus. */
export function dishPhoneLine(value: number, bonus: number, points: number, unit: string, chef = false): string {
  // A change leaves out 「料理骰 N：」, so the line fits one row of a phone.
  if (bonus) return `🍳 ${dishChangeLabel(value)} ${points - bonus} → ${points} ${unit}`;
  const t = dishTier(value, chef);
  return t === 0 ? "🍳 料理骰 1：燒焦了" : t === 1 ? `🍳 料理骰 ${value}：上菜（沒加成）` : t === 2 ? `🍳 料理骰 ${value}：上菜` : "🍳 料理骰 20：傳說級料理";
}

/** The warrior's roll for the answer: 1 wrong and loses the question's reward, 2–6 wrong, 7–19 right for 80%, 20 double. */
export function warriorEffect(value: number): string {
  const t = skillTier(value);
  return t === 0 ? "1 大失敗……答錯，扣掉這題的獎勵" : t === 1 ? `${value}，差一點……答錯` : t === 2 ? `${value} 命中！拿 ${WARRIOR_HIT_SHARE * 10} 成` : "20 大成功！雙倍";
}

/** What a roll in its beat says on the phone. Never the value: the big screen's die lands it first (#328 m2). */
export function rollStatus(kind: string | undefined): string {
  if (kind === "kill") return "最後一擊！擲 4d20 擊殺獎勵，看大螢幕 ▶";
  if (kind === "dish") return "答對！擲料理骰中，看大螢幕 ▶";
  if (kind === "check") return "說服檢定擲骰中，看大螢幕 ▶";
  if (kind === "mage") return "🔮 洞悉擲骰中，看大螢幕 ▶";
  if (kind === "warrior") return "⚔️ 衝鋒擲骰中，看大螢幕 ▶";
  if (kind === "cleric") return "✝️ 祈禱擲骰中，看大螢幕 ▶";
  if (kind === "thief") return "🗡️ 偷襲擲骰中，看大螢幕 ▶";
  return "擲骰中！看大螢幕 ▶";
}
