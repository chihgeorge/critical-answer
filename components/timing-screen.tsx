"use client";
// The big screen's side of a timing question (docs/designs/timing-tap.md 畫面, 時間怎麼量 2): the clock report, the
// panel beside the music card during the round, and the reveal table. Client-safe: no bank data.
import { useEffect } from "react";
import type { AnswerReveal, ClientMessage } from "@/lib/protocol";
import type { SpectatorView } from "@/lib/game-state";
import { ANCHOR_HEARTBEAT_MS, ANCHOR_POLL_MS, ANCHOR_SEND_GAP_MS, ANCHOR_SEND_MIN_MS, anchorOf, formatSongTime, formatTapError, nextAnchorWindow } from "@/lib/tap-clock";
import { Panel, Sprite } from "./pixel";
import { useClockPings } from "./room-clock";

/** Reports the player's anchor (server ms of the video's time 0) while a timing question plays: a sample only when the
 * player's time moves, the minimum of the last few, sent on a change at most every 250 ms, else once a second. */
export function TapClockReporter({ questionId, seq, timeRef, ping, offset, sendRef }: {
  questionId: string;
  seq: number;
  timeRef: { current: (() => number | null) | null };
  ping: () => void;
  offset: () => number | null;
  sendRef: { current: (m: ClientMessage) => void };
}) {
  useClockPings(ping, true, questionId);
  useEffect(() => {
    let samples: number[] = [];
    let lastTime: number | null = null;
    let sent: { anchor: number | null; at: number } | null = null;
    const timer = setInterval(() => {
      const now = performance.now();
      const off = offset();
      const t = off === null ? null : (timeRef.current?.() ?? null);
      if (t === null || off === null) {
        lastTime = null;
      } else if (t !== lastTime) {
        lastTime = t;
        samples = nextAnchorWindow(samples, now + off - t * 1000);
      }
      const anchor = t === null ? null : anchorOf(samples);
      const changed = !sent || (sent.anchor === null) !== (anchor === null) || (anchor !== null && Math.abs(anchor - sent.anchor!) > ANCHOR_SEND_MIN_MS);
      if (sent && !(changed && now - sent.at >= ANCHOR_SEND_GAP_MS) && now - sent.at < ANCHOR_HEARTBEAT_MS) return;
      sendRef.current({ type: "SCREEN_TAP_CLOCK", questionId, seq, anchor: anchor === null ? null : Math.round(anchor) });
      sent = { anchor, at: now };
    }, ANCHOR_POLL_MS);
    return () => clearInterval(timer);
  }, [questionId, seq, timeRef, offset, sendRef]);
  return null;
}

/** Beside the music card while the round runs: the rule, never who tapped. */
export function TimingRoundPanel({ label, open }: { label?: string; open: boolean }) {
  return (
    <div data-testid="screen-timing">
      <Panel tone="lav" className="flex flex-col items-center gap-1 px-4 py-3 text-center">
        <div className="text-[24px]">♪ 卡點題</div>
        <div className="text-[28px] leading-tight [overflow-wrap:anywhere]">{open ? (label ? `按在「${label}」那一下！` : "按在關鍵那一拍！") : "等主持人按 ▶"}</div>
        <div className="text-[16px]">每隊只能按一次，最準的命中</div>
      </Panel>
    </div>
  );
}

const ROWS = 8;

/** The reveal over the question: the winner first, then every boss-room team by |error|, the ones who did not tap last. */
export function TimingReveal({ timing, view }: { timing: NonNullable<AnswerReveal["timing"]>; view: SpectatorView }) {
  const team = (id: string) => view.teams.find((t) => t.id === id);
  const index = (id: string) => view.teams.findIndex((t) => t.id === id);
  const [first] = timing.rows;
  const winner = team(first.teamId);
  const tapped = new Set(timing.rows.map((r) => r.teamId));
  const stunned = new Set(timing.stunned ?? []);
  const rest = view.teams.filter((t) => t.inBossPhase && !tapped.has(t.id));
  const lines = [
    ...timing.rows.map((r, k) => ({ id: r.teamId, k, text: formatTapError(r.errorMs), bonus: r.bonus, dim: false })),
    ...rest.map((t) => ({ id: t.id, k: -1, text: stunned.has(t.id) ? "暈眩" : "沒按", bonus: 0, dim: true })),
  ].slice(0, ROWS);
  return (
    <div data-testid="timing-reveal" className="absolute" style={{ left: "50%", top: 96, width: 560, transform: "translateX(-50%)", zIndex: 7 }}>
      <Panel className="flex flex-col items-center gap-1 px-5 py-3 text-center">
        <div className="flex items-center gap-3">
          {index(first.teamId) >= 0 && <Sprite kind="hero" variant={index(first.teamId)} scale={3} />}
          <span className="text-[32px] leading-tight [overflow-wrap:anywhere]">
            {Math.abs(first.errorMs) > 1000 ? "最接近！" : "命中！"}
            {winner?.name ?? ""}
          </span>
        </div>
        <div className="text-[24px]">{formatTapError(first.errorMs)}</div>
        <div className="text-[16px]" style={{ color: "var(--dim-ink)" }}>
          目標 {formatSongTime(timing.targetMs)}
          {timing.label ? `「${timing.label}」` : ""}
        </div>
        <ol className="mt-1 flex w-full flex-col gap-[2px]">
          {lines.map((l) => (
            <li key={l.id} className="flex h-[30px] items-center gap-3 px-2 text-[20px]" style={{ background: l.k === 0 ? "var(--turn)" : undefined, color: l.dim ? "var(--dim-ink)" : undefined }}>
              <span className="w-6 text-right">{l.k >= 0 ? l.k + 1 : "–"}</span>
              <span className="w-[110px] truncate text-left">{team(l.id)?.name ?? ""}</span>
              <span className="flex-1 text-left">
                {l.text}
                {l.k === 0 && timing.tie && <span className="ml-2 text-[14px]">同秒先到</span>}
              </span>
              {l.bonus > 0 && (
                <span className="px-chip" style={{ color: "var(--ok)" }}>
                  +{l.bonus}
                </span>
              )}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
