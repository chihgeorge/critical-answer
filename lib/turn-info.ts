// Derives what every surface shows about the current turn from the public
// SpectatorView, so /screen and the /play mini broadcast never disagree.

import type { SpectatorView } from "./game-state";
import type { SceneTheme, SpriteKind } from "./pixel-art";

export type Monster = { kind: SpriteKind; name: string; scale: number; float?: boolean };

// Only two room monsters until the question bank (PR-B) brings one per room.
export const MONSTERS: Monster[] = [
  { kind: "slime", name: "軟趴趴史萊姆", scale: 6 },
  { kind: "ghost", name: "害羞幽靈", scale: 5, float: true },
];
export const BOSS_MONSTER: Monster = { kind: "dragon", name: "深淵小黑龍", scale: 4 };
export const BOSS_THRESHOLD = 15;

const ROOM_THEMES: SceneTheme[] = ["stone", "moss", "stone", "moss", "stone"];

export function describeTurn(view: SpectatorView) {
  const teamIndex = view.teams.findIndex((t) => t.id === view.currentTurnTeamId);
  const team = view.teams[teamIndex];
  const inBoss = team?.inBossPhase ?? false;
  const room = team?.roomIndex ?? 0;
  return {
    team,
    teamIndex,
    inBoss,
    room,
    monster: inBoss ? BOSS_MONSTER : MONSTERS[room % MONSTERS.length],
    theme: inBoss ? ("crimson" as const) : ROOM_THEMES[room % ROOM_THEMES.length],
    questionId: inBoss ? view.bossCurrentQuestionId : team?.currentQuestionId,
    bossHits: view.bossMaxHp - view.bossHp,
  };
}
