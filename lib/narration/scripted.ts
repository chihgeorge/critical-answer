// The always-available narrator: hand-written lines with template slots, drawn
// from a shuffle bag per pool, so every line plays once before any repeats.

import { epilogueParts, type NarrationEvent, type NextTurn } from "./events";
import { ordinal } from "../ordinal";
import { placeLine } from "../podium";
import { dishTier as tierOfDish, skillTier, type ClassId, type EventOutcome, type FortuneCondition, type FortuneEffect } from "../game-state";
import { FORTUNE_CONDITION_TEXT, FORTUNE_EFFECT_TEXT } from "../event-text";
import type { Reaction } from "../protocol";

export interface NarrationProvider {
  name: string;
  narrate(event: NarrationEvent, opts?: { signal?: AbortSignal }): Promise<string>;
}

/** 美食節目／生物學家口吻 (TODOS 地城料理風格 3): the narrator sizes a monster up as an ingredient, with a straight
 * face. Kept apart from the plain lines and spread into their pools, so each pool stays about 30% food talk and pick()
 * can tell a food line from a plain one. Only where food fits: a monster or the boss coming on, a monster beaten,
 * a dish eaten. A wrong answer, a flee and a die roll stay adventure lines (the atmosphere line after a correct answer
 * plays mostly on a natural 20 or 1, so it has none). */
export const FOODIE = {
  /** A beaten monster that will be cooked. Like every dish line, it never says what dish (cooking I1). */
  dish: ["{team}收拾了{monster}，鍋子已經在等了。", "{monster}倒下了……{team}的肚子咕嚕叫，+{points}。"],
  /** The same, naming the monster's edible part from the catalog (event.part). */
  dishPart: ["{team}打倒{monster}，貓頭鷹盯著{part}看。", "{monster}倒下，{team}小心收好牠的{part}。", "{team}贏了！{monster}的{part}是難得的食材。"],
  bossDish: ["終結！{monster}倒下了，今晚要開大鍋。", "{team}擊倒{monster}，這麼大的食材得換個大鍋。"],
  bossEnter: ["{team}推開首領房的門，今晚的主菜就在裡面！"],
  nextRoom: ["輪到{team}。{monster}看起來很有嚼勁。", "{team}請注意，{monster}受驚時肉質會變緊。", "換{team}了，這隻{monster}肉質相當結實。"],
  nextBoss: ["輪到{team}！{monster}一看就是主菜等級。", "{team}上場，這麼大隻的{monster}很少見。"],
  atmBossKill: ["這麼大的食材，得找個更大的鍋子。", "貓頭鷹已經在翻食譜了。", "首領級的肉，火候可不能馬虎。"],
  feast: ["{team}開出{dish}，飽足感 +{points}！"],
};

export const VARIANTS: Record<Exclude<NarrationEvent["type"], "epilogue">, string[]> = {
  start: [
    "火把一根根亮起，冒險者們踏進了地城。",
    "地城的大門緩緩打開，誰能活著走出去？",
    "石廊深處傳來低吼，冒險開始了！",
    "貓頭鷹魔法師翻開書頁：故事，開始了。",
    "腳步聲在石廊裡迴盪，第一位冒險者上前了。",
  ],
  correct: [
    "{team}答對了！{monster}被打退，拿下 {points} 分。",
    "漂亮！{team}一擊命中，{points} 分入袋。",
    "{monster}哀號一聲，{team}向前踏進了一步。",
    "{team}的答案讓{monster}潰不成軍，+{points}！",
    "答對！{team}穿過{monster}，繼續深入地城。",
    "{team}一招破解，{monster}節節敗退！",
    "{monster}招架不住，{points} 分歸{team}！",
    "{team}答得乾脆，{monster}只能讓路。",
    "正中紅心！{team}讓{monster}愣住了。",
    "{monster}被逼到牆角，{team}答對了！",
  ],
  retry: [
    "{team}答錯了，{monster}還擋在原地，下輪再答！",
    "{monster}冷笑一聲，{team}下一輪還能再答。",
    "差一點！{team}握緊武器，再戰{monster}。",
    "{team}答錯，{monster}紋絲不動。",
    "這一擊落空了，{team}深吸一口氣。",
    "{team}的答案偏了，{monster}鬆了口氣。",
    "{monster}晃了晃身子，{team}下一輪再來。",
    "答案不對，{team}重新打起精神。",
    "{monster}擋了下來，{team}還沒輸。",
    "可惜！{team}再想想，{monster}在等。",
  ],
  flee: [
    "{team}轉身就跑，{monster}的怒吼追在後面！",
    "{team}狼狽逃開，換個角度再挑戰{monster}。",
    "腳底抹油！{team}撤退，換個方向再出發。",
    "{monster}嚇跑了{team}，但這不是結束。",
    "{team}喘著氣退出戰場，重新整隊。",
    "{team}見苗頭不對，先溜為妙！",
    "{team}一溜煙跑了，{monster}撲了個空。",
    "{monster}還在原地，{team}已不見人影。",
    "{team}決定走為上策，改天再來！",
    "{team}收起武器，悄悄繞過{monster}。",
  ],
  "boss-hit": [
    "{team}命中首領！只剩 {bossHp} 顆心。",
    "龍鱗裂開了，首領還剩 {bossHp} 顆心！",
    "{team}重擊首領，血量剩 {bossHp}/{bossMaxHp}。",
    "首領怒吼，還撐得住 {bossHp} 顆心。",
    "轟！{team}再添一擊，{bossHp} 顆心待破。",
  ],
  "boss-phase": [
    "{monster}的鱗片變色，進入第{ordinal}階段：{name}！",
    "還沒完！{monster}起身，第{ordinal}階段「{name}」！",
    "{monster}長嘯，血量全滿——第{ordinal}階段：{name}。",
    "地城劇烈搖晃，{monster}換了模樣，迎來第{ordinal}階段！",
  ],
  "event-room": [], // never read: line() picks from EVENT_VARIANTS
  "boss-kill": [
    "{team}擊倒了{monster}！拿下 {points} 分！",
    "{monster}轟然倒下，{team}拿下致命一擊，+{points}！",
    "終結！{team}的最後一擊讓{monster}灰飛煙滅。",
    "{monster}的哀號迴盪在地城，{team}是英雄！",
    "地城安靜。{team}擊敗{monster}，拿下 {points} 分。",
  ],
};

/** Attack lines that name a class's own weapons and spells, mixed into the plain pools for a team
 * with a class. The plain pools name no weapon, so a team with no class never swings the wrong one. */
export const CLASS_VARIANTS: Record<ClassId, { correct: string[]; "boss-hit": string[] }> = {
  mage: {
    correct: ["{team}揮動法杖，火球轟向{monster}，+{points}！", "{team}念完咒語，冰箭把{monster}釘住，+{points}。"],
    "boss-hit": ["{team}召來閃電劈中首領，只剩 {bossHp} 顆心！", "{team}的火球炸開，首領還剩 {bossHp} 顆心。"],
  },
  cleric: {
    correct: ["{team}召來聖光，擊退了{monster}，+{points}！", "{team}舉起權杖，{monster}在聖光中退散，+{points}。"],
    "boss-hit": ["聖光降下，{team}擊中首領，只剩 {bossHp} 顆心！", "{team}的聖光化成光矛，首領還剩 {bossHp} 顆心。"],
  },
  warrior: {
    correct: ["{team}揮劍一斬，{monster}應聲倒地，+{points}！", "{team}舉盾衝撞，把{monster}撞飛了，+{points}。"],
    "boss-hit": ["{team}一劍砍在首領身上，只剩 {bossHp} 顆心！", "{team}掄起戰斧重擊，首領還剩 {bossHp} 顆心。"],
  },
  thief: {
    correct: ["{team}射出飛刀，{monster}來不及躲，+{points}！", "{team}繞到背後一刺，{monster}倒下了，+{points}。"],
    "boss-hit": ["{team}的匕首找到破綻，首領只剩 {bossHp} 顆心！", "{team}從暗處一刺，首領還剩 {bossHp} 顆心。"],
  },
  chef: {
    correct: ["{team}掄起平底鍋，{monster}被敲暈了，+{points}！", "{team}菜刀一閃，{monster}已切好備料，+{points}。"],
    "boss-hit": ["{team}一鍋砸在首領頭上，只剩 {bossHp} 顆心！", "{team}的爐火燒向首領，還剩 {bossHp} 顆心。"],
  },
};

/** A natural 20 or 1 behind a hit (event.roll): a class die's 20 (`crit`: a warrior's roll or the sneak die), the dish
 * die's 20 (`legend`) or 1 (`burnt`), or the persuasion check's. This line replaces the usual one, it is not an extra
 * line (dnd design R1, E3; class-dice-rework.md). */
export const ROLL_VARIANTS: Record<"crit" | "legend" | "burnt" | "persuaded", { correct: string[]; "boss-hit": string[] }> = {
  crit: {
    correct: [
      "{team}擲出 20！一擊打飛{monster}，+{points}！",
      "20 點！{team}會心一擊撂倒{monster}，+{points}！",
    ],
    "boss-hit": [
      "{team}擲出 20！重擊首領，剩 {bossHp} 顆心！",
      "大成功 20！{team}多打一顆，剩 {bossHp} 顆心！",
    ],
  },
  legend: {
    correct: [
      "料理骰 20！{team}端出傳說級料理，+{points}！",
      "{team}的料理骰擲出 20，香氣飄滿整個地城，+{points}！",
    ],
    "boss-hit": [
      "料理骰 20！{team}的傳說級料理香暈首領，剩 {bossHp} 顆心！",
      "{team}料理骰擲出 20，首領看傻了，剩 {bossHp} 顆心！",
    ],
  },
  burnt: {
    correct: [
      "料理骰擲出 1！{team}把{monster}燒成焦炭，只拿 +{points}。",
      "{team}料理骰 1，鍋子冒黑煙，+{points}。",
    ],
    "boss-hit": [
      "料理骰 1！{team}燒焦了，首領還剩 {bossHp} 顆心。",
      "{team}的料理骰擲出 1，滿室黑煙，首領剩 {bossHp} 顆心。",
    ],
  },
  // A persuasion check (kind "check"): a natural 20 wins without an answer (a 1 throws the team out: THROWN_OUT_VARIANTS).
  persuaded: {
    correct: [
      "擲出 20！{team}說動{monster}讓路，+{points}！",
      "20 點！{team}三言兩語說動{monster}，+{points}！",
      "嘴遁大成功！{monster}聽完直接讓路。",
      "{monster}：我信了。{team}一句話就過關。",
      "{team}一句話，{monster}自己把門打開。",
    ],
    "boss-hit": [
      "擲出 20！{team}說服首領，剩 {bossHp} 顆心！",
      "20 點！首領被{team}說動，剩 {bossHp} 顆心！",
    ],
  },
};

/** A correct answer on a monster that will be cooked (event.cooked, docs/designs/monster-cuisine.md). The dish
 * itself is named only once the host serves it (cooking I1), so these lines never say what it becomes. */
export const DISH_VARIANTS = [
  "{team}答對了！{monster}倒下了，+{points} 飽足感。",
  "{team}一擊命中，{monster}倒下了！",
  "漂亮！{team}拿下 {points} 飽足感。",
  "{monster}招架不住，{team}贏了這一回合。",
  "{team}答得乾脆，{monster}撐不住了。",
  "正中要害！{monster}敗給了{team}。",
  "{monster}晃了兩下就倒了，{team}過關。",
  "{team}答對，{monster}再也站不起來。",
  ...FOODIE.dish,
];

/** The boss kill when the boss will be cooked. */
export const BOSS_DISH_VARIANTS = [
  "{team}擊倒了{monster}！拿下 {points} 飽足感！",
  "{monster}轟然倒下，{team}拿下最後一擊，+{points}！",
  "{monster}倒下了！{team}拿下 {points} 飽足感。",
  ...FOODIE.bossDish,
];

/** The first team into the boss room opens the door (event.entersBoss without order or phase). */
export const BOSS_ENTER_VARIANTS = [
  "{team}答對，推開最後一道門，首領就在眼前！",
  "{monster}倒下，{team}踏進了首領的巢穴，+{points}！",
  "答對！{team}走進最深處，首領緩緩睜開眼睛。",
  "{team}拿下 {points} 分，最深處的大門打開了。",
  ...FOODIE.bossEnter,
];

/** A later team joining the boss fight (event.entersBoss.order): the door is already open (live-map.md D9). */
export const BOSS_JOIN_VARIANTS = [
  "{team}也趕到了首領房，加入戰局，+{points}！",
  "答對！{team}衝進大門，和大家並肩作戰。",
  "{monster}倒下，{team}跟上，首領又多一個對手！",
  "{team}拿下 {points} 分，殺進首領房支援戰場！",
];

/** The middle line: a short atmosphere/detail beat, one per event type — added for multi-segment
 * narration (docs/designs/multi-segment-narration.md). Only events with a middle line read one (runner.ts
 * hasMiddleLine), so ordinary turns with a next team skip it. A flat pool keyed by event type, same shape as VARIANTS;
 * ten lines each so a scripted hour repeats a line about four times, not ten (boss-phase's lines say the rule). */
export const ATMOSPHERE_VARIANTS: Record<Exclude<NarrationEvent["type"], "epilogue">, string[]> = {
  start: [
    "火把的光在石牆上搖曳。",
    "空氣裡有股潮濕的塵土味。",
    "遠處傳來滴水聲，一滴、又一滴。",
    "石廊深處，看不見盡頭。",
    "牆上的古老符文微微發亮。",
    "一陣冷風從深處吹了上來。",
    "地圖攤開了，路還很長。",
    "每一位冒險者都握緊了拳頭。",
    "書頁翻動，第一章的墨跡還沒乾。",
    "黑暗裡，有什麼東西睜開了眼睛。",
  ],
  correct: [
    "石屑從天花板簌簌落下。",
    "空氣裡還殘留著戰鬥的餘熱。",
    "地城彷彿也鬆了一口氣。",
    "回音在石廊裡慢慢散去。",
    "火把的光又亮了幾分。",
    "塵土飄落，前方的路清楚了。",
    "牆上的影子退開了一步。",
    "貓頭鷹在書上記下了這一筆。",
    "遠處傳來一聲不甘心的嘶吼。",
    "地上只剩幾道新的刮痕。",
  ],
  retry: [
    "汗水滴落，緊張感沒有散去。",
    "時間彷彿慢了下來。",
    "石廊裡一片寂靜，等著下一步。",
    "{monster}的影子在牆上晃動。",
    "火把劈啪一響，火光晃了晃。",
    "空氣好像突然變重了。",
    "遠處的滴水聲聽得格外清楚。",
    "錯了不要緊，地城很有耐心。",
    "牆上的符文閃了一下，又暗了。",
    "{monster}歪著頭，像在等什麼。",
  ],
  flee: [
    "腳步聲漸漸遠去，又漸漸靠近。",
    "喘息聲在石廊裡迴盪。",
    "撤退不是恥辱，是策略。",
    "地上留下一串凌亂的腳印。",
    "轉過彎，總算能喘口氣。",
    "{monster}得意地哼了一聲。",
    "換條路走，也許更近。",
    "火把在奔跑中忽明忽暗。",
    "退一步，是為了走更遠。",
    "留得青山在，下次再來。",
  ],
  "boss-hit": [
    "地城為之一震。",
    "碎石從天花板落下。",
    "首領的怒吼震得人耳鳴。",
    "戰鬥的氣息瀰漫整個房間。",
    "大廳的柱子嗡嗡作響。",
    "首領的眼神變得更兇了。",
    "煙塵中，誰也看不清下一步。",
    "牆上的火把一齊晃了晃。",
    "首領低吼一聲，地面跟著發顫。",
    "所有人都屏住了呼吸。",
  ],
  "boss-phase": [
    "規則變了：{rule}",
    "這次的考驗是：{rule}",
    "聽好了——{rule}",
  ],
  "event-room": [
    "這間房沒有怪物，卻一點也不平靜。",
    "地城裡的意外，總是來得剛好。",
    "火把晃了一下，像是在偷笑。",
    "門後傳來一陣奇怪的聲響。",
    "角落的蜘蛛網輕輕晃動。",
    "命運的骰子，有時不用自己擲。",
    "這裡的空氣聞起來有點不一樣。",
    "地城總愛跟冒險者開點玩笑。",
    "牆上的壁畫好像在看著他們。",
    "好事壞事，都寫在下一頁。",
  ],
  "boss-kill": [
    "地城陷入一片寂靜。",
    "火把一根接一根亮了起來。",
    "貓頭鷹闔上了這一章。",
    "遠處傳來歡呼，一路傳到地面。",
    "首領的寶座空了。",
    "塵土慢慢落下，像一場細雪。",
    "這段故事，會被說上很多年。",
    ...FOODIE.atmBossKill,
  ],
};

/** The middle line of a turn the waiting teams reacted to (crowd.ts): {by} is the team that tapped the loudest reaction
 * most. None names the team on turn or a monster (a boss hit has none), or hints at how the answer went: the same
 * reaction comes on a right or a wrong one. */
export const CROWD_VARIANTS: Record<Reaction, string[]> = {
  clap: [
    "{by}在後面用力鼓掌。",
    "後排的{by}掌聲沒停過。",
    "{by}拍手拍到手都紅了。",
    "掌聲從{by}那邊一路響過來。",
    "{by}帶頭鼓掌，石廊嗡嗡作響。",
    "{by}的掌聲一陣接著一陣。",
    "{by}的掌聲在地城裡迴盪。",
    "{by}在後面拍手叫好。",
  ],
  wow: [
    "{by}在後面倒抽一口氣。",
    "{by}嚇得抱成一團。",
    "後排傳來{by}的驚呼聲。",
    "{by}看得心臟都快跳出來了。",
    "{by}摀著眼睛，不敢再看。",
    "{by}緊張得握緊了拳頭。",
    "{by}在後面叫出聲來。",
    "{by}的尖叫聲嚇跑了蝙蝠。",
  ],
  lol: [
    "{by}在後面笑到東倒西歪。",
    "後排的{by}笑得停不下來。",
    "{by}笑到差點跌倒。",
    "{by}的笑聲在石廊裡打轉。",
    "{by}笑到眼淚都流出來了。",
    "{by}笑得火把都晃了。",
    "{by}拍桌大笑，貓頭鷹瞪了一眼。",
    "{by}在後面笑成一團。",
  ],
  boo: [
    "{by}在後面噓聲四起……",
    "後排的{by}發出一陣噓聲。",
    "{by}的噓聲比怪物的吼聲還大。",
    "{by}噓得連火把都抖了一下。",
    "噓～{by}看起來不太服氣。",
    "{by}噓個不停，貓頭鷹假裝沒聽見。",
    "{by}在後面猛搖頭：噓～",
    "{by}一臉不服，噓聲連連。",
  ],
};

/** A hit that empties an earlier phase's bar (bossHp 0, no kill): the fight's outcome stays open until
 * the phase card, so none of these says the boss fell (boss-phases.md D3). */
export const BOSS_EMPTIED_VARIANTS = [
  "{team}一擊打空了首領的血條！",
  "{team}命中！首領的血條見底了……",
  "最後一顆心也碎了，{team}屏住呼吸。",
];

/** The last answer of a boss phase that ran out of questions, right or wrong: the phase card comes next, so
 * no "try again" and no hearts left (review finding, 2026-10-28). */
export const BOSS_EXHAUSTED_VARIANTS = [
  "{team}答完這一題，首領的題目都出完了……",
  "首領的考驗已經出完，地城安靜了一瞬……",
  "最後一道題落下，首領卻還沒有倒下……",
];

/** A team walking into the boss room after phase 2 has started: the phase everyone has already seen (D13). */
export const BOSS_ENTER_PHASE_VARIANTS = [
  "{team}趕進首領房，首領正處於「{phase}」！",
  "{team}踏進首領房，戰鬥已進入「{phase}」。",
  "答對！{team}迎面撞上「{phase}」的首領。",
];

/** A wrong buzz (boss-buzzer.md): short, the music is playing again. */
export const BUZZ_OUT_VARIANTS = ["{team}答錯了！這題出局，其他隊快搶！", "不對！{team}這題不能再搶，音樂繼續！", "{monster}大笑，{team}出局！還有誰知道？"];

/** Every online team missed the question (a song or text, #328) (boss-music-buzzer.md M1): the same one again, everyone in. */
export const BUZZ_AGAIN_VARIANTS = ["都沒答對！同一題再搶一次！", "{team}也答錯，全員出局！同一題再搶一次！", "{monster}得意大笑：沒人答對！同一題再搶一次！"];
/** A music question with fields (#369): nobody got every field, so its second and last round opens to all. */
export const BUZZ_SECOND_VARIANTS = ["都沒全對！第二輪開搶，這是最後一次機會！", "{team}也沒全對！同一首第二輪，最後一次搶！", "{monster}冷笑：第二輪，也是最後一輪，快搶！"];
/** The last team still in dropped instead, so nobody answered wrong: the same question reopens to all (M1). */
export const BUZZ_REOPEN_LINE = "最後一隊斷線了！同一題再搶一次！";

/** 🚨 成立 (anti-ai-cheating.md): {team} was caught asking an AI by {caught}. */
export const CAUGHT_VARIANTS = [
  "🚨 {caught}抓到{team}偷問 AI，換一題！",
  "🚨 抓包成立！{team}換題，{caught}領賞！",
  "🚨 {caught}眼尖！{team}這題作廢，換題！",
];
/** 被轟出門 (owner, 2026-11-19): the persuasion check's natural 1, so {monster} threw {team} out unseen, into {to}. */
export const THROWN_OUT_VARIANTS = [
  "說服擲出 1！{monster}一腳把{team}踹出門，外面站著{to}。",
  "1 點！{team}一開口，{monster}直接關門送客，門外是{to}。",
  "{monster}聽完拎起{team}丟出去，正好摔在{to}面前。",
];
/** 逃跑: the team ran from {monster} into {to}, its new monster in the same room. */
export const FLEE_SWITCH_VARIANTS = [
  "{team}轉身就跑，迎面是{to}！",
  "{team}甩開{monster}，撞上了{to}。",
  "{team}換條路跑，前面站著{to}。",
  "{monster}還在原地，{team}已經遇上{to}。",
  "腳底抹油！{team}溜到{to}的地盤。",
  "{team}逃開{monster}，{to}正在等著。",
  "一轉身，{team}和{to}大眼瞪小眼。",
  "{team}換個對手，這回對上{to}。",
];


// The dice lines the owner approved (2026-11-19), one pool per skill tier: [1, 2–6, 7–19, 20] (skillTier). A class die's
// line plays as the die lands (dieLine); the warrior's and the dish die's replace the answer's line (line / plainLine).
type Tiers = readonly [string[], string[], string[], string[]];
const CLERIC_SILENT = ["神明已讀不回，{team}的祈禱沒有回應。", "{team}問了神奇海螺，海螺說：什麼都不要做。", "{team}雙手合十……天上一片安靜。"];
export const SKILL_TIER_VARIANTS: Record<"thief" | "mage" | "cleric", Tiers> = {
  thief: [
    ["有內鬼，終止交易！{team}的偷襲被發現了。", "{team}大意了，沒有閃，當場被逮。", "{team}踩到樹枝，啪一聲，全地城都聽到了。"],
    ["{team}繞到背後……{monster}剛好轉身，尷尬。", "這波偷襲，{monster}表示：是在哈囉？", "{team}的偷襲慢了半拍，只好正面上。"],
    ["年輕人不講武德，搞偷襲！{team}就位。", "來騙，來偷襲！{team}已經繞到{monster}背後。", "{team}消失在陰影裡，答對就是一點五倍。"],
    ["完美偷襲！{monster}大意了，沒有閃。", "{team}偷襲得手，勸{monster}耗子尾汁。", "教科書等級的背刺！{team}答對直接翻倍。"],
  ],
  mage: [
    ["{team}念了咒語……重音念錯，什麼都沒發生。", "{team}想翻找提示，結果卡在寶箱怪裡。", "魔力不足！{team}的法杖只冒出一點煙。"],
    ["{team}問了神奇海螺，海螺只肯說一點點。", "聽君一席話，如聽一席話。{team}拿到小提示。", "水晶球霧霧的，{team}只看到一點輪廓。"],
    ["{team}，你的下一句話是：「原來是這樣！」", "疾疾，提示現身！{team}拿到大提示。", "{team}的水晶球亮了，線索全都串起來了。"],
    ["領域展開！答案直接出現在{team}眼前。", "真相只有一個！{team}已經看穿答案。", "大成功！魔法書把答案整頁攤開給{team}。"],
  ],
  cleric: [
    CLERIC_SILENT,
    CLERIC_SILENT,
    ["死者蘇生！{team}原地復活，馬上再答。", "教練，{team}想再答一次！祈禱應驗了。", "{team}覺得還可以搶救一下，神明同意了。"],
    ["神蹟降臨！{team}滿血復活，這次神明請客。", "神明秒回還加碼：{team}再答一次，這次免費。", "大成功！聖光照亮{team}整隊，祈禱不算次數。"],
  ],
};

/** The warrior's roll, after 「戰士擲出 N 點，命中！／沒打中。」 (line()). */
export const WARRIOR_TIER_VARIANTS: Tiers = [
  ["{team}梭哈了……然後輸光了，整題賠掉。", "{team}衝進去了！……然後就沒有然後了。", "骰子停在一。{team}的劍飛出去，分數也飛了。"],
  ["大力沒有出奇蹟，{team}揮空了。", "氣勢滿分，準度零分。{team}沒打中。", "{team}的劍卡在牆上，拔了好久。"],
  ["大力出奇蹟！{team}不用答題，硬砍過關。", "超派！{team}一記重擊，{monster}倒了。", "題目？{team}選擇用劍回答，打八折照收。"],
  ["各位觀眾，二十點！{team}獎勵翻倍。", "{team}說要打十個，結果真的打贏了，翻倍！", "一劍定江山！{team}擲出二十，翻倍入袋。"],
];

/** A correct answer's dish die (every team; 2–6 is a chef's only, anyone else's reads as 7–19). 7–19 joins the answer's usual pool; 1 and 20 join the burnt and legend lines. */
export const DISH_TIER_VARIANTS: Tiers = [
  ["完了，芭比Q了。{team}的料理變成焦炭。", "黑暗料理界發來賀電，{team}這盤只剩一成。", "食神吃了一口，只說兩個字：失敗。"],
  ["食神一樣一樣挑：太鹹、太硬、沒入味。勉強過關。", "主廚大喊：還是生的！{team}這盤勉強過關。", "{team}的料理有點鹹，配三碗飯剛好。"],
  ["只要有心，人人都是食神。{team}上菜！", "真香！{team}這盤一上桌就被掃光。", "火候剛好，{team}上菜！"],
  ["黯然銷魂！{team}這盤吃了會想哭。", "評審含著淚問：以後吃不到怎麼辦？", "這道菜在發光！{team}煮出傳說級料理。"],
];
/** A chef's extra dish lines, on 7–19 and 20 only. */
export const CHEF_DISH_VARIANTS = { success: ["廚師出手就是不一樣，{team}多拿兩成。"], legend: ["食神降臨！{team}這盤值兩倍。"] };

/** The persuasion check as it lands (a 20 wins at once: its lines join ROLL_VARIANTS.persuaded). */
export const CHECK_VARIANTS = {
  fumble: ["聽君一席話，如聽一席話。{monster}更生氣了。", "{team}一開口，{monster}：是在哈囉？", "{monster}：你說得很好，下次別說了。"],
  fail: ["{monster}聽完了：可是我拒絕。", "{monster}：我不要你覺得，我要我覺得。", "{team}說了很多，{monster}一個字也沒聽進去。"],
  pass: ["{team}發動嘴遁，{monster}聽得頻頻點頭。", "{monster}，{team}是來談條件的。……談成了。", "{team}把{monster}誇上天，對方很受用。"],
};

/** 🍀 The lucky die: used, then its two dice landed (one good one bad: saved; both bad: bust). */
export const POTION_VARIANTS = {
  drink: ["小孩子才擲一顆，{team}兩顆都要。", "左手只是輔助，第二顆骰才是關鍵。", "{team}掏出幸運骰，下一顆骰多一次機會。"],
  saved: ["還好有幸運骰！第二顆骰救了{team}一命。", "一顆失敗，一顆成功，{team}選成功那顆。", "幸運骰發威，壞骰子當作沒看到。"],
  bust: ["多擲一顆也沒用，兩顆都很慘。{team}盡力了。", "兩顆骰子手牽手，一起擺爛。", "幸運骰：我只負責多骰一顆，不負責結果。"],
};

/** A wrong boss answer: the boss brings a new question, there is nothing to answer again (D2=B). */
export const BOSS_MISS_VARIANTS = [
  "{team}答錯！{monster}大笑一聲，換出新的難題。",
  "{team}落空！{monster}甩甩尾巴，丟出下一道題。",
  "{monster}閃過{team}這一擊，題目也跟著換了。",
  "{team}沒打中，{monster}出了新的考驗。",
];

/** An opened event room (docs/designs/event-rooms.md D11), per outcome. {points}: the satiety it gave or took. */
export const EVENT_VARIANTS: Record<EventOutcome, string[]> = {
  feast: [
    "香噴噴的{dish}！{team}飽足感 +{points}。",
    "{team}掀開寶箱，是{dish}！飽足感 +{points}。",
    "寶箱裡有{dish}，{team}飽足感 +{points}！",
    ...FOODIE.feast,
  ],
  rotten: [
    "是黑暗料理！{team}硬吞下去，飽足感 −{points}。",
    "{team}吃下冒著紫煙的菜，飽足感 −{points}。",
    "黑暗料理！{team}一口就後悔，飽足感 −{points}。",
  ],
  spring: [
    "{team}喝下泉水，力量湧現：職業能力多一次！",
    "泉水好甜！{team}精神大振，職業能力 +1！",
  ],
  curse: [
    "{team}被雕像詛咒了！下次答對只拿一半。",
    "紫光一閃，{team}中了詛咒：下次獎勵減半！",
  ],
  blessing: [
    "金光灑在{team}身上：下次答對多拿一半！",
    "雕像眼睛亮起金光，{team}下次答對多一半！",
  ],
  great: [
    "大吉！{team}收到一桌好菜，飽足感 +{points}！",
    "籤紙飄落：大吉！{team}飽足感 +{points}！",
  ],
  good: [
    "水晶球閃了閃：中吉！{team}職業能力多一次。",
    "占卜師點點頭：中吉！{team}職業能力 +1。",
  ],
  bad: [
    "水晶球暗了……凶！{team}下次答對只拿一半。",
    "占卜師搖頭：凶。{team}下次答對獎勵減半……",
  ],
  // Never read: the room narrates the fortune teller with FORTUNE_* below (fortune-teller.md).
  fortune: ["占卜師收起了水晶球。"],
};
/** The spring's and 中吉's line for a chef or a team with no class: satiety instead of an ability use. */
/** A rotten dish on an empty belly: nothing to take, so no −0. */
export const EVENT_ROTTEN_EMPTY_VARIANTS = ["黑暗料理！幸好{team}肚子早空，沒得扣。", "{team}聞了黑暗料理就放下，飽足感早已見底。"];
export const EVENT_SATIETY_VARIANTS = ["{team}喝了一口甜甜的泉水，飽足感 +{points}！", "清涼的泉水讓{team}精神一振，飽足感 +{points}。"];

/** The next line before a fork turn (docs/designs/branch-fork.md): two doors, and never what is behind them. */
export const NEXT_FORK_VARIANTS = ["輪到{team}。眼前出現兩扇門……", "{team}走到叉路口，兩扇門靜靜等著。", "換{team}上場。前方的路分成了兩條……"];
/** The fork's own narration, once the team's door clock starts (scripted only): the screen leaves the last team's story
 * for the doors. Neutral: never what is behind either door. */
export const FORK_OPEN_VARIANTS = ["{team}走到了叉路口……左邊還是右邊？", "兩扇門擋在{team}面前，走哪一扇？", "{team}停在叉路口。左門，還是右門？"];
/** Said once the ⚔️ door opens (scripted only, no AI wait): the room's monster steps out. */
export const FORK_MONSTER_VARIANTS = ["{team}推開 ⚔️ 門，{monster}擋在面前！", "⚔️ 門後，{monster}正等著{team}。"];
/** Said when the clock picked ⚔️ for the team. */
export const FORK_TIMEOUT_VARIANTS = ["{team}猶豫太久，被推進了 ⚔️ 門！", "時間到！一陣風把{team}吹進 ⚔️ 門。"];

/** 占卜師 (docs/designs/fortune-teller.md), all scripted: the crystal ball names the condition, never who matches. */
export const FORTUNE_CONDITION_VARIANTS = ["水晶球浮現一行字：「{condition}」……", "占卜師盯著水晶球：「我看見了……{condition}。」", "水晶球亮了起來：命運落在「{condition}」身上。"];
export const FORTUNE_PICK_VARIANTS = ["{team}，替他們挑一片吧！", "{team}，命運交給你們了，挑一片！", "{team}，是送禮還是挖坑？挑一片吧！"];
/** Said with the effect card: what was picked, then who it hit. */
export const FORTUNE_CHOSEN_VARIANTS = ["{team}挑了{effect}！", "{team}毫不猶豫：{effect}！"];
export const FORTUNE_TIMEOUT_VARIANTS = ["時間到！占卜師替{team}挑了{effect}。", "{team}想太久，水晶球自己轉到了{effect}。"];
export const FORTUNE_HIT_VARIANTS = ["命運落在{names}身上！", "中的是……{names}！", "水晶球照出了{names}！"];
/** The drawing team matched its own condition: the room laughs. */
export const FORTUNE_SELF_VARIANTS = ["中的是……{names}！挖坑給自己跳！", "{team}自己也中了！占卜師笑到水晶球都在抖。", "選的人自己也中了！{names}，這就是命運。"];
/** 💫 暈眩 skipped these teams' turn (fortune-teller.md Narration): one line, appended to the narration on show. */
export const stunSkipLine = (names: string) => `💫 ${names}還在頭暈，這回合跳過！`;

/** The transition segment (last of 3, when there's a next team): the narrator turns to the team now on turn. */
export const NEXT_VARIANTS = {
  room: [
    "輪到{team}，{monster}擋在前面，請看題目！",
    "{team}，換你們了！{monster}正等著你們。",
    "下一位：{team}。{monster}磨刀霍霍，準備好了？",
    "{team}上前一步，{monster}攔住了去路。",
    "{team}轉過彎，迎面撞上{monster}。",
    "{monster}盯上了{team}，請看題目。",
    "火光照出{monster}的身影，輪到{team}了。",
    ...FOODIE.nextRoom,
  ],
  boss: [
    "{team}，首領{monster}在等你們，看題目！",
    "換{team}上場，{monster}怒目而視。",
    "輪到{team}！{monster}正等著你們。",
    "{team}挺身而出，直面{monster}！",
    ...FOODIE.nextBoss,
  ],
};

/** Every line that talks about food, the chest's dishes included: after one, pick() takes a plain line from the next
 * pool. A pool that is all food (the chest) still says its line, so a food handoff may come right before a chest dish. */
const FOOD_LINES = new Set([...Object.values(FOODIE).flat(), ...EVENT_VARIANTS.feast, ...EVENT_VARIANTS.rotten, ...EVENT_ROTTEN_EMPTY_VARIANTS]);

/** Whether the part lines read well with this part. 「牠的整隻」 and 「牠的寶箱裡的東西」 do not, and a 4-character
 * part is the longest that keeps them at 22 characters.
 * shortcut: a rule on the catalog's wording, replace it with a per-monster flag if the catalog gets more odd parts. */
const namesPart = (part?: string) => !!part && part !== "整隻" && [...part].length >= 2 && [...part].length <= 4;

function fill(template: string, vars: object): string {
  const v = vars as Record<string, string | number | string[]>;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(v[key] ?? ""));
}

export function createScriptedProvider(rng: () => number = Math.random) {
  /** A shuffle bag per key: every line of the pool plays once before any repeats. Kept as the lines used this round,
   * so a class pool and the plain one sharing a key each keep their unused lines. `last` keeps the same line from
   * playing twice in a row across a reshuffle and across those pools. */
  const used: Record<string, Set<string>> = {};
  const last: Record<string, string> = {};
  /** The pool key of the line before this one, when that line talked about food. */
  let lastFoodKey: string | undefined;
  function pick(pool: string[], key: string): string {
    const round = (used[key] ??= new Set());
    let left = pool.filter((l) => !round.has(l));
    if (left.length === 0) {
      for (const l of pool) round.delete(l); // a new round for this pool only: a class team's unused lines stay unused
      left = pool;
    }
    // Another pool's food line came just before (the result before the handoff, the handoff before the next result).
    // One pool's own lines are never said back to back in a game, so its bag keeps every line once a round.
    if (lastFoodKey !== undefined && lastFoodKey !== key) {
      // Never two food lines in a row: a plain line from this round, or an early repeat of one when only food is left.
      const plain = left.filter((l) => !FOOD_LINES.has(l));
      const calm = plain.length > 0 ? plain : pool.filter((l) => !FOOD_LINES.has(l) && l !== last[key]);
      if (calm.length > 0) left = calm; // a pool that is all food (the chest's feast) has no plain line to say
    }
    let i = Math.floor(rng() * left.length);
    if (left[i] === last[key] && left.length > 1) i = (i + 1) % left.length;
    const line = left[i];
    round.add(line);
    last[key] = line;
    lastFoodKey = FOOD_LINES.has(line) ? key : undefined;
    return line;
  }
  /** The warrior's die by #305's rules: a 1 takes the question's whole reward, 7–19 pays 八成, a 20 doubles it. */
  function warriorResult(event: NarrationEvent): string {
    const value = "warriorRoll" in event ? event.warriorRoll : undefined;
    if (event.type === "retry") return value !== 1 ? "沒打中。" : event.penalty ? `大失敗，扣 ${event.penalty} 分！` : "大失敗，沒打中！";
    if (event.type === "boss-kill") return "命中！";
    return value === 20 ? "命中！獎勵加倍！" : "命中！拿八成獎勵。";
  }
  /** Set by plainLine when it picked a class die's 20 line, which says the number itself. */
  let saidDie = false;
  const provider = {
    name: "scripted",
    /** Synchronous, so it can back up a slow provider without awaiting anything. */
    line(event: NarrationEvent): string {
      saidDie = false;
      // The warrior's roll gets its own tier line, unless its hit's dish die landed a 20 or 1 (that line wins).
      const w = "warriorRoll" in event ? event.warriorRoll : undefined;
      const ownLine = (event.type === "correct" && !event.entersBoss && event.roll?.kind !== "dish") || (event.type === "retry" && !event.boss && !event.exhausted);
      if (w !== undefined && ownLine) {
        const t = skillTier(w);
        return `戰士擲出 ${w} 點，${warriorResult(event)}${fill(pick(WARRIOR_TIER_VARIANTS[t], `warrior-${t}`), event)}`;
      }
      const text = provider.plainLine(event);
      // A 大成功 / 手滑 line already says the warrior's die.
      const said = "warriorRoll" in event && event.warriorRoll !== undefined && !saidDie;
      return said ? `戰士擲出 ${event.warriorRoll} 點，${warriorResult(event)}${text}` : text;
    },
    /** line() without the warrior's number. */
    plainLine(event: NarrationEvent): string {
      if (event.type === "epilogue") return scriptedEpilogue(event.ranking, event.winners, rng);
      if ((event.type === "retry" || event.type === "boss-hit") && event.exhausted) return fill(pick(BOSS_EXHAUSTED_VARIANTS, "boss-exhausted"), event);
      if (event.type === "flee" && event.caught) return fill(pick(CAUGHT_VARIANTS, "caught"), event);
      if (event.type === "flee" && event.thrownOut) return fill(pick(THROWN_OUT_VARIANTS, "thrown-out"), { ...event, to: event.to ?? "新的怪物" });
      if (event.type === "flee" && event.to) return fill(pick(FLEE_SWITCH_VARIANTS, "flee-switch"), event);
      // In the boss room the prayer brings a new question: the boss-miss lines say so and never say "next round".
      // The prayer die's line already said the team answers again (owner, #416): only a beat of atmosphere, never 「下一輪」.
      if (event.type === "retry" && event.prayed && !event.boss) return fill(pick(ATMOSPHERE_VARIANTS.retry, "atm-retry"), event);
      if (event.type === "retry" && event.boss) return fill(pick(BOSS_MISS_VARIANTS, "boss-miss"), event);
      if (event.type === "retry" && event.buzzSecond) return fill(pick(BUZZ_SECOND_VARIANTS, "buzz-second"), event);
      if (event.type === "retry" && event.buzzAgain) return fill(pick(BUZZ_AGAIN_VARIANTS, "buzz-again"), event);
      if (event.type === "retry" && event.buzzOut) return fill(pick(BUZZ_OUT_VARIANTS, "buzz-out"), event);
      if (event.type === "boss-hit" && event.bossHp === 0) return fill(pick(BOSS_EMPTIED_VARIANTS, "boss-emptied"), event);
      if (event.type === "event-room") {
        const pool =
          event.satiety > 0 && (event.outcome === "spring" || event.outcome === "good")
            ? EVENT_SATIETY_VARIANTS
            : event.outcome === "rotten" && event.satiety === 0
              ? EVENT_ROTTEN_EMPTY_VARIANTS
              : EVENT_VARIANTS[event.outcome];
        return fill(pick(pool, `event-${event.outcome}`), { ...event, points: Math.abs(event.satiety) });
      }
      if (event.type === "boss-phase") return fill(pick(VARIANTS["boss-phase"], "boss-phase"), { ...event, ordinal: ordinal(event.phase) });
      // A phase under way means a team is already inside, so the phase lines are join lines too (none says 推開).
      if (event.type === "correct" && event.entersBoss?.phase) return fill(pick(BOSS_ENTER_PHASE_VARIANTS, "boss-enter-phase"), { ...event, phase: event.entersBoss.phase });
      if (event.type === "boss-kill" && event.cooked) return fill(pick(BOSS_DISH_VARIANTS, "boss-dish"), event);
      // A correct answer's dish die (not a persuasion 20 or 1's: that line wins): its own pool on 1, a chef's 2–6 and 20.
      const chef = "classId" in event && event.classId === "chef";
      // A 2–6 is a plain serve for anyone but a chef (dishTier).
      const dishTier = event.type === "correct" && !event.entersBoss && event.dish !== undefined && event.roll?.kind !== "check" ? tierOfDish(event.dish, chef) : undefined;
      if (event.type === "correct" && dishTier !== undefined && dishTier !== 2) {
        const pool =
          dishTier === 0
            ? [...DISH_TIER_VARIANTS[0], ...ROLL_VARIANTS.burnt.correct]
            : dishTier === 1
              ? DISH_TIER_VARIANTS[1]
              : [...DISH_TIER_VARIANTS[3], ...(chef ? CHEF_DISH_VARIANTS.legend : []), ...ROLL_VARIANTS.legend.correct];
        return fill(pick(pool, `dish-${dishTier}`), event);
      }
      // 7–19: the dish lines join the answer's usual pool.
      const served = dishTier === 2 ? [...DISH_TIER_VARIANTS[2], ...(chef ? CHEF_DISH_VARIANTS.success : [])] : [];
      if ((event.type === "correct" && !event.entersBoss) || event.type === "boss-hit") {
        // A warrior answered with its own d20, so a check's line (說服, 答對) would tell the wrong story.
        if (event.roll && !(event.roll.kind === "check" && event.warriorRoll !== undefined)) {
          const twenty = event.roll.value === 20;
          const kind = event.roll.kind === "check" ? "persuaded" : event.roll.kind === "dish" ? (twenty ? "legend" : "burnt") : "crit";
          saidDie = event.roll.kind === "crit";
          return fill(pick(ROLL_VARIANTS[kind][event.type], `${kind}-${event.type}`), event);
        }
      }
      if (event.type === "correct" && event.cooked && !event.entersBoss) return fill(pick([...(namesPart(event.part) ? [...FOODIE.dishPart, ...DISH_VARIANTS] : DISH_VARIANTS), ...served], "dish"), event);
      const bossEnter = event.type === "correct" && event.entersBoss;
      if (!bossEnter && (event.type === "correct" || event.type === "boss-hit") && event.classId) {
        return fill(pick([...CLASS_VARIANTS[event.classId][event.type], ...VARIANTS[event.type], ...(event.type === "correct" ? served : [])], event.type), event);
      }
      if (event.type === "correct" && !bossEnter && served.length) return fill(pick([...VARIANTS.correct, ...served], "correct"), event);
      if (bossEnter && event.entersBoss?.order) return fill(pick(BOSS_JOIN_VARIANTS, "boss-join"), event);
      return fill(pick(bossEnter ? BOSS_ENTER_VARIANTS : VARIANTS[event.type], bossEnter ? "boss-enter" : event.type), event);
    },
    /** Synchronous like line(): a short atmosphere/detail beat, the new middle segment. */
    atmosphereLine(event: NarrationEvent): string {
      if (event.type === "epilogue") return ""; // epilogue never uses this — see the module header
      if ("crowd" in event && event.crowd) return fill(pick(CROWD_VARIANTS[event.crowd.mood], `crowd-${event.crowd.mood}`), { ...event, by: event.crowd.team });
      return fill(pick(ATMOSPHERE_VARIANTS[event.type], `atm-${event.type}`), event);
    },
    /** Every epilogue segment (epilogueParts): the titles, the place calls, then the story. A title is left empty:
     * revealBeats reads that as the 🛡️ fallback (podium-titles.md eng 2). */
    epilogueLines(event: NarrationEvent): string[] {
      if (event.type !== "epilogue") return [];
      return epilogueParts(event).map((p) =>
        p.kind === "title" ? "" : p.kind === "place" ? placeLine(p.place, p.team) : scriptedEpilogue(event.ranking, event.winners, rng),
      );
    },
    /** A class die's line as it lands (SKILL_TIER_VARIANTS). */
    dieLine(kind: "thief" | "mage" | "cleric", value: number, vars: { team: string; monster: string }): string {
      const t = skillTier(value);
      return fill(pick(SKILL_TIER_VARIANTS[kind][t], `${kind}-${t}`), vars);
    },
    /** The persuasion check's line as it lands: a 1, a miss or a pass (CHECK_VARIANTS). */
    checkLine(kind: keyof typeof CHECK_VARIANTS, vars: { team: string; monster: string }): string {
      return fill(pick(CHECK_VARIANTS[kind], `check-${kind}`), vars);
    },
    /** 🍀 The lucky die's line: used, or its two dice landed (POTION_VARIANTS). */
    potionLine(kind: keyof typeof POTION_VARIANTS, team: string): string {
      return fill(pick(POTION_VARIANTS[kind], `potion-${kind}`), { team });
    },
    /** Synchronous like line(): the scripted prompt for whoever is up next. */
    nextLine(next: NextTurn): string {
      if (next.fork) return fill(pick(NEXT_FORK_VARIANTS, "next-fork"), next);
      return fill(pick(next.boss ? NEXT_VARIANTS.boss : NEXT_VARIANTS.room, next.boss ? "next-boss" : "next-room"), next);
    },
    async narrate(event: NarrationEvent): Promise<string> {
      return provider.line(event);
    },
    /** The fork's opening line, when the team's door clock starts. */
    forkOpening(team: string): string {
      return fill(pick(FORK_OPEN_VARIANTS, "fork-open"), { team });
    },
    /** The fortune's crystal ball: the condition, then the drawing team is asked to pick. */
    fortuneOpening(condition: FortuneCondition, team: string): string[] {
      return [fill(pick(FORTUNE_CONDITION_VARIANTS, "fortune-condition"), { condition: FORTUNE_CONDITION_TEXT[condition].text }), fill(pick(FORTUNE_PICK_VARIANTS, "fortune-pick"), { team })];
    },
    /** The effect card: what was picked (by the team, or the clock), then who it hit; `self` mocks the drawing team. */
    fortuneResult(effect: FortuneEffect, timeout: boolean, team: string, names: string, self: boolean): string[] {
      const e = FORTUNE_EFFECT_TEXT[effect];
      const chosen = fill(pick(timeout ? FORTUNE_TIMEOUT_VARIANTS : FORTUNE_CHOSEN_VARIANTS, timeout ? "fortune-timeout" : "fortune-chosen"), { team, effect: `${e.icon}${e.name}` });
      return [chosen, fill(pick(self ? FORTUNE_SELF_VARIANTS : FORTUNE_HIT_VARIANTS, self ? "fortune-self" : "fortune-hit"), { team, names })];
    },
    /** The line once a fork's ⚔️ door opened: picked, or `timeout`. */
    forkLine(timeout: boolean, team: string, monster: string): string {
      return timeout ? fill(pick(FORK_TIMEOUT_VARIANTS, "fork-timeout"), { team }) : fill(pick(FORK_MONSTER_VARIANTS, "fork-monster"), { team, monster });
    },
  };
  return provider;
}

const EPILOGUES = [
  "漫長的夜晚結束了。{winners}以 {score} {unit}奪下榜首，{rest}。地城重歸寂靜。",
  "火把漸漸熄滅，{winners}帶著 {score} {unit}走出地城，{rest}。",
  "貓頭鷹魔法師闔上書：{winners}以 {score} {unit}成為傳說，{rest}。",
];

/** Built from the final ranking, so the scores in the story are always right. `ranking` is sorted high to low. */
export function scriptedEpilogue(
  ranking: { name: string; score: number; dishes?: string[] }[],
  winners: string[],
  rng: () => number = Math.random,
): string {
  const top = ranking[0]?.score ?? 0;
  const unit = ranking.some((t) => t.dishes?.length) ? "飽足感" : "分";
  const rest = ranking
    .filter((t) => !winners.includes(t.name))
    .slice(0, 2)
    .map((t) => `${t.name} ${t.score} ${unit}`);
  const restText = rest.length > 0 ? `${rest.join("、")}緊追在後` : "無人能敵";
  const story = fill(EPILOGUES[Math.floor(rng() * EPILOGUES.length)], { winners: winners.join("、"), score: top, unit, rest: restText });
  // The feast: the champions' dishes, at most three so the line stays short.
  const eaten = [...new Set(ranking.filter((t) => winners.includes(t.name)).flatMap((t) => t.dishes ?? []))].slice(0, 3);
  return eaten.length ? `${story}${winners.join("、")}吃了${eaten.join("、")}，最飽。` : story;
}
