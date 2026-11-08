// Big-screen transitions (TODOS「開場與首領房的轉場動畫」): the stone doors open before the first question,
// and the alarm banner calls the boss the first time the boss room comes on screen. Live only: a screen that
// connects mid-game never replays either.

import type { StateMessage } from "./protocol";
import { describeTurn } from "./turn-info";

export type Transition = { kind: "open"; team: string } | { kind: "boss"; name: string };

/** `open`: this connection saw the lobby or the intro, so the first question is a start seen live.
 * `boss`: whether the boss room has been on screen; null until the first STATE after connecting. */
export interface TransitionSeen {
  open: boolean;
  boss: boolean | null;
}

/** A fresh connection: neither transition is armed until a STATE or LOBBY says what came before. */
export const UNSEEN: TransitionSeen = { open: false, boss: null };
/** A LOBBY: the next game's doors and boss are both still ahead. */
export const IN_LOBBY: TransitionSeen = { open: true, boss: false };

export function nextTransition(seen: TransitionSeen, msg: StateMessage): { seen: TransitionSeen; play: Transition | null } {
  if (msg.phase !== "playing") return { seen: { open: false, boss: true }, play: null };
  if (msg.intro) return { seen: { open: true, boss: false }, play: null };
  const turn = describeTurn(msg.view, msg.question, msg.phaseCard?.monster);
  // A reveal still shows the room monster that was just beaten: the boss is called once the room is the boss's.
  const bossOnScreen = turn.bossScene && !msg.reveal;
  const play: Transition | null = seen.open
    ? { kind: "open", team: turn.team?.name ?? "" }
    : seen.boss === false && bossOnScreen
      ? { kind: "boss", name: turn.monster.name }
      : null;
  return { seen: { open: false, boss: (seen.boss ?? false) || bossOnScreen }, play };
}
