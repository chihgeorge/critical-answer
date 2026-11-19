// 料理骰's dish names and comments (docs/designs/class-dice-rework.md): a 1 burns the dish, a chef's 2–6 botches it, any
// other 2–19 serves it as the catalog has it, a 20 makes it legendary. Pure and bank-free, so a client may import it.

import { dishTier } from "./game-state";

/** What the dish die made of the dish: its tier's look on stage (`burnt`: dish-burnt, `legend`: <dish>-legend). */
export type DishLook = "burnt" | "botched" | "plain" | "legend";

/** 〇〇 is the catalog's dish name (owner-approved lists). */
export const BURNT_NAMES = ["碳化的〇〇", "冒黑煙的不明物體", "曾經是〇〇的東西", "鍋底刮下來的〇〇", "焦黑殘渣", "黑暗料理・〇〇"] as const;
export const BOTCHED_NAMES = ["半生不熟的〇〇", "有點鹹的〇〇", "忘了調味的〇〇", "煮過頭的〇〇", "賣相不佳的〇〇", "趕時間做的〇〇"] as const;
export const LEGEND_NAMES = ["傳說級〇〇", "主廚私房〇〇", "黃金〇〇", "會發光的〇〇", "皇家御用〇〇", "一生一次的〇〇"] as const;

/** The shared comments for the tiers that change the dish; 7–19 keeps the catalog's own comment. Waiting for the owner's OK. */
export const BURNT_COMMENTS = ["這盤……先拍照留念就好。", "聞起來像營火，吃起來也像。", "煙霧警報替大家打了分數。"] as const;
export const BOTCHED_COMMENTS = ["能吃，但大家都安靜地吃完了。", "味道有點迷路，還好肚子不挑。", "火候再抓準一點就完美了。"] as const;
export const LEGEND_COMMENTS = ["一入口，整個地城都安靜了。", "好吃到怪物都想排隊。", "這道菜會被吟遊詩人寫進歌裡。"] as const;

/** The dish die `value`'s look for a chef or anyone else: only a chef's 2–6 is botched (dishTier). */
export function dishLook(value: number, chef = false): DishLook {
  return (["burnt", "botched", "plain", "legend"] as const)[dishTier(value, chef)];
}

/** The dish as the dish die `value` serves it: a name and comment drawn from its tier's lists with `rng`, or the dish as it is on 7–19. */
export function rolledDish(dish: { name: string; comment: string }, value: number, rng: () => number, chef = false): { name: string; comment: string; look: DishLook } {
  const look = dishLook(value, chef);
  if (look === "plain") return { ...dish, look };
  const pick = <T>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const names = look === "burnt" ? BURNT_NAMES : look === "botched" ? BOTCHED_NAMES : LEGEND_NAMES;
  const comments = look === "burnt" ? BURNT_COMMENTS : look === "botched" ? BOTCHED_COMMENTS : LEGEND_COMMENTS;
  return { name: pick(names).replace("〇〇", dish.name), comment: pick(comments), look };
}
