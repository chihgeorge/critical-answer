// A team's colour (#320): an index into TEAM_LOOKS (lib/pixel-art.ts), picked in the lobby. Pure, so the room
// (server) and every page can use it without pulling in the canvas code.

/** One colour per team: MAX_TEAMS, and TEAM_LOOKS has exactly this many (team-look.test.ts checks both). */
export const LOOK_COUNT = 8;

export function isLook(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < LOOK_COUNT;
}

/** The lowest colour no team in `teams` holds. The room caps lobby + waiting teams at MAX_TEAMS, so a joining team
 * always finds one; the 0 fallback is never reached. */
export function firstFreeLook(teams: readonly { look?: number }[]): number {
  const taken = new Set(teams.map((t) => t.look));
  for (let i = 0; i < LOOK_COUNT; i++) if (!taken.has(i)) return i;
  return 0;
}

/** The colour a page draws `team` in; `index` (its place in the list) for a team saved before colours were picked. */
export function lookOf(team: { look?: number } | undefined, index: number): number {
  return team?.look ?? index;
}
