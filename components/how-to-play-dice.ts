// All dice text of the how-to-play pages (persuasion check, dish die, lucky potion, class dice), computed from the
// rules' constants (docs/designs/class-dice-rework.md).
import {
  CHECK_BONUS,
  CLASS_IDS,
  CLASS_SKILLS,
  CHECK_DC,
  CHEF_DISH_LEGEND_MULTIPLIER,
  CHEF_DISH_SUCCESS_MULTIPLIER,
  DISH_BURNT_MULTIPLIER,
  DISH_LEGEND_MULTIPLIER,
  SKILL_SUCCESS,
  type ClassId,
} from "@/lib/game-state";

const OK = SKILL_SUCCESS;
// 0.1 → 一成, as the lobby says it.
const BURNT = `${"零一二三四五六七八九"[Math.round(DISH_BURNT_MULTIPLIER * 10)]}成`;

type PageText = { topic: string; big: string; owl: string; script: string };

/** Page 3 (填空題): typing, the host's judging, and the persuasion check before it. */
export const FILL_IN_PAGE: PageText = {
  topic: "填空題",
  big: "先擲說服，再打字送出",
  owl: "說服擲到 20 免答，擲到 1 只拿一半！",
  script: "先擲說服：d20 加職業加值，過了怪物的檢定給第一個字；20 免答，1 只拿一半。再打字送出，由我判。首領房不擲說服。",
};

/** Page 5 (答對後的料理骰). */
export const DISH_PAGE: PageText = {
  topic: "答對後的料理骰",
  big: "每次答對都擲料理骰，整題分數乘上去",
  owl: "料理骰擲到 20 是傳說級料理，擲到 1 就燒焦了！",
  script:
    `每一隊答對後都擲料理骰：1 燒焦只拿${BURNT}，2 到 19 照常，20 傳說級料理拿 ${DISH_LEGEND_MULTIPLIER} 倍。` +
    `廚師更好：2 到 ${OK - 1} 照常，${OK} 到 19 拿 ${CHEF_DISH_SUCCESS_MULTIPLIER} 倍，20 拿 ${CHEF_DISH_LEGEND_MULTIPLIER} 倍。搶答和打倒首領的最後一擊不擲。`,
};

/** Page 6 (幸運藥水): how a team gets one is lib/game-state.ts giveItem (the host), the fortune teller and 冤枉. */
export const POTION_PAGE: PageText = {
  topic: "幸運藥水",
  big: "喝下藥水，這題下一顆骰擲兩次取高",
  owl: "喝下幸運藥水，下一顆骰子擲兩次，取大的那個！",
  script:
    "我會送幸運藥水給表現好的隊伍，占卜師和被冤枉的抓包也會送；一隊一次只能有一瓶。輪到自己時按「🧪 喝下幸運藥水」，" +
    "這題擲的下一顆骰擲兩次取高：說服、法師、牧師、戰士、偷襲、料理骰都可以。一瓶只管一顆骰，沒擲到骰藥水會還給你。",
};

/** Page 7 (職業骰): when each class rolls and the one scale they share; never each class's effect (owner 2026-11-18). */
export const CLASS_DICE_PAGE: PageText = {
  topic: "職業骰",
  big: `職業技能都擲 d20，${OK} 以上就成功`,
  owl: "每個職業都有擲骰的時候，擲到 20 大成功，擲到 1 大失敗！",
  script:
    `法師${CLASS_SKILLS.mage}、牧師${CLASS_SKILLS.cleric}、戰士${CLASS_SKILLS.warrior}、盜賊${CLASS_SKILLS.thief}、廚師${CLASS_SKILLS.chef}（答對的料理骰）都擲 d20。結果分四段：1 大失敗，2 到 ${OK - 1} 失敗，` +
    `${OK} 到 19 成功，20 大成功。每個職業做什麼，大廳選職業時有寫。`,
};

/** Page 3's picture: an example persuasion roll (die + bonus vs DC). */
export const CHECK_EXAMPLE = { die: 10, bonus: CHECK_BONUS.thief, dc: CHECK_DC[2] };
/** Page 5's picture: the dish die's three outcomes, and the chef's better ones. */
export const DISH_FACES: [string, string][] = [["1", `燒焦・只拿${BURNT}`], ["2–19", "照常上菜"], ["20", `傳說級・×${DISH_LEGEND_MULTIPLIER}`]];
export const CHEF_DISH_LINE = `${OK}–19 ×${CHEF_DISH_SUCCESS_MULTIPLIER}・20 ×${CHEF_DISH_LEGEND_MULTIPLIER}`;
/** Page 7's picture: each class with its skill name only; players read the effects on their phones (owner 2026-11-19). */
export const CLASS_SKILLS_ROW: [ClassId, string][] = CLASS_IDS.map((c) => [c, CLASS_SKILLS[c]]);
export const DICE_SCALE: [string, string][] = [["1", "大失敗"], [`2–${OK - 1}`, "失敗"], [`${OK}–19`, "成功"], ["20", "大成功"]];
