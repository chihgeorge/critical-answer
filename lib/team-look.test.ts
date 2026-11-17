import { describe, expect, it } from "vitest";
import { firstFreeLook, isLook, LOOK_COUNT, lookOf } from "./team-look";
import { TEAM_LOOKS } from "./pixel-art";
import { MAX_TEAMS, parseClientMessage } from "./protocol";

describe("team colours (#320)", () => {
  it("has one colour per team", () => {
    expect(LOOK_COUNT).toBe(MAX_TEAMS);
    expect(TEAM_LOOKS).toHaveLength(LOOK_COUNT);
  });

  it("finds the lowest free colour and falls back to the list index for a team saved without one", () => {
    expect(firstFreeLook([])).toBe(0);
    expect(firstFreeLook([{ look: 0 }, { look: 2 }, {}])).toBe(1);
    expect(firstFreeLook(Array.from({ length: LOOK_COUNT }, (_, look) => ({ look })))).toBe(0); // full room: never reached, JOIN caps at MAX_TEAMS
    expect(lookOf({ look: 6 }, 1)).toBe(6);
    expect(lookOf({}, 3)).toBe(3);
  });

  it("accepts only a whole colour index", () => {
    expect([0, 7].every(isLook)).toBe(true);
    expect([-1, 8, 1.5, "1", null].some(isLook)).toBe(false);
    expect(parseClientMessage({ type: "TEAM_PICK_LOOK", look: 3 })).toEqual({ type: "TEAM_PICK_LOOK", look: 3 });
    expect(parseClientMessage({ type: "TEAM_PICK_LOOK", look: 8 })).toBeNull();
  });
});
