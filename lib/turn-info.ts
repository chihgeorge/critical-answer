// Derives what every surface shows about the current turn from the public
// SpectatorView, so /screen and the /play mini broadcast never disagree.

import { DEFAULT_GAME_CONFIG, type SpectatorView } from "./game-state";
import type { PublicQuestion } from "./protocol";
import type { SceneTheme } from "./pixel-art";
import type { SpriteKind } from "./sprite-kind";

export type Monster = { kind: SpriteKind; name: string; scale: number; hue: number; float?: boolean };

/** Sprite size (an integer multiple of its native pixels) and whether it hovers. */
const LOOK: Record<string, { scale: number; float?: boolean }> = {
  slime: { scale: 6 },
  "slime-lost": { scale: 6 },
  "slime-king": { scale: 5 },
  ghost: { scale: 5, float: true },
  "ghost-cry": { scale: 5, float: true },
  dragon: { scale: 4 },
};
export const FALLBACK_MONSTER: Monster = { kind: "slime", name: "…", scale: 6, hue: 0 };
export const BOSS_THRESHOLD = DEFAULT_GAME_CONFIG.bossThreshold;

const ROOM_THEMES: SceneTheme[] = ["stone", "moss", "stone", "moss", "stone"];

const ORDINALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
/** 2 -> 二, for 第二階段. */
export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? String(n);
}

/** Each boss phase turns the boss's colour by this much (boss-phases.md D9, chosen from the mockup). */
export const PHASE_HUE_STEP = 90;

/** `bossMonster`: the boss to draw while no question is out (the phase card). */
export function describeTurn(view: SpectatorView, question: PublicQuestion | null, bossMonster?: PublicQuestion["monster"]) {
  const teamIndex = view.teams.findIndex((t) => t.id === view.currentTurnTeamId);
  const team = view.teams[teamIndex];
  const inBoss = team?.inBossPhase ?? false;
  const room = team?.roomIndex ?? 0;
  const m = question?.monster ?? bossMonster;
  const phaseHue = inBoss ? PHASE_HUE_STEP * (view.bossPhase - 1) : 0;
  const monster: Monster = m ? { ...LOOK[m.sprite], kind: m.sprite, name: m.name, hue: (m.hue + phaseHue) % 360 } : FALLBACK_MONSTER;
  return {
    team,
    teamIndex,
    inBoss,
    room,
    monster,
    /** The monster's sprite scale for the phone-size turn card. */
    miniScale: Math.max(1, Math.floor(monster.scale / 3)),
    theme: inBoss ? ("crimson" as const) : ROOM_THEMES[room % ROOM_THEMES.length],
    questionId: inBoss ? view.bossCurrentQuestionId : team?.currentQuestionId,
    bossHits: view.bossMaxHp - view.bossHp,
  };
}
