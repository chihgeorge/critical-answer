import { describe, it, expect, vi } from "vitest";
import { layoutMap, nameTags, ROOM_MIN, PAWN, ROOM_PAD, MAX_ROOMS, FOG_MIN, type MapTeam, type MapLayout } from "./map-layout";

const team = (id: string, roomIndex: number, inBossPhase = false): MapTeam => ({ id, name: id, roomIndex, inBossPhase });
const right = (m: MapLayout) => m.boss.x + m.boss.w;
const allPawns = (m: MapLayout) => [...(m.stub?.pawns ?? []), ...m.rooms.flatMap((r) => r.pawns), ...m.boss.pawns].map((p) => p.teamId).sort();

describe("layoutMap", () => {
  it("sizes a room by its pawns: 40px empty, PAWN px a pawn plus padding", () => {
    for (let n = 1; n <= 8; n++) {
      const m = layoutMap(Array.from({ length: n }, (_, i) => team(`t${i}`, 1)), 900);
      expect(m.rooms.find((r) => r.index === 1)!.w).toBe(Math.max(ROOM_MIN, n * PAWN + ROOM_PAD));
    }
    expect(layoutMap([team("a", 1)], 900).rooms[0].w).toBe(ROOM_MIN); // room 0 is empty
  });

  it("draws rooms up to the furthest team, then fog, then a closed door", () => {
    const m = layoutMap([team("a", 0), team("b", 2)], 700);
    expect(m.rooms.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(m.stub).toBeNull();
    expect(m.fog.w).toBeGreaterThanOrEqual(FOG_MIN);
    expect(m.boss.open).toBe(false);
    expect(m.boss.pawns).toEqual([]);
    expect(right(m)).toBe(700);
  });

  it("opens the boss room once any team is in it, and moves that pawn there", () => {
    const m = layoutMap([team("a", 4, true), team("b", 2)], 700);
    expect(m.boss.open).toBe(true);
    expect(m.boss.pawns.map((p) => p.teamId)).toEqual(["a"]);
    expect(m.rooms.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]); // a's rooms stay drawn: the map never shrinks (D8)
    expect(m.rooms.flatMap((r) => r.pawns)).toEqual([expect.objectContaining({ teamId: "b" })]);
    expect(layoutMap([team("a", 4, true)], 700).rooms).toHaveLength(5); // everyone in the boss room
  });

  it("shows at most 7 rooms and folds the rest, with their pawns, into the entrance stub", () => {
    const m = layoutMap([team("a", 0), team("b", 9)], 900);
    expect(m.rooms).toHaveLength(MAX_ROOMS);
    expect(m.rooms[0].index).toBe(3);
    expect(m.stub!.pawns.map((p) => p.teamId)).toEqual(["a"]);
  });

  it("fits 8 teams spread over many rooms into a narrow budget, keeping every pawn", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`, i + 2));
    for (const budget of [480, 560, 650]) {
      const m = layoutMap(teams, budget);
      expect(right(m)).toBeLessThanOrEqual(budget);
      expect(m.fog.w).toBeGreaterThanOrEqual(FOG_MIN);
      expect(allPawns(m)).toEqual(teams.map((t) => t.id).sort());
    }
  });

  it("fits 8 pawns in the boss room", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`, 4, true));
    const m = layoutMap(teams, 650);
    expect(right(m)).toBeLessThanOrEqual(650);
    const xs = m.boss.pawns.map((p) => p.x);
    expect(xs[7] + PAWN).toBeLessThanOrEqual(right(m));
    expect(new Set(xs).size).toBe(8);
  });

  it("never overlaps pawns inside a room", () => {
    const m = layoutMap(Array.from({ length: 5 }, (_, i) => team(`t${i}`, 1)), 900);
    const room = m.rooms.find((r) => r.index === 1)!;
    room.pawns.forEach((p, j) => {
      expect(p.x).toBeGreaterThanOrEqual(room.x);
      expect(p.x + PAWN).toBeLessThanOrEqual(room.x + room.w);
      if (j > 0) expect(p.x - room.pawns[j - 1].x).toBe(PAWN);
    });
  });
});

describe("nameTags", () => {
  it("uses the first character when it is unique", () => {
    expect(nameTags(["紅隊", "藍隊", "綠隊"])).toEqual(["紅", "藍", "綠"]);
  });

  it("takes two characters when the first clashes", () => {
    expect(nameTags(["火箭隊", "火鍋隊", "冰"])).toEqual(["火箭", "火鍋", "冰"]);
  });

  it("numbers the character when two characters still clash", () => {
    expect(nameTags(["小明隊", "小明組", "大"])).toEqual(["小1", "小2", "大"]);
    expect(nameTags(["小2隊", "小明隊", "小明組"])).toEqual(["小2", "小1", "小3"]); // a number never repeats a real tag
  });

  it("does not split a surrogate pair or choke on a blank name", () => {
    expect(nameTags(["🐉龍隊", "  "])).toEqual(["🐉", "?"]);
    expect(nameTags(["👨‍👩‍👧隊", "🇹🇼隊"])).toEqual(["👨‍👩‍👧", "🇹🇼"]); // one grapheme each, not half a sequence
  });

  it("still tags names on a browser without Intl.Segmenter", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    try {
      expect(nameTags(["紅隊", "🐉龍隊"])).toEqual(["紅", "🐉"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
