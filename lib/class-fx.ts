// The mage's, cleric's and thief's moment on the big screen (TODOS 「每個職業有自己的動畫和音效」; the warrior has its d20).
// Decided from STATE alone, like lib/boss-fx.ts, and played like lib/host-fx.ts. Pure, so it is unit-tested; the screen
// page draws what it says. Holds no bank.

import type { StateMessage } from "./protocol";

export type ClassFxKind = "mage" | "cleric" | "thief";
export type ClassFx = { kind: ClassFxKind; teamId: string; name: string };

/** How long the badge stays up. */
export const CLASS_FX_MS = 1200;

/** The class ability a team just used, or null (class dice): a mage's or cleric's skill die that just started rolling
 * (its kind, not the uses count: a small failure gives the use back), or the thief's 偷襲, which lowers its
 * `abilityUses`. The warrior is left out: its d20 is its moment. A screen's first STATE after connecting (`prev` null),
 * or a STATE across a phase change, plays nothing: live only. */
export function classFxFor(prev: StateMessage | null, msg: StateMessage): ClassFx | null {
  if (!prev || prev.phase !== "playing" || msg.phase !== "playing") return null;
  const roll = msg.pendingRoll;
  if ((roll?.kind === "mage" || roll?.kind === "cleric") && !(prev.pendingRoll?.kind === roll.kind && prev.pendingRoll.teamId === roll.teamId)) {
    const t = msg.view.teams.find((x) => x.id === roll.teamId);
    if (t) return { kind: roll.kind, teamId: t.id, name: t.name };
  }
  for (const t of msg.view.teams) {
    const was = prev.view.teams.find((p) => p.id === t.id);
    if (was && t.abilityUses < was.abilityUses && t.classId === "thief") return { kind: "thief", teamId: t.id, name: t.name };
  }
  return null;
}

/** An edge pulse (one take from the shared flash budget) or its static tint. */
export type ClassFxLook = ClassFx & { look: "flash" | "tint" };

export interface ClassFxDeps {
  /** This screen's own player is playing a clip: no sound over it; the look still shows. */
  clipPlaying: boolean;
  reducedMotion: boolean;
  /** A TransitionOverlay is up: its own blinks are not budgeted, so no pulse on top. */
  transitionUp: boolean;
  /** The boss's parry runs: it owns the moment, so the class shows its tint and no badge. */
  parrying: boolean;
  /** The shared flash budget (lib/flash-budget.ts). */
  takeFlash: () => boolean;
  play: (kind: ClassFxKind) => void;
  show: (fx: ClassFxLook) => void;
}

/** Plays one class moment. Never throws: a bad audio call must not stop the screen's message handling. */
export function playClassFx(fx: ClassFx, d: ClassFxDeps): ClassFxLook | null {
  try {
    if (!d.clipPlaying) d.play(fx.kind);
    const still = d.reducedMotion || d.transitionUp || d.parrying;
    const out: ClassFxLook = { ...fx, look: !still && d.takeFlash() ? "flash" : "tint" };
    d.show(out);
    return out;
  } catch (err) {
    console.error("[fx] class-effect", err);
    return null;
  }
}

/** The badge's words, after the team's name. */
export const CLASS_FX_TEXT: Record<ClassFxKind, string> = { mage: "🔮 洞悉！", cleric: "✝️ 祈禱！", thief: "🗝️ 偷襲！" };
