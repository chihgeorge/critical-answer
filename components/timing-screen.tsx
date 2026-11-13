"use client";
// The big screen's side of a timing question (docs/designs/timing-tap.md 畫面, 時間怎麼量 2): the clock report, the
// panel beside the music card during the round, and the reveal: results beside the video, the timeline and its replay
// under it (docs/designs/timing-tap-timeline.md). Client-safe: no bank data.
import { useEffect, useState } from "react";
import type { AnswerReveal, ClientMessage } from "@/lib/protocol";
import type { SpectatorView } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { ANCHOR_HEARTBEAT_MS, ANCHOR_POLL_MS, ANCHOR_SEND_GAP_MS, ANCHOR_SEND_MIN_MS, anchorOf, formatSongTime, formatTapError, labelRows, nextAnchorWindow, REPLAY_DELAY_MS, replayDue, shortTapError, songMs, timelineAt, timelineWindow } from "@/lib/tap-clock";
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

type Timing = NonNullable<AnswerReveal["timing"]>;

const ROWS = 8;
const hat = (i: number) => TEAM_LOOKS[i % TEAM_LOOKS.length].hat;

/** Every boss-room team in reveal order: the taps closest first, then the ones who did not tap (stunned or not). */
export function timingLines(timing: Timing, view: SpectatorView) {
  const tapped = new Set(timing.rows.map((r) => r.teamId));
  const stunned = new Set(timing.stunned ?? []);
  const rest = view.teams.filter((t) => t.inBossPhase && !tapped.has(t.id));
  return [
    ...timing.rows.map((r, k) => ({ id: r.teamId, k, text: shortTapError(r.errorMs), bonus: r.bonus, dim: false })),
    ...rest.map((t) => ({ id: t.id, k: -1, text: stunned.has(t.id) ? "暈眩" : "沒按", bonus: 0, dim: true })),
  ].slice(0, ROWS);
}

/** Beside the reveal's video: the winner, its error and the target, then every team in two columns of four. */
export function TimingResult({ timing, view }: { timing: Timing; view: SpectatorView }) {
  const team = (id: string) => view.teams.find((t) => t.id === id);
  const index = (id: string) => view.teams.findIndex((t) => t.id === id);
  const [first] = timing.rows;
  return (
    <div data-testid="timing-reveal" className="flex w-full min-w-0 flex-col text-left">
      <div className="flex items-center gap-2">
        {index(first.teamId) >= 0 && <Sprite kind="hero" variant={index(first.teamId)} scale={2} />}
        <span className="min-w-0 truncate text-[26px] leading-tight">
          {Math.abs(first.errorMs) > 1000 ? "最接近！" : "命中！"}
          {team(first.teamId)?.name ?? ""}
        </span>
      </div>
      <div className="text-[20px] leading-tight">
        {formatTapError(first.errorMs)}
        {timing.tie && <span className="ml-1 text-[14px]">同秒先到</span>}
        <span className="ml-3 text-[15px]" style={{ color: "var(--dim-ink)" }}>
          目標 {formatSongTime(timing.targetMs)}
          {timing.label ? `「${timing.label}」` : ""}
        </span>
      </div>
      <ol className="mt-1 grid grid-flow-col grid-cols-2 grid-rows-4 gap-x-2">
        {timingLines(timing, view).map((l) => (
          <li key={l.id} className="flex h-[22px] items-center gap-[3px] text-[15px]" style={{ background: l.k === 0 ? "var(--turn)" : undefined, color: l.dim ? "var(--dim-ink)" : undefined }}>
            <span className="w-3 shrink-0 text-right">{l.k >= 0 ? l.k + 1 : "–"}</span>
            <span aria-hidden className="h-3 w-3 shrink-0" style={{ background: index(l.id) >= 0 ? hat(index(l.id)) : undefined, boxShadow: "0 0 0 2px var(--k)" }} />
            <span className="min-w-0 flex-1 truncate">{team(l.id)?.name ?? ""}</span>
            <span className="w-[50px] shrink-0 whitespace-nowrap">{l.text}</span>
            <span className="w-[26px] shrink-0">
              {l.bonus > 0 && (
                <span className="px-chip px-[5px] text-[13px]" style={{ color: "var(--ok)" }}>
                  +{l.bonus}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The timeline's width on the 960×540 stage (inside the question panel), its axis inset and a label's height. */
const TIMELINE_W = 660;
const AXIS_INSET = 12;
const AXIS_W = TIMELINE_W - 2 * AXIS_INSET;
/** Label rows: two above the axis (nearest first), two below; the first row below starts with the target's label. */
const LABEL_TOPS = [17, 0, 66, 84];
/** A 14px label's width: Cubic 11 draws CJK full width and ASCII half. */
const labelWidth = (text: string) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 14 : 7), 10);

/** The song time the room hears now, from the player's time read every frame (null: no player, or before it plays;
 * it holds where it was while paused). The player's time is a cached value, so the anchor (performance.now() of the
 * video's time 0) is the minimum of the last few samples, as the clock report's; the speaker latency comes off. */
function usePlayhead(timeRef: { current: (() => number | null) | null } | undefined, latencyMs: number): number | null {
  const [head, setHead] = useState<number | null>(null);
  useEffect(() => {
    if (!timeRef) return;
    let samples: number[] = [];
    let last: number | null = null;
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const t = timeRef.current?.() ?? null;
      if (t === null) last = null;
      else {
        if (t !== last) samples = nextAnchorWindow(samples, now - t * 1000);
        last = t;
        const anchor = anchorOf(samples);
        if (anchor !== null) setHead(Math.round(songMs(now, anchor, latencyMs)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timeRef, latencyMs]);
  return head;
}

/** Under the reveal's video: the target and every team's tap on one line, zoomed to the taps, and a playhead that
 * follows the replay. Markers the playhead has not reached yet are faint; with no playhead (no video) all are solid. */
export function TimingTimeline({ timing, view, clipStartMs, timeRef }: { timing: Timing; view: SpectatorView; clipStartMs: number; timeRef?: { current: (() => number | null) | null } }) {
  const head = usePlayhead(timeRef, timing.latencyMs ?? 0);
  const win = timelineWindow(timing.targetMs, timing.rows.map((r) => r.errorMs), clipStartMs);
  const x = (ms: number) => AXIS_INSET + timelineAt(ms, win) * AXIS_W;
  const index = (id: string) => view.teams.findIndex((t) => t.id === id);
  const targetText = `${timing.label ? `${timing.label} ` : ""}${formatSongTime(timing.targetMs)}`;
  const tx = x(timing.targetMs);
  const tw = labelWidth(targetText);
  // Closest first (timing.rows' order), so the winner's label always finds room.
  const marks = timing.rows.map((r, k) => {
    const at = timing.targetMs + r.errorMs;
    const pinned = at < win[0];
    const name = view.teams.find((t) => t.id === r.teamId)?.name ?? "";
    const text = pinned ? `◀ ${name} ${shortTapError(r.errorMs)}` : shortTapError(r.errorMs);
    const w = labelWidth(text);
    const cx = x(at);
    const centre = pinned ? cx + w / 2 - 2 : Math.min(TIMELINE_W - w / 2, Math.max(w / 2, cx));
    return { r, k, at, cx, text, w, centre };
  });
  const rows = labelRows(
    marks.map((m) => [m.centre - m.w / 2, m.centre + m.w / 2]),
    [[], [], [[tx - tw / 2, tx + tw / 2]], []],
  );
  const ticks: number[] = [];
  for (let t = Math.ceil(win[0] / 500) * 500; t <= win[1]; t += 500) ticks.push(t);
  return (
    <div data-testid="timing-timeline" className="relative mx-auto mt-2 text-left" style={{ width: TIMELINE_W, height: 100 }}>
      <div className="absolute" style={{ left: AXIS_INSET, right: AXIS_INSET, top: 50, height: 8, background: "var(--lav2)", boxShadow: "0 0 0 3px var(--k)" }}>
        {head !== null && <div className="absolute inset-y-0 left-0" style={{ width: x(head) - AXIS_INSET, background: "#a99ad8" }} />}
      </div>
      {ticks.map((t) => (
        <div key={t} aria-hidden className="absolute" style={{ left: x(t) - 1, top: 47, width: 2, height: 14, background: "var(--k)" }} />
      ))}
      <div className="absolute" style={{ left: tx - 2, top: 30, width: 4, height: 34, background: "var(--danger)", boxShadow: "0 0 0 2px var(--k)" }} />
      <div className="absolute whitespace-nowrap px-[5px] text-[14px] leading-[15px]" style={{ left: tx, top: 66, transform: "translateX(-50%)", background: "var(--danger)", color: "#fff", boxShadow: "0 0 0 2px var(--k)", textShadow: "1px 1px 0 var(--k)" }}>
        {targetText}
      </div>
      {marks.map((m, i) => {
        const faint = head !== null && m.at > head;
        const colour = index(m.r.teamId) >= 0 ? hat(index(m.r.teamId)) : "var(--cream)";
        const win1 = m.k === 0;
        return (
          <div key={m.r.teamId} data-testid="timing-mark" data-faint={faint || undefined} style={{ opacity: faint ? 0.35 : 1 }}>
            <div className="absolute" style={{ left: m.cx - (win1 ? 8 : 6), top: win1 ? 33 : 36, width: win1 ? 16 : 12, height: win1 ? 16 : 12, background: colour, boxShadow: win1 ? "0 0 0 3px var(--k), 0 0 0 6px var(--turn2)" : "0 0 0 2px var(--k)" }} />
            {rows[i] >= 0 && (
              <div className="absolute whitespace-nowrap px-1 text-[14px] leading-[14px]" style={{ left: m.centre, top: LABEL_TOPS[rows[i]], transform: "translateX(-50%)", background: win1 ? "var(--turn)" : "var(--cream)", boxShadow: "0 0 0 2px var(--k)", borderBottom: `3px solid ${colour}` }}>
                {m.text}
              </div>
            )}
          </div>
        );
      })}
      {head !== null && <div data-testid="timing-playhead" className="absolute" style={{ left: x(head) - 1, top: 30, width: 2, height: 34, background: "#fff", boxShadow: "0 0 0 2px var(--k)" }} />}
    </div>
  );
}

/** The reveal's replay, once per reveal: REPLAY_DELAY_MS after it while the host's media on the question plays (a ⏸
 * holds it until ▶). `key` names the reveal; null when there is no clip to replay. */
export function useTimingReplay(key: string | null, fromS: number, playing: boolean): { key: string; fromS: number } | undefined {
  const [done, setDone] = useState<{ key: string; fromS: number } | null>(null);
  const due = replayDue(key, playing, done?.key ?? null);
  useEffect(() => {
    if (!due || key === null) return;
    const timer = setTimeout(() => setDone({ key, fromS }), REPLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, key, fromS]);
  return done && done.key === key ? done : undefined;
}
