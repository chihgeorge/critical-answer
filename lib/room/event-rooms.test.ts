// Event rooms in the room (docs/designs/event-rooms.md): the draw after a correct answer, the phone's and the host's
// open, the result held until 下一題, the narration, and a restart that keeps the drawn event.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { currentTurnTeamId } from "../game-state";
import { SNAPSHOT_KEY } from "./snapshot";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TOKEN = "host-token-0123456789abcdef";
const mc = (id: string) => ({ kind: "multipleChoice" as const, id, content: { kind: "text" as const, value: "？" }, options: ["A", "B"], correctIndex: 0 });
const bank = parseBank({
  rooms: [0, 1, 2, 3].map((r) => ({ monster: "slime-soft", baseDifficulty: 1, reward: 10 * (r + 1), questions: [mc(`r${r}-a`), mc(`r${r}-b`), mc(`r${r}-c`)] })),
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [mc("boss-a"), mc("boss-b")] },
});

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const state = (room: DungeonRoom) => JSON.parse((room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.filter((c) => JSON.parse(c[0]).type === "STATE").at(-1)![0]);
const narrations = (room: DungeonRoom) => (room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "NARRATION");
const lastSent = (conn: Conn) => JSON.parse((conn.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);

function memoryStorage(): RoomStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), delete: async (k: string) => data.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } as never;
}

function setup(opts: { eventTeam?: string; rng?: () => number; storage?: RoomStorage } = {}) {
  const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), ...(opts.storage ? { storage: opts.storage } : {}) } as unknown as RoomIO;
  const room = new DungeonRoom(io, opts.rng ?? (() => 0), { bank, e2eEventTeam: opts.eventTeam ?? "EventTeam", epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = [makeConn("p0"), makeConn("p1")];
  [T1, T2].forEach((id, i) => {
    room.onConnect(phones[i]);
    send(room, phones[i], { type: "JOIN", teamId: id, teamKey: "team-key-0123456789abcdef", teamName: i === 0 ? "EventTeam" : "Plain" });
  });
  send(room, host, { type: "HOST_START" });
  return { room, host, phones };
}

/** The turn's team answers right (a multipleChoice lock → reveal), then 上菜 and 下一題, the cooking's hold skipped. */
async function answerRight(s: ReturnType<typeof setup>, i: number) {
  const { room, host, phones } = s;
  const q = room.game!.teams[i].currentQuestionId;
  send(room, phones[i], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q]?.indexOf(0) ?? 0 });
  send(room, phones[i], { type: "TEAM_LOCK_OPTION", questionId: q });
  send(room, host, { type: "HOST_REVEAL", teamId: room.game!.teams[i].id, questionId: q });
  await vi.runAllTimersAsync();
  const eventId = state(room).eventId;
  send(room, host, { type: "HOST_SERVE", eventId });
  (room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(room, host, { type: "HOST_NEXT", eventId });
}

describe("event rooms in the room", () => {
  it("a correct answer walks the event team into an event room; the phone opens it; 下一題 passes on to a monster", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host, phones } = s;
    await answerRight(s, 0);
    const t0 = room.game!.teams[0];
    expect(t0.event?.scene).toBeDefined();
    // Team 1 plays (a plain team never meets one), then it is team 0's event turn.
    await answerRight(s, 1);
    expect(room.game!.teams[1].event).toBeUndefined();
    expect(currentTurnTeamId(room.game!)).toBe(T1);
    const before = state(room);
    expect(before.question).toBeNull();
    expect(before.view.teams[0].eventScene).toBe(t0.event!.scene);
    expect(JSON.stringify(before.view)).not.toContain(t0.event!.outcome);
    // The next line sets the scene, not a monster.
    expect(narrations(room).at(-1).lines.join("")).toMatch(/EventTeam推開門，.*(寶箱|泉水|雕像|精靈|占卜師)/);

    // A team on an event turn cannot answer.
    send(room, phones[0], { type: "TEAM_SELECT_OPTION", questionId: t0.currentQuestionId, optionIndex: 0 });
    expect(lastSent(phones[0])).toMatchObject({ type: "ERROR", detail: "event_room" });
    send(room, phones[0], { type: "TEAM_LOCK_OPTION", questionId: t0.currentQuestionId });
    expect(room.game!.teams[0].event).toBeDefined();

    send(room, phones[0], { type: "TEAM_OPEN_EVENT", eventId: before.eventId });
    const after = state(room);
    expect(after.eventReveal).toMatchObject({ teamId: T1, scene: t0.event!.scene, outcome: t0.event!.outcome });
    expect(room.game!.teams[0].event).toBeUndefined();
    expect(room.game!.teams[0].roomIndex).toBe(t0.roomIndex + 1);
    expect(currentTurnTeamId(room.game!)).toBe(T2);
    expect(after.question).not.toBeNull(); // the next team's, under the result
    // A second press under the old STATE does nothing.
    send(room, phones[0], { type: "TEAM_OPEN_EVENT", eventId: before.eventId });
    expect(lastSent(phones[0])).toMatchObject({ type: "ERROR", detail: "stale_event" });
    // The result holds the room until 下一題: team 1 cannot lock meanwhile.
    send(room, phones[1], { type: "TEAM_LOCK_OPTION", questionId: room.game!.teams[1].currentQuestionId });
    expect(lastSent(phones[1])).toMatchObject({ type: "ERROR" });
    await vi.runAllTimersAsync();
    expect(narrations(room).at(-1).eventId).toBe(after.eventId);
    send(room, host, { type: "HOST_NEXT", eventId: after.eventId });
    expect(state(room).eventReveal).toBeUndefined();
    vi.useRealTimers();
  });

  it("the host can open it for the team; a stale or wrong team's press is refused", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host } = s;
    await answerRight(s, 0);
    await answerRight(s, 1);
    send(room, host, { type: "HOST_OPEN_EVENT", teamId: T2, eventId: state(room).eventId });
    expect(lastSent(host)).toMatchObject({ type: "ERROR" });
    send(room, host, { type: "HOST_OPEN_EVENT", teamId: T1, eventId: state(room).eventId });
    expect(state(room).eventReveal?.teamId).toBe(T1);
    vi.useRealTimers();
  });

  it("a press while the last answer's reveal is still up is refused, and the event waits", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host, phones } = s;
    await answerRight(s, 0);
    // Team 1 answers right; its reveal is up when team 0's phone presses.
    const q = room.game!.teams[1].currentQuestionId;
    send(room, phones[1], { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q]?.indexOf(0) ?? 0 });
    send(room, phones[1], { type: "TEAM_LOCK_OPTION", questionId: q });
    send(room, host, { type: "HOST_REVEAL", teamId: T2, questionId: q });
    await vi.runAllTimersAsync();
    send(room, phones[0], { type: "TEAM_OPEN_EVENT", eventId: state(room).eventId });
    expect(lastSent(phones[0])).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    expect(room.game!.teams[0].event).toBeDefined();
    vi.useRealTimers();
  });

  it("a room the host picked the question for keeps its monster: no event burns the pick", async () => {
    vi.useFakeTimers();
    const s = setup();
    const { room, host } = s;
    send(room, host, { type: "HOST_QUEUE_QUESTION", target: T1, questionId: "r1-c" });
    await answerRight(s, 0);
    expect(room.game!.teams[0].event).toBeUndefined();
    expect(room.game!.teams[0].currentQuestionId).toBe("r1-c");
    vi.useRealTimers();
  });

  it("with no e2e team the room draws on its rng: the top quarter of the range is an event, the rest is not", async () => {
    vi.useFakeTimers();
    for (const [r, expected] of [[0, false], [0.74, false], [0.75, true], [0.99, true]] as const) {
      const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []) } as unknown as RoomIO;
      const room = new DungeonRoom(io, () => r, { bank });
      const host = makeConn("host");
      room.onConnect(host);
      send(room, host, { type: "HOST_CLAIM", token: TOKEN });
      const phone = makeConn("p0");
      room.onConnect(phone);
      send(room, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcdef", teamName: "A" });
      send(room, host, { type: "HOST_START" });
      const q = room.game!.teams[0].currentQuestionId;
      send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: q, correct: true, eventId: state(room).eventId });
      // A multipleChoice can't be judged by the host: lock it instead.
      if (room.game!.teams[0].roomIndex === 0) {
        send(room, phone, { type: "TEAM_SELECT_OPTION", questionId: q, optionIndex: room.game!.optionOrder[q].indexOf(0) });
        send(room, phone, { type: "TEAM_LOCK_OPTION", questionId: q });
        send(room, host, { type: "HOST_REVEAL", teamId: T1, questionId: q });
        await vi.runAllTimersAsync();
      }
      expect(!!room.game!.teams[0].event).toBe(expected);
    }
    vi.useRealTimers();
  });

  it("a restart keeps the drawn event: same scene, same outcome, nothing redrawn", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = setup({ storage });
    await answerRight(s, 0);
    await vi.runAllTimersAsync();
    const drawn = s.room.game!.teams[0].event;
    expect(drawn).toBeDefined();
    expect((storage.data.get(SNAPSHOT_KEY) as { game: { teams: { event?: unknown }[] } }).game.teams[0].event).toEqual(drawn);
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), storage } as unknown as RoomIO;
    const restored = new DungeonRoom(io, () => 0.99, { bank });
    await restored.restore();
    expect(restored.game!.teams[0].event).toEqual(drawn);
    vi.useRealTimers();
  });
});
