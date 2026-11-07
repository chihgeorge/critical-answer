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
}

export const MONSTERS: readonly CatalogMonster[] = [
  { id: "slime-soft", name: "軟趴趴史萊姆", sprite: "slime", hue: 0, boss: false, dish: { part: "外膜", method: "曬乾後涼拌", name: "史萊姆寒天涼拌", comment: "口感像寒天，帶點青草香。" } },
  { id: "ghost-shy", name: "害羞幽靈", sprite: "ghost", hue: 0, boss: false, dish: { part: "霧狀身體", method: "冰鎮後刨成細雪", name: "幽靈霧冰沙", comment: "入口就化，害羞得像沒吃過。" } },
  { id: "ghost-cry", name: "愛哭幽靈", sprite: "ghost-cry", hue: 0, boss: false, dish: { part: "眼淚", method: "熬煮收乾成鹽", name: "淚鹽烤飯糰", comment: "鹹得剛好，吃完有點想哭。" } },
  { id: "dragon", name: "深淵小黑龍", sprite: "dragon", hue: 0, boss: true, dish: { part: "尾巴肉", method: "用牠自己的龍息烤", name: "龍息烤龍尾", comment: "外皮焦香，肉汁多到滴下來。" } },
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
