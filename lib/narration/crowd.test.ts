// Value: protects=the narrator mentions the audience only when it really reacted, names the right team, and never on
// two turns running (TODOS 觀眾反應的後續); fails_when=one lone tap or three mixed taps count, the next team is named
// over another, a tally leaks into the next team's turn, or take() hands a crowd back twice in a row.
import { describe, it, expect } from "vitest";
import { crowdOf, createCrowdTally } from "./crowd";
import type { Reaction } from "../protocol";

const taps = (...xs: [string, Reaction][]) => xs.map(([team, reaction]) => ({ team, reaction }));

describe("crowdOf", () => {
  it("needs three taps and two of the loudest reaction", () => {
    expect(crowdOf(taps(["藍莓", "boo"], ["藍莓", "boo"]))).toBeUndefined();
    expect(crowdOf(taps(["藍莓", "boo"], ["草莓", "clap"], ["芒果", "lol"]))).toBeUndefined();
    expect(crowdOf(taps(["藍莓", "boo"], ["草莓", "clap"], ["藍莓", "boo"]))).toEqual({ mood: "boo", team: "藍莓" });
  });

  it("names the team that tapped the loudest reaction most, the first on a tie, and the next team only as a last resort", () => {
    expect(crowdOf(taps(["草莓", "wow"], ["藍莓", "wow"], ["藍莓", "wow"]))).toEqual({ mood: "wow", team: "藍莓" });
    expect(crowdOf(taps(["草莓", "wow"], ["藍莓", "wow"], ["芒果", "lol"]))).toEqual({ mood: "wow", team: "草莓" });
    expect(crowdOf(taps(["草莓", "wow"], ["藍莓", "wow"], ["藍莓", "wow"]), "藍莓")).toEqual({ mood: "wow", team: "草莓" });
    expect(crowdOf(taps(["藍莓", "wow"], ["藍莓", "wow"], ["藍莓", "lol"]), "藍莓")).toEqual({ mood: "wow", team: "藍莓" });
  });
});

describe("createCrowdTally", () => {
  const loud = (t: ReturnType<typeof createCrowdTally>, turn: string) => {
    for (let i = 0; i < 3; i++) t.tap(turn, "藍莓", "boo");
  };

  it("counts one team's turn only, and starts over on every take", () => {
    const t = createCrowdTally();
    loud(t, "A");
    t.tap("B", "草莓", "clap"); // B's turn now: A's taps are gone
    expect(t.take("A")).toBeUndefined();
    loud(t, "A");
    expect(t.take("A")).toEqual({ mood: "boo", team: "藍莓" });
    expect(t.take("B")).toBeUndefined();
  });

  it("never hands a crowd back on two judged answers running", () => {
    const t = createCrowdTally();
    loud(t, "A");
    expect(t.take("A")).toBeDefined();
    loud(t, "B");
    expect(t.take("B")).toBeUndefined();
    loud(t, "A");
    expect(t.take("A")).toBeDefined();
  });

  it("a skipped take drops the count without blocking the next judged answer", () => {
    const t = createCrowdTally();
    loud(t, "A");
    expect(t.take("A", undefined, true)).toBeUndefined();
    loud(t, "B");
    expect(t.take("B")).toBeDefined();
  });
});
