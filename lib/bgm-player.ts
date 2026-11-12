// Plays lib/bgm.ts's song on a loop with the Web Audio API (browser only: /screen imports it, and
// nothing here touches the question bank). A short lookahead scheduler queues each note on the
// AudioContext clock a little ahead of time, the standard way to get steady timing out of timers
// that themselves jitter.
//
// One AudioContext for the page's whole life, mixed in layers (docs/designs/immersion.md, 聲音分層表):
// master → speakers; the music, boss, host and ambient layers → master, each with its own volume from
// layerGains(); and the existing game cues on their own bus → master.

import type { Ambience } from "./ambience";
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
/** Inside the ambient layer: noise sounds louder than a tone of the same level, so the beds sit lower than the blips. */
const AMBIENT_BED = 0.5;
const AMBIENT_EVENT = 0.8;
/** A change of ambience crossfades over this long; the new one fades in a little faster. */
const AMBIENT_FADE_S = 1.5;
/** The looped noise, long enough that the loop is not heard. */
const NOISE_S = 4;

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

/** One sounding ambience: its own gain under the ambient layer, and how to silence it for good. */
type AmbienceGen = { out: GainNode; stop(): void };

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
  /** The room ambience asked for (immersion.md PR3), kept while it cannot sound (no context yet, asleep, 🎵 off). */
  let ambience: Ambience | null = null;
  /** The ambience sounding now, and at most one fading out after a change. */
  let live: AmbienceGen | null = null;
  let fading: AmbienceGen | null = null;
  let noise: AudioBuffer | null = null;

  function gain(c: AudioContext, value: number, dest: AudioNode) {
    const node = c.createGain();
    node.gain.value = value;
    node.connect(dest);
    return node;
  }

  function ensure(): AudioContext {
    if (ctx) return ctx;
    const c = new AudioContext();
    // The context can wake by any path (a later tap, the browser itself): the music and the ambience follow.
    c.onstatechange = () => {
      play();
      resumeAmbience();
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
    dropAmbience(0);
    apply();
  }

  /** Start the remembered ambience when it can be heard: 🎵 on, the context awake, none sounding yet. A WebAudio
   * failure (an old TV) only loses the ambience. */
  function resumeAmbience() {
    if (live || !ambience || !mix.bgmOn || !ctx || !layers || ctx.state !== "running") return;
    try {
      live = buildAmbience(ctx, layers.ambient, ambience);
    } catch (err) {
      console.error("[fx] ambience", err);
    }
  }

  /** Fade the sounding ambience out over `fadeS` (0: at once). One still fading from before stops at once, so a quick
   * run of changes never stacks more than two. */
  function dropAmbience(fadeS: number) {
    fading?.stop();
    fading = null;
    const gen = live;
    live = null;
    if (!gen) return;
    if (!fadeS || !ctx) return gen.stop();
    gen.out.gain.setTargetAtTime(0, ctx.currentTime, fadeS / 4);
    fading = gen;
    setTimeout(() => {
      gen.stop();
      if (fading === gen) fading = null;
    }, fadeS * 1000);
  }

  /** One room ambience under `dest`, synthesized from a looped noise buffer and a few random events (no audio files). */
  function buildAmbience(c: AudioContext, dest: AudioNode, kind: Ambience): AmbienceGen {
    if (!noise) {
      const buf = c.createBuffer(1, Math.round(c.sampleRate * NOISE_S), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise = buf;
    }
    const buffer = noise;
    const out = gain(c, 0, dest);
    out.gain.setTargetAtTime(1, c.currentTime, AMBIENT_FADE_S / 6);
    const sources: { stop(): void }[] = [];
    let tick: ReturnType<typeof setInterval> | null = null;
    function filtered(type: BiquadFilterType, freq: number, level: number) {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = gain(c, level, out);
      f.connect(g);
      return { f, g };
    }
    function bed(type: BiquadFilterType, freq: number, level: number) {
      const chain = filtered(type, freq, level);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(chain.f);
      src.start();
      sources.push(src);
      return chain;
    }
    /** `fire(at)` every `min`–`max` seconds on the context clock, queued a little ahead like the music; an event the
     * clock already passed (a background tab's slow timer) is dropped, never played late in a burst. */
    function every(min: number, max: number, fire: (at: number) => void) {
      let at = c.currentTime + min * Math.random();
      const run = () => {
        const horizon = c.currentTime + LOOKAHEAD_S;
        for (; at <= horizon; at += min + (max - min) * Math.random()) if (at >= c.currentTime) fire(at);
      };
      run();
      tick = setInterval(run, TICK_MS);
    }
    if (kind === "wind") {
      const { f, g } = bed("bandpass", 400, AMBIENT_BED);
      // A slow gust: the band and the level swell together.
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.15;
      const sweep = c.createGain();
      sweep.gain.value = 200;
      sweep.connect(f.frequency);
      const swell = c.createGain();
      swell.gain.value = AMBIENT_BED / 2;
      swell.connect(g.gain);
      lfo.connect(sweep);
      lfo.connect(swell);
      lfo.start();
      sources.push(lfo);
    } else if (kind === "campfire") {
      bed("lowpass", 500, AMBIENT_BED);
      const crackle = filtered("highpass", 2500, AMBIENT_EVENT);
      every(0.08, 0.7, (at) => {
        const src = c.createBufferSource();
        src.buffer = buffer;
        src.connect(crackle.f);
        src.start(at, Math.random() * (NOISE_S - 0.1), 0.02 + Math.random() * 0.04);
      });
    } else {
      bed("lowpass", 300, AMBIENT_BED * 0.3);
      every(1.5, 4.5, (at) => tone(out, "sine", 1400, at, at + 0.14, AMBIENT_EVENT, 0.005, 700));
    }
    return {
      out,
      stop() {
        if (tick) clearInterval(tick);
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            // already stopped
          }
        }
        out.disconnect();
      },
    };
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
      resumeAmbience();
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
      resumeAmbience();
    },
    /** Turn 🎵 off. The AudioContext stays open, so the host layer still sounds. */
    stop,
    /** The host's 🎵 switch (immersion.md PR3). Never creates or wakes the AudioContext, so it is safe outside a
     * gesture: switched on while asleep, the music starts when unlock() wakes it. */
    setMusic(on: boolean) {
      if (on === mix.bgmOn) return;
      if (!on) return stop();
      mix.bgmOn = true;
      apply();
      play();
      resumeAmbience();
    },
    /** Close the AudioContext for good: the page is going away. */
    close() {
      stop();
      fading?.stop();
      fading = null;
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
    /** The room ambience (immersion.md PR3), or none. The same kind again changes nothing; another one crossfades.
     * Never creates the AudioContext: before it exists, asleep, or with 🎵 off, the kind waits for the next wake. */
    setAmbience(kind: Ambience | null) {
      if (kind === ambience) return;
      ambience = kind;
      dropAmbience(AMBIENT_FADE_S);
      resumeAmbience();
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
