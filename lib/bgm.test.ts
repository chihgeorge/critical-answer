import { describe, expect, it } from "vitest";
import { DUNGEON_THEME, loopDuration, noteToFreq, songEvents } from "./bgm";

describe("noteToFreq", () => {
  it("tunes A4 to 440 Hz and moves by octaves and semitones", () => {
    expect(noteToFreq("A4")).toBe(440);
    expect(noteToFreq("A2")).toBeCloseTo(110);
    expect(noteToFreq("C5")).toBeCloseTo(523.25, 1);
    expect(noteToFreq("G#4")).toBeCloseTo(415.3, 1);
    expect(noteToFreq("Ab4")).toBeCloseTo(noteToFreq("G#4"));
  });

  it("rejects anything that isn't a note name", () => {
    expect(() => noteToFreq("H4")).toThrow();
    expect(() => noteToFreq("-")).toThrow();
  });
});

describe("DUNGEON_THEME", () => {
  it("has eight bars of eight steps in both voices, so they loop together", () => {
    expect(DUNGEON_THEME.melody).toHaveLength(64);
    expect(DUNGEON_THEME.bass).toHaveLength(64);
    expect(loopDuration(DUNGEON_THEME)).toBe(16); // 64 eighth notes at 120 bpm
  });

  it("turns into notes that stay inside one loop, with held steps lengthening the note", () => {
    const events = songEvents(DUNGEON_THEME);
    const len = loopDuration(DUNGEON_THEME);
    for (const e of events) {
      expect(e.start).toBeGreaterThanOrEqual(0);
      expect(e.start + e.duration).toBeLessThanOrEqual(len + 1e-9);
      expect(e.freq).toBeGreaterThan(0);
    }
    // Melody opens "A4 - C5": A4 held for two steps (0.5 s), then C5 at 0.5 s.
    const melody = events.filter((e) => e.voice === "melody");
    expect(melody[0]).toMatchObject({ start: 0, duration: 0.5, freq: 440 });
    expect(melody[1].start).toBe(0.5);
  });

  // The player queues notes in list order and stops at the first one past its lookahead, so a
  // per-voice list (all melody, then all bass) held every bass note back to the end of the loop.
  it("lists every note of both voices in start order, so the player can schedule them as they come", () => {
    const starts = songEvents(DUNGEON_THEME).map((e) => e.start);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });

  it("treats a rest as silence, not as a hold", () => {
    const [a, b] = songEvents({ stepsPerMinute: 60, melody: ["A4", ".", "-", "A4"], bass: [] });
    expect(a).toMatchObject({ start: 0, duration: 1 });
    expect(b).toMatchObject({ start: 3, duration: 1 });
  });
});
