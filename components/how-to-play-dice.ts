// All dice text of the how-to-play pages 2–3 (persuasion check, dish die, class dice table), computed from the rules'
// constants (docs/designs/class-dice-rework.md).
import {
  ABILITY_USES,
  CHECK_BONUS,
  CHECK_DC,
  CHEF_DISH_LEGEND_MULTIPLIER,
  CHEF_DISH_SUCCESS_MULTIPLIER,
  DISH_BURNT_MULTIPLIER,
  DISH_LEGEND_MULTIPLIER,
  SKILL_SUCCESS,
  SNEAK_CRIT_MULTIPLIER,
  SNEAK_REWARD_MULTIPLIER,
  WARRIOR_HIT_SHARE,
  type ClassId,
} from "@/lib/game-state";

const OK = SKILL_SUCCESS;
const tenths = (share: number) => `${"零一二三四五六七八九"[Math.round(share * 10)]}成`;
// 0.8 → 八成, as the lobby says (play page CLASS_HINTS).
const WAR = tenths(WARRIOR_HIT_SHARE);
const BURNT = tenths(DISH_BURNT_MULTIPLIER);

/** Page 2 (說服檢定與料理骰) and page 3 (各職業什麼時候擲骰): topic, big text, owl line and host script. */
export const DICE_PAGES = [
  {
    topic: "說服檢定與料理骰",
    big: "填空題先擲說服檢定，每次答對都擲料理骰",
    owl: "說服擲到 20 免答！料理骰擲到 20 是傳說級料理，擲到 1 就燒焦了！",
    script:
      "一般房填空題先按手機上的「🎲 擲骰說服」：擲 d20 加職業加值，達到怪物頭上的檢定就送第一個字；20 免答算答對，1 答對只拿一半。首領房不用擲說服骰。" +
      `每一隊輪到自己答對後都擲料理骰：1 燒焦只拿${BURNT}，20 傳說級料理拿 ${DISH_LEGEND_MULTIPLIER} 倍，其他照常拿分；搶答和最後一擊不擲。` +
      "幸運藥水可以用在自己的任何一顆骰，擲兩顆取高。",
  },
  {
    topic: "各職業什麼時候擲骰",
    big: `用技能擲 d20：${OK} 以上成功，20 大成功`,
    owl: "法師施法、牧師祈禱、戰士代答、盜賊偷襲時擲骰；廚師的料理骰加成最多。",
    script:
      `職業技能都擲 d20：${OK} 以上成功，20 大成功，1 大失敗。法師施法時擲、牧師答錯祈禱時擲、戰士擲骰代替答題（${OK} 以上拿${WAR}，1 扣整題）；` +
      `盜賊按「偷襲」馬上擲（${OK} 以上這題答對 ×${SNEAK_REWARD_MULTIPLIER}，20 ×${SNEAK_CRIT_MULTIPLIER}，1 扣這題獎勵的一成）。` +
      `廚師不用按，料理骰 ${OK} 以上 ×${CHEF_DISH_SUCCESS_MULTIPLIER}、20 ×${CHEF_DISH_LEGEND_MULTIPLIER}。技能一場 ${ABILITY_USES} 次，廚師沒有次數。`,
  },
] as const;

/** Page 2's picture: an example persuasion roll (die + bonus vs DC) and the dish die's three outcomes. */
export const CHECK_EXAMPLE = { die: 10, bonus: CHECK_BONUS.thief, dc: CHECK_DC[2] };
export const DISH_FACES: [string, string][] = [["1", `燒焦・只拿${BURNT}`], ["2–19", "照常上菜"], ["20", `傳說級・×${DISH_LEGEND_MULTIPLIER}`]];

/** Page 3's table: one row per class, when it rolls and what a SKILL_SUCCESS+ roll does. */
export const DICE_TABLE_HEAD = ["職業", "什麼時候擲", `擲到 ${OK} 以上`];
export const DICE_ROWS: [ClassId, string, string][] = [
  ["mage", "按「施法」時", "給提示（20 直接給答案）"],
  ["cleric", "答錯後按「祈禱」", "這回合再答一次"],
  ["warrior", "輪到時「擲骰代替答題」", `算答對拿${WAR}（20 雙倍・1 扣整題）`],
  ["thief", "按「偷襲」馬上擲", `答對 ×${SNEAK_REWARD_MULTIPLIER}（20 ×${SNEAK_CRIT_MULTIPLIER}・1 扣一成）`],
  ["chef", "不用按，答對擲料理骰", `料理骰 ×${CHEF_DISH_SUCCESS_MULTIPLIER}（20 ×${CHEF_DISH_LEGEND_MULTIPLIER}）`],
];
