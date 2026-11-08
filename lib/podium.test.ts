import { describe, expect, it } from "vitest";
import { EPILOGUE_PAGE_CHARS, PHONE_LAG_MS, beatMs, critKing, epiloguePages, rankTeams, revealAt, revealBeats, revealMarks, type Beat } from "@/lib/podium";
import { MAX_EPILOGUE_LINE } from "@/lib/narration/runner";

/** A d20 that lands on `values` in order. */
const dice = (...values: number[]) => () => values.shift() ?? 1;
const teams = (...r: [string, number, number?][]) => r.map(([id, reward, natural20s]) => ({ id, name: `${id}隊`, reward, natural20s }));

// Value: protects=ties that change the podium are settled by saved d20s, rerolled while tied, and nobody else rolls (D4, D10);
// fails_when=a tie below third rolls, a reroll includes a team that already won, or the order ignores the dice;
// why_new=new rule; seam=none; no_claim=the dice on screen (unit only)
describe("rankTeams", () => {
  it("ranks by reward and rolls nothing without a tie", () => {
    expect(rankTeams(teams(["乙", 20], ["甲", 30], ["丙", 10]), dice())).toEqual({ ranking: ["甲", "乙", "丙"], tieRolls: [] });
  });

  it("a tie for first rolls, highest die first", () => {
    expect(rankTeams(teams(["甲", 30], ["乙", 30], ["丙", 10]), dice(7, 18))).toEqual({
      ranking: ["乙", "甲", "丙"],
      tieRolls: [{ from: 1, teams: ["甲", "乙"], values: [7, 18] }],
    });
  });

  it("only the teams still tied roll again, as often as it takes", () => {
    const { ranking, tieRolls } = rankTeams(teams(["甲", 30], ["乙", 30], ["丙", 30]), dice(9, 5, 5, 4, 4, 2, 12));
    expect(ranking).toEqual(["甲", "丙", "乙"]);
    expect(tieRolls).toEqual([
      { from: 1, teams: ["甲", "乙", "丙"], values: [9, 5, 5] },
      { from: 2, teams: ["乙", "丙"], values: [4, 4] },
      { from: 2, teams: ["乙", "丙"], values: [2, 12] },
    ]);
  });

  it("a tie across third rolls for the podium; one wholly below it does not", () => {
    expect(rankTeams(teams(["甲", 40], ["乙", 30], ["丙", 10], ["丁", 10]), dice(3, 15)).ranking).toEqual(["甲", "乙", "丁", "丙"]);
    expect(rankTeams(teams(["甲", 40], ["乙", 30], ["丙", 20], ["丁", 5], ["戊", 5]), dice()).tieRolls).toEqual([]);
    // Four tied for second: the two left tied below third keep the team order.
    const four = rankTeams(teams(["甲", 40], ["乙", 9], ["丙", 9], ["丁", 9], ["戊", 9]), dice(20, 18, 3, 3));
    expect(four.ranking).toEqual(["甲", "乙", "丙", "丁", "戊"]);
    expect(four.tieRolls).toHaveLength(1);
  });

  it("a die that never changes stops rolling instead of looping", () => {
    expect(rankTeams(teams(["甲", 0], ["乙", 0]), () => 20).ranking).toEqual(["甲", "乙"]);
  });
});

// Value: protects=the crit king is the most natural 20s, ties named together, nobody when no 20 (D5, D15);
// fails_when=a zero count crowns everyone or a tie keeps one name; why_new=new; seam=none; no_claim=none beyond protects
describe("critKing", () => {
  it("names the most 20s, every team tied for it, and nobody with none", () => {
    expect(critKing([{ name: "甲", natural20s: 2 }, { name: "乙", natural20s: 1 }])).toEqual({ names: ["甲"], count: 2 });
    expect(critKing([{ name: "甲", natural20s: 1 }, { name: "乙", natural20s: 1 }, { name: "丙" }])).toEqual({ names: ["甲", "乙"], count: 1 });
    expect(critKing([{ name: "甲" }, { name: "乙", natural20s: 0 }])).toBeNull();
  });
});

// Value: protects=the beat order the screen and phones share: crit king, then places lowest first, each roll just before
// the first place it decides, scripted lines where the narration gave none (D3, D10, D11, D14);
// fails_when=places are called highest first, a roll lands after its place, or fewer than 3 teams calls a missing place;
// why_new=new; seam=none; no_claim=what the screen draws per beat (screen tests, e2e)
describe("revealBeats", () => {
  const lines = (beats: Beat[]) => beats.map((b) => (b.kind === "roll" ? `[${b.line}｜${b.result}]` : b.line));

  it("calls the crit king, then third, second and first, nothing below third", () => {
    const t = teams(["甲", 40, 1], ["乙", 30, 2], ["丙", 20], ["丁", 10]);
    expect(lines(revealBeats(t, ["甲", "乙", "丙", "丁"], []))).toEqual([
      "本場大成功王是……乙隊，擲出 2 次 20！",
      "第三名是……丙隊！",
      "第二名是……乙隊！",
      "第一名是……甲隊！",
    ]);
  });

  it("calls every team when there are fewer than three, and one team gets its line too", () => {
    expect(lines(revealBeats(teams(["甲", 40], ["乙", 30]), ["甲", "乙"], []))).toEqual(["第二名是……乙隊！", "第一名是……甲隊！"]);
    expect(lines(revealBeats(teams(["甲", 0]), ["甲"], []))).toEqual(["第一名是……甲隊！"]);
    expect(revealBeats([], [], [])).toEqual([]);
  });

  it("rolls for first and second just before second; a roll for third goes on podium before third", () => {
    const t = teams(["甲", 30], ["乙", 30], ["丙", 10], ["丁", 10]);
    const rolls = [
      { from: 1, teams: ["甲", "乙"], values: [7, 18] },
      { from: 3, teams: ["丙", "丁"], values: [4, 4] },
      { from: 3, teams: ["丙", "丁"], values: [2, 9] },
    ];
    expect(lines(revealBeats(t, ["乙", "甲", "丁", "丙"], rolls))).toEqual([
      "[第 3 名同分！擲 d20 搶上台｜又同點！重擲]",
      "[第 3 名同分！擲 d20 搶上台｜9 比 2，丁隊勝！]",
      "第三名是……丁隊！",
      "[第 1、2 名同分！擲 d20 比大小｜18 比 7，乙隊勝！]",
      "第二名是……甲隊！",
      "第一名是……乙隊！",
    ]);
  });

  it("three teams rolling read their dice in order", () => {
    const beats = revealBeats(teams(["甲", 9], ["乙", 9], ["丙", 9]), ["甲", "丙", "乙"], [{ from: 1, teams: ["甲", "乙", "丙"], values: [9, 5, 5] }]);
    expect(beats[0]).toMatchObject({ kind: "roll", line: "第 1、2、3 名同分！擲 d20 比大小", result: "甲隊 9、乙隊 5、丙隊 5，同點的重擲" });
  });

  // Value: protects=5–8 dice fit the big screen and the result only promises a reroll that follows; fails_when=over
  // four teams the result lists every team again, says 同點的重擲 for a tie below the podium, or miscounts the places.
  it("over four teams rolling, the result names nobody and promises a reroll only on the podium", () => {
    const ids = ["甲", "乙", "丙", "丁", "戊", "己", "庚"];
    const t = teams(...ids.map((id) => [id, 0] as [string, number]));
    const result = (from: number, values: number[]) => revealBeats(t, ids, [{ from, teams: ids.slice(from - 1, from - 1 + values.length), values }]).find((b) => b.kind === "roll");
    expect(result(1, [9, 7, 5, 3, 1])).toMatchObject({ line: "第 1、2、3 名同分！擲 d20 搶上台", result: "點數最高的 3 隊上台" });
    expect(result(2, [9, 7, 5, 3, 1])).toMatchObject({ result: "點數最高的 2 隊上台" });
    expect(result(3, [9, 7, 5, 3, 1])).toMatchObject({ result: "點數最高的上台" });
    // The 3s are fourth and fifth: nobody rerolls.
    expect(result(1, [9, 8, 7, 3, 3])).toMatchObject({ result: "點數最高的 3 隊上台" });
    expect(result(1, [9, 8, 5, 5, 1])).toMatchObject({ result: "同點的重擲！" });
    expect(result(1, [9, 8, 5, 5])).toMatchObject({ result: "甲隊 9、乙隊 8、丙隊 5、丁隊 5，同點的重擲" });
    expect(result(1, [9, 8, 7, 3])).toMatchObject({ result: "甲隊 9、乙隊 8、丙隊 7、丁隊 3" });
  });

  it("a four-team list promises no reroll for a tie below the podium", () => {
    const t = teams(["甲", 9], ["乙", 5], ["丙", 5], ["丁", 5], ["戊", 5]);
    const roll = revealBeats(t, ["甲", "乙", "丙", "丁", "戊"], [{ from: 2, teams: ["乙", "丙", "丁", "戊"], values: [9, 8, 3, 3] }]).find((b) => b.kind === "roll");
    expect(roll).toMatchObject({ result: "乙隊 9、丙隊 8、丁隊 3、戊隊 3" });
  });

  it("uses the narration's lines in order and scripts only the missing ones", () => {
    const t = teams(["甲", 40, 1], ["乙", 30]);
    expect(lines(revealBeats(t, ["甲", "乙"], [], ["甲的二十閃閃發光！", "乙穩穩拿下第二！"]))).toEqual([
      "甲的二十閃閃發光！",
      "乙穩穩拿下第二！",
      "第一名是……甲隊！",
    ]);
  });
});

// Value: protects=one clock for screen and phone: the beat on show at t, first place's result, then the story; the phone
// lags so it never spoils (D9, D20, D23); fails_when=a beat boundary is off by one, the result comes before first place,
// or the lag is dropped; why_new=new; seam=none; no_claim=the network delay itself (unit only)
describe("revealAt", () => {
  const beats = revealBeats(teams(["甲", 40], ["乙", 30], ["丙", 20]), ["甲", "乙", "丙"], []);

  it("walks the beats on their durations, the result at first place, done after it", () => {
    expect(beats.map(beatMs)).toEqual([3500, 3500, 4000]);
    expect(revealAt(beats, -1)).toEqual({ beat: -1, result: false, done: false });
    expect(revealAt(beats, 0)).toEqual({ beat: 0, result: false, done: false });
    expect(revealAt(beats, 3499).beat).toBe(0);
    expect(revealAt(beats, 3500).beat).toBe(1);
    expect(revealAt(beats, 6999)).toEqual({ beat: 1, result: false, done: false });
    expect(revealAt(beats, 7000)).toEqual({ beat: 2, result: true, done: false });
    expect(revealAt(beats, 11000)).toEqual({ beat: 2, result: true, done: true });
    expect(revealMarks(beats)).toEqual([0, 3500, 7000, 11000]);
  });

  it("a phone a second behind is still waiting when the screen shows first place", () => {
    expect(revealAt(beats, 7000 - PHONE_LAG_MS).result).toBe(false);
    expect(revealAt(beats, 7000 + PHONE_LAG_MS - PHONE_LAG_MS).result).toBe(true);
  });

  it("no teams: done at once", () => {
    expect(revealAt([], 0)).toEqual({ beat: -1, result: true, done: true });
  });
});

// Regression: a long epilogue grew the narrator box over the podium's 2nd and 3rd places (/qa on production, 2026-11-08).
describe("epiloguePages", () => {
  it("keeps an epilogue that fits three rows as one page (the scripted one)", () => {
    const text = "貓頭鷹魔法師闔上書：盜賊隊以 190 飽足感成為傳說，戰士隊 189 飽足感、牧師隊 180 飽足感緊追在後。盜賊隊吃了焗烤蝸牛、清蒸鐵殼蟹、骷髏大骨湯，最飽。";
    expect(epiloguePages(text)).toEqual([text]);
  });
  it("splits a long one between sentences, every page within three rows, nothing lost", () => {
    const a = "甲".repeat(60) + "。";
    const b = "乙".repeat(60) + "！";
    const c = "丙".repeat(30) + "。";
    expect(epiloguePages(a + b + c)).toEqual([a, b + c]);
  });
  it("cuts a sentence longer than a page, and the longest epilogue is at most two pages", () => {
    const long = "字".repeat(MAX_EPILOGUE_LINE);
    const pages = epiloguePages(long);
    expect(pages.join("")).toBe(long);
    expect(pages.length).toBe(2);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(EPILOGUE_PAGE_CHARS);
  });
});
