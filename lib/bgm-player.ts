// Plays lib/bgm.ts's song on a loop with the Web Audio API (browser only: /screen imports it, and
// nothing here touches the question bank). A short lookahead scheduler queues each note on the
// AudioContext clock a little ahead of time, the standard way to get steady timing out of timers
// that themselves jitter.
//
// One AudioContext for the page's whole life, mixed in layers (docs/designs/immersion.md, 聲音分層表):
// master → speakers; the music, boss, host and ambient layers → master, each with its own volume from
// layerGains(); and the existing game cues on their own bus → master.

import { DUNGEON_THEME, loopDuration, songEvents, type Song } from "./bgm";
import type { SfxNote } from "./sfx";

const LOOKAHEAD_S = 0.25;
const TICK_MS = 100;
/** Quiet on purpose: this sits under the narration, not over it. */
const VOLUME = 0.05;
/** While the narration voice is speaking. */
const DUCKED_VOLUME = 0.015;
/** Effects sit above the music and aren't ducked: they're short and mark what just happened. */
const SFX_VOLUME = 0.09;
/** The boss layer (heartbeat, charge, parry, entrance rumble). One constant so the venue check can retune it in one line. */
const BOSS_VOLUME = 0.09;
/** The host's effects (thunder, growl). */
const HOST_VOLUME = 0.09;
/** Room ambience, under the music. */
const AMBIENT_VOLUME = 0.03;
const AMBIENT_DUCKED_VOLUME = 0.01;

/** The sound layers of the 聲音分層表. The existing game cues (SFX, BOSS_ALARM, …) are not a layer: they follow the
 * 🎵 switch only and are never silenced by a video, a buzz hold or the narration. */
export type Layer = "music" | "boss" | "host" | "ambient";

export interface MixState {
  /** The 🎵 switch. */
  bgmOn: boolean;
  /** A video or sound question is playing on this screen. */
  videoPlaying: boolean;
  /** Held after a buzz until the host judges it, or while the host plays the song from their own device. */
  held: boolean;
  /** The narration voice is talking. */
  speaking: boolean;
}

/** Each layer's volume, straight from the 聲音分層表. 🎵 off silences every layer but the host's. */
export function layerGains({ bgmOn, videoPlaying, held, speaking }: MixState): Record<Layer, number> {
  const quiet = !bgmOn || videoPlaying || held;
  return {
    music: quiet ? 0 : speaking ? DUCKED_VOLUME : VOLUME,
    boss: quiet ? 0 : BOSS_VOLUME,
    host: videoPlaying ? 0 : HOST_VOLUME,
    ambient: quiet ? 0 : speaking ? AMBIENT_DUCKED_VOLUME : AMBIENT_VOLUME,
  };
}

const LAYERS: Layer[] = ["music", "boss", "host", "ambient"];

export type BgmPlayer = ReturnType<typeof createBgmPlayer>;

/** `onState`: called whenever the AudioContext's state changes (it starts running, or the browser suspends it). */
export function createBgmPlayer(onState?: () => void) {
  let current: Song = DUNGEON_THEME;
  let events = songEvents(current);
  let loopLen = loopDuration(current);
  let ctx: AudioContext | null = null;
  let layers: Record<Layer, GainNode> | null = null;
  /** The existing game cues' bus, at a fixed volume. */
  let cues: GainNode | null = null;
  /** This start()'s music, under the music layer: disconnecting it drops the notes already queued ahead. */
  let song: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loopStart = 0;
  /** Index into `events` of the next note to queue, and how many loops have been queued. */
  let next = 0;
  let loops = 0;
  const mix: MixState = { bgmOn: false, videoPlaying: false, held: false, speaking: false };

  function gain(c: AudioContext, value: number, dest: AudioNode) {
    const node = c.createGain();
    node.gain.value = value;
    node.connect(dest);
    return node;
  }

  // shortcut: the host and ambient layers have no caller yet; the host's buttons (PR2) and the room ambience (PR3) play on them.
  function ensure(): AudioContext {
    if (ctx) return ctx;
    const c = new AudioContext();
    // The context can wake by any path (a later tap, the browser itself): the music follows.
    c.onstatechange = () => {
      play();
      onState?.();
    };
    const master = gain(c, 1, c.destination);
    layers = Object.fromEntries(LAYERS.map((l) => [l, gain(c, 0, master)])) as Record<Layer, GainNode>;
    cues = gain(c, SFX_VOLUME, master);
    ctx = c;
    apply();
    return c;
  }

  /** Wake the context. A refusal (no user gesture yet) is not an error: the next tap tries again. */
  async function wake(c: AudioContext) {
    try {
      await c.resume();
    } catch {
      // stays suspended
    }
  }

  /** Start the music loop if 🎵 is on, the context is awake and the loop is not already running, after `gapS` of silence. */
  function play(gapS = 0) {
    if (!mix.bgmOn || timer || !ctx || ctx.state !== "running") return;
    song = gain(ctx, 1, layers!.music);
    loopStart = ctx.currentTime + 0.1 + gapS;
    next = 0;
    loops = 0;
    schedule();
    timer = setInterval(schedule, TICK_MS);
  }

  /** One oscillator note with a short attack and release, so notes don't click. */
  function tone(dest: AudioNode, wave: OscillatorType, freq: number, at: number, end: number, peak: number, attack: number, slideTo?: number) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, end);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    env.gain.setValueAtTime(peak, Math.max(at + attack, end - 0.03));
    env.gain.linearRampToValueAtTime(0, end);
    osc.connect(env).connect(dest);
    osc.start(at);
    osc.stop(end + 0.01);
  }

  function schedule() {
    if (!ctx || !song) return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    for (;;) {
      const e = events[next];
      const at = loopStart + loops * loopLen + e.start;
      if (at > horizon) break;
      // A background tab's timer runs about once a second: drop the notes it fell behind on instead of
      // playing them all at once when the tab comes back.
      if (at < ctx.currentTime) {
        advance();
        continue;
      }
      // A gap before the next note keeps steps crisp.
      const end = at + Math.max(0.05, e.duration - 0.02);
      if (e.voice === "melody") tone(song, "square", e.freq, at, end, 0.5, 0.01);
      else if (e.voice === "drum") tone(song, "square", e.freq, at, at + 0.08, 0.7, 0.005, e.freq / 3);
      else tone(song, "triangle", e.freq, at, end, 0.9, 0.01);
      advance();
    }
  }

  function advance() {
    next++;
    if (next === events.length) {
      next = 0;
      loops++;
    }
  }

  function apply() {
    if (!ctx || !layers) return;
    const g = layerGains(mix);
    for (const l of LAYERS) layers[l].gain.setTargetAtTime(g[l], ctx.currentTime, 0.15);
  }

  function set(key: "videoPlaying" | "held" | "speaking", on: boolean) {
    if (mix[key] === on) return;
    mix[key] = on;
    apply();
  }

  /** Stop the loop and drop the notes it already queued ahead (they hang off `song`). */
  function halt() {
    if (timer) clearInterval(timer);
    timer = null;
    song?.disconnect();
    song = null;
  }

  function stop() {
    mix.bgmOn = false;
    halt();
    apply();
  }

  /** Queue `notes` at each offset (seconds from now) on its own gain under `layer`; the returned function silences
   * every note not yet played. */
  function pattern(notes: SfxNote[], offsets: number[], layer: Layer): () => void {
    if (!ctx || !layers || ctx.state !== "running") return () => {};
    const out = gain(ctx, 1, layers[layer]);
    const t0 = ctx.currentTime + 0.02;
    for (const at of offsets) for (const note of notes) tone(out, note.wave, note.freq, t0 + at + note.at, t0 + at + note.at + note.duration, 1, 0.005, note.slideTo);
    return () => out.disconnect();
  }

  return {
    /** Create and wake the AudioContext. Must run inside a user gesture (a click or a key press): browsers only let
     * audio start then. Starts the music only if 🎵 is already on. */
    async unlock() {
      await wake(ensure());
      play();
    },
    /** The AudioContext is awake: sound can play. */
    running(): boolean {
      return ctx?.state === "running";
    },
    /** Turn 🎵 on. Must first be called from inside a user gesture, like unlock(). A stop() while the context is
     * still waking wins: play() checks the switch again. */
    async start() {
      if (mix.bgmOn) return;
      mix.bgmOn = true;
      const c = ensure();
      apply();
      await wake(c);
      play();
    },
    /** Turn 🎵 off. The AudioContext stays open, so the host layer still sounds. */
    stop,
    /** Close the AudioContext for good: the page is going away. */
    close() {
      stop();
      void ctx?.close();
      ctx = null;
      layers = null;
      cues = null;
    },
    /** The narration voice is talking: the music and the ambience go quieter. */
    duck(on: boolean) {
      set("speaking", on);
    },
    /** A video plays on the big screen: the music goes silent but keeps its place (D10). */
    mute(on: boolean) {
      set("videoPlaying", on);
    },
    /** A buzz waits for the host's judgment, or the host plays the song from their own device (boss-music-buzzer.md M3, M4). */
    hold(on: boolean) {
      set("held", on);
    },
    /** Switch the music to `next` (the boss's rage theme and back, immersion.md ④), after `gapS` of silence. The notes
     * the old song already queued are dropped, so none sounds inside the gap. Remembered while 🎵 is off. */
    setSong(next: Song, gapS = 0) {
      if (next === current) return;
      current = next;
      events = songEvents(next);
      loopLen = loopDuration(next);
      const was = !!timer;
      halt();
      if (was) play(gapS);
    },
    /** ③ The heartbeat: `notes` at each offset on the boss layer. Call the result to cancel the beats still ahead. */
    pattern,
    /** Play a sound effect now (lib/sfx.ts). With no `layer` it is a game cue: it follows the 🎵 switch only. With a
     * layer, that layer's row of the 聲音分層表 sets its volume. Silent until the context is awake. */
    playCue(notes: SfxNote[], layer?: Layer) {
      if (!ctx || !layers || !cues || ctx.state !== "running") return;
      if (!layer && !mix.bgmOn) return;
      const dest = layer ? layers[layer] : cues;
      const t0 = ctx.currentTime + 0.02;
      for (const note of notes) {
        const at = t0 + note.at;
        tone(dest, note.wave, note.freq, at, at + note.duration, 1, 0.005, note.slideTo);
      }
    },
  };
}
