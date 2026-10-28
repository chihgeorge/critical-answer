import { afterEach, describe, expect, it, vi } from "vitest";
import { createBgmPlayer } from "./bgm-player";

/** Just enough of an AudioContext: counts the notes scheduled, and lets a test decide when resume() settles. */
class FakeAudioContext {
  static all: FakeAudioContext[] = [];
  currentTime = 0;
  notes: number[] = [];
  closed = false;
  destination = {};
  release!: () => void;
  constructor() {
    FakeAudioContext.all.push(this);
  }
  resume() {
    return new Promise<void>((r) => (this.release = r));
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  createGain() {
    const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} };
    return { gain: param, connect: (d: unknown) => d };
  }
  createOscillator() {
    const freq = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { type: "", frequency: freq, connect: (d: unknown) => d, start: (at: number) => this.notes.push(at), stop() {} };
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeAudioContext.all = [];
});

function setup() {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return createBgmPlayer();
}

describe("createBgmPlayer", () => {
  it("a second 🎵 click while the first is still starting does not start a second loop", async () => {
    const bgm = setup();
    const a = bgm.start();
    const b = bgm.start();
    const [ctx] = FakeAudioContext.all;
    ctx.release();
    await Promise.all([a, b]);
    expect(vi.getTimerCount()).toBe(1);
    bgm.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() before resume() settles leaves nothing running and does not throw", async () => {
    const bgm = setup();
    const a = bgm.start();
    bgm.stop();
    FakeAudioContext.all[0].release();
    await expect(a).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    // And the 🎵 switch still works afterwards.
    const b = bgm.start();
    FakeAudioContext.all[1].release();
    await b;
    expect(vi.getTimerCount()).toBe(1);
  });

  it("after the timer falls far behind (a background tab), only notes still ahead are scheduled", async () => {
    const bgm = setup();
    const a = bgm.start();
    const [ctx] = FakeAudioContext.all;
    ctx.release();
    await a;
    ctx.notes = [];
    ctx.currentTime = 30; // the tab was hidden for half a minute
    vi.advanceTimersByTime(100);
    expect(ctx.notes.length).toBeGreaterThan(0);
    expect(ctx.notes.every((at) => at >= 30)).toBe(true);
  });
});
