import { describe, expect, it, vi } from "vitest";
import { answerQuestion, createGame, endGame, sendToBoss, setTeamOnline, type GameState } from "./game-state";
import { appendGameLog, gameLog, readGameLogs } from "./game-log";
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
      expect.objectContaining({ name: "Alpha", classId: "chef", turns: 3, bossRound: 2, turnsToBoss: 2, killedBoss: false }),
      expect.objectContaining({ name: "Bravo", classId: null, turns: 3, bossRound: 2, turnsToBoss: 2, killedBoss: true }),
    ]);
    expect(log.teams.map((t) => t.rank).sort()).toEqual([1, 2]);
    // No question or answer text.
    expect(JSON.stringify(log)).not.toMatch(/"q\d|"b\d/);
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
    expect(log).toMatchObject({ endedBy: "host", startedAt: null, rounds: 1, firstBossRound: 1, bossRounds: 1 });
    expect(log.teams[1]).toMatchObject({ bossRound: 1, turnsToBoss: 0 });
    expect(log.teams[0]).toMatchObject({ bossRound: null, turnsToBoss: null, turns: 1 });
  });

  it("stores one key per game and reads them back oldest first", async () => {
    const data = new Map<string, unknown>();
    const storage = { put: (k: string, v: unknown) => void data.set(k, v), list: async ({ prefix }: { prefix: string }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))) };
    data.set("bank", {});
    const g = endGame(twoTeams(), first);
    await appendGameLog(storage, gameLog(g, 2000));
    await appendGameLog(storage, gameLog(g, 1000));
    expect((await readGameLogs(storage)).map((l) => l.endedAt)).toEqual([new Date(1000).toISOString(), new Date(2000).toISOString()]);
  });

  it("GET /api/game-logs needs the owner key", async () => {
    const key = "k".repeat(32);
    const readLogs = vi.fn(async () => []);
    const deps = { ownerKey: key, allowedOrigins: "", readLogs };
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
