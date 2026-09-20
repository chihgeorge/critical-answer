import { describe, it, expect } from "vitest";
import { createRunner, type TranscriptEntry } from "./runner";
import type { NarrationProvider } from "./scripted";
import type { NarrationEvent } from "./events";

const event: NarrationEvent = { type: "retry", team: "紅隊", monster: "史萊姆" };
const fallback = { line: () => "備用旁白" };
const provider = (narrate: NarrationProvider["narrate"], name = "fake"): NarrationProvider => ({ name, narrate });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(p: NarrationProvider, holdMs = 30) {
  const emitted: { eventId: number; line: string; provider: string }[] = [];
  const entries: TranscriptEntry[] = [];
  const runner = createRunner({
    provider: p,
    fallback,
    holdMs,
    emit: (eventId, line, providerName) => emitted.push({ eventId, line, provider: providerName }),
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
    ["over 40 characters", "字".repeat(41)],
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
});
