import { describe, expect, it } from "vitest";
import { BOSS_RAGE_THEME, DUNGEON_THEME, LOBBY_THEME, TITLE_THEME, VICTORY_THEME, introDuration, loopDuration, noteToFreq, songEvents, songFor } from "./bgm";

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

  it("the boss theme has its own melody and bass, with a kick drum that loops with it", () => {
    expect(BOSS_RAGE_THEME.melody).not.toEqual(DUNGEON_THEME.melody);
    expect(BOSS_RAGE_THEME.bass).not.toEqual(DUNGEON_THEME.bass);
    expect(BOSS_RAGE_THEME.drum).toHaveLength(BOSS_RAGE_THEME.melody.length);
    expect(BOSS_RAGE_THEME.stepsPerMinute).toBeGreaterThan(DUNGEON_THEME.stepsPerMinute);
    const drums = songEvents(BOSS_RAGE_THEME).filter((e) => e.voice === "drum");
    expect(drums.length).toBe(8 * 5 + 7 * 7 + 8);
    expect(songEvents(DUNGEON_THEME).some((e) => e.voice === "drum")).toBe(false);
  });

  it("treats a rest as silence, not as a hold", () => {
    const [a, b] = songEvents({ stepsPerMinute: 60, melody: ["A4", ".", "-", "A4"], bass: [] });
    expect(a).toMatchObject({ start: 0, duration: 1 });
    expect(b).toMatchObject({ start: 3, duration: 1 });
  });
});

describe("TITLE_THEME, LOBBY_THEME, BOSS_RAGE_THEME and VICTORY_THEME", () => {
  it.each([
    ["title", TITLE_THEME, 8],
    ["lobby", LOBBY_THEME, 12],
    ["boss", BOSS_RAGE_THEME, 8],
    ["victory", VICTORY_THEME, 12],
  ] as const)("%s: every voice fills whole bars of the same length, so they loop together", (_, song, perBar) => {
    for (const part of [song.melody, song.bass, song.drum ?? song.melody]) expect(part).toHaveLength(song.melody.length);
    expect(song.melody.length % perBar).toBe(0);
    expect(() => songEvents(song)).not.toThrow();
  });

  it("the victory fanfare plays once: its intro is whole bars, and the loop after it is shorter than the song", () => {
    expect(VICTORY_THEME.introSteps! % 12).toBe(0);
    expect(introDuration(VICTORY_THEME)).toBe(8); // 60 triplet steps at 150 bpm
    expect(introDuration(LOBBY_THEME)).toBe(0);
  });
});

describe("songFor: which song the big screen plays", () => {
  it("the lobby tune before the game, the dungeon tune while it runs, the boss song in rage, the victory song at the end", () => {
    expect(songFor("lobby", false)).toBe(LOBBY_THEME);
    expect(songFor("playing", false)).toBe(DUNGEON_THEME);
    expect(songFor("playing", true)).toBe(BOSS_RAGE_THEME);
    // An early end (結束冒險) is a finished game too: the podium gets the victory song either way.
    expect(songFor("finished", false)).toBe(VICTORY_THEME);
    expect(songFor("finished", true)).toBe(VICTORY_THEME);
  });
});
