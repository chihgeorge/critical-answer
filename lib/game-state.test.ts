import { describe, it, expect } from "vitest";
import {
  createGame,
  answerQuestion,
  advanceTurn,
  currentTurnTeamId,
  isInBossPhase,
  setTeamOnline,
  getSpectatorView,
  recordBranchChoice,
  recordOptionSelection,
  recordWrongLock,
  firstPendingBranchRoom,
  rollBossKillBonus,
  sendToBoss,
  queueQuestion,
  pickBlock,
  pickableQuestionIds,
  enterNextBossPhase,
  warriorRoll,
  spendAbility,
  rollD20,
  isClassId,
  InvalidActionError,
  type GameState,
  type RoomTemplate,
} from "./game-state";

function makeRooms(count: number, baseDifficulty: 1 | 2 | 3 | 4 | 5 = 1): RoomTemplate[] {
  return Array.from({ length: count }, () => ({ baseDifficulty, reward: baseDifficulty * 10 }));
}

/** Pools (`[d - 1]` = difficulty d) with `ids` in pool d and the others empty. */
function poolsWith(d: 1 | 2 | 3 | 4 | 5, ids: string[]): string[][] {
  return [1, 2, 3, 4, 5].map((x) => (x === d ? ids : []));
}

/** `count` rooms of one difficulty sharing one pool of `size` questions, room0-q1... (S11). */
function deck(count: number, baseDifficulty: 1 | 2 | 3 | 4 | 5 = 1, size = 8): [RoomTemplate[], string[][]] {
  return [makeRooms(count, baseDifficulty), poolsWith(baseDifficulty, Array.from({ length: size }, (_, q) => `room0-q${q + 1}`))];
}

/** Always picks the first available question, so deals are predictable: q1, q2, q3... */
const first = () => 0;

function makeGame(overrides?: { bossThreshold?: number; bossMaxHp?: number; teamCount?: number; warrior?: boolean }): GameState {
  const teamCount = overrides?.teamCount ?? 3;
  // `warrior`: T0 is a warrior (docs/designs/class-abilities.md).
  const teams = Array.from({ length: teamCount }, (_, i) => ({ id: `T${i}`, name: `Team ${i}`, ...(overrides?.warrior && i === 0 ? { classId: "warrior" as const } : {}) }));
  return createGame(
    teams,
    ...deck(3, 1),
    ["boss-q1", "boss-q2", "boss-q3"],
    { bossThreshold: overrides?.bossThreshold ?? 3 },
    overrides?.bossMaxHp ?? 2,
    first,
  );
}

describe("createGame", () => {
  it("throws with zero teams", () => {
    expect(() => createGame([], ...deck(1), ["q"], { bossThreshold: 1 }, 1)).toThrow(InvalidActionError);
  });

  it("throws with zero rooms", () => {
    expect(() => createGame([{ id: "T0", name: "A" }], [], poolsWith(1, ["q"]), ["q"], { bossThreshold: 1 }, 1)).toThrow(
      InvalidActionError,
    );
  });

  it("seeds every team at room 0 with the room's base difficulty and first question", () => {
    const game = makeGame();
    for (const team of game.teams) {
      expect(team.roomIndex).toBe(0);
      expect(team.currentDifficulty).toBe(1);
      expect(team.currentQuestionId).toMatch(/^room0-q\d$/);
      expect(team.score).toBe(0);
      expect(team.online).toBe(true);
    }
  });

  it("fixes turn order to the seed order, not arrival or difficulty", () => {
    const game = makeGame();
    expect(game.turnOrder).toEqual(["T0", "T1", "T2"]);
    expect(currentTurnTeamId(game)).toBe("T0");
  });
});

describe("answerQuestion — normal room, correct answer", () => {
  it("advances the room, awards points equal to the room's difficulty, and passes the turn", () => {
    const game = makeGame();
    const { game: g2, outcome } = answerQuestion(game, "T0", "room0-q1", true, "retry", first);

    expect(outcome).toMatchObject({ type: "correct-room-advance", teamId: "T0", pointsAwarded: 1, nextRoomIndex: 1 });
    const t0 = g2.teams.find((t) => t.id === "T0")!;
    expect(t0.score).toBe(1);
    expect(t0.roomIndex).toBe(1);
    expect(t0.currentQuestionId).toBe("room0-q4"); // rooms of one difficulty share a pool; q1-q3 are taken
    expect(currentTurnTeamId(g2)).toBe("T1"); // turn passed, no bonus turn for a correct answer
  });

  it("clamps at the last room instead of advancing past it", () => {
    let game = makeGame({ teamCount: 1 });
    // Walk T0 through all 3 rooms.
    for (let i = 0; i < 3; i++) {
      ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first));
    }
    const t0 = game.teams[0];
    expect(t0.roomIndex).toBe(2); // last room index, not out of bounds
  });
});

describe("answerQuestion — normal room, incorrect answer", () => {
  it("flee downgrades difficulty by one tier and keeps the same room index", () => {
    // Use a fresh game with higher base room difficulty to observe the downgrade.
    const highDiffGame = createGame(
      [{ id: "T0", name: "Team 0" }],
      ...deck(2, 3),
      ["boss-q1"],
      { bossThreshold: 99 },
      1,
      first,
    );
    const { game: g2, outcome } = answerQuestion(highDiffGame, "T0", "room0-q1", false, "flee");
    expect(outcome).toMatchObject({ type: "incorrect-flee", newDifficulty: 2 });
    const t0 = g2.teams[0];
    expect(t0.roomIndex).toBe(0); // same room
    expect(t0.currentDifficulty).toBe(2); // downgraded from 3
  });

  it("flee never downgrades below MIN_DIFFICULTY (1)", () => {
    const game = makeGame({ teamCount: 1 }); // base difficulty 1
    const { game: g2 } = answerQuestion(game, "T0", "room0-q1", false, "flee");
    expect(g2.teams[0].currentDifficulty).toBe(1);
  });

  it("retry leaves the team facing the exact same question on their next turn", () => {
    const game = makeGame();
    const { game: g2 } = answerQuestion(game, "T0", "room0-q1", false, "retry");
    const t0 = g2.teams.find((t) => t.id === "T0")!;
    expect(t0.roomIndex).toBe(0);
    expect(t0.currentQuestionId).toBe("room0-q1");
    expect(t0.score).toBe(0);
    expect(currentTurnTeamId(g2)).toBe("T1"); // turn still passes — no extra attempts
  });

  it("defaults to retry when no fleeChoice is given", () => {
    const game = makeGame();
    const { outcome } = answerQuestion(game, "T0", "room0-q1", false, "retry", first);
    expect(outcome.type).toBe("incorrect-retry");
  });
});

describe("global round-robin turn order", () => {
  it("cycles through all teams in fixed order regardless of outcome", () => {
    let game = makeGame();
    expect(currentTurnTeamId(game)).toBe("T0");
    ({ game } = answerQuestion(game, "T0", "room0-q1", true, "retry", first));
    expect(currentTurnTeamId(game)).toBe("T1");
    ({ game } = answerQuestion(game, "T1", "room0-q2", false, "retry", first));
    expect(currentTurnTeamId(game)).toBe("T2");
    ({ game } = answerQuestion(game, "T2", "room0-q3", false, "flee", first));
    expect(currentTurnTeamId(game)).toBe("T0"); // wrapped around
  });

  it("rejects an answer submitted by a team when it's not their turn", () => {
    const game = makeGame();
    expect(() => answerQuestion(game, "T1", "room0-q1", true, "retry", first)).toThrow(InvalidActionError);
  });
});

describe("answerQuestion — stale question rejection (T6 critical gap)", () => {
  it("rejects a question id that does not match the team's current expected question", () => {
    const game = makeGame();
    expect(() => answerQuestion(game, "T0", "room0-q2" /* wrong id for room0 default */, true)).toThrow(
      InvalidActionError,
    );
  });

  it("does not mutate game state when rejecting a stale submission", () => {
    const game = makeGame();
    try {
      answerQuestion(game, "T0", "stale-question", true, "retry", first);
    } catch {
      // expected
    }
    expect(game.teams[0].score).toBe(0);
    expect(currentTurnTeamId(game)).toBe("T0");
  });
});

describe("advanceTurn — offline team handling (T7 critical gap)", () => {
  it("skips an offline team and lands on the next online team", () => {
    let game = makeGame();
    game = setTeamOnline(game, "T1", false);
    game = advanceTurn(game); // from T0
    expect(currentTurnTeamId(game)).toBe("T2"); // T1 skipped
  });

  it("answerQuestion also skips offline teams when passing the turn", () => {
    let game = makeGame();
    game = setTeamOnline(game, "T1", false);
    const { game: g2 } = answerQuestion(game, "T0", "room0-q1", true, "retry", first);
    expect(currentTurnTeamId(g2)).toBe("T2");
  });

  it("returns null from currentTurnTeamId when every team is offline", () => {
    let game = makeGame();
    for (const t of game.teams) game = setTeamOnline(game, t.id, false);
    expect(currentTurnTeamId(game)).toBeNull();
  });

  it("does not infinite-loop or throw when advanceTurn is called with everyone offline", () => {
    let game = makeGame();
    for (const t of game.teams) game = setTeamOnline(game, t.id, false);
    expect(() => advanceTurn(game)).not.toThrow();
  });

  it("rejects an answer attempt when no online team can take a turn", () => {
    let game = makeGame();
    for (const t of game.teams) game = setTeamOnline(game, t.id, false);
    expect(() => answerQuestion(game, "T0", "room0-q1", true, "retry", first)).toThrow(InvalidActionError);
  });
});

describe("unknown team id handling", () => {
  it("throws InvalidActionError for an unknown team in isInBossPhase", () => {
    const game = makeGame();
    expect(() => isInBossPhase(game, "ghost-team")).toThrow(InvalidActionError);
  });

  it("throws InvalidActionError for an unknown team in setTeamOnline", () => {
    const game = makeGame();
    expect(() => setTeamOnline(game, "ghost-team", false)).toThrow(InvalidActionError);
  });
});

describe("boss phase eligibility", () => {
  it("a team enters boss phase once its score reaches the fixed threshold", () => {
    let game = makeGame({ bossThreshold: 2, teamCount: 1 });
    expect(isInBossPhase(game, "T0")).toBe(false);
    ({ game } = answerQuestion(game, "T0", "room0-q1", true, "retry", first)); // +1, score=1
    expect(isInBossPhase(game, "T0")).toBe(false);
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first)); // +1, score=2
    expect(isInBossPhase(game, "T0")).toBe(true);
  });

  it("once one team is in, the others get in on their next correct answer, whatever their score (D9)", () => {
    let game = makeGame({ bossThreshold: 2, bossMaxHp: 1, teamCount: 2 });
    const q = (id: string) => game.teams.find((t) => t.id === id)!.currentQuestionId;
    let outcome;
    ({ game, outcome } = answerQuestion(game, "T0", q("T0"), true, "retry", first)); // T0 score 1
    expect(outcome).toMatchObject({ type: "correct-room-advance", entersBoss: false });
    ({ game } = answerQuestion(game, "T1", q("T1"), false, "retry", first));
    ({ game, outcome } = answerQuestion(game, "T0", q("T0"), true, "retry", first)); // T0 score 2: first in
    expect(outcome).toMatchObject({ type: "correct-room-advance", entersBoss: true });
    expect(isInBossPhase(game, "T0")).toBe(true);

    ({ game } = answerQuestion(game, "T1", q("T1"), false, "retry", first));
    expect(isInBossPhase(game, "T1")).toBe(false); // a wrong answer does not get in
    ({ game } = answerQuestion(game, "T0", game.boss.currentQuestionId, false, "retry", first));
    ({ game } = answerQuestion(game, "T1", q("T1"), false, "flee", first));
    expect(isInBossPhase(game, "T1")).toBe(false); // neither does a flee
    ({ game } = answerQuestion(game, "T0", game.boss.currentQuestionId, false, "retry", first));
    const before = { used: game.usedQuestionIds, room: game.teams[1].roomIndex };
    ({ game, outcome } = answerQuestion(game, "T1", q("T1"), true, "retry", first)); // T1 score 1, below 2
    expect(outcome).toMatchObject({ type: "correct-room-advance", entersBoss: true });
    expect(isInBossPhase(game, "T1")).toBe(true);
    // Value: protects=a team entering the boss room burns no room question and opens no branch room;
    // fails_when=boss entry deals the next room again; why_new=D9 made every later team enter this way;
    // seam=none; no_claim=the phone's branch UI
    expect(game.usedQuestionIds).toEqual(before.used);
    expect(game.teams[1].roomIndex).toBe(before.room);
    // Value: protects=the big-screen view (map strip) shows a below-threshold team in the boss room;
    // fails_when=getSpectatorView derives inBossPhase from score again; why_new=no test read the view
    // for a below-threshold boss team; seam=none; no_claim=MapStrip rendering (unit only, no DOM)
    expect(getSpectatorView(game).teams.find((t) => t.id === "T1")).toMatchObject({ score: 1, inBossPhase: true });

    ({ game } = answerQuestion(game, "T0", game.boss.currentQuestionId, false, "retry", first));
    ({ game, outcome } = answerQuestion(game, "T1", game.boss.currentQuestionId, true, "retry", first));
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossKilled: true }); // in the fight, not entering again
    expect(game.boss.killedByTeamId).toBe("T1");
  });

  it("boss phase questions come from the shared boss queue, not the team's room", () => {
    const game = makeGame({ bossThreshold: 0, teamCount: 1 }); // start already eligible
    expect(isInBossPhase(game, "T0")).toBe(true);
    const t0 = game.teams[0];
    expect(t0.currentQuestionId).not.toBe(game.boss.currentQuestionId);
    // The expected question for a team already in boss phase is the boss's, not the team's stale room question.
    expect(() => answerQuestion(game, "T0", t0.currentQuestionId, true)).toThrow(InvalidActionError);
    expect(() => answerQuestion(game, "T0", game.boss.currentQuestionId, true)).not.toThrow();
  });
});

describe("boss combat", () => {
  it("a correct boss answer deals one point of damage without killing at full HP", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 2, teamCount: 1 });
    const { game: g2, outcome } = answerQuestion(game, "T0", game.boss.currentQuestionId, true);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossHpRemaining: 1, bossKilled: false });
    expect(g2.phase).toBe("playing");
  });

  it("the killing blow awards the hit reward plus a 4d20 kill bonus (4-80) only to the team that landed it", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 1, teamCount: 2 });
    const { game: g2, outcome } = answerQuestion(game, "T0", game.boss.currentQuestionId, true);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossHpRemaining: 0, bossKilled: true });
    if (outcome.type === "correct-boss-hit") {
      expect(outcome.killBonus).toBeGreaterThanOrEqual(4);
      expect(outcome.killBonus).toBeLessThanOrEqual(80);
      expect(outcome.reward).toBe(10 + outcome.killBonus!);
      expect(g2.teams.find((t) => t.id === "T0")!.reward).toBe(outcome.reward);
    }
    expect(g2.teams.find((t) => t.id === "T1")!.reward).toBe(0); // non-participating team gets nothing from the kill
  });

  it("finishes the game the moment the boss dies", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 1, teamCount: 1 });
    const { game: g2 } = answerQuestion(game, "T0", game.boss.currentQuestionId, true);
    expect(g2.phase).toBe("finished");
  });

  it("a later-arriving team can join the same boss fight and take the killing blow", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 1, teamCount: 2 });
    // T0's turn is first, but T1 lands the actual kill because it's T1's turn when HP hits 0
    // (simulate by giving T0 a wrong answer first, then T1 the correct one).
    const { game: afterMiss } = answerQuestion(game, "T0", game.boss.currentQuestionId, false, "retry");
    const { game: afterKill, outcome } = answerQuestion(afterMiss, "T1", afterMiss.boss.currentQuestionId, true);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossKilled: true });
    expect(afterKill.boss.killedByTeamId).toBe("T1");
    expect(afterKill.teams.find((t) => t.id === "T0")!.score).toBe(0);
  });

  it("rejects a boss answer submitted out of turn", () => {
    const game = makeGame({ bossThreshold: 0, teamCount: 2 });
    expect(() => answerQuestion(game, "T1", game.boss.currentQuestionId, true)).toThrow(InvalidActionError);
  });

  it("a wrong boss answer with flee rotates to the next boss question", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 5, teamCount: 1 });
    const firstQ = game.boss.currentQuestionId;
    const { game: g2 } = answerQuestion(game, "T0", firstQ, false, "flee");
    expect(g2.boss.currentQuestionId).not.toBe(firstQ);
    expect(g2.boss.hp).toBe(5); // no damage on a wrong answer
  });

  it("a wrong boss answer with retry keeps the same boss question", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 5, teamCount: 1 });
    const firstQ = game.boss.currentQuestionId;
    const { game: g2 } = answerQuestion(game, "T0", firstQ, false, "retry");
    expect(g2.boss.currentQuestionId).toBe(firstQ);
  });
});

describe("scoring and winners (docs/designs/scoring-and-score-pools.md)", () => {
  // Room 0 pays 10 at difficulty 1; room 1 pays 50 at difficulty 2: reward and progress are separate.
  const rooms = (): RoomTemplate[] => [
    { baseDifficulty: 1, reward: 10 },
    { baseDifficulty: 2, reward: 50 },
  ];
  const pools = [["a1", "a2", "a3", "a4"], ["b1", "b2", "b3", "b4"], [], [], []];
  const twoTeams = (bossThreshold = 15, bossMaxHp = 1) =>
    createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], rooms(), pools, ["boss-q1", "boss-q2"], { bossThreshold }, bossMaxHp, first);
  const answer = (g: GameState, id: string, correct = true, flee: "flee" | "retry" = "retry") =>
    answerQuestion(g, id, getTeam(g, id).inBoss ? g.boss.currentQuestionId : getTeam(g, id).currentQuestionId, correct, flee, first);
  const getTeam = (g: GameState, id: string) => g.teams.find((t) => t.id === id)!;

  it("a correct room answer adds the difficulty to progress and the monster's reward to reward", () => {
    const { game, outcome } = answer(twoTeams(), "T0");
    expect(outcome).toMatchObject({ type: "correct-room-advance", pointsAwarded: 1, reward: 10 });
    expect(getTeam(game, "T0")).toMatchObject({ score: 1, reward: 10 });
  });

  it("the reward follows the monster, not the question: a team that fled still earns the full reward", () => {
    let g = answer(twoTeams(), "T0").game; // T0 -> room 1
    g = answer(g, "T1", false).game; // T1 retries
    g = answer(g, "T0", false, "flee").game; // T0 flees in room 1: difficulty 2 -> 1
    expect(getTeam(g, "T0").currentDifficulty).toBe(1);
    g = answer(g, "T1", false).game;
    const { game, outcome } = answer(g, "T0");
    expect(outcome).toMatchObject({ pointsAwarded: 1, reward: 50 });
    expect(getTeam(game, "T0")).toMatchObject({ score: 2, reward: 60 });
  });

  it("each boss hit pays the hit reward; the final blow adds the kill bonus", () => {
    let g = twoTeams(0, 2);
    const hit = answer(g, "T0");
    expect(hit.outcome).toMatchObject({ type: "correct-boss-hit", bossKilled: false, reward: 10 });
    expect(hit.outcome).not.toHaveProperty("killBonus");
    g = hit.game;
    const kill = answer(g, "T1");
    expect(kill.outcome).toMatchObject({ bossKilled: true, killBonus: 4, reward: 14 }); // first() rolls 1 on each d20
    expect(getTeam(kill.game, "T1").reward).toBe(14);
  });

  it("the winner is the highest reward total, even when another team landed the final blow", () => {
    let g = twoTeams(0, 1);
    g = { ...g, teams: g.teams.map((t) => (t.id === "T1" ? { ...t, reward: 100 } : t)) };
    const { game } = answer(g, "T0");
    expect(game.boss.killedByTeamId).toBe("T0");
    expect(getTeam(game, "T0").reward).toBe(14);
    expect(game.winners).toEqual(["T1"]);
    expect(getSpectatorView(game).bossKilledBy).toBe("T0");
    expect(getSpectatorView(g).bossKilledBy).toBeNull();
  });

  it("teams tied on reward share the win (並列第一)", () => {
    let g = twoTeams(0, 1);
    g = { ...g, teams: g.teams.map((t) => (t.id === "T1" ? { ...t, reward: 14 } : t)) };
    expect(answer(g, "T0").game.winners).toEqual(["T0", "T1"]);
  });

  it("progress points alone never pick the winner", () => {
    let g = twoTeams(0, 1);
    g = { ...g, teams: g.teams.map((t) => (t.id === "T1" ? { ...t, score: 99 } : t)) };
    expect(answer(g, "T0").game.winners).toEqual(["T0"]);
  });
});

describe("sendToBoss (host override, scoring-and-score-pools.md S13)", () => {
  it("takes a team into the boss room without touching the turn or any score", () => {
    const g = makeGame({ bossThreshold: 15 });
    const g2 = sendToBoss(g, "T1");
    expect(isInBossPhase(g2, "T1")).toBe(true);
    expect(isInBossPhase(g2, "T0")).toBe(false);
    expect(currentTurnTeamId(g2)).toBe(currentTurnTeamId(g));
    expect(g2.teams.map((t) => [t.score, t.reward])).toEqual(g.teams.map((t) => [t.score, t.reward]));
    const { outcome } = answerQuestion(advanceTurn(g2), "T1", g2.boss.currentQuestionId, true, "retry", first);
    expect(outcome.type).toBe("correct-boss-hit");
  });

  it("refuses a team already in the boss room, a wrong lock waiting for its choice, and a finished game", () => {
    const g = makeGame({ bossThreshold: 15 });
    expect(() => sendToBoss(sendToBoss(g, "T1"), "T1")).toThrow(InvalidActionError);
    const q = g.teams[0].currentQuestionId;
    expect(() => sendToBoss(recordWrongLock(g, "T0", q, 0), "T0")).toThrow(InvalidActionError);
    expect(() => sendToBoss({ ...g, phase: "finished" }, "T0")).toThrow(InvalidActionError);
    expect(() => sendToBoss(g, "nope")).toThrow(InvalidActionError);
  });

  it("drops the left room question's eliminated options, so a later deal of it starts clean", () => {
    const g0 = makeGame({ bossThreshold: 15 });
    const q = g0.teams[0].currentQuestionId;
    const { game: g } = answerQuestion(recordWrongLock(g0, "T0", q, 1), "T0", q, false, "retry");
    expect(g.eliminated[q]).toEqual([1]);
    expect(sendToBoss(g, "T0").eliminated).not.toHaveProperty(q);
  });

  it("keeps eliminated options while another team still faces that question", () => {
    const g0 = makeGame({ bossThreshold: 15 });
    const q = g0.teams[0].currentQuestionId;
    const g = { ...g0, teams: g0.teams.map((t) => ({ ...t, currentQuestionId: q })), eliminated: { [q]: [1] } };
    expect(sendToBoss(g, "T1").eliminated[q]).toEqual([1]);
  });

  it("clears the sent team's option pick", () => {
    const g = makeGame({ bossThreshold: 15 });
    const g1 = recordOptionSelection(g, "T0", g.teams[0].currentQuestionId, 0);
    expect(sendToBoss(g1, "T0").teams[0].currentSelection).toBeNull();
  });
});

describe("getSpectatorView (Premise 7 pacing mitigation)", () => {
  it("exposes whose turn it is, every team's progress, and each side's current question id", () => {
    const game = makeGame();
    const view = getSpectatorView(game);
    expect(view.currentTurnTeamId).toBe("T0");
    expect(view.teams).toHaveLength(3);
    expect(view.teams[0]).toMatchObject({
      id: "T0",
      score: 0,
      roomIndex: 0,
      inBossPhase: false,
      online: true,
      currentQuestionId: "room0-q1",
    });
    expect(view.bossHp).toBe(game.boss.hp);
    expect(view.bossMaxHp).toBe(game.boss.maxHp);
    expect(view.bossCurrentQuestionId).toBe(game.boss.currentQuestionId);
  });
});

describe("rollBossKillBonus", () => {
  it("is always between 4 and 80 (4d20)", () => {
    for (let i = 0; i < 200; i++) {
      const bonus = rollBossKillBonus();
      expect(bonus).toBeGreaterThanOrEqual(4);
      expect(bonus).toBeLessThanOrEqual(80);
    }
  });

  it("is deterministic when given a fixed rng", () => {
    expect(rollBossKillBonus(() => 0)).toBe(4); // each d20 floors to 1
    expect(rollBossKillBonus(() => 0.999)).toBe(80); // each d20 rounds up to 20
  });
});

describe("finished game guards further actions", () => {
  it("rejects any further answerQuestion call once the game has finished", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 1, teamCount: 1 });
    const { game: finished } = answerQuestion(game, "T0", game.boss.currentQuestionId, true);
    expect(finished.phase).toBe("finished");
    expect(() => answerQuestion(finished, "T0", "anything", true)).toThrow(InvalidActionError);
  });
});

describe("question deck (T2)", () => {
  const seeds = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `T${i}`, name: `Team ${i}` }));
  const boss = ["boss-q1"];
  const cfg = { bossThreshold: 999 };

  it("deals each team a different question at the start when the room has enough", () => {
    const game = createGame(seeds(3), ...deck(2), boss, cfg, 1, first);
    expect(game.teams.map((t) => t.currentQuestionId)).toEqual(["room0-q1", "room0-q2", "room0-q3"]);
  });

  it("a team entering a room gets a question nobody has drawn from its pool yet", () => {
    let game = createGame(seeds(2), ...deck(2), boss, cfg, 1, first);
    ({ game } = answerQuestion(game, "T0", "room0-q1", true, "retry", first)); // T0 -> room1
    ({ game } = answerQuestion(game, "T1", "room0-q2", true, "retry", first)); // T1 -> room1
    expect(game.teams[0].currentQuestionId).toBe("room0-q3");
    expect(game.teams[1].currentQuestionId).toBe("room0-q4"); // not room0-q3 again
  });

  it("flee deals a fresh question in the same room and lowers difficulty", () => {
    let game = createGame(seeds(1), ...deck(2, 3), boss, cfg, 1, first);
    ({ game } = answerQuestion(game, "T0", "room0-q1", false, "flee", first));
    const t = game.teams[0];
    expect(t.roomIndex).toBe(0);
    expect(t.currentQuestionId).toBe("room0-q2");
    expect(t.currentDifficulty).toBe(2);
  });

  it("retry keeps the same question and deals nothing new", () => {
    let game = createGame(seeds(1), ...deck(2), boss, cfg, 1, first);
    ({ game } = answerQuestion(game, "T0", "room0-q1", false, "retry", first));
    expect(game.teams[0].currentQuestionId).toBe("room0-q1");
    expect(game.usedQuestionIds[0]).toEqual(["room0-q1"]);
  });

  it("uses the injected rng: a high roll picks the last unused question", () => {
    const game = createGame(seeds(1), ...deck(1), boss, cfg, 1, () => 0.99);
    expect(game.teams[0].currentQuestionId).toBe("room0-q8");
  });

  it("reshuffles an exhausted deck and never deals the question the team just answered", () => {
    // One team stuck in the only (last) room with 3 questions: clamped, so it keeps drawing.
    let game = createGame(seeds(1), ...deck(1, 1, 3), boss, cfg, 1, first);
    let prev = game.teams[0].currentQuestionId;
    for (let i = 0; i < 10; i++) {
      ({ game } = answerQuestion(game, "T0", prev, true, "retry", first));
      const next = game.teams[0].currentQuestionId;
      expect(next).not.toBe(prev);
      expect(next).toMatch(/^room0-q[1-3]$/);
      prev = next;
    }
  });

  it("does not hand two teams the same question while the deck has spares, even after a reshuffle", () => {
    let game = createGame(seeds(2), ...deck(1, 1, 4), boss, cfg, 1, first);
    for (let i = 0; i < 12; i++) {
      const [a, b] = game.teams;
      expect(a.currentQuestionId).not.toBe(b.currentQuestionId);
      const turn = currentTurnTeamId(game)!;
      const q = game.teams.find((t) => t.id === turn)!.currentQuestionId;
      ({ game } = answerQuestion(game, turn, q, true, "retry", first));
    }
  });

  it("a correctly answered question is never redealt while an unrevealed one is available, even after a reshuffle (D4/D5)", () => {
    let game = createGame(seeds(1), ...deck(1, 1, 3), boss, cfg, 1, first);
    const q1 = game.teams[0].currentQuestionId; // room0-q1
    ({ game } = answerQuestion(game, "T0", q1, true, "retry", first));
    expect(game.revealedQuestionIds).toEqual([q1]);
    // Answer through the rest of the deck (q2, q3) and force a reshuffle — q1 must not come back
    // until every other question has also been revealed.
    for (let i = 0; i < 5; i++) {
      const q = game.teams[0].currentQuestionId;
      if (game.revealedQuestionIds.length < 3) expect(q).not.toBe(q1);
      ({ game } = answerQuestion(game, "T0", q, true, "retry", first));
    }
    // Once every question in the room has been revealed, reuse is the only option left.
    expect(new Set(game.revealedQuestionIds)).toEqual(new Set(["room0-q1", "room0-q2", "room0-q3"]));
  });

  it("fleeing never marks a question revealed, so it can come straight back", () => {
    let game = createGame(seeds(1), ...deck(1, 1, 2), boss, cfg, 1, first);
    const q1 = game.teams[0].currentQuestionId;
    ({ game } = answerQuestion(game, "T0", q1, false, "flee", first));
    expect(game.revealedQuestionIds).toEqual([]);
    expect(game.teams[0].currentQuestionId).not.toBe(q1); // dealt the other question in the room
  });

  it("retrying never marks a question revealed", () => {
    let game = createGame(seeds(1), ...deck(1), boss, cfg, 1, first);
    const q1 = game.teams[0].currentQuestionId;
    ({ game } = answerQuestion(game, "T0", q1, false, "retry", first));
    expect(game.revealedQuestionIds).toEqual([]);
  });

  it("a reshuffle prefers an unrevealed question over a revealed one", () => {
    // Flees exhaust the deck while q2 is still unrevealed, so the reshuffle pool {q1, q2} has a
    // real choice to make — with `first` and no revealed filter it would redeal q1.
    let game = createGame(seeds(1), ...deck(1, 1, 3), boss, cfg, 1, first);
    ({ game } = answerQuestion(game, "T0", "room0-q1", true, "retry", first));
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, false, "flee", first));
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, false, "flee", first));
    expect(game.revealedQuestionIds).toEqual(["room0-q1"]);
    expect(game.teams[0].currentQuestionId).toBe("room0-q2");
  });

  it("a boss flee skips a revealed question in the ring, where plain rotation would land on it", () => {
    let game = makeGame({ bossThreshold: 0, bossMaxHp: 10 });
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q1", true, "retry", first));
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, game.boss.currentQuestionId, false, "flee", first));
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, game.boss.currentQuestionId, false, "flee", first));
    expect(game.revealedQuestionIds).toEqual(["boss-q1"]);
    expect(game.boss.currentQuestionId).toBe("boss-q2");
  });

  it("a correct boss hit on the last unrevealed question never re-asks it (its answer is on screen)", () => {
    // Ring b1,b2,b3: reveal b2 and b3 first, then answer b1 correctly. The old walk reached the
    // current question itself (not yet in the revealed list) and dealt b1 right back.
    let game = makeGame({ bossThreshold: 0, bossMaxHp: 10 });
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q1", false, "flee", first)); // -> q2
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q2", true, "retry", first)); // -> q3
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q3", true, "retry", first)); // -> q1
    expect(game.boss.currentQuestionId).toBe("boss-q1");
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q1", true, "retry", first));
    expect(game.boss.currentQuestionId).not.toBe("boss-q1");
  });

  it("the fled-question fallback never hands a team the question another team is holding", () => {
    // Two teams, room of 3. By T0's last deal, q2/q3 are revealed and q1 (the only unrevealed
    // question) sits in T1's hand — T0 must get a revealed question, never T1's.
    let game = createGame(seeds(2), ...deck(1, 1, 3), boss, cfg, 1, first); // T0 q1, T1 q2
    ({ game } = answerQuestion(game, "T0", "room0-q1", false, "flee", first)); // T0 -> q3
    ({ game } = answerQuestion(game, "T1", "room0-q2", true, "retry", first)); // q2 revealed, T1 -> q1
    ({ game } = answerQuestion(game, "T0", "room0-q3", true, "retry", first)); // q3 revealed
    expect(game.teams[1].currentQuestionId).toBe("room0-q1");
    expect(game.teams[0].currentQuestionId).not.toBe("room0-q1");
  });

  it("a boss flee stays on the current question when it is the last unrevealed one", () => {
    // b2 and b3 answered correctly; b1 is the only question whose answer nobody has seen, so
    // fleeing it must not rotate the whole boss encounter onto a revealed question.
    let game = makeGame({ bossThreshold: 0, bossMaxHp: 10 });
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q1", false, "flee", first)); // -> q2
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q2", true, "retry", first)); // -> q3
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q3", true, "retry", first)); // -> q1
    ({ game } = answerQuestion(game, currentTurnTeamId(game)!, "boss-q1", false, "flee", first));
    expect(game.boss.currentQuestionId).toBe("boss-q1");
  });

  it("a boss question answered again after every one was revealed is not listed twice", () => {
    let game = makeGame({ bossThreshold: 0, bossMaxHp: 10 });
    for (let i = 0; i < 5; i++) {
      ({ game } = answerQuestion(game, currentTurnTeamId(game)!, game.boss.currentQuestionId, true, "retry", first));
    }
    expect(game.revealedQuestionIds.filter((id) => id.startsWith("boss")).sort()).toEqual(["boss-q1", "boss-q2", "boss-q3"]);
  });

  it("a room redeals a fled (unrevealed) question before re-showing a revealed one", () => {
    // q1 answered (revealed); then q2/q3 keep getting fled. After the reshuffle the cycle's only
    // unused question is q1 — but q2 was fled, never revealed, so it must win over re-showing q1.
    let game = createGame(seeds(1), ...deck(1, 1, 3), boss, cfg, 1, first);
    ({ game } = answerQuestion(game, "T0", "room0-q1", true, "retry", first)); // q1 revealed -> q2
    ({ game } = answerQuestion(game, "T0", "room0-q2", false, "flee", first)); // -> q3
    ({ game } = answerQuestion(game, "T0", "room0-q3", false, "flee", first)); // reshuffle -> q2
    ({ game } = answerQuestion(game, "T0", "room0-q2", false, "flee", first)); // -> q3
    ({ game } = answerQuestion(game, "T0", "room0-q3", false, "flee", first)); // unused left: only q1
    expect(game.revealedQuestionIds).toEqual(["room0-q1"]);
    expect(game.teams[0].currentQuestionId).toBe("room0-q2");
  });

  it("the boss ring skips an already-revealed question, falling back to reuse once every boss question has been revealed", () => {
    let game = makeGame({ bossThreshold: 0, bossMaxHp: 10 });
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const turn = currentTurnTeamId(game)!;
      const q = game.boss.currentQuestionId;
      seen.push(q);
      if (i < 2) expect(game.revealedQuestionIds).not.toContain(q); // not yet reused
      ({ game } = answerQuestion(game, turn, q, true, "retry", first));
    }
    // All 3 boss questions got hit once each before any repeat — the ring genuinely skipped revealed ones.
    expect(new Set(seen).size).toBe(3);
    expect(game.revealedQuestionIds.sort()).toEqual(["boss-q1", "boss-q2", "boss-q3"]);
  });

  it("a team below the boss gate in the last room keeps getting questions and can still reach it", () => {
    let game = createGame(seeds(1), ...deck(2, 1, 3), boss, { bossThreshold: 15 }, 1, first);
    for (let i = 0; i < 40 && !isInBossPhase(game, "T0"); i++) {
      ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first));
    }
    expect(isInBossPhase(game, "T0")).toBe(true);
  });
});

describe("recordBranchChoice (DM branching interlude)", () => {
  function advanceOnce(game: GameState, teamId: string): GameState {
    const team = game.teams.find((t) => t.id === teamId)!;
    return answerQuestion(game, teamId, team.currentQuestionId, true, "retry", first).game;
  }

  it("records a choice for a room the team has actually entered", () => {
    let game = makeGame({ teamCount: 1 });
    game = advanceOnce(game, "T0"); // T0.roomIndex: 0 -> 1
    game = recordBranchChoice(game, "T0", 1, "fight");
    expect(game.teams[0].branchChoices).toEqual({ 1: "fight" });
  });

  it("rejects a roomIndex the team has not reached yet", () => {
    const game = makeGame({ teamCount: 1 }); // T0.roomIndex is still 0
    expect(() => recordBranchChoice(game, "T0", 1, "fight")).toThrow(InvalidActionError);
  });

  it("rejects roomIndex 0 — the starting room was never entered via a transition", () => {
    const game = makeGame({ teamCount: 1 });
    expect(() => recordBranchChoice(game, "T0", 0, "fight")).toThrow(InvalidActionError);
  });

  it("rejects an unknown team", () => {
    const game = makeGame({ teamCount: 1 });
    expect(() => recordBranchChoice(game, "ghost", 1, "fight")).toThrow(InvalidActionError);
  });

  it("first choice for a room wins; a later submission for the same room is rejected and does not overwrite", () => {
    let game = makeGame({ teamCount: 1 });
    game = advanceOnce(game, "T0");
    game = recordBranchChoice(game, "T0", 1, "fight");
    expect(() => recordBranchChoice(game, "T0", 1, "negotiate")).toThrow(InvalidActionError);
    expect(game.teams[0].branchChoices).toEqual({ 1: "fight" });
  });

  it("a team can still choose for an earlier room after advancing further without choosing", () => {
    let game = makeGame({ teamCount: 1 });
    game = advanceOnce(game, "T0"); // roomIndex 0 -> 1
    game = advanceOnce(game, "T0"); // roomIndex 1 -> 2, room 1's choice still unanswered
    game = recordBranchChoice(game, "T0", 1, "negotiate");
    expect(game.teams[0].branchChoices).toEqual({ 1: "negotiate" });
  });

  it("does not affect other teams' choices or any other game state", () => {
    let game = makeGame({ teamCount: 2 });
    game = advanceOnce(game, "T0");
    const before = game.teams[1];
    game = recordBranchChoice(game, "T0", 1, "fight");
    expect(game.teams[1]).toEqual(before);
  });

  it("farming the clamped last room never opens a second choosable roomIndex for it", () => {
    // Mirrors "a team below the boss gate in the last room..." above: roomIndex sticks at
    // the last room while the team racks up score, so only ONE roomIndex (the last one) is
    // ever recordable for it — repeated correct answers do not create new choosable rooms.
    let game = createGame([{ id: "T0", name: "A" }], ...deck(2, 1, 3), ["boss-q1"], { bossThreshold: 15 }, 1, first);
    for (let i = 0; i < 40 && !isInBossPhase(game, "T0"); i++) {
      game = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first).game;
    }
    // Only roomIndex 1 (the last non-boss room) was ever enterable, never a roomIndex 2+.
    expect(() => recordBranchChoice(game, "T0", 2, "fight")).toThrow(InvalidActionError);
    game = recordBranchChoice(game, "T0", 1, "fight");
    expect(game.teams[0].branchChoices).toEqual({ 1: "fight" });
  });

  it("rejects a choice once the game has finished, mirroring answerQuestion's own guard", () => {
    // 2 rooms so the team legitimately enters roomIndex 1 before reaching the boss;
    // bossMaxHp 1 kills it on the first hit, finishing the game.
    let game = createGame([{ id: "T0", name: "A" }], ...deck(2, 1, 3), ["boss-q1"], { bossThreshold: 15 }, 1, first);
    for (let i = 0; i < 40 && game.phase !== "finished"; i++) {
      const qid = isInBossPhase(game, "T0") ? game.boss.currentQuestionId : game.teams[0].currentQuestionId;
      game = answerQuestion(game, "T0", qid, true, "retry", first).game;
    }
    expect(game.phase).toBe("finished");
    // roomIndex 1 was legitimately entered (not the "unreached room" rejection) — only the
    // finished-game guard should block this, same as answerQuestion's own check.
    expect(game.teams[0].roomIndex).toBe(1);
    expect(() => recordBranchChoice(game, "T0", 1, "fight")).toThrow(InvalidActionError);
  });
});

describe("recordOptionSelection (multipleChoice pick)", () => {
  it("records a team's pick for the question it's currently facing", () => {
    let game = makeGame({ teamCount: 1 });
    game = recordOptionSelection(game, "T0", game.teams[0].currentQuestionId, 2);
    expect(game.teams[0].currentSelection).toBe(2);
  });

  it("is re-selectable: a later pick for the same question overwrites the earlier one", () => {
    let game = makeGame({ teamCount: 1 });
    const qid = game.teams[0].currentQuestionId;
    game = recordOptionSelection(game, "T0", qid, 0);
    game = recordOptionSelection(game, "T0", qid, 3);
    expect(game.teams[0].currentSelection).toBe(3);
  });

  it("rejects a selection for a stale (already-moved-past) question id", () => {
    const game = makeGame({ teamCount: 1 });
    expect(() => recordOptionSelection(game, "T0", "not-the-current-question", 0)).toThrow(InvalidActionError);
  });

  it("rejects an unknown team", () => {
    const game = makeGame({ teamCount: 1 });
    expect(() => recordOptionSelection(game, "ghost", game.teams[0].currentQuestionId, 0)).toThrow(InvalidActionError);
  });

  it("does not affect other teams' selections", () => {
    let game = makeGame({ teamCount: 2 });
    const before = game.teams[1];
    game = recordOptionSelection(game, "T0", game.teams[0].currentQuestionId, 1);
    expect(game.teams[1]).toEqual(before);
  });

  it("rejects a selection once the game has finished", () => {
    let game = createGame([{ id: "T0", name: "A" }], ...deck(2, 1, 3), ["boss-q1"], { bossThreshold: 15 }, 1, first);
    for (let i = 0; i < 40 && game.phase !== "finished"; i++) {
      const qid = isInBossPhase(game, "T0") ? game.boss.currentQuestionId : game.teams[0].currentQuestionId;
      game = answerQuestion(game, "T0", qid, true, "retry", first).game;
    }
    expect(game.phase).toBe("finished");
    expect(() => recordOptionSelection(game, "T0", game.boss.currentQuestionId, 0)).toThrow(InvalidActionError);
  });

  it("resets to null whenever a new question is dealt, but survives an incorrect-retry (same question)", () => {
    let game = makeGame({ teamCount: 1 });
    game = recordOptionSelection(game, "T0", game.teams[0].currentQuestionId, 1);
    expect(game.teams[0].currentSelection).toBe(1);

    // retry: same question, selection survives
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, false, "retry", first));
    expect(game.teams[0].currentSelection).toBe(1);

    // correct answer deals a new question: selection resets
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first));
    expect(game.teams[0].currentSelection).toBeNull();
  });

  it("resets to null on a flee (new question dealt for the same room)", () => {
    let game = makeGame({ teamCount: 1 });
    game = recordOptionSelection(game, "T0", game.teams[0].currentQuestionId, 1);
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, false, "flee", first));
    expect(game.teams[0].currentSelection).toBeNull();
  });

  it("resets EVERY team's selection when the shared boss question rotates, not just the answering team's", () => {
    // Regression for the adversarial-review finding: boss.currentQuestionId is shared by every
    // team in boss phase, so a stale currentSelection left on a non-answering team could line up
    // with a different option on the new question and mislead the host into judging against a
    // pick that team never actually made.
    let game = makeGame({ bossThreshold: 0, bossMaxHp: 5, teamCount: 2 }); // both start in boss phase
    game = recordOptionSelection(game, "T0", game.boss.currentQuestionId, 0);
    game = recordOptionSelection(game, "T1", game.boss.currentQuestionId, 2);
    expect(game.teams[1].currentSelection).toBe(2);

    // T0 answers correctly, not killing the boss (maxHp 5): the shared boss question rotates.
    ({ game } = answerQuestion(game, "T0", game.boss.currentQuestionId, true, "retry", first));
    expect(game.teams[0].currentSelection).toBeNull();
    expect(game.teams[1].currentSelection).toBeNull(); // T1 never answered, but its old pick is now stale too
  });

  it("resets every boss-phase team's selection on a flee too", () => {
    let game = makeGame({ bossThreshold: 0, bossMaxHp: 5, teamCount: 2 });
    game = recordOptionSelection(game, "T0", game.boss.currentQuestionId, 0);
    game = recordOptionSelection(game, "T1", game.boss.currentQuestionId, 1);
    ({ game } = answerQuestion(game, "T0", game.boss.currentQuestionId, false, "flee", first));
    expect(game.teams[0].currentSelection).toBeNull();
    expect(game.teams[1].currentSelection).toBeNull();
  });
});

describe("firstPendingBranchRoom", () => {
  it("returns null when roomIndex is 0 — the starting room is never a choosable transition", () => {
    expect(firstPendingBranchRoom({ roomIndex: 0, branchChoices: {} })).toBeNull();
  });

  it("returns the earliest pending room, not the latest, when there is a gap", () => {
    expect(firstPendingBranchRoom({ roomIndex: 3, branchChoices: { 1: "fight", 3: "negotiate" } })).toBe(2);
  });

  it("returns null once every room up to roomIndex has a choice", () => {
    expect(firstPendingBranchRoom({ roomIndex: 2, branchChoices: { 1: "fight", 2: "negotiate" } })).toBeNull();
  });
});

describe("recordWrongLock (phone answering, phone-answering.md E6/E9)", () => {
  it("eliminates the option, clears the pick and waits for the team's choice", () => {
    let g = makeGame();
    const q = g.teams[0].currentQuestionId;
    g = recordOptionSelection(g, "T0", q, 2);
    g = recordWrongLock(g, "T0", q, 2);
    expect(g.eliminated[q]).toEqual([2]);
    expect(g.pendingWrong).toEqual({ teamId: "T0", questionId: q, optionIndex: 2 });
    expect(g.teams[0].currentSelection).toBeNull();
    expect(() => recordOptionSelection(g, "T0", q, 2)).toThrow(InvalidActionError);
  });

  it("rejects a second wrong lock, a wrong turn and a correct answer while waiting", () => {
    const g0 = makeGame();
    expect(() => recordWrongLock(g0, "T1", g0.teams[1].currentQuestionId, 0)).toThrow(InvalidActionError);
    const q = g0.teams[0].currentQuestionId;
    const g = recordWrongLock(g0, "T0", q, 0);
    expect(() => recordWrongLock(g, "T0", q, 1)).toThrow(InvalidActionError);
    expect(() => answerQuestion(g, "T0", q, true)).toThrow(InvalidActionError);
  });

  it("retry keeps the eliminated option for the team's next turn on the same question", () => {
    const q = makeGame().teams[0].currentQuestionId;
    const g = recordWrongLock(makeGame(), "T0", q, 1);
    const { game, outcome } = answerQuestion(g, "T0", q, false, "retry");
    expect(outcome.type).toBe("incorrect-retry");
    expect(game.pendingWrong).toBeNull();
    expect(game.eliminated[q]).toEqual([1]);
    expect(currentTurnTeamId(game)).toBe("T1");
  });

  it("the waiting team keeps the turn while offline, and the turn moves on after its choice", () => {
    const q = makeGame().teams[0].currentQuestionId;
    let g = recordWrongLock(makeGame(), "T0", q, 1);
    g = setTeamOnline(g, "T0", false);
    expect(currentTurnTeamId(g)).toBe("T0");
    expect(getSpectatorView(g).currentTurnTeamId).toBe("T0");
    const { game } = answerQuestion(g, "T0", q, false, "flee");
    expect(currentTurnTeamId(game)).toBe("T1");
  });

  it("boss: a wrong lock rotates the shared question even on retry, so the next team never inherits a narrowed one", () => {
    // Boss redesign D1=A: three wrong retries used to leave the fourth team only the right option.
    let g = makeGame({ bossThreshold: 0 });
    const q = g.boss.currentQuestionId;
    const first = answerQuestion(recordWrongLock(g, "T0", q, 0), "T0", q, false, "retry");
    expect(first.outcome).toEqual({ type: "incorrect-retry", teamId: "T0", newBossQuestion: true }); // narration says so
    g = first.game;
    const q2 = g.boss.currentQuestionId;
    expect(q2).not.toBe(q);
    expect(g.eliminated[q2]).toBeUndefined();
    expect(g.eliminated[q]).toBeUndefined(); // nobody faces q any more
    expect(g.revealedQuestionIds).toContain(q); // its wrong option was shown: reused only as a last resort
    expect(() => recordOptionSelection(g, "T1", q, 0)).toThrow(InvalidActionError);
    g = answerQuestion(recordWrongLock(g, "T1", q2, 1), "T1", q2, false, "flee").game;
    expect(g.boss.currentQuestionId).not.toBe(q2);
    expect(g.eliminated[g.boss.currentQuestionId]).toBeUndefined();
  });

  // Value: protects=newBossQuestion is set only when the boss question really changed (narration truth);
  // fails_when=newBossQuestion follows the shown wrong option instead of the rotation; why_new=both boss tests
  // above have shownWrong and rotation agree; seam=none; no_claim=none beyond protects
  it("boss: a wrong lock with a one-question boss bank stays on it and does not claim a new question", () => {
    const teams = [{ id: "T0", name: "A" }, { id: "T1", name: "B" }];
    const g = createGame(teams, ...deck(1), ["boss-only"], { bossThreshold: 0 }, 2, first);
    const { game: after, outcome } = answerQuestion(recordWrongLock(g, "T0", "boss-only", 1), "T0", "boss-only", false, "retry", first);
    expect(after.boss.currentQuestionId).toBe("boss-only");
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T0" }); // the narration must not say the boss changed the question
  });

  it("boss: a wrong answer with no option shown (a text question the host judged) keeps the question on retry", () => {
    let g = makeGame({ bossThreshold: 0 });
    const q = g.boss.currentQuestionId;
    const { game: after, outcome } = answerQuestion(g, "T0", q, false, "retry");
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T0" }); // narration must not claim a new question
    g = after;
    expect(g.boss.currentQuestionId).toBe(q);
    expect(g.revealedQuestionIds).not.toContain(q);
  });

  it("the turn moves on from the team that answered, not from an offline team the stale index points at", () => {
    let g = setTeamOnline(makeGame(), "T0", false);
    const q = g.teams[1].currentQuestionId;
    g = recordWrongLock(g, "T1", q, 0);
    g = setTeamOnline(g, "T0", true);
    const { game } = answerQuestion(g, "T1", q, false, "retry");
    expect(currentTurnTeamId(game)).toBe("T2");
  });

  it("a flee after a wrong lock counts the question as revealed: the room saw part of its answer", () => {
    const q = makeGame().teams[0].currentQuestionId;
    const { game } = answerQuestion(recordWrongLock(makeGame(), "T0", q, 1), "T0", q, false, "flee");
    expect(game.revealedQuestionIds).toContain(q);
    expect(game.eliminated[q]).toBeUndefined();
  });

  it("a flee without a lock reveals nothing", () => {
    const g = makeGame();
    const q = g.teams[0].currentQuestionId;
    expect(answerQuestion(g, "T0", q, false, "flee").game.revealedQuestionIds).not.toContain(q);
  });

  it("a correct answer clears the question's eliminated set", () => {
    const q = makeGame().teams[0].currentQuestionId;
    let g = answerQuestion(recordWrongLock(makeGame(), "T0", q, 1), "T0", q, false, "retry").game;
    g = answerQuestion(g, "T1", g.teams[1].currentQuestionId, false, "retry").game;
    g = answerQuestion(g, "T2", g.teams[2].currentQuestionId, false, "retry").game;
    expect(answerQuestion(g, "T0", q, true).game.eliminated[q]).toBeUndefined();
  });

  // Value: protects=eliminated options stay while another team still faces the same room question; fails_when=the stillFaced check is dropped and any answer clears the set; why_new=other tests use 8-question rooms, so no question is ever shared; seam=none; no_claim=room/UI greying (game-state unit only)
  it("a question two teams share keeps its eliminated set while one of them still faces it", () => {
    let g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], ...deck(2, 1, 1), ["boss-q1"], { bossThreshold: 3 }, 2, first);
    const q = g.teams[0].currentQuestionId;
    expect(g.teams[1].currentQuestionId).toBe(q); // a 1-question room deals the same question twice
    g = answerQuestion(recordWrongLock(g, "T0", q, 1), "T0", q, false, "retry").game;
    g = answerQuestion(g, "T1", q, true).game; // T1 moves on to room 1; T0 still faces q
    expect(g.eliminated[q]).toEqual([1]);
    expect(() => recordOptionSelection(g, "T0", q, 1)).toThrow(InvalidActionError);
  });

  it("boss: a flee after a wrong lock reveals the shared question and clears its set", () => {
    let g = makeGame({ bossThreshold: 0 });
    const q = g.boss.currentQuestionId;
    g = answerQuestion(recordWrongLock(g, "T0", q, 0), "T0", q, false, "flee").game;
    expect(g.revealedQuestionIds).toContain(q);
    expect(g.eliminated[q]).toBeUndefined();
  });
});

describe("pools by difficulty (scoring-and-score-pools.md S11)", () => {
  const rooms: RoomTemplate[] = [
    { baseDifficulty: 1, reward: 10 },
    { baseDifficulty: 3, reward: 30 },
  ];
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

  it("a room deals from its difficulty's pool, and a flee from the pool of the lowered difficulty", () => {
    const pools = [ids("p1-", 3), ids("p2-", 3), ids("p3-", 3), [], []];
    let g = createGame([{ id: "T0", name: "A" }], rooms, pools, ["boss-q1"], { bossThreshold: 99 }, 1, first);
    expect(g.teams[0].currentQuestionId).toBe("p1-1");
    ({ game: g } = answerQuestion(g, "T0", "p1-1", true, "retry", first)); // -> room 1, difficulty 3
    expect(g.teams[0].currentQuestionId).toBe("p3-1");
    ({ game: g } = answerQuestion(g, "T0", "p3-1", false, "flee", first)); // difficulty 2
    expect(g.teams[0]).toMatchObject({ roomIndex: 1, currentDifficulty: 2, currentQuestionId: "p2-1" });
  });

  it("an empty pool falls back to the nearest one below, then above", () => {
    let g = createGame([{ id: "T0", name: "A" }], rooms, [ids("p1-", 3), [], ids("p3-", 3), [], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    ({ game: g } = answerQuestion(g, "T0", "p1-1", true, "retry", first));
    ({ game: g } = answerQuestion(g, "T0", "p3-1", false, "flee", first)); // pool 2 is empty: pool 1
    expect(g.teams[0].currentQuestionId).toMatch(/^p1-/);
    const above = createGame([{ id: "T0", name: "A" }], rooms, [[], [], ids("p3-", 2), [], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    expect(above.teams[0].currentQuestionId).toBe("p3-1");
  });

  it("8 teams in one 12-question pool never hold the same question, however often they flee", () => {
    const seeds = Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, name: `${i}` }));
    // Seeded so a failure reproduces.
    for (const seed of [1, 2, 3]) {
      let s = seed;
      const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      let g = createGame(seeds, [{ baseDifficulty: 1, reward: 10 }], [ids("q", 12), [], [], [], []], ["boss-q1"], { bossThreshold: 99 }, 1, rng);
      for (let n = 0; n < 200; n++) {
        const id = currentTurnTeamId(g)!;
        const team = g.teams.find((t) => t.id === id)!;
        ({ game: g } = answerQuestion(g, id, team.currentQuestionId, false, "flee", rng));
        const held = g.teams.map((t) => t.currentQuestionId);
        expect(new Set(held).size, `seed ${seed}, flee ${n}`).toBe(held.length);
      }
    }
  });

  it("when every question is held, a fleeing team gets its own question back, not another team's", () => {
    let g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], [{ baseDifficulty: 1, reward: 10 }], [["a", "b"], [], [], [], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    ({ game: g } = answerQuestion(g, "T0", "a", false, "flee", first));
    expect(g.teams.map((t) => t.currentQuestionId)).toEqual(["a", "b"]);
  });

  it("a pool smaller than the team count borrows a free question from the nearest other pool", () => {
    // Codex adversarial review (/ship): a 2-question pool with 3 teams dealt two teams the same question,
    // so one team's answer reveal gave it away to the other.
    const seeds = [0, 1, 2].map((i) => ({ id: `T${i}`, name: `${i}` }));
    const g = createGame(seeds, [{ baseDifficulty: 1, reward: 10 }], [["a", "b"], [], ["c"], ["z"], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    const held = g.teams.map((t) => t.currentQuestionId);
    expect(new Set(held).size).toBe(3);
    expect(held).toContain("c"); // pool 3 is nearer to pool 1 than pool 4
  });

  it("a flee into a lower pool whose every question is held borrows an unrevealed question before giving back its own", () => {
    const two: RoomTemplate[] = [{ baseDifficulty: 1, reward: 10 }, { baseDifficulty: 3, reward: 30 }];
    let g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], two, [["a", "x"], ["b"], ["d", "e"], [], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    ({ game: g } = answerQuestion(g, "T0", "a", true, "retry", first)); // T0 -> room 1, holds d
    ({ game: g } = answerQuestion(g, "T1", "x", true, "retry", first)); // T1 -> room 1, holds e
    ({ game: g } = answerQuestion(g, "T0", "d", false, "flee", first)); // difficulty 2: T0 takes b
    ({ game: g } = answerQuestion(g, "T1", "e", false, "flee", first)); // pool 2 is all held; a and x are revealed
    expect(g.teams.map((t) => t.currentQuestionId)).toEqual(["b", "d"]);
    expect(g.usedQuestionIds[1]).toEqual(["b"]); // a pool-3 id never lands in pool 2's list
  });

  it("a fleeing team never gets back its own question after a wrong lock while another pool has a free one", () => {
    // Claude adversarial review (/ship): the own-question fallback ran before borrowing, so a team that
    // locked wrong and fled got the same question back with its wrong option already shown.
    const pools = [["a", "b"], [], ["c"], [], []];
    let g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], [{ baseDifficulty: 1, reward: 10 }], pools, ["boss-q1"], { bossThreshold: 99 }, 1, first);
    g = { ...g, eliminated: { a: [0] } }; // T0 locked a wrong option on a
    ({ game: g } = answerQuestion(g, "T0", "a", false, "flee", first));
    expect(g.teams.map((t) => t.currentQuestionId)).toEqual(["c", "b"]);
    expect(g.usedQuestionIds[2]).toEqual(["c"]); // recorded in the pool it came from
  });

  it("after a wrong lock, a flee with no unrevealed spare borrows a revealed one before its own, and gets its own back only when nothing is free", () => {
    const start = (pools: string[][]) => {
      const g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], [{ baseDifficulty: 1, reward: 10 }], pools, ["boss-q1"], { bossThreshold: 99 }, 1, first);
      return { ...g, eliminated: { a: [0] }, revealedQuestionIds: ["c"] };
    };
    expect(answerQuestion(start([["a", "b"], [], ["c"], [], []]), "T0", "a", false, "flee", first).game.teams[0].currentQuestionId).toBe("c");
    expect(answerQuestion(start([["a", "b"], [], [], [], []]), "T0", "a", false, "flee", first).game.teams[0].currentQuestionId).toBe("a");
  });

  it("a correct answer with nothing free gives back the answered question, never one another team holds", () => {
    // Red Team review (/ship): the correct-answer deal counted the team's own question as held, so with
    // every question held it dealt another team's live question to two teams at once.
    const rooms5 = ([5, 3, 5, 5] as const).map((d) => ({ baseDifficulty: d, reward: 1 }));
    const g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }, { id: "T2", name: "C" }], rooms5, [[], ["p2"], ["p3"], [], ["p5"]], ["boss-q1"], { bossThreshold: 99 }, 3, first);
    const held = g.teams.map((t) => t.currentQuestionId);
    const t0 = g.teams.find((t) => t.currentQuestionId === "p5")!;
    const after = answerQuestion(g, t0.id, "p5", true, "retry", first).game.teams;
    const others = after.filter((t) => t.id !== t0.id).map((t) => t.currentQuestionId);
    expect(held.sort()).toEqual(["p2", "p3", "p5"]);
    expect(others).not.toContain(after.find((t) => t.id === t0.id)!.currentQuestionId);
    expect(after.find((t) => t.id === t0.id)!.currentQuestionId).toBe("p5");
  });

  it("when every answer left in a pool has been shown, an unseen question from another pool comes before a repeat", () => {
    // Codex adversarial review (/ship): pool 1 [a,b,c] dealt the revealed a again while pool 2's fresh was never used.
    let g = createGame([{ id: "A", name: "A" }, { id: "B", name: "B" }], [{ baseDifficulty: 1, reward: 10 }], [["a", "b", "c"], ["fresh"], [], [], []], ["boss-q1"], { bossThreshold: 99 }, 3, first);
    const dealt: string[] = [];
    for (let i = 0; i < 2; i++) {
      const t = g.teams[g.currentTurnIndex];
      g = answerQuestion(g, t.id, t.currentQuestionId, true, "retry", first).game;
      dealt.push(g.teams.find((x) => x.id === t.id)!.currentQuestionId);
    }
    expect(dealt).toContain("fresh");
    expect(dealt.filter((id) => g.revealedQuestionIds.includes(id) && id !== "fresh")).toEqual([]);
    expect(g.usedQuestionIds[1]).toEqual(["fresh"]); // recorded in its own pool, not pool 1's
    expect(g.usedQuestionIds[0]).not.toContain("fresh");
  });

  it("a flee does not keep a question another team holds while a free one exists", () => {
    // Red Team review (/ship): with fewer questions than teams the fled question was already shared, and the own fallback handed it back.
    let g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }, { id: "T2", name: "C" }], [{ baseDifficulty: 1, reward: 1 }], [["a"], ["b"], [], [], []], ["boss-q1"], { bossThreshold: 2 }, 3, first);
    expect(g.teams.map((t) => t.currentQuestionId)).toEqual(["a", "b", "a"]);
    ({ game: g } = answerQuestion(g, "T0", "a", false, "retry", first));
    ({ game: g } = answerQuestion(g, "T1", "b", true, "retry", first)); // enters the boss; b is revealed and free
    ({ game: g } = answerQuestion(g, "T2", "a", false, "flee", first));
    expect(g.teams.find((t) => t.id === "T2")!.currentQuestionId).toBe("b");
  });

  it("a borrow takes a question the donor pool has not dealt yet before repeating one", () => {
    // Codex adversarial review (/ship): borrowing ignored the donor's used list, so flees cycled a/b/c and never dealt d.
    let g = createGame([{ id: "A", name: "A" }, { id: "B", name: "B" }], [{ baseDifficulty: 1, reward: 10 }], [["a"], ["b", "c", "d"], [], [], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    const dealt: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = g.teams[g.currentTurnIndex];
      g = answerQuestion(g, t.id, t.currentQuestionId, false, "flee", first).game;
      dealt.push(g.teams.find((x) => x.id === t.id)!.currentQuestionId);
    }
    expect(dealt).toContain("d");
  });

  it("a flee keeps its own unseen question rather than re-show an answer when nothing unseen is free", () => {
    // Claude adversarial simulation (/ship): the revealed-pool branch skipped `own`, unlike the all-held branch.
    let g = createGame([{ id: "A", name: "A" }], [3, 4].map((d) => ({ baseDifficulty: d as 3 | 4, reward: 10 })), [[], [], ["c"], ["d"], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    ({ game: g } = answerQuestion(g, "A", "c", true, "retry", first)); // c is revealed, A moves to d
    ({ game: g } = answerQuestion(g, "A", "d", false, "flee", first)); // difficulty 3: only the revealed c
    expect(g.teams[0].currentQuestionId).toBe("d");
  });

  it("a correct answer scores the difficulty of the pool the question came from", () => {
    // Codex adversarial review (/ship): a flee into an empty pool 2 dealt from pool 1 but scored 2.
    let g = createGame([{ id: "T0", name: "A" }], rooms, [ids("p1-", 3), [], ids("p3-", 3), [], []], ["boss-q1"], { bossThreshold: 99 }, 1, first);
    ({ game: g } = answerQuestion(g, "T0", "p1-1", true, "retry", first)); // -> difficulty 3
    ({ game: g } = answerQuestion(g, "T0", "p3-1", false, "flee", first)); // difficulty 2, empty: pool 1
    const id = g.teams[0].currentQuestionId;
    expect(id).toMatch(/^p1-/);
    const { outcome } = answerQuestion(g, "T0", id, true, "retry", first);
    expect(outcome).toMatchObject({ type: "correct-room-advance", pointsAwarded: 1 });
  });
});

describe("queueQuestion (the host picks the next question)", () => {
  it("hands a team its queued question on its next correct answer, then deals as usual", () => {
    const g = queueQuestion(makeGame({ bossThreshold: 15 }), "T0", "room0-q7");
    const { game: g2 } = answerQuestion(g, "T0", "room0-q1", true, "retry", first);
    expect(g2.teams[0].currentQuestionId).toBe("room0-q7");
    expect(g2.teams[0].queuedQuestionId).toBeUndefined();
    expect(g2.usedQuestionIds[0]).toContain("room0-q7");
  });

  it("keeps a retry on the same question and the pick waiting", () => {
    const g = queueQuestion(makeGame({ bossThreshold: 15 }), "T0", "room0-q7");
    const { game: g2 } = answerQuestion(g, "T0", "room0-q1", false, "retry", first);
    expect(g2.teams[0].currentQuestionId).toBe("room0-q1");
    expect(g2.teams[0].queuedQuestionId).toBe("room0-q7");
  });

  it("waits through a flee to another difficulty, and is used by the flee when the difficulty fits", () => {
    // Rooms at difficulty 2, so a flee drops to the difficulty-1 pool.
    const pools = [["e1", "e2", "e3"], ["m1", "m2", "m3", "m4"], [], [], []];
    const g0 = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], makeRooms(3, 2), pools, ["b1"], { bossThreshold: 15 }, 2, first);
    const g = queueQuestion(g0, "T0", "m4");
    const { game: fled } = answerQuestion(g, "T0", "m1", false, "flee", first);
    expect(fled.teams[0].currentQuestionId).toBe("e1");
    expect(fled.teams[0].queuedQuestionId).toBe("m4");
    // Fleeing to a pool the pick is in uses it.
    const pools1 = poolsWith(1, ["q1", "q2", "q3", "q4"]);
    const h0 = createGame([{ id: "T0", name: "A" }], makeRooms(3, 1), pools1, ["b1"], { bossThreshold: 15 }, 2, first);
    const { game: h } = answerQuestion(queueQuestion(h0, "T0", "q4"), "T0", "q1", false, "flee", first);
    expect(h.teams[0].currentQuestionId).toBe("q4");
  });

  it("never deals a question queued for another team", () => {
    // T1's next deal would draw room0-q4 first; T0 has it queued.
    const g = queueQuestion(makeGame({ bossThreshold: 15 }), "T0", "room0-q4");
    const { game: g2 } = answerQuestion(advanceTurn(g), "T1", "room0-q2", true, "retry", first);
    expect(g2.teams[1].currentQuestionId).toBe("room0-q5");
  });

  it("drops a team's pick when it enters the boss room", () => {
    const g = queueQuestion(makeGame({ bossThreshold: 1 }), "T0", "room0-q7");
    const { game: g2 } = answerQuestion(g, "T0", "room0-q1", true, "retry", first);
    expect(g2.teams[0].inBoss).toBe(true);
    expect(g2.teams[0].queuedQuestionId).toBeUndefined();
    expect(sendToBoss(queueQuestion(makeGame({ bossThreshold: 15 }), "T1", "room0-q7"), "T1").teams[1].queuedQuestionId).toBeUndefined();
  });

  it("rotates the boss to its queued question on the next hit or flee", () => {
    let g = sendToBoss(makeGame({ bossThreshold: 15, bossMaxHp: 3 }), "T0");
    g = queueQuestion(g, "boss", "boss-q3");
    const { game: hit } = answerQuestion(g, "T0", "boss-q1", true, "retry", first);
    expect(hit.boss.currentQuestionId).toBe("boss-q3");
    expect(hit.boss.queuedQuestionId).toBeUndefined();
    const { game: fled } = answerQuestion(queueQuestion(g, "boss", "boss-q3"), "T0", "boss-q1", false, "flee", first);
    expect(fled.boss.currentQuestionId).toBe("boss-q3");
    // A plain retry keeps the question and the pick.
    const { game: retried } = answerQuestion(g, "T0", "boss-q1", false, "retry", first);
    expect(retried.boss.currentQuestionId).toBe("boss-q1");
    expect(retried.boss.queuedQuestionId).toBe("boss-q3");
  });

  it("keeps a team's pick through a wrong lock and retry", () => {
    const g = queueQuestion(makeGame({ bossThreshold: 15 }), "T0", "room0-q7");
    const { game: g2 } = answerQuestion(recordWrongLock(g, "T0", "room0-q1", 0), "T0", "room0-q1", false, "retry", first);
    expect(g2.teams[0].currentQuestionId).toBe("room0-q1");
    expect(g2.teams[0].queuedQuestionId).toBe("room0-q7");
    expect(g2.pendingWrong).toBeNull();
  });

  it("clears the boss pick, and the ring takes over again", () => {
    const g = queueQuestion(queueQuestion(sendToBoss(makeGame({ bossThreshold: 15, bossMaxHp: 3 }), "T0"), "boss", "boss-q3"), "boss", null);
    expect(g.boss.queuedQuestionId).toBeUndefined();
    expect(g.boss.currentQuestionId).toBe("boss-q1");
    expect(answerQuestion(g, "T0", "boss-q1", true, "retry", first).game.boss.currentQuestionId).toBe("boss-q2");
  });

  it("rotates the boss to its pick after a wrong lock, even on retry", () => {
    const g = queueQuestion(sendToBoss(makeGame({ bossThreshold: 15, bossMaxHp: 3 }), "T0"), "boss", "boss-q3");
    const { game: r } = answerQuestion(recordWrongLock(g, "T0", "boss-q1", 0), "T0", "boss-q1", false, "retry", first);
    expect(r.boss.currentQuestionId).toBe("boss-q3");
    expect(r.boss.queuedQuestionId).toBeUndefined();
    expect(r.revealedQuestionIds).toContain("boss-q1");
  });

  it("keeps the boss pick when another team enters the boss room", () => {
    const g = queueQuestion(sendToBoss(makeGame({ bossThreshold: 15, bossMaxHp: 3 }), "T0"), "boss", "boss-q3");
    expect(sendToBoss(g, "T1").boss.queuedQuestionId).toBe("boss-q3");
  });

  it("only offers the team's next room difficulty, and refuses revealed, held and queued questions", () => {
    const pools = [["e1", "e2"], ["m1", "m2", "m3"], [], [], []];
    const g = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], [{ baseDifficulty: 1, reward: 10 }, { baseDifficulty: 2, reward: 20 }], pools, ["b1", "b2"], { bossThreshold: 15 }, 2, first);
    expect(pickableQuestionIds(g, "T0")).toEqual(["m1", "m2", "m3"]);
    expect(pickableQuestionIds(g, "boss")).toEqual(["b1", "b2"]);
    expect(() => queueQuestion(g, "T0", "e2")).toThrow(InvalidActionError);
    const q = queueQuestion(g, "T0", "m1");
    expect(pickBlock(q, "m1")).toEqual({ kind: "queued", teamId: "T0" });
    expect(() => queueQuestion(q, "T1", "m1")).toThrow(InvalidActionError);
    expect(queueQuestion(q, "T0", "m1").teams[0].queuedQuestionId).toBe("m1"); // picking it again is fine
    expect(queueQuestion(q, "T0", null).teams[0].queuedQuestionId).toBeUndefined();
    expect(pickBlock(g, "e1")).toEqual({ kind: "held", teamId: "T0" });
    expect(pickBlock(g, "b1")).toEqual({ kind: "held", teamId: "boss" });
    expect(pickBlock({ ...g, revealedQuestionIds: ["m2"] }, "m2")).toEqual({ kind: "revealed" });
    expect(() => queueQuestion({ ...g, revealedQuestionIds: ["m2"] }, "T0", "m2")).toThrow(InvalidActionError);
    expect(() => queueQuestion(sendToBoss(g, "T0"), "T0", "m1")).toThrow(InvalidActionError);
    expect(() => queueQuestion({ ...g, phase: "finished" }, "T0", "m1")).toThrow(InvalidActionError);
    expect(() => queueQuestion(g, "nope", "m1")).toThrow(InvalidActionError);
  });
});

describe("boss phases (docs/designs/boss-phases.md)", () => {
  /** One team in the boss room: phase 1 is p1-a/p1-b/p1-c with `hp1` HP, phase 2 is p2-a/p2-b with 2 HP. */
  function phased(hp1 = 1, teamCount = 1): GameState {
    const teams = Array.from({ length: teamCount }, (_, i) => ({ id: `T${i}`, name: `Team ${i}` }));
    return createGame(teams, ...deck(1), ["p1-a", "p1-b", "p1-c"], { bossThreshold: 0 }, hp1, first, 10, {}, [{ maxHp: 2, questionIds: ["p2-a", "p2-b"] }]);
  }
  const hit = (g: GameState, team = "T0") => answerQuestion(g, team, g.boss.currentQuestionId, true, "retry", first);

  it("a hit that empties an earlier phase only marks it cleared: no kill, no bonus, same question, game goes on", () => {
    const { game, outcome } = hit(phased(1));
    expect(outcome).toEqual({ type: "correct-boss-hit", teamId: "T0", bossHpRemaining: 0, bossKilled: false, reward: 10 });
    expect(game.phase).toBe("playing");
    expect(game.boss).toMatchObject({ hp: 0, phaseIndex: 0, phasePending: "cleared", currentQuestionId: "p1-a", killedByTeamId: null });
    expect(getSpectatorView(game).bossPhase).toBe(1); // nothing about phase 2 before the card
    expect(() => hit(game)).toThrow(InvalidActionError); // nobody answers until the next phase starts
  });

  it("enterNextBossPhase starts the next phase: full new bar, its own questions, no pick, no stale picks or tiles", () => {
    let g = hit(phased(1, 2)).game;
    g = { ...g, boss: { ...g.boss, queuedQuestionId: "p1-b" }, eliminated: { "p1-a": [1] }, teams: g.teams.map((t) => ({ ...t, currentSelection: 2 })) };
    const next = enterNextBossPhase(g);
    expect(next.boss).toMatchObject({ phaseIndex: 1, hp: 2, maxHp: 2, questionIds: ["p2-a", "p2-b"], currentQuestionId: "p2-a" });
    expect(next.boss.maxHp).toBe(next.boss.phases[1].maxHp);
    expect(next.boss.questionIds).toBe(next.boss.phases[1].questionIds);
    expect(next.boss.queuedQuestionId).toBeUndefined();
    expect(next.boss.phasePending).toBeUndefined();
    expect(next.eliminated["p1-a"]).toBeUndefined();
    expect(next.teams.every((t) => t.currentSelection === null)).toBe(true);
    expect(getSpectatorView(next).bossPhase).toBe(2);
    expect(pickableQuestionIds(next, "boss")).toEqual(["p2-a", "p2-b"]);
    expect(next.currentTurnIndex).toBe(g.currentTurnIndex); // not a turn
  });

  it("enterNextBossPhase refuses when no phase is pending, and on the last phase", () => {
    expect(() => enterNextBossPhase(phased(2))).toThrow(InvalidActionError);
    const last = enterNextBossPhase(hit(phased(1)).game);
    expect(() => enterNextBossPhase({ ...last, boss: { ...last.boss, phasePending: "cleared" } })).toThrow(InvalidActionError);
  });

  it("only the last phase's final blow kills the boss and rolls the kill bonus", () => {
    let g = enterNextBossPhase(hit(phased(1)).game);
    g = hit(g).game;
    expect(g.boss.phasePending).toBeUndefined(); // the last phase has no next one
    const { game, outcome } = hit(g);
    expect(outcome).toMatchObject({ bossKilled: true, bossHpRemaining: 0 });
    expect(outcome.type === "correct-boss-hit" && outcome.killBonus).toBeGreaterThanOrEqual(4);
    expect(game.phase).toBe("finished");
  });

  it("a hit that reveals an earlier phase's last unrevealed question marks it exhausted, its HP left unpaid", () => {
    let g = phased(5);
    g = hit(g).game; // p1-a
    g = hit(g).game; // p1-b
    expect(g.boss.phasePending).toBeUndefined();
    const { game, outcome } = hit(g); // p1-c, the phase's last unrevealed one
    expect(outcome).toMatchObject({ bossHpRemaining: 2, bossKilled: false });
    expect(game.boss).toMatchObject({ phasePending: "exhausted", hp: 2, currentQuestionId: "p1-c" });
    expect(enterNextBossPhase(game).boss.currentQuestionId).toBe("p2-a"); // never a phase-1 question in phase 2
  });

  it("a shown wrong lock on an earlier phase's last unrevealed question exhausts it without rotating", () => {
    let g = phased(5);
    g = hit(g).game;
    g = hit(g).game;
    const q = g.boss.currentQuestionId;
    const { game, outcome } = answerQuestion(recordWrongLock(g, "T0", q, 0), "T0", q, false, "retry", first);
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T0" });
    expect(game.boss).toMatchObject({ phasePending: "exhausted", currentQuestionId: q, hp: 3 });
  });

  it("a flee without a shown option never exhausts a phase: the question stays unrevealed", () => {
    let g = phased(5);
    g = hit(g).game;
    g = hit(g).game;
    const { game } = answerQuestion(g, "T0", g.boss.currentQuestionId, false, "flee", first);
    expect(game.boss.phasePending).toBeUndefined();
  });

  it("the last phase out of questions repeats them, as a one-phase boss does today", () => {
    let g = enterNextBossPhase(hit(phased(1)).game);
    g = { ...g, boss: { ...g.boss, hp: 9, maxHp: 9 } };
    g = hit(g).game;
    g = hit(g).game;
    expect(g.boss.phasePending).toBeUndefined();
    expect(["p2-a", "p2-b"]).toContain(g.boss.currentQuestionId);
  });

  it("a one-phase boss has phase 1 and nothing else", () => {
    const g = makeGame();
    expect(g.boss.phases).toEqual([{ maxHp: g.boss.maxHp, questionIds: g.boss.questionIds }]);
    expect(getSpectatorView(g).bossPhase).toBe(1);
  });
});

describe("warriorRoll (docs/designs/class-abilities.md)", () => {
  it("every team starts with 2 uses; only a seeded class is set", () => {
    const g = makeGame({ warrior: true });
    expect(g.teams.map((t) => t.abilityUses)).toEqual([2, 2, 2]);
    expect(g.teams.map((t) => t.classId)).toEqual(["warrior", undefined, undefined]);
    expect(getSpectatorView(g).teams[0]).toMatchObject({ classId: "warrior", abilityUses: 2 });
  });

  it("12 is a correct answer: the team advances and the turn passes", () => {
    const g = makeGame({ warrior: true, bossThreshold: 15 });
    const { game, outcome } = warriorRoll(g, "T0", g.teams[0].currentQuestionId, 12, first);
    expect(outcome).toMatchObject({ type: "correct-room-advance", teamId: "T0", nextRoomIndex: 1 });
    expect(game.revealedQuestionIds).toContain(g.teams[0].currentQuestionId);
    expect(game.teams[0].abilityUses).toBe(2); // spendAbility takes the use, not the judgment
    expect(currentTurnTeamId(game)).toBe("T1");
  });

  it("11 is a wrong answer with retry: same question, nothing eliminated", () => {
    const g = makeGame({ warrior: true, bossThreshold: 15 });
    const q = g.teams[0].currentQuestionId;
    const { game, outcome } = warriorRoll(g, "T0", q, 11, first);
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T0" });
    expect(game.teams[0].currentQuestionId).toBe(q);
    expect(game.eliminated).toEqual({});
    expect(currentTurnTeamId(game)).toBe("T1");
  });

  it("in the boss room 12+ is a hit; a miss with nothing eliminated keeps the question", () => {
    const g = makeGame({ warrior: true, bossThreshold: 0, bossMaxHp: 3, teamCount: 1 });
    const hit = warriorRoll(g, "T0", g.boss.currentQuestionId, 20, first);
    expect(hit.outcome).toMatchObject({ type: "correct-boss-hit", bossHpRemaining: 2, reward: 10 });
    const q = hit.game.boss.currentQuestionId;
    const miss = warriorRoll(hit.game, "T0", q, 1, first);
    expect(miss.outcome).toEqual({ type: "incorrect-retry", teamId: "T0" });
    expect(miss.game.boss.currentQuestionId).toBe(q);
  });

  it("the final blow still rolls the 4d20 kill bonus", () => {
    const g = makeGame({ warrior: true, bossThreshold: 0, bossMaxHp: 1, teamCount: 1 });
    const { game, outcome } = warriorRoll(g, "T0", g.boss.currentQuestionId, 12, first);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossKilled: true, killBonus: 4 });
    expect(game.phase).toBe("finished");
  });

  it("spendAbility takes one use on the team's own turn, and refuses at 0", () => {
    const g = makeGame({ warrior: true, bossThreshold: 15 });
    const once = spendAbility(g, "T0", "warrior");
    expect(once.teams.map((t) => t.abilityUses)).toEqual([1, 2, 2]);
    const none = spendAbility(once, "T0", "warrior");
    expect(none.teams[0].abilityUses).toBe(0);
    expect(() => spendAbility(none, "T0", "warrior")).toThrow(/no ability uses/);
  });

  it("refuses another team's turn, a team without the class and a pending wrong lock", () => {
    const g = makeGame({ warrior: true, bossThreshold: 15 });
    const g1 = advanceTurn(g);
    for (const act of [(x: typeof g, id: string) => warriorRoll(x, id, x.teams.find((t) => t.id === id)!.currentQuestionId, 20), (x: typeof g, id: string) => spendAbility(x, id, "warrior")]) {
      expect(() => act(g1, "T0")).toThrow(InvalidActionError);
      expect(() => act(g1, "T1")).toThrow(/not a warrior/);
      const wrong = { ...g, pendingWrong: { teamId: "T0", questionId: g.teams[0].currentQuestionId, optionIndex: 0 } };
      expect(() => act(wrong, "T0")).toThrow(/wrong answer/);
    }
  });

  it("rollD20 covers 1-20 and isClassId rejects unknown ids", () => {
    expect(rollD20(() => 0)).toBe(1);
    expect(rollD20(() => 0.999)).toBe(20);
    expect(isClassId("warrior")).toBe(true);
    expect(isClassId("bard")).toBe(false);
  });
});
