"use client";
// 🎯 校正喇叭 in the lobby's ⚙ 更多 (docs/designs/tap-calibrate.md): the start button, then the suggested latency with
// 套用 and 取消. Only 套用 writes the latency (HOST_TAP_LATENCY). Client-safe: no bank data.
import type { ClientMessage } from "@/lib/protocol";
import { CALIBRATE_MIN_TAPS } from "@/lib/tap-clock";
import { Panel, PixelButton } from "./pixel";

export type CalibrateResult = {
  ms: number | null;
  taps: number;
  phones: number;
};
/** Why the room would not start, as the host page last heard while it waited on its press. */
export type CalibrateNote = "screen_muted" | "no_screen" | "screen_testing" | "calibrating";

export function TapCalibratePanel({
  running,
  result,
  note,
  latency,
  music,
  online,
  send,
  onStart,
  onDone,
}: {
  /** LOBBY's `calibrate`, or the host's press still on its way. */
  running: boolean;
  result: CalibrateResult | null;
  note: CalibrateNote | null;
  /** The speaker latency now (LOBBY `tapLatency`). */
  latency: number;
  /** The host's 🎵 switch: off, the big screen reports no sound on purpose. */
  music: boolean;
  online: boolean;
  send: (m: ClientMessage) => void;
  onStart: () => void;
  /** 套用 or 取消: the card goes. */
  onDone: () => void;
}) {
  const start = () => {
    onStart();
    send({ type: "HOST_TAP_CALIBRATE" });
  };
  const noteText =
    note === "screen_muted"
      ? music
        ? "大螢幕還沒開聲音：去點大螢幕上的「點一下開啟音效與氣氛」，再按一次"
        : "大螢幕的 🎵 音樂關著：在上面打開，再按一次"
      : note === "no_screen"
        ? "沒有大螢幕連著：先用大螢幕連結開啟大螢幕，再按一次"
        : note === "screen_testing"
          ? "大螢幕試播影音還在跑，等它跑完再按"
          : note === "calibrating"
            ? "校正還在進行，等它結束"
            : null;
  return (
    <div data-testid="tap-calibrate" className="flex flex-col gap-2">
      <div className="text-[18px]">🎯 校正喇叭</div>
      <div className="text-[15px]">大螢幕放 8 聲嗶，大家用手機跟著按，算出卡點題的喇叭延遲。只有按「套用」才會改。</div>
      {!result && (
        <div className="flex flex-wrap items-center gap-2">
          <PixelButton disabled={running || !online} onClick={start} className="!m-0 min-h-[44px] !px-4 !py-2 text-[16px]">
            {running ? "校正中…大家跟著嗶聲按" : "🎯 校正喇叭"}
          </PixelButton>
          <span className="text-[14px]">現在 {latency} ms</span>
        </div>
      )}
      {noteText && !running && !result && (
        <Panel tone="turn" role="status" className="px-3 py-2 text-[16px]" style={{ background: "var(--warn)" }}>
          {noteText}
        </Panel>
      )}
      {result && (
        <Panel tone="turn" role="status" className="flex flex-col gap-1 px-3 py-2">
          {result.ms !== null ? (
            <>
              <div className="text-[22px]">建議延遲 {result.ms} ms</div>
              <div className="text-[14px]">
                現在 {latency} ms・算了 {result.taps} 下、{result.phones} 支手機
              </div>
              <div className="text-[14px]">套用後放一題測試卡點題，看揭曉的誤差中位數接近 0 就好。</div>
              <div className="mt-1 flex gap-2">
                <PixelButton
                  variant="primary"
                  disabled={!online}
                  onClick={() => {
                    send({ type: "HOST_TAP_LATENCY", ms: result.ms! });
                    onDone();
                  }}
                  className="!m-0 min-h-[44px] !px-4 !py-1 text-[16px]"
                >
                  套用
                </PixelButton>
                <PixelButton onClick={onDone} className="!m-0 min-h-[44px] !px-4 !py-1 text-[16px]">
                  取消
                </PixelButton>
              </div>
            </>
          ) : (
            <>
              <div className="text-[18px]">
                {result.taps < CALIBRATE_MIN_TAPS ? "按的人太少，再試一次" : "量不出來：大家按得不齊，或延遲超過 0.7 秒。再試一次"}
              </div>
              <div className="mt-1 flex gap-2">
                <PixelButton disabled={!online} onClick={start} className="!m-0 min-h-[44px] !px-4 !py-1 text-[16px]">
                  再試一次
                </PixelButton>
                <PixelButton onClick={onDone} className="!m-0 min-h-[44px] !px-4 !py-1 text-[16px]">
                  取消
                </PixelButton>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
