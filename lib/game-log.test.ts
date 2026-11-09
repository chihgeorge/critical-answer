import { describe, expect, it, vi } from "vitest";
import { answerQuestion, createGame, endGame, giveItem, pray, spendPotion, recordWrongLock, sendToBoss, setTeamOnline, type GameState } from "./game-state";
import { MAX_GAME_LOGS, appendGameLog, gameLog, readGameLogs } from "./game-log";
import { handleGameLogsApi } from "./bank-api";

const first = () => 0;
function twoTeams(): GameState {
  const rooms = [1, 1, 1].map(() => ({ baseDifficulty: 1 as const, reward: 10 }));
  const pools = [Array.from({ length: 8 }, (_, i) => `q${i}`), [], [], [], []];
  return createGame([{ id: "A", name: "Alpha", classId: "chef" }, { id: "B", name: "Bravo" }], rooms, pools, ["b1", "b2", "b3"], { bossThreshold: 2 }, 2, first);
}
const answer = (g: GameState, id: string, correct: boolean) => {
  const t = g.teams.find((x) => x.id === id)!;
  return answerQuestion(g, id, t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId, correct, "retry", first).game;
};

describe("game log", () => {
  // Value: protects=the 🧪 藥水成癮 podium title's source (lucky-potion.md E8); fails_when=the counts stop reaching the log
  it("records each team's potions given and drunk, 0 for none", () => {
    const g = giveItem(spendPotion(giveItem(twoTeams(), "A"), "A"), "A");
    expect(gameLog(endGame(g, first), 0).teams).toEqual([
      expect.objectContaining({ name: "Alpha", potionsGiven: 2, potionsDrunk: 1 }),
      expect.objectContaining({ name: "Bravo", potionsGiven: 0, potionsDrunk: 0 }),
    ]);
  });

  // Value: protects=the owner's rounds-to-boss and boss-fight rounds; fails_when=round, turns or bossAt stop counting
  it("counts rounds to the boss, the boss fight's rounds and each team's turns", () => {
    let g: GameState = { ...twoTeams(), startedAt: Date.UTC(2026, 10, 21, 10) };
    g = answer(g, "A", true); // round 1
    g = answer(g, "B", false);
    g = answer(g, "A", true); // round 2: A reaches 2 points and walks in
    g = answer(g, "B", true); // B follows A in
    g = answer(g, "A", true); // round 3: boss 2 -> 1
    g = answer(g, "B", true); // kill
    expect(g.phase).toBe("finished");
    const log = gameLog(g, Date.UTC(2026, 10, 21, 10, 30));
    expect(log).toMatchObject({
      partial: false,
      startedAt: "2026-11-21T10:00:00.000Z",
      endedAt: "2026-11-21T10:30:00.000Z",
      endedBy: "kill",
      bossThreshold: 2,
      bossPhases: [{ maxHp: 2 }],
      bossPhaseReached: 1,
      bossHpLeft: 0,
      rounds: 3,
      firstBossRound: 2,
      bossRounds: 2,
    });
    expect(log.teams).toEqual([
      expect.objectContaining({ name: "Alpha", classId: "chef", turns: 3, bossRound: 2, turnsToBoss: 2, killedBoss: false, sprintBlessed: false }),
      // ⚔️ 最後衝刺: A's entry blessed B, still outside (last-sprint.md E4).
      expect.objectContaining({ name: "Bravo", classId: null, turns: 3, bossRound: 2, turnsToBoss: 2, killedBoss: true, sprintBlessed: true }),
    ]);
    expect(log.teams.map((t) => t.rank).sort()).toEqual([1, 2]);
    // No question or answer text.
    expect(JSON.stringify(log)).not.toMatch(/"q\d|"b\d/);
    // Alpha's own answer reached the threshold: ⚡ is its. Bravo walked through the open door: no earned entry.
    expect(g.teams.map((t) => t.bossAt?.earned)).toEqual([true, undefined]);
    expect(log.teams.map((t) => t.titles)).toEqual([["rush"], []]);
  });

  // Value: protects=🏃 counts every flee, room and boss alike, and the log keeps only the data titles' ids
  // (podium-titles.md); fails_when=a flee is not counted, a retry is, or the log records a consolation;
  // why_new=new counter; seam=none; no_claim=the AI's titles (never logged)
  it("counts each team's flees, in a room and at the boss, and logs the data titles by id", () => {
    const rooms = [1, 1, 1].map(() => ({ baseDifficulty: 1 as const, reward: 10 }));
    const pools = [Array.from({ length: 8 }, (_, i) => `q${i}`), [], [], [], []];
    let g = createGame([{ id: "A", name: "Alpha" }, { id: "B", name: "Bravo" }], rooms, pools, ["b1", "b2", "b3"], { bossThreshold: 99 }, 2, first);
    const flee = (x: GameState, id: string) => {
      const t = x.teams.find((y) => y.id === id)!;
      return answerQuestion(x, id, t.inBoss ? x.boss.currentQuestionId : t.currentQuestionId, false, "flee", first).game;
    };
    g = flee(g, "A");
    g = answer(g, "B", false); // a retry is no flee
    g = sendToBoss(g, "A");
    g = flee(g, "A");
    expect(g.teams.map((t) => t.flees)).toEqual([2, undefined]);
    // Sent by the host: in the boss room, but not earned.
    expect(g.teams[0].inBoss).toBe(true);
    expect(g.teams[0].bossAt?.earned).toBeUndefined();
    expect(gameLog(endGame(g), 0).teams.map((t) => t.titles)).toEqual([["flees"], []]);
  });

  it("a boss threshold of 0 lets every team in at the start, none of them earned", () => {
    const rooms = [{ baseDifficulty: 1 as const, reward: 10 }];
    const g = createGame([{ id: "A", name: "Alpha" }], rooms, [["q0", "q1"], [], [], [], []], ["b1"], { bossThreshold: 0 }, 2, first);
    expect(g.teams[0].bossAt).toEqual({ round: 1, turns: 0 });
  });

  // Value: protects=rounds stay right when phones drop (adversarial review); fails_when=a turn that skips an offline
  // team past the end of turnOrder is not counted as a new round
  it("counts a new round when the last team is offline and the turn skips back to the first", () => {
    const rooms = [1, 1, 1].map(() => ({ baseDifficulty: 1 as const, reward: 10 }));
    const pools = [Array.from({ length: 9 }, (_, i) => `q${i}`), [], [], [], []];
    let g = createGame(["A", "B", "C"].map((id) => ({ id, name: id })), rooms, pools, ["b1"], { bossThreshold: 99 }, 2, first);
    g = answer(g, "A", false);
    g = answer(g, "B", false); // the stored turn is now C
    g = setTeamOnline(g, "C", false);
    g = answer(g, "A", false); // skips C: round 2
    expect(g.round).toBe(2);
    g = answer(g, "B", false);
    g = answer(g, "A", false); // round 3
    expect(gameLog(endGame(g, first), 0)).toMatchObject({ rounds: 3 });
  });

  // Value: protects=a host end right after a round wraps; fails_when=the round counts up before anyone plays in it
  it("a host end before anyone plays in the next round does not count that round", () => {
    let g = answer(twoTeams(), "A", false);
    g = answer(g, "B", false);
    expect(gameLog(endGame(g, first), 0).rounds).toBe(1);
  });

  it("logs a host-ended game, and a team the host sent in at its own turn count", () => {
    let g = answer(twoTeams(), "A", false);
    g = sendToBoss(g, "B");
    const log = gameLog(endGame(g, first), 0);
    expect(log).toMatchObject({ endedBy: "host", partial: true, startedAt: null, rounds: 1, firstBossRound: 1, bossRounds: 1 });
    expect(log.teams[1]).toMatchObject({ bossRound: 1, turnsToBoss: 0 });
    expect(log.teams[0]).toMatchObject({ bossRound: null, turnsToBoss: null, turns: 1 });
  });

  // Value: protects=a cleric's prayer keeps one turn, not two; fails_when=the prayed wrong lock counts as a turn
  it("a cleric's prayed wrong lock and its retry count as one turn", () => {
    const rooms = [1, 1].map(() => ({ baseDifficulty: 1 as const, reward: 10 }));
    let g = createGame([{ id: "A", name: "A", classId: "cleric" }, { id: "B", name: "B" }], rooms, [["q0", "q1", "q2"], [], [], [], []], ["b1"], { bossThreshold: 99 }, 2, first);
    const q = g.teams[0].currentQuestionId;
    g = pray(recordWrongLock(g, "A", q, 0), "A");
    g = answerQuestion(g, "A", q, false, "retry", first).game; // prayed: A keeps the turn
    expect(g.teams[0].turns ?? 0).toBe(0);
    g = answer(g, "A", false);
    expect(g.teams[0].turns).toBe(1);
    const log = gameLog(endGame(g, first), 0);
    expect(log).toMatchObject({ rounds: 1, firstBossRound: null, bossRounds: null });
  });

  it("stores one key per game and reads them back oldest first", async () => {
    const data = new Map<string, unknown>();
    // Durable Object storage's list: sorted by key, `reverse` from the end, `limit` after that.
    const storage = {
      put: (k: string, v: unknown) => void data.set(k, v),
      list: async ({ prefix, reverse, limit }: { prefix: string; reverse?: boolean; limit?: number }) => {
        const sorted = [...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
        return new Map((reverse ? sorted.reverse() : sorted).slice(0, limit));
      },
    };
    data.set("bank", {});
    const g = endGame(twoTeams(), first);
    await appendGameLog(storage, gameLog(g, 2000));
    await appendGameLog(storage, gameLog(g, 1000));
    expect((await readGameLogs(storage)).map((l) => l.endedAt)).toEqual([new Date(1000).toISOString(), new Date(2000).toISOString()]);
  });

  it("reads only the newest MAX_GAME_LOGS games, still oldest first", async () => {
    const data = new Map<string, unknown>();
    for (let i = 0; i < MAX_GAME_LOGS + 2; i++) data.set(`gameLog:${String(i).padStart(5, "0")}`, { endedAt: String(i) });
    const storage = {
      put: () => {},
      list: async ({ reverse, limit }: { prefix: string; reverse?: boolean; limit?: number }) => new Map((reverse ? [...data].reverse() : [...data]).slice(0, limit)),
    };
    const logs = await readGameLogs(storage);
    expect(logs).toHaveLength(MAX_GAME_LOGS);
    expect([logs[0].endedAt, logs.at(-1)!.endedAt]).toEqual(["2", String(MAX_GAME_LOGS + 1)]);
  });

  it("a boss-only game counts every team in the boss room from round 1, and a game ended before any turn has 0 rounds", () => {
    const rooms = [{ baseDifficulty: 1 as const, reward: 10 }];
    const g = createGame([{ id: "A", name: "A" }], rooms, [["q0"], [], [], [], []], ["b1"], { bossThreshold: 0 }, 2, first);
    expect(gameLog(endGame(g, first), 0)).toMatchObject({ rounds: 0, firstBossRound: 1, teams: [{ bossRound: 1, turnsToBoss: 0 }] });
  });

  it("GET /api/game-logs needs the owner key", async () => {
    const key = "k".repeat(32);
    const readLogs = vi.fn(async () => []);
    const deps = { ownerKey: key, allowedOrigins: "https://editor.example", readLogs };
    const preflight = await handleGameLogsApi(new Request("https://x/api/game-logs", { method: "OPTIONS", headers: { Origin: "https://editor.example" } }), deps);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("https://editor.example");
    expect((await handleGameLogsApi(new Request("https://x/api/game-logs"), deps)).status).toBe(403);
    expect(readLogs).not.toHaveBeenCalled();
    const ok = await handleGameLogsApi(new Request("https://x/api/game-logs", { headers: { Authorization: `Bearer ${key}` } }), deps);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
    const wrong = await handleGameLogsApi(new Request("https://x/api/game-logs", { headers: { Authorization: `Bearer ${"x".repeat(32)}` } }), deps);
    expect(wrong.status).toBe(403);
    const post = await handleGameLogsApi(new Request("https://x/api/game-logs", { method: "POST", headers: { Authorization: `Bearer ${key}` } }), deps);
    expect(post.status).toBe(405);
    expect(readLogs).toHaveBeenCalledTimes(1);
  });
});
