import { describe, it, expect } from "vitest";
import { describeTurn, FALLBACK_MONSTER } from "./turn-info";
import type { SpectatorView } from "./game-state";
import type { PublicQuestion } from "./protocol";

const pq = (over: Partial<PublicQuestion> = {}): PublicQuestion => ({
  id: "r0-q1",
  text: "題目？",
  difficulty: 2,
  boss: false,
  monster: { name: "害羞幽靈", sprite: "ghost", hue: 40 },
  ...over,
});

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
      currentSelection: null,
      branchChoices: {},
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
    const t = describeTurn(view({ currentTurnTeamId: "b" }, [{}, { currentQuestionId: "r1-q2" }]), null);
    expect(t.team?.name).toBe("藍隊");
    expect(t.teamIndex).toBe(1);
    expect(t.questionId).toBe("r1-q2");
    expect(t.inBoss).toBe(false);
  });

  it("takes the monster from the public question, with its sprite size and hue", () => {
    const t = describeTurn(view(), pq());
    expect(t.monster).toMatchObject({ kind: "ghost", name: "害羞幽靈", hue: 40, float: true });
    expect(t.monster.scale).toBeGreaterThan(0);
  });

  it("falls back to a default monster before the first question arrives", () => {
    expect(describeTurn(view(), null).monster).toBe(FALLBACK_MONSTER);
  });

  it("picks the scene by room and cycles when there are more rooms than scenes", () => {
    const at = (roomIndex: number) => describeTurn(view({}, [{ roomIndex }]), null).theme;
    expect(at(0)).toBe("stone");
    expect(at(1)).toBe("moss");
    expect(at(5)).toBe("stone");
  });

  it("uses the crimson scene and the boss question in the boss room", () => {
    const t = describeTurn(
      view({ bossCurrentQuestionId: "boss-q3" }, [{ inBossPhase: true, roomIndex: 4 }]),
      pq({ boss: true, monster: { name: "小黑龍", sprite: "dragon", hue: 0 } }),
    );
    expect(t.inBoss).toBe(true);
    expect(t.theme).toBe("crimson");
    expect(t.questionId).toBe("boss-q3");
    expect(t.monster.kind).toBe("dragon");
  });

  it("reports how many hits the boss has taken", () => {
    expect(describeTurn(view({ bossHp: 2, bossMaxHp: 5 }), null).bossHits).toBe(3);
  });

  it("does not throw when nobody has the turn (null id)", () => {
    const t = describeTurn(view({ currentTurnTeamId: null }), null);
    expect(t.team).toBeUndefined();
    expect(t.teamIndex).toBe(-1);
    expect(t.monster).toBe(FALLBACK_MONSTER);
    expect(t.questionId).toBeUndefined();
  });
});
