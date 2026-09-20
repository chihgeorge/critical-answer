import { describe, it, expect } from "vitest";
import { describeTurn, MONSTERS, BOSS_MONSTER } from "./turn-info";
import type { SpectatorView } from "./game-state";

function view(over: Partial<SpectatorView> = {}, teams: Partial<SpectatorView["teams"][number]>[] = [{}, {}]): SpectatorView {
  return {
    currentTurnTeamId: "a",
    teams: teams.map((t, i) => ({
      id: ["a", "b", "c"][i],
      name: ["紅隊", "藍隊", "綠隊"][i],
      score: 0,
      roomIndex: 0,
      inBossPhase: false,
      online: true,
      currentQuestionId: `r${i}-q1`,
      ...t,
    })),
    bossHp: 5,
    bossMaxHp: 5,
    bossCurrentQuestionId: "boss-q1",
    ...over,
  };
}

describe("describeTurn", () => {
  it("returns the team whose turn it is, its index and its question id", () => {
    const t = describeTurn(view({ currentTurnTeamId: "b" }, [{}, { currentQuestionId: "r1-q2" }]));
    expect(t.team?.name).toBe("藍隊");
    expect(t.teamIndex).toBe(1);
    expect(t.questionId).toBe("r1-q2");
    expect(t.inBoss).toBe(false);
  });

  it("picks the monster by room and cycles when there are more rooms than monsters", () => {
    const at = (roomIndex: number) => describeTurn(view({}, [{ roomIndex }])).monster;
    expect(at(0)).toBe(MONSTERS[0]);
    expect(at(1)).toBe(MONSTERS[1]);
    expect(at(MONSTERS.length)).toBe(MONSTERS[0]);
  });

  it("uses the boss, the crimson scene and the boss question in the boss room", () => {
    const t = describeTurn(view({ bossCurrentQuestionId: "boss-q3" }, [{ inBossPhase: true, roomIndex: 4 }]));
    expect(t.inBoss).toBe(true);
    expect(t.monster).toBe(BOSS_MONSTER);
    expect(t.theme).toBe("crimson");
    expect(t.questionId).toBe("boss-q3");
  });

  it("reports how many hits the boss has taken", () => {
    expect(describeTurn(view({ bossHp: 2, bossMaxHp: 5 })).bossHits).toBe(3);
  });

  it("does not throw when nobody has the turn (null id)", () => {
    const t = describeTurn(view({ currentTurnTeamId: null }));
    expect(t.team).toBeUndefined();
    expect(t.teamIndex).toBe(-1);
    expect(t.monster).toBe(MONSTERS[0]);
    expect(t.questionId).toBeUndefined();
  });
});
