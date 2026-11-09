import { describe, it, expect, vi } from "vitest";
import { createRunner, saysLine, targetSegmentCount, type TranscriptEntry } from "./runner";
import { NarrationError } from "./errors";
import type { NarrationProvider } from "./scripted";
import { epilogueParts, type NarrationEvent } from "./events";

// No `next`: targetSegmentCount is 2 (result + atmosphere), same as any routine no-next event.
const event: NarrationEvent = { type: "retry", team: "紅隊", monster: "史萊姆" };
const fallback = {
  line: () => "備用旁白",
  atmosphereLine: () => "備用氣氛",
  nextLine: () => "備用下一句",
  epilogueLines: (e: NarrationEvent) => (e.type === "epilogue" ? epilogueParts(e).map((p) => (p.kind === "story" ? "備用旁白" : p.kind === "title" ? "備用稱號" : `備用第${p.place}名`)) : []),
};
const provider = (narrate: NarrationProvider["narrate"], name = "fake"): NarrationProvider => ({ name, narrate });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(p: NarrationProvider, holdMs = 30, epilogueHoldMs = 60) {
  const emitted: { eventId: number; lines: string[] }[] = [];
  const entries: TranscriptEntry[] = [];
  const runner = createRunner({
    provider: p,
    fallback,
    holdMs,
    epilogueHoldMs,
    emit: (eventId, lines) => emitted.push({ eventId, lines }),
    record: (e) => entries.push(e),
  });
  return { runner, emitted, entries };
}

describe("targetSegmentCount", () => {
  const next = { team: "藍隊", monster: "幽靈", boss: false };
  it("is 2 for an ordinary turn with a next team (result + transition), 3 for a big moment, 2 without a next team, 1 for epilogue", () => {
    expect(targetSegmentCount({ type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next })).toBe(2);
    expect(targetSegmentCount({ type: "retry", team: "紅隊", monster: "史萊姆", next })).toBe(2);
    expect(targetSegmentCount({ type: "flee", team: "紅隊", monster: "史萊姆", next })).toBe(2);
    expect(targetSegmentCount({ type: "boss-hit", team: "紅隊", bossHp: 2, bossMaxHp: 5, next })).toBe(3);
    expect(targetSegmentCount({ type: "start", teams: ["紅隊"], next })).toBe(3);
    expect(targetSegmentCount({ type: "correct", team: "紅隊", monster: "史萊姆", points: 1, roll: { kind: "crit", value: 1 }, next })).toBe(3);
    expect(targetSegmentCount({ type: "retry", team: "紅隊", monster: "史萊姆", warriorRoll: 1, next })).toBe(3);
    expect(targetSegmentCount({ type: "retry", team: "紅隊", monster: "史萊姆", warriorRoll: 7, next })).toBe(2);
    expect(targetSegmentCount({ type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next, hostLine: "珍珠能吃嗎" })).toBe(3);
    expect(targetSegmentCount({ type: "correct", team: "紅隊", monster: "史萊姆", points: 2 })).toBe(2);
    expect(targetSegmentCount({ type: "boss-kill", team: "藍隊", monster: "小黑龍", bonus: 9 })).toBe(2);
    expect(targetSegmentCount({ type: "epilogue", ranking: [], winners: [] })).toBe(1);
  });
});

describe("narration runner", () => {
  it("uses the provider's result line, backed by the scripted atmosphere line for the segment it didn't write", async () => {
    const { runner, emitted, entries } = setup(provider(async () => "來自提供者"));
    await runner.run(1, event, { 紅隊: 3 });
    expect(emitted).toEqual([{ eventId: 1, lines: ["來自提供者", "備用氣氛"] }]);
    expect(entries[0]).toMatchObject({ eventId: 1, lines: ["來自提供者", "備用氣氛"], sources: ["fake", "scripted"], provider: "fake", event, scores: { 紅隊: 3 } });
    expect(entries[0].fallbackReason).toBeUndefined();
    expect(entries[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("uses both provider segments when it writes result + atmosphere", async () => {
    const { runner, emitted, entries } = setup(provider(async () => "來自提供者\n提供者寫的氣氛"));
    await runner.run(1, event);
    expect(emitted[0].lines).toEqual(["來自提供者", "提供者寫的氣氛"]);
    expect(entries[0].sources).toEqual(["fake", "fake"]);
  });

  it("falls back to the scripted lines when the provider is too slow, and sends only one message", async () => {
    const { runner, emitted, entries } = setup(provider(async () => (await sleep(120), "太晚了")));
    await runner.run(2, event);
    await sleep(150); // the late answer must not produce a second message
    expect(emitted).toEqual([{ eventId: 2, lines: ["備用旁白", "備用氣氛"] }]);
    expect(entries[0]).toMatchObject({ provider: "scripted", fallbackReason: "timeout" });
  });

  it("falls back when the provider throws", async () => {
    const { runner, emitted, entries } = setup(provider(async () => { throw new Error("boom"); }));
    await expect(runner.run(3, event)).resolves.toBeUndefined();
    expect(emitted[0].lines[0]).toBe("備用旁白");
    expect(entries[0].fallbackReason).toBe("error");
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["over the line ceiling", "字".repeat(51)],
    ["containing markup", "<b>粗體</b>"],
  ])("falls back when the first line is %s", async (_n, bad) => {
    const { runner, emitted, entries } = setup(provider(async () => bad));
    await runner.run(4, event);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].lines[0]).toBe("備用旁白");
    expect(entries[0].fallbackReason).toBe("invalid");
  });

  it("does not wait for the full hold when the provider is fast", async () => {
    const { runner } = setup(provider(async () => "快"), 5000);
    const t0 = Date.now();
    await runner.run(5, event);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("aborts the request when the hold runs out, so a slow call does not keep running", async () => {
    let signal: AbortSignal | undefined;
    const { runner } = setup(provider(async (_e, o) => { signal = o?.signal; await sleep(200); return "晚"; }));
    await runner.run(1, event);
    expect(signal?.aborted).toBe(true);
  });

  it("records the named failure reason from the provider's error", async () => {
    const auth = setup(provider(async () => { throw new NarrationError("auth", "x", 401); }));
    await auth.runner.run(1, event);
    expect(auth.entries[0].fallbackReason).toBe("auth");
    const bad = setup(provider(async () => { throw new NarrationError("invalid_output", "markup"); }));
    await bad.runner.run(1, event);
    expect(bad.entries[0].fallbackReason).toBe("invalid_output");
  });

  describe("epilogue", () => {
    const epi: NarrationEvent = { type: "epilogue", ranking: [{ name: "紅隊", score: 9 }], winners: ["紅隊"] };

    it("has exactly one segment, never an atmosphere line", async () => {
      const { runner, emitted } = setup(provider(async () => "後記"));
      await runner.run(9, epi);
      expect(emitted[0].lines).toEqual(["後記"]);
    });

    it("waits the longer epilogue hold instead of the per-event one", async () => {
      const { runner, emitted } = setup(provider(async () => (await sleep(45), "慢慢寫的後記")), 20, 200);
      await runner.run(9, epi);
      expect(emitted[0].lines).toEqual(["慢慢寫的後記"]);
    });

    it("accepts a line longer than 40 characters, up to 160", async () => {
      const long = "字".repeat(100);
      const ok = setup(provider(async () => long));
      await ok.runner.run(9, epi);
      expect(ok.emitted[0].lines).toEqual([long]);
      const tooLong = setup(provider(async () => "字".repeat(161)));
      await tooLong.runner.run(9, epi);
      expect(tooLong.emitted[0].lines).toEqual(["備用旁白"]);
      expect(tooLong.entries[0].fallbackReason).toBe("invalid");
    });
  });

  // Value: protects=the titles, the podium calls and the story come from one AI reply, each segment held to its own part:
  // a title 稱號｜理由 that says no place and no other team, a call at most 20 characters naming its team, the story up to
  // 160; a bad segment alone is scripted (eng D21, D9; podium-titles.md E1, R2-4); fails_when=a title spoils a place or
  // names a rival, a long or nameless call reaches the screen, a title line passes as the story, or one bad segment
  // throws the whole reply away; why_new=the titles replaced the crit king; seam=none; no_claim=what a real model writes
  describe("epilogue with titles and podium calls", () => {
    const facts = { turns: 5, dishes: 0, flees: 2, events: [], natural20s: 0, boss: false };
    const epi: NarrationEvent = {
      type: "epilogue",
      ranking: [{ name: "紅隊", score: 9 }, { name: "藍隊", score: 5 }, { name: "隔壁老王", score: 3 }, { name: "老王", score: 1 }],
      winners: ["紅隊"],
      calls: [{ place: 2, team: "藍隊" }, { place: 1, team: "紅隊" }],
      titles: [{ team: "隔壁老王", facts }, { team: "老王", facts }],
    };
    const story = "字".repeat(30);

    it("asks for one segment per title and call plus the story", () => {
      expect(targetSegmentCount(epi)).toBe(5);
    });

    it("keeps every segment that fits its part", async () => {
      const { runner, emitted } = setup(provider(async () => `閃避專家｜逃了兩次還在笑\n跑跑王|老王就是跑得快\n第二名，藍隊！\n冠軍是紅隊！\n${"字".repeat(120)}`));
      await runner.run(9, epi);
      expect(emitted[0].lines).toEqual(["閃避專家｜逃了兩次還在笑", "跑跑王|老王就是跑得快", "第二名，藍隊！", "冠軍是紅隊！", "字".repeat(120)]);
    });

    it("scripts a title that hints at a place or a score, names another team, or does not split", async () => {
      const run = async (title: string) => {
        const { runner, emitted } = setup(provider(async () => `${title}\n跑跑王｜跑得快\n第二名，藍隊！\n冠軍是紅隊！\n${story}`));
        await runner.run(9, epi);
        return emitted[0].lines[0];
      };
      for (const bad of ["墊底專家｜逃了兩次", "閃避專家｜差點就贏了", "第三名候選｜逃了兩次", "全場第一吃貨｜逃了兩次", "亞軍預定｜逃了兩次", "閃避專家｜飽足感最高", "No.1 跑者｜逃了兩次", "吊車尾｜逃了兩次", "閃避專家｜比紅隊還會跑", "閃避專家，逃了兩次", "閃避專家｜", "十一個字的超長稱號啊啊｜逃了兩次"]) {
        expect(await run(bad)).toBe("備用稱號");
      }
      // 老王 is inside 隔壁老王's own name: saying it names nobody else.
      expect(await run("老王的鄰居｜逃了兩次")).toBe("老王的鄰居｜逃了兩次");
      // 老王's title must not name 隔壁老王.
      const { runner, emitted } = setup(provider(async () => `閃避專家｜逃了兩次\n隔壁老王的影子｜跑得快\n第二名，藍隊！\n冠軍是紅隊！\n${story}`));
      await runner.run(9, epi);
      expect(emitted[0].lines[1]).toBe("備用稱號");
    });

    it("scripts only the call that is too long, misses a name or names a team called after it", async () => {
      const { runner, emitted, entries } = setup(provider(async () => `閃避專家｜逃了兩次\n跑跑王｜跑得快\n藍隊第二，紅隊奪冠！\n冠軍是紅隊！\n${story}`));
      await runner.run(9, epi);
      expect(emitted[0].lines).toEqual(["閃避專家｜逃了兩次", "跑跑王｜跑得快", "備用第2名", "冠軍是紅隊！", story]);
      expect(entries[0].sources).toEqual(["fake", "fake", "scripted", "fake", "fake"]);
      const long = setup(provider(async () => `閃避專家｜逃了兩次\n跑跑王｜跑得快\n第二名是藍隊，他們今晚真的非常非常非常努力！\n第一名：紅 隊！\n${story}`));
      await long.runner.run(9, epi);
      expect(long.emitted[0].lines.slice(2, 4)).toEqual(["備用第2名", "第一名：紅 隊！"]);
    });

    it("a call or story with a bar, or a story no longer than a title line, is scripted", async () => {
      const { runner, emitted } = setup(provider(async () => `閃避專家｜逃了兩次\n跑跑王｜跑得快\n第二名｜藍隊！\n冠軍是紅隊！\n${"字".repeat(27)}`));
      await runner.run(9, epi);
      expect(emitted[0].lines.slice(2)).toEqual(["備用第2名", "冠軍是紅隊！", "備用旁白"]);
      const piped = setup(provider(async () => `閃避專家｜逃了兩次\n跑跑王｜跑得快\n第二名，藍隊！\n冠軍是紅隊！\n${"字".repeat(20)}｜${"字".repeat(20)}`));
      await piped.runner.run(9, epi);
      expect(piped.emitted[0].lines[4]).toBe("備用旁白");
    });

    it("a story over several lines is joined, and the segments before it stand", async () => {
      const { runner, emitted, entries } = setup(provider(async () => `閃避專家｜逃了兩次\n跑跑王｜跑得快\n第二名：藍隊！\n紅隊奪冠！\n${"甲".repeat(25)}\n${"乙".repeat(25)}`));
      await runner.run(9, epi);
      expect(emitted[0].lines).toEqual(["閃避專家｜逃了兩次", "跑跑王｜跑得快", "第二名：藍隊！", "紅隊奪冠！", "甲".repeat(25) + "乙".repeat(25)]);
      expect(entries[0].sources).toEqual(["fake", "fake", "fake", "fake", "fake"]);
    });

    // Value: protects=a reply a line short or long cannot put titles or calls in the wrong beats, nor a title where the
    // story goes (/review D25-4, R2-4); fails_when=segments are matched by position again, or the story takes a title line.
    it("a reply a line short or long scripts every title and call; a short one keeps its last line only if it reads as a story", async () => {
      const short = setup(provider(async () => `閃避專家｜逃了兩次\n第二名：藍隊！\n紅隊奪冠！\n${story}`));
      await short.runner.run(9, epi);
      expect(short.emitted[0].lines).toEqual(["備用稱號", "備用稱號", "備用第2名", "備用第1名", story]);
      const titleLast = setup(provider(async () => `第二名：藍隊！\n紅隊奪冠！\n閃避專家｜逃了兩次還在笑啦`));
      await titleLast.runner.run(9, epi);
      expect(titleLast.emitted[0].lines[4]).toBe("備用旁白");
      const long = setup(provider(async () => `頒獎時間！\n閃避專家｜逃了兩次\n跑跑王｜跑得快\n第二名：藍隊！\n紅隊奪冠！\n${story}`));
      await long.runner.run(9, epi);
      expect(long.emitted[0].lines).toEqual(["備用稱號", "備用稱號", "備用第2名", "備用第1名", "備用旁白"]); // its last line may be a fragment
    });

    it("with the AI off or failing, every segment is scripted", async () => {
      const { runner, emitted } = setup(provider(async () => {
        throw new NarrationError("upstream", "down");
      }));
      await runner.run(9, epi);
      expect(emitted[0].lines).toEqual(["備用稱號", "備用稱號", "備用第2名", "備用第1名", "備用旁白"]);
    });
  });

  describe("big moments with a next team (3 segments: result, atmosphere, transition)", () => {
    const withNext: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 3, roll: { kind: "crit", value: 20 }, next: { team: "藍隊", monster: "害羞幽靈", boss: false } };

    it("uses all three provider segments when it writes all three", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！\n塵埃落定\n輪到藍隊，害羞幽靈在等你們。"));
      await runner.run(1, withNext);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "塵埃落定", "輪到藍隊，害羞幽靈在等你們。"]);
      expect(entries[0].sources).toEqual(["fake", "fake", "fake"]);
    });

    it("writes the atmosphere and transition itself when the provider gave only the result line", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！"));
      await runner.run(1, withNext);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "備用氣氛", "備用下一句"]);
      expect(entries[0].sources).toEqual(["fake", "scripted", "scripted"]);
    });

    it("writes only the transition itself when the provider gave result + atmosphere", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！\n塵埃落定"));
      await runner.run(1, withNext);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "塵埃落定", "備用下一句"]);
      expect(entries[0].sources).toEqual(["fake", "fake", "scripted"]);
    });

    it("replaces an invalid transition segment (too long, markup) with the scripted one but keeps the good earlier segments", async () => {
      const { runner, emitted } = setup(provider(async () => "紅隊答對了！\n塵埃落定\n" + "字".repeat(60)));
      await runner.run(1, withNext);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "塵埃落定", "備用下一句"]);
      const markup = setup(provider(async () => "紅隊答對了！\n塵埃落定\n<b>輪到</b>"));
      await markup.runner.run(1, withNext);
      expect(markup.emitted[0].lines).toEqual(["紅隊答對了！", "塵埃落定", "備用下一句"]);
    });

    it("falls back only the interior (atmosphere) segment when it is invalid but the trailing transition segment is valid", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！\n<b>壞掉的氣氛</b>\n輪到藍隊，害羞幽靈在等你們。"));
      await runner.run(1, withNext);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "備用氣氛", "輪到藍隊，害羞幽靈在等你們。"]);
      expect(entries[0].sources).toEqual(["fake", "scripted", "fake"]);
    });

    it("uses all scripted segments when the provider fails or is too slow", async () => {
      const slow = setup(provider(async () => (await sleep(120), "晚")));
      await slow.runner.run(1, withNext);
      expect(slow.emitted[0].lines).toEqual(["備用旁白", "備用氣氛", "備用下一句"]);
      expect(slow.entries[0].provider).toBe("scripted");
    });

    it("an ordinary turn is the result and the transition, with no atmosphere line between them", async () => {
      const plain: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next: { team: "藍隊", monster: "害羞幽靈", boss: false } };
      const both = setup(provider(async () => "紅隊答對了！\n輪到藍隊，害羞幽靈在等你們。"));
      await both.runner.run(1, plain);
      expect(both.emitted[0].lines).toEqual(["紅隊答對了！", "輪到藍隊，害羞幽靈在等你們。"]);
      const one = setup(provider(async () => "紅隊答對了！"));
      await one.runner.run(1, plain);
      expect(one.emitted[0].lines).toEqual(["紅隊答對了！", "備用下一句"]);
      // Three lines for a two-line turn: the last one is the handoff, so the atmosphere never takes its slot.
      const three = setup(provider(async () => "紅隊答對了！\n塵埃落定\n輪到藍隊。"));
      await three.runner.run(1, plain);
      expect(three.emitted[0].lines).toEqual(["紅隊答對了！", "輪到藍隊。"]);
    });

    it("two lines on a three-line turn: the handoff stays last and the scripted atmosphere fills the middle, so the team is called once", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！\n輪到藍隊，害羞幽靈在等你們。"));
      await runner.run(1, withNext);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "備用氣氛", "輪到藍隊，害羞幽靈在等你們。"]);
      expect(entries[0].sources).toEqual(["fake", "scripted", "fake"]);
    });

    it("three lines on a two-line turn with the handoff in the middle: the handoff is kept, the atmosphere dropped", async () => {
      const plain: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next: { team: "藍隊", monster: "害羞幽靈", boss: false } };
      const { runner, emitted } = setup(provider(async () => "紅隊答對了！\n輪到藍隊了。\n塵埃落定"));
      await runner.run(1, plain);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "輪到藍隊了。"]);
    });

    it("a reply a line short or long that names no next team gets the scripted handoff", async () => {
      const plain: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next: { team: "藍隊", monster: "害羞幽靈", boss: false } };
      const long = setup(provider(async () => "紅隊答對了！\n塵埃落定\n風停了"));
      await long.runner.run(1, plain);
      expect(long.emitted[0].lines).toEqual(["紅隊答對了！", "備用下一句"]);
      const short = setup(provider(async () => "紅隊答對了！\n塵埃落定"));
      await short.runner.run(1, withNext);
      expect(short.emitted[0].lines).toEqual(["紅隊答對了！", "塵埃落定", "備用下一句"]);
    });

    it("uses the model's later lines when only its first line was marked unusable", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "<invalid/>\n塵埃落定\n輪到藍隊了。"));
      await runner.run(1, withNext);
      expect(emitted[0].lines).toEqual(["備用旁白", "塵埃落定", "輪到藍隊了。"]);
      expect(entries[0]).toMatchObject({ sources: ["scripted", "fake", "fake"], provider: "fake" });
    });

    it("sends no transition segment when the event has no next team, even if the provider wrote three lines", async () => {
      const { runner, emitted } = setup(provider(async () => "藍隊擊倒了首領！\n塵埃落定\n多餘的第三行"));
      await runner.run(1, { type: "boss-kill", team: "藍隊", monster: "小黑龍", bonus: 9 });
      expect(emitted[0].lines).toEqual(["藍隊擊倒了首領！", "塵埃落定"]);
    });
  });

  // Value: protects=the host's queued line is in segment 2 exactly once and lines 1 and 3 survive (host-next-line.md D9);
  // fails_when=the check accepts the line in another segment, misses width/punctuation variants, or appends instead of overwriting.
  describe("host line (segment 2)", () => {
    const queued: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next: { team: "藍隊", monster: "害羞幽靈", boss: false }, hostLine: "珍珠能吃嗎?" };

    it("keeps the provider's segment 2 when it says the line, even with other punctuation or full-width marks", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！\n有人問：「珍珠能吃嗎？」\n輪到藍隊"));
      await runner.run(1, queued);
      expect(emitted[0].lines).toEqual(["紅隊答對了！", "有人問：「珍珠能吃嗎？」", "輪到藍隊"]);
      expect(entries[0].sources).toEqual(["fake", "fake", "fake"]);
    });

    it("overwrites segment 2 when the provider paraphrased it there or put it in another line, and leaves lines 1 and 3 alone", async () => {
      for (const reply of ["紅隊答對了！\n珍珠到底能不能吃\n輪到藍隊", "珍珠能吃嗎？紅隊答對了\n塵埃落定\n輪到藍隊"]) {
        const { runner, emitted, entries } = setup(provider(async () => reply));
        await runner.run(1, queued);
        const [first, , third] = reply.split("\n");
        expect(emitted[0].lines).toEqual([first, "珍珠能吃嗎?", third]);
        expect(entries[0].sources[1]).toBe("host");
      }
    });

    it("says it in segment 2 when the provider fails, and on a two-segment event", async () => {
      const { runner, emitted } = setup(provider(async () => { throw new NarrationError("upstream", "down"); }));
      await runner.run(1, { ...event, hostLine: "珍珠能吃嗎?" });
      expect(emitted[0].lines).toEqual(["備用旁白", "珍珠能吃嗎?"]);
    });

    it("matches across NFKC width, spacing and punctuation, never on an empty line", () => {
      expect(saysLine("ＡＢＣ ， 珍珠 能吃嗎！", "ABC珍珠能吃嗎?")).toBe(true);
      expect(saysLine("珍珠能吃", "珍珠能吃嗎")).toBe(false);
      expect(saysLine("任何話", "？！")).toBe(false);
    });
  });

  describe("default hold", () => {
    it("waits up to 3 seconds for the provider by default (real games saw 1.8-1.9 s answers and 3 of 21 timeouts at 2 s)", async () => {
      vi.useFakeTimers();
      try {
        const emitted: string[][] = [];
        const runner = createRunner({
          provider: provider(async () => (await new Promise((r) => setTimeout(r, 2600)), "兩點六秒才到")),
          fallback,
          emit: (_id, lines) => emitted.push(lines),
          record: () => {},
        });
        const run = runner.run(1, event);
        await vi.advanceTimersByTimeAsync(2700);
        await run;
        expect(emitted).toEqual([["兩點六秒才到", "備用氣氛"]]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("still falls back once the 3 seconds are used up", async () => {
      vi.useFakeTimers();
      try {
        const emitted: string[][] = [];
        const runner = createRunner({
          provider: provider(async () => (await new Promise((r) => setTimeout(r, 3500)), "太慢")),
          fallback,
          emit: (_id, lines) => emitted.push(lines),
          record: () => {},
        });
        const run = runner.run(1, event);
        await vi.advanceTimersByTimeAsync(3100);
        await run;
        expect(emitted).toEqual([["備用旁白", "備用氣氛"]]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
