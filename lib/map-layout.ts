// The big screen's live map strip (docs/designs/live-map.md): where each room, pawn, the fog and the
// boss room go, in px from the strip's left edge. Pure and types-only so it is unit-tested and never
// pulls the question bank into the browser bundle (scripts/check-bundle.sh).
//
//  [stub]=[room]=[room]=…=[furthest room]  ☁ fog ☁  [boss door | boss room]
//   └ rooms past the 7-room window, or that the width budget can't fit, fold into the stub (D8, eng D6)

export const ROOM_MIN = 40;
export const PAWN = 28; // fits a two-character tag with a gap (D10 said 26; widened after the 8-team render)
export const ROOM_PAD = 12;
export const CORRIDOR = 10;
export const FOG_MIN = 100; // two empty-room slots (D8)
export const STUB_MIN = 24;
export const MAX_ROOMS = 7;
export const BOSS_SPRITE = 52; // the king sprite plus its margins
export const BOSS_HP_MIN = 60; // the HP bar's shortest width
export const DOOR_W = 56;

export type MapTeam = { id: string; name: string; roomIndex: number; inBossPhase: boolean };
export type Pawn = { teamId: string; x: number };
export type Box = { x: number; w: number; pawns: Pawn[] };
export type MapLayout = {
  stub: Box | null;
  rooms: (Box & { index: number })[];
  fog: { x: number; w: number };
  boss: Box & { open: boolean };
};

const boxW = (pawns: number, min: number) => Math.max(min, pawns * PAWN + ROOM_PAD);

function place(x: number, w: number, ids: string[]): Box {
  const left = x + (w - (ids.length * PAWN + ROOM_PAD)) / 2 + ROOM_PAD / 2;
  return { x, w, pawns: ids.map((teamId, j) => ({ teamId, x: left + j * PAWN })) };
}

export function layoutMap(teams: MapTeam[], budget: number): MapLayout {
  const walking = teams.filter((t) => !t.inBossPhase);
  const inBoss = teams.filter((t) => t.inBossPhase).map((t) => t.id);
  const open = inBoss.length > 0;
  const frontier = Math.max(0, ...teams.map((t) => t.roomIndex)); // boss teams too: the map never shrinks (D8)
  const idsIn = (from: number, to: number) => walking.filter((t) => t.roomIndex >= from && t.roomIndex <= to).map((t) => t.id);

  const bossW = open ? BOSS_SPRITE + Math.max(BOSS_HP_MIN, inBoss.length * PAWN + 4) : DOOR_W;
  const width = (start: number) => {
    let w = start > 0 ? boxW(idsIn(0, start - 1).length, STUB_MIN) + CORRIDOR : 0;
    for (let r = start; r <= frontier; r++) w += boxW(idsIn(r, r).length, ROOM_MIN) + CORRIDOR;
    return w + FOG_MIN + bossW;
  };
  let start = Math.max(0, frontier - (MAX_ROOMS - 1));
  while (start < frontier && width(start) > budget) start++;

  let x = 0;
  let stub: Box | null = null;
  if (start > 0) {
    const ids = idsIn(0, start - 1);
    stub = place(x, boxW(ids.length, STUB_MIN), ids);
    x += stub.w + CORRIDOR;
  }
  const rooms: MapLayout["rooms"] = [];
  for (let r = start; r <= frontier; r++) {
    const ids = idsIn(r, r);
    const box = place(x, boxW(ids.length, ROOM_MIN), ids);
    rooms.push({ ...box, index: r });
    x += box.w + CORRIDOR;
  }
  // The boss sits at the right end; the fog takes whatever is between.
  const bossX = Math.max(x + FOG_MIN, budget - bossW);
  const pawns = inBoss.map((teamId, j) => ({ teamId, x: bossX + BOSS_SPRITE + j * PAWN })); // right of the king
  return { stub, rooms, fog: { x, w: bossX - x }, boss: { x: bossX, w: bossW, pawns, open } };
}

/** One-character name tags (D5): the first character, or the shortest unique prefix up to two
 * characters, or the first character plus a number when even two characters clash. */
export function nameTags(names: string[]): string[] {
  // A ZWJ emoji or flag is one tag character; a TV browser without Intl.Segmenter splits by code point instead.
  const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const split = (s: string) => (graphemes ? Array.from(graphemes.segment(s), (g) => g.segment) : Array.from(s));
  const chars = names.map((n) => split(n.trim() || "?"));
  const prefix = (i: number, k: number) => chars[i].slice(0, k).join("");
  const tags = names.map((_, i) => {
    for (const k of [1, 2]) {
      const p = prefix(i, k);
      if (chars.every((_, j) => j === i || prefix(j, k) !== p)) return p;
    }
    return null;
  });
  // A numbered tag skips any tag already taken ("小2隊" next to two "小明…" teams).
  const taken = new Set(tags);
  return tags.map((tag, i) => {
    if (tag) return tag;
    let n = 1;
    while (taken.has(prefix(i, 1) + n)) n++;
    taken.add(prefix(i, 1) + n);
    return prefix(i, 1) + n;
  });
}
