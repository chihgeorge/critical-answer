import { describe, it, expect } from "vitest";
import { describeTurn, FALLBACK_MONSTER, floorLabel, hostAnswerShown, roomTheme, monsterLook, nextUp, pausedOffline, PHASE_HUE_STEP, revealStage, turnLive, turnOpened } from "./turn-info";
import type { SpectatorView } from "./game-state";
import type { PublicQuestion } from "./protocol";

const pq = (over: Partial<PublicQuestion> = {}): PublicQuestion => ({
  id: "r0-q1",
  content: { kind: "text", value: "題目？" },
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
      reward: 0,
      roomIndex: 0,
      inBossPhase: false,
      online: true,
      currentQuestionId: `r${i}-q1`,
      currentSelection: null,
      abilityUses: 2,
      typedAnswer: null,
      ...t,
    })),
    bossHp: 5,
    bossMaxHp: 5,
    bossPhase: 1,
    bossCurrentQuestionId: "boss-q1",
    bossKilledBy: null,
    eliminated: {},
    mageRemoved: {},
    mageHints: {},
    pendingWrong: null,
    awaitingPrayer: null,
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

  it("picks the scene by depth: stone, then moss, then deep from room 5 on", () => {
    const at = (roomIndex: number) => describeTurn(view({}, [{ roomIndex }]), null).theme;
    expect([0, 1, 2, 3, 4, 49].map(at)).toEqual(["stone", "stone", "moss", "moss", "deep", "deep"]);
  });

  it("the classic look alternates stone and moss and never goes deep", () => {
    expect([0, 1, 2, 3, 4, 5].map((r) => roomTheme(r, true))).toEqual(["stone", "moss", "stone", "moss", "stone", "stone"]);
    expect(roomTheme(null, true)).toBe("crimson");
  });

  it("labels the floor by depth, and the boss room without a number", () => {
    expect(floorLabel(0)).toBe("地下 1 樓・入口石牆");
    expect(floorLabel(2)).toBe("地下 3 樓・苔蘚水道");
    expect(floorLabel(7)).toBe("地下 8 樓・幽暗深淵");
    expect(floorLabel(null)).toBe("首領房");
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

describe("boss phase colour (docs/designs/boss-phases.md D9)", () => {
  const boss = (hue: number) => pq({ boss: true, monster: { name: "深淵小黑龍", sprite: "dragon", hue } });
  it("turns the boss's colour by one step per phase, wrapping at 360, and leaves room monsters alone", () => {
    const inBoss = (bossPhase: number) => view({ bossPhase }, [{ inBossPhase: true }, {}]);
    expect(describeTurn(inBoss(1), boss(0)).monster.hue).toBe(0);
    expect(describeTurn(inBoss(2), boss(0)).monster.hue).toBe(PHASE_HUE_STEP);
    expect(describeTurn(inBoss(5), boss(30)).monster.hue).toBe((30 + 4 * PHASE_HUE_STEP) % 360);
    expect(describeTurn(view({ bossPhase: 3 }), pq()).monster.hue).toBe(40);
  });

  it("draws the boss from the phase card while no question is out", () => {
    const t = describeTurn(view({ bossPhase: 2 }, [{ inBossPhase: true }, {}]), null, { name: "深淵小黑龍", sprite: "dragon", hue: 0 });
    expect(t.monster).toMatchObject({ kind: "dragon", name: "深淵小黑龍", hue: PHASE_HUE_STEP });
  });
});

// Regression: the phase card drawn as a room turn when the team on turn is still in a room (D9 keeps the turn order)
// Found by /review on 2026-10-28
describe("the phase card with a room team on turn", () => {
  it("still draws the boss card (crimson, the phase's hue), while the team on turn is still a room team", () => {
    const t = describeTurn(view({ bossPhase: 2 }), null, { name: "深淵小黑龍", sprite: "dragon", hue: 0 });
    expect(t.bossScene).toBe(true);
    expect(t.inBoss).toBe(false); // the ribbon and the host do not call the room team a boss fighter
    expect(t.questionId).toBe("r0-q1");
    expect(t.theme).toBe("crimson");
    expect(t.monster.hue).toBe(PHASE_HUE_STEP);
  });
});

// Generated by /ship coverage audit.
// Value: protects=a repeat appearance's hat reaches the stage; fails_when=monsterLook drops accessory or adds one to a plain monster; why_new=no monsterLook test; seam=none; no_claim=the hat is drawn
describe("monsterLook", () => {
  it("passes a repeat's accessory through, and adds none to a plain monster", () => {
    expect(monsterLook({ ...pq().monster, accessory: "crown" }).accessory).toBe("crown");
    expect(monsterLook(pq().monster)).not.toHaveProperty("accessory");
  });

  // Value: protects=a page older than the Worker draws a slime for a sprite it does not know, instead of the error screen; fails_when=the fallback is removed; why_new=PR2 adds sprites that pre-deploy pages lack; seam=none; no_claim=Sprite/DishOnStage guards (no DOM test)
  it("draws a sprite this page does not know as a slime", () => {
    const look = monsterLook({ ...pq().monster, sprite: "not-yet-drawn" as never });
    expect([look.kind, look.scale]).toEqual(["slime", 6]);
    expect(monsterLook({ ...pq().monster, sprite: "toString" as never }).kind).toBe("slime"); // not an inherited key
  });
});

describe("nextUp / turnLive", () => {
  type S = Parameters<typeof turnLive>[0];
  const st = (over: Partial<S> = {}, viewOver: Partial<SpectatorView> = {}): S => ({ phase: "playing", view: view(viewOver), ...over }) as S;
  const fortune = (step: "intro" | "choose" | "beat" | "card") => ({ teamId: "z", condition: "lowest" as never, step });

  it("is live on our open turn only", () => {
    expect(nextUp(st())).toBe(false);
    expect(turnLive(st(), "a")).toBe(true);
    expect(turnLive(st(), "b")).toBe(false);
    expect(turnLive(st({ phase: "finished" }), "a")).toBe(false);
    expect(turnLive(st({ intro: { page: 0 } }), "a")).toBe(false);
    expect(turnLive(st({ initiative: {} as never }), "a")).toBe(false);
    expect(turnLive(st({}, { buzz: {} as never }), "a")).toBe(false); // every team plays a buzzer phase
  });

  it("holds the next team while the room waits for 下一題", () => {
    for (const held of [{ reveal: {} as never }, { eventReveal: {} as never }, { fortune: fortune("card") }, { phaseCard: { monster: pq().monster } }, { phaseCardDue: true as const }]) {
      expect(nextUp(st(held))).toBe(true);
      expect(turnLive(st(held), "a")).toBe(false);
    }
  });

  it("keeps a fortune's earlier steps on the drawing team, which acts in them", () => {
    for (const step of ["intro", "choose", "beat"] as const) expect(nextUp(st({ fortune: fortune(step) }))).toBe(false);
  });

  // Value: protects=#339, the host never reads out the next team's answer while the big screen reveals the last one;
  // fails_when=the host's answer box shows while the room holds for 下一題 or a door opens; seam=none;
  // no_claim=the page's layout (app/room/[code]/host/page.tsx)
  it("shows the host the answer only for the open question on turn", () => {
    expect(hostAnswerShown(st(), "q2", "q2")).toBe(true);
    expect(hostAnswerShown(st(), "q1", "q2")).toBe(false);
    expect(hostAnswerShown(st(), undefined, "q2")).toBe(false);
    for (const held of [{ reveal: {} as never }, { eventReveal: {} as never }, { fortune: fortune("card") }, { phaseCard: { monster: pq().monster } }, { forkBeat: {} as never }]) {
      expect(hostAnswerShown(st(held), "q2", "q2")).toBe(false);
    }
    // A miss that used up a boss phase keeps the turn on that question until the card opens: the host may still 改判答對.
    expect(hostAnswerShown(st({ phaseCardDue: true }), "q2", "q2")).toBe(true);
  });

  it("buzzes only when the turn opens, never on a connection's first STATE", () => {
    expect(turnOpened(false, true)).toBe(true);
    expect(turnOpened(null, true)).toBe(false);
    expect(turnOpened(true, true)).toBe(false);
    expect(turnOpened(false, false)).toBe(false);
  });
});

describe("pausedOffline", () => {
  it("pauses only when every team's phone is offline", () => {
    expect(pausedOffline(view({ currentTurnTeamId: null }, [{ online: false }, { online: false }]))).toBe(true);
    expect(pausedOffline(view({}, [{ online: false }, { online: true }]))).toBe(false);
    // An offline team that keeps the turn (a wrong answer to settle, a typed answer) still has the host's buttons.
    expect(pausedOffline(view({ currentTurnTeamId: "a" }, [{ online: false }, { online: false }]))).toBe(false);
    expect(pausedOffline(view({ currentTurnTeamId: null }, []))).toBe(false); // no teams: nothing to wait for
  });
});

describe("revealStage (the reveal keeps the room it was answered in)", () => {
  const boss = { sprite: "dragon", name: "首領", hue: 10 } as PublicQuestion["monster"];
  const slime = { sprite: "slime", name: "史萊姆", hue: 20 } as PublicQuestion["monster"];
  it("a boss hit that does not kill keeps the boss room and the boss, in its phase colour", () => {
    expect(revealStage({ at: { monster: boss, room: null } }, 2)).toEqual({ bossScene: true, room: null, monster: monsterLook(boss, PHASE_HUE_STEP) });
  });
  it("a room answer keeps its room and monster, never hue-shifted", () => {
    expect(revealStage({ at: { monster: slime, room: 3 } }, 3)).toEqual({ bossScene: false, room: 3, monster: monsterLook(slime) });
  });
  it("an older server's dish still works; at wins when both are there; neither means the turn's own stage", () => {
    const dish = { monster: slime, room: 1 } as never;
    expect(revealStage({ dish }, 1)?.room).toBe(1);
    expect(revealStage({ dish, at: { monster: boss, room: null } }, 1)?.room).toBeNull();
    expect(revealStage({}, 1)).toBeNull();
    expect(revealStage(null, 1)).toBeNull();
  });
});
