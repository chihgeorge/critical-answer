import { describe, expect, it } from "vitest";
import { SFX, sfxDuration } from "./sfx";

describe("SFX", () => {
  it("has an effect for every cue, each short enough to finish before the narration gets going", () => {
    expect(Object.keys(SFX).sort()).toEqual(["boss-hit", "boss-kill", "correct", "flee", "retry", "start"]);
    for (const notes of Object.values(SFX)) {
      expect(notes.length).toBeGreaterThan(0);
      expect(sfxDuration(notes)).toBeLessThanOrEqual(1.1);
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
