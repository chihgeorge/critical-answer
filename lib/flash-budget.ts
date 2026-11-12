// Home of the big screen's fx constants (the tints below). The big screen's shared flash budget (docs/designs/immersion.md, 閃光安全): every new effect asks before it flashes,
// so the whole screen never flashes more than FLASH_MAX times in any FLASH_WINDOW_MS. One flash is one pulse, lit then
// dark (a heartbeat glow, the parry's red edge, the boss entrance lighting up). A refused take shows a static tint only.
// Legacy CSS is not counted: the px-alarm-text blinks (at most 3 per 2.4 s) and the torch px-tf* flicks (sprite frames);
// while a TransitionOverlay shows, the heartbeat holds its static tint, so the two never stack.

export const FLASH_WINDOW_MS = 1000;
export const FLASH_MAX = 3;

/** The static tints a refused take (or reduced motion) shows instead of a flash. */
export const HEART_TINT = "#b02a3a26"; // #b02a3a at 15%
export const PARRY_TINT = "#ff6b6b33"; // --danger at 20%
/** The host's pads (immersion.md PR2): ⚡'s edge pulse and its tint, 👹's tint (--k, not red: red is the boss's). */
export const THUNDER_PULSE = "#ffffff80"; // white at 50%
export const THUNDER_TINT = "#ffffff33"; // white at 20%
export const GROWL_TINT = "#2a153359"; // --k at 35%
/** The class moments (lib/class-fx.ts): each class's colour (the badge border), edge pulse (40%) and tint (20%). No red: red is the boss's. */
export const CLASS_COLOR = { mage: "#c9b3ff", cleric: "#ffe08a", thief: "#8fe3c8" } as const;
export const CLASS_PULSE = { mage: `${CLASS_COLOR.mage}66`, cleric: `${CLASS_COLOR.cleric}66`, thief: `${CLASS_COLOR.thief}66` } as const;
export const CLASS_TINT = { mage: `${CLASS_COLOR.mage}33`, cleric: `${CLASS_COLOR.cleric}33`, thief: `${CLASS_COLOR.thief}33` } as const;

export function createFlashBudget(now: () => number = () => Date.now()) {
  const taken: number[] = [];
  return {
    /** May this effect flash now? Counts it if so. */
    take(): boolean {
      const t = now();
      while (taken.length && t - taken[0] >= FLASH_WINDOW_MS) taken.shift();
      if (taken.length >= FLASH_MAX) return false;
      taken.push(t);
      return true;
    },
  };
}

export type FlashBudget = ReturnType<typeof createFlashBudget>;
