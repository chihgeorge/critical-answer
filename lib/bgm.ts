// Background music for the big screen, generated in code like the rest of the art (DESIGN.md: no
// image or sound assets, so nothing to license). This file is the pure part: the song as data and
// its conversion to timed notes, unit-tested. lib/bgm-player.ts plays it with the Web Audio API.

/** A voice's part: one entry per step. A note name ("A4", "C#5") starts a note, "-" holds the
 * previous one for another step, "." is a rest. */
export type Part = string[];

export interface Song {
  /** Steps per minute. A step is an eighth note (8 per bar, so 240 is 120 bpm) or, in a swung or triplet
   * song, a triplet eighth (12 per bar, so 396 is 132 bpm). */
  stepsPerMinute: number;
  /** Steps at the start that play once, like a fanfare; the loop repeats from the step after them. */
  introSteps?: number;
  melody: Part;
  bass: Part;
  /** A kick drum: each note is a short low thump that slides down (BOSS_RAGE_THEME). */
  drum?: Part;
}

export interface NoteEvent {
  voice: "melody" | "bass" | "drum";
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

/** Bass for one bar of a swung song: root and fifth on the beats, short, so it bounces. */
const bounce = (root: string, fifth: string) => `${root} - . ${fifth} - . ${root} - . ${fifth} - .`;

/** A warm drone for one lobby bar: the root held half a bar, then its fifth. */
const drone = (root: string, fifth: string) => `${root} - - - - - ${fifth} - - - - -`;

/** 大廳曲, the tavern before the dungeon: D dorian in a lilting 6/8 (two 6/8 bars per 12 steps, dotted
 * quarter = 70), plucked arpeggios over a drone and a light hand drum. Mysterious but welcoming, calmer than
 * the dungeon it leads into. */
export const LOBBY_THEME: Song = {
  stepsPerMinute: 210,
  melody: bars(
    "D4 A4 D5 F5 D5 A4 D4 A4 D5 E5 D5 A4",
    "C4 G4 C5 E5 C5 G4 C4 G4 C5 D5 C5 G4",
    "G4 B4 D5 G5 D5 B4 G4 B4 D5 E5 D5 B4",
    "A4 C5 E5 A5 - E5 F5 - E5 D5 - C5",
    "D5 - - F5 - E5 D5 - C5 A4 - -",
    "G4 - - C5 - D5 E5 - D5 C5 - -",
    "B4 - - D5 - E5 G5 - F5 E5 - D5",
    "E5 - - - - - C#5 - - A4 - -",
    "A5 - - G5 - F5 C5 - F5 A5 - -",
    "G5 - - E5 - C5 G4 - C5 E5 - -",
    "F5 - E5 D5 - A4 D5 - E5 F5 - G5",
    "A5 - - G5 - D5 B4 - - . . .",
    "D5 F5 A5 D6 A5 F5 D5 F5 A5 C6 A5 F5",
    "C5 E5 G5 C6 G5 E5 C5 E5 G5 B5 G5 E5",
    "B4 D5 G5 B5 G5 D5 C5 E5 A5 C6 A5 E5",
    "D5 - - - - - A4 - - . . .",
  ),
  bass: bars(
    drone("D2", "A2"), drone("C2", "G2"), drone("G2", "D2"), drone("A2", "E2"),
    drone("D2", "A2"), drone("C2", "G2"), drone("G2", "D2"), drone("A1", "E2"),
    drone("F2", "C2"), drone("C2", "G2"), drone("D2", "A2"), drone("G2", "D2"),
    drone("D2", "A2"), drone("C2", "G2"), drone("G2", "A2"), drone("D2", "A1"),
  ),
  // A high pitch on the kick voice reads as a hand drum, not a kick.
  drum: bars(
    ...Array.from({ length: 16 }, (_, i) =>
      i % 8 === 7 ? "D3 . . A3 . A3 D3 . A3 A3 . A3" : "D3 . . . . A3 D3 . . . . .",
    ),
  ),
};

/** Bass for one bar of the title theme: a marching root and octave on the beats. */
const march = (low: string, high: string) => `${low} - ${high} - ${low} - ${high} -`;

/** 首頁曲, the title screen: a D-major call to adventure at 112 bpm. A rising horn call answered twice, then a
 * second phrase that climbs through ♭VII and ♭VI to the top D before turning back to the start. */
export const TITLE_THEME: Song = {
  stepsPerMinute: 224,
  melody: bars(
    "A4 - - D5 - - E5 F#5",
    "A5 - - - - - . .",
    "G5 - - E5 - - C5 E5",
    "D5 - - - - - A4 -",
    "B4 - - D5 - - F#5 -",
    "G5 - F#5 - E5 - D5 E5",
    "F#5 - - E5 - D5 E5 -",
    "A5 - - - E5 - C#5 -",
    "A4 - - D5 - - E5 F#5",
    "A5 - - - B5 - A5 -",
    "B5 - - G5 - - D5 G5",
    "C6 - - - B5 - G5 -",
    "Bb5 - - F5 - - D5 F5",
    "C6 - - G5 - - E5 G5",
    "D6 - - - - - A5 -",
    "A5 - G5 - F#5 - E5 -",
  ),
  bass: bars(
    march("D2", "D3"), march("D2", "D3"), march("C2", "C3"), march("D2", "D3"),
    march("B1", "B2"), march("G1", "G2"), "E2 - E3 - A1 - A2 -", march("A1", "A2"),
    march("D2", "D3"), march("D2", "D3"), march("G1", "G2"), march("C2", "C3"),
    march("Bb1", "Bb2"), march("C2", "C3"), march("D2", "D3"), march("A1", "A2"),
  ),
  drum: bars(
    ...Array.from({ length: 15 }, (_, i) => (i % 4 === 3 ? "C2 . . . C2 . C2 C2" : "C2 . . . C2 . . .")),
    "C2 . C2 . C2 C2 C2 C2",
  ),
};

/** Bass for one bar of the boss song: driving eighths on the low root with an octave kick. */
const pump = (low: string, high: string) => `${low} ${low} ${high} ${low} ${low} ${high} ${low} ${low}`;

/** ④ 王低血暴走, the boss song: sixteen bars of E minor at 152 bpm over a pounding eighth-note bass. The first
 * half states the theme in long notes; the second climbs a step a bar (E, F, G, A) to the top and falls back. */
export const BOSS_RAGE_THEME: Song = {
  stepsPerMinute: 304,
  melody: bars(
    "E5 - - - B4 - - -",
    "C5 - - D5 E5 - G5 -",
    "F#5 - - - D5 - A4 -",
    "B4 - - - D#5 - F#5 -",
    "G5 - - - F#5 - E5 -",
    "E5 - - - G5 - C6 -",
    "A5 - - - C6 - B5 A5",
    "B5 - - - - - D#5 F#5",
    "G5 F#5 E5 F#5 G5 - B4 -",
    "A5 G5 F5 G5 A5 - C5 -",
    "B5 A5 G5 A5 B5 - D5 -",
    "C6 B5 A5 B5 C6 - E5 -",
    "E6 - D6 C6 B5 - A5 G5",
    "F#5 - G5 A5 B5 - D#5 -",
    "E5 G5 B5 E6 - - D#6 -",
    "B5 - - - F#5 - D#5 B4",
  ),
  bass: bars(
    pump("E2", "E3"), pump("C2", "C3"), pump("D2", "D3"), pump("B1", "B2"),
    pump("E2", "E3"), pump("C2", "C3"), pump("A1", "A2"), pump("B1", "B2"),
    pump("E2", "E3"), pump("F2", "F3"), pump("G2", "G3"), pump("A2", "A3"),
    pump("C2", "C3"), pump("B1", "B2"),
    "E2 E2 E3 E2 C2 C2 C3 C2",
    "B1 B1 B2 B1 B1 B2 B1 B2",
  ),
  drum: bars(
    ...Array.from({ length: 8 }, () => "C2 . C2 . C2 . C2 C2"),
    ...Array.from({ length: 7 }, () => "C2 C2 C2 . C2 C2 C2 C2"),
    "C2 C2 C2 C2 C2 C2 C2 C2",
  ),
};

/** 勝利曲: a C-major fanfare at 150 bpm on triplet steps (a rising triplet, a ♭VI–♭VII–I cadence), played once,
 * then an eight-bar shuffle march that loops through the podium. */
export const VICTORY_THEME: Song = {
  stepsPerMinute: 450,
  introSteps: 60,
  melody: bars(
    // fanfare, once
    "G4 C5 E5 G5 - - . . . G5 A5 B5",
    "C6 - - - - - G5 - - C6 - -",
    "Ab5 - - Eb5 - Ab5 C6 - - Ab5 - -",
    "Bb5 - - F5 - Bb5 D6 - - Bb5 C6 D6",
    "C6 - - - - - - - - . . .",
    // loop
    "E5 - G5 C6 - G5 E5 - G5 C6 - .",
    "A5 - C6 F5 - A5 C6 - A5 F5 - .",
    "G5 - B5 D6 - B5 G5 - F5 E5 - D5",
    "E5 - - C5 - E5 G5 - - . . .",
    "A5 - E5 C5 - E5 A5 - B5 C6 - A5",
    "F5 - A5 C6 - A5 F5 - E5 D5 - C5",
    "Eb5 - Ab5 C6 - Ab5 D5 - F5 Bb5 - D6",
    "C6 - - G5 - E5 C5 - - G4 A4 B4",
  ),
  bass: bars(
    "C2 . . C2 . . C2 . . C2 . .",
    "C2 - - G2 - - C3 - - G2 - -",
    "Ab1 - - Eb2 - - Ab2 - - Eb2 - -",
    "Bb1 - - F2 - - Bb2 - - F2 - -",
    "C2 - - - - - - - - . . .",
    bounce("C2", "G2"), bounce("F2", "C3"), bounce("G2", "D3"), bounce("C2", "G2"),
    bounce("A1", "E2"), bounce("F2", "C3"), "Ab1 - . Eb2 - . Bb1 - . F2 - .", "C2 - . G2 - . C2 - . G1 - .",
  ),
  drum: bars(
    "C2 . . C2 . . C2 . . C2 C2 C2",
    "C2 . . . . . C2 . . . . .",
    "C2 . . . . . C2 . . . . .",
    "C2 . . . . . C2 . . C2 C2 C2",
    "C2 . . . . . . . . . . .",
    ...Array.from({ length: 7 }, () => "C2 . . . . . C2 . . . . ."),
    "C2 . . . . . C2 . . C2 C2 C2",
  ),
};

/** Seconds the intro lasts (0 without one): later passes start this far into the song. */
export function introDuration(song: Song): number {
  return ((song.introSteps ?? 0) * 60) / song.stepsPerMinute;
}

/** Seconds one pass of the song lasts. */
export function loopDuration(song: Song): number {
  return (Math.max(song.melody.length, song.bass.length, song.drum?.length ?? 0) * 60) / song.stepsPerMinute;
}

/** Every note of one pass, both voices merged in start order (the player schedules them in list order). */
export function songEvents(song: Song): NoteEvent[] {
  const step = 60 / song.stepsPerMinute;
  const events: NoteEvent[] = [];
  for (const voice of ["melody", "bass", "drum"] as const) {
    let current: NoteEvent | null = null;
    (song[voice] ?? []).forEach((tok, i) => {
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

/** The big screen's song: the lobby tune before the game, the dungeon tune while it runs (the boss song once the
 * boss is in ④ rage), and the victory song once it is over, ended early by the host included. */
export function songFor(phase: "lobby" | "playing" | "finished", rage: boolean): Song {
  if (phase === "lobby") return LOBBY_THEME;
  if (phase === "finished") return VICTORY_THEME;
  return rage ? BOSS_RAGE_THEME : DUNGEON_THEME;
}
