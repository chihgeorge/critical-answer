// The words for the class dice (docs/designs/class-abilities.md 「職業技能擲骰」): what each tier of a skill or answer die
// does, for the big screen's roll, the phones and the narrator. Pure and bank-free, so a client may import it.

import { CHEF_MULTIPLIERS, TIER_LABELS, WARRIOR_HIT_SHARE, skillTier, type ClassId } from "./game-state";

/** The question a mage casts on, as the screens know it. */
export type CastOn = "multipleChoice" | "text" | "sort";

const MAGE: Record<CastOn, readonly [string, string, string, string]> = {
  multipleChoice: ["法術沒效，次數照扣", "刪掉 1 個錯的，次數退回", "刪掉 2 個錯的", "錯的全部刪光！"],
  text: ["法術沒效，次數照扣", "告訴你答案有幾個字，次數退回", "告訴你第一個字", "直接給答案！"],
  sort: ["法術沒效，次數照扣", "沒看到東西，次數退回", "告訴你第 1 個", "整個順序都給你！"],
};
const CLERIC = ["祈禱沒回應，次數照扣", "沒有回應……次數照扣", "神聽到了！再答一次", "神蹟！再答一次，次數不扣"] as const;
const THIEF = ["偷襲失手，沒有加成", "偷襲沒成功，次數退回", "偷襲成功！獎勵 ×1.5", "偷襲大成功！獎勵 ×2"] as const;
const pct = (m: number) => `×${m}`;

/** What the mage's skill die `value` does on `on`. */
export function mageEffect(on: CastOn, value: number): string {
  return MAGE[on][skillTier(value)];
}

/** What the cleric's prayer die `value` does. */
export function clericEffect(value: number): string {
  return CLERIC[skillTier(value)];
}

/** What the answer die `value` (a crit die or a fill-in's answer die) does for a chef or an armed thief; null for anyone
 * else, whom it does nothing for. */
export function answerEffect(reader: "chef" | "thief" | undefined, value: number): string | null {
  if (reader === "thief") return THIEF[skillTier(value)];
  if (reader === "chef") return `🍳 料理 ${pct(CHEF_MULTIPLIERS[skillTier(value)])}`;
  return null;
}

/** The warrior's roll for the answer: 1 wrong and loses the question's reward, 2–6 wrong, 7–19 right for 80%, 20 double. */
export function warriorEffect(value: number): string {
  const t = skillTier(value);
  return t === 0 ? "1 大失敗……答錯，扣掉這題的獎勵" : t === 1 ? `${value}，差一點……答錯` : t === 2 ? `${value} 命中！拿 ${WARRIOR_HIT_SHARE * 10} 成` : "20 大成功！雙倍";
}

/** Who reads a team's answer die: a chef always, a thief only with 偷襲 armed. */
export function answerReader(team: { classId?: ClassId; sneakArmed?: true } | undefined): "chef" | "thief" | undefined {
  return team?.classId === "chef" ? "chef" : team?.sneakArmed ? "thief" : undefined;
}

/** The narrator's line once a mage's or cleric's die lands. */
export function skillLine(kind: "mage" | "cleric", name: string, value: number): string {
  return `${kind === "mage" ? "🔮" : "✝️"} ${name}${kind === "mage" ? "施法" : "祈禱"}擲出 ${value}，${TIER_LABELS[skillTier(value)]}！`;
}
