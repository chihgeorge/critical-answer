/** The phone's timing button (docs/designs/timing-tap.md 畫面): one state per row of the design's table, from STATE
 * and this phone's own clock and ack. Pure and client-safe. */
import { formatTapError } from "./tap-clock";

export type TapTone = "grey" | "red" | "gold" | "ok";
export interface TapButtonState {
  /** Not drawn at all: the team is offline or outside the boss room; the phone keeps its buzzer-phase screen. */
  hidden?: true;
  tone: TapTone;
  label: string;
  enabled: boolean;
  /** The `--warn` line under the button after a refusal. */
  hint?: string;
}

export interface TapButtonInput {
  inBoss: boolean;
  online: boolean;
  stunned: boolean;
  /** view.buzz.open, and the round STATE says (view.buzz.tapRound ?? 0). */
  open: boolean;
  round: number;
  /** The host's last ▶ ⏸ for this question: paused, or none yet. */
  paused: boolean;
  tapLive: boolean;
  /** This phone has a fresh clock offset (lib/server-clock.ts bestOffset). */
  synced: boolean;
  /** A TAP_OK (or tap_taken) for this round of this question. */
  acked: boolean;
  /** Pressed and waiting for the room's answer. */
  sending: boolean;
  /** The last refusal worth a line: not_playing or tap_late. */
  refused?: "not_playing" | "tap_late";
  /** The reveal's timing table, once the round closed with a hit. */
  reveal?: { rows: { teamId: string; errorMs: number; bonus: number }[] };
  teamId: string;
}

const HINT = { not_playing: "沒算到：音樂剛停，等音樂再按", tap_late: "沒算到：網路太慢，再按一次" } as const;

export function tapButtonState(i: TapButtonInput): TapButtonState {
  if (i.reveal) {
    const k = i.reveal.rows.findIndex((r) => r.teamId === i.teamId);
    if (k < 0) return { tone: "grey", label: "沒按", enabled: false };
    const row = i.reveal.rows[k];
    if (k === 0) return { tone: "ok", label: `命中！${formatTapError(row.errorMs)}`, enabled: false };
    return { tone: "grey", label: `${formatTapError(row.errorMs)}${row.bonus ? `・+${row.bonus}` : ""}（第 ${k + 1} 名）`, enabled: false };
  }
  if (!i.online || !i.inBoss) return { hidden: true, tone: "grey", label: "", enabled: false };
  if (i.stunned) return { tone: "grey", label: "被暈眩了，這題坐掉", enabled: false };
  if (i.acked) return { tone: "gold", label: "已按 ✓ 等結果", enabled: false };
  if (i.sending) return { tone: "gold", label: "送出中…", enabled: false };
  const hint = i.refused ? { hint: HINT[i.refused] } : {};
  if (!i.open) return { tone: "grey", label: "等音樂開始…", enabled: false, ...hint };
  if (i.paused) return { tone: "grey", label: "主持人暫停了", enabled: false, ...hint };
  if (!i.tapLive) return { tone: "grey", label: "大螢幕卡住了，等一下", enabled: false, ...hint };
  if (!i.synced) return { tone: "grey", label: "連線中…", enabled: false, ...hint };
  return { tone: "red", label: "按！", enabled: true, ...hint };
}
