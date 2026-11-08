import { describe, it, expect } from "vitest";
import { IN_LOBBY, nextTransition, UNSEEN, type TransitionSeen } from "./transitions";
import type { StateMessage } from "./protocol";

const team = (id: string, name: string, inBossPhase = false) => ({ id, name, inBossPhase, roomIndex: 0, currentQuestionId: "q1" });
const room = { id: "q1", content: { kind: "text", value: "題目" }, difficulty: 1, boss: false, monster: { name: "史萊姆", sprite: "slime", hue: 0 } };
const boss = { ...room, id: "b1", boss: true, monster: { name: "魔王", sprite: "dragon", hue: 0 } };

function state(over: { phase?: "playing" | "finished"; intro?: boolean; inBoss?: boolean; reveal?: boolean; otherInBoss?: boolean } = {}): StateMessage {
  return {
    type: "STATE",
    phase: over.phase ?? "playing",
    eventId: 1,
    view: { currentTurnTeamId: "a", teams: [team("a", "紅隊", over.inBoss), team("b", "藍隊", over.otherInBoss)], bossHp: 5, bossMaxHp: 5, bossPhase: 1, bossCurrentQuestionId: "b1" },
    question: over.inBoss ? boss : room,
    reveal: over.reveal ? { questionId: "q1", answer: "x" } : null,
    ...(over.intro ? { intro: { page: 1 } } : {}),
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

  it("calls the boss once, when the boss room first comes on screen after the reveal", () => {
    expect(run(IN_LOBBY, [state(), state(), state({ inBoss: true, reveal: true }), state({ inBoss: true }), state({ inBoss: true })])).toEqual([
      { kind: "open", team: "紅隊" },
      null,
      null,
      { kind: "boss", name: "魔王" },
      null,
    ]);
  });

  it("replays nothing to a screen that connects mid-game", () => {
    expect(run(UNSEEN, [state(), state({ inBoss: true })])).toEqual([null, { kind: "boss", name: "魔王" }]);
    expect(run(UNSEEN, [state({ inBoss: true }), state({ inBoss: true })])).toEqual([null, null]);
    expect(run(UNSEEN, [state({ phase: "finished" })])).toEqual([null]);
  });

  it("does not replay the boss to a screen that reconnects after any team reached it", () => {
    expect(run(UNSEEN, [state({ otherInBoss: true }), state({ inBoss: true })])).toEqual([null, null]);
    expect(run(UNSEEN, [state({ inBoss: true, reveal: true }), state({ inBoss: true })])).toEqual([null, null]);
  });

  it("calls the boss right after the doors when the first question is already the boss's", () => {
    expect(run(IN_LOBBY, [state({ inBoss: true }), state({ inBoss: true })])).toEqual([{ kind: "open", team: "紅隊" }, { kind: "boss", name: "魔王" }]);
  });

  it("counts a phase card (no question, the boss drawn from the card) as the boss on screen", () => {
    const card = { ...state(), question: null, phaseCard: { monster: boss.monster } } as unknown as StateMessage;
    expect(run({ open: false, boss: false }, [card])).toEqual([{ kind: "boss", name: "魔王" }]);
  });
});
