// Sound effects for the big screen, one per kind of event, synthesized like the background music
// (lib/bgm.ts): no audio files. Pure data here, played by lib/bgm-player.ts's playCue().

import { COOK_POT_MS, COOK_SMOKE_MS, type SoundCue } from "./protocol";
import { noteToFreq } from "./bgm";

export interface SfxNote {
  /** Seconds after the effect starts. */
  at: number;
  duration: number;
  freq: number;
  wave: OscillatorType;
  /** Slide to this frequency by the end of the note (a swoop), instead of holding the pitch. */
  slideTo?: number;
}

const n = (at: number, duration: number, note: string, wave: OscillatorType = "square"): SfxNote => ({
  at,
  duration,
  freq: noteToFreq(note),
  wave,
});

/** Short on purpose: each one is over before the narration line for the same event gets going. */
export const SFX: Record<SoundCue, SfxNote[]> = {
  // A little fanfare: the adventure starts.
  start: [n(0, 0.1, "C5"), n(0.1, 0.1, "E5"), n(0.2, 0.1, "G5"), n(0.3, 0.3, "C6")],
  // The classic "coin": two quick rising notes.
  correct: [n(0, 0.08, "B5"), n(0.08, 0.25, "E6")],
  // A wrong answer: a low, falling buzz.
  retry: [{ at: 0, duration: 0.35, freq: noteToFreq("A3"), slideTo: noteToFreq("E3"), wave: "sawtooth" }],
  // Running away: a quick downward swoop.
  flee: [{ at: 0, duration: 0.3, freq: noteToFreq("E6"), slideTo: noteToFreq("E4"), wave: "triangle" }],
  // A hit on the boss: a punchy low thud, then a sting.
  "boss-hit": [
    { at: 0, duration: 0.12, freq: noteToFreq("C3"), slideTo: noteToFreq("C2"), wave: "square" },
    n(0.1, 0.15, "G5"),
  ],
  // The boss gets back up for its next phase (boss-phases.md D8): the opposite of the victory run, a low
  // falling rumble, then three rising notes a tritone apart.
  "boss-phase": [
    { at: 0, duration: 0.4, freq: noteToFreq("E2"), slideTo: noteToFreq("A1"), wave: "square" },
    n(0.4, 0.15, "C4"),
    n(0.4, 0.15, "F#4", "triangle"),
    n(0.58, 0.15, "D#4"),
    n(0.58, 0.15, "A4", "triangle"),
    n(0.76, 0.25, "F#4"),
    n(0.76, 0.25, "C5", "triangle"),
  ],
  // The boss falls: a longer victory run.
  "boss-kill": [
    n(0, 0.1, "G4"),
    n(0.1, 0.1, "C5"),
    n(0.2, 0.1, "E5"),
    n(0.3, 0.1, "G5"),
    n(0.4, 0.1, "E5"),
    n(0.5, 0.5, "C6"),
    n(0.5, 0.5, "G4", "triangle"),
  ],
  // A die tumbling: quick soft clicks for a second (the tumble on screen runs longer, the sound need not).
  roll: [0, 0.12, 0.24, 0.36, 0.5, 0.64, 0.8, 0.96].map((at, i) => n(at, 0.05, ["C5", "G4", "E5", "A4"][i % 4], "triangle")),
  // A natural 20: a rising trumpet call.
  crit: [n(0, 0.1, "C5"), n(0.1, 0.1, "G5"), n(0.2, 0.1, "C6"), n(0.3, 0.45, "E6")],
  // A natural 1: a sad slide down (still a hit).
  fumble: [{ at: 0, duration: 0.6, freq: noteToFreq("E5"), slideTo: noteToFreq("A3"), wave: "triangle" }],
  // A persuasion check passed: two short rising notes.
  "check-pass": [n(0, 0.1, "E5", "triangle"), n(0.1, 0.2, "A5", "triangle")],
  // A persuasion check failed: one low note sliding down (not the sawtooth, that one is a wrong answer's).
  "check-fail": [{ at: 0, duration: 0.3, freq: noteToFreq("D4"), slideTo: noteToFreq("A3"), wave: "square" }],
  // A team buzzed in (boss-buzzer.md): a bright game-show double ding over the paused music.
  buzz: [n(0, 0.09, "A5"), n(0.11, 0.25, "E6")],
  // 上菜 (monster-cuisine.md cooking I9): two low bubbles while the pot boils, then the 砰 of the smoke, done by 1.6 s.
  cook: [
    { at: COOK_POT_MS / 1000, duration: 0.12, freq: noteToFreq("C4"), slideTo: noteToFreq("G4"), wave: "triangle" },
    { at: (COOK_POT_MS + COOK_SMOKE_MS) / 2000, duration: 0.12, freq: noteToFreq("D4"), slideTo: noteToFreq("A4"), wave: "triangle" },
    { at: COOK_SMOKE_MS / 1000, duration: 0.3, freq: noteToFreq("C3"), slideTo: noteToFreq("C2"), wave: "square" },
  ],
};

/** The boss's alarm banner (components/transition-overlay.tsx): a two-tone siren, twice, under the banner's blinks. */
export const BOSS_ALARM: SfxNote[] = [n(0.4, 0.25, "A5"), n(0.65, 0.25, "E5"), n(0.9, 0.25, "A5"), n(1.15, 0.25, "E5")];

/** ⚔️ 最後衝刺's banner (last-sprint.md D3): four quick rising notes and a held one, crit's trumpet family, another tune. */
export const SPRINT_FANFARE: SfxNote[] = [n(0, 0.08, "G4"), n(0.08, 0.08, "C5"), n(0.16, 0.08, "E5"), n(0.24, 0.08, "G5"), n(0.32, 0.45, "C6")];

/** 每題作答倒數 (answer-countdown.md D5): a soft tick for each of the last seconds, and a short buzz at 0. */
export const ANSWER_TICK: SfxNote[] = [n(0, 0.05, "A5", "triangle")];
export const ANSWER_TIME_UP: SfxNote[] = [n(0, 0.15, "E5"), n(0.18, 0.3, "C5")];

/** The eaten dish's empty plate (docs/designs/eat-dish.md, eng F1): the one sound of the meal, a two-note rising 嗝, like check-pass. */
export const EAT_DONE: SfxNote[] = [n(0, 0.1, "C5", "triangle"), n(0.1, 0.2, "G5", "triangle")];

/** The big screen's sound just came on (immersion.md PR0, E6): a short rising chime, so the room hears the TV. */
export const SOUND_ON: SfxNote[] = [n(0, 0.08, "G5", "triangle"), n(0.08, 0.08, "C6", "triangle"), n(0.16, 0.2, "E6", "triangle")];

// The boss layer's sounds (immersion.md PR1, played on the "boss" layer of lib/bgm-player.ts). None uses the sawtooth:
// e2e/sfx.spec.ts finds the wrong-answer cue by it.
const slide = (at: number, duration: number, from: string, to: string, wave: OscillatorType = "square"): SfxNote => ({ at, duration, freq: noteToFreq(from), slideTo: noteToFreq(to), wave });

/** ① The boss entrance: a long low rumble under the alarm. */
export const BOSS_RUMBLE: SfxNote[] = [slide(0, 1.2, "E2", "A1"), slide(0.6, 0.6, "B1", "E1", "triangle")];

/** ② A boss wrong answer, the whole 1.4 s (PARRY_MS in lib/boss-fx.ts): the charge's rising warning, the parry's clang
 * at 0.6 s, the counter's thud at 0.9 s. The `retry` cue follows at 1.4 s. */
export const BOSS_PARRY: SfxNote[] = [
  slide(0, 0.55, "A2", "A4"),
  n(0.6, 0.08, "E6"),
  n(0.62, 0.12, "B6", "triangle"),
  slide(0.9, 0.25, "C3", "C2"),
];

/** ③ One heartbeat, lub-dub (the last 5 s of a boss answer clock, instead of ANSWER_TICK). */
export const HEARTBEAT: SfxNote[] = [slide(0, 0.09, "A2", "E2"), slide(0.14, 0.08, "G2", "D2")];

// The host's pads (immersion.md PR2), played on the "host" layer: they sound with 🎵 off and go silent during a video.
// No sawtooth either (e2e/sfx.spec.ts).

/** ⚡ 雷聲: a bright crack, then a long low roll that falls away. */
export const THUNDER: SfxNote[] = [
  slide(0, 0.06, "E7", "E5"),
  slide(0.04, 0.1, "B6", "B3", "triangle"),
  slide(0.12, 1.1, "C2", "F1"),
  slide(0.3, 0.9, "G2", "C2", "triangle"),
  slide(0.6, 0.8, "D2", "A1"),
];

/** 👹 低吼: a low snarl that rises, wobbles and sinks. */
export const GROWL: SfxNote[] = [
  slide(0, 0.25, "A1", "D2"),
  slide(0.25, 0.15, "D2", "C2"),
  slide(0.4, 0.15, "C2", "D#2"),
  slide(0.55, 0.45, "D#2", "G1"),
  slide(0.1, 0.8, "E2", "A1", "triangle"),
];

// The class moments (lib/class-fx.ts), game cues like `roll`: they follow 🎵 and the screen drops them while its clip
// plays. No sawtooth (e2e/sfx.spec.ts).

/** The mage's spell: a quick rising sparkle. */
export const MAGE_SPELL: SfxNote[] = [n(0, 0.06, "C6", "triangle"), n(0.06, 0.06, "E6", "triangle"), n(0.12, 0.06, "G6", "triangle"), n(0.18, 0.3, "C7", "triangle"), n(0.24, 0.24, "B6", "triangle")];

/** The cleric's prayer: a soft held major chord with a bell on top. */
export const CLERIC_PRAYER: SfxNote[] = [n(0, 0.6, "C5", "triangle"), n(0, 0.6, "E5", "triangle"), n(0, 0.6, "G5", "triangle"), n(0.15, 0.45, "C6", "triangle")];

/** The thief's sneak: a fast low swish, then two dry clicks (not flee's long swoop). */
export const THIEF_SNEAK: SfxNote[] = [slide(0, 0.08, "B5", "B3"), n(0.14, 0.03, "E6"), n(0.2, 0.03, "B6")];

/** The chef's （廚師 +N） on the dish card: two little pops. */
export const CHEF_SIZZLE: SfxNote[] = [n(0, 0.05, "C6", "triangle"), n(0.07, 0.05, "G6", "triangle")];

/** The fog reveal (immersion.md PR3): a door creaks open, falling and wobbling, a game cue like the class moments. */
export const DOOR_CREAK: SfxNote[] = [slide(0, 0.18, "F#3", "D3", "triangle"), slide(0.16, 0.14, "E3", "C#3", "triangle"), slide(0.28, 0.3, "D3", "A#2", "triangle")];
