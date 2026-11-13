"use client";
// The phone's timing button (docs/designs/timing-tap.md 畫面): one TEAM_TAP per press, stamped with the room's clock,
// and the button's text from lib/tap-button-state.ts. Client-safe: no bank data.
import { useRef, useState } from "react";
import type { ClientMessage, ServerMessage, StateMessage } from "@/lib/protocol";
import { tapButtonState, type TapTone } from "@/lib/tap-button-state";
import { useClockPings, useRoomClock } from "./room-clock";

/** Resend an unanswered tap once after this long (a dropped socket, a rate-limited message). */
const TAP_RESEND_MS = 2000;
/** A click this soon after a pointerdown or key press is the same press. */
const CLICK_AFTER_PRESS_MS = 1500;
const TONE: Record<TapTone, string> = { grey: "#5a4a60", red: "#ff5050", gold: "var(--warn)", ok: "var(--ok)" };

type Pending = { questionId: string; round: number; at: number; resent: boolean };

/** The page-level half: the room clock, the ack and the pending tap. The page feeds it every message and reconnect. */
export function useTapPhone(sendRef: { current: (m: ClientMessage) => void }) {
  const clock = useRoomClock(sendRef);
  const [ack, setAck] = useState<{ questionId: string; round: number } | null>(null);
  const [refused, setRefused] = useState<"not_playing" | "tap_late" | undefined>(undefined);
  const pending = useRef<Pending | null>(null);
  const lastQuestion = useRef<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = () => {
    pending.current = null;
    setSending(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const resend = () => {
    const p = pending.current;
    if (!p || p.resent) return;
    p.resent = true;
    sendRef.current({ type: "TEAM_TAP", questionId: p.questionId, round: p.round, at: p.at });
    // Still nothing after the one resend: give the button back (the next STATE says what it may do).
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(settle, TAP_RESEND_MS);
  };

  return {
    ack,
    refused,
    sending,
    clock,
    press(questionId: string, round: number, at: number) {
      if (pending.current) return;
      pending.current = { questionId, round, at, resent: false };
      setSending(true);
      setRefused(undefined);
      navigator.vibrate?.(30);
      sendRef.current({ type: "TEAM_TAP", questionId, round, at });
      timer.current = setTimeout(resend, TAP_RESEND_MS);
    },
    /** A reconnect: a tap still waiting goes again, the same `at`. It counts only within TAP_MAX_LAG_MS of the press
     * (later it is tap_late and the player taps again); its main use is a lost ack, which comes back as tap_taken. */
    onOpen: resend,
    /** True when the message was the button's. `game` is the last STATE, for a tap_taken's round. */
    onMessage(msg: ServerMessage, game: StateMessage | null): boolean {
      if (msg.type === "CLOCK_PONG") {
        clock.onPong(msg.t, msg.server);
        return true;
      }
      // Another question, or the lobby: an old ack or refusal must not grey a question that comes round again at round 0.
      if (msg.type === "STATE") {
        const q = msg.reveal?.questionId ?? msg.view.buzz?.questionId;
        setAck((a) => (a && a.questionId !== q ? null : a));
        if (q !== lastQuestion.current) setRefused(undefined);
        lastQuestion.current = q;
        return false;
      }
      if (msg.type === "TAP_OK") {
        settle();
        setAck({ questionId: msg.questionId, round: msg.round });
        return true;
      }
      if (msg.type !== "ERROR" || msg.error !== "invalid_action") return false;
      const d = msg.detail;
      if (d === "tap_taken") {
        const b = game?.view.buzz;
        if (b) setAck({ questionId: b.questionId, round: b.tapRound ?? 0 });
      } else if (d === "not_playing" || d === "tap_late") setRefused(d);
      else if (d !== "tap_closed" && d !== "stale_question" && d !== "stunned" && d !== "cannot_tap") return false;
      settle();
      return true;
    },
  };
}
export type TapPhone = ReturnType<typeof useTapPhone>;

/** The button while a timing question is up, or its result in the reveal. */
export function TapButton({ game, teamId, tap }: { game: StateMessage; teamId: string; tap: TapPhone }) {
  const buzz = game.view.buzz;
  const pressedAt = useRef(-Infinity);
  const reveal = game.reveal?.timing ? game.reveal : null;
  const questionId = reveal?.questionId ?? buzz?.questionId ?? "";
  const label = reveal ? reveal.timing!.label : game.question?.timing?.label;
  const round = buzz?.tapRound ?? 0;
  const me = game.view.teams.find((t) => t.id === teamId);
  const playing = game.media?.questionId === questionId && game.media.state === "playing";
  useClockPings(tap.clock.ping, !reveal, questionId);

  const s = tapButtonState({
    inBoss: !!me?.inBossPhase,
    online: !!me?.online,
    // game-state's tapEligible: when every online boss-room team is stunned, none sits out.
    stunned: !!me?.stunned && !game.view.teams.every((t) => !t.online || !t.inBossPhase || t.stunned),
    open: !!buzz?.open,
    paused: !playing,
    tapLive: game.tapLive === true,
    synced: tap.clock.offset() !== null,
    acked: tap.ack?.questionId === questionId && tap.ack.round === round,
    sending: tap.sending,
    refused: tap.refused,
    ...(reveal ? { reveal: reveal.timing! } : {}),
    teamId,
  });
  if (s.hidden) return null;
  const press = (timeStamp: number) => {
    pressedAt.current = timeStamp;
    const offset = tap.clock.offset();
    if (!s.enabled || offset === null) return;
    tap.press(questionId, round, timeStamp + offset);
  };
  return (
    <div data-testid="tap" className="flex flex-col items-center gap-1 py-2 text-center">
      {!reveal && <div className="text-[16px]">整首只能按一次，最準的隊伍命中</div>}
      {!reveal && <div className="text-[22px]">{label ? `按在「${label}」那一下` : "按在關鍵那一拍"}</div>}
      <button
        type="button"
        disabled={!s.enabled}
        aria-live="polite"
        onPointerDown={(e) => press(e.timeStamp)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          press(e.timeStamp);
        }}
        // A screen reader's activation is a click with no pointerdown before it; a press already sent ignores it.
        onClick={(e) => {
          // The click that ends a touch: its pointerdown already pressed (a refused tap leaves nothing pending to stop it).
          if (e.timeStamp - pressedAt.current < CLICK_AFTER_PRESS_MS) return;
          press(e.timeStamp);
        }}
        className="flex aspect-square w-[min(72vw,280px)] touch-manipulation select-none flex-col items-center justify-center rounded-full px-6 text-center text-[30px] focus-visible:outline focus-visible:outline-4 focus-visible:outline-[var(--warn)]"
        style={{ background: TONE[s.tone], color: s.enabled ? "#fff" : s.tone === "gold" || s.tone === "ok" ? "var(--ink)" : "#ccc", boxShadow: "0 0 0 5px var(--k), inset 0 -12px 0 #0004", textShadow: s.enabled ? "3px 3px 0 var(--k)" : undefined }}
      >
        {s.label}
      </button>
      {!reveal && !s.hint && tap.ack?.questionId === questionId && tap.ack.round < round && (
        <div role="status" className="text-[16px]">
          重新開始，可以再按一次
        </div>
      )}
      {s.hint && (
        <div role="status" className="text-[16px]" style={{ color: "var(--warn)" }}>
          {s.hint}
        </div>
      )}
    </div>
  );
}
