import { describe, it, expect } from "vitest";
import { parseSnapshot, SCHEMA_VERSION, type RoomSnapshot } from "./snapshot";
import { BANK } from "../question-bank-data";
import { spendAbility, createGame, DEFAULT_GAME_CONFIG } from "../game-state";
import { bossPhaseStates, poolQuestionIds, roomTemplates } from "../question-bank";

const valid = (): RoomSnapshot => ({
  schemaVersion: SCHEMA_VERSION,
  roomEpoch: "epoch-1",
  game: null,
  pendingTeams: [{ id: "00000000-0000-0000-0000-000000000001", name: "甲隊" }],
  hostToken: "host-token-0123456789abcdef",
  teamKeys: [["00000000-0000-0000-0000-000000000001", "team-key-0123456789abcdef"]],
  eventSeq: 3,
  lastNarration: { eventId: 3, lines: ["一句旁白", "氣氛", "下一隊"] },
  epilogue: null,
  epilogueRequested: false,
  notes: "",
  joinPassword: "",
  editedLines: [],
  aiNarration: false,
  aiWanted: true,
  aiSource: "own" as const,
  aiUsed: 12,
  aiLimit: 300,
  lastActivityAt: 1_700_000_000_000,
  bank: BANK,
});

describe("parseSnapshot", () => {
  // A game saved before classes (class-abilities.md): its teams have neither classId nor abilityUses.
  const gameWithTeams = (patch: (t: Record<string, unknown>, i: number) => Record<string, unknown>) => {
    const [phase] = bossPhaseStates(BANK);
    const g = createGame([{ id: "a", name: "甲隊" }, { id: "b", name: "乙隊" }], roomTemplates(BANK), poolQuestionIds(BANK), phase.questionIds, DEFAULT_GAME_CONFIG, phase.maxHp, () => 0);
    return { ...g, teams: g.teams.map((t, i) => patch(t as unknown as Record<string, unknown>, i)) };
  };
  const omit = (t: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(t).filter(([k]) => !keys.includes(k)));

  it("reads teams from before classes as plain adventurers with 2 uses, who cannot use an ability", () => {
    const game = gameWithTeams((t) => omit(t, "abilityUses", "classId"));
    const s = parseSnapshot({ ...valid(), game });
    expect(s?.game?.teams.map((t) => [t.classId, t.abilityUses])).toEqual([[undefined, 2], [undefined, 2]]);
    expect(() => spendAbility(s!.game!, "a", "warrior")).toThrow(/not a warrior/);
  });

  it("gives a team with a class but no abilityUses 2 uses, and refuses an unknown class", () => {
    const game = gameWithTeams((t, i) => (i === 0 ? { ...omit(t, "abilityUses"), classId: "warrior" } : omit(t, "abilityUses")));
    expect(parseSnapshot({ ...valid(), game })?.game?.teams[0]).toMatchObject({ classId: "warrior", abilityUses: 2 });
    expect(parseSnapshot({ ...valid(), game: gameWithTeams((t) => ({ ...t, classId: "bard" })) })).toBeNull();
    expect(parseSnapshot({ ...valid(), pendingTeams: [{ id: "x", name: "甲隊", classId: "warrior" }] })?.pendingTeams[0].classId).toBe("warrior");
    expect(parseSnapshot({ ...valid(), pendingTeams: [{ id: "x", name: "甲隊", classId: "bard" }] })).toBeNull();
    for (const abilityUses of [1.5, "2", null]) expect(parseSnapshot({ ...valid(), game: gameWithTeams((t) => ({ ...t, abilityUses })) })).toBeNull();
  });

  it("accepts what a room writes, unchanged", () => {
    const s = parseSnapshot(structuredClone(valid()));
    expect(s).toEqual(valid());
  });

  it("reads a save from before activity was tracked, as 'unknown time'", () => {
    const { lastActivityAt: _omit, ...legacy } = valid();
    void _omit;
    expect(parseSnapshot(legacy)?.lastActivityAt).toBeNull();
  });

  it("reads a save from before host-owned AI keys as no AI and a fresh budget, and refuses bad AI fields", () => {
    const { aiWanted: _w, aiSource: _s, aiUsed: _u, aiLimit: _l, ...legacy } = valid();
    void [_w, _s, _u, _l];
    // aiNarration:true here is an old room on the owner's key: it does not switch AI on by itself any more.
    expect(parseSnapshot({ ...legacy, aiNarration: true })).toMatchObject({ aiWanted: false, aiSource: "none", aiUsed: 0, aiLimit: 300 });
    for (const bad of [{ aiSource: "everyone" }, { aiUsed: -1 }, { aiUsed: 1.5 }, { aiLimit: 0 }, { aiLimit: 5001 }, { aiWanted: "yes" }]) {
      expect(parseSnapshot({ ...valid(), ...bad })).toBeNull();
    }
  });

  it("reads a save from before join passwords as a room without one", () => {
    const { joinPassword: _omit, ...legacy } = valid();
    void _omit;
    expect(parseSnapshot(legacy)?.joinPassword).toBe("");
    expect(parseSnapshot({ ...valid(), joinPassword: 42 })).toBeNull();
  });

  it("refuses anything that is not an object, and an unknown schema version", () => {
    // schemaVersion 2: a save from before teams had inBoss.
    for (const bad of [null, undefined, "room", 42, [], { schemaVersion: 999 }, { ...valid(), schemaVersion: 0 }, { ...valid(), schemaVersion: 2 }, { ...valid(), schemaVersion: 3 } /* saved before teams had reward */, { ...valid(), schemaVersion: 4 } /* saved before pools and optionOrder */]) {
      expect(parseSnapshot(bad)).toBeNull();
    }
  });

  it("refuses a snapshot with a missing or mistyped field", () => {
    const fields: [string, unknown][] = [
      ["roomEpoch", 5],
      ["hostToken", null],
      ["pendingTeams", [{ id: 1, name: "x" }]],
      ["teamKeys", [["only-one"]]],
      ["eventSeq", -1],
      ["eventSeq", 1.5],
      ["lastNarration", { eventId: "3", lines: ["x"] }],
      ["lastNarration", { eventId: 3, lines: [] }],
      ["lastNarration", { eventId: 3, lines: ["x", 5] }],
      ["lastNarration", { eventId: 3, lines: ["a", "b", "c", "d"] }], // more than 3 — the feature's contract is 1-3 segments
      ["epilogue", 7],
      ["epilogueRequested", "no"],
      ["aiNarration", 0],
      ["notes", null],
      ["editedLines", [1]],
      ["game", { phase: "playing" }],
      ["game", { teams: [], turnOrder: [], phase: "playing", pools: [[]], usedQuestionIds: [[], [], [], [], []] }], // pools not 5 lists: deal() would throw
      ["game", { teams: [], turnOrder: [], phase: "playing", pools: [[], [], [], [], []], usedQuestionIds: [[]] }], // usedQuestionIds not 5 lists
      ["lastActivityAt", "yesterday"],
      ["lastActivityAt", -5],
      // Value: protects=a mistyped phaseCard save is refused; fails_when=the boolean check is dropped; why_new=no row
      // covered phaseCard; seam=none; no_claim=restoring a valid card (lib/room/boss-phases.test.ts)
      ["phaseCard", "yes"],
    ];
    for (const [field, value] of fields) {
      expect(parseSnapshot({ ...valid(), [field]: value }), `${field}=${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("refuses a snapshot whose bank would not load today", () => {
    const broken = structuredClone(BANK);
    broken.pools[1][0].content.value = "";
    expect(parseSnapshot({ ...valid(), bank: broken })).toBeNull();
    expect(parseSnapshot({ ...valid(), bank: { rooms: [] } })).toBeNull();
  });

  it("does not throw on hostile input", () => {
    expect(() => parseSnapshot({ ...valid(), bank: "not a bank" })).not.toThrow();
    expect(() => parseSnapshot({ ...valid(), teamKeys: "x" })).not.toThrow();
  });
});
