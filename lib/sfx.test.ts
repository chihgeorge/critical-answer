import { describe, expect, it } from "vitest";
import { BOSS_PARRY, BOSS_RUMBLE, DOOR_CREAK, EAT_DONE, HEARTBEAT, SFX, type SfxNote } from "./sfx";

describe("DOOR_CREAK (immersion.md PR3)", () => {
  it("is no sawtooth, and ends within 0.6 s so it clears before the next cue", () => {
    expect(DOOR_CREAK.every((x) => x.wave !== "sawtooth")).toBe(true);
    expect(Math.max(...DOOR_CREAK.map((x) => x.at + x.duration))).toBeLessThanOrEqual(0.6);
  });
});

/** Seconds from the effect's start to its last note ending. */
const sfxDuration = (notes: SfxNote[]) => Math.max(...notes.map((x) => x.at + x.duration));

describe("SFX", () => {
  it("every effect is short enough to finish before the narration gets going", () => {
    for (const [cue, notes] of Object.entries(SFX)) {
      expect(notes.length).toBeGreaterThan(0);
      // The cooking runs under the 1.6 s animation; its dish line is read only once the dish is up.
      expect(sfxDuration(notes)).toBeLessThanOrEqual(cue === "cook" ? 1.6 : 1.1);
      for (const x of notes) {
        expect(x.freq).toBeGreaterThan(20);
        expect(x.duration).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the wrong-answer buzz as the only sawtooth, so it can't be mistaken for music", () => {
    const saw = Object.entries(SFX).filter(([, notes]) => notes.some((x) => x.wave === "sawtooth")).map(([k]) => k);
    expect(saw).toEqual(["retry"]);
  });
});

describe("the boss layer's sounds (immersion.md PR1)", () => {
  it("never use the sawtooth, and the parry's sound fits its 1.4 s", () => {
    for (const notes of [BOSS_RUMBLE, BOSS_PARRY, HEARTBEAT]) expect(notes.every((x) => x.wave !== "sawtooth")).toBe(true);
    expect(sfxDuration(BOSS_PARRY)).toBeLessThanOrEqual(1.4);
    // A heartbeat ends before the next one, even at 2.5 a second.
    expect(sfxDuration(HEARTBEAT)).toBeLessThan(0.4);
  });
});

describe("EAT_DONE (eat-dish.md eng F1)", () => {
  it("is the meal's only sound, and short", () => {
    expect(sfxDuration(EAT_DONE)).toBeLessThanOrEqual(0.4);
  });
});
