import { describe, it, expect } from "vitest";
import { AMBIENCES, ambienceFor, revealFor, screenAudioOf } from "./ambience";
import type { StateMessage } from "./protocol";

type Team = { id: string; roomIndex: number; inBossPhase?: boolean };
/** A STATE with only what these rules read: the teams' rooms, whose turn it is, and the overlays. */
function state(teams: Team[], o: Partial<StateMessage> & { turn?: string } = {}): StateMessage {
  const { turn, ...rest } = o;
  return {
    type: "STATE",
    phase: "playing",
    question: null,
    reveal: null,
    view: { teams: teams.map((t) => ({ inBossPhase: false, ...t })), currentTurnTeamId: turn ?? teams[0]?.id, bossPhase: 1, bossMaxHp: 3, bossHp: 3 },
    ...rest,
  } as unknown as StateMessage;
}
const a = { id: "a", roomIndex: 0 };

describe("ambienceFor", () => {
  it("rotates drips, wind, campfire by the room of the team on turn", () => {
    expect([0, 1, 2, 3, 4].map((roomIndex) => ambienceFor(state([{ id: "a", roomIndex }])))).toEqual(["drips", "wind", "campfire", "drips", "wind"]);
    expect(ambienceFor(state([a, { id: "b", roomIndex: 2 }], { turn: "b" }))).toBe(AMBIENCES[2]);
  });

  it("is off outside a walking room: no STATE, finished, intro, 擲先攻, the boss room, the boss phase card", () => {
    expect(ambienceFor(null)).toBeNull();
    expect(ambienceFor(state([a], { phase: "finished" }))).toBeNull();
    expect(ambienceFor(state([a], { intro: { page: 1 } }))).toBeNull();
    expect(ambienceFor(state([a], { initiative: {} as never }))).toBeNull();
    expect(ambienceFor(state([{ id: "a", roomIndex: 4, inBossPhase: true }]))).toBeNull();
    expect(ambienceFor(state([a], { phaseCard: { monster: { sprite: "dragon" } as never } }))).toBeNull();
  });

  it("a dish reveal keeps the eaten monster's room, or the boss's (none)", () => {
    const dish = (room: number | null) => ({ reveal: { dish: { room } } as never });
    expect(ambienceFor(state([{ id: "a", roomIndex: 3 }], dish(1)))).toBe("wind");
    expect(ambienceFor(state([a], dish(null)))).toBeNull();
  });

  it("the host's 🌧 環境音 off silences it; music and voice switches do not", () => {
    expect(ambienceFor(state([a], { screenAudio: { music: true, voice: true, ambience: false } }))).toBeNull();
    expect(ambienceFor(state([a], { screenAudio: { music: false, voice: false, ambience: true } }))).toBe("drips");
  });
});

describe("screenAudioOf", () => {
  it("absent or damaged means all on; a host's setting comes through", () => {
    expect(screenAudioOf(null)).toEqual({ music: true, voice: true, ambience: true });
    expect(screenAudioOf(state([a], { screenAudio: { music: 1 } as never }))).toEqual({ music: true, voice: true, ambience: true });
    expect(screenAudioOf(state([a], { screenAudio: { music: false, voice: true, ambience: false } }))).toEqual({ music: false, voice: true, ambience: false });
  });
});

describe("revealFor", () => {
  const at = (...rooms: number[]) => state(rooms.map((roomIndex, i) => ({ id: `t${i}`, roomIndex })));
  it("the new frontier room when the fog edge moves", () => {
    expect(revealFor(at(0, 0), at(1, 0))).toBe(1);
    expect(revealFor(at(1, 0), at(3, 0))).toBe(3); // a jump of two reveals only the new frontier
  });

  it("nothing when the frontier stays: a trailing team, the same STATE, a boss entry", () => {
    expect(revealFor(at(2, 0), at(2, 1))).toBeNull();
    expect(revealFor(at(1), at(1))).toBeNull();
    expect(revealFor(at(4), state([{ id: "t0", roomIndex: 4, inBossPhase: true }]))).toBeNull();
  });

  it("nothing on the first STATE, a new game, or a phase change", () => {
    expect(revealFor(null, at(1))).toBeNull();
    expect(revealFor(at(3), at(0))).toBeNull();
    expect(revealFor(state([{ id: "t0", roomIndex: 0 }], { phase: "finished" }), at(1))).toBeNull();
    expect(revealFor(at(0), state([{ id: "t0", roomIndex: 1 }], { phase: "finished" }))).toBeNull();
  });
});
