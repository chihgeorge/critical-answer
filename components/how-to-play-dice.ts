// All dice text of the how-to-play pages 2–3 (persuasion check, crit die, class dice table): the class-dice rework edits only this file.
import { ABILITY_USES, CHECK_BONUS, CHECK_DC, CHEF_MULTIPLIERS, SKILL_SUCCESS, SNEAK_REWARD_MULTIPLIER, WARRIOR_HIT_SHARE, type ClassId } from "@/lib/game-state";

const OK = SKILL_SUCCESS;
// 0.8 → 八成, as the lobby says (play page CLASS_HINTS).
const WAR = `${"零一二三四五六七八九"[Math.round(WARRIOR_HIT_SHARE * 10)]}成`;

/** Page 2 (說服檢定與暴擊骰) and page 3 (各職業什麼時候擲骰): topic, big text, owl line and host script. */
export const DICE_PAGES = [
  {
    topic: "說服檢定與暴擊骰",
    big: "填空題先擲說服檢定，選擇題答對擲暴擊骰",
    owl: "說服擲到 20 免答，擲到 1 只拿一半；暴擊骰擲到 20 多拿一半！",
    script:
      "一般房填空題先按手機上的「🎲 擲骰說服」：擲 d20 加職業加值，達到怪物頭上的檢定就送第一個字；20 免答算答對，1 答對只拿一半。首領房不用擲說服骰。" +
      "選擇題和排序題答對擲暴擊骰，20 大成功多拿一半，其他照常拿分。主持人可以在大廳關掉暴擊骰。",
  },
  {
    topic: "各職業什麼時候擲骰",
    big: `用技能擲 d20：${OK} 以上成功，20 大成功`,
    owl: "法師施法、牧師祈禱、戰士代答時擲骰；盜賊和廚師答對了才看骰子。",
    script:
      `職業技能都擲 d20：${OK} 以上成功，20 大成功，1 大失敗。法師施法時擲、牧師答錯祈禱時擲、戰士擲骰代替答題（${OK} 以上拿${WAR}，1 扣整題）；` +
      `盜賊先按偷襲、廚師不用按，兩個都是答對時看答對骰加分。技能一場 ${ABILITY_USES} 次，廚師沒有次數。`,
  },
] as const;

/** Page 2's picture: an example persuasion roll (die + bonus vs DC) and the crit die's three outcomes. */
export const CHECK_EXAMPLE = { die: 10, bonus: CHECK_BONUS.thief, dc: CHECK_DC[2] };
export const CRIT_FACES: [string, string][] = [["1", "還是打中了"], ["2–19", "答對！"], ["20", "大成功・多拿一半"]];

/** Page 3's table: one row per class, when it rolls and what a SKILL_SUCCESS+ roll does. */
export const DICE_TABLE_HEAD = ["職業", "什麼時候擲", `擲到 ${OK} 以上`];
export const DICE_ROWS: [ClassId, string, string][] = [
  ["mage", "按「施法」時", "給提示（20 直接給答案）"],
  ["cleric", "答錯後按「祈禱」", "這回合再答一次"],
  ["warrior", "輪到時「擲骰代替答題」", `算答對拿${WAR}（20 雙倍・1 扣整題）`],
  ["thief", "先「偷襲」，答對看答對骰", `獎勵 ×${SNEAK_REWARD_MULTIPLIER}（20 ×2）`],
  ["chef", "不用按，答對看答對骰", `獎勵 ×${CHEF_MULTIPLIERS[2]}（20 ×${CHEF_MULTIPLIERS[3]}，選擇題連暴擊共 ×3）`],
];
