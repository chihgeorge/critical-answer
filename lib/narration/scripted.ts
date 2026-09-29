// The always-available narrator: hand-written lines with template slots, four
// or five variants per event type, never the same variant twice in a row.

import type { NarrationEvent, NextTurn } from "./events";

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
  ],
  retry: [
    "{team}答錯了，{monster}還擋在原地，再試一次！",
    "{monster}冷笑一聲，{team}還有機會重答。",
    "差一點！{team}握緊武器，再戰{monster}。",
    "{team}答錯，{monster}紋絲不動。",
    "這一擊落空了，{team}深吸一口氣。",
  ],
  flee: [
    "{team}轉身就跑，{monster}的怒吼追在後面！",
    "{team}狼狽逃開，換個角度再挑戰{monster}。",
    "腳底抹油！{team}撤退，換一道簡單些的關卡。",
    "{monster}嚇跑了{team}，但這不是結束。",
    "{team}喘著氣退出戰場，重新整隊。",
  ],
  "boss-hit": [
    "{team}命中首領！只剩 {bossHp} 顆心。",
    "龍鱗裂開了，首領還剩 {bossHp} 顆心！",
    "{team}重擊首領，血量剩 {bossHp}/{bossMaxHp}。",
    "首領怒吼，還撐得住 {bossHp} 顆心。",
    "轟！{team}再添一擊，{bossHp} 顆心待破。",
  ],
  "boss-kill": [
    "{team}擊倒了{monster}！額外 {bonus} 分！",
    "{monster}轟然倒下，{team}拿下致命一擊，+{bonus}！",
    "終結！{team}的最後一擊讓{monster}灰飛煙滅。",
    "{monster}的哀號迴盪在地城，{team}是英雄！",
    "地城安靜了。{team}擊敗{monster}，加碼 {bonus} 分。",
  ],
};

/** A correct answer that takes the team into the boss room (event.entersBoss). No callback to the
 * team's branch choices here: with no LLM, the design doc (T4) prefers announcing the entrance over a
 * forced "you chose X" template. */
export const BOSS_ENTER_VARIANTS = [
  "{team}答對了，推開最後一道門——首領就在眼前！",
  "{monster}倒下，{team}踏進了首領的巢穴，+{points}！",
  "答對！{team}走進最深處，首領緩緩睜開眼睛。",
  "{team}拿下 {points} 分，地城最深處的大門為他們打開了。",
];

/** The middle line: a short atmosphere/detail beat, one per event type — added for multi-segment
 * narration (docs/designs/multi-segment-narration.md). Every event gets one of these, whether or
 * not it has a next team, so it's a flat pool keyed by event type, same shape as VARIANTS. */
export const ATMOSPHERE_VARIANTS: Record<Exclude<NarrationEvent["type"], "epilogue">, string[]> = {
  start: [
    "火把的光在石牆上搖曳。",
    "空氣裡有股潮濕的塵土味。",
    "遠處傳來滴水聲，一滴、又一滴。",
    "石廊深處，看不見盡頭。",
  ],
  correct: [
    "石屑從天花板簌簌落下。",
    "空氣裡還殘留著戰鬥的餘熱。",
    "冒險者們喘了口氣，稍作喘息。",
    "地城彷彿也鬆了一口氣。",
  ],
  retry: [
    "汗水滴落，緊張感沒有散去。",
    "時間彷彿慢了下來。",
    "石廊裡一片寂靜，等著下一步。",
    "{monster}的影子在牆上晃動。",
  ],
  flee: [
    "腳步聲漸漸遠去，又漸漸靠近。",
    "喘息聲在石廊裡迴盪。",
    "撤退不是恥辱，是策略。",
    "重新整隊的片刻，也是片刻的喘息。",
  ],
  "boss-hit": [
    "地城為之一震。",
    "碎石從天花板落下。",
    "首領的怒吼震得人耳鳴。",
    "戰鬥的氣息瀰漫整個房間。",
  ],
  "boss-kill": [
    "地城陷入一片寂靜。",
    "塵埃落定，勝利的氣息瀰漫。",
    "石廊裡迴盪著最後一聲回音。",
    "這一刻，值得被記住。",
  ],
};

/** The transition segment (last of 3, when there's a next team): the narrator turns to the team now on turn. */
export const NEXT_VARIANTS = {
  room: [
    "輪到{team}，{monster}擋在前面，請看題目！",
    "{team}，換你們了！{monster}正等著你們。",
    "下一位：{team}。{monster}磨牙霍霍，準備好了嗎？",
    "{team}上前一步，{monster}攔住了去路。",
    "接下來輪到{team}，面對{monster}！",
  ],
  boss: [
    "{team}，首領{monster}在等你們，看題目！",
    "換{team}上場，{monster}怒目而視。",
    "輪到{team}！{monster}擋在最後一道門前。",
    "{team}挺身而出，直面{monster}！",
  ],
};

function fill(template: string, event: NarrationEvent): string {
  const vars = event as unknown as Record<string, string | number | string[]>;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function createScriptedProvider(rng: () => number = Math.random) {
  const last: Partial<Record<NarrationEvent["type"] | "next-room" | "next-boss" | "boss-enter", number>> = {};
  const lastAtmosphere: Partial<Record<Exclude<NarrationEvent["type"], "epilogue">, number>> = {};
  const provider = {
    name: "scripted",
    /** Synchronous, so it can back up a slow provider without awaiting anything. */
    line(event: NarrationEvent): string {
      if (event.type === "epilogue") return scriptedEpilogue(event.ranking, event.winners, rng);
      const key = event.type === "correct" && event.entersBoss ? "boss-enter" : event.type;
      const pool = key === "boss-enter" ? BOSS_ENTER_VARIANTS : VARIANTS[event.type];
      let i = Math.floor(rng() * pool.length);
      if (i === last[key]) i = (i + 1) % pool.length;
      last[key] = i;
      return fill(pool[i], event);
    },
    /** Synchronous like line(): a short atmosphere/detail beat, the new middle segment. */
    atmosphereLine(event: NarrationEvent): string {
      if (event.type === "epilogue") return ""; // epilogue never uses this — see the module header
      const pool = ATMOSPHERE_VARIANTS[event.type];
      let i = Math.floor(rng() * pool.length);
      if (i === lastAtmosphere[event.type]) i = (i + 1) % pool.length;
      lastAtmosphere[event.type] = i;
      return fill(pool[i], event);
    },
    /** Synchronous like line(): the scripted prompt for whoever is up next. */
    nextLine(next: NextTurn): string {
      const key = next.boss ? "next-boss" : "next-room";
      const pool = next.boss ? NEXT_VARIANTS.boss : NEXT_VARIANTS.room;
      let i = Math.floor(rng() * pool.length);
      if (i === last[key]) i = (i + 1) % pool.length;
      last[key] = i;
      return pool[i].replace("{team}", next.team).replace("{monster}", next.monster);
    },
    async narrate(event: NarrationEvent): Promise<string> {
      return provider.line(event);
    },
  };
  return provider;
}

const EPILOGUES = [
  "漫長的夜晚結束了。{winners}以 {score} 分奪下榜首，{rest}。地城重歸寂靜。",
  "火把漸漸熄滅，{winners}帶著 {score} 分走出地城，{rest}。",
  "貓頭鷹魔法師闔上書：{winners}以 {score} 分成為傳說，{rest}。",
];

/** Built from the final ranking, so the scores in the story are always right. `ranking` is sorted high to low. */
export function scriptedEpilogue(
  ranking: { name: string; score: number }[],
  winners: string[],
  rng: () => number = Math.random,
): string {
  const top = ranking[0]?.score ?? 0;
  const rest = ranking
    .filter((t) => !winners.includes(t.name))
    .slice(0, 2)
    .map((t) => `${t.name} ${t.score} 分`);
  const restText = rest.length > 0 ? `${rest.join("、")}緊追在後` : "無人能敵";
  return EPILOGUES[Math.floor(rng() * EPILOGUES.length)]
    .replace("{winners}", winners.join("、"))
    .replace("{score}", String(top))
    .replace("{rest}", restText);
}
