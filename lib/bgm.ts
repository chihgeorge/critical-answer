// Background music for the big screen, generated in code like the rest of the art (DESIGN.md: no
// image or sound assets, so nothing to license). This file is the pure part: the song as data and
// its conversion to timed notes, unit-tested. lib/bgm-player.ts plays it with the Web Audio API.

/** A voice's part: one entry per step. A note name ("A4", "C#5") starts a note, "-" holds the
 * previous one for another step, "." is a rest. */
export type Part = string[];

export interface Song {
  /** Steps per minute: one step is an eighth note, so 240 is 120 bpm. */
  stepsPerMinute: number;
  melody: Part;
  bass: Part;
}

export interface NoteEvent {
  voice: "melody" | "bass";
  /** Seconds from the start of the loop. */
  start: number;
  duration: number;
  freq: number;
}

const SEMITONES: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

/** Equal-tempered frequency of a note name, with A4 = 440 Hz. */
export function noteToFreq(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note name: ${name}`);
  const semis = SEMITONES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

const bars = (...b: string[]) => b.join(" ").split(/\s+/).filter(Boolean);

/** "Into the Dungeon": an eight-bar A-minor loop, eighth-note steps (8 per bar). */
export const DUNGEON_THEME: Song = {
  stepsPerMinute: 240,
  melody: bars(
    "A4 - C5 E5 D5 - C5 B4",
    "A4 - E4 - A4 B4 C5 -",
    "D5 - F5 - E5 D5 C5 B4",
    "C5 - A4 - E4 - - .",
    "F4 - A4 C5 B4 - A4 G#4",
    "A4 - B4 C5 D5 - E5 -",
    "F5 E5 D5 C5 B4 - G#4 -",
    "A4 - - - . . E4 .",
  ),
  bass: bars(
    "A2 - . A2 A2 - . A2",
    "A2 - . A2 G2 - . G2",
    "D2 - . D2 D2 - . D2",
    "A2 - . A2 A2 - E2 -",
    "F2 - . F2 F2 - . F2",
    "D2 - . D2 D2 - . D2",
    "E2 - . E2 E2 - . E2",
    "A2 - . A2 E2 - E2 -",
  ),
};

/** Seconds one pass of the song lasts. */
export function loopDuration(song: Song): number {
  return (Math.max(song.melody.length, song.bass.length) * 60) / song.stepsPerMinute;
}

/** Every note of one pass, both voices merged in start order (the player schedules them in list order). */
export function songEvents(song: Song): NoteEvent[] {
  const step = 60 / song.stepsPerMinute;
  const events: NoteEvent[] = [];
  for (const voice of ["melody", "bass"] as const) {
    let current: NoteEvent | null = null;
    song[voice].forEach((tok, i) => {
      if (tok === "-") {
        if (current) current.duration += step;
        return;
      }
      current = null;
      if (tok === ".") return;
      current = { voice, start: i * step, duration: step, freq: noteToFreq(tok) };
      events.push(current);
    });
  }
  return events.sort((a, b) => a.start - b.start);
}
