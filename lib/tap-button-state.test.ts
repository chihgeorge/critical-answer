import { describe, expect, it } from "vitest";
import { tapButtonState, type TapButtonInput } from "./tap-button-state";

const live: TapButtonInput = { inBoss: true, online: true, stunned: false, open: true, paused: false, tapLive: true, synced: true, acked: false, sending: false, teamId: "A" };
const rows = [
  { teamId: "A", errorMs: 120, bonus: 0 },
  { teamId: "B", errorMs: -400, bonus: 2 },
  { teamId: "C", errorMs: 1500, bonus: 0 },
];

// One case per row of the design's table (docs/designs/timing-tap.md 畫面).
describe("tapButtonState", () => {
  it.each<[string, Partial<TapButtonInput>, Partial<ReturnType<typeof tapButtonState>>]>([
    ["before ▶", { open: false }, { tone: "grey", label: "等音樂開始…", enabled: false }],
    ["playing, clock and sync", {}, { tone: "red", label: "按！", enabled: true }],
    ["not synced yet", { synced: false }, { tone: "grey", label: "連線中…", enabled: false }],
    ["host paused", { paused: true }, { tone: "grey", label: "主持人暫停了", enabled: false }],
    ["open but the screen's clock is gone", { tapLive: false }, { tone: "grey", label: "大螢幕卡住了，等一下", enabled: false }],
    ["sending", { sending: true }, { tone: "gold", label: "送出中…", enabled: false }],
    ["acked", { acked: true }, { tone: "gold", label: "已按 ✓ 等結果", enabled: false }],
    ["refused not_playing", { tapLive: false, refused: "not_playing" }, { label: "大螢幕卡住了，等一下", hint: "沒算到：音樂剛停，等音樂再按" }],
    ["refused tap_late, live again", { refused: "tap_late" }, { label: "按！", enabled: true, hint: "沒算到：網路太慢，再按一次" }],
    ["stunned", { stunned: true }, { tone: "grey", label: "被暈眩了，這題坐掉", enabled: false }],
    ["outside the boss room", { inBoss: false }, { hidden: true }],
    ["offline", { online: false }, { hidden: true }],
    ["reveal: the hit", { reveal: { rows } }, { tone: "ok", label: "命中！晚 0.12 秒" }],
    ["reveal: another tap", { teamId: "B", reveal: { rows } }, { tone: "grey", label: "早 0.40 秒・+2（第 2 名）" }],
    ["reveal: a tap with no bonus", { teamId: "C", reveal: { rows } }, { label: "晚 1.50 秒（第 3 名）" }],
    ["reveal: no tap", { teamId: "D", reveal: { rows } }, { tone: "grey", label: "沒按" }],
  ])("%s", (_, input, want) => {
    expect(tapButtonState({ ...live, ...input })).toMatchObject(want);
  });
});
