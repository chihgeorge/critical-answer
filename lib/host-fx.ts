// The host's pads on the big screen (docs/designs/immersion.md PR2): what a SCREEN_EFFECT shows and plays. Pure, so it
// is unit-tested; the screen page draws what it says. Holds no bank.

import type { HostEffect, ScreenSound } from "./protocol";

/** ⚡ an edge pulse (one flash from the shared budget) or its static tint; 👹 a shake or its static tint. */
export type HostFxLook = { effect: HostEffect; look: "flash" | "tint" | "shake" };

export interface HostFxDeps {
  /** This screen's own player is playing a clip: the press is dropped, no sound and nothing shown. */
  clipPlaying: boolean;
  reducedMotion: boolean;
  /** A TransitionOverlay (doors, boss entrance and its alarm, last sprint) is up: its own blinks are not budgeted. */
  transitionUp: boolean;
  /** Another shake runs (the parry counter, the boss entrance band): growl shows its tint instead of stacking. */
  shaking: boolean;
  /** The shared flash budget (lib/flash-budget.ts). */
  takeFlash: () => boolean;
  playCue: (effect: HostEffect) => void;
  show: (fx: HostFxLook) => void;
}

/** Plays one SCREEN_EFFECT. Never throws: a bad audio call must not stop the screen's message handling. */
export function playHostEffect(effect: HostEffect, d: HostFxDeps): HostFxLook | null {
  if (d.clipPlaying) return null;
  try {
    d.playCue(effect);
    const still = d.reducedMotion || d.transitionUp;
    const look = effect === "thunder" ? (!still && d.takeFlash() ? "flash" : "tint") : still || d.shaking ? "tint" : "shake";
    const fx: HostFxLook = { effect, look };
    d.show(fx);
    return fx;
  } catch (err) {
    console.error("[fx] host-effect", err);
    return null;
  }
}

const PAD_NAME: Record<HostEffect, string> = { thunder: "⚡ 雷聲", growl: "👹 低吼" };
const PAD_ICON: Record<HostEffect, string> = { thunder: "⚡", growl: "👹" };

/** A host pad's label and whether it can be pressed (immersion.md PR2). `sound` is STATE's `screenSound` (undefined in
 * the lobby or from an older server); `sent` is the pad pressed on this device within HOST_FX_COOLDOWN_MS. The reason
 * a pad is off is in its label, not in colour only. */
export function hostPad(effect: HostEffect, o: { clipPlaying: boolean; sound?: ScreenSound; sent: HostEffect | null; online: boolean }): { label: string; aria: string; disabled: boolean } {
  const name = PAD_NAME[effect];
  if (o.clipPlaying) return { label: `${PAD_ICON[effect]} 影片中`, aria: `${name}：影片播放中`, disabled: true };
  if (o.sound === "none") return { label: "沒大螢幕", aria: `${name}：沒有大螢幕連著`, disabled: true };
  if (o.sent) return { label: o.sent === effect ? "已送出" : name, aria: o.sent === effect ? `${name}已送出` : name, disabled: true };
  const muted = o.sound === "muted";
  return { label: muted ? `${name} 🔇` : name, aria: muted ? `${name}（大螢幕沒聲音，只有畫面）` : name, disabled: !o.online };
}
