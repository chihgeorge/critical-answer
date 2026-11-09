// 擲先攻 (TODOS.md): after the stone doors open, every team rolls a d20 from its phone; the turn order is highest
// first, and teams tied roll again (the room rolls for them). Shared by the room, /screen, /play and /host, so it is
// pure and imports nothing that holds the bank.

import { rankTeams, type TieRoll } from "./podium";

/** A team that has not rolled this long after the rolling starts is rolled for, offline or not. */
export const INITIATIVE_MS = 15000;
/** How long each tie's reroll, and then the order, hold on the big screen before the first question. */
export const INITIATIVE_TIE_MS = 2500;
export const INITIATIVE_ORDER_MS = 4000;
/** The big screen's view: `left` is how long the room still waits for rolls (or holds the order), when the STATE was sent. */
export type InitiativeView = Initiative & { left: number; /** Manual pacing: no countdown, the rolls wait for the host. */ untimed?: true };

export interface Initiative {
  /** Each team's d20, by team id, as it comes in. */
  rolls: Record<string, number>;
  /** Set once every team has a roll: the turn order, best first. */
  order?: string[];
  /** The tie rerolls behind `order`, in the order they were rolled. */
  tieRolls?: TieRoll[];
}

/** The turn order from `rolls` (one per id in `teamIds`, in lobby order): highest first, ties rerolled with `roll`. */
export function initiativeOrder(teamIds: string[], rolls: Record<string, number>, roll: () => number): { order: string[]; tieRolls: TieRoll[] } {
  const { ranking, tieRolls } = rankTeams(teamIds.map((id) => ({ id, reward: rolls[id] })), roll, teamIds.length);
  return { order: ranking, tieRolls };
}

