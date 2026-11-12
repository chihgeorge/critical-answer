// The big screen's room ambience and fog reveal (docs/designs/immersion.md PR3): which ambience plays, and when a
// team opens a room nobody has seen yet. Pure: the screen page plays the sound and draws the clouds.

import { DEFAULT_SCREEN_AUDIO, parseScreenAudio, type ScreenAudio, type ServerMessage, type StateMessage } from "./protocol";
import { describeTurn } from "./turn-info";

/** One per room, in rotation by room index: atmosphere, not a game signal. */
export const AMBIENCES = ["drips", "wind", "campfire"] as const;
export type Ambience = (typeof AMBIENCES)[number];

/** The fog reveal waits this long after the STATE that opened the room, so the correct-answer cue plays first. */
export const FOG_REVEAL_DELAY_MS = 600;
/** How long the blowing clouds and the lit (or static) room stay, from the door sound. */
export const FOG_REVEAL_MS = 1200;

/** A fog reveal on the map strip: clouds sit on the new room ("covered"), then blow off as the door creaks ("blow"),
 * the room lit once (`lit`, one take from the flash budget) or brightened without motion. */
export type FogReveal = { room: number; step: "covered" | "blow"; lit: boolean };

/** The host's sound switches as a LOBBY or STATE carries them: absent (or damaged) means all on. */
export function screenAudioOf(msg: Extract<ServerMessage, { type: "LOBBY" | "STATE" }> | null): ScreenAudio {
  return parseScreenAudio(msg?.screenAudio) ?? DEFAULT_SCREEN_AUDIO;
}

/** The ambience for the room on stage, worked out like the screen's backdrop (a dish reveal keeps its room), or null:
 * the lobby, a finished game, the intro, 擲先攻, a boss scene (the boss layer owns it), or the host's 🌧 off. */
export function ambienceFor(state: StateMessage | null): Ambience | null {
  if (!state || state.phase !== "playing" || state.intro || state.initiative || !screenAudioOf(state).ambience) return null;
  const turn = describeTurn(state.view, state.question, state.phaseCard?.monster);
  const dish = state.reveal?.dish;
  const bossScene = dish ? dish.room === null : turn.bossScene;
  const room = dish ? dish.room : turn.room;
  return bossScene || room === null ? null : AMBIENCES[room % AMBIENCES.length];
}

const frontier = (s: StateMessage) => Math.max(0, ...s.view.teams.map((t) => t.roomIndex));

/** The room to reveal when the fog edge moved between two live STATEs of a game in play, else null: the first STATE
 * after connecting, a phase change, a new game (the frontier dropped) and a boss entry (it keeps its roomIndex) reveal
 * nothing. A jump of two rooms reveals only the new frontier. */
export function revealFor(prev: StateMessage | null, next: StateMessage): number | null {
  if (!prev || prev.phase !== "playing" || next.phase !== "playing") return null;
  const to = frontier(next);
  return to > frontier(prev) ? to : null;
}
