import { afterEach, describe, expect, it, vi } from "vitest";
import { createBgmPlayer, layerGains, type Layer, type MixState } from "./bgm-player";
import { BOSS_RAGE_THEME, DUNGEON_THEME } from "./bgm";
import { ANSWER_TICK, ANSWER_TIME_UP, BOSS_ALARM, EAT_DONE, HEARTBEAT, SFX, SPRINT_FANFARE, type SfxNote } from "./sfx";

interface FakeNode {
  gain: { value: number; target: number };
  dest: unknown;
  connected: boolean;
}

/** Just enough of an AudioContext: records the graph and the notes scheduled (with where each one goes), and lets a
 * test decide when resume() settles. */
class FakeAudioContext {
  static all: FakeAudioContext[] = [];
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "suspended";
  onstatechange: (() => void) | null = null;
  notes: { at: number; dest: unknown }[] = [];
  destination = { name: "speakers" };
  gains: FakeNode[] = [];
  constructor() {
    FakeAudioContext.all.push(this);
  }
  waiting: (() => void)[] = [];
  /** Settles every pending resume(); a resume() on a running context settles at once. */
  release() {
    this.state = "running";
    this.onstatechange?.();
    for (const r of this.waiting.splice(0)) r();
  }
  /** The next resume() is refused, like a browser that did not count the event as a user gesture. */
  refuseNext = false;
  resume() {
    if (this.refuseNext) {
      this.refuseNext = false;
      return Promise.reject(new Error("not allowed"));
    }
    if (this.state === "running") return Promise.resolve();
    return new Promise<void>((r) => this.waiting.push(r));
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  createGain() {
    const param = {
      value: 0,
      target: -1,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      setTargetAtTime(v: number) {
        this.target = v;
      },
    };
    const node: FakeNode & { connect(d: unknown): unknown; disconnect(): void } = {
      gain: param,
      dest: null,
      connected: false,
      connect(d: unknown) {
        node.dest = d;
        node.connected = true;
        return d;
      },
      disconnect() {
        node.connected = false;
      },
    };
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const freq = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    let dest: unknown = null;
    return {
      type: "",
      frequency: freq,
      // osc.connect(env) returns env; env.connect(dest) records where the note ends up.
      connect: (env: FakeNode) => {
        return { connect: (d: unknown) => ((dest = d), d), gain: env.gain };
      },
      start: (at: number) => this.notes.push({ at, get dest() { return dest; } }),
      stop() {},
    };
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeAudioContext.all = [];
});

function setup(onState?: () => void) {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return createBgmPlayer(onState);
}

/** gains[0] is master, then the four layers in order, then the cue bus. */
const LAYER_INDEX: Record<Layer, number> = { music: 1, boss: 2, host: 3, ambient: 4 };
const layerNode = (ctx: FakeAudioContext, l: Layer) => ctx.gains[LAYER_INDEX[l]];
const cueBus = (ctx: FakeAudioContext) => ctx.gains[5];

async function started() {
  const bgm = setup();
  const a = bgm.start();
  const [ctx] = FakeAudioContext.all;
  ctx.release();
  await a;
  return { bgm, ctx };
}

describe("layerGains: the 聲音分層表", () => {
  const base: MixState = { bgmOn: true, videoPlaying: false, held: false, speaking: false };
  const rows: [string, Partial<MixState>, Record<Layer, "full" | "ducked" | 0>][] = [
    ["normal", {}, { music: "full", boss: "full", host: "full", ambient: "full" }],
    ["video playing", { videoPlaying: true }, { music: 0, boss: 0, host: 0, ambient: 0 }],
    ["held after a buzz / host plays the song", { held: true }, { music: 0, boss: 0, host: "full", ambient: 0 }],
    ["narration speaking", { speaking: true }, { music: "ducked", boss: "full", host: "full", ambient: "ducked" }],
    ["🎵 off", { bgmOn: false }, { music: 0, boss: 0, host: "full", ambient: 0 }],
    ["🎵 off while speaking", { bgmOn: false, speaking: true }, { music: 0, boss: 0, host: "full", ambient: 0 }],
    ["video and narration", { videoPlaying: true, speaking: true }, { music: 0, boss: 0, host: 0, ambient: 0 }],
  ];
  const full = layerGains(base);
  const ducked = layerGains({ ...base, speaking: true });
  it.each(rows)("%s", (_, state, want) => {
    const got = layerGains({ ...base, ...state });
    for (const l of Object.keys(want) as Layer[]) {
      const w = want[l];
      expect(got[l], l).toBe(w === 0 ? 0 : w === "full" ? full[l] : ducked[l]);
    }
  });
  it("ducking lowers the music and ambience but never to silence, and leaves the boss and host layers alone", () => {
    expect(ducked.music).toBeGreaterThan(0);
    expect(ducked.music).toBeLessThan(full.music);
    expect(ducked.ambient).toBeGreaterThan(0);
    expect(ducked.ambient).toBeLessThan(full.ambient);
    expect(ducked.boss).toBe(full.boss);
    expect(ducked.host).toBe(full.host);
  });
});

describe("createBgmPlayer", () => {
  it("mute(), hold() and duck() drive the music layer from the table, without closing anything", async () => {
    const { bgm, ctx } = await started();
    const music = layerNode(ctx, "music").gain;
    expect(music.target).toBe(0.05);
    bgm.mute(true);
    expect(music.target).toBe(0);
    bgm.duck(true);
    expect(music.target).toBe(0);
    expect(ctx.state).toBe("running");
    expect(vi.getTimerCount()).toBe(1);
    bgm.mute(false);
    expect(music.target).toBe(0.015);
    bgm.hold(true);
    expect(music.target).toBe(0);
    bgm.hold(false);
    bgm.duck(false);
    expect(music.target).toBe(0.05);
    expect(FakeAudioContext.all).toHaveLength(1);
    bgm.stop();
  });

  it("every layer feeds the master, and the master feeds the speakers", async () => {
    const { ctx } = await started();
    const master = ctx.gains[0];
    expect(master.dest).toBe(ctx.destination);
    for (const l of ["music", "boss", "host", "ambient"] as Layer[]) expect(layerNode(ctx, l).dest).toBe(master);
    expect(cueBus(ctx).dest).toBe(master);
  });

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

  it("🎵 off then on while resume() is pending starts exactly one scheduler, on the same context", async () => {
    const bgm = setup();
    const a = bgm.start();
    bgm.stop();
    const b = bgm.start();
    FakeAudioContext.all[0].release();
    await Promise.all([a, b]);
    expect(vi.getTimerCount()).toBe(1);
    expect(FakeAudioContext.all).toHaveLength(1);
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
    await b;
    expect(vi.getTimerCount()).toBe(1);
  });

  it("🎵 off keeps the context open, drops the queued music, and the host layer still plays", async () => {
    const { bgm, ctx } = await started();
    const song = ctx.gains[6];
    expect(song.connected).toBe(true);
    bgm.stop();
    expect(song.connected).toBe(false);
    expect(ctx.state).toBe("running");
    expect(layerNode(ctx, "music").gain.target).toBe(0);
    expect(layerNode(ctx, "boss").gain.target).toBe(0);
    ctx.notes = [];
    bgm.playCue(SFX.correct, "host");
    expect(ctx.notes.length).toBe(2);
    expect(ctx.notes.every((n) => n.dest === layerNode(ctx, "host"))).toBe(true);
    bgm.playCue(SFX.correct);
    expect(ctx.notes.length).toBe(2); // a game cue follows 🎵
  });

  it("close() closes the context", async () => {
    const { bgm, ctx } = await started();
    bgm.close();
    expect(ctx.state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unlock() wakes the context without starting the music, and reports the state change", async () => {
    const onState = vi.fn();
    const bgm = setup(onState);
    expect(bgm.running()).toBe(false);
    const a = bgm.unlock();
    FakeAudioContext.all[0].release();
    await a;
    expect(bgm.running()).toBe(true);
    expect(onState).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeAudioContext.all[0].notes).toHaveLength(0);
  });

  it("nothing plays before the context is awake", () => {
    const bgm = setup();
    void bgm.unlock();
    bgm.playCue(SFX.correct, "host");
    expect(FakeAudioContext.all[0].notes).toHaveLength(0);
  });

  it("a refused wake leaves 🎵 on, and the next successful unlock starts the music (never ready without music)", async () => {
    const bgm = setup();
    vi.stubGlobal(
      "AudioContext",
      class extends FakeAudioContext {
        refuseNext = true;
      },
    );
    await bgm.start();
    const [ctx] = FakeAudioContext.all;
    expect(vi.getTimerCount()).toBe(0);
    const a = bgm.unlock();
    ctx.release();
    await a;
    expect(bgm.running()).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("the host layer is at its volume as soon as the context exists, with 🎵 off", async () => {
    const bgm = setup();
    const a = bgm.unlock();
    const [ctx] = FakeAudioContext.all;
    ctx.release();
    await a;
    expect(layerNode(ctx, "host").gain.target).toBe(layerGains({ bgmOn: false, videoPlaying: false, held: false, speaking: false }).host);
    expect(layerNode(ctx, "host").gain.target).toBeGreaterThan(0);
  });

  const EXISTING: [string, SfxNote[]][] = [
    ...Object.entries(SFX),
    ["BOSS_ALARM", BOSS_ALARM],
    ["SPRINT_FANFARE", SPRINT_FANFARE],
    ["ANSWER_TICK", ANSWER_TICK],
    ["ANSWER_TIME_UP", ANSWER_TIME_UP],
    ["EAT_DONE", EAT_DONE],
  ];
  it.each(EXISTING)("game cue %s: plays with 🎵 on even under a video, a hold and the narration; silent with 🎵 off", async (_, notes) => {
    const { bgm, ctx } = await started();
    bgm.mute(true);
    bgm.hold(true);
    bgm.duck(true);
    ctx.notes = [];
    bgm.playCue(notes);
    expect(ctx.notes.length).toBe(notes.length);
    expect(ctx.notes.every((n) => n.dest === cueBus(ctx))).toBe(true);
    expect(cueBus(ctx).gain.value).toBeGreaterThan(0);
    bgm.stop();
    ctx.notes = [];
    bgm.playCue(notes);
    expect(ctx.notes).toHaveLength(0);
  });

  it("setSong() drops the old song's queued notes and starts the new one after the gap (rage, immersion.md ④)", async () => {
    const { bgm, ctx } = await started();
    const old = ctx.gains[6];
    ctx.currentTime = 10;
    ctx.notes = [];
    bgm.setSong(BOSS_RAGE_THEME, 0.5);
    expect(old.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(ctx.notes.every((n) => n.at >= 10.6)).toBe(true);
    // The same song again changes nothing: no new song generation, the playing one stays connected.
    const songs = () => ctx.gains.filter((g) => g.dest === layerNode(ctx, "music"));
    expect(songs()).toHaveLength(2);
    bgm.setSong(BOSS_RAGE_THEME, 0.5);
    expect(songs()).toHaveLength(2);
    expect(songs()[1].connected).toBe(true);
  });

  it("a song set while 🎵 is off is the one 🎵 starts, and switching while it plays keeps one loop", async () => {
    const bgm = setup();
    bgm.setSong(BOSS_RAGE_THEME);
    expect(vi.getTimerCount()).toBe(0);
    const a = bgm.start();
    FakeAudioContext.all[0].release();
    await a;
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(1);
    bgm.setSong(DUNGEON_THEME);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("pattern() queues the heartbeat on the boss layer, and its cancel silences the beats still ahead", async () => {
    const { bgm, ctx } = await started();
    ctx.notes = [];
    const cancel = bgm.pattern(HEARTBEAT, [0, 1, 2], "boss");
    expect(ctx.notes).toHaveLength(HEARTBEAT.length * 3);
    const beatGain = ctx.gains.at(-1 - HEARTBEAT.length * 3)!;
    expect(beatGain.dest).toBe(layerNode(ctx, "boss"));
    expect(ctx.notes.every((n) => n.dest === beatGain)).toBe(true);
    cancel();
    expect(beatGain.connected).toBe(false);
  });

  it("after the timer falls far behind (a background tab), only notes still ahead are scheduled", async () => {
    const { ctx } = await started();
    ctx.notes = [];
    ctx.currentTime = 30; // the tab was hidden for half a minute
    vi.advanceTimersByTime(100);
    expect(ctx.notes.length).toBeGreaterThan(0);
    expect(ctx.notes.every((n) => n.at >= 30)).toBe(true);
  });
});
