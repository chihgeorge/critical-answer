// Plays lib/bgm.ts's song on a loop with the Web Audio API (browser only: /screen imports it, and
// nothing here touches the question bank). A short lookahead scheduler queues each note on the
// AudioContext clock a little ahead of time, the standard way to get steady timing out of timers
// that themselves jitter.

import { DUNGEON_THEME, loopDuration, songEvents } from "./bgm";
import type { SfxNote } from "./sfx";

const LOOKAHEAD_S = 0.25;
const TICK_MS = 100;
/** Quiet on purpose: this sits under the narration, not over it. */
const VOLUME = 0.05;
/** While the narration voice is speaking. */
const DUCKED_VOLUME = 0.015;
/** Effects sit above the music and aren't ducked: they're short and mark what just happened. */
const SFX_VOLUME = 0.09;

export type BgmPlayer = ReturnType<typeof createBgmPlayer>;

export function createBgmPlayer() {
  const events = songEvents(DUNGEON_THEME);
  const loopLen = loopDuration(DUNGEON_THEME);
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loopStart = 0;
  /** Index into `events` of the next note to queue, and how many loops have been queued. */
  let next = 0;
  let loops = 0;
  let ducked = false;

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
    if (!ctx || !master) return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    for (;;) {
      const e = events[next];
      const at = loopStart + loops * loopLen + e.start;
      if (at > horizon) break;
      // A gap before the next note keeps steps crisp.
      const end = at + Math.max(0.05, e.duration - 0.02);
      if (e.voice === "melody") tone(master, "square", e.freq, at, end, 0.5, 0.01);
      else tone(master, "triangle", e.freq, at, end, 0.9, 0.01);
      next++;
      if (next === events.length) {
        next = 0;
        loops++;
      }
    }
  }

  function setVolume() {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(ducked ? DUCKED_VOLUME : VOLUME, ctx.currentTime, 0.15);
  }

  return {
    /** Must first be called from inside a user gesture (a click): browsers only let audio start then. */
    async start() {
      if (timer) return;
      if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);
      }
      await ctx.resume();
      loopStart = ctx.currentTime + 0.1;
      next = 0;
      loops = 0;
      setVolume();
      schedule();
      timer = setInterval(schedule, TICK_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      // Closing drops every note already queued; the next start() builds a fresh context.
      void ctx?.close();
      ctx = null;
      master = null;
    },
    /** Lower the music while something else (the narration) is talking. */
    duck(on: boolean) {
      if (on === ducked) return;
      ducked = on;
      setVolume();
    },
    /** Play a sound effect now (lib/sfx.ts). Does nothing unless the music is playing: effects
     * follow the same 🎵 switch, and the browser only allows audio once start() ran in a click. */
    playCue(notes: SfxNote[]) {
      if (!ctx || !timer) return;
      const t0 = ctx.currentTime + 0.02;
      const bus = ctx.createGain();
      bus.gain.value = SFX_VOLUME;
      bus.connect(ctx.destination);
      for (const note of notes) {
        const at = t0 + note.at;
        tone(bus, note.wave, note.freq, at, at + note.duration, 1, 0.005, note.slideTo);
      }
    },
  };
}
