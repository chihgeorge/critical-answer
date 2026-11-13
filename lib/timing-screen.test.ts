import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TimingResult, timingLines, TimingTimeline } from "@/components/timing-screen";
import type { AnswerReveal } from "./protocol";
import type { SpectatorView } from "./game-state";

// The big screen's timing reveal (docs/designs/timing-tap-timeline.md): results beside the video, the timeline under it.
const names = ["藍色閃電", "紅龍隊", "綠野仙蹤", "黃金鼠", "粉紅泡泡", "紫電", "青蛙", "橘子"];
const view = { teams: names.map((name, i) => ({ id: `t${i}`, name, inBossPhase: true })) } as unknown as SpectatorView;
const timing: NonNullable<AnswerReveal["timing"]> = {
  targetMs: 190_350,
  label: "蹬",
  rows: [
    { teamId: "t0", errorMs: 80, bonus: 0 },
    { teamId: "t1", errorMs: -150, bonus: 3 },
    { teamId: "t2", errorMs: 210, bonus: 3 },
    { teamId: "t5", errorMs: -3400, bonus: 0 },
  ],
  stunned: ["t6"],
};

describe("TimingResult", () => {
  it("names the winner, its error and the target, and keeps the timing-reveal testid", () => {
    const html = renderToStaticMarkup(createElement(TimingResult, { timing, view }));
    expect(html).toContain('data-testid="timing-reveal"');
    expect(html).toContain("命中！藍色閃電");
    expect(html).toContain("晚 0.08 秒");
    expect(html).toContain("目標 3:10.35「蹬」");
  });

  it("says 最接近 when the winner is over a second off", () => {
    const far = { ...timing, rows: [{ teamId: "t0", errorMs: -1200, bonus: 0 }] };
    expect(renderToStaticMarkup(createElement(TimingResult, { timing: far, view }))).toContain("最接近！藍色閃電");
  });
});

describe("timingLines", () => {
  it("lists the taps closest first, then the teams that did not tap, stunned or not, up to 8", () => {
    const lines = timingLines(timing, view);
    expect(lines.map((l) => l.id)).toEqual(["t0", "t1", "t2", "t5", "t3", "t4", "t6", "t7"]);
    expect(lines.map((l) => l.text)).toEqual(["晚 0.08", "早 0.15", "晚 0.21", "早 3.40", "沒按", "沒按", "暈眩", "沒按"]);
  });
});

describe("TimingTimeline", () => {
  it("with no video, shows every marker solid and no playhead", () => {
    const html = renderToStaticMarkup(createElement(TimingTimeline, { timing, view, clipStartMs: 170_000 }));
    expect(html).toContain('data-testid="timing-timeline"');
    expect(html.match(/data-testid="timing-mark"/g)).toHaveLength(4);
    expect(html).not.toContain("data-faint");
    expect(html).not.toContain("timing-playhead");
    expect(html).toContain("蹬 3:10.35");
    // A tap past the 2 s zoom is pinned to the left edge with its name.
    expect(html).toContain("◀ 紫電 早 3.40");
  });

  it("pins a tap past the right edge there too, with its name", () => {
    const late = { ...timing, rows: [...timing.rows, { teamId: "t3", errorMs: 2300, bonus: 0 }] };
    expect(renderToStaticMarkup(createElement(TimingTimeline, { timing: late, view, clipStartMs: 170_000 }))).toContain("黃金鼠 晚 2.30 ▶");
  });
});
