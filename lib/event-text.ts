// The words of ❓ 神秘房 events (docs/designs/event-rooms.md, branch-fork.md), shared by the big screen, the phones, the
// host page and the narrator. Pure data, no question or answer, so client components may import it.

import type { Boon, EventOutcome, EventResult, EventScene, ForkDoor, ForkSide } from "./game-state";

/** 岔路's doors are unmarked (branch-fork.md): a side until one opens, then what was behind that one only. */
export const FORK_SIDE_LABEL: Record<ForkSide, string> = { left: "左門", right: "右門" };
export const FORK_DOOR_LABEL: Record<ForkDoor, string> = { monster: "⚔️ 怪物房", mystery: "❓ 神秘房" };

export const EVENT_SCENE_TEXT: Record<EventScene, { name: string }> = {
  chest: { name: "寶箱" },
  spring: { name: "回復泉水" },
  idol: { name: "骷髏雕像" },
  fairy: { name: "小精靈" },
  fortune: { name: "占卜師" },
};

export const EVENT_OUTCOME_TITLE: Record<EventOutcome, string> = {
  feast: "美味料理！",
  rotten: "黑暗料理……",
  spring: "泉水好甜！",
  curse: "被詛咒了！",
  blessing: "精靈的祝福！",
  great: "大吉！",
  good: "中吉！",
  bad: "凶……",
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
