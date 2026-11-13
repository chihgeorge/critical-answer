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

  // Value: protects=a tie the room broke by arrival says 同秒先到, and a target with no label shows no empty 「」;
  // fails_when=the tie flag or the label guard is dropped in the move from TimingReveal; why_new=no test read either;
  // seam=none; no_claim=layout of the chip (static markup only)
  it("says 同秒先到 only on a tie, and shows the target alone without a label", () => {
    const html = renderToStaticMarkup(createElement(TimingResult, { timing, view }));
    expect(html).not.toContain("同秒先到");
    const tie = { ...timing, label: undefined, tie: true as const };
    const tied = renderToStaticMarkup(createElement(TimingResult, { timing: tie, view }));
    expect(tied).toContain("同秒先到");
    expect(tied).toContain("目標 3:10.35");
    expect(tied).not.toContain("「");
  });
});

describe("timingLines", () => {
  it("lists the taps closest first, then the teams that did not tap, stunned or not, up to 8", () => {
    const lines = timingLines(timing, view);
    expect(lines.map((l) => l.id)).toEqual(["t0", "t1", "t2", "t5", "t3", "t4", "t6", "t7"]);
    expect(lines.map((l) => l.text)).toEqual(["晚 0.08", "早 0.15", "晚 0.21", "早 3.40", "沒按", "沒按", "暈眩", "沒按"]);
    // Value: protects=a team outside the boss room is not listed as 沒按; fails_when=the inBossPhase filter is dropped;
    // why_new=every team above is in the boss room; seam=none; no_claim=none beyond protects
    const out = { teams: view.teams.map((t) => (t.id === "t3" ? { ...t, inBossPhase: false } : t)) } as SpectatorView;
    expect(timingLines(timing, out).map((l) => l.id)).toEqual(["t0", "t1", "t2", "t5", "t4", "t6", "t7"]);
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

  // Value: protects=with taps bunched on the beat, the winner's label is the one that always finds room;
  // fails_when=the marks are laid out in another order than closest first (by position, say) and the winner's label is
  // dropped; why_new=labelRows is tested alone, not the order the timeline feeds it; seam=none;
  // no_claim=the 14px label width estimate matches Cubic 11 (static markup, no fonts)
  it("keeps the winner's label when bunched taps leave no room for all of them", () => {
    const errors = [-95, -70, -45, -20, 10, 30, 60, 85];
    const bunched = { ...timing, rows: errors.map((errorMs, i) => ({ teamId: `t${i}`, errorMs, bonus: 0 })).sort((a, b) => Math.abs(a.errorMs) - Math.abs(b.errorMs)) };
    const html = renderToStaticMarkup(createElement(TimingTimeline, { timing: bunched, view, clipStartMs: 170_000 }));
    expect(html.match(/data-testid="timing-mark"/g)).toHaveLength(8);
    // Some labels are dropped (four rows cannot hold eight), so the check below means something.
    expect(html.match(/leading-\[14px\]/g)!.length).toBeLessThan(8);
    expect(html).toContain(">晚 0.01<");
  });

  // Value: protects=a target a moment into the clip keeps its label inside the timeline (review fix 目標 label 不出界);
  // fails_when=the target label's clamp is removed and it is centred on a mark near the left edge; why_new=the other cases
  // put the target mid-axis; seam=none; no_claim=real rendered width (labelWidth estimate, static markup)
  it("keeps the target's label inside the timeline when the target sits at its left edge", () => {
    const early = { ...timing, label: "副歌第一拍" };
    const html = renderToStaticMarkup(createElement(TimingTimeline, { timing: early, view, clipStartMs: 190_300 }));
    const left = Number(html.match(/left:([\d.]+)px[^>]*>副歌第一拍 3:10.35</)![1]);
    // Half the label's estimated width: 5 CJK × 14 + 8 ASCII × 7 + 10, halved.
    expect(left).toBeGreaterThanOrEqual(68);
  });
});
