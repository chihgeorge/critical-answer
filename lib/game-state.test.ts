import { describe, it, expect } from "vitest";
import { awardTitles } from "./podium";
import {
  createGame,
  answerQuestion,
  advanceTurn,
  currentTurnTeamId,
  isInBossPhase,
  setTeamOnline,
  getSpectatorView,
  recordOptionSelection,
  recordWrongLock,
  rollBossKillDice,
  sendToBoss,
  applySprint,
  enterEventRoom,
  openEvent,
  queueQuestion,
  pickBlock,
  pickableQuestionIds,
  enterNextBossPhase,
  buzzIn,
  openBuzz,
  skipBuzz,
  pickCategory,
  pickableCategories,
  warriorRoll,
  endGame,
  spendAbility,
  ABILITY_USES,
  MORE_ABILITY_USES,
  WARRIOR_TARGET,
  mageEliminate,
  mageHint,
  firstMeaningfulChar,
  armSneak,
  chefShare,
  pray,
  canPray,
  canPrayBeforeJudge,
  recordTextWrong,
  rollD20,
  isClassId,
  submitText,
  recordCheck,
  checkTarget,
  checkKey,
  CHECK_BONUS,
  CHECK_DC,
  BOSS_CHECK_DC,
  InvalidActionError,
  giveItem,
  drinkPotion,
  potionArmed,
  spendPotion,
  type ClassId,
  type GameState,
  type RoomTemplate,
  teamMonsterId,
} from "./game-state";
import { monsterById } from "./monster-catalog";

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
  it("deals an earlier game's shown answers last, in rooms and in every boss phase (回到大廳)", () => {
    const teams = [{ id: "T0", name: "A" }, { id: "T1", name: "B" }];
    const later = [{ maxHp: 2, questionIds: ["p2-q1", "p2-q2"] }];
    const g = createGame(teams, ...deck(3, 1, 4), ["boss-q1", "boss-q2"], { bossThreshold: 3 }, 2, first, undefined, {}, later, undefined, ["room0-q1", "room0-q2", "boss-q1", "p2-q1"]);
    expect(g.teams.map((t) => t.currentQuestionId)).toEqual(["room0-q3", "room0-q4"]);
    expect(g.boss.currentQuestionId).toBe("boss-q2");
    expect(g.boss.phases[1].questionIds).toEqual(["p2-q2", "p2-q1"]);
    // Not "revealed": a phase whose questions were all played last game is not used up.
    expect(g.revealedQuestionIds).toEqual([]);
  });

  it("repeats an earlier game's questions once nothing else is left", () => {
    const g = createGame([{ id: "T0", name: "A" }], ...deck(3, 1, 2), ["boss-q1"], { bossThreshold: 3 }, 2, first, undefined, {}, [], undefined, ["room0-q1", "room0-q2"]);
    expect(g.teams[0].currentQuestionId).toBe("room0-q1");
  });

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

  it("逃跑・換房 (switch) keeps the room and score, lowers the difficulty like a flee, and brings a new monster of the same tier", () => {
    const rooms: RoomTemplate[] = [
      { baseDifficulty: 3, reward: 30, monsterId: "slime-soft", dish: "史萊姆寒天涼拌" },
      { baseDifficulty: 3, reward: 30, monsterId: "ghost-shy", dish: "幽靈霧冰沙" },
      { baseDifficulty: 4, reward: 40, monsterId: "mimic", dish: "寶箱便當" },
    ];
    const pools = [1, 2, 3, 4, 5].map((d) => Array.from({ length: 4 }, (_, q) => `d${d}-q${q + 1}`));
    const game = createGame([{ id: "T0", name: "A" }], rooms, pools, ["boss-q1"], { bossThreshold: 99 }, 1, first);
    const { game: g2, outcome } = answerQuestion(game, "T0", "d3-q1", false, "switch", first);
    expect(outcome).toEqual({ type: "incorrect-flee", teamId: "T0", newDifficulty: 2, switchedTo: "ghost-shy" });
    const t0 = g2.teams[0];
    expect(t0).toMatchObject({ roomIndex: 0, score: 0, currentDifficulty: 2, swappedMonsterId: "ghost-shy", flees: 1, metDefeats: 0 });
    expect(t0.currentQuestionId).toBe("d2-q1");
    expect(teamMonsterId(g2, t0)).toBe("ghost-shy");
    // Beating it counts the new monster, cooks its dish, and the next room has its own monster again.
    const { game: g3 } = answerQuestion(g2, "T0", "d2-q1", true, "retry", first);
    expect(g3.defeats).toEqual({ "ghost-shy": 1 });
    expect(g3.teams[0].dishes).toEqual(["幽靈霧冰沙"]);
    expect(g3.teams[0].swappedMonsterId).toBeUndefined();
    expect(teamMonsterId(g3, g3.teams[0])).toBe("ghost-shy"); // room 1's own monster
  });

  it("逃跑・換房 with no other monster of the tier draws any other room monster from the catalog", () => {
    const rooms: RoomTemplate[] = [{ baseDifficulty: 1, reward: 10, monsterId: "slime-soft" }];
    const game = createGame([{ id: "T0", name: "A" }], rooms, poolsWith(1, ["a", "b", "c"]), ["boss-q1"], { bossThreshold: 99 }, 1, first);
    const { game: g2 } = answerQuestion(game, "T0", "a", false, "switch", first);
    const to = g2.teams[0].swappedMonsterId!;
    expect(to).not.toBe("slime-soft");
    expect(monsterById(to)?.boss).toBe(false);
  });

  it("逃跑・換房 in the boss room is a plain flee: the boss question rotates, no monster changes", () => {
    let game = makeGame({ teamCount: 1, bossThreshold: 1 });
    ({ game } = answerQuestion(game, "T0", "room0-q1", true, "retry", first));
    const { game: g2, outcome } = answerQuestion(game, "T0", "boss-q1", false, "switch", first);
    expect(outcome).toEqual({ type: "incorrect-flee", teamId: "T0", newDifficulty: 1 });
    expect(g2.boss.currentQuestionId).toBe("boss-q2");
    expect(g2.teams[0].swappedMonsterId).toBeUndefined();
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
    // Value: protects=a team entering the boss room burns no room question;
    // fails_when=boss entry deals the next room again; why_new=D9 made every later team enter this way;
    // seam=none
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

  // Value: protects=multi-field.md D2/E1: one HP per right field, reward scaled by right / total and rounded half up, the
  // kill's 4d20 unscaled; fails_when=a partial hit hurts or pays in full, or rounds another way; why_new=new rule;
  // seam=none; no_claim=the room passing the counts (lib/room/boss-buzzer.test.ts)
  it("a music question's right fields each hit for 1 HP; its reward is scaled by right / total, rounded half up", () => {
    const game = makeGame({ bossThreshold: 0, bossMaxHp: 5, teamCount: 1 });
    const hit = (right: number, total: number, crit?: number) => answerQuestion(game, "T0", game.boss.currentQuestionId, true, "retry", first, crit, undefined, { right, total }).outcome;
    expect(hit(1, 2)).toMatchObject({ bossHpRemaining: 4, reward: 5 });
    expect(hit(2, 2)).toMatchObject({ bossHpRemaining: 3, reward: 10 });
    expect(hit(1, 3)).toMatchObject({ bossHpRemaining: 4, reward: 3 });
    expect(hit(2, 3)).toMatchObject({ bossHpRemaining: 3, reward: 7 });
    expect(hit(3, 3)).toMatchObject({ bossHpRemaining: 2, reward: 10 });
    expect(hit(1, 3, 20)).toMatchObject({ bossHpRemaining: 3, reward: 5 }); // a crit adds its 1 HP; (10 + 5) × ⅓ → 5
    // The killing blow's 4d20 is not scaled (E1): 1/2 of the 10-point hit plus the whole kill bonus.
    const low = { ...game, boss: { ...game.boss, hp: 1 } };
    const kill = answerQuestion(low, "T0", low.boss.currentQuestionId, true, "retry", first, undefined, [5, 5, 5, 5], { right: 1, total: 2 }).outcome;
    expect(kill).toMatchObject({ bossKilled: true, killBonus: 20, reward: 25 });
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

  // Value: protects=a tie for first is decided by d20s the game keeps, so one team wins (podium-reveal.md D4);
  // fails_when=finishGame shares the win again or drops the dice; why_new=the rule replaced 並列第一; seam=none; no_claim=none beyond protects
  it("teams tied on reward roll a d20: the higher die wins alone, and the dice are kept", () => {
    let g = twoTeams(0, 1);
    g = { ...g, teams: g.teams.map((t) => (t.id === "T1" ? { ...t, reward: 14 } : t)) };
    // The kill's 4d20 land on 1, then the tie-break: T0 5, T1 18.
    const rolls = [0, 0, 0, 0, 4 / 20, 17 / 20];
    const { game } = answerQuestion(g, "T0", g.boss.currentQuestionId, true, "retry", () => rolls.shift() ?? 0);
    expect(game.winners).toEqual(["T1"]);
    expect(game.ranking).toEqual(["T1", "T0"]);
    expect(game.tieRolls).toEqual([{ from: 1, teams: ["T0", "T1"], values: [5, 18] }]);
  });

  it("結束冒險 ranks the same way, on the room's rng", () => {
    let g = twoTeams();
    g = { ...g, teams: g.teams.map((t) => ({ ...t, reward: 7 })) };
    const rolls = [19 / 20, 0];
    const game = endGame(g, () => rolls.shift() ?? 0);
    expect(game).toMatchObject({ phase: "finished", winners: ["T0"], ranking: ["T0", "T1"], tieRolls: [{ from: 1, teams: ["T0", "T1"], values: [20, 1] }] });
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

describe("rollBossKillDice", () => {
  it("is always between 4 and 80 (4d20)", () => {
    for (let i = 0; i < 200; i++) {
      const bonus = rollBossKillDice().reduce((a, b) => a + b);
      expect(bonus).toBeGreaterThanOrEqual(4);
      expect(bonus).toBeLessThanOrEqual(80);
    }
  });

  it("is deterministic when given a fixed rng", () => {
    expect(rollBossKillDice(() => 0).reduce((a, b) => a + b)).toBe(4); // each d20 floors to 1
    expect(rollBossKillDice(() => 0.999).reduce((a, b) => a + b)).toBe(80); // each d20 rounds up to 20
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
    for (let i = 0; i < 12; i++) { // pregate-literal: WARRIOR_TARGET=12 a loop count, not the warrior target
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

  it("8 teams in one 12-question pool never hold the same question, however often they flee", () => { // pregate-literal: WARRIOR_TARGET=12 a pool size, not the warrior target
    const seeds = Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, name: `${i}` }));
    // Seeded so a failure reproduces.
    for (const seed of [1, 2, 3]) {
      let s = seed;
      const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      let g = createGame(seeds, [{ baseDifficulty: 1, reward: 10 }], [ids("q", 12), [], [], [], []], ["boss-q1"], { bossThreshold: 99 }, 1, rng); // pregate-literal: WARRIOR_TARGET=12 a pool size, not the warrior target
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

describe("teams sharing a question split once one comes free (TODOS 題目比隊伍少時)", () => {
  // Two questions, three teams: T2 is dealt T0's question at the start, the one repeat a small bank can't avoid.
  const start = () => createGame([0, 1, 2].map((i) => ({ id: `T${i}`, name: `${i}` })), [{ baseDifficulty: 1, reward: 1 }], [["a", "b"], [], [], [], []], ["boss-q1"], { bossThreshold: 99 }, 3, first);
  const held = (g: GameState) => g.teams.map((t) => t.currentQuestionId);
  const onTurn = (g: GameState, id: string) => ({ ...g, currentTurnIndex: g.turnOrder.indexOf(id) });

  it("a question freed by the boss room goes at once to the later of the two teams sharing one", () => {
    const g = onTurn(start(), "T1");
    expect(held(g)).toEqual(["a", "b", "a"]);
    expect(held(sendToBoss(g, "T1", first))).toEqual(["a", "b", "b"]);
  });

  it("the team that answered the shared question wrong and stayed keeps it", () => {
    let g = start();
    ({ game: g } = answerQuestion(g, "T0", "a", false, "retry", first));
    expect(g.teams[0].wrongOn).toBe("a");
    g = { ...g, teams: g.teams.map((t) => (t.id === "T2" ? { ...t, wrongOn: "a" } : t.id === "T0" ? { ...t, wrongOn: undefined } : t)) };
    expect(held(sendToBoss(g, "T1", first))).toEqual(["b", "b", "a"]);
  });

  it("the team on turn is never moved mid-turn, even with its phone offline", () => {
    expect(held(sendToBoss(onTurn(start(), "T2"), "T1", first))).toEqual(["b", "b", "a"]);
    const offline = setTeamOnline(onTurn(start(), "T2"), "T2", false);
    // T0 is kept too: currentTurnTeamId names the next online team. Nobody may move, so the pair waits.
    expect(held(sendToBoss(offline, "T1", first))).toEqual(["a", "b", "a"]);
  });

  it("a freed question whose answer was shown is not handed over: the two stay together", () => {
    const g = { ...onTurn(start(), "T1"), revealedQuestionIds: ["b"] };
    expect(held(sendToBoss(g, "T1", first))).toEqual(["a", "b", "a"]);
  });

  it("a team waiting on its typed answer or its wrong lock's choice is not moved", () => {
    const g = onTurn(start(), "T1");
    const typed = { ...g, teams: g.teams.map((t) => (t.id === "T2" ? { ...t, typedAnswer: "x" } : t)) };
    expect(held(sendToBoss(typed, "T1", first))).toEqual(["b", "b", "a"]);
    const locked = recordWrongLock(onTurn(start(), "T2"), "T2", "a", 1);
    expect(held(sendToBoss(locked, "T1", first))).toEqual(["b", "b", "a"]);
  });

  it("an answer splits them too, the answering team staying, and the host's queued pick is kept", () => {
    // A question comes free outside the deal (here: added to the pool) and the next judgment splits the pair.
    let g = { ...start(), pools: [["a", "b", "c"], [], [], [], []] };
    g = queueQuestion(g, "T2", "c");
    ({ game: g } = answerQuestion(g, "T0", "a", false, "retry", first));
    expect(held(g)).toEqual(["a", "b", "a"]); // c is the host's pick for T2's next room, not a free question
    g = queueQuestion(g, "T2", null);
    g = { ...g, pools: [["a", "b", "c", "d"], [], [], [], []] };
    g = queueQuestion(g, "T2", "c");
    ({ game: g } = answerQuestion(g, "T1", "b", false, "retry", first));
    expect(held(g)).toEqual(["a", "b", "d"]);
    expect(g.teams[2].queuedQuestionId).toBe("c");
  });

  it("a wrong lock then 重答 keeps the question and its red tile with the locker; a flee clears its mark", () => {
    let g = recordWrongLock(start(), "T0", "a", 1);
    ({ game: g } = answerQuestion(g, "T0", "a", false, "retry", first));
    expect(g.teams[0].wrongOn).toBe("a");
    expect(held(sendToBoss(onTurn(g, "T0"), "T1", first))).toEqual(["a", "b", "b"]);
    g = { ...onTurn(g, "T0"), pools: [["a", "b", "c"], [], [], [], []] };
    ({ game: g } = answerQuestion(g, "T0", "a", false, "flee", first));
    expect(g.teams[0]).toMatchObject({ currentQuestionId: "c", wrongOn: undefined });
  });

  it("a bank big enough for every team: other teams' questions never change", () => {
    let g = makeGame();
    const before = held(g);
    ({ game: g } = answerQuestion(g, "T0", before[0], true, "retry", first));
    ({ game: g } = answerQuestion(g, "T1", before[1], false, "flee", first));
    g = sendToBoss(g, "T0", first);
    expect(held(g)[2]).toBe(before[2]);
    expect(new Set(held(g).slice(1)).size).toBe(2);
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
    g = { ...g, boss: { ...g.boss, queuedQuestionId: "p1-b" }, eliminated: { "p1-a": [1] }, mageHints: { "p1-a": "萬" }, teams: g.teams.map((t) => ({ ...t, currentSelection: 2 })) };
    const next = enterNextBossPhase(g);
    expect(next.mageHints?.["p1-a"]).toBeUndefined();
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
  it("a warrior starts with 4 uses and a team with no class with 2; only a seeded class is set", () => {
    const g = makeGame({ warrior: true });
    expect(g.teams.map((t) => t.abilityUses)).toEqual([MORE_ABILITY_USES, ABILITY_USES, ABILITY_USES]);
    expect(g.teams.map((t) => t.classId)).toEqual(["warrior", undefined, undefined]);
    expect(getSpectatorView(g).teams[0]).toMatchObject({ classId: "warrior", abilityUses: 4 });
  });

  it("6 is a correct answer: the team advances and the turn passes", () => {
    const g = makeGame({ warrior: true, bossThreshold: 15 });
    const { game, outcome } = warriorRoll(g, "T0", g.teams[0].currentQuestionId, WARRIOR_TARGET, first);
    expect(outcome).toMatchObject({ type: "correct-room-advance", teamId: "T0", nextRoomIndex: 1 });
    expect(game.revealedQuestionIds).toContain(g.teams[0].currentQuestionId);
    expect(game.teams[0].abilityUses).toBe(MORE_ABILITY_USES); // spendAbility takes the use, not the judgment
    expect(currentTurnTeamId(game)).toBe("T1");
  });

  it("5 is a wrong answer with retry: same question, nothing eliminated", () => {
    const g = makeGame({ warrior: true, bossThreshold: 15 });
    const q = g.teams[0].currentQuestionId;
    const { game, outcome } = warriorRoll(g, "T0", q, WARRIOR_TARGET - 1, first);
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T0" });
    expect(game.teams[0].currentQuestionId).toBe(q);
    expect(game.eliminated).toEqual({});
    expect(currentTurnTeamId(game)).toBe("T1");
  });

  it("in the boss room WARRIOR_TARGET+ is a hit; a miss with nothing eliminated keeps the question", () => {
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
    const { game, outcome } = warriorRoll(g, "T0", g.boss.currentQuestionId, WARRIOR_TARGET, first);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossKilled: true, killBonus: 4 });
    expect(game.phase).toBe("finished");
  });

  it("the final blow scores the kill dice the room already showed (kill-roll.md)", () => {
    const g = makeGame({ warrior: true, bossThreshold: 0, bossMaxHp: 1, teamCount: 1 });
    const { outcome } = warriorRoll(g, "T0", g.boss.currentQuestionId, WARRIOR_TARGET, first, false, [9, 14, 3, 17]);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", bossKilled: true, killBonus: 43 });
  });

  it("spendAbility takes one use on the team's own turn, and refuses at 0", () => {
    const g = makeGame({ warrior: true, bossThreshold: 15 });
    const once = spendAbility(g, "T0", "warrior");
    expect(once.teams.map((t) => t.abilityUses)).toEqual([3, 2, 2]);
    let none = once;
    for (let i = 1; i < MORE_ABILITY_USES; i++) none = spendAbility(none, "T0", "warrior");
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

describe("mage, cleric and thief (class-abilities.md PR 2)", () => {
  /** T0 has `classes[0]`, T1 `classes[1]`...; the boss bar is `bossMaxHp`, the boss room opens at `bossThreshold`. */
  function classGame(classes: (ClassId | undefined)[], bossThreshold = 15, bossMaxHp = 3): GameState {
    const teams = classes.map((c, i) => ({ id: `T${i}`, name: `Team ${i}`, ...(c ? { classId: c } : {}) }));
    return createGame(teams, ...deck(3, 1), ["boss-q1", "boss-q2", "boss-q3"], { bossThreshold }, bossMaxHp, first);
  }
  const wrongLock = (g: GameState, id: string) => recordWrongLock(g, id, currentQ(g, id), 0);
  const currentQ = (g: GameState, id: string) => (isInBossPhase(g, id) ? g.boss.currentQuestionId : g.teams.find((t) => t.id === id)!.currentQuestionId);

  it("abilityUsesFor: a warrior and a mage start with 4 uses, a thief and a cleric with 2", () => {
    expect(classGame(["warrior", "mage", "thief", "cleric"]).teams.map((t) => t.abilityUses)).toEqual([4, 4, 2, 2]);
  });

  it("sneak attack: a correct answer gives 1.5× the room reward but not the progress points, and is used up", () => {
    const g = armSneak(classGame(["thief", undefined]), "T0");
    expect(g.teams[0]).toMatchObject({ sneakArmed: true, abilityUses: 1 });
    expect(getSpectatorView(g).teams[0].sneakArmed).toBe(true);
    expect(() => armSneak(g, "T0")).toThrow(/sneak_armed/);
    const { game, outcome } = answerQuestion(g, "T0", currentQ(g, "T0"), true);
    expect(outcome).toMatchObject({ type: "correct-room-advance", pointsAwarded: 1, reward: 15 });
    expect(game.teams[0]).toMatchObject({ score: 1, reward: 15, abilityUses: 1 });
    expect(game.teams[0].sneakArmed).toBeUndefined();
  });

  it("sneak attack: a wrong answer uses it up and pays nothing", () => {
    const g = armSneak(classGame(["thief", undefined]), "T0");
    const { game } = answerQuestion(g, "T0", currentQ(g, "T0"), false, "retry");
    expect(game.teams[0]).toMatchObject({ reward: 0, abilityUses: 1 });
    expect(game.teams[0].sneakArmed).toBeUndefined();
  });

  it("sneak attack armed for a room question is dropped and refunded when the host sends the team to the boss room", () => {
    const g = sendToBoss(armSneak(classGame(["thief", undefined]), "T0"), "T0");
    expect(g.teams[0]).toMatchObject({ inBoss: true, abilityUses: 2 });
    expect(g.teams[0].sneakArmed).toBeUndefined();
  });

  it("sneak attack in the boss room takes 2 HP and gives 1.5× the hit reward and the kill bonus", () => {
    const g = armSneak(classGame(["thief"], 0, 3), "T0");
    const hit = answerQuestion(g, "T0", g.boss.currentQuestionId, true, "retry", first);
    expect(hit.outcome).toMatchObject({ type: "correct-boss-hit", bossHpRemaining: 1, reward: 15 });
    const kill = answerQuestion(armSneak(hit.game, "T0"), "T0", hit.game.boss.currentQuestionId, true, "retry", first);
    // rollBossKillDice(first) sums to 4 (4d20 all ones), ×1.5 = 6; the bar never goes below 0.
    expect(kill.outcome).toMatchObject({ type: "correct-boss-hit", bossHpRemaining: 0, bossKilled: true, killBonus: 6, reward: 21 });
    // The room's shown dice get the same 1.5× (kill-roll.md): 43 × 1.5 = 64.5 rounds to 65.
    const shown = answerQuestion(armSneak(hit.game, "T0"), "T0", hit.game.boss.currentQuestionId, true, "retry", first, undefined, [9, 14, 3, 17]);
    expect(shown.outcome).toMatchObject({ bossKilled: true, killBonus: 65, reward: 80 });
  });

  // Value: protects=the chef's 15% (eng review D1–D3); fails_when=it rounds down, skips the 4d20, or leaks to other classes.
  it("chefShare rounds half up and pays at least 1 on any gain", () => {
    expect([0, 3, 5, 10, 16, 20, 30, 53].map(chefShare)).toEqual([0, 1, 1, 2, 2, 3, 5, 8]);
  });

  it("the chef gets 15% more on a room answer; other teams get no chefBonus", () => {
    const g = classGame(["chef", undefined]);
    const { game, outcome } = answerQuestion(g, "T0", currentQ(g, "T0"), true);
    expect(outcome).toMatchObject({ type: "correct-room-advance", pointsAwarded: 1, reward: 12, chefBonus: 2 }); // pregate-literal: WARRIOR_TARGET=12 not the warrior target
    expect(game.teams[0]).toMatchObject({ score: 1, reward: 12, abilityUses: 2 }); // pregate-literal: WARRIOR_TARGET=12 not the warrior target
    const other = answerQuestion(game, "T1", currentQ(game, "T1"), true);
    expect(other.outcome).toMatchObject({ reward: 10 });
    expect(other.outcome).not.toHaveProperty("chefBonus");
  });

  it("the chef's 15% goes on the whole boss gain, the kill's 4d20 included", () => {
    const g = classGame(["chef"], 0, 2);
    const hit = answerQuestion(g, "T0", g.boss.currentQuestionId, true, "retry", first);
    expect(hit.outcome).toMatchObject({ type: "correct-boss-hit", reward: 12, chefBonus: 2 }); // pregate-literal: WARRIOR_TARGET=12 not the warrior target
    const kill = answerQuestion(hit.game, "T0", hit.game.boss.currentQuestionId, true, "retry", first, undefined, [9, 14, 3, 17]);
    // 10 + 43 = 53, and 15% of 53 rounds to 8.
    expect(kill.outcome).toMatchObject({ bossKilled: true, killBonus: 43, reward: 61, chefBonus: 8 });
    expect(kill.game.teams[0].reward).toBe(73);
  });

  it("the chef's 15% goes on a crit too, and a wrong answer pays it nothing", () => {
    const g = classGame(["chef", undefined]);
    // 10 + a crit's 5 = 15, and 15% of 15 rounds to 2.
    expect(answerQuestion(g, "T0", currentQ(g, "T0"), true, "retry", first, 20).outcome).toMatchObject({ reward: 17, chefBonus: 2, roll: { kind: "crit", value: 20 } });
    const wrong = answerQuestion(g, "T0", currentQ(g, "T0"), false, "retry");
    expect(wrong.outcome).not.toHaveProperty("chefBonus");
    expect(wrong.game.teams[0].reward).toBe(0);
  });

  it("the mage removes 2 wrong options, never the right one, and clears a pick on a removed option", () => {
    let g = classGame(["mage", undefined]);
    const q = currentQ(g, "T0");
    g = { ...g, teams: g.teams.map((t) => (t.id === "T0" ? { ...t, currentSelection: 0 } : t)) };
    const after = mageEliminate(g, "T0", q, 1, 4, first);
    expect(after.eliminated[q]).toEqual([0, 2]);
    expect(getSpectatorView(after).mageRemoved[q]).toEqual([0, 2]);
    expect(after.teams[0]).toMatchObject({ abilityUses: 3, currentSelection: null });
    // One wrong option left: nothing to remove, and nothing spent.
    expect(() => mageEliminate(after, "T0", q, 1, 4, first)).toThrow(/no_option_to_remove/);
    expect(mageEliminate(g, "T0", q, 1, 4, () => 1).eliminated[q]).toHaveLength(2); // an rng of 1 cannot hang it
  });

  // Value: protects=the hint is the answer's first letter or number and never gives a 1-character answer away (#106);
  // fails_when=punctuation, spaces or emoji become the hint, or a short answer is hinted; seam=none; no_claim=room wiring
  it("firstMeaningfulChar skips spaces, punctuation and emoji, and refuses answers with fewer than 2 letters or numbers", () => {
    expect(firstMeaningfulChar("萬家福")).toBe("萬");
    expect(firstMeaningfulChar("〈美好有家在〉")).toBe("美");
    expect(firstMeaningfulChar("  The Beatles")).toBe("T");
    expect(firstMeaningfulChar("「1984」")).toBe("1");
    expect(firstMeaningfulChar("〈萬〉")).toBeNull();
    expect(firstMeaningfulChar("🎵🎶!!")).toBeNull();
  });

  // Value: protects=one public hint per fill-in question, refusals spend nothing, and the hint leaves with the question;
  // fails_when=a second cast or a refused cast spends a use, or an old hint shows on a later deal; seam=none;
  // no_claim=the room's choice between mageHint and mageEliminate
  it("the mage's fill-in hint spends a use once per question and leaves with the question", () => {
    const g = classGame(["mage", undefined]);
    const q = currentQ(g, "T0");
    const hinted = mageHint(g, "T0", q, "萬家福");
    expect(hinted.teams[0].abilityUses).toBe(3);
    expect(getSpectatorView(hinted).mageHints).toEqual({ [q]: "萬" });
    expect(() => mageHint(hinted, "T0", q, "萬家福")).toThrow(/hint_shown/);
    expect(() => mageHint(g, "T0", q, "萬")).toThrow(/no_hint/);
    expect(() => mageHint(g, "T1", q, "萬家福")).toThrow(/not T1's turn|It is not T1/);
    const typed = { ...g, teams: g.teams.map((t) => (t.id === "T0" ? { ...t, typedAnswer: "x" } : t)) };
    expect(() => mageHint(typed, "T0", q, "萬家福")).toThrow(/answer_submitted/);
    // No eliminated entry for this question: the hint alone must still be dropped once it leaves play.
    const { game } = answerQuestion(hinted, "T0", q, true);
    expect(game.mageHints?.[q]).toBeUndefined();
  });

  // Value: protects=the hint follows the question in every way it leaves or stays in play (state matrix, /review);
  // fails_when=a flee, a send to the boss or a phase change leaves a stale hint, or a retry or a second team still
  // facing it loses it; seam=none; no_claim=the boss rotation path (a text question has no eliminated options to rotate on)
  it("the mage's hint leaves with a flee or a send to the boss room, and stays on a retry or while another team faces it", () => {
    const g = classGame(["mage", undefined]);
    const q = currentQ(g, "T0");
    const hinted = mageHint(g, "T0", q, "萬家福");
    expect(answerQuestion(hinted, "T0", q, false, "flee").game.mageHints?.[q]).toBeUndefined();
    expect(answerQuestion(hinted, "T0", q, false, "retry").game.mageHints?.[q]).toBe("萬");
    expect(sendToBoss(hinted, "T0").mageHints?.[q]).toBeUndefined();
    const shared = { ...hinted, teams: hinted.teams.map((t) => (t.id === "T1" ? { ...t, currentQuestionId: q } : t)) };
    expect(answerQuestion(shared, "T0", q, true).game.mageHints?.[q]).toBe("萬");
  });

  it("the mage removes only 1 when an option was already locked wrong, and refuses another class", () => {
    const g = classGame(["mage", "thief"]);
    const q = currentQ(g, "T0");
    const after = mageEliminate({ ...g, eliminated: { [q]: [3] } }, "T0", q, 1, 4, first);
    expect(after.eliminated[q]).toEqual([3, 0]);
    expect(after.mageRemoved?.[q]).toEqual([0]); // the wrong lock keeps its ✕ 答錯 label
    expect(() => armSneak(g, "T0")).toThrow(/not a thief/);
  });

  it("a cleric's prayer keeps the turn for its retry, once a turn", () => {
    const g = wrongLock(classGame(["cleric", undefined]), "T0");
    expect(canPray(g, "T0")).toBe(true);
    expect(getSpectatorView(g).awaitingPrayer).toBe("T0");
    const prayed = pray(g, "T0");
    expect(prayed.teams[0].abilityUses).toBe(1);
    expect(getSpectatorView(prayed).awaitingPrayer).toBeNull();
    expect(() => pray(prayed, "T0")).toThrow(/cannot pray/);
    const q = currentQ(g, "T0");
    const retry = answerQuestion(prayed, "T0", q, false, "retry").game;
    expect(currentTurnTeamId(retry)).toBe("T0");
    expect(retry.teams[0].currentQuestionId).toBe(q);
    // Wrong again in the kept turn: no second prayer, not even after a reload, and the turn moves on.
    const again = wrongLock(retry, "T0");
    expect(canPray(again, "T0")).toBe(false);
    expect(canPray(setTeamOnline(setTeamOnline(again, "T0", false), "T0", true), "T0")).toBe(false);
    const next = answerQuestion(again, "T0", q, false, "retry").game;
    expect(currentTurnTeamId(next)).toBe("T1");
    expect(next.prayerTurn).toBeUndefined();
  });

  // Value: protects=only a cleric with a use left and no prayer this turn may wait on a fill-in 答錯, and the view tells the
  // host so (#106 AC7, AC12); fails_when=a spent cleric or a non-cleric pins the turn in a wait, or mayPray shows for them;
  // seam=none; no_claim=the room's question-kind check (room tests)
  it("a cleric's fill-in 答錯 waits only while it may still pray", () => {
    const g = classGame(["cleric", undefined]);
    const q = currentQ(g, "T0");
    expect(canPrayBeforeJudge(g, "T0")).toBe(true);
    expect(getSpectatorView(g).teams.map((t) => t.mayPray)).toEqual([true, undefined]);
    const waiting = recordTextWrong(g, "T0", q);
    expect(waiting.pendingWrong).toEqual({ teamId: "T0", questionId: q, optionIndex: null });
    expect(getSpectatorView(waiting).awaitingPrayer).toBe("T0");
    expect(() => recordTextWrong(waiting, "T0", q)).toThrow(/cannot_pray/);
    const spent = { ...g, teams: g.teams.map((t, i) => (i === 0 ? { ...t, abilityUses: 0 } : t)) };
    expect(() => recordTextWrong(spent, "T0", q)).toThrow(/cannot_pray/);
    expect(() => recordTextWrong({ ...g, prayerTurn: "T0" }, "T0", q)).toThrow(/cannot_pray/);
    // Value (ship audit): protects=no wait for a cleric off its turn or on a question it no longer faces; fails_when=the
    // turn or current-question guard is dropped and a wait pins another team's turn; seam=none; no_claim=none
    const two = classGame(["cleric", "cleric"]);
    expect(() => recordTextWrong(two, "T1", currentQ(two, "T1"))).toThrow(/turn/);
    expect(() => recordTextWrong(two, "T0", currentQ(two, "T1"))).toThrow(/Stale/);
    // Praying settles it as a retry that keeps the turn on the same question.
    const retried = answerQuestion(pray(waiting, "T0"), "T0", q, false, "retry").game;
    expect(currentTurnTeamId(retried)).toBe("T0");
    expect(retried.teams[0]).toMatchObject({ currentQuestionId: q, abilityUses: 1 });
    expect(canPrayBeforeJudge(retried, "T0")).toBe(false);
  });

  it("a cleric's prayed flee deals an easier question and keeps the turn; a non-cleric cannot pray", () => {
    const g = wrongLock(classGame(["cleric", undefined]), "T0");
    const fled = answerQuestion(pray(g, "T0"), "T0", currentQ(g, "T0"), false, "flee").game;
    expect(currentTurnTeamId(fled)).toBe("T0");
    expect(fled.teams[0].currentQuestionId).not.toBe(currentQ(g, "T0"));
    const other = wrongLock(advanceTurn(classGame(["cleric", undefined])), "T1");
    expect(canPray(other, "T1")).toBe(false);
  });

  it("a cleric's prayer in the boss room rotates the question and keeps the turn", () => {
    const g = wrongLock(classGame(["cleric", undefined], 0), "T0");
    const q = g.boss.currentQuestionId;
    const { game, outcome } = answerQuestion(pray(g, "T0"), "T0", q, false, "retry");
    expect(outcome).toMatchObject({ type: "incorrect-retry", newBossQuestion: true });
    expect(game.boss.currentQuestionId).not.toBe(q);
    expect(currentTurnTeamId(game)).toBe("T0");
  });

  // Generated by /ship coverage audit.
  // Value: protects=a mage's removal on the shared boss question clears another boss team's pick on a removed option;
  // fails_when=the pick clear only looks at the caster; why_new=the existing mage test clears only the caster's pick;
  // seam=none; no_claim=room/phone rendering (pure game-state unit)
  it("a mage's removal on the boss question clears another boss team's pick on a removed option", () => {
    const g = classGame(["mage", undefined], 0);
    const q = g.boss.currentQuestionId;
    const picked = { ...g, teams: g.teams.map((t) => (t.id === "T1" ? { ...t, currentSelection: 2 } : t)) };
    const after = mageEliminate(picked, "T0", q, 1, 4, first);
    expect(after.eliminated[q]).toEqual([0, 2]);
    expect(after.teams[1].currentSelection).toBeNull();
  });

  // Generated by /ship coverage audit.
  // Value: protects=a room question leaving play with the team sent to the boss drops its mageRemoved entry too;
  // fails_when=sendToBoss filters eliminated only, so a later deal of it loses the ✕ 答錯 label; why_new=only the boss
  // rotation path checks mageRemoved; seam=none; no_claim=enterNextBossPhase's drop (same helper, not exercised here)
  it("sending the mage to the boss room drops its room question's removed options", () => {
    const g = classGame(["mage", undefined]);
    const q = currentQ(g, "T0");
    const sent = sendToBoss(mageEliminate(g, "T0", q, 1, 4, first), "T0");
    expect(sent.eliminated[q]).toBeUndefined();
    expect(sent.mageRemoved?.[q]).toBeUndefined();
  });

  // R3-1: the boss question is shared, so options a mage removed count as shown for the next team's miss.
  it("a mage's removal on the boss question, then a failed warrior roll, rotates the question", () => {
    const g = classGame(["mage", "warrior"], 0);
    const q = g.boss.currentQuestionId;
    // The mage removes two options, then its phone drops: the warrior faces the same narrowed question.
    const handedOver = setTeamOnline(mageEliminate(g, "T0", q, 1, 4, first), "T0", false);
    expect(currentTurnTeamId(handedOver)).toBe("T1");
    const miss = warriorRoll(spendAbility(handedOver, "T1", "warrior"), "T1", q, 1, first);
    expect(miss.outcome).toMatchObject({ type: "incorrect-retry", newBossQuestion: true });
    expect(miss.game.boss.currentQuestionId).not.toBe(q);
    expect(miss.game.mageRemoved?.[q]).toBeUndefined(); // it left play with its eliminated set
  });
});

describe("submitText (fill-in, #104)", () => {
  // Value: protects=the turn's typed answer reaches the view and a second send is refused with it unchanged;
  // fails_when=another team, a stale question or a wrong lock can write one, or a resend overwrites it;
  // no_claim=the room's text cleaning or question-kind check (dungeon-room tests).
  it("stores one answer for the turn's team on its current question and refuses the rest", () => {
    const game = makeGame();
    expect(getSpectatorView(game).teams.every((t) => t.typedAnswer === null)).toBe(true);
    const q = game.teams[0].currentQuestionId;
    expect(() => submitText(game, "T1", game.teams[1].currentQuestionId, "x")).toThrow("not T1's turn");
    expect(() => submitText(game, "T0", "other-q", "x")).toThrow("Stale question");
    const sent = submitText(game, "T0", q, "Don't Stop");
    expect(getSpectatorView(sent).teams[0].typedAnswer).toBe("Don't Stop");
    expect(() => submitText(sent, "T0", q, "again")).toThrow("already_submitted");
    const wrong = recordWrongLock(game, "T0", q, 1);
    expect(() => submitText(wrong, "T0", q, "x")).toThrow(InvalidActionError);
  });

  // Value: protects=a team that sent its answer and put the phone down can still be judged (eng review R1);
  // fails_when=going offline skips the turn and the host's judgment throws "not your turn";
  // no_claim=the room's offline handling or the host page.
  it("keeps the turn on the sender while it is offline, until the host judges", () => {
    let game = submitText(makeGame(), "T0", "room0-q1", "答案");
    game = setTeamOnline(game, "T0", false);
    expect(currentTurnTeamId(game)).toBe("T0");
    const { game: judged } = answerQuestion(game, "T0", "room0-q1", true, "retry", first);
    expect(judged.teams[0].typedAnswer).toBeUndefined();
    expect(currentTurnTeamId(judged)).toBe("T1");
  });

  // Value: protects=every judgment, retry included, empties the typed answer so the next turn starts blank;
  // fails_when=a retry (same question) or flee keeps the old answer on the host page;
  // no_claim=the phone's input box (e2e).
  it("is cleared by a wrong judgment with retry or flee", () => {
    for (const choice of ["retry", "flee"] as const) {
      const game = submitText(makeGame({ teamCount: 1 }), "T0", "room0-q1", "x");
      const { game: next } = answerQuestion(game, "T0", "room0-q1", false, choice, first);
      expect(next.teams[0].typedAnswer).toBeUndefined();
    }
  });

  // Value: protects=sending a team to the boss room drops its typed answer and releases the turn pin;
  // fails_when=the old room answer shows against the boss question, or the turn stays stuck on it;
  // no_claim=sendToBoss's other effects (its own tests).
  it("is cleared by sendToBoss", () => {
    const game = sendToBoss(submitText(makeGame(), "T0", "room0-q1", "x"), "T0");
    expect(game.teams[0].typedAnswer).toBeUndefined();
  });

  // Value: protects=after a typed answer the thief and warrior cannot use an ability on it, and keep their uses;
  // fails_when=a use is spent or Sneak Attack armed on an answer already shown to the host;
  // no_claim=the mage and cleric (not usable on text questions; redesign is a later PR).
  it("refuses abilities after the answer is sent, spending nothing", () => {
    const teams = [{ id: "T0", name: "A", classId: "thief" as const }, { id: "T1", name: "B" }];
    const thief = submitText(createGame(teams, ...deck(3, 1), ["boss-q1"], { bossThreshold: 3 }, 2, first), "T0", "room0-q1", "x");
    expect(() => armSneak(thief, "T0")).toThrow("answer_submitted");
    const warrior = submitText(makeGame({ warrior: true }), "T0", "room0-q1", "x");
    expect(() => spendAbility(warrior, "T0", "warrior")).toThrow("answer_submitted");
    expect(warrior.teams[0].abilityUses).toBe(makeGame({ warrior: true }).teams[0].abilityUses);
  });
});

describe("dishes (docs/designs/monster-cuisine.md)", () => {
  /** Two teams; room 0 is cooked into 湯, room 1 has no dish; the boss is cooked into 龍尾. */
  function cookedGame(bossThreshold = 99, bossMaxHp = 2) {
    const rooms: RoomTemplate[] = [{ baseDifficulty: 1, reward: 10, dish: "湯" }, { baseDifficulty: 1, reward: 10 }];
    const pools = poolsWith(1, Array.from({ length: 8 }, (_, q) => `q${q + 1}`));
    const teams = [{ id: "T0", name: "A" }, { id: "T1", name: "B" }];
    return createGame(teams, rooms, pools, ["boss-q1", "boss-q2"], { bossThreshold }, bossMaxHp, first, 10, {}, [], "龍尾");
  }
  const t = (g: GameState, id: string) => g.teams.find((x) => x.id === id)!;

  it("defeating a room monster eats its dish; a room without one, a retry and a flee eat nothing", () => {
    let g = cookedGame();
    g = answerQuestion(g, "T0", t(g, "T0").currentQuestionId, true).game;
    expect(t(g, "T0").dishes).toEqual(["湯"]);
    g = answerQuestion(g, "T1", t(g, "T1").currentQuestionId, false, "retry").game;
    g = answerQuestion(g, "T0", t(g, "T0").currentQuestionId, true).game; // room 1: no dish
    g = answerQuestion(g, "T1", t(g, "T1").currentQuestionId, false, "flee").game;
    expect(t(g, "T0").dishes).toEqual(["湯"]);
    expect(t(g, "T1").dishes).toBeUndefined();
  });

  it("the answer that walks a team into the boss room still eats the room's dish", () => {
    let g = cookedGame(1);
    g = answerQuestion(g, "T0", t(g, "T0").currentQuestionId, true).game;
    expect(t(g, "T0")).toMatchObject({ inBoss: true, dishes: ["湯"] });
  });

  it("only the killing blow eats the boss's dish", () => {
    let g = cookedGame(0, 2);
    g = answerQuestion(g, "T0", g.boss.currentQuestionId, true).game; // a hit
    expect(t(g, "T0").dishes).toBeUndefined();
    g = answerQuestion(g, "T1", g.boss.currentQuestionId, true).game; // the kill
    expect(g.phase).toBe("finished");
    expect(t(g, "T1").dishes).toEqual(["龍尾"]);
  });
});

// Value: protects=the crit die's rules (dnd design R4, R5, R2): a 20 adds half the base reward and one boss heart, a 1
// changes nothing; fails_when=the bonus multiplies with the sneak, rounds wrong, raises the 4d20 or touches progress points
describe("the crit die (dnd design R4, R5)", () => {
  function critGame(classes: (ClassId | undefined)[], bossThreshold = 15, bossMaxHp = 3, rooms = makeRooms(3, 1)): GameState {
    const teams = classes.map((c, i) => ({ id: `T${i}`, name: `Team ${i}`, ...(c ? { classId: c } : {}) }));
    return createGame(teams, rooms, poolsWith(1, ["q1", "q2", "q3", "q4"]), ["boss-q1", "boss-q2", "boss-q3"], { bossThreshold }, bossMaxHp, first);
  }
  const q0 = (g: GameState) => g.teams[0].currentQuestionId;

  it("a room 20 adds half the base reward, marks the outcome and keeps progress points", () => {
    const g = critGame([undefined]);
    const { game, outcome } = answerQuestion(g, "T0", q0(g), true, "retry", first, 20);
    expect(outcome).toMatchObject({ type: "correct-room-advance", pointsAwarded: 1, reward: 15, roll: { kind: "crit", value: 20 } });
    expect(game.teams[0]).toMatchObject({ score: 1, reward: 15 });
  });

  it("a 1 is only a show: the same reward, marked as a fumble; other values leave no mark", () => {
    const g = critGame([undefined]);
    expect(answerQuestion(g, "T0", q0(g), true, "retry", first, 1).outcome).toMatchObject({ reward: 10, roll: { kind: "crit", value: 1 } });
    const plain = answerQuestion(g, "T0", q0(g), true, "retry", first, 13).outcome;
    expect(plain).toMatchObject({ reward: 10 });
    expect("roll" in plain && plain.roll).toBeFalsy();
  });

  it("a sneak and a 20 add up from the base reward, not multiplied (reward × 1.5 + half)", () => {
    const g = armSneak(critGame(["thief"]), "T0");
    expect(answerQuestion(g, "T0", q0(g), true, "retry", first, 20).outcome).toMatchObject({ reward: 20 });
  });

  it("half a reward rounds with Math.round (25 → 13)", () => {
    const g = critGame([undefined], 15, 3, [{ baseDifficulty: 1, reward: 25 }, ...makeRooms(2, 1)]);
    expect(answerQuestion(g, "T0", q0(g), true, "retry", first, 20).outcome).toMatchObject({ reward: 38 });
  });

  it("a boss 20 takes one more heart and adds half the hit reward; with a sneak it takes 3", () => {
    const g = critGame([undefined], 0, 5);
    const hit = answerQuestion(g, "T0", g.boss.currentQuestionId, true, "retry", first, 20);
    expect(hit.outcome).toMatchObject({ type: "correct-boss-hit", bossHpRemaining: 3, reward: 15, roll: { kind: "crit", value: 20 } });
    const sneaky = armSneak(critGame(["thief"], 0, 5), "T0");
    expect(answerQuestion(sneaky, "T0", sneaky.boss.currentQuestionId, true, "retry", first, 20).outcome).toMatchObject({ bossHpRemaining: 2, reward: 20 });
  });

  it("a 20 on the boss's last heart kills it, and the 4d20 is not raised by the crit", () => {
    const g = critGame([undefined], 0, 1);
    const kill = answerQuestion(g, "T0", g.boss.currentQuestionId, true, "retry", first, 20);
    // rollBossKillDice(first) sums to 4 (4d20 all ones): 10 + 5 + 4.
    expect(kill.outcome).toMatchObject({ type: "correct-boss-hit", bossHpRemaining: 0, bossKilled: true, killBonus: 4, reward: 19 });
    expect(kill.game.phase).toBe("finished");
  });

  it("a wrong answer ignores the die", () => {
    const g = critGame([undefined]);
    const { outcome } = answerQuestion(g, "T0", q0(g), false, "retry", first, 20);
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T0" });
  });

  it("a warrior's 20 is a crit on a multipleChoice question (critable) and only a hit on a fill-in", () => {
    const g = spendAbility(critGame(["warrior"]), "T0", "warrior");
    expect(warriorRoll(g, "T0", q0(g), 20, first, true).outcome).toMatchObject({ reward: 15, roll: { kind: "crit", value: 20 } });
    const fillIn = warriorRoll(g, "T0", q0(g), 20, first).outcome;
    expect(fillIn).toMatchObject({ reward: 10 });
    expect("roll" in fillIn && fillIn.roll).toBeFalsy();
  });
});

// Value: protects=every natural 20 a team rolls is counted for the crit king: crit die, warrior die, persuasion check,
// each of the kill's 4d20, and a critable warrior die only once (podium-reveal.md D5); fails_when=a source is missed,
// counted twice, or a wrong answer's ignored die counts; why_new=new counter; seam=none; no_claim=tie-break dice (rankTeams)
describe("natural 20s (podium-reveal.md D5)", () => {
  const solo = (classId?: ClassId, bossThreshold = 15, bossMaxHp = 3) =>
    createGame([{ id: "T0", name: "A", ...(classId ? { classId } : {}) }], makeRooms(3, 1), poolsWith(1, ["q1", "q2", "q3", "q4"]), ["boss-q1"], { bossThreshold }, bossMaxHp, first);
  const n20 = (g: GameState) => g.teams[0].natural20s;
  const q0 = (g: GameState) => g.teams[0].currentQuestionId;

  it("a crit die of 20 counts; a 19 or a wrong answer's die does not", () => {
    const g = solo();
    expect(n20(answerQuestion(g, "T0", q0(g), true, "retry", first, 20).game)).toBe(1);
    expect(n20(answerQuestion(g, "T0", q0(g), true, "retry", first, 19).game)).toBeUndefined();
    expect(n20(answerQuestion(g, "T0", q0(g), false, "retry", first, 20).game)).toBeUndefined();
  });

  it("a warrior's 20 counts once, critable or not", () => {
    const g = spendAbility(solo("warrior"), "T0", "warrior");
    expect(n20(warriorRoll(g, "T0", q0(g), 20, first, true).game)).toBe(1);
    expect(n20(warriorRoll(g, "T0", q0(g), 20, first).game)).toBe(1);
  });

  it("a persuasion check of 20 counts", () => {
    const g = solo();
    expect(n20(recordCheck(g, "T0", q0(g), 20, "萬家福"))).toBe(1);
    expect(n20(recordCheck(g, "T0", q0(g), 19, "萬家福"))).toBeUndefined();
  });

  it("each 20 in the kill's 4d20 counts, on top of the crit die", () => {
    const g = solo(undefined, 0, 1);
    expect(n20(answerQuestion(g, "T0", g.boss.currentQuestionId, true, "retry", first, 20, [20, 3, 20, 20]).game)).toBe(4);
  });
});

// Value: protects=the persuasion check's rules (dnd design R6, R8, R3-7, E1-1, E1-2): bonus by class against the pool's
// DC or the boss's 16, a natural 20 passes with no hint, a 1 fails and halves any success on the question, one roll per
// team and question, and the record leaves with the question; fails_when=the DC or bonus is wrong, a 1 passes, the hint
// leaks on a 20, the warrior's hit skips the half, a mage casts a second hint, or a record outlives its question;
// seam=none; no_claim=the room's beat and broadcast (dungeon-room.test.ts)
describe("the persuasion check (dnd design R6, R8)", () => {
  function checkGame(classes: (ClassId | undefined)[], bossThreshold = 15, bossMaxHp = 3): GameState {
    const teams = classes.map((c, i) => ({ id: `T${i}`, name: `Team ${i}`, ...(c ? { classId: c } : {}) }));
    return createGame(teams, ...deck(3, 1), ["boss-q1", "boss-q2", "boss-q3"], { bossThreshold }, bossMaxHp, first);
  }
  const q0 = (g: GameState) => (isInBossPhase(g, "T0") ? g.boss.currentQuestionId : g.teams[0].currentQuestionId);
  const check = (g: GameState, value: number, answer = "萬家福") => recordCheck(g, "T0", q0(g), value, answer);
  const rec = (g: GameState) => g.checks?.[checkKey(q0(g), "T0")];

  it("pins the 2026-11-08 class balance (docs/designs/class-abilities.md)", () => {
    expect(CHECK_BONUS).toEqual({ mage: 4, thief: 3, cleric: 2, chef: 1, none: 1, warrior: 0 });
    expect(WARRIOR_TARGET).toBe(9);
  });

  it("rolls the class bonus against the pool's DC, or the boss's", () => {
    const g = checkGame(["thief", "warrior", undefined]);
    expect(checkTarget(g, "T0", q0(g))).toEqual({ bonus: CHECK_BONUS.thief, dc: CHECK_DC[0] });
    expect(checkTarget(g, "T1", g.teams[1].currentQuestionId)).toEqual({ bonus: CHECK_BONUS.warrior, dc: CHECK_DC[0] });
    expect(checkTarget(g, "T2", g.teams[2].currentQuestionId)).toEqual({ bonus: CHECK_BONUS.none, dc: CHECK_DC[0] });
    const boss = checkGame(["mage"], 0);
    expect(checkTarget(boss, "T0", q0(boss))).toEqual({ bonus: CHECK_BONUS.mage, dc: BOSS_CHECK_DC });
    expect(getSpectatorView(g).teams[0].checkTarget).toEqual({ bonus: CHECK_BONUS.thief, dc: CHECK_DC[0] });
  });

  it("passes at die + bonus >= DC with the first character as its hint, and fails below it", () => {
    const g = checkGame([undefined]);
    expect(rec(check(g, 7))).toEqual({ value: 7, bonus: 1, dc: 8, passed: true, hint: "萬" });
    expect(rec(check(g, 6))).toEqual({ value: 6, bonus: 1, dc: 8, passed: false });
    // R8: an answer too short to hint passes with no hint.
    expect(rec(check(g, 15, "萬"))).toEqual({ value: 15, bonus: 1, dc: 8, passed: true });
  });

  it("a natural 20 passes with no hint even at the boss's DC; a natural 1 fails whatever the bonus", () => {
    const boss = checkGame(["thief"], 0);
    expect(rec(check(boss, 20))).toEqual({ value: 20, bonus: CHECK_BONUS.thief, dc: 16, passed: true });
    expect(rec(check(checkGame(["thief"]), 1))).toMatchObject({ value: 1, passed: false });
  });

  it("rolls once per team and question, on its own turn and current question only", () => {
    const g = check(checkGame([undefined, undefined]), 9);
    expect(() => check(g, 12)).toThrow(/check_done/); // pregate-literal: WARRIOR_TARGET=12 not the warrior target
    expect(() => recordCheck(g, "T1", g.teams[1].currentQuestionId, 9, "萬家福")).toThrow(/not_your_turn/);
    expect(() => recordCheck(checkGame([undefined]), "T0", "not-mine", 9, "萬家福")).toThrow();
  });

  it("a natural 1 halves the success on that question, before the sneak, and marks the outcome", () => {
    const g = check(checkGame([undefined]), 1);
    expect(answerQuestion(g, "T0", q0(g), true).outcome).toMatchObject({ reward: 5, roll: { kind: "check", value: 1 } });
    // 10 halved is 5, then the sneak's ×1.5 = 7.5 rounds to 8.
    const sneaky = check(armSneak(checkGame(["thief"]), "T0"), 1);
    expect(answerQuestion(sneaky, "T0", q0(sneaky), true).outcome).toMatchObject({ reward: 8 });
    const boss = check(checkGame([undefined], 0), 1);
    expect(answerQuestion(boss, "T0", q0(boss), true).outcome).toMatchObject({ type: "correct-boss-hit", reward: 5 });
  });

  it("a warrior's hit after a natural-1 check is halved too (R3-7)", () => {
    const g = spendAbility(check(checkGame(["warrior"]), 1), "T0", "warrior");
    expect(warriorRoll(g, "T0", q0(g), 15).outcome).toMatchObject({ reward: 5 });
  });

  it("a natural 20's correct outcome is marked as a check, not a crit, and pays the plain reward", () => {
    const g = check(checkGame([undefined]), 20);
    expect(answerQuestion(g, "T0", q0(g), true).outcome).toMatchObject({ reward: 10, roll: { kind: "check", value: 20 } });
  });

  it("a mage cannot cast a hint the team's own check already gave, and spends nothing", () => {
    const g = check(checkGame(["mage"]), 9);
    expect(() => mageHint(g, "T0", q0(g), "萬家福")).toThrow(/hint_shown/);
    expect(g.teams[0].abilityUses).toBe(checkGame(["mage"]).teams[0].abilityUses);
  });

  it("a check after the mage's hint passes with no second copy of it", () => {
    const g = mageHint(checkGame(["mage"]), "T0", q0(checkGame(["mage"])), "萬家福");
    expect(rec(check(g, 9))).toEqual({ value: 9, bonus: CHECK_BONUS.mage, dc: 8, passed: true });
  });

  it("a question leaving play drops only its own checks, even when ids hold a colon", () => {
    const g = check(checkGame([undefined]), 9);
    const q = q0(g);
    const other = { [checkKey(`${q}:x`, "T0")]: { value: 1, bonus: 0, dc: 8, passed: false } };
    const next = answerQuestion({ ...g, checks: { ...g.checks, ...other } }, "T0", q, true).game;
    expect(next.checks?.[checkKey(q, "T0")]).toBeUndefined();
    expect(next.checks?.[checkKey(`${q}:x`, "T0")]).toEqual(other[checkKey(`${q}:x`, "T0")]);
  });

  it("the record stays on a retry and leaves with a correct answer or a flee; a game saved before checks still plays", () => {
    const g = check(checkGame([undefined]), 9);
    const q = q0(g);
    expect(answerQuestion(g, "T0", q, false, "retry").game.checks?.[checkKey(q, "T0")]).toBeDefined();
    expect(answerQuestion(g, "T0", q, false, "flee").game.checks?.[checkKey(q, "T0")]).toBeUndefined();
    expect(answerQuestion(g, "T0", q, true).game.checks?.[checkKey(q, "T0")]).toBeUndefined();
    const old: Partial<GameState> = { ...checkGame([undefined]) };
    delete old.checks;
    expect(answerQuestion(old as GameState, "T0", q, true).outcome).toMatchObject({ reward: 10 });
    expect(getSpectatorView(old as GameState).checks).toEqual({});
  });
});

describe("monster defeats (docs/designs/monster-catalog.md §3)", () => {
  const withMonsters = (): GameState => {
    const game = makeGame({ teamCount: 1, bossThreshold: 99 });
    return { ...game, rooms: game.rooms.map((r, i) => ({ ...r, monsterId: i === 1 ? "ghost-shy" : "slime-soft" })) };
  };

  // Value: protects=only defeating a room monster counts, per catalog id, shared across rooms; fails_when=a wrong answer or a flee counts, or the key is the room; why_new=new counter; seam=none; no_claim=the room's broadcast
  it("counts a correct answer against the room's monster, and nothing else", () => {
    let game = withMonsters();
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, false, "retry", first));
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, false, "flee", first));
    expect(game.defeats).toBeUndefined();
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first)); // room 0: slime
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first)); // room 1: ghost
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first)); // room 2: slime again
    expect(game.defeats).toEqual({ "slime-soft": 2, "ghost-shy": 1 });
  });

  // Value: protects=a team records its room monster's defeat count when it walks in, and other teams' defeats meanwhile leave it alone (the look is fixed per room, owner 2026-11-07); fails_when=metDefeats is not set on entry, is read before this defeat counts, or follows the game-wide count; why_new=new field; seam=none; no_claim=the room's broadcast
  it("fixes each team's count for its room when it walks in", () => {
    const base = makeGame({ teamCount: 2, bossThreshold: 99 });
    let game: GameState = { ...base, rooms: base.rooms.map((r, i) => ({ ...r, monsterId: i === 1 ? "ghost-shy" : "slime-soft" })) };
    expect(game.teams.map((t) => t.metDefeats)).toEqual([0, 0]);
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first)); // T0 beats the slime, walks into the ghost's room
    expect(game.defeats).toEqual({ "slime-soft": 1 });
    expect(game.teams.map((t) => [t.roomIndex, t.metDefeats])).toEqual([[1, 0], [0, 0]]); // T1's slime keeps its look
    ({ game } = answerQuestion(game, "T1", game.teams[1].currentQuestionId, false, "retry", first)); // T1 misses: its turn passes
    expect(game.teams[1].metDefeats).toBe(0);
    ({ game } = answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first)); // ghost down, room 2 is a slime again
    expect(game.teams[0]).toMatchObject({ roomIndex: 2, metDefeats: 1 });
  });

  // Value: protects=a save from before the catalog (rooms without monsterId) counts nothing and does not throw; fails_when=an undefined key is counted; why_new=new optional field; seam=none; no_claim=none beyond protects
  it("counts nothing for rooms saved without a monster id", () => {
    const game = makeGame({ teamCount: 1, bossThreshold: 99 });
    expect(answerQuestion(game, "T0", game.teams[0].currentQuestionId, true, "retry", first).game.defeats).toBeUndefined();
  });

  // Value: protects=each game draws its variant seed once, after the deals, from the game's rng; fails_when=the seed is drawn before the deals (shifting them) or not at all; why_new=new field (R1); seam=none; no_claim=how varied real games look
  it("draws the variant seed from the rng after dealing", () => {
    expect(makeGame().variantSeed).toBe(0);
    const drawn: number[] = [];
    const rng = () => (drawn.push((drawn.length + 1) / 100), drawn.at(-1)!);
    const game = createGame([{ id: "T0", name: "A" }, { id: "T1", name: "B" }], ...deck(3, 1), ["b1"], { bossThreshold: 3 }, 2, rng);
    expect(drawn.length).toBeGreaterThan(1);
    expect(game.variantSeed).toBe(Math.floor(drawn.at(-1)! * 2 ** 32));
  });
});

describe("boss buzzer phase (docs/designs/boss-buzzer.md)", () => {
  /** Three teams; T0 alone in the boss room. Phase 1 is p1-a with 1 HP, phase 2 a buzzer phase b-a/b-b/b-c with 2 HP. */
  function buzzer(questionIds = ["b-a", "b-b", "b-c"]): GameState {
    const teams = [0, 1, 2].map((i) => ({ id: `T${i}`, name: `Team ${i}` }));
    let g = createGame(teams, ...deck(2), ["p1-a"], { bossThreshold: 15 }, 1, first, 10, {}, [{ maxHp: 2, questionIds, buzzer: true }]);
    g = sendToBoss(g, "T0");
    // Plain hits here: drop the ⚔️ 最後衝刺 blessing T0's entry gave the others.
    g = { ...g, currentTurnIndex: 0, teams: g.teams.map((t) => ({ ...t, boon: undefined })) };
    g = answerQuestion(g, "T0", "p1-a", true, "retry", first).game;
    return enterNextBossPhase(g);
  }
  const judge = (g: GameState, team: string, correct: boolean) => answerQuestion(g, team, g.boss.currentQuestionId, correct, "retry", first);

  it("a sneak armed in the phase before is given back when a buzzer phase starts (no abilities, D6)", () => {
    const teams = [0, 1].map((i) => ({ id: `T${i}`, name: `Team ${i}` }));
    let g = createGame(teams, ...deck(2), ["p1-a"], { bossThreshold: 15 }, 1, first, 10, {}, [{ maxHp: 2, questionIds: ["b-a"], buzzer: true }]);
    g = sendToBoss(g, "T0");
    g = { ...g, currentTurnIndex: 0 };
    g = answerQuestion(g, "T0", "p1-a", true, "retry", first).game;
    g = { ...g, teams: g.teams.map((t) => (t.id === "T0" ? { ...t, sneakArmed: true as const, abilityUses: 0 } : t)) };
    const t0 = enterNextBossPhase(g).teams.find((t) => t.id === "T0")!;
    expect(t0.sneakArmed).toBeUndefined();
    expect(t0.abilityUses).toBe(1);
  });

  it("the buzzer phase pulls every team into the boss room, and only the view of that phase carries a buzz", () => {
    const g = buzzer();
    expect(g.teams.every((t) => t.inBoss)).toBe(true);
    expect(getSpectatorView(g).buzz).toEqual({ questionId: "b-a", out: [] });
    expect(getSpectatorView(sendToBoss(createGame([{ id: "T0", name: "A" }], ...deck(1), ["x"], { bossThreshold: 15 }, 1, first), "T0")).buzz).toBeUndefined();
  });

  it("a video waits for ▶; the first buzz wins and takes the turn; later buzzes are refused", () => {
    let g = buzzer();
    expect(() => buzzIn(g, "T2", "b-a", false)).toThrow("buzz_closed");
    g = openBuzz(g, "b-a");
    g = buzzIn(g, "T2", "b-a", false);
    expect(g.buzz).toMatchObject({ questionId: "b-a", teamId: "T2", open: true });
    expect(currentTurnTeamId(g)).toBe("T2");
    expect(() => buzzIn(g, "T1", "b-a", true)).toThrow("buzz_taken");
    expect(() => buzzIn(g, "T1", "b-b", true)).toThrow("stale_question");
    // Only the buzzing team is judged.
    expect(() => judge(g, "T1", true)).toThrow(InvalidActionError);
  });

  it("a right buzz is a plain hit: one HP, the hit reward, a new question that needs a new buzz", () => {
    const g = buzzIn(buzzer(), "T1", "b-a", true);
    const { game, outcome } = judge(g, "T1", true);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", teamId: "T1", bossHpRemaining: 1, reward: 10 });
    expect(game.boss.currentQuestionId).toBe("b-b");
    // The winner may pick the next question's category (boss-music-buzzer.md M5).
    expect(game.buzz).toEqual({ questionId: "b-b", out: [], picker: "T1" });
  });

  it("a wrong buzz shuts that team out of the question; the others may still buzz", () => {
    const { game, outcome } = judge(buzzIn(buzzer(), "T1", "b-a", true), "T1", false);
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T1" });
    expect(game.boss.currentQuestionId).toBe("b-a");
    expect(game.buzz).toEqual({ questionId: "b-a", out: ["T1"] });
    expect(() => buzzIn(game, "T1", "b-a", true)).toThrow("buzz_out");
    expect(buzzIn(game, "T0", "b-a", true).buzz?.teamId).toBe("T0");
  });

  it("once every online team is out, everyone buzzes on the same question again (boss-music-buzzer.md M1); an offline team does not hold it up", () => {
    let g = setTeamOnline(openBuzz(buzzer(), "b-a"), "T2", false);
    g = judge(buzzIn(g, "T0", "b-a", false), "T0", false).game;
    const { game, outcome } = judge(buzzIn(g, "T1", "b-a", false), "T1", false);
    expect(outcome).toEqual({ type: "incorrect-retry", teamId: "T1" });
    expect(game.boss.currentQuestionId).toBe("b-a");
    expect(game.revealedQuestionIds).not.toContain("b-a");
    expect(game.buzz).toEqual({ questionId: "b-a", open: true, out: [] });
    expect(buzzIn(game, "T0", "b-a", false).buzz?.teamId).toBe("T0");
    expect(() => buzzIn(game, "T2", "b-a", true)).toThrow("cannot_buzz");
    // The host's 換下一題 still moves it on.
    expect(skipBuzz(game).boss.currentQuestionId).toBe("b-b");
  });

  it("a one-question buzzer phase: everyone out, or a skip, brings the same question back open to all", () => {
    let g = openBuzz(buzzer(["b-a"]), "b-a");
    g = judge(buzzIn(g, "T0", "b-a", false), "T0", false).game;
    g = judge(buzzIn(g, "T1", "b-a", false), "T1", false).game;
    g = judge(buzzIn(g, "T2", "b-a", false), "T2", false).game;
    expect(g.boss.currentQuestionId).toBe("b-a");
    expect(g.buzz).toEqual({ questionId: "b-a", open: true, out: [] });
    expect(skipBuzz(g).buzz).toEqual({ questionId: "b-a", open: true, out: [] });
  });

  it("a buzzing team that drops lets go of the buzz without being shut out", () => {
    const g = setTeamOnline(buzzIn(buzzer(), "T1", "b-a", true), "T1", false);
    expect(g.buzz).toMatchObject({ questionId: "b-a", out: [] });
    expect(g.buzz?.teamId).toBeUndefined();
    expect(buzzIn(setTeamOnline(g, "T1", true), "T1", "b-a", true).buzz?.teamId).toBe("T1");
  });

  it("the host's skip moves the question on unrevealed, but not while a team holds the buzz", () => {
    const g = buzzer();
    expect(() => skipBuzz(buzzIn(g, "T0", "b-a", true))).toThrow("buzz_taken");
    const skipped = skipBuzz(judge(buzzIn(g, "T0", "b-a", true), "T0", false).game);
    expect(skipped.boss.currentQuestionId).toBe("b-b");
    expect(skipped.revealedQuestionIds).not.toContain("b-a");
    expect(getSpectatorView(skipped).buzz).toEqual({ questionId: "b-b", out: [] });
    expect(() => skipBuzz(createGame([{ id: "T0", name: "A" }], ...deck(1), ["x"], { bossThreshold: 0 }, 1, first))).toThrow("not_buzzer_phase");
  });

  it("no class ability, check or prayer in a buzzer phase", () => {
    let g = buzzer();
    g = { ...g, teams: g.teams.map((t) => (t.id === "T0" ? { ...t, classId: "cleric" as const, abilityUses: 2 } : t)) };
    g = buzzIn(g, "T0", "b-a", true);
    expect(() => spendAbility(g, "T0", "cleric")).toThrow("buzzer_phase");
    expect(() => recordCheck(g, "T0", "b-a", 10, "答案")).toThrow("buzzer_phase");
    expect(canPrayBeforeJudge(g, "T0")).toBe(false);
  });

  it("the last team still in going offline reopens the same question to all (boss-music-buzzer.md M1)", () => {
    const g = judge(buzzIn(setTeamOnline(buzzer(), "T2", false), "T0", "b-a", true), "T0", false).game;
    expect(g.buzz?.out).toEqual(["T0"]);
    const dropped = setTeamOnline(g, "T1", false);
    expect(dropped.buzz).toEqual({ questionId: "b-a", out: [] });
    expect(dropped.boss.currentQuestionId).toBe("b-a");
  });

  it("only the team that buzzed may type its answer; the judgment or a drop clears it (boss-music-buzzer.md M2)", () => {
    const g = buzzIn(buzzer(), "T0", "b-a", true);
    expect(() => submitText(buzzer(), "T0", "b-a", "x")).toThrow("no_buzz");
    expect(() => submitText(g, "T1", "b-a", "x")).toThrow("no_buzz");
    const typed = submitText(g, "T0", "b-a", "麻辣鮮師");
    expect(getSpectatorView(typed).teams[0].typedAnswer).toBe("麻辣鮮師");
    expect(judge(typed, "T0", false).game.teams[0].typedAnswer).toBeUndefined();
    const back = setTeamOnline(setTeamOnline(typed, "T0", false), "T0", true);
    expect(back.teams[0].typedAnswer).toBeUndefined();
    expect(submitText(buzzIn(back, "T0", "b-a", true), "T0", "b-a", "y").teams[0].typedAnswer).toBe("y");
  });

  describe("category pick (boss-music-buzzer.md M5)", () => {
    const cats = { "b-a": "動漫", "b-b": "動漫", "b-c": "遊戲", "b-d": "遊戲" };
    /** T1 answered b-a right: b-b is next, T1 picks. 4 HP so nobody dies. */
    function won(): GameState {
      const teams = [0, 1, 2].map((i) => ({ id: `T${i}`, name: `Team ${i}` }));
      let g = createGame(teams, ...deck(2), ["p1-a"], { bossThreshold: 15 }, 1, first, 10, {}, [{ maxHp: 4, questionIds: ["b-a", "b-b", "b-c", "b-d"], buzzer: true }]);
      g = sendToBoss(g, "T0");
      g = { ...g, currentTurnIndex: 0, teams: g.teams.map((t) => ({ ...t, boon: undefined })) };
      g = enterNextBossPhase(answerQuestion(g, "T0", "p1-a", true, "retry", first).game);
      return judge(buzzIn(g, "T1", "b-a", true), "T1", true).game;
    }

    it("offers the categories with unrevealed questions left, only to the winner and only until buzzing opens", () => {
      const g = won();
      expect(pickableCategories(g, cats, false)).toEqual(["動漫", "遊戲"]);
      expect(pickableCategories(g, cats, true)).toEqual([]);
      expect(pickableCategories(g, {}, false)).toEqual([]);
      expect(pickableCategories(openBuzz(g, "b-b"), cats, false)).toEqual([]);
      expect(pickableCategories(judge(buzzIn(g, "T0", "b-b", true), "T0", true).game, cats, false)).toEqual(["遊戲"]);
    });

    it("draws the next question from the picked category, and may change its mind until ▶", () => {
      const g = pickCategory(won(), "T1", "遊戲", cats, false);
      expect(g.boss.currentQuestionId).toBe("b-c");
      expect(g.buzz).toEqual({ questionId: "b-c", out: [], picker: "T1", category: "遊戲" });
      expect(getSpectatorView(g).buzz?.category).toBe("遊戲");
      const back = pickCategory(g, "T1", "動漫", cats, false);
      expect(back.boss.currentQuestionId).toBe("b-b");
      // The same category keeps the question already drawn.
      expect(pickCategory(g, "T1", "遊戲", cats, false).boss.currentQuestionId).toBe("b-c");
      const opened = openBuzz(g, "b-c");
      expect(() => pickCategory(opened, "T1", "動漫", cats, false)).toThrow("too_late");
      expect(() => pickCategory(g, "T1", "動漫", cats, true)).toThrow("too_late");
    });

    it("a category pick onto the host-queued boss question clears the queue", () => {
      const g = pickCategory(queueQuestion(won(), "boss", "b-c"), "T1", "遊戲", cats, false);
      expect(g.boss.currentQuestionId).toBe("b-c");
      expect(g.boss.queuedQuestionId).toBeUndefined();
    });

    it("a pick away from a question the host queued drops that queued question; the question stays in the ring", () => {
      const teams = [0, 1, 2].map((i) => ({ id: `T${i}`, name: `Team ${i}` }));
      let g = createGame(teams, ...deck(2), ["p1-a"], { bossThreshold: 15 }, 1, first, 10, {}, [{ maxHp: 4, questionIds: ["b-a", "b-b", "b-c", "b-d"], buzzer: true }]);
      g = sendToBoss(g, "T0");
      g = { ...g, currentTurnIndex: 0, teams: g.teams.map((t) => ({ ...t, boon: undefined })) };
      g = queueQuestion(enterNextBossPhase(answerQuestion(g, "T0", "p1-a", true, "retry", first).game), "boss", "b-c");
      const won = judge(buzzIn(g, "T1", "b-a", true), "T1", true).game;
      expect(won.boss.currentQuestionId).toBe("b-c"); // the queued question came up
      const picked = pickCategory(won, "T1", "動漫", cats, false);
      expect(picked.boss.currentQuestionId).toBe("b-b");
      expect(picked.boss.queuedQuestionId).toBeUndefined();
      expect(picked.revealedQuestionIds).not.toContain("b-c");
      expect(pickableCategories(picked, cats, false)).toContain("遊戲");
    });

    it("refuses another team, a category with nothing left, and a question already buzzed", () => {
      const g = won();
      expect(() => pickCategory(g, "T0", "遊戲", cats, false)).toThrow("not_picker");
      expect(() => pickCategory(g, "T1", "流行", cats, false)).toThrow("no_such_category");
      expect(() => pickCategory(buzzIn(g, "T0", "b-b", true), "T1", "遊戲", cats, false)).toThrow("too_late");
      expect(() => pickCategory(buzzer(), "T0", "遊戲", cats, false)).toThrow("not_picker");
    });

    it("without a pick the ring goes on as before; a skip drops the pick", () => {
      expect(won().boss.currentQuestionId).toBe("b-b");
      expect(skipBuzz(won()).buzz?.picker).toBeUndefined();
    });
  });

  it("the final blow of a buzzer phase still kills with the 4d20", () => {
    const g = judge(buzzIn(buzzer(), "T0", "b-a", true), "T0", true).game;
    const { game, outcome } = judge(buzzIn(g, "T2", "b-b", true), "T2", true);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", teamId: "T2", bossKilled: true });
    expect(game.phase).toBe("finished");
    expect(getSpectatorView(game).buzz).toBeUndefined();
  });

  it("the buzz survives a JSON round trip (snapshot save and restore)", () => {
    const g = judge(buzzIn(buzzer(), "T1", "b-a", true), "T1", false).game;
    const restored = JSON.parse(JSON.stringify(g)) as GameState;
    expect(restored.buzz).toEqual({ questionId: "b-a", out: ["T1"] });
    expect(() => buzzIn(restored, "T1", "b-a", true)).toThrow("buzz_out");
  });
});

describe("⚔️ 最後衝刺 (docs/designs/last-sprint.md)", () => {
  const withReward = (g: GameState, rewards: Record<string, number>): GameState => ({ ...g, teams: g.teams.map((t) => (t.id in rewards ? { ...t, reward: rewards[t.id] } : t)) });
  const boons = (g: GameState) => g.teams.map((t) => t.boon);
  /** T0 answers right and walks into the boss room (threshold 1). */
  const enter = (g: GameState) => answerQuestion(g, "T0", g.teams[0].currentQuestionId, true, "retry", first).game;

  it("blesses the lowest-飽足感 team outside the boss room when the first team walks in on a correct answer", () => {
    const g = enter(withReward(makeGame({ bossThreshold: 1 }), { T1: 5, T2: 3 }));
    expect(g.sprint).toEqual({ teamIds: ["T2"] });
    expect(boons(g)).toEqual([undefined, undefined, "blessing"]);
    expect(getSpectatorView(g).sprint).toEqual({ teamIds: ["T2"] });
  });

  // Value: protects=✨ 女神的寵兒 counts only an event room's blessing (podium-titles.md); fails_when=the sprint's
  // blessing is written into events or awardTitles reads boons; why_new=two lanes shipped side by side; seam=none
  it("the sprint's blessing is no event-room blessing: it never earns ✨ 女神的寵兒", () => {
    let g = enter(withReward(makeGame({ bossThreshold: 1 }), { T1: 5, T2: 3 }));
    g = answerQuestion(g, "T1", g.teams[1].currentQuestionId, false, "retry", first).game;
    g = answerQuestion(g, "T2", g.teams[2].currentQuestionId, true, "retry", first).game; // spends the sprint boon
    expect(g.teams[2].events ?? []).toEqual([]);
    expect(awardTitles(g.teams).map((a) => a.id)).not.toContain("blessing");
  });

  it("blesses every team tied for lowest, offline ones too", () => {
    const g = enter(setTeamOnline(makeGame({ bossThreshold: 1 }), "T2", false));
    expect(g.sprint).toEqual({ teamIds: ["T1", "T2"] });
    expect(boons(g)).toEqual([undefined, "blessing", "blessing"]);
  });

  it("replaces a curse, and a blessing already held is named but does not stack", () => {
    const g0 = makeGame({ bossThreshold: 1 });
    const g = enter({ ...g0, teams: g0.teams.map((t) => (t.id === "T1" ? { ...t, boon: "curse" as const } : t.id === "T2" ? { ...t, boon: "blessing" as const } : t)) });
    expect(g.sprint).toEqual({ teamIds: ["T1", "T2"] });
    expect(boons(g)).toEqual([undefined, "blessing", "blessing"]);
  });

  it("fires once: a second entry changes nothing", () => {
    const g = enter(withReward(makeGame({ bossThreshold: 1 }), { T1: 5, T2: 3 }));
    const g2 = sendToBoss(withReward({ ...g, teams: g.teams.map((t) => ({ ...t, boon: undefined })) }, { T1: 0 }), "T2");
    expect(g2.sprint).toEqual({ teamIds: ["T2"] });
    expect(boons(g2)).toEqual([undefined, undefined, undefined]);
  });

  it("does not fire with a boss threshold of 0, with one team, or with no team left outside", () => {
    const zero = makeGame({ bossThreshold: 0 });
    expect(applySprint({ ...zero, teams: zero.teams.map((t) => ({ ...t, inBoss: false })) }, zero).sprint).toBeUndefined();
    expect(enter(makeGame({ bossThreshold: 1, teamCount: 1 })).sprint).toBeUndefined();
    const two = makeGame({ bossThreshold: 15, teamCount: 2 });
    const allIn = { ...two, teams: two.teams.map((t) => ({ ...t, inBoss: true })) };
    expect(applySprint(two, allIn).sprint).toBeUndefined();
  });

  it("never fires late in a restored game that already has a team in the boss room", () => {
    const g = sendToBoss({ ...makeGame({ bossThreshold: 15 }), sprint: undefined }, "T0");
    const restored: GameState = { ...g, sprint: undefined, teams: g.teams.map((t) => ({ ...t, boon: undefined })) };
    expect(sendToBoss(restored, "T1").sprint).toBeUndefined();
  });

  it("fires on the host's sendToBoss, and the blessing pays on that team's first boss hit", () => {
    const g = sendToBoss(withReward(makeGame({ bossThreshold: 15 }), { T0: 20, T2: 10 }), "T2");
    expect(g.sprint).toEqual({ teamIds: ["T1"] });
    const inBoss = sendToBoss(g, "T1");
    const turn = { ...inBoss, currentTurnIndex: 1 };
    const { outcome } = answerQuestion(turn, "T1", turn.boss.currentQuestionId, true, "retry", first);
    expect(outcome).toMatchObject({ type: "correct-boss-hit", reward: 15 });
  });

  it("does not fire on a buzzer phase's pull: a team is already in the boss room", () => {
    const teams = [0, 1, 2].map((i) => ({ id: `T${i}`, name: `Team ${i}` }));
    let g = createGame(teams, ...deck(2), ["p1-a"], { bossThreshold: 15 }, 1, first, 10, {}, [{ maxHp: 2, questionIds: ["b-a"], buzzer: true }]);
    g = sendToBoss(g, "T0");
    const blessed = g.sprint;
    g = answerQuestion({ ...g, currentTurnIndex: 0 }, "T0", "p1-a", true, "retry", first).game;
    expect(enterNextBossPhase(g).sprint).toEqual(blessed);
  });

  it("the blessing pays +50% on the next correct room answer", () => {
    const g = enter(withReward(makeGame({ bossThreshold: 1 }), { T1: 5, T2: 3 }));
    const { outcome } = answerQuestion({ ...g, currentTurnIndex: 2 }, "T2", g.teams[2].currentQuestionId, true, "retry", first);
    expect(outcome).toMatchObject({ type: "correct-room-advance", reward: 15 });
  });

  it("a curse event opened later still replaces the sprint blessing", () => {
    const g = enter(withReward(makeGame({ bossThreshold: 1 }), { T2: 5 }));
    expect(g.teams[1].boon).toBe("blessing");
    const cursed = openEvent(enterEventRoom(g, "T1", { scene: "idol", outcome: "curse" }), "T1", first).game;
    expect(cursed.teams[1].boon).toBe("curse");
    expect(cursed.sprint).toEqual({ teamIds: ["T1"] });
  });
});

describe("🧪 lucky potion (docs/designs/lucky-potion.md)", () => {
  it("giveItem: gives one, refuses a second while held, and refuses a finished game", () => {
    const g = giveItem(makeGame(), "T1");
    expect(g.teams[1]).toMatchObject({ item: "luckyPotion", potionsGiven: 1 });
    expect(() => giveItem(g, "T1")).toThrow(/item_held/);
    expect(() => giveItem(endGame(makeGame(), first), "T0")).toThrow(/not_playing/);
  });

  it("drinkPotion: arms it for the current question on the team's turn; no item, a second drink, or off turn are refused", () => {
    expect(() => drinkPotion(makeGame(), "T0")).toThrow(/no_item/);
    const held = giveItem(giveItem(makeGame(), "T0"), "T1");
    expect(() => drinkPotion(held, "T1")).toThrow(InvalidActionError);
    const g = drinkPotion(held, "T0");
    expect(g.teams[0].itemArmedFor).toBe(g.teams[0].currentQuestionId);
    expect(potionArmed(g, "T0")).toBe(true);
    expect(() => drinkPotion(g, "T0")).toThrow(/already_drunk/);
  });

  it("a question left without a roll keeps the potion, no longer armed; spendPotion takes it and counts it", () => {
    let g = drinkPotion(giveItem(makeGame(), "T0"), "T0");
    ({ game: g } = answerQuestion(g, "T0", g.teams[0].currentQuestionId, false, "flee", first));
    expect(g.teams[0].item).toBe("luckyPotion");
    expect(potionArmed(g, "T0")).toBe(false);
    const spent = spendPotion(g, "T0");
    expect(spent.teams[0]).toMatchObject({ item: undefined, itemArmedFor: undefined, potionsDrunk: 1 });
    expect(potionArmed(spent, "T0")).toBe(false);
  });

  it("a retry on the same question, or the same id dealt again later, finds the potion held, not armed", () => {
    let g = drinkPotion(giveItem(makeGame(), "T0"), "T0");
    const q = g.teams[0].currentQuestionId;
    ({ game: g } = answerQuestion(g, "T0", q, false, "retry", first));
    expect(g.teams[0].currentQuestionId).toBe(q);
    expect(potionArmed(g, "T0")).toBe(false);
    expect(g.teams[0].item).toBe("luckyPotion");
  });

  it("the public view carries item, itemArmed and itemArmedFor", () => {
    const g = drinkPotion(giveItem(makeGame(), "T0"), "T0");
    const [t0, t1] = getSpectatorView(g).teams;
    expect(t0).toMatchObject({ item: "luckyPotion", itemArmed: true, itemArmedFor: g.teams[0].currentQuestionId });
    expect(t1.item).toBeUndefined();
  });
});
