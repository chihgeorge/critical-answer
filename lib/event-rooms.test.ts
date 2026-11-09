import { describe, it, expect } from "vitest";
import {
  answerQuestion,
  armSneak,
  chooseFork,
  drinkPotion,
  enterFork,
  giveItem,
  setTeamOnline,
  startForkChoice,
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
describe("岔路 (branch-fork.md)", () => {
  /** t0 answers right and comes to a fork; t1 answers wrong, so it is t0's turn again. `choosing` starts its clock, ⚔️ on the left. */
  function atForkGame(choosing = true, g = game()): GameState {
    const { game: after } = answerQuestion(g, "t0", g.teams[0].currentQuestionId, true, "retry", first);
    const forked = enterFork(after, "t0");
    const back = answerQuestion(forked, "t1", forked.teams[1].currentQuestionId, false, "retry", first).game;
    return choosing ? startForkChoice(back, "t0", 1000, "left") : back;
  }

  it("enterFork waits with nothing drawn and is no turn; never in the boss room", () => {
    const g = game();
    const { game: after } = answerQuestion(g, "t0", g.teams[0].currentQuestionId, true, "retry", first);
    const forked = enterFork(after, "t0");
    expect(team(forked).fork).toEqual({ phase: "waiting" });
    expect(team(forked).event).toBeUndefined();
    expect(team(forked).turns).toBe(team(after).turns);
    expect(() => enterFork(sendToBoss(after, "t0"), "t0")).toThrow(InvalidActionError);
    expect(() => startForkChoice(after, "t0", 1, "left")).toThrow("no_fork");
  });

  it("a choosing team keeps the turn offline; a waiting one is skipped and keeps waiting", () => {
    const choosing = setTeamOnline(atForkGame(), "t0", false);
    expect(currentTurnTeamId(choosing)).toBe("t0");
    const waiting = setTeamOnline(atForkGame(false), "t0", false);
    expect(currentTurnTeamId(waiting)).toBe("t1");
    expect(team(waiting).fork).toEqual({ phase: "waiting" });
  });

  it("⚔️ and timeout: the held question, turns and room stay; the mark is monster; forks records side, door, timeout", () => {
    const g = atForkGame();
    for (const [choice, record] of [["left", { side: "left", door: "monster" }], ["timeout", { side: "left", door: "monster", timeout: true }]] as const) {
      const { game: chosen, result, record: got } = chooseFork(g, "t0", choice, first);
      expect(result).toBeUndefined();
      expect(got).toEqual(record);
      expect(team(chosen)).toMatchObject({ fork: { phase: "monster" }, forks: [record], currentQuestionId: team(g).currentQuestionId, turns: team(g).turns, roomIndex: team(g).roomIndex });
      expect(currentTurnTeamId(chosen)).toBe("t0");
    }
  });

  it("❓ draws the event now and opens it, as openEvent does: effect, next room, the turn passes", () => {
    const g = atForkGame();
    const { game: chosen, result } = chooseFork(g, "t0", "right", first);
    // rng 0 draws the chest's feast.
    expect(result).toMatchObject({ teamId: "t0", outcome: "feast", satiety: 20 });
    expect(team(chosen)).toMatchObject({ forks: [{ side: "right", door: "mystery" }], events: ["feast"], roomIndex: team(g).roomIndex + 1, reward: team(g).reward + 20 });
    expect(team(chosen).fork).toBeUndefined();
    expect(team(chosen).event).toBeUndefined();
    expect(currentTurnTeamId(chosen)).toBe("t1");
  });

  it("❓ once a team is in the boss room walks the team in", () => {
    const g = sendToBoss(atForkGame(), "t1");
    const { result, game: chosen } = chooseFork(g, "t0", "right", first);
    expect(result?.entersBoss).toBe(true);
    expect(team(chosen).inBoss).toBe(true);
  });

  it("only the turn's team, only while choosing", () => {
    expect(() => chooseFork(atForkGame(false), "t0", "left", first)).toThrow("no_fork");
    expect(() => chooseFork(atForkGame(), "t1", "left", first)).toThrow(InvalidActionError);
  });

  it("at a fork a team cannot answer, submit, use an ability or drink; with the ⚔️ mark it can", () => {
    for (const g of [atForkGame(false, game(["thief", undefined])), atForkGame(true, game(["thief", undefined]))]) {
      const q = team(g).currentQuestionId;
      expect(() => answerQuestion(g, "t0", q, true, "retry", first)).toThrow("fork");
      expect(() => submitText(g, "t0", q, "x")).toThrow("fork");
      expect(() => armSneak(g, "t0")).toThrow("fork");
      expect(() => drinkPotion(giveItem(g, "t0"), "t0")).toThrow("fork");
    }
    const monster = chooseFork(atForkGame(true, game(["thief", undefined])), "t0", "left", first).game;
    expect(() => armSneak(monster, "t0")).not.toThrow();
  });

  it("the ⚔️ mark stays through a wrong answer and a flee, and goes on the correct answer, the boss room's too", () => {
    const monster = chooseFork(atForkGame(), "t0", "left", first).game;
    const wrong = answerQuestion(monster, "t0", team(monster).currentQuestionId, false, "flee", first).game;
    expect(team(wrong).fork).toEqual({ phase: "monster" });
    const back = answerQuestion(wrong, "t1", team(wrong, "t1").currentQuestionId, false, "retry", first).game;
    const right = answerQuestion(back, "t0", team(back).currentQuestionId, true, "retry", first).game;
    expect(team(right).fork).toBeUndefined();
    // Into the boss room (no roll there): the mark goes too.
    const boss = sendToBoss(monster, "t1");
    const intoBoss = answerQuestion(boss, "t0", team(boss).currentQuestionId, true, "retry", first).game;
    expect(team(intoBoss).inBoss).toBe(true);
    expect(team(intoBoss).fork).toBeUndefined();
  });

  it("a send to the boss drops a fork in any phase", () => {
    for (const g of [atForkGame(false), atForkGame(), chooseFork(atForkGame(), "t0", "left", first).game]) expect(team(sendToBoss(g, "t0")).fork).toBeUndefined();
  });

  it("the view says waiting or choosing, never the ⚔️ mark, never anything behind a door", () => {
    expect(getSpectatorView(atForkGame(false)).teams[0].fork).toBe("waiting");
    expect(getSpectatorView(atForkGame()).teams[0].fork).toBe("choosing");
    // Which side hides ⚔️ stays in the game state: no view carries it.
    expect(JSON.stringify(getSpectatorView(atForkGame()))).not.toMatch(/monsterSide|"left"|"right"/);
    expect(getSpectatorView(chooseFork(atForkGame(), "t0", "left", first).game).teams[0].fork).toBeUndefined();
  });

  it("a team waiting at a fork may be moved off a shared question and stays at the fork", () => {
    // One question per pool: both teams share theirs; t0's correct answer frees nothing for t1 to move to, so give d2 two.
    const g0 = createGame([{ id: "t0", name: "A" }, { id: "t1", name: "B" }, { id: "t2", name: "C" }], rooms(5), [["a"], ["b", "c"], ["d"], ["e"], ["f"]], ["b1", "b2"], { bossThreshold: 15 }, 3, first);
    const forked = { ...g0, teams: g0.teams.map((t) => (t.id === "t1" ? { ...t, fork: { phase: "waiting" as const } } : t)) };
    // t0 answers: splitShared runs and may move t1 (not on turn) off the shared question; its fork stays.
    const after = answerQuestion(forked, "t0", forked.teams[0].currentQuestionId, true, "retry", first).game;
    expect(team(after, "t1").fork).toEqual({ phase: "waiting" });
    expect(team(after, "t1").currentQuestionId).not.toBe(team(after, "t2").currentQuestionId);
  });

  it("the game log lists each team's doors", () => {
    const g = chooseFork(atForkGame(), "t0", "timeout", first).game;
    expect(gameLog(g, 0).teams[0].forks).toEqual([{ side: "left", door: "monster", timeout: true }]);
    expect(gameLog(g, 0).teams[1].forks).toEqual([]);
  });
});
