import { describe, it, expect } from "vitest";
import { antiCheatBanner, IN_LOBBY, nextTransition, sprintSeen, UNSEEN, type TransitionSeen } from "./transitions";
import type { StateMessage } from "./protocol";
import { monsterLook } from "./turn-info";

const team = (id: string, name: string, inBossPhase = false) => ({ id, name, inBossPhase, roomIndex: 0, currentQuestionId: "q1" });
const room = { id: "q1", content: { kind: "text", value: "題目" }, difficulty: 1, boss: false, monster: { name: "史萊姆", sprite: "slime", hue: 0 } };
const boss = { ...room, id: "b1", boss: true, monster: { name: "魔王", sprite: "dragon", hue: 0 } };
/** The boss entrance carries the boss's look, for its silhouette (immersion.md ①). */
const BOSS = { kind: "boss", monster: monsterLook(boss.monster as never) };

function state(over: { phase?: "playing" | "finished"; intro?: boolean; initiative?: boolean; inBoss?: boolean; reveal?: boolean; otherInBoss?: boolean; sprint?: string[] } = {}): StateMessage {
  return {
    type: "STATE",
    phase: over.phase ?? "playing",
    eventId: 1,
    view: { currentTurnTeamId: "a", teams: [team("a", "紅隊", over.inBoss), team("b", "藍隊", over.otherInBoss)], bossHp: 5, bossMaxHp: 5, bossPhase: 1, bossCurrentQuestionId: "b1", ...(over.sprint ? { sprint: { teamIds: over.sprint } } : {}) },
    question: over.inBoss ? boss : room,
    reveal: over.reveal ? { questionId: "q1", answer: "x" } : null,
    ...(over.intro ? { intro: { page: 1 } } : {}),
    ...(over.initiative ? { initiative: { rolls: {}, left: 15000 }, question: null } : {}),
  } as unknown as StateMessage;
}

/** Feeds the messages in order and returns every transition played. */
function run(start: TransitionSeen, msgs: StateMessage[]) {
  let seen = start;
  return msgs.map((m) => {
    const r = nextTransition(seen, m);
    seen = r.seen;
    return r.play;
  });
}

describe("nextTransition", () => {
  it("opens the doors once, on the first question after the intro or the lobby", () => {
    expect(run(IN_LOBBY, [state({ intro: true }), state({ intro: true }), state(), state()])).toEqual([null, null, { kind: "open", team: "紅隊" }, null]);
    expect(run(IN_LOBBY, [state()])).toEqual([{ kind: "open", team: "紅隊" }]);
  });

  it("opens the doors on 擲先攻, naming no team, and not again on the first question", () => {
    expect(run(IN_LOBBY, [state({ intro: true }), state({ initiative: true }), state({ initiative: true }), state()])).toEqual([null, { kind: "open", team: "" }, null, null]);
    // A screen that connects mid-roll saw no start: no doors.
    expect(run(UNSEEN, [state({ initiative: true }), state()])).toEqual([null, null]);
  });

  it("calls the boss once, when the boss room first comes on screen after the reveal", () => {
    expect(run(IN_LOBBY, [state(), state(), state({ inBoss: true, reveal: true }), state({ inBoss: true }), state({ inBoss: true })])).toEqual([
      { kind: "open", team: "紅隊" },
      null,
      null,
      BOSS,
      null,
    ]);
  });

  it("replays nothing to a screen that connects mid-game", () => {
    expect(run(UNSEEN, [state(), state({ inBoss: true })])).toEqual([null, BOSS]);
    expect(run(UNSEEN, [state({ inBoss: true }), state({ inBoss: true })])).toEqual([null, null]);
    expect(run(UNSEEN, [state({ phase: "finished" })])).toEqual([null]);
    // An ended game disarms both, so a late playing STATE plays neither.
    expect(run(IN_LOBBY, [state({ phase: "finished" }), state({ inBoss: true })])).toEqual([null, null]);
  });

  it("does not replay the boss to a screen that reconnects after any team reached it", () => {
    expect(run(UNSEEN, [state({ otherInBoss: true }), state({ inBoss: true })])).toEqual([null, null]);
    expect(run(UNSEEN, [state({ inBoss: true, reveal: true }), state({ inBoss: true })])).toEqual([null, null]);
  });

  it("plays only the doors when the first question is already the boss's", () => {
    expect(run(IN_LOBBY, [state({ inBoss: true }), state({ inBoss: true })])).toEqual([{ kind: "open", team: "紅隊" }, null]);
  });

  it("counts a phase card (no question, the boss drawn from the card) as the boss on screen", () => {
    const card = { ...state(), question: null, phaseCard: { monster: boss.monster } } as unknown as StateMessage;
    expect(run({ open: false, boss: false, sprint: false }, [card])).toEqual([BOSS]);
  });

  it("plays the sprint banner once, live, on the reveal that opened the boss door, then the boss alarm", () => {
    expect(run(IN_LOBBY, [state(), state({ otherInBoss: true, reveal: true, sprint: ["a"] }), state({ otherInBoss: true, sprint: ["a"] }), state({ inBoss: true, sprint: ["a"] }), state({ inBoss: true, sprint: ["a"] })])).toEqual([
      { kind: "open", team: "紅隊" },
      { kind: "sprint", names: ["紅隊"] },
      null,
      BOSS,
      null,
    ]);
  });

  it("plays the sprint first when the host's 送進魔王房 also puts the boss on screen, and the alarm on the next STATE", () => {
    expect(run(IN_LOBBY, [state(), state({ inBoss: true, sprint: ["b", "a"] }), state({ inBoss: true, sprint: ["b", "a"] })])).toEqual([
      { kind: "open", team: "紅隊" },
      { kind: "sprint", names: ["藍隊", "紅隊"] },
      BOSS,
    ]);
  });

  it("never replays the sprint to a screen that (re)connects after it", () => {
    expect(run(UNSEEN, [state({ otherInBoss: true, sprint: ["a"] }), state({ otherInBoss: true, sprint: ["a"] })])).toEqual([null, null]);
    // Connected before it: plays live.
    expect(run(UNSEEN, [state(), state({ otherInBoss: true, sprint: ["a"] })])).toEqual([null, { kind: "sprint", names: ["紅隊"] }]);
  });
});

describe("sprintSeen (the phone card's rule)", () => {
  it("plays only when this connection saw no sprint before", () => {
    expect(sprintSeen(false, { sprint: { teamIds: ["a"] } })).toEqual({ seen: true, play: true });
    expect(sprintSeen(null, { sprint: { teamIds: ["a"] } })).toEqual({ seen: true, play: false });
    expect(sprintSeen(null, {})).toEqual({ seen: false, play: false });
    expect(sprintSeen(true, { sprint: { teamIds: ["a"] } })).toEqual({ seen: true, play: false });
  });
});

describe("antiCheatBanner (anti-ai-cheating.md)", () => {
  const teams = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }] as never;
  const view = (antiCheat?: object) => ({ teams, antiCheat }) as never;
  it("plays nothing on the first STATE after connecting, whatever is on", () => {
    expect(antiCheatBanner(null, view({ on: true, onCount: 1, openCatch: { by: "b", teamId: "a", questionId: "q" } })).play).toBeNull();
  });
  it("plays the switch-on banner when the on count grows, and not on switch-off", () => {
    expect(antiCheatBanner({ on: 0, open: false }, view({ on: true, onCount: 1 })).play).toEqual({ kind: "cheat" });
    expect(antiCheatBanner({ on: 1, open: false }, view({ on: false, onCount: 1 })).play).toBeNull();
  });
  it("plays the catch banner once when a catch opens", () => {
    const opened = antiCheatBanner({ on: 1, open: false }, view({ on: true, onCount: 1, openCatch: { by: "b", teamId: "a", questionId: "q" } }));
    expect(opened.play).toEqual({ kind: "catch", by: "乙", team: "甲" });
    expect(antiCheatBanner(opened.seen, view({ on: true, onCount: 1, openCatch: { by: "b", teamId: "a", questionId: "q" } })).play).toBeNull();
  });
});
