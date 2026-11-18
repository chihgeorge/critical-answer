// The monster catalog (docs/designs/monster-catalog.md): every monster a bank may name, with its
// dish. Pure data and functions, no question or answer, so client components may import it.
// Ids are only ever added, never renamed or removed: a saved bank names monsters by id.

import type { MonsterSprite } from "./sprite-kind";

/** What a defeated monster is cooked into (docs/designs/monster-cuisine.md). */
export interface BankDish {
  /** The edible part, e.g. 外膜. */
  part: string;
  /** How it is cooked, e.g. 曬乾後涼拌. */
  method: string;
  /** The dish's name, e.g. 史萊姆寒天涼拌. */
  name: string;
  /** One line about how it tastes. */
  comment: string;
}
/** Character limits per dish field, counted in characters (Array.from), so the card fits the TV. */
export const DISH_LIMITS: Record<keyof BankDish, number> = { part: 12, method: 16, name: 16, comment: 30 };

export interface CatalogMonster {
  id: string;
  name: string;
  /** One sprite per monster, never shared. */
  sprite: MonsterSprite;
  /** Base CSS hue-rotate degrees. */
  hue: number;
  /** true: only a boss. false: only a room monster. */
  boss: boolean;
  dish: BankDish;
  /** What it shares when a persuasion 20 talks it aside instead (persuasion-gift): a harmless ingredient it can spare,
   * cooked the same way; `part` is the ingredient it gives. */
  gift: BankDish;
}

export const MONSTERS: readonly CatalogMonster[] = [
  { id: "slime-soft", name: "軟趴趴史萊姆", sprite: "slime", hue: 0, boss: false, dish: { part: "外膜", method: "曬乾後涼拌", name: "史萊姆寒天涼拌", comment: "口感像寒天，帶點青草香。" }, gift: { part: "一塊果凍", method: "冰鎮後淋蜂蜜", name: "史萊姆蜂蜜果凍", comment: "牠分了一小塊，自己還是圓滾滾的。" } },
  { id: "ghost-shy", name: "害羞幽靈", sprite: "ghost", hue: 0, boss: false, dish: { part: "霧狀身體", method: "冰鎮後刨成細雪", name: "幽靈霧冰沙", comment: "入口就化，害羞得像沒吃過。" }, gift: { part: "一縷霧氣", method: "收進杯裡打成奶泡", name: "幽靈霧奶茶", comment: "奶泡輕得像沒有，牠躲在杯後偷看。" } },
  { id: "ghost-cry", name: "愛哭幽靈", sprite: "ghost-cry", hue: 0, boss: false, dish: { part: "眼淚", method: "熬煮收乾成鹽", name: "淚鹽烤飯糰", comment: "鹹得剛好，吃完有點想哭。" }, gift: { part: "幾滴眼淚", method: "揉進麵團當鹽", name: "淚滴鹽可頌", comment: "鹹香剛好，牠說這次是感動的淚。" } },
  { id: "dragon", name: "深淵小黑龍", sprite: "dragon", hue: 0, boss: true, dish: { part: "尾巴肉", method: "用牠自己的龍息烤", name: "龍息烤龍尾", comment: "外皮焦香，肉汁多到滴下來。" }, gift: { part: "一片脫落的鱗", method: "燒熱當石板煎肉", name: "龍鱗石板燒", comment: "鱗片燙得剛好，小黑龍說下次還有。" } },
  { id: "mushroom-crumbly", name: "碎碎蘑菇", sprite: "mushroom", hue: 0, boss: false, dish: { part: "菌傘", method: "串起來用炭火烤", name: "烤蘑菇串", comment: "一咬就碎，香氣卻黏在嘴裡不走。" }, gift: { part: "一把孢子", method: "撒進奶油白醬", name: "孢子奶油燉飯", comment: "菇香很濃，碎碎蘑菇一根菌絲也沒少。" } },
  { id: "bat-hanging", name: "倒掛蝙蝠", sprite: "bat", hue: 0, boss: false, dish: { part: "翅膀", method: "裹粉下鍋酥炸", name: "酥炸蝙蝠翅", comment: "酥到會響，吃的時候別倒著拿。" }, gift: { part: "一籃野莓", method: "倒吊風乾成果乾", name: "蝙蝠莓果乾", comment: "酸酸甜甜，是牠倒掛時順手摘的。" } },
  { id: "skeleton-rattle", name: "喀啦骷髏兵", sprite: "skeleton", hue: 0, boss: false, dish: { part: "大骨", method: "小火熬一整夜", name: "骷髏大骨湯", comment: "湯白得發亮，喝完骨頭還在喀啦響。" }, gift: { part: "一根備用骨頭", method: "熬成清湯", name: "備用骨清湯", comment: "牠喀啦喀啦笑：反正我骨頭很多。" } },
  { id: "mimic", name: "寶箱怪", sprite: "mimic", hue: 0, boss: false, dish: { part: "寶箱裡的東西", method: "照原樣裝好蓋上", name: "寶箱便當", comment: "打開前不知道是寶物還是牙齒。" }, gift: { part: "箱底的零食", method: "原封不動擺盤", name: "寶箱點心盒", comment: "牙齒收起來了，這次真的是寶物。" } },
  { id: "spider-fuzzy", name: "毛毛蜘蛛", sprite: "spider", hue: 0, boss: false, dish: { part: "蜘蛛絲", method: "加糖捲成一團", name: "蛛絲棉花糖", comment: "輕飄飄的，黏在臉上比黏在嘴裡多。" }, gift: { part: "一捲蛛絲", method: "拉成細麵條", name: "蛛絲細麵", comment: "細到看不見，吸進嘴裡滑溜溜。" } },
  { id: "snail-slow", name: "慢吞吞蝸牛", sprite: "snail", hue: 0, boss: false, dish: { part: "蝸牛肉", method: "塞回殼裡鋪起司焗烤", name: "焗烤蝸牛", comment: "要慢慢吃，牠就是這樣長大的。" }, gift: { part: "殼上長的青苔", method: "磨成抹茶粉", name: "蝸牛殼苔抹茶", comment: "苦中帶甜，要像牠一樣慢慢喝。" } },
  { id: "wisp", name: "鬼火精", sprite: "wisp", hue: 0, boss: false, dish: { part: "火苗", method: "拿來烤布蕾的表面", name: "鬼火烤布蕾", comment: "焦糖脆脆的，火還在上面跳舞。" }, gift: { part: "一朵小火苗", method: "拿來烤棉花糖", name: "鬼火烤棉花糖", comment: "火苗分出去又長回來，外焦內軟。" } },
  { id: "golem-pebble", name: "小石魔像", sprite: "golem", hue: 0, boss: false, dish: { part: "石頭身體", method: "燒熱當鍋子用", name: "魔像石燒鍋", comment: "鍋子吃不下，但湯一直滾到最後。" }, gift: { part: "一顆小石子", method: "燒熱後丟進湯裡", name: "魔像石頭湯", comment: "石頭只負責燒熱，湯鮮得不得了。" } },
  { id: "jellyfish-deep", name: "地底水母", sprite: "jellyfish", hue: 0, boss: false, dish: { part: "傘狀身體", method: "切絲淋醋涼拌", name: "涼拌水母絲", comment: "脆脆的，在嘴裡會微微發光。" }, gift: { part: "觸手上的露珠", method: "加糖做成果凍", name: "水母露珠凍", comment: "透明會發光，涼到牙齒打顫。" } },
  { id: "frog-swamp", name: "沼澤胖蛙", sprite: "frog", hue: 0, boss: false, dish: { part: "後腿", method: "麻油醬油米酒各一杯", name: "三杯田雞", comment: "九層塔一下，香到隔壁房都在問。" }, gift: { part: "一把沼澤水草", method: "汆燙後拌麻油", name: "麻油拌水草", comment: "清脆爽口，胖蛙呱了一聲說不客氣。" } },
  { id: "candle", name: "蠟燭精", sprite: "candle", hue: 0, boss: false, dish: { part: "燭火", method: "放在鍋底慢慢融起司", name: "蠟燭起司鍋", comment: "起司一直牽絲，蠟燭精說別吃牠。" }, gift: { part: "融下的蜂蠟", method: "包住起司慢慢熟成", name: "蜂蠟熟成起司", comment: "起司香濃，蠟燭精只矮了一點點。" } },
  { id: "mandrake", name: "尖叫曼德拉草", sprite: "mandrake", hue: 0, boss: false, dish: { part: "根", method: "塞住耳朵再下鍋燉", name: "曼德拉根菜燉", comment: "燉軟就不叫了，甜味很像紅蘿蔔。" }, gift: { part: "一片嫩葉", method: "大火快炒", name: "炒曼德拉嫩葉", comment: "葉子不會叫，甜得像菠菜。" } },
  { id: "eyeball", name: "浮游眼球", sprite: "eyeball", hue: 0, boss: false, dish: { part: "眼球", method: "包進糯米煮成湯圓", name: "眼球湯圓", comment: "甜甜的，總覺得它一直在看你。" }, gift: { part: "眼皮上的露水", method: "熬成糖漿淋刨冰", name: "眼露糖漿刨冰", comment: "甜甜涼涼，牠一直盯著你吃完。" } },
  { id: "crab-iron", name: "鐵殼螃蟹", sprite: "crab", hue: 0, boss: false, dish: { part: "蟹肉", method: "敲開鐵殼清蒸", name: "清蒸鐵殼蟹", comment: "殼比鍋子硬，肉比想像中甜。" }, gift: { part: "脫下的舊殼", method: "熬湯取鮮味", name: "蟹殼鮮味湯", comment: "舊殼換新殼，湯底鮮得發甜。" } },
  { id: "dice", name: "骰子怪", sprite: "dice", hue: 0, boss: false, dish: { part: "方塊身體", method: "切丁淋醬", name: "骰子豆腐", comment: "每塊點數不同，吃到六點有好運。" }, gift: { part: "掉下來的一個點", method: "裹糖霜做成糖豆", name: "骰子點點糖", comment: "牠從六點變五點，但心情很好。" } },
  { id: "pumpkin", name: "南瓜頭", sprite: "pumpkin", hue: 0, boss: false, dish: { part: "南瓜肉", method: "挖出來打成濃湯", name: "南瓜濃湯", comment: "濃得化不開，南瓜頭變得好輕。" }, gift: { part: "一把南瓜籽", method: "加鹽炒香", name: "鹽炒南瓜籽", comment: "一顆接一顆，南瓜頭說挖了反而輕鬆。" } },
  { id: "cactus", name: "刺刺仙人掌", sprite: "cactus", hue: 0, boss: false, dish: { part: "果肉", method: "拔刺後打成冰沙", name: "仙人掌冰沙", comment: "清涼解渴，刺記得拔乾淨。" }, gift: { part: "一朵仙人掌花", method: "泡成冰花茶", name: "仙人掌花茶", comment: "花香清甜，刺一根都沒碰到。" } },
  { id: "kraken", name: "深海大王烏賊", sprite: "kraken", hue: 0, boss: true, dish: { part: "觸手", method: "整隻串起來刷醬烤", name: "大王烤魷魚", comment: "一隻觸手就夠全隊吃一輪。" }, gift: { part: "一大桶墨汁", method: "拌進義大利麵", name: "大王墨魚麵", comment: "整盤黑亮亮，吃完全隊牙齒都黑了。" } },
  { id: "phoenix", name: "不死火鳥", sprite: "phoenix", hue: 0, boss: true, dish: { part: "整隻", method: "用牠身上的火慢慢烤", name: "不死鳥烤全雞", comment: "烤完又活過來，所以可以再烤一次。" }, gift: { part: "一顆溫熱的蛋", method: "用牠的餘溫慢慢烘", name: "火鳥溫泉蛋", comment: "蛋黃像小太陽，牠說還會再下。" } },
];

const BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));
export function monsterById(id: string): CatalogMonster | undefined {
  return BY_ID.get(id);
}
/** For code past parseBank, which guarantees the id is in the catalog. */
export function catalogMonster(id: string): CatalogMonster {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`not a catalog monster: ${id}`);
  return m;
}

/** Whether each game draws its own boss: `randomBoss` when the bank says, else whatever `randomMonsters` says. */
export const drawsBoss = (bank: { randomMonsters?: boolean; randomBoss?: boolean }) => bank.randomBoss ?? !!bank.randomMonsters;

/** This game's monsters. A bank with `randomMonsters` draws fresh room monsters each game so every catalog
 * monster comes up about as often: rooms deal from a shuffled deck of room monsters (no repeat until
 * the deck runs out). The boss is any boss when drawsBoss. Otherwise, the bank's own picks. */
export function gameMonsters(
  bank: { rooms: { monster: string }[]; boss: { monster: string }; randomMonsters?: boolean; randomBoss?: boolean },
  rng: () => number,
): { rooms: string[]; boss: string } {
  const ids = (boss: boolean) => MONSTERS.filter((m) => m.boss === boss).map((m) => m.id);
  const deck: string[] = [];
  const rooms = !bank.randomMonsters
    ? bank.rooms.map((r) => r.monster)
    : bank.rooms.map(() => {
        if (deck.length === 0) {
          deck.push(...ids(false));
          for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
          }
        }
        return deck.pop()!;
      });
  if (!drawsBoss(bank)) return { rooms, boss: bank.boss.monster };
  const bosses = ids(true);
  return { rooms, boss: bosses[Math.floor(rng() * bosses.length)] };
}

/** Repeat appearances (D4, D5): a recolor, a hat on the head and a title on the nameplate. */
export const ACCESSORIES = ["crown", "party-hat", "flower", "headband", "bow", "pirate-hat"] as const;
export type Accessory = (typeof ACCESSORIES)[number];
export const TITLE: Record<Accessory, string> = { crown: "戴王冠的", "party-hat": "慶生中的", flower: "戀愛中的", headband: "熱血的", bow: "打扮過的", "pirate-hat": "海盜" };
export const HUE_SHIFTS = [90, 180, 300, 0] as const;

export interface Variant {
  accessory: Accessory;
  hueShift: number;
  title: string;
}

/** FNV-1a 32-bit over UTF-16 code units, unsigned. */
export function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The look of a monster defeated `n` times so far this game. `seed` is fixed per game. The first
 * appearance (n = 0) and every boss are plain. The accessory changes every time; the recolor
 * cycles every 4. */
export function variantOf(seed: number, m: CatalogMonster, n: number): Variant | null {
  if (n <= 0 || m.boss) return null;
  const s = fnv1a(`${seed}:${m.id}`);
  const accessory = ACCESSORIES[(s + n - 1) % ACCESSORIES.length];
  return { accessory, hueShift: HUE_SHIFTS[((s >>> 8) + n - 1) % HUE_SHIFTS.length], title: TITLE[accessory] };
}
