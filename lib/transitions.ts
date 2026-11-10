// Big-screen transitions: the stone doors open before the first question, the alarm banner calls the boss the first
// time the boss room comes on screen, and the ⚔️ 最後衝刺 banner plays when the boss door opens (last-sprint.md).
// Live only: a screen that connects mid-game never replays any.

import type { StateMessage } from "./protocol";
import type { SpectatorView } from "./game-state";
import { describeTurn } from "./turn-info";

export type Transition = { kind: "open"; team: string } | { kind: "boss"; name: string } | { kind: "sprint"; names: string[] } | { kind: "cheat" } | { kind: "catch"; by: string; team: string };

/** `open`: this connection saw the lobby or the intro, so the first question is a start seen live.
 * `boss`: whether the boss room has been on screen; null until the first STATE after connecting. */
export interface TransitionSeen {
  open: boolean;
  boss: boolean | null;
  /** Whether this connection has seen `view.sprint`, the same rule as `boss`. */
  sprint: boolean | null;
}

/** A fresh connection: no transition is armed until a STATE or LOBBY says what came before. */
export const UNSEEN: TransitionSeen = { open: false, boss: null, sprint: null };
/** A LOBBY: the next game's doors, sprint and boss are all still ahead. */
export const IN_LOBBY: TransitionSeen = { open: true, boss: false, sprint: false };

/** ⚔️ 最後衝刺's live-only rule, shared by the screen's banner and the phone's card (last-sprint.md E3): it plays when
 * this connection saw no sprint and now does. `seen` is null until the first STATE after connecting, so a
 * (re)connect after the sprint never plays it. */
export function sprintSeen(seen: boolean | null, view: { sprint?: unknown }): { seen: boolean; play: boolean } {
  const now = !!view.sprint;
  return { seen: (seen ?? now) || now, play: seen === false && now };
}

/** What this connection last saw of 抓包與神諭 (docs/designs/anti-ai-cheating.md): the switch's on count, and whether a catch was open. */
export type CheatSeen = { on: number; open: boolean };

/** The switch-on banner and the catch banner, live only like the sprint's: null `seen` (the first STATE after connecting) plays nothing. */
export function antiCheatBanner(seen: CheatSeen | null, view: Pick<SpectatorView, "antiCheat" | "teams">): { seen: CheatSeen; play: Transition | null } {
  const ac = view.antiCheat;
  const now = { on: ac?.onCount ?? 0, open: !!ac?.openCatch };
  if (!seen) return { seen: now, play: null };
  const name = (id: string) => view.teams.find((t) => t.id === id)?.name ?? "";
  if (ac?.openCatch && !seen.open) return { seen: now, play: { kind: "catch", by: name(ac.openCatch.by), team: name(ac.openCatch.teamId) } };
  return { seen: now, play: ac?.on && now.on > seen.on ? { kind: "cheat" } : null };
}

export function nextTransition(seen: TransitionSeen, msg: StateMessage): { seen: TransitionSeen; play: Transition | null } {
  if (msg.phase !== "playing") return { seen: { open: false, boss: true, sprint: true }, play: null };
  if (msg.intro) return { seen: IN_LOBBY, play: null };
  // The doors open on 擲先攻 (lib/initiative.ts), before the order is known: they name no first team.
  if (msg.initiative) return seen.open ? { seen: { open: false, boss: false, sprint: false }, play: { kind: "open", team: "" } } : { seen, play: null };
  const turn = describeTurn(msg.view, msg.question, msg.phaseCard?.monster);
  // A reveal still shows the room monster that was just beaten: the boss is called once the room is the boss's.
  const bossOnScreen = turn.bossScene && !msg.reveal && !msg.eventReveal;
  // A screen (re)connecting mid-game counts the boss as seen once any team got that far, on screen now or not.
  const bossReached = msg.view.teams.some((t) => t.inBossPhase) || msg.view.bossHp < msg.view.bossMaxHp || msg.view.bossPhase > 1;
  const sprint = sprintSeen(seen.sprint, msg.view);
  if (seen.open) {
    // A boss already on the first question rides in on the doors: its alarm would land mid-answer on a later STATE.
    return { seen: { open: false, boss: bossOnScreen, sprint: sprint.seen }, play: { kind: "open", team: turn.team?.name ?? "" } };
  }
  // The door opening wins over the boss alarm due in the same STATE (sendToBoss): the alarm stays due for the next one.
  if (sprint.play) {
    const names = msg.view.sprint!.teamIds.flatMap((id) => msg.view.teams.find((t) => t.id === id)?.name ?? []);
    return { seen: { open: false, boss: seen.boss ?? bossReached, sprint: true }, play: { kind: "sprint", names } };
  }
  const play: Transition | null = seen.boss === false && bossOnScreen ? { kind: "boss", name: turn.monster.name } : null;
  return { seen: { open: false, boss: (seen.boss ?? bossReached) || bossOnScreen, sprint: sprint.seen }, play };
}
