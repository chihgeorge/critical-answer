// 每題作答倒數 (docs/designs/answer-countdown.md): the room holds the deadline, clients only count down from `left`.
// Pure, so /screen, /play and /host can import it; it holds no bank.

/** The lobby's choices, in seconds; 0 is 關. */
export const ANSWER_SECONDS = [0, 30, 45, 60, 90] as const;
export const DEFAULT_ANSWER_SECONDS = 60;
/** The last seconds turn red, and the big screen ticks once a second. */
export const ANSWER_WARN_SECONDS = 5;

export function isAnswerSeconds(v: unknown): v is number {
  return (ANSWER_SECONDS as readonly unknown[]).includes(v);
}

/** The running count: `key` is the answering turn (`teamId:questionId`), `endsAt` its wall-clock deadline. */
export interface AnswerClock {
  key: string;
  endsAt: number;
}

/** The clock after a state change. `want`: the answering turn's key, or null when nobody is answering (D3). No `want`
 * clears it, the same keeps the deadline, a new one starts a full `ms`. Clearing while an answer waits is what gives
 * 重答 a fresh count on the same question. */
export function nextAnswerClock(prev: AnswerClock | null, want: string | null, now: number, ms: number): AnswerClock | null {
  if (want === null || ms <= 0) return null;
  return prev?.key === want ? prev : { key: want, endsAt: now + ms };
}

/** Whole seconds shown for `ms` left. */
export const secondsLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/** D11: the host's stuck-team row waits this long with no lock (or no choice after a wrong lock). */
export const STUCK_MS = 15_000;

/** How long the host's stuck row waits, from STATE's `answerClock`: with the countdown on, until it reaches 0; with it
 * off, or no count running (a wrong lock waiting for its choice, or a clip that has not ended: it may never end, with no
 * keyed big screen or a clip error), STUCK_MS, so the host always gets a way past the turn. */
export function stuckDelayMs(clock: { left: number | null } | undefined): number {
  return clock?.left ?? STUCK_MS;
}
