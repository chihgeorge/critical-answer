import { describe, it, expect } from "vitest";
import { createRunner, type TranscriptEntry } from "./runner";
import { AuthError, InvalidOutputError } from "./errors";
import type { NarrationProvider } from "./scripted";
import type { NarrationEvent } from "./events";

const event: NarrationEvent = { type: "retry", team: "紅隊", monster: "史萊姆" };
const fallback = { line: () => "備用旁白", nextLine: () => "備用下一句" };
const provider = (narrate: NarrationProvider["narrate"], name = "fake"): NarrationProvider => ({ name, narrate });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(p: NarrationProvider, holdMs = 30, epilogueHoldMs = 60) {
  const emitted: { eventId: number; line: string; provider: string; then?: string }[] = [];
  const entries: TranscriptEntry[] = [];
  const runner = createRunner({
    provider: p,
    fallback,
    holdMs,
    epilogueHoldMs,
    emit: (eventId, line, providerName, _event, then) => emitted.push({ eventId, line, provider: providerName, ...(then ? { then } : {}) }),
    record: (e) => entries.push(e),
  });
  return { runner, emitted, entries };
}

describe("narration runner", () => {
  it("uses the provider's line when it answers within the hold", async () => {
    const { runner, emitted, entries } = setup(provider(async () => "來自提供者"));
    await runner.run(1, event, { 紅隊: 3 });
    expect(emitted).toEqual([{ eventId: 1, line: "來自提供者", provider: "fake" }]);
    expect(entries[0]).toMatchObject({ eventId: 1, line: "來自提供者", provider: "fake", event, scores: { 紅隊: 3 } });
    expect(entries[0].fallbackReason).toBeUndefined();
    expect(entries[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the scripted line when the provider is too slow, and sends only one message", async () => {
    const { runner, emitted, entries } = setup(provider(async () => (await sleep(120), "太晚了")));
    await runner.run(2, event);
    await sleep(150); // the late answer must not produce a second message
    expect(emitted).toEqual([{ eventId: 2, line: "備用旁白", provider: "scripted" }]);
    expect(entries[0].fallbackReason).toBe("timeout");
  });

  it("falls back when the provider throws", async () => {
    const { runner, emitted, entries } = setup(provider(async () => { throw new Error("boom"); }));
    await expect(runner.run(3, event)).resolves.toBeUndefined();
    expect(emitted[0].line).toBe("備用旁白");
    expect(entries[0].fallbackReason).toBe("error");
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["over the line ceiling", "字".repeat(51)],
    ["containing markup", "<b>粗體</b>"],
  ])("falls back when the line is %s", async (_n, bad) => {
    const { runner, emitted, entries } = setup(provider(async () => bad));
    await runner.run(4, event);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].line).toBe("備用旁白");
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

    it("waits the longer epilogue hold instead of the per-event one", async () => {
      const { runner, emitted } = setup(provider(async () => (await sleep(45), "慢慢寫的後記")), 20, 200);
      await runner.run(9, epi);
      expect(emitted[0].line).toBe("慢慢寫的後記");
    });

    it("accepts a line longer than 40 characters, up to 160", async () => {
      const long = "字".repeat(100);
      const ok = setup(provider(async () => long));
      await ok.runner.run(9, epi);
      expect(ok.emitted[0].line).toBe(long);
      const tooLong = setup(provider(async () => "字".repeat(161)));
      await tooLong.runner.run(9, epi);
      expect(tooLong.emitted[0].line).toBe("備用旁白");
      expect(tooLong.entries[0].fallbackReason).toBe("invalid");
    });
  });

  describe("second line (the next-team prompt)", () => {
    const withNext: NarrationEvent = { type: "correct", team: "紅隊", monster: "史萊姆", points: 2, next: { team: "藍隊", monster: "害羞幽靈", boss: false } };

    it("splits a two-line answer into the result line and the follow-up", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！\n輪到藍隊，害羞幽靈在等你們。"));
      await runner.run(1, withNext);
      expect(emitted[0]).toEqual({ eventId: 1, line: "紅隊答對了！", provider: "fake", then: "輪到藍隊，害羞幽靈在等你們。" });
      expect(entries[0]).toMatchObject({ then: "輪到藍隊，害羞幽靈在等你們。", thenSource: "fake" });
    });

    it("writes the follow-up itself when the provider gave only one line", async () => {
      const { runner, emitted, entries } = setup(provider(async () => "紅隊答對了！"));
      await runner.run(1, withNext);
      expect(emitted[0]).toMatchObject({ line: "紅隊答對了！", then: "備用下一句" });
      expect(entries[0].thenSource).toBe("scripted");
    });

    it("replaces an invalid follow-up (too long, markup) with the scripted one but keeps the good result line", async () => {
      const { runner, emitted } = setup(provider(async () => "紅隊答對了！\n" + "字".repeat(60)));
      await runner.run(1, withNext);
      expect(emitted[0]).toMatchObject({ provider: "fake", line: "紅隊答對了！", then: "備用下一句" });
      const markup = setup(provider(async () => "紅隊答對了！\n<b>輪到</b>"));
      await markup.runner.run(1, withNext);
      expect(markup.emitted[0].then).toBe("備用下一句");
    });

    it("uses both scripted lines when the provider fails or is too slow", async () => {
      const slow = setup(provider(async () => (await sleep(120), "晚")));
      await slow.runner.run(1, withNext);
      expect(slow.emitted[0]).toMatchObject({ line: "備用旁白", provider: "scripted", then: "備用下一句" });
    });

    it("sends no follow-up when the event has no next team, even if the provider wrote two lines", async () => {
      const { runner, emitted } = setup(provider(async () => "藍隊擊倒了首領！\n多餘的第二行"));
      await runner.run(1, { type: "boss-kill", team: "藍隊", monster: "小黑龍", bonus: 9 });
      expect(emitted[0].then).toBeUndefined();
      expect(emitted[0].line).toBe("藍隊擊倒了首領！");
    });
  });
});
