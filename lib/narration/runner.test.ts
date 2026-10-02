import { describe, it, expect, vi } from "vitest";
import { createRunner, targetSegmentCount, type TranscriptEntry } from "./runner";
import { AuthError, InvalidOutputError } from "./errors";
import type { NarrationProvider } from "./scripted";
import type { NarrationEvent } from "./events";

// No `next`: targetSegmentCount is 2 (result + atmosphere), same as any routine no-next event.
const event: NarrationEvent = { type: "retry", team: "紅隊", monster: "史萊姆" };
const fallback = { line: () => "備用旁白", atmosphereLine: () => "備用氣氛", nextLine: () => "備用下一句" };
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
  it("is 3 for an event with a next team, 2 without, 1 for epilogue", () => {
    expect(targetSegmentCount({ type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next: { team: "藍隊", monster: "幽靈", boss: false } })).toBe(3);
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
    const auth = setup(provider(async () => { throw new AuthError(401); }));
    await auth.runner.run(1, event);
    expect(auth.entries[0].fallbackReason).toBe("auth");
    const bad = setup(provider(async () => { throw new InvalidOutputError("markup"); }));
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

  describe("events with a next team (3 segments: result, atmosphere, transition)", () => {
    const withNext: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next: { team: "藍隊", monster: "害羞幽靈", boss: false } };

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

    it("sends no transition segment when the event has no next team, even if the provider wrote three lines", async () => {
      const { runner, emitted } = setup(provider(async () => "藍隊擊倒了首領！\n塵埃落定\n多餘的第三行"));
      await runner.run(1, { type: "boss-kill", team: "藍隊", monster: "小黑龍", bonus: 9 });
      expect(emitted[0].lines).toEqual(["藍隊擊倒了首領！", "塵埃落定"]);
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
