// Sound effects for the big screen, one per kind of event, synthesized like the background music
// (lib/bgm.ts): no audio files. Pure data here, played by lib/bgm-player.ts's playCue().

import type { SoundCue } from "./protocol";
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
};

/** Seconds from the effect's start to its last note ending. */
export function sfxDuration(notes: SfxNote[]): number {
  return Math.max(...notes.map((x) => x.at + x.duration));
}
