import { describe, it, expect } from "vitest";
import {
  answerQuestion,
  armSneak,
  createGame,
  currentTurnTeamId,
  drawEvent,
  enterEventRoom,
  eventEligible,
  getSpectatorView,
  openEvent,
  sendToBoss,
  submitText,
  EVENT_CHANCE,
  InvalidActionError,
  type ClassId,
  type EventOutcome,
  type GameState,
  type RoomEvent,
} from "./game-state";
import { gameLog } from "./game-log";

const first = () => 0;
const pools = (n: number) => [1, 2, 3, 4, 5].map((d) => Array.from({ length: n }, (_, i) => `d${d}-q${i + 1}`));
const rooms = (count: number) => Array.from({ length: count }, (_, i) => ({ baseDifficulty: (Math.min(i, 4) + 1) as 1 | 2 | 3 | 4 | 5, reward: 10 * (i + 1) }));

function game(classIds: (ClassId | undefined)[] = [undefined, undefined], roomCount = 5): GameState {
  const seeds = classIds.map((classId, i) => ({ id: `t${i}`, name: `Team ${i}`, ...(classId ? { classId } : {}) }));
  return createGame(seeds, rooms(roomCount), pools(6), ["b1", "b2"], { bossThreshold: 15 }, 3, first);
}

/** t0 answers right and walks into an event room holding `outcome`. */
function inEvent(outcome: EventOutcome, g = game()): GameState {
  const { game: after, outcome: o } = answerQuestion(g, "t0", g.teams[0].currentQuestionId, true, "retry", first);
  expect(eventEligible(after, o)).toBe(true);
  const scene = { feast: "chest", rotten: "chest", spring: "spring", curse: "idol", blessing: "fairy", great: "fortune", good: "fortune", bad: "fortune" }[outcome];
  const entered = enterEventRoom(after, "t0", { scene, outcome } as RoomEvent);
  // Back to t0's turn: t1 answers so the turn comes round.
  return answerQuestion(entered, "t1", entered.teams[1].currentQuestionId, false, "retry", first).game;
}

const team = (g: GameState, id = "t0") => g.teams.find((t) => t.id === id)!;

describe("drawEvent", () => {
  it("draws the six events evenly, the fortune teller's three lots within its sixth", () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const counts: Record<string, number> = {};
    const N = 60000;
    for (let i = 0; i < N; i++) {
      const e = drawEvent(rng);
      counts[e.outcome] = (counts[e.outcome] ?? 0) + 1;
    }
    for (const o of ["feast", "rotten", "spring", "curse", "blessing"]) expect(counts[o] / N).toBeCloseTo(1 / 6, 1);
    for (const o of ["great", "good", "bad"]) expect(counts[o] / N).toBeCloseTo(1 / 18, 1);
  });

  it("maps the chest to both dishes and the end of the range to a fortune lot", () => {
    expect(drawEvent(() => 0)).toEqual({ scene: "chest", outcome: "feast" });
    expect(drawEvent(() => 0.2)).toEqual({ scene: "chest", outcome: "rotten" });
    expect(drawEvent(() => 0.9999)).toEqual({ scene: "fortune", outcome: "bad" });
  });

  it("the room's chance is one in four", () => {
    expect(EVENT_CHANCE).toBe(0.25);
  });
});

describe("eventEligible", () => {
  it("never on entering the boss room or the last room", () => {
    const g = game([undefined, undefined], 3);
    const a = answerQuestion(g, "t0", g.teams[0].currentQuestionId, true, "retry", first);
    expect(eventEligible(a.game, a.outcome)).toBe(true); // room 0 → room 1 of 3
    const g2 = { ...a.game, currentTurnIndex: 0 };
    const b = answerQuestion(g2, "t0", g2.teams[0].currentQuestionId, true, "retry", first);
    expect(b.outcome.type === "correct-room-advance" && b.outcome.nextRoomIndex).toBe(2);
    expect(eventEligible(b.game, b.outcome)).toBe(false); // into the last room
    const boss = { ...game(), config: { bossThreshold: 1 } };
    const c = answerQuestion(boss, "t0", boss.teams[0].currentQuestionId, true, "retry", first);
    expect(eventEligible(c.game, c.outcome)).toBe(false);
    const wrong = answerQuestion(g, "t0", g.teams[0].currentQuestionId, false, "retry", first);
    expect(eventEligible(wrong.game, wrong.outcome)).toBe(false);
  });

  it("refuses an event in the boss room", () => {
    const g = sendToBoss(game(), "t0");
    expect(() => enterEventRoom(g, "t0", { scene: "spring", outcome: "spring" })).toThrow(InvalidActionError);
  });
});

describe("openEvent", () => {
  it("a feast gives 20, the turn passes and the team walks on to the next room's monster", () => {
    const g = inEvent("feast");
    expect(currentTurnTeamId(g)).toBe("t0");
    const before = team(g);
    const { game: after, result } = openEvent(g, "t0", first);
    expect(result).toEqual({ teamId: "t0", scene: "chest", outcome: "feast", satiety: 20 });
    const t = team(after);
    expect(t.reward).toBe(before.reward + 20);
    expect(t.score).toBe(before.score); // no progress points
    expect(t.roomIndex).toBe(before.roomIndex + 1);
    expect(t.event).toBeUndefined();
    expect(t.currentDifficulty).toBe(after.rooms[t.roomIndex].baseDifficulty);
    expect(after.pools[t.currentDifficulty - 1]).toContain(t.currentQuestionId);
    expect(t.turns).toBe((before.turns ?? 0) + 1);
    expect(t.events).toEqual(["feast"]);
    expect(currentTurnTeamId(after)).toBe("t1");
  });

  it("a chef gets 15% more from what an event gives, never from what it takes", () => {
    const { result } = openEvent(inEvent("great", game(["chef", undefined])), "t0", first);
    expect(result).toMatchObject({ satiety: 29, chefBonus: 4 });
  });

  it("once a team is in the boss room, opening an event walks the team into the boss room, effect and all", () => {
    const g = inEvent("feast");
    const open = { ...g, teams: g.teams.map((t) => (t.id === "t1" ? { ...t, inBoss: true } : t)) };
    const before = team(open);
    const { game: after, result } = openEvent(open, "t0", first);
    expect(result).toMatchObject({ satiety: 20, entersBoss: true });
    const t = team(after);
    expect(t.inBoss).toBe(true);
    expect(t.bossAt?.turns).toBe((before.turns ?? 0) + 1);
    // Through an event room is no earned entry: ⚡ 閃電突擊 counts only a team's own answer (podium-titles.md R2-3).
    expect(t.bossAt?.earned).toBeUndefined();
    expect(t.roomIndex).toBe(before.roomIndex);
    expect(t.reward).toBe(before.reward + 20);
    expect(t.event).toBeUndefined();
  });

  it("a rotten dish takes 10, never below 0", () => {
    const g = inEvent("rotten");
    expect(team(g).reward).toBe(10);
    const { game: after, result } = openEvent(g, "t0", first);
    expect(result.satiety).toBe(-10);
    expect(team(after).reward).toBe(0);
    const poor = { ...g, teams: g.teams.map((t) => (t.id === "t0" ? { ...t, reward: 4 } : t)) };
    expect(openEvent(poor, "t0", first).result.satiety).toBe(-4);
    const empty = { ...g, teams: g.teams.map((t) => (t.id === "t0" ? { ...t, reward: 0 } : t)) };
    expect(Object.is(openEvent(empty, "t0", first).result.satiety, 0)).toBe(true);
  });

  it("the spring (and 中吉) gives an ability use, or 10 to a chef or a team with no class", () => {
    const inSpring = inEvent("spring", game(["mage", undefined]));
    const mage = openEvent(inSpring, "t0", first);
    expect(mage.result).toMatchObject({ abilityUse: true, satiety: 0 });
    expect(team(mage.game).abilityUses).toBe(team(inSpring).abilityUses + 1);
    const none = openEvent(inEvent("good"), "t0", first);
    expect(none.result).toMatchObject({ satiety: 10 });
    expect(none.result.abilityUse).toBeUndefined();
    expect(openEvent(inEvent("spring", game(["chef", undefined])), "t0", first).result).toMatchObject({ satiety: 12, chefBonus: 2 });
  });

  it("a curse halves the next correct answer's base once, a blessing adds half; a wrong answer keeps it", () => {
    for (const [outcome, reward] of [["curse", 15], ["bad", 15], ["blessing", 45]] as const) {
      const opened = openEvent(inEvent(outcome), "t0", first).game; // t0 now in room 2 (reward 30)
      expect(team(opened).boon).toBe(outcome === "blessing" ? "blessing" : "curse");
      expect(getSpectatorView(opened).teams[0].boon).toBe(team(opened).boon);
      // t1 plays, then t0 answers wrong (kept), t1 plays, then t0 answers right.
      let g = answerQuestion(opened, "t1", team(opened, "t1").currentQuestionId, false, "retry", first).game;
      g = answerQuestion(g, "t0", team(g).currentQuestionId, false, "retry", first).game;
      expect(team(g).boon).toBeDefined();
      g = answerQuestion(g, "t1", team(g, "t1").currentQuestionId, false, "retry", first).game;
      const before = team(g).reward;
      const right = answerQuestion(g, "t0", team(g).currentQuestionId, true, "retry", first);
      expect(team(right.game).reward - before).toBe(reward);
      expect(team(right.game).boon).toBeUndefined();
    }
  });

  it("a curse does not stack with a natural-1 check: the base is halved once", () => {
    const opened = openEvent(inEvent("curse"), "t0", first).game;
    let g = answerQuestion(opened, "t1", team(opened, "t1").currentQuestionId, false, "retry", first).game;
    const q = team(g).currentQuestionId;
    g = { ...g, checks: { [`${q}:t0`]: { value: 1, bonus: 1, dc: 12, passed: false } } };
    const right = answerQuestion(g, "t0", q, true, "retry", first);
    expect(right.outcome.type === "correct-room-advance" && right.outcome.reward).toBe(15);
  });

  it("only the turn's team, only with an event", () => {
    const g = inEvent("feast");
    expect(() => openEvent(g, "t1", first)).toThrow(InvalidActionError);
    const opened = openEvent(g, "t0", first).game;
    expect(() => openEvent(opened, "t1", first)).toThrow("no_event");
  });

  it("a team in an event room cannot answer, submit or use an ability", () => {
    const g = inEvent("feast", game(["thief", undefined]));
    const q = team(g).currentQuestionId;
    expect(() => answerQuestion(g, "t0", q, true, "retry", first)).toThrow("event_room");
    expect(() => submitText(g, "t0", q, "x")).toThrow("event_room");
    expect(() => armSneak(g, "t0")).toThrow("event_room");
  });

  it("the broadcast view shows the scene, never the outcome", () => {
    const view = getSpectatorView(inEvent("rotten"));
    expect(view.teams[0].eventScene).toBe("chest");
    expect(JSON.stringify(view)).not.toContain("rotten");
  });

  it("sending a team in an event room to the boss drops its event", () => {
    const g = sendToBoss(inEvent("feast"), "t0");
    expect(team(g).event).toBeUndefined();
    expect(team(g).inBoss).toBe(true);
  });

  it("a snapshot keeps the drawn event: a JSON round trip opens to the same outcome", () => {
    const g = inEvent("great");
    const restored = JSON.parse(JSON.stringify(g)) as GameState;
    expect(team(restored).event).toEqual({ scene: "fortune", outcome: "great" });
    expect(openEvent(restored, "t0", first).result.satiety).toBe(25);
  });

  it("the game log lists each team's events", () => {
    const opened = openEvent(inEvent("curse"), "t0", first).game;
    const log = gameLog(opened, 0);
    expect(log.teams[0].events).toEqual(["curse"]);
    expect(log.teams[1].events).toEqual([]);
  });
});
