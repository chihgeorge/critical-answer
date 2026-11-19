// 抓包與神諭 in the game state (docs/designs/anti-ai-cheating.md): the switch, the oracle, the catch and its rulings.
import { describe, expect, it } from "vitest";
import {
  addLateTeam,
  answerQuestion,
  sneakRoll,
  startSneak,
  askOracle,
  cancelCatch,
  CATCH_PAY,
  createGame,
  currentTurnTeamId,
  dismissCatch,
  endGame,
  enterFork,
  fileCatch,
  getSpectatorView,
  giveItem,
  recordWrongLock,
  sendToBoss,
  setAntiCheat,
  setTeamOnline,
  submitText,
  upholdCatch,
  warriorRoll,
  type ClassId,
  type GameState,
} from "./game-state";
import { gameLog } from "./game-log";

const first = () => 0;
const QS = Array.from({ length: 12 }, (_, i) => `q${i + 1}`);

/** 甲 乙 丙 (甲 on turn), three rooms of difficulty 2 paying 20 each, one pool per difficulty. */
function game(classes: (ClassId | undefined)[] = []): GameState {
  const rooms = [1, 2, 3].map(() => ({ baseDifficulty: 2 as const, reward: 20 }));
  const pools = [QS.slice(0, 4), QS.slice(4, 12), [], [], []];
  return createGame(
    ["a", "b", "c"].map((id, i) => ({ id, name: ["甲", "乙", "丙"][i], ...(classes[i] ? { classId: classes[i] } : {}) })),
    rooms,
    pools,
    ["boss1"],
    { bossThreshold: 100 },
    3,
    first,
  );
}
const on = (classes?: (ClassId | undefined)[]) => setAntiCheat(game(classes), true);
const team = (g: GameState, id: string) => g.teams.find((t) => t.id === id)!;
const q = (g: GameState, id = "a") => team(g, id).currentQuestionId;
const refused = (f: () => unknown, why: string) => expect(f).toThrow(why);

describe("the switch", () => {
  it("is off by default: both actions are refused and the view says nothing", () => {
    const g = game();
    refused(() => askOracle(g, "a", q(g)), "anti_cheat_off");
    refused(() => fileCatch(g, "b", q(g)), "anti_cheat_off");
    expect(getSpectatorView(g).antiCheat).toBeUndefined();
    expect(getSpectatorView(g).teams[0]).not.toHaveProperty("catchesLeft");
  });

  it("on gives every team 1 oracle and 2 catches once; off and on again refills nothing", () => {
    let g = on();
    expect(g.teams.map((t) => [t.oracleLeft, t.catchesLeft])).toEqual([[1, 2], [1, 2], [1, 2]]);
    g = askOracle(g, "a", q(g));
    g = setAntiCheat(setAntiCheat(g, false), true);
    expect(team(g, "a").oracleLeft).toBe(0);
    expect(g.antiCheat).toMatchObject({ on: true, onCount: 2 });
    expect(setAntiCheat(g, true)).toBe(g);
  });

  it("off calls an open catch off and gives the use back; an oracle already asked keeps halving", () => {
    let g = on();
    g = askOracle(g, "a", q(g));
    g = setAntiCheat(g, false);
    const paid = answerQuestion(g, "a", q(g), true, "retry", first).game;
    expect(team(paid, "a").reward).toBe(10);
    let c = fileCatch(advanceToB(on()), "a", q(advanceToB(on()), "b"));
    c = setAntiCheat(c, false);
    expect(c.antiCheat?.openCatch).toBeUndefined();
    expect(team(c, "a")).toMatchObject({ catchesLeft: 2, catchesFiled: 1, catchesCancelled: 1 });
  });

  it("a late team gets its uses on admission while on, or at the next switch-on", () => {
    const late = addLateTeam(on(), { id: "d", name: "丁" }, first);
    expect(team(late, "d")).toMatchObject({ oracleLeft: 1, catchesLeft: 2 });
    const before = addLateTeam(game(), { id: "d", name: "丁" }, first);
    expect(team(before, "d").catchesLeft).toBeUndefined();
    expect(team(setAntiCheat(before, true), "d")).toMatchObject({ oracleLeft: 1, catchesLeft: 2 });
  });
});

/** 甲 answers wrong and retries: 乙 is on turn. */
function advanceToB(g: GameState) {
  return answerQuestion(g, "a", q(g), false, "retry", first).game;
}

describe("🔮 the oracle", () => {
  it("halves a correct answer through `halved`, once a game, and never quarters on top of a curse", () => {
    let g = askOracle(on(), "a", q(on()));
    refused(() => askOracle(g, "a", q(g)), "oracle_used");
    expect(team(answerQuestion(g, "a", q(g), true, "retry", first).game, "a").reward).toBe(10);
    g = { ...g, teams: g.teams.map((t) => (t.id === "a" ? { ...t, boon: "curse" as const } : t)) };
    expect(team(answerQuestion(g, "a", q(g), true, "retry", first).game, "a").reward).toBe(10);
  });

  it("only on the team's own turn, before its answer is in: not off turn, at a fork, in a buzz", () => {
    const g = on();
    refused(() => askOracle(g, "b", q(g, "b")), "not_your_turn");
    refused(() => askOracle(g, "a", "q9"), "stale_question");
    refused(() => askOracle(submitText(g, "a", q(g), "答"), "a", q(g)), "answer_submitted");
    refused(() => askOracle(recordWrongLock(g, "a", q(g), 1), "a", q(g)), "answer_pending");
    refused(() => askOracle(enterFork(g, "a"), "a", q(g)), "fork");
    const buzz = { ...g, boss: { ...g.boss, phases: [{ ...g.boss.phases[0], buzzer: true as const }] } };
    refused(() => askOracle(buzz, "a", q(g)), "buzzer_phase");
    const picking = { ...g, fortune: { teamId: "a" } as never };
    refused(() => askOracle(picking, "a", q(g)), "fortune");
    refused(() => fileCatch(picking, "b", q(g)), "fortune");
  });

  it("follows the team's question across 下輪再答 and another team's turn and a JSON save, still halved and not catchable", () => {
    let g = askOracle(on(), "a", q(on()));
    const id = q(g);
    g = advanceToB(g);
    g = askOracle(g, "b", q(g, "b"));
    g = answerQuestion(g, "b", q(g, "b"), false, "retry", first).game;
    g = answerQuestion(g, "c", q(g, "c"), false, "retry", first).game;
    g = JSON.parse(JSON.stringify(g));
    expect(currentTurnTeamId(g)).toBe("a");
    expect(getSpectatorView(g).teams[0].oracle).toBe(true);
    refused(() => fileCatch(g, "b", id), "oracle_question");
    expect(team(answerQuestion(g, "a", id, true, "retry", first).game, "a").reward).toBe(10);
  });

  it("is cleared by a flee, so the same id dealt again later never revives it", () => {
    let g = askOracle(on(), "a", q(on()));
    const id = q(g);
    g = answerQuestion(g, "a", id, false, "flee", first).game;
    expect(team(g, "a").oracleQ).toBeUndefined();
    const back = { ...g, teams: g.teams.map((t) => (t.id === "a" ? { ...t, currentQuestionId: id } : t)) };
    expect(getSpectatorView(back).teams[0].oracle).toBeUndefined();
  });

  it("goes with a team sent to the boss room: its boss hit is not halved", () => {
    let g = askOracle(on(), "a", q(on()));
    g = sendToBoss(g, "a", first);
    expect(team(g, "a").oracleQ).toBeUndefined();
    const hit = answerQuestion(g, "a", g.boss.currentQuestionId, true, "retry", first).game;
    expect(team(hit, "a").reward).toBe(15); // an unrated boss question's whole hit
  });
});

describe("🚨 the catch", () => {
  it("the reporter's use goes, the turn is held for the accused even offline, and the view shows it", () => {
    let g = fileCatch(on(), "b", q(on()));
    expect(g.antiCheat?.openCatch).toEqual({ by: "b", teamId: "a", questionId: q(g) });
    expect(team(g, "b")).toMatchObject({ catchesLeft: 1, catchesFiled: 1 });
    g = setTeamOnline(g, "a", false);
    expect(currentTurnTeamId(g)).toBe("a");
    expect(getSpectatorView(g).antiCheat).toMatchObject({ on: true, openCatch: { by: "b", teamId: "a" }, caught: true });
  });

  it("is refused on oneself, on a stale question, on a wrong lock waiting, and a second time while open", () => {
    const g = on();
    refused(() => fileCatch(g, "a", q(g)), "self_catch");
    refused(() => fileCatch(g, "b", "q9"), "stale_question");
    refused(() => fileCatch(recordWrongLock(g, "a", q(g), 1), "b", q(g)), "answer_pending");
    refused(() => fileCatch(fileCatch(g, "b", q(g)), "c", q(g)), "catch_pending");
  });

  it("a team already in the boss room may report", () => {
    const g = sendToBoss(on(), "c", first);
    expect(fileCatch(g, "c", q(g)).antiCheat?.openCatch?.by).toBe("c");
  });

  it("one catch per question-turn: refused again after a ruling, allowed on the 下輪再答 turn", () => {
    let g = dismissCatch(fileCatch(on(), "b", q(on()))).game;
    refused(() => fileCatch(g, "c", q(g)), "already_caught");
    g = answerQuestion(g, "a", q(g), false, "retry", first).game;
    g = answerQuestion(g, "b", q(g, "b"), false, "retry", first).game;
    g = answerQuestion(g, "c", q(g, "c"), false, "retry", first).game;
    expect(fileCatch(g, "c", q(g)).antiCheat?.openCatch?.by).toBe("c");
  });

  it("two catches a game", () => {
    let g = dismissCatch(fileCatch(on(), "b", q(on()))).game;
    g = answerQuestion(g, "a", q(g), false, "retry", first).game;
    g = answerQuestion(g, "b", q(g, "b"), false, "retry", first).game;
    g = dismissCatch(fileCatch(g, "a", q(g, "c"))).game;
    g = answerQuestion(g, "c", q(g, "c"), false, "retry", first).game;
    g = dismissCatch(fileCatch(g, "b", q(g))).game;
    g = answerQuestion(g, "a", q(g), false, "retry", first).game;
    g = answerQuestion(g, "b", q(g, "b"), false, "retry", first).game;
    refused(() => fileCatch(g, "b", q(g, "c")), "no_catches");
  });
});

describe("🚨 成立 (upholdCatch)", () => {
  it("reveals the question, makes the accused flee it without a flee credit, counts a wrong answer, −10 / +15 flat", () => { // pregate-literal: CHEF_BONUS_PERCENT=15 the anti-cheat +15, not the chef
    let g = on([undefined, "chef"]);
    g = { ...g, teams: g.teams.map((t) => (t.id === "a" ? { ...t, reward: 25 } : t)) };
    const id = q(g);
    const { game: after, outcome } = upholdCatch(fileCatch(g, "b", id), first);
    expect(outcome.type).toBe("incorrect-flee");
    expect(after.revealedQuestionIds).toContain(id);
    expect(team(after, "a")).toMatchObject({ reward: 25 - CATCH_PAY.caught, wrongAnswers: 1, turns: 1, currentDifficulty: 1 });
    expect(team(after, "a").flees).toBeUndefined();
    expect(team(after, "a").currentQuestionId).not.toBe(id);
    expect(team(after, "b")).toMatchObject({ reward: CATCH_PAY.bounty, catchesUpheld: 1 });
    expect(after.antiCheat?.openCatch).toBeUndefined();
    expect(currentTurnTeamId(after)).toBe("b");
  });

  it("never takes the accused below 0, uses up an armed sneak, and is not re-dealt while unrevealed questions remain", () => {
    let g = on(["thief"]);
    g = sneakRoll(startSneak(g, "a"), "a", 12).game; // a 7+: armed
    const id = q(g);
    const after = upholdCatch(fileCatch(g, "b", id), first).game;
    expect(team(after, "a")).toMatchObject({ reward: 0, sneakArmed: undefined, abilityUses: 2 });
    expect(after.teams.map((t) => t.currentQuestionId)).not.toContain(id);
  });

  it("a cleric flees at once (no prayer wait) and its typed answer is cleared", () => {
    let g = on(["cleric"]);
    g = submitText(g, "a", q(g), "答案");
    const after = upholdCatch(fileCatch(g, "b", q(g)), first).game;
    expect(after.pendingWrong).toBeNull();
    expect(team(after, "a").typedAnswer).toBeUndefined();
    expect(currentTurnTeamId(after)).toBe("b");
  });
});

describe("🛡️ 冤枉 (dismissCatch) and calling off", () => {
  it("the reporter loses 10 (never below 0); the accused gets a potion through giveItem and keeps the turn", () => {
    let g = fileCatch(on(), "b", q(on()));
    g = { ...g, teams: g.teams.map((t) => (t.id === "b" ? { ...t, reward: 4 } : t)) };
    const { game: after, potion } = dismissCatch(g);
    expect(potion).toBe(true);
    expect(team(after, "b")).toMatchObject({ reward: 0, catchesDismissed: 1 });
    expect(team(after, "a")).toMatchObject({ item: "luckyPotion", potionsGiven: 1 });
    expect(currentTurnTeamId(after)).toBe("a");
  });

  it("an accused holding a potion gets +10 flat instead", () => {
    const g = fileCatch(giveItem(on(["chef"]), "a"), "b", q(on()));
    const { game: after, potion } = dismissCatch(g);
    expect(potion).toBe(false);
    expect(team(after, "a")).toMatchObject({ reward: CATCH_PAY.wronged, potionsGiven: 1 });
  });

  it("a ruling with no catch open is refused", () => {
    refused(() => dismissCatch(on()), "no_catch");
    refused(() => upholdCatch(on()), "no_catch");
    expect(cancelCatch(on())).toEqual(on());
  });

  it("game end and sending the accused to the boss room call it off and refund; sending another team does not", () => {
    const g = fileCatch(on(), "b", q(on()));
    expect(team(endGame(g, first), "b")).toMatchObject({ catchesLeft: 2, catchesCancelled: 1 });
    expect(endGame(g, first).antiCheat?.openCatch).toBeUndefined();
    expect(team(sendToBoss(g, "a", first), "b").catchesLeft).toBe(2);
    expect(sendToBoss(g, "c", first).antiCheat?.openCatch).toBeDefined();
  });
});

describe("the game log", () => {
  it("counts oracles, catches and rulings per team, a cancelled one under the reporter, and the switch-ons", () => {
    let g = askOracle(on(), "a", q(on()));
    g = advanceToB(g);
    g = upholdCatch(fileCatch(g, "a", q(g, "b")), first).game;
    g = fileCatch(g, "b", q(g, "c"));
    const log = gameLog(endGame(g, first), 0);
    expect(log.antiCheatOn).toBe(1);
    expect(log.teams.map((t) => t.antiCheat)).toEqual([
      { oracles: 1, catchesFiled: 1, upheld: 1, dismissed: 0, cancelled: 0 },
      { oracles: 0, catchesFiled: 1, upheld: 0, dismissed: 0, cancelled: 1 },
      { oracles: 0, catchesFiled: 0, upheld: 0, dismissed: 0, cancelled: 0 },
    ]);
  });

  it("leaves the fields out of a game the switch never met", () => {
    const log = gameLog(endGame(game(), first), 0);
    expect(log).not.toHaveProperty("antiCheatOn");
    expect(log.teams[0]).not.toHaveProperty("antiCheat");
  });
});

/* ---------- the boss room (#289): taking turns on the shared boss question ---------- */

/** 甲 乙 丙 all in the boss room (甲 on turn), the switch on. One phase of `hp` hearts over `ids`, then `later` phases. */
function bossGame(hp = 3, ids = ["b1", "b2", "b3"], later: { maxHp: number; questionIds: string[]; buzzer?: true }[] = [], classes: (ClassId | undefined)[] = []): GameState {
  const g = createGame(
    ["a", "b", "c"].map((id, i) => ({ id, name: ["甲", "乙", "丙"][i], ...(classes[i] ? { classId: classes[i] } : {}) })),
    [{ baseDifficulty: 2, reward: 20 }],
    [QS.slice(0, 4), QS.slice(4, 12), [], [], []],
    ids,
    { bossThreshold: 0 },
    hp,
    first,
    undefined,
    {},
    later,
  );
  return setAntiCheat(g, true);
}
const bq = (g: GameState) => g.boss.currentQuestionId;

describe("🔮🚨 in the boss room", () => {
  it("the oracle halves the boss hit's points, the heart still goes, and the oracle is spent with the question", () => {
    let g = askOracle(bossGame(), "a", bq(bossGame()));
    expect(getSpectatorView(g).teams[0].oracle).toBe(true);
    refused(() => fileCatch(g, "b", bq(g)), "oracle_question");
    g = answerQuestion(g, "a", bq(g), true, "retry", first).game;
    expect(team(g, "a").reward).toBe(8); // an unrated boss question's 15, halved
    expect(g.boss.hp).toBe(2);
    expect(team(g, "a").oracleQ).toBeUndefined();
  });

  it("no oracle on the 尾刀: the last phase with one heart left; the view tells the phone to hide it", () => {
    const g = { ...bossGame(), boss: { ...bossGame().boss, hp: 1 } };
    refused(() => askOracle(g, "a", bq(g)), "finishing_blow");
    expect(getSpectatorView(g).antiCheat?.finishingBlow).toBe(true);
    expect(getSpectatorView(bossGame()).antiCheat?.finishingBlow).toBeUndefined();
    // One heart left in an earlier phase only ends that phase: the oracle is open.
    const early = { ...bossGame(3, ["b1", "b2"], [{ maxHp: 2, questionIds: ["c1", "c2"] }]), boss: { ...bossGame(3, ["b1", "b2"], [{ maxHp: 2, questionIds: ["c1", "c2"] }]).boss, hp: 1 } };
    expect(askOracle(early, "a", bq(early)).teams[0].oracleQ).toBe("b1");
    // The last phase of several phases counts; a phase card waiting does not.
    const two = bossGame(3, ["b1"], [{ maxHp: 2, questionIds: ["c1", "c2"] }]);
    const last = { ...two, boss: { ...two.boss, phaseIndex: 1, hp: 1, currentQuestionId: "c1", questionIds: ["c1", "c2"] } };
    refused(() => askOracle(last, "a", "c1"), "finishing_blow");
    expect(getSpectatorView({ ...g, boss: { ...g.boss, phasePending: "cleared" as const } }).antiCheat?.finishingBlow).toBeUndefined();
    // A catch is still allowed on the 尾刀.
    expect(fileCatch(g, "b", bq(g)).antiCheat?.openCatch?.teamId).toBe("a");
  });

  it("a kill the oracle could not see coming (a warrior's 20 from two hearts) halves its 4d20 too", () => {
    let g = { ...bossGame(), boss: { ...bossGame().boss, hp: 2 } };
    g = askOracle(g, "a", bq(g));
    const { outcome } = answerQuestion(g, "a", bq(g), true, "retry", first, undefined, [10, 10, 10, 10], undefined, false, 20);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossKilled: true, killBonus: 20 });
    // An odd sum rounds: 41 → 21.
    expect(answerQuestion(g, "a", bq(g), true, "retry", first, undefined, [10, 10, 10, 11], undefined, false, 20).outcome).toMatchObject({ killBonus: 21 });
  });

  it("refused while a boss phase waits for its card, and in a buzzer phase", () => {
    const pending = { ...bossGame(), boss: { ...bossGame().boss, phasePending: "cleared" as const } };
    refused(() => askOracle(pending, "a", bq(pending)), "phase_pending");
    refused(() => fileCatch(pending, "b", bq(pending)), "phase_pending");
    const buzz = { ...bossGame(), boss: { ...bossGame().boss, phases: [{ ...bossGame().boss.phases[0], buzzer: true as const }] } };
    refused(() => askOracle(buzz, "a", bq(buzz)), "buzzer_phase");
    // An oracle left from before never halves a buzz answer.
    const stale = { ...buzz, teams: buzz.teams.map((t) => (t.id === "a" ? { ...t, oracleQ: bq(buzz) } : t)) };
    expect(getSpectatorView(stale).teams[0].oracle).toBeUndefined();
  });

  it("is spent when the shared question is retired: a wrong answer, or another team's answer after a skipped turn", () => {
    let g = askOracle(bossGame(), "a", "b1");
    g = answerQuestion(g, "a", "b1", false, "retry", first).game;
    expect(g.phase).toBe("playing");
    expect(bq(g)).toBe("b2");
    expect(team(g, "a").oracleQ).toBeUndefined();
    let h = askOracle(bossGame(), "a", "b1");
    h = { ...h, currentTurnIndex: 1 };
    h = answerQuestion(h, "b", "b1", true, "retry", first).game;
    expect(h.teams.every((t) => t.oracleQ === undefined)).toBe(true);
  });

  it("goes with the shared question: the next team on it is halved too, cannot be caught, and asks no oracle of its own", () => {
    let g = askOracle(bossGame(), "a", "b1");
    g = { ...g, currentTurnIndex: 1 }; // the host skipped 甲's turn: b1 stays up for 乙
    expect(getSpectatorView(g).teams[1].oracle).toBe(true);
    refused(() => fileCatch(g, "c", "b1"), "oracle_question");
    refused(() => askOracle(g, "b", "b1"), "oracle_question");
    expect(team(answerQuestion(g, "b", "b1", true, "retry", first).game, "b").reward).toBe(8);
  });

  it("a warrior's miss keeps the question and its oracle", () => {
    let g = askOracle(bossGame(3, ["b1", "b2"], [], ["warrior"]), "a", "b1");
    g = warriorRoll(g, "a", "b1", 4, first).game;
    expect(bq(g)).toBe("b1");
    expect(team(g, "a").oracleQ).toBe("b1");
  });

  it("an upheld catch is the boss room's flee: the shared question is revealed and changes for everyone, −10 / +15", () => {
    let g = answerQuestion(bossGame(), "a", "b1", true, "retry", first).game; // 甲 15, 乙 on turn
    g = fileCatch(g, "c", bq(g));
    expect(getSpectatorView(g).antiCheat?.caught).toBe(true);
    const { game: after, outcome } = upholdCatch(g, first);
    expect(outcome.type).toBe("incorrect-flee");
    expect(after.revealedQuestionIds).toContain("b2");
    expect(bq(after)).toBe("b3");
    expect(team(after, "b")).toMatchObject({ reward: 0, wrongAnswers: 1 });
    expect(team(after, "b").flees).toBeUndefined();
    expect(team(after, "c").reward).toBe(CATCH_PAY.bounty);
    expect(currentTurnTeamId(after)).toBe("c");
  });

  it("an upheld catch that uses up the last phase finishes the game with the catch paid, not refunded", () => {
    let g = answerQuestion(bossGame(3, ["b1"]), "a", "b1", false, "flee", first).game;
    expect(g.phase).toBe("finished");
    // Two questions: 甲 is caught on the last one left.
    g = answerQuestion(bossGame(3, ["b1", "b2"]), "a", "b1", true, "retry", first).game; // 甲 15, 乙 on turn
    g = { ...g, currentTurnIndex: 0 };
    g = fileCatch(g, "c", "b2");
    const after = upholdCatch(g, first).game;
    expect(after.phase).toBe("finished");
    expect(team(after, "a").reward).toBe(15 - CATCH_PAY.caught);
    expect(team(after, "c")).toMatchObject({ reward: CATCH_PAY.bounty, catchesLeft: 1, catchesUpheld: 1 });
    expect(team(after, "c").catchesCancelled).toBeUndefined();
    expect(after.ranking?.[0]).toBe("c");
  });

  it("an upheld catch on an earlier phase's last unseen question ends that phase", () => {
    const g = fileCatch(bossGame(3, ["b1"], [{ maxHp: 2, questionIds: ["c1"] }]), "b", "b1");
    expect(upholdCatch(g, first).game.boss.phasePending).toBe("exhausted");
  });
});
