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
  endFortune,
  endGame,
  fortunePool,
  resolveFortune,
  FORTUNE_INTRO_MS,
  FORTUNE_PAY,
  type FortuneEffect,
  type Team,
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
  const scene = { feast: "chest", rotten: "chest", spring: "spring", curse: "idol", blessing: "fairy", great: "fortune", good: "fortune", bad: "fortune", fortune: "fortune" }[outcome];
  const entered = enterEventRoom(after, "t0", { scene, outcome } as RoomEvent);
  // Back to t0's turn: t1 answers so the turn comes round.
  return answerQuestion(entered, "t1", entered.teams[1].currentQuestionId, false, "retry", first).game;
}

const team = (g: GameState, id = "t0") => g.teams.find((t) => t.id === id)!;

/** An rng that returns `xs` in order, then the last one forever. */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)];
};

// Value: protects=the 3-scene deck (fortune-teller.md G3, G2): chest, statue and fortune teller 1/3 each, each scene's two
// outcomes 1/2, the spring and fairy never drawn, and an empty condition pool redrawing chest or statue; fails_when=the old
// six-event deck or the old lots come back, or an empty pool still shows the fortune teller; seam=none; no_claim=the pool's
// own rules (below)
describe("drawEvent (3-scene deck)", () => {
  it("draws chest, statue and fortune teller evenly, each scene's outcomes half and half", () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Two teams that have each fled once: the fortune teller always has a condition.
    const g = { ...game(), teams: game().teams.map((t) => ({ ...t, flees: 1 })) };
    const counts: Record<string, number> = {};
    const N = 60000;
    for (let i = 0; i < N; i++) {
      const e = drawEvent(g, "t0", rng);
      counts[e.outcome] = (counts[e.outcome] ?? 0) + 1;
    }
    for (const o of ["feast", "rotten", "curse", "blessing"]) expect(counts[o] / N).toBeCloseTo(1 / 6, 1);
    expect(counts.fortune / N).toBeCloseTo(1 / 3, 1);
    for (const o of ["spring", "great", "good", "bad"]) expect(counts[o]).toBeUndefined();
  });

  it("maps the start of the range to the chest, the middle to the statue, the end to the fortune teller", () => {
    const g = { ...game(), teams: game().teams.map((t) => ({ ...t, flees: 1 })) };
    expect(drawEvent(g, "t0", () => 0)).toEqual({ scene: "chest", outcome: "feast" });
    expect(drawEvent(g, "t0", seq(0, 0.7))).toEqual({ scene: "chest", outcome: "rotten" });
    expect(drawEvent(g, "t0", seq(0.5, 0.2))).toEqual({ scene: "idol", outcome: "blessing" });
    expect(drawEvent(g, "t0", seq(0.5, 0.9))).toEqual({ scene: "idol", outcome: "curse" });
    expect(drawEvent(g, "t0", () => 0.9999)).toEqual({ scene: "fortune", outcome: "fortune", fortune: { condition: "flees", value: 1, matchIds: ["t0", "t1"] } });
  });

  it("G2: on the first round the pool is empty, so the fortune teller gives way to the chest or the statue", () => {
    const g = game();
    expect(fortunePool(g, "t0")).toEqual([]);
    expect(drawEvent(g, "t0", seq(0.9, 0.2, 0.2))).toEqual({ scene: "chest", outcome: "feast" });
    expect(drawEvent(g, "t0", seq(0.9, 0.7, 0.7))).toEqual({ scene: "idol", outcome: "curse" });
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

  it("a chef gets 20% more from what an event gives, never from what it takes", () => {
    const { result } = openEvent(inEvent("great", game(["chef", undefined])), "t0", first);
    expect(result).toMatchObject({ satiety: 30, chefBonus: 5 });
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
describe("叉路 (branch-fork.md)", () => {
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

// Value: protects=the fortune teller's condition pool (fortune-teller.md G2, Conditions): ≥2 teams above 0 or a highest value
// of 2, no mystery-room count on the game's first mystery room, the drawing team's +1, ties all matching, every team counted;
// fails_when=a lone 1 enters the pool, the first mystery room draws the mystery count, or a tie drops a team; seam=none;
// no_claim=the deck's odds (drawEvent above)
describe("占卜師 condition pool (fortune-teller.md)", () => {
  const withTeams = (patches: Partial<Team>[]) => {
    const g = game(patches.map(() => undefined));
    return { ...g, teams: g.teams.map((t, i) => ({ ...t, ...patches[i] })) };
  };

  it("a condition needs two teams above 0, or a highest value of at least 2", () => {
    expect(fortunePool(withTeams([{ flees: 1 }, {}]), "t0")).toEqual([]);
    expect(fortunePool(withTeams([{ flees: 1 }, { flees: 1 }]), "t0")).toEqual(["flees"]);
    expect(fortunePool(withTeams([{ flees: 2 }, {}]), "t0")).toEqual(["flees"]);
  });

  it("reads every counter: 20s, 1s, flees, potions, wrong, correct, distinct dishes, rotten dishes", () => {
    const g = withTeams([
      { natural20s: 2, natural1s: 2, flees: 2, potionsDrunk: 2, wrongAnswers: 2, correctAnswers: 2, dishes: ["a", "a", "b"], events: ["rotten", "rotten"] },
      {},
    ]);
    expect(fortunePool(g, "t1")).toEqual(["natural20s", "natural1s", "flees", "potions", "wrong", "correct", "mystery", "dishes", "rotten"]);
  });

  it("the mystery-room count never on the game's first mystery room; after it the drawing team counts this one", () => {
    const first = withTeams([{}, {}]);
    expect(fortunePool(first, "t0")).not.toContain("mystery");
    // t1 opened one before: t0's +1 ties it, two teams above 0.
    const later = withTeams([{}, { events: ["feast"] }]);
    expect(fortunePool(later, "t0")).toContain("mystery");
    expect(drawEvent(later, "t0", seq(0.9, 0))).toEqual({ scene: "fortune", outcome: "fortune", fortune: { condition: "mystery", value: 1, matchIds: ["t0", "t1"] } });
  });

  it("every team tied on the highest value matches, offline and boss-room teams too", () => {
    const g = setTeamOnline(withTeams([{ flees: 3 }, { flees: 3 }, { flees: 1 }]), "t1", false);
    const boss = { ...g, teams: g.teams.map((t) => (t.id === "t1" ? { ...t, inBoss: true } : t)) };
    expect(drawEvent(boss, "t2", () => 0.99).fortune).toEqual({ condition: "flees", value: 3, matchIds: ["t0", "t1"] });
  });
});

// Value: protects=the fortune's turn and record (fortune-teller.md E3/G8, R2, R11): ❓ only marks the team, the turn stays on
// it offline, the pick opens the event at once (events, turns, next room, the turn passes), "fortune" itself gives nothing,
// the boss door still walks the team in, and the game's end clears it; fails_when=the event opens before the pick, the turn
// moves early, openEvent falls into the curse branch, a second pick lands, or the fortune outlives the game; seam=none;
// no_claim=the room's steps, clock and STATE (lib/room/fortune-teller.test.ts)
describe("占卜師 turn and resolveFortune (fortune-teller.md)", () => {
  /** t0 at a choosing fork; both teams have fled once, so ❓ on rng 0.99 is the fortune teller on 逃跑最多次. */
  function forkGame(g = game()): GameState {
    const fled = { ...g, teams: g.teams.map((t) => ({ ...t, flees: 1 })) };
    const { game: after } = answerQuestion(fled, "t0", fled.teams[0].currentQuestionId, true, "retry", first);
    const back = answerQuestion(enterFork(after, "t0"), "t1", after.teams[1].currentQuestionId, false, "retry", first).game;
    return startForkChoice(back, "t0", 1000, "left");
  }
  const drawn = (g = game()) => chooseFork(forkGame(g), "t0", "right", () => 0.99).game;

  it("❓ on the fortune teller marks the team and opens nothing: no result, no events, the turn stays", () => {
    const before = forkGame();
    const { game: g, result } = chooseFork(before, "t0", "right", () => 0.99);
    expect(result).toBeUndefined();
    expect(g.fortune).toEqual({ teamId: "t0", condition: "flees", value: 1, matchIds: ["t0", "t1"] });
    expect(team(g).event).toMatchObject({ scene: "fortune", outcome: "fortune" });
    expect(team(g).events).toBeUndefined();
    expect(team(g)).toMatchObject({ roomIndex: team(before).roomIndex, turns: team(before).turns });
    expect(currentTurnTeamId(g)).toBe("t0");
    expect(currentTurnTeamId(setTeamOnline(g, "t0", false))).toBe("t0");
  });

  it("the pick opens the event at once: events, turns, next room, the turn passes, the record is written", () => {
    const g = drawn();
    const done = resolveFortune(g, "blessing", false, first);
    expect(team(done)).toMatchObject({ events: ["fortune"], turns: team(g).turns! + 1, roomIndex: team(g).roomIndex + 1, reward: team(g).reward });
    expect(team(done).event).toBeUndefined();
    expect(done.fortune).toMatchObject({ effect: "blessing" });
    expect(team(done).fortunes).toEqual([{ condition: "flees", value: 1, matchIds: ["t0", "t1"], effect: "blessing", self: true }]);
    expect(currentTurnTeamId(done)).toBe("t1");
    expect(() => resolveFortune(done, "curse", false, first)).toThrow("no_fortune");
    expect(endFortune(done).fortune).toBeUndefined();
  });

  it("the drawing team offline still resolves on timeout", () => {
    const g = setTeamOnline(drawn(), "t0", false);
    const done = resolveFortune(g, "potion", true, first);
    expect(done.fortune).toMatchObject({ effect: "potion", timeout: true });
    expect(team(done).fortunes?.[0]).toMatchObject({ timeout: true });
    expect(currentTurnTeamId(done)).toBe("t1");
  });

  it("openEvent gives nothing for \"fortune\" itself: no boon, no satiety, no ability use", () => {
    const g = inEvent("fortune");
    const { game: opened, result } = openEvent(g, "t0", first);
    expect(result).toMatchObject({ outcome: "fortune", satiety: 0 });
    expect(result.boon).toBeUndefined();
    expect(team(opened).boon).toBeUndefined();
    expect(team(opened).abilityUses).toBe(team(g).abilityUses);
  });

  it("with the boss door open the drawing team walks into the boss room and gets nothing itself", () => {
    const g = sendToBoss(drawn(game(["chef", undefined])), "t1");
    const done = resolveFortune(g, "potion", false, first);
    expect(team(done)).toMatchObject({ inBoss: true, reward: team(g).reward, item: "luckyPotion" });
  });

  it("the game's end clears a running fortune", () => {
    expect(endGame(drawn(), first).fortune).toBeUndefined();
  });

  it("the game log lists each fortune with its record", () => {
    const done = resolveFortune(drawn(), "curse", true, first);
    expect(gameLog(done, 0).teams[0].fortunes).toEqual([{ condition: "flees", value: 1, matchIds: ["t0", "t1"], effect: "curse", timeout: true, self: true }]);
    expect(gameLog(done, 0).teams[1].fortunes).toEqual([]);
  });
});

// Value: protects=the five effects' rules (fortune-teller.md Effects, E11, R17): boons replace, a held potion stays, tribute
// splits 10 a payer between the matching teams with the remainder dropped, relief pays 20 a matched non-receiver to the
// lowest teams with the remainder kept, a matched receiver never pays, no chef bonus; fails_when=a payer pays twice, a
// remainder comes back, the lowest team pays itself, or a chef makes satiety out of nothing; seam=none; no_claim=💫 暈眩
// (its own commit)
describe("占卜師 effects (fortune-teller.md)", () => {
  /** A fortune on t0's turn matching `matchIds`, with each team's reward set; t0 holds the fortune event. */
  function at(rewards: number[], matchIds: string[], patch: (t: Team) => Partial<Team> = () => ({}), classIds?: (ClassId | undefined)[]): GameState {
    const g = game(classIds ?? rewards.map(() => undefined));
    const teams = g.teams.map((t, i) => ({ ...t, reward: rewards[i], ...patch(t), ...(t.id === "t0" ? { event: { scene: "fortune" as const, outcome: "fortune" as const } } : {}) }));
    return { ...g, teams, fortune: { teamId: "t0", condition: "flees", value: 1, matchIds } };
  }
  const rewards = (g: GameState) => g.teams.map((t) => t.reward);
  const apply = (g: GameState, e: FortuneEffect) => resolveFortune(g, e, false, first);

  it("pins the amounts", () => {
    expect(FORTUNE_PAY).toEqual({ tribute: 10, relief: 20 });
    expect(FORTUNE_INTRO_MS).toBe(3000);
  });

  it("blessing and curse replace any boon on every matching team", () => {
    const g = at([0, 0, 0], ["t1", "t2"], (t) => (t.id === "t1" ? { boon: "curse" } : {}));
    expect(apply(g, "blessing").teams.map((t) => t.boon)).toEqual([undefined, "blessing", "blessing"]);
    expect(apply(g, "curse").teams.map((t) => t.boon)).toEqual([undefined, "curse", "curse"]);
  });

  it("a potion goes to each matching team without one; a held one is unchanged", () => {
    const g = at([0, 0, 0], ["t1", "t2"], (t) => (t.id === "t1" ? { item: "luckyPotion", itemArmedFor: "x" } : {}));
    const done = apply(g, "potion");
    expect(done.teams.map((t) => t.item)).toEqual([undefined, "luckyPotion", "luckyPotion"]);
    expect(team(done, "t1").itemArmedFor).toBe("x");
  });

  it("tribute: one team out of four pays only 10, split 2 each, the remainder not paid out", () => {
    const done = apply(at([50, 50, 50, 50, 50], ["t0", "t1", "t2", "t3"]), "tribute");
    expect(rewards(done)).toEqual([52, 52, 52, 52, 40]);
  });

  it("tribute: a team short of 10 pays all it has, 0 pays nothing, and paying 1 never gets 2 back", () => {
    expect(rewards(apply(at([0, 3, 0], ["t0"]), "tribute"))).toEqual([3, 0, 0]);
    // 10 + 1 between two matching teams: 5 each, the 1 is gone.
    expect(rewards(apply(at([0, 0, 10, 1], ["t0", "t1"]), "tribute"))).toEqual([5, 5, 0, 0]);
  });

  it("tribute: every team matching moves nothing", () => {
    expect(rewards(apply(at([10, 20], ["t0", "t1"]), "tribute"))).toEqual([10, 20]);
  });

  it("relief: each matching team pays 20 to the lowest teams, split evenly, the remainder kept", () => {
    // t2 is lowest: t0 and t1 match and pay 20 each.
    expect(rewards(apply(at([50, 30, 5], ["t0", "t1"]), "relief"))).toEqual([30, 10, 45]);
    // Three lowest receivers: 20 splits 6 each, the payer keeps 2.
    expect(rewards(apply(at([50, 0, 0, 0], ["t0"]), "relief"))).toEqual([32, 6, 6, 6]);
  });

  it("relief: a payer short of 20 pays what splits evenly, maybe nothing", () => {
    expect(rewards(apply(at([7, 0, 0], ["t0"]), "relief"))).toEqual([1, 3, 3]);
    expect(rewards(apply(at([1, 0, 0], ["t0"]), "relief"))).toEqual([1, 0, 0]);
  });

  it("relief: a matching team on the lowest list pays nothing, two tied lowest both; a receiver list of only itself moves nothing", () => {
    expect(rewards(apply(at([3, 3, 40], ["t0", "t1"]), "relief"))).toEqual([3, 3, 40]);
    expect(rewards(apply(at([2, 30], ["t0"]), "relief"))).toEqual([2, 30]);
  });

  it("no chef bonus on any effect, and the fortune teller gives the drawing team nothing", () => {
    const done = apply(at([0, 40], ["t1"], () => ({}), ["chef", "chef"]), "relief");
    expect(rewards(done)).toEqual([20, 20]);
  });
});
