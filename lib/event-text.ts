// The words of ❓ 神秘房 events (docs/designs/event-rooms.md, branch-fork.md, fortune-teller.md), shared by the big
// screen, the phones, the host page and the narrator. Pure data, no question or answer, so client components may import it.

import type { Boon, EventOutcome, EventResult, EventScene, ForkDoor, ForkSide, FortuneCondition, FortuneEffect } from "./game-state";

/** 叉路's doors are unmarked (branch-fork.md): a side until one opens, then what was behind that one only. */
export const FORK_SIDE_LABEL: Record<ForkSide, string> = { left: "左門", right: "右門" };
export const FORK_DOOR_LABEL: Record<ForkDoor, string> = { monster: "⚔️ 怪物房", mystery: "❓ 神秘房" };

/** `spring` and `fairy` are only for saves from before the 3-scene deck; the statue may bless or curse (fortune-teller.md R7). */
export const EVENT_SCENE_TEXT: Record<EventScene, { name: string }> = {
  chest: { name: "寶箱" },
  spring: { name: "回復泉水" },
  idol: { name: "神秘雕像" },
  fairy: { name: "小精靈" },
  fortune: { name: "占卜師" },
};

export const EVENT_OUTCOME_TITLE: Record<EventOutcome, string> = {
  feast: "美味料理！",
  rotten: "黑暗料理……",
  spring: "泉水好甜！",
  curse: "被詛咒了！",
  blessing: "雕像的祝福！",
  great: "大吉！",
  good: "中吉！",
  bad: "凶……",
  fortune: "占卜師的預言",
};

export const BOON_TEXT: Record<Boon, string> = {
  curse: "💀 詛咒：下次答對減半",
  blessing: "✨ 祝福：下次答對多一半",
};

/** What the event did, in one line: 「+20 飽足感（廚師 +3）」, 「職業能力 +1 次」, 「下次答對獎勵減半」. */
export function eventEffectLine(r: Pick<EventResult, "satiety" | "chefBonus" | "abilityUse" | "boon">): string {
  if (r.abilityUse) return "職業能力 +1 次";
  if (r.boon === "curse") return "下次答對獎勵減半";
  if (r.boon === "blessing") return "下次答對多拿一半";
  // A rotten dish on an empty belly takes nothing.
  if (r.satiety === 0) return "飽足感已經見底，沒被扣";
  const chef = r.chefBonus ? `（廚師 +${r.chefBonus}）` : "";
  return `${r.satiety >= 0 ? "+" : "−"}${Math.abs(r.satiety)} 飽足感${chef}`;
}

/** 占卜師's conditions (fortune-teller.md): the crystal ball's line, and the unit of the effect card's count. */
export const FORTUNE_CONDITION_TEXT: Record<FortuneCondition, { text: string; unit: string }> = {
  natural20s: { text: "擲出最多次 20 的隊伍", unit: "次" },
  natural1s: { text: "擲出最多次 1 的隊伍", unit: "次" },
  flees: { text: "逃跑最多次的隊伍", unit: "次" },
  potions: { text: "喝最多瓶藥水的隊伍", unit: "瓶" },
  wrong: { text: "答錯最多題的隊伍", unit: "題" },
  correct: { text: "答對最多題的隊伍", unit: "題" },
  mystery: { text: "開最多次神秘房的隊伍", unit: "次" },
  dishes: { text: "吃過最多種料理的隊伍", unit: "種" },
  rotten: { text: "吃到最多次黑暗料理的隊伍", unit: "次" },
};

/** The six pizza slices, in slice order: one word on the big screen, the line on the drawing team's phone. `tone`
 * colours the phone's button (good, bad, or a transfer between teams). */
export const FORTUNE_EFFECT_TEXT: Record<FortuneEffect, { icon: string; name: string; line: string; tone: "good" | "bad" | "swap" }> = {
  blessing: { icon: "✨", name: "祝福", line: "下一題答對多拿獎勵", tone: "good" },
  curse: { icon: "💀", name: "詛咒", line: "下一題答對獎勵變少", tone: "bad" },
  potion: { icon: "🧪", name: "藥水", line: "送一瓶，已有就沒效", tone: "good" },
  tribute: { icon: "🙇", name: "進貢", line: "其他隊各給他們 10", tone: "swap" },
  relief: { icon: "🎁", name: "救濟", line: "給飽足感最少的隊伍", tone: "swap" },
  stun: { icon: "💫", name: "暈眩", line: "跳過下一回合，搶答時停一首", tone: "bad" },
};
