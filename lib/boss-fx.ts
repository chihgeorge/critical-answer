// The boss fight's automatic effects on the big screen (docs/designs/immersion.md PR1 ②–④), decided from STATE alone.
// Pure, so it is unit-tested; the screen page plays what it says. Holds no bank.

import type { StateMessage } from "./protocol";
import { ANSWER_WARN_SECONDS } from "./answer-clock";
import { describeTurn } from "./turn-info";

/** ② The parry runs this long: 0–0.6 s charge, 0.6–0.9 s parry, 0.9–1.4 s counter. Inside the boss's 2 s red cell. */
export const PARRY_MS = { parry: 600, counter: 900, end: 1400 } as const;

const bossScene = (m: StateMessage) => describeTurn(m.view, m.question, m.phaseCard?.monster).bossScene;
const cueSeq = (m: StateMessage) => m.cueSeq ?? m.eventId;

/** ② The parry this STATE starts, keyed by team and question, or null. A boss wrong answer shows up first as a wrong lock
 * (`pendingWrong`) or as a `retry` / `flee` cue (the host judging a typed answer wrong): whichever comes first plays it, and
 * the other, carrying the same key, does not play it again. A `flee` that rules on an open cheating catch is no miss.
 * A screen's first STATE after connecting (`prev` null) plays nothing: live only. */
export function parryFor(prev: StateMessage | null, msg: StateMessage, lastKey: string | null): string | null {
  if (!prev || prev.phase !== "playing" || msg.phase !== "playing") return null;
  let parried: string | null = null;
  const w = msg.view.pendingWrong;
  const was = prev.view.pendingWrong;
  if (w && (w.teamId !== was?.teamId || w.questionId !== was?.questionId) && bossScene(msg)) parried = `${w.teamId}:${w.questionId}`;
  else if (cueSeq(msg) > cueSeq(prev) && (msg.cue === "retry" || (msg.cue === "flee" && !prev.view.antiCheat?.openCatch)) && bossScene(prev)) {
    const t = describeTurn(prev.view, prev.question, prev.phaseCard?.monster);
    parried = `${t.team?.id ?? ""}:${t.questionId ?? ""}`;
  }
  return parried !== null && parried !== lastKey ? parried : null;
}

/** ④ Rage: the current phase's bar is down to a third. With bossMaxHp 1 or 2 it never fires (1 > 2/3): on purpose,
 * it is the owner's formula. A phase card (or one due) is the new phase's moment, so it wins. */
export function rageNow(msg: StateMessage): boolean {
  if (msg.phase !== "playing" || msg.phaseCard || msg.phaseCardDue) return false;
  const { bossHp, bossMaxHp } = msg.view;
  return bossHp > 0 && bossHp <= bossMaxHp / 3;
}

/** ③ The boss clock is running: a boss scene with an answer count on screen (no count, no heartbeat). */
export function bossClock(msg: StateMessage | null): boolean {
  return msg?.phase === "playing" && typeof msg.answerClock?.left === "number" && !msg.reveal && !msg.phaseCard && bossScene(msg);
}

/** ③ The heartbeat's beats, in seconds from now, with `leftS` seconds on the clock: from one a second at
 * ANSWER_WARN_SECONDS left to 2.5 a second at 0, never after 0. */
export function heartbeatTimes(leftS: number): number[] {
  const out: number[] = [];
  // t: seconds left on the clock at this beat; the gap to the next beat shrinks from 1.0 s to 0.4 s as t runs out.
  for (let t = Math.min(leftS, ANSWER_WARN_SECONDS); t > 0.05; t -= 0.4 + (0.6 * t) / ANSWER_WARN_SECONDS) out.push(leftS - t);
  return out;
}
