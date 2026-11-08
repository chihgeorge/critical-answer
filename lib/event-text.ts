// The words of event rooms (docs/designs/event-rooms.md), shared by the big screen, the phones, the host page and
// the scripted narrator. Pure data, no question or answer, so client components may import it.

import type { Boon, EventOutcome, EventResult, EventScene } from "./game-state";

export const EVENT_SCENE_TEXT: Record<EventScene, { name: string; line: string; button: string; story: string }> = {
  chest: { name: "寶箱", line: "房間裡沒有怪物，只有一個上了鎖的寶箱……", button: "🗝️ 打開寶箱", story: "房間正中央擺著一個上了鎖的寶箱" },
  spring: { name: "回復泉水", line: "房間正中央有一口發光的泉水……", button: "🥤 喝一口", story: "房間正中央冒著一口發光的泉水" },
  idol: { name: "骷髏雕像", line: "角落立著一尊古老的骷髏雕像，眼睛好像在發光……", button: "✋ 摸一下", story: "角落立著一尊眼睛發光的骷髏雕像" },
  fairy: { name: "小精靈", line: "一隻小精靈在房間裡飛來飛去……", button: "💬 跟精靈說話", story: "一隻小精靈在房間裡飛來飛去" },
  fortune: { name: "占卜師", line: "一位占卜師坐在水晶球後面，對你們招手……", button: "🔮 請她算一卦", story: "一位占卜師坐在水晶球後面招手" },
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
