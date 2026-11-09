// The always-available narrator: hand-written lines with template slots, drawn
// from a shuffle bag per pool, so every line plays once before any repeats.

import { epilogueParts, type NarrationEvent, type NextTurn } from "./events";
import { ordinal } from "../ordinal";
import { placeLine } from "../podium";
import type { ClassId, EventOutcome } from "../game-state";
import { EVENT_SCENE_TEXT } from "../event-text";

export interface NarrationProvider {
  name: string;
  narrate(event: NarrationEvent, opts?: { signal?: AbortSignal }): Promise<string>;
}

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
    "{team}答錯了，{monster}還擋在原地，再試一次！",
    "{monster}冷笑一聲，{team}還有機會重答。",
    "差一點！{team}握緊武器，再戰{monster}。",
    "{team}答錯，{monster}紋絲不動。",
    "這一擊落空了，{team}深吸一口氣。",
    "{team}的答案偏了，{monster}鬆了口氣。",
    "{monster}晃了晃身子，{team}再來一次。",
    "答案不對，{team}重新打起精神。",
    "{monster}擋了下來，{team}還沒輸。",
    "可惜！{team}再想想，{monster}在等。",
  ],
  flee: [
    "{team}轉身就跑，{monster}的怒吼追在後面！",
    "{team}狼狽逃開，換個角度再挑戰{monster}。",
    "腳底抹油！{team}撤退，換一道簡單些的關卡。",
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
    "{monster}的鱗片轉了顏色，戰鬥進入第{ordinal}階段：{name}！",
    "還沒結束！{monster}重新站起，第{ordinal}階段「{name}」開始了。",
    "{monster}發出一聲長嘯，血量全滿——第{ordinal}階段：{name}。",
    "地城劇烈搖晃，{monster}換了模樣，迎來第{ordinal}階段！",
  ],
  "event-room": [], // never read: line() picks from EVENT_VARIANTS
  "boss-kill": [
    "{team}擊倒了{monster}！額外 {bonus} 分！",
    "{monster}轟然倒下，{team}拿下致命一擊，+{bonus}！",
    "終結！{team}的最後一擊讓{monster}灰飛煙滅。",
    "{monster}的哀號迴盪在地城，{team}是英雄！",
    "地城安靜了。{team}擊敗{monster}，加碼 {bonus} 分。",
  ],
};

/** Attack lines that name a class's own weapons and spells, mixed into the plain pools for a team
 * with a class. The plain pools name no weapon, so a team with no class never swings the wrong one. */
export const CLASS_VARIANTS: Record<ClassId, { correct: string[]; "boss-hit": string[] }> = {
  mage: {
    correct: ["{team}揮動法杖，火球轟向{monster}，+{points}！", "{team}念完咒語，冰箭把{monster}釘在原地，+{points}。"],
    "boss-hit": ["{team}召來閃電劈中首領，只剩 {bossHp} 顆心！", "{team}的火球炸開，首領還剩 {bossHp} 顆心。"],
  },
  cleric: {
    correct: ["{team}召來聖光，擊退了{monster}，+{points}！", "{team}舉起權杖，{monster}在聖光中退散，+{points}。"],
    "boss-hit": ["聖光從天而降，{team}擊中首領，只剩 {bossHp} 顆心！", "{team}的聖光化成光矛，首領還剩 {bossHp} 顆心。"],
  },
  warrior: {
    correct: ["{team}揮劍一斬，{monster}應聲倒地，+{points}！", "{team}舉盾衝撞，把{monster}撞飛了，+{points}。"],
    "boss-hit": ["{team}一劍砍在首領身上，只剩 {bossHp} 顆心！", "{team}掄起戰斧重擊，首領還剩 {bossHp} 顆心。"],
  },
  thief: {
    correct: ["{team}從暗處射出飛刀，{monster}來不及躲，+{points}！", "{team}繞到背後一刺，{monster}倒下了，+{points}。"],
    "boss-hit": ["{team}的匕首找到破綻，首領只剩 {bossHp} 顆心！", "{team}從暗處一刺，首領還剩 {bossHp} 顆心。"],
  },
  chef: {
    correct: ["{team}掄起平底鍋，{monster}被敲暈了，+{points}！", "{team}的菜刀一閃，{monster}已經切好備料，+{points}。"],
    "boss-hit": ["{team}一鍋砸在首領頭上，只剩 {bossHp} 顆心！", "{team}的爐火燒向首領，還剩 {bossHp} 顆心。"],
  },
};

/** A natural 20 (a critical hit) or a 1 (a fumble that still hits) on the die behind a hit (event.roll): this line
 * replaces the usual one, it is not an extra line (dnd design R1, E3). */
export const ROLL_VARIANTS: Record<"crit" | "fumble" | "persuaded" | "blunder", { correct: string[]; "boss-hit": string[] }> = {
  crit: {
    correct: [
      "大成功！{team}擲出 20，一擊打飛{monster}，+{points}！",
      "骰子停在 20！{team}的會心一擊，{monster}當場倒地，+{points}！",
      "天選的 20！{team}暴擊{monster}，多拿一半，+{points}！",
    ],
    "boss-hit": [
      "大成功！{team}擲出 20，重擊首領，只剩 {bossHp} 顆心！",
      "20 點暴擊！{team}多打掉一顆心，首領還剩 {bossHp} 顆心！",
    ],
  },
  fumble: {
    correct: [
      "手一滑……{team}擲出 1，還是打中了{monster}，+{points}。",
      "骰子停在 1！{team}跌了一跤，{monster}居然還是倒了，+{points}。",
    ],
    "boss-hit": [
      "擲出 1，{team}差點摔倒……還是擊中首領，剩 {bossHp} 顆心。",
      "手一滑！{team}的攻擊歪了一下，還是打中，首領還剩 {bossHp} 顆心。",
    ],
  },
  // A persuasion check (kind "check"): a natural 20 wins without an answer, a 1 halves the reward.
  persuaded: {
    correct: [
      "說服成功！{team}擲出 20，{monster}直接讓路，不用答題，+{points}！",
      "20 點！{team}幾句話就說動了{monster}，+{points}！",
    ],
    "boss-hit": [
      "擲出 20！{team}說得首領啞口無言，只剩 {bossHp} 顆心！",
      "20 點說服！首領聽完{team}的話也動搖了，還剩 {bossHp} 顆心！",
    ],
  },
  blunder: {
    correct: [
      "說服擲出 1，{team}講錯話了……還好答對，+{points}，只拿一半。",
      "{team}一開口就失言，{monster}很不爽，答對也只拿一半，+{points}。",
    ],
    "boss-hit": [
      "說服擲出 1，首領被{team}惹毛了……還是答對，首領剩 {bossHp} 顆心。",
      "{team}說服失敗，但答案是對的，首領還剩 {bossHp} 顆心。",
    ],
  },
};

/** A correct answer on a monster that will be cooked (event.cooked, docs/designs/monster-cuisine.md). The dish
 * itself is named only once the host serves it (cooking I1), so these lines never say what it becomes. */
export const DISH_VARIANTS = [
  "{team}答對了！{monster}倒下了，+{points} 飽足感。",
  "{team}收拾了{monster}，鍋子已經在等了。",
  "{monster}倒下了……{team}的肚子咕嚕叫，+{points}。",
];

/** The boss kill when the boss will be cooked. */
export const BOSS_DISH_VARIANTS = [
  "{team}擊倒了{monster}！再加 {bonus} 飽足感！",
  "{monster}轟然倒下，{team}拿下最後一擊，+{bonus}！",
  "終結！{monster}倒下了，今晚要開大鍋。",
];

/** The first team into the boss room opens the door (event.entersBoss without order or phase). */
export const BOSS_ENTER_VARIANTS = [
  "{team}答對了，推開最後一道門——首領就在眼前！",
  "{monster}倒下，{team}踏進了首領的巢穴，+{points}！",
  "答對！{team}走進最深處，首領緩緩睜開眼睛。",
  "{team}拿下 {points} 分，地城最深處的大門為他們打開了。",
];

/** A later team joining the boss fight (event.entersBoss.order): the door is already open (live-map.md D9). */
export const BOSS_JOIN_VARIANTS = [
  "{team}也趕到了首領房，加入戰局，+{points}！",
  "答對！{team}衝進敞開的大門，和大家並肩作戰。",
  "{monster}倒下，{team}跟上腳步，首領又多了一個對手！",
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
    "塵埃落定，勝利的氣息瀰漫。",
    "石廊裡迴盪著最後一聲回音。",
    "這一刻，值得被記住。",
    "火把一根接一根亮了起來。",
    "貓頭鷹闔上了這一章。",
    "遠處傳來歡呼，一路傳到地面。",
    "首領的寶座空了。",
    "塵土慢慢落下，像一場細雪。",
    "這段故事，會被說上很多年。",
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
const BOSS_ENTER_PHASE_VARIANTS = [
  "{team}趕進首領房，首領正處於「{phase}」！",
  "{team}踏進首領房，戰鬥已經進入「{phase}」。",
  "答對！{team}走進最深處，迎面就是「{phase}」的首領。",
];

/** A wrong buzz (boss-buzzer.md): short, the music is playing again. */
export const BUZZ_OUT_VARIANTS = ["{team}答錯了！這題出局，其他隊快搶！", "不對！{team}這題不能再搶，音樂繼續！", "{monster}大笑，{team}出局！還有誰知道？"];

/** Every online team missed the song (boss-music-buzzer.md M1): the same one again, everyone in. */
export const BUZZ_AGAIN_VARIANTS = ["都沒答對！同一首再搶一次！", "{team}也答錯，全員出局……重來！同一首，大家再搶一次！", "{monster}得意大笑：沒人答得出來！同一首，再搶一次！"];

/** A wrong boss answer: the boss brings a new question, there is nothing to answer again (D2=B). */
export const BOSS_MISS_VARIANTS = [
  "{team}答錯了！{monster}大笑一聲，換出新的難題。",
  "{team}落空！{monster}甩甩尾巴，丟出下一道題。",
  "{monster}閃過{team}這一擊，題目也跟著換了。",
  "{team}沒打中，{monster}出了新的考驗。",
];

/** An opened event room (docs/designs/event-rooms.md D11), per outcome. {points}: the satiety it gave or took. */
export const EVENT_VARIANTS: Record<EventOutcome, string[]> = {
  feast: [
    "寶箱一打開，香味撲鼻：是{dish}！{team}吃得好飽，飽足感 +{points}。",
    "{team}掀開寶箱，裡面是熱騰騰的{dish}！飽足感 +{points}。",
    "寶箱裡藏著一道{dish}，{team}一口接一口，飽足感 +{points}！",
  ],
  rotten: [
    "寶箱一打開，一股怪味衝出來……是黑暗料理！{team}硬吞下去，飽足感 −{points}。",
    "{team}掀開寶箱，裡面的菜冒著紫煙……吃下去肚子好痛，飽足感 −{points}。",
    "黑暗料理！{team}吃了一口就後悔了，飽足感 −{points}。",
  ],
  spring: [
    "{team}喝了一口泉水，力量湧了上來：職業能力多一次！",
    "泉水甜甜的，{team}精神大振，職業能力 +1！",
  ],
  curse: [
    "{team}一摸雕像，紫煙冒了出來……被詛咒了！下次答對只拿一半。",
    "骷髏雕像咯咯笑了起來：{team}中了詛咒，下次答對獎勵減半！",
  ],
  blessing: [
    "小精靈在{team}頭上灑下金粉：下次答對多拿一半！",
    "精靈眨眨眼，祝福了{team}：下次答對，獎勵多一半！",
  ],
  great: [
    "占卜師的水晶球亮起金光——大吉！{team}收到一桌好菜，飽足感 +{points}！",
    "籤紙飄落：大吉！{team}飽足感 +{points}！",
  ],
  good: [
    "水晶球閃了閃——中吉！{team}的職業能力多一次。",
    "占卜師點點頭：中吉！{team}職業能力 +1。",
  ],
  bad: [
    "水晶球暗了下來……凶！{team}下次答對只拿一半。",
    "占卜師搖搖頭：凶。{team}下次答對獎勵減半……",
  ],
};
/** The spring's and 中吉's line for a chef or a team with no class: satiety instead of an ability use. */
/** A rotten dish on an empty belly: nothing to take, so no −0. */
const EVENT_ROTTEN_EMPTY_VARIANTS = ["寶箱裡是黑暗料理！幸好{team}肚子早就空了，沒得扣。", "{team}聞了一口黑暗料理就放下了，飽足感本來就見底。"];
const EVENT_SATIETY_VARIANTS = ["{team}喝了一口甜甜的泉水，飽足感 +{points}！", "清涼的泉水讓{team}精神一振，飽足感 +{points}。"];

/** The next line before an event turn: it sets the scene ({story}) and never says what will happen. */
const NEXT_EVENT_VARIANTS = ["輪到{team}。{team}推開門，{story}……", "{team}走進下一間房：沒有怪物，只有{story}。", "換{team}上場。這間房很安靜，{story}……"];

/** The transition segment (last of 3, when there's a next team): the narrator turns to the team now on turn. */
export const NEXT_VARIANTS = {
  room: [
    "輪到{team}，{monster}擋在前面，請看題目！",
    "{team}，換你們了！{monster}正等著你們。",
    "下一位：{team}。{monster}磨刀霍霍，準備好了嗎？",
    "{team}上前一步，{monster}攔住了去路。",
    "接下來輪到{team}，面對{monster}！",
    "{team}轉過彎，迎面撞上{monster}。",
    "換{team}上場，{monster}已經擋在門口。",
    "{monster}盯上了{team}，請看題目。",
    "火光照出{monster}的身影，輪到{team}了。",
    "{team}，{monster}在前方等著，準備好了嗎？",
  ],
  boss: [
    "{team}，首領{monster}在等你們，看題目！",
    "換{team}上場，{monster}怒目而視。",
    "輪到{team}！{monster}正等著你們。",
    "{team}挺身而出，直面{monster}！",
  ],
};

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
  function pick(pool: string[], key: string): string {
    const round = (used[key] ??= new Set());
    let left = pool.filter((l) => !round.has(l));
    if (left.length === 0) {
      for (const l of pool) round.delete(l); // a new round for this pool only: a class team's unused lines stay unused
      left = pool;
    }
    let i = Math.floor(rng() * left.length);
    if (left[i] === last[key] && left.length > 1) i = (i + 1) % left.length;
    const line = left[i];
    round.add(line);
    last[key] = line;
    return line;
  }
  /** Set by plainLine when it picked a crit die's line, which says the number itself. */
  let saidDie = false;
  const provider = {
    name: "scripted",
    /** Synchronous, so it can back up a slow provider without awaiting anything. */
    line(event: NarrationEvent): string {
      saidDie = false;
      const text = provider.plainLine(event);
      // A 大成功 / 手滑 line already says the warrior's die.
      const said = "warriorRoll" in event && event.warriorRoll !== undefined && !saidDie;
      return said ? `戰士擲出 ${event.warriorRoll} 點，${event.type === "retry" ? "沒打中。" : "命中！"}${text}` : text;
    },
    /** line() without the warrior's number. */
    plainLine(event: NarrationEvent): string {
      if (event.type === "epilogue") return scriptedEpilogue(event.ranking, event.winners, rng);
      if ((event.type === "retry" || event.type === "boss-hit") && event.exhausted) return fill(pick(BOSS_EXHAUSTED_VARIANTS, "boss-exhausted"), event);
      if (event.type === "retry" && event.boss) return fill(pick(BOSS_MISS_VARIANTS, "boss-miss"), event);
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
      if ((event.type === "correct" && !event.entersBoss) || event.type === "boss-hit") {
        // A warrior answered with its own d20, so a check's line (說服, 答對) would tell the wrong story.
        if (event.roll && !(event.roll.kind === "check" && event.warriorRoll !== undefined)) {
          const twenty = event.roll.value === 20;
          const kind = event.roll.kind === "check" ? (twenty ? "persuaded" : "blunder") : twenty ? "crit" : "fumble";
          saidDie = event.roll.kind === "crit";
          return fill(pick(ROLL_VARIANTS[kind][event.type], `${kind}-${event.type}`), event);
        }
      }
      if (event.type === "correct" && event.cooked && !event.entersBoss) return fill(pick(DISH_VARIANTS, "dish"), event);
      const bossEnter = event.type === "correct" && event.entersBoss;
      if (!bossEnter && (event.type === "correct" || event.type === "boss-hit") && event.classId) {
        return fill(pick([...CLASS_VARIANTS[event.classId][event.type], ...VARIANTS[event.type]], event.type), event);
      }
      if (bossEnter && event.entersBoss?.order) return fill(pick(BOSS_JOIN_VARIANTS, "boss-join"), event);
      return fill(pick(bossEnter ? BOSS_ENTER_VARIANTS : VARIANTS[event.type], bossEnter ? "boss-enter" : event.type), event);
    },
    /** Synchronous like line(): a short atmosphere/detail beat, the new middle segment. */
    atmosphereLine(event: NarrationEvent): string {
      if (event.type === "epilogue") return ""; // epilogue never uses this — see the module header
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
    /** Synchronous like line(): the scripted prompt for whoever is up next. */
    nextLine(next: NextTurn): string {
      if (next.event) return fill(pick(NEXT_EVENT_VARIANTS, "next-event"), { team: next.team, story: EVENT_SCENE_TEXT[next.event].story });
      return fill(pick(next.boss ? NEXT_VARIANTS.boss : NEXT_VARIANTS.room, next.boss ? "next-boss" : "next-room"), next);
    },
    async narrate(event: NarrationEvent): Promise<string> {
      return provider.line(event);
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
