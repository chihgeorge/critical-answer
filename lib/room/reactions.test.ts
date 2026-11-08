// 觀眾反應 (docs/designs/audience-reactions.md): a waiting team's fixed reaction is broadcast for the big screen,
// at most one per team per REACT_GAP_MS and REACT_ROOM_MAX per room in that time; never from the team on turn.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { currentTurnTeamId } from "../game-state";
import { MAX_TEAMS, parseClientMessage, REACT_GAP_MS, REACT_JITTER_MS, REACT_ROOM_MAX } from "../protocol";

const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = parseBank({
  rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("r1"), text("r2"), text("r3")] }],
  // Phase 2 is a buzzer phase (boss-buzzer.md), where every team answers at once.
  boss: { monster: "dragon", phases: [{ maxHp: 1, questions: [text("b1")] }, { name: "搶答", rule: "搶答", maxHp: 2, buzzer: true, questions: [text("z1"), text("z2")] }] },
});

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn;
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const storage = (): RoomStorage => {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage;
};

/** `teams` teams in a game started with `start`'s HOST_START options (null: still in the lobby), the clock under the test's control. */
function game(teams: number, start: object | null = {}) {
  const store = storage();
  const put = vi.spyOn(store, "put");
  const io = { broadcast: vi.fn(), storage: store } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  let now = 1_000_000;
  const room = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0, now: () => now });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const ids = Array.from({ length: teams }, (_, i) => `00000000-0000-0000-0000-00000000000${i + 1}`);
  const phones = ids.map((id, i) => {
    const c = makeConn(`phone-${i}`);
    room.onConnect(c);
    send(room, c, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: `隊${i}` });
    return c;
  });
  if (start) send(room, host, { type: "HOST_START", aiNarration: false, ...start });
  const reactions = () => io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).filter((m) => m.type === "REACTION");
  const onTurn = () => ids.indexOf(currentTurnTeamId(room.game!)!);
  const waiting = () => ids.findIndex((_, i) => i !== onTurn());
  const react = (i: number, reaction = "clap") => send(room, phones[i], { type: "REACT", reaction });
  return { room, host, ids, reactions, onTurn, waiting, react, put, io, tick: (ms: number) => void (now += ms) };
}

describe("audience reactions", () => {
  it("a waiting team's reaction is broadcast with its team id", () => {
    const g = game(3);
    const i = g.waiting();
    g.react(i, "boo");
    expect(g.reactions()).toEqual([{ type: "REACTION", teamId: g.ids[i], reaction: "boo" }]);
  });

  it("the team on turn cannot react while it is answering", () => {
    const g = game(3);
    g.react(g.onTurn());
    expect(g.reactions()).toEqual([]);
  });

  it("one reaction per team per REACT_GAP_MS, less REACT_JITTER_MS for a first tap that arrived late", () => {
    const g = game(3);
    const i = g.waiting();
    g.react(i);
    g.tick(REACT_GAP_MS - REACT_JITTER_MS - 1);
    g.react(i);
    expect(g.reactions()).toHaveLength(1);
    g.tick(1);
    g.react(i);
    expect(g.reactions()).toHaveLength(2);
  });

  it("every waiting team of a full room gets through at once", () => {
    const g = game(MAX_TEAMS);
    for (const i of g.ids.keys()) if (i !== g.onTurn()) g.react(i);
    expect(g.reactions()).toHaveLength(MAX_TEAMS - 1);
  });

  it("a team tapping as fast as it may never crowds the other waiting teams out of the room's cap", () => {
    const g = game(MAX_TEAMS);
    const waiting = g.ids.map((_, i) => i).filter((i) => i !== g.onTurn());
    g.react(waiting[0]);
    g.tick(REACT_GAP_MS - REACT_JITTER_MS);
    for (const i of waiting) g.react(i);
    expect(waiting).toHaveLength(REACT_ROOM_MAX);
    expect(g.reactions()).toHaveLength(REACT_ROOM_MAX + 1);
  });

  it("no reactions before the game starts, during the how-to-play intro or while rolling initiative", () => {
    for (const start of [null, { intro: true }, { initiative: true }]) {
      const g = game(3, start);
      for (const i of g.ids.keys()) g.react(i);
      expect(g.reactions()).toEqual([]);
    }
  });

  it("no reactions in a buzzer phase, where every team is answering", () => {
    const g = game(3);
    const state = () => g.io.broadcast.mock.calls.map((c) => JSON.parse(c[0] as string)).findLast((m) => m.type === "STATE");
    send(g.room, g.host, { type: "HOST_SEND_TO_BOSS", teamId: g.ids[0] });
    g.room.game = { ...g.room.game!, currentTurnIndex: 0 };
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: g.ids[0], questionId: g.room.game!.boss.currentQuestionId, correct: true, fleeChoice: "retry", eventId: state().eventId });
    for (let k = 0; k < 2; k++) {
      send(g.room, g.host, { type: "HOST_SERVE", eventId: state().eventId });
      (g.room as unknown as { servedAt: number }).servedAt = -Infinity;
      send(g.room, g.host, { type: "HOST_NEXT", eventId: state().eventId });
    }
    expect(state().view.buzz).toBeDefined();
    for (const i of g.ids.keys()) g.react(i);
    expect(g.reactions()).toEqual([]);
  });

  it("a reaction is never written to storage", () => {
    const g = game(3);
    g.tick(60_000);
    const writes = g.put.mock.calls.length;
    g.react(g.waiting());
    expect(g.reactions()).toHaveLength(1);
    expect(g.put.mock.calls.length).toBe(writes);
  });

  it("a host or big screen, which is not a joined team, cannot react", () => {
    const g = game(2);
    send(g.room, g.host, { type: "REACT", reaction: "clap" });
    expect(g.reactions()).toEqual([]);
  });

  it("only the fixed reactions parse: no free text", () => {
    expect(parseClientMessage({ type: "REACT", reaction: "lol" })).toEqual({ type: "REACT", reaction: "lol" });
    for (const reaction of ["幹", "toString", "__proto__", 1, undefined]) expect(parseClientMessage({ type: "REACT", reaction })).toBeNull();
  });
});
