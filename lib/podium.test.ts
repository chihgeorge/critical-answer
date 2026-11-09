import { describe, expect, it } from "vitest";
import { EPILOGUE_PAGE_CHARS, MAX_AWARD_LINE, PHONE_LAG_MS, awardLine, awardTitles, beatMs, epiloguePages, parseTitle, rankTeams, revealAt, revealBeats, revealMarks, unemoji, type Beat, type TitleTeam } from "@/lib/podium";
import { MAX_EPILOGUE_LINE } from "@/lib/narration/runner";
import type { EventOutcome } from "@/lib/game-state";

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

// Value: protects=each data title goes to the best teams in team order, none for 0, ⚡ to the fewest earned turns
// (podium-titles.md); fails_when=a tie keeps one team, a zero count is awarded, ⚡ counts a host-sent or open-door
// entry, 凶 is not a curse, or a save without the counts throws; why_new=new; seam=none; no_claim=the screen (e2e)
describe("awardTitles", () => {
  const team = (id: string, more: Partial<TitleTeam> = {}): TitleTeam => ({ id, name: `${id}隊`, ...more });

  it("gives each title to every team tied on the best value, in team order, and none for a value of 0", () => {
    const awards = awardTitles([team("甲", { flees: 2 }), team("乙", { flees: 3, natural20s: 0 }), team("丙", { flees: 3 })]);
    expect(awards).toEqual([{ id: "flees", icon: "🏃", title: "逃跑大師", teamIds: ["乙", "丙"], reason: "逃跑 3 次" }]);
  });

  it("counts 凶 as a curse, a blessing only from an event room, and every event room for the explorer", () => {
    const awards = awardTitles([team("甲", { events: ["curse", "bad", "great"] }), team("乙", { events: ["blessing", "rotten"] })]);
    expect(awards.map((a) => [a.id, a.teamIds, a.reason])).toEqual([
      ["explorer", ["甲"], "開了 3 間神秘房"],
      ["blessing", ["乙"], "被祝福 1 次"],
      ["curse", ["甲"], "被詛咒 2 次"],
      ["rotten", ["乙"], "吃到 1 次腐肉"],
    ]);
  });

  it("⚡ goes to the fewest turns, only for a team that answered its way in", () => {
    const awards = awardTitles([
      team("甲", { bossAt: { turns: 5, earned: true } }),
      team("乙", { bossAt: { turns: 3, earned: true } }),
      // Sent by the host, through an open door or an event room: no earned, however quick.
      team("丙", { bossAt: { turns: 1 } }),
    ]);
    expect(awards).toEqual([{ id: "rush", icon: "⚡", title: "閃電突擊", teamIds: ["乙"], reason: "3 回合就進魔王房" }]);
    expect(awardTitles([team("甲", { bossAt: { turns: 2 } })])).toEqual([]);
  });

  it("a save with none of the counts awards nothing and throws nothing", () => {
    expect(awardTitles([team("甲"), team("乙")])).toEqual([]);
    expect(awardTitles([])).toEqual([]);
  });

  it("awards in the table's order, 🎲 last", () => {
    const all = team("甲", { events: ["blessing", "curse", "rotten"], flees: 1, potionsDrunk: 1, dishes: ["湯"], bossAt: { turns: 2, earned: true }, natural20s: 1 });
    expect(awardTitles([all]).map((a) => a.icon)).toEqual(["🗺️", "✨", "💀", "🤢", "🏃", "🧪", "🍲", "⚡", "🎲"]);
  });

  it("🧪 goes to the team that drank the most lucky potions; none drunk gives no title", () => {
    const awards = awardTitles([team("甲", { potionsDrunk: 2 }), team("乙", { potionsDrunk: 3 }), team("丙")]);
    expect(awards).toEqual([{ id: "potions", icon: "🧪", title: "藥水成癮", teamIds: ["乙"], reason: "喝了 3 瓶幸運藥水" }]);
    expect(awardTitles([team("甲", { potionsDrunk: 0 })])).toEqual([]);
  });
});

describe("awardLine, parseTitle and unemoji", () => {
  it("strips emoji and variation selectors before the voice reads a line", () => {
    expect(unemoji("🛡️堅持到最後的冒險者……甲隊！")).toBe("堅持到最後的冒險者……甲隊！");
    expect(unemoji("🎲大成功王……乙隊！")).toBe("大成功王……乙隊！");
    expect(unemoji("🗺️探險家……丙隊！")).toBe("探險家……丙隊！");
  });

  it("every title, a 20-character name and a 2-team tie all fit one row", () => {
    const long = "長".repeat(20);
    for (const icon of ["🗺️", "✨", "💀", "🤢", "🏃", "🍲", "⚡", "🎲", "🌟", "🛡️"]) {
      for (const title of ["女神的寵兒", "腐肉品嚐家", "堅持到最後的冒險者", "十個字的稱號十個字"]) {
        for (const names of [[long], [long, long], [long, "乙", "丙", "丁", "戊", "己", "庚", "辛"], ["甲"]]) {
          expect(awardLine(icon, title, names).length).toBeLessThanOrEqual(MAX_AWARD_LINE);
        }
      }
    }
    expect(awardLine("🏃", "逃跑大師", ["甲隊", "乙隊"])).toBe("🏃逃跑大師……甲隊、乙隊！");
    expect(awardLine("🏃", "逃跑大師", [long, long])).toMatch(/^🏃逃跑大師……長+等 2 隊！$/);
  });

  it("splits on a full- or half-width bar, and refuses an empty or too-long half", () => {
    expect(parseTitle("閃避專家｜逃了 3 次還在笑")).toEqual({ title: "閃避專家", reason: "逃了 3 次還在笑" });
    expect(parseTitle("閃避專家 | 逃了 3 次")).toEqual({ title: "閃避專家", reason: "逃了 3 次" });
    expect(parseTitle("閃避專家")).toBeNull();
    expect(parseTitle("｜逃了 3 次")).toBeNull();
    expect(parseTitle("閃避專家｜")).toBeNull();
    expect(parseTitle("一二三四五六七八九十一｜理由")).toBeNull();
    expect(parseTitle(`稱號｜${"字".repeat(17)}`)).toBeNull();
    expect(parseTitle("")).toBeNull();
    expect(parseTitle(undefined)).toBeNull();
  });
});

// Value: protects=the beat order the screen and phones share: the titles, then places lowest first, each roll just before
// the first place it decides, scripted lines where the narration gave none (D3, D10, D11, D14; podium-titles.md);
// fails_when=places are called highest first, a roll lands after its place, or fewer than 3 teams calls a missing place;
// why_new=new; seam=none; no_claim=what the screen draws per beat (screen tests, e2e)
describe("revealBeats", () => {
  // The place and roll beats; the titles are checked on their own below.
  const lines = (beats: Beat[]) => beats.flatMap((b) => (b.kind === "award" ? [] : [b.kind === "roll" ? `[${b.line}｜${b.result}]` : b.line]));

  it("hands out the data titles, then each untitled team's, then third, second and first", () => {
    const t = [...teams(["甲", 40, 1], ["乙", 30, 2], ["丙", 20]), { id: "丁", name: "丁隊", reward: 10, flees: 1, turns: 7 }];
    const beats = revealBeats(t, ["甲", "乙", "丙", "丁"], [], ["三", "二", "一"], ["閃避專家｜逃了也不怕", "壞掉"]);
    expect(beats.map((b) => b.line)).toEqual(["🏃逃跑大師……丁隊！", "🎲大成功王……乙隊！", "🌟閃避專家……甲隊！", "🛡️堅持到最後的冒險者……丙隊！", "三", "二", "一"]);
    expect(beats[0]).toMatchObject({ kind: "award", reason: "逃跑 1 次", teamIds: ["丁"] });
    expect(beats[2]).toMatchObject({ kind: "award", icon: "🌟", title: "閃避專家", reason: "逃了也不怕", teamIds: ["甲"] });
    expect(beats[3]).toMatchObject({ kind: "award", icon: "🛡️", reason: "撐了 0 回合" });
  });

  it("an empty, missing or bad title is the fallback, with the team's own turns", () => {
    const t = [{ id: "甲", name: "甲隊", reward: 9, turns: 4 }, { id: "乙", name: "乙隊", reward: 5, turns: 6 }];
    const beats = revealBeats(t, ["甲", "乙"], [], [], [""]);
    expect(beats.slice(0, 2)).toMatchObject([
      { kind: "award", icon: "🛡️", title: "堅持到最後的冒險者", reason: "撐了 4 回合", line: "🛡️堅持到最後的冒險者……甲隊！" },
      { kind: "award", icon: "🛡️", reason: "撐了 6 回合" },
    ]);
  });

  it("a save from before titles (the crit line first, no titles) puts each call on its own place", () => {
    const t = teams(["甲", 40, 1], ["乙", 30], ["丙", 20]);
    expect(lines(revealBeats(t, ["甲", "乙", "丙"], [], ["舊的大成功王", "三", "二", "一"]))).toEqual(["三", "二", "一"]);
  });

  it("8 teams at worst: every data title to one team, then 7 consolations, is 16 title beats before the places", () => {
    const ids = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"];
    const star = { id: "甲", name: "甲隊", reward: 1, events: ["blessing", "curse", "rotten"] as EventOutcome[], flees: 1, potionsDrunk: 1, dishes: ["湯"], bossAt: { turns: 2, earned: true as const }, natural20s: 1 };
    const t = [star, ...ids.slice(1).map((id) => ({ id, name: `${id}隊`, reward: 1 }))];
    const beats = revealBeats(t, ids, []);
    expect(beats.filter((b) => b.kind === "award")).toHaveLength(16);
    // 9 data titles (🧪 included) + 7 consolations, then the 3 places.
    expect(beats).toHaveLength(19);
    expect(revealMarks(beats).at(-1)).toBe(16 * 2500 + 3500 + 3500 + 4000);
  });

  it("calls third, second and first, nothing below third", () => {
    const t = teams(["甲", 40, 1], ["乙", 30, 2], ["丙", 20], ["丁", 10]);
    expect(lines(revealBeats(t, ["甲", "乙", "丙", "丁"], []))).toEqual([
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
    expect(beats.find((b) => b.kind === "roll")).toMatchObject({ kind: "roll", line: "第 1、2、3 名同分！擲 d20 比大小", result: "甲隊 9、乙隊 5、丙隊 5，同點的重擲" });
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
    const t = teams(["甲", 40], ["乙", 30], ["丙", 20]);
    expect(lines(revealBeats(t, ["甲", "乙", "丙"], [], ["丙穩穩站上第三！"]))).toEqual(["丙穩穩站上第三！", "第二名是……乙隊！", "第一名是……甲隊！"]);
  });
});

// Value: protects=one clock for screen and phone: the beat on show at t, first place's result, then the story; the phone
// lags so it never spoils (D9, D20, D23); fails_when=a beat boundary is off by one, the result comes before first place,
// or the lag is dropped; why_new=new; seam=none; no_claim=the network delay itself (unit only)
describe("revealAt", () => {
  const beats = revealBeats(teams(["甲", 40], ["乙", 30], ["丙", 20]), ["甲", "乙", "丙"], []).filter((b) => b.kind !== "award");

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
  it("drops a page that is only whitespace", () => {
    const a = "甲".repeat(EPILOGUE_PAGE_CHARS - 1) + "。";
    expect(epiloguePages(a + "\n ")).toEqual([a]);
  });
  it("never cuts an emoji in half", () => {
    const text = "字".repeat(EPILOGUE_PAGE_CHARS - 1) + "🍲🍲";
    expect(epiloguePages(text)).toEqual(["字".repeat(EPILOGUE_PAGE_CHARS - 1) + "🍲", "🍲"]);
  });
});
