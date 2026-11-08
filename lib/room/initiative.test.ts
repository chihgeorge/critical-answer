/* eslint-disable @typescript-eslint/no-explicit-any */
// 擲先攻 in the room (lib/initiative.ts): the phones roll after HOST_START, a team that does not roll is rolled for,
// ties are rerolled, the order holds on screen, then the game starts in that order. Saved across a restart.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { INITIATIVE_MS, INITIATIVE_ORDER_MS, INITIATIVE_TIE_MS } from "../initiative";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"];
const [A, B, C] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = () =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("r1"), text("r2"), text("r3"), text("r4")] }],
    boss: { monster: "dragon", maxHp: 1, questions: [text("b1")] },
  });

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage & { data: Map<string, unknown> };
}

/** The room's rng: each queued d20 face once, then 0 (the deals and shuffles). */
function dice() {
  const queue: number[] = [];
  return { queue, rng: () => (queue.length ? (queue.shift()! - 1) / 20 + 0.001 : 0) };
}

function makeRoom(storage = memoryStorage()) {
  const d = dice();
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, d.rng, { bank: bank(), epilogueDelayMs: 0 });
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  return { room, io, storage, queue: d.queue, state };
}

/** Three teams (甲 乙 丙, in that lobby order) and a host; `fields` go on HOST_START. */
function started(fields: object = { initiative: true }) {
  const g = makeRoom();
  const host = makeConn("host");
  g.room.onConnect(host);
  send(g.room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const conn = makeConn(`p${i}`);
    g.room.onConnect(conn);
    send(g.room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊", "丙隊"][i] });
    return conn;
  });
  send(g.room, host, { type: "HOST_START", aiNarration: false, ...fields });
  const roll = (i: number, face: number) => {
    g.queue.push(face);
    send(g.room, phones[i], { type: "TEAM_ROLL_INITIATIVE" });
  };
  return { ...g, host, phones, roll, turnOrder: () => (g.room as any).game.turnOrder as string[] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("擲先攻 in the room", () => {
  it("a HOST_START without `initiative` keeps the lobby order and deals at once, as before", () => {
    const g = started({});
    expect(g.state().initiative).toBeUndefined();
    expect(g.state().question).not.toBeNull();
    expect(g.turnOrder()).toEqual(IDS);
  });

  it("holds the first question while the phones roll, then plays in the order rolled, highest first", () => {
    const g = started();
    expect(g.state()).toMatchObject({ initiative: { rolls: {}, left: INITIATIVE_MS }, question: null, eventId: 0 });
    g.roll(0, 4);
    send(g.room, g.phones[0], { type: "TEAM_ROLL_INITIATIVE" }); // a second roll from the same phone is ignored
    g.roll(1, 18);
    expect(g.state().initiative.rolls).toEqual({ [A]: 4, [B]: 18 });
    expect(g.state().initiative.order).toBeUndefined();
    g.roll(2, 11);
    expect(g.state().initiative).toMatchObject({ order: [B, C, A], tieRolls: [] });
    expect(g.state().question).toBeNull();
    expect(g.turnOrder()).toEqual([B, C, A]);
    g.queue.length = 0;

    vi.advanceTimersByTime(INITIATIVE_ORDER_MS);
    expect(g.state().initiative).toBeUndefined();
    expect(g.state()).toMatchObject({ cue: "start", eventId: 1 });
    expect(g.state().question).not.toBeNull();
    expect(g.state().view.currentTurnTeamId).toBe(B);
  });

  it("rerolls a tie, and the screen holds each reroll before the order", () => {
    const g = started();
    g.roll(0, 9);
    g.roll(1, 15);
    g.queue.push(9, 3, 17); // C rolls 9, tying A: then A rolls 3, C rolls 17
    send(g.room, g.phones[2], { type: "TEAM_ROLL_INITIATIVE" });
    expect(g.state().initiative).toMatchObject({ order: [B, C, A], tieRolls: [{ from: 2, teams: [A, C], values: [3, 17] }] });
    vi.advanceTimersByTime(INITIATIVE_ORDER_MS);
    expect(g.state().question).toBeNull(); // the reroll's beat comes first
    vi.advanceTimersByTime(INITIATIVE_TIE_MS);
    expect(g.state().view.currentTurnTeamId).toBe(B);
  });

  it("rolls for every team that has not rolled once INITIATIVE_MS is up", () => {
    const g = started();
    g.roll(1, 2);
    g.queue.push(19, 12);
    vi.advanceTimersByTime(INITIATIVE_MS - 1);
    expect(g.state().initiative.order).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(g.state().initiative).toMatchObject({ rolls: { [A]: 19, [B]: 2, [C]: 12 }, order: [A, C, B] });
  });

  it("an offline team gets the whole wait: it can come back and roll, or is rolled for when time is up", () => {
    for (const comesBack of [true, false]) {
      const g = started();
      g.room.onClose(g.phones[2]); // e.g. a phone locked during the intro
      g.roll(0, 5);
      g.roll(1, 7);
      expect(g.state().initiative.order).toBeUndefined();
      if (comesBack) {
        g.room.onConnect(g.phones[2]);
        send(g.room, g.phones[2], { type: "JOIN", teamId: C, teamKey: "team-key-0123456789abcde2", teamName: "丙隊" });
        g.roll(2, 14);
      } else {
        g.queue.push(14);
        vi.advanceTimersByTime(INITIATIVE_MS);
      }
      expect(g.state().initiative).toMatchObject({ rolls: { [A]: 5, [B]: 7, [C]: 14 }, order: [C, B, A] });
    }
  });

  it("no turn action gets through while the phones roll or the order holds", () => {
    const g = started();
    const refused = () => {
      send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: "r1", text: "答案 r1" });
      expect(msgs(g.phones[0].send.mock.calls).at(-1)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    };
    refused();
    [4, 18, 11].forEach((face, i) => g.roll(i, face));
    const eventId = g.state().eventId;
    refused();
    expect(g.state().eventId).toBe(eventId);
    expect(g.turnOrder()).toEqual([B, C, A]);
  });

  it("全部代擲 rolls the rest at once; only the host may press it, and a phone cannot roll after the order is set", () => {
    const g = started();
    g.roll(0, 10);
    send(g.room, g.phones[1], { type: "HOST_ROLL_INITIATIVE" });
    expect(g.state().initiative.order).toBeUndefined();
    g.queue.push(1, 20);
    send(g.room, g.host, { type: "HOST_ROLL_INITIATIVE" });
    expect(g.state().initiative).toMatchObject({ rolls: { [A]: 10, [B]: 1, [C]: 20 }, order: [C, A, B] });
    send(g.room, g.phones[1], { type: "TEAM_ROLL_INITIATIVE" });
    expect(g.state().initiative.rolls[B]).toBe(1);
  });

  it("follows the intro: page 5 starts the rolling, not the first question", () => {
    const g = started({ initiative: true, intro: true });
    for (const page of [2, 3, 4, 5]) send(g.room, g.host, { type: "HOST_INTRO", page });
    expect(g.state()).toMatchObject({ initiative: { rolls: {} }, question: null });
    expect(g.state().intro).toBeUndefined();
  });

  it("once the order is set, 全部代擲 and a dropped phone change nothing; the first online team plays", () => {
    const g = started();
    g.roll(0, 4);
    g.roll(1, 18);
    g.roll(2, 11);
    const before = g.state().initiative;
    send(g.room, g.host, { type: "HOST_ROLL_INITIATIVE" });
    g.room.onClose(g.phones[1]);
    expect(g.state().initiative.order).toEqual(before.order);
    expect(g.state().initiative.rolls).toEqual(before.rolls);
    vi.advanceTimersByTime(INITIATIVE_ORDER_MS);
    expect(g.state().view.currentTurnTeamId).toBe(C);
  });

  it("a room that expires mid-roll or mid-hold never starts a game afterwards", async () => {
    for (const hold of [false, true]) {
      const g = started();
      if (hold) [4, 18, 11].forEach((face, i) => g.roll(i, face));
      await (g.room as any).expire();
      g.io.broadcast.mockClear();
      vi.advanceTimersByTime(INITIATIVE_MS + INITIATIVE_ORDER_MS);
      expect((g.room as any).initiative).toBeNull();
      expect(g.io.broadcast).not.toHaveBeenCalled();
    }
  });

  it("結束冒險 during the order hold: no start fires later", () => {
    const g = started();
    g.roll(0, 4);
    g.roll(1, 18);
    g.roll(2, 11);
    send(g.room, g.host, { type: "HOST_END_GAME" });
    vi.advanceTimersByTime(INITIATIVE_ORDER_MS);
    expect(g.state().phase).toBe("finished");
    expect(g.state().initiative).toBeUndefined();
    expect(g.state().cue).not.toBe("start");
  });

  it("結束冒險 during the rolling drops it: no start fires later", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_END_GAME" });
    vi.advanceTimersByTime(INITIATIVE_MS + INITIATIVE_ORDER_MS);
    expect(g.state().phase).toBe("finished");
    expect(g.state().initiative).toBeUndefined();
    expect(g.state().cue).not.toBe("start");
  });
});

describe("擲先攻 across a restart", () => {
  it("the rolled order is saved and played after a restart, which holds the order again before the first question", async () => {
    const g = started();
    g.roll(0, 6);
    g.roll(1, 16);
    g.roll(2, 12);
    const second = makeRoom(g.storage);
    expect(await second.room.restore()).toBe("restored");
    expect((second.room as any).game.turnOrder).toEqual([B, C, A]);
    expect((second.room as any).initiative).toMatchObject({ order: [B, C, A] });
    vi.advanceTimersByTime(INITIATIVE_ORDER_MS);
    expect((second.room as any).initiative).toBeNull();
    expect((second.room as any).game.turnOrder).toEqual([B, C, A]);
  });

  it("a restart mid-hold re-holds every tie's reroll too, and the start still says the order was rolled", async () => {
    const g = started();
    g.roll(0, 9);
    g.roll(1, 15);
    g.queue.push(9, 3, 17);
    send(g.room, g.phones[2], { type: "TEAM_ROLL_INITIATIVE" });
    const second = makeRoom(g.storage);
    expect(await second.room.restore()).toBe("restored");
    expect((second.room as any).initiativeOn).toBe(true);
    vi.advanceTimersByTime(INITIATIVE_ORDER_MS);
    expect((second.room as any).initiative).not.toBeNull();
    vi.advanceTimersByTime(INITIATIVE_TIE_MS);
    expect((second.room as any).initiative).toBeNull();
  });

  it("after a restart mid-roll, the first phone back does not end the wait for the teams still reconnecting", async () => {
    const g = started();
    g.roll(0, 8);
    const second = makeRoom(g.storage);
    expect(await second.room.restore()).toBe("restored");
    const back = makeConn("back");
    second.room.onConnect(back);
    send(second.room, back, { type: "JOIN", teamId: B, teamKey: "team-key-0123456789abcde1", teamName: "乙隊" });
    second.queue.push(12);
    send(second.room, back, { type: "TEAM_ROLL_INITIATIVE" });
    expect((second.room as any).initiative).toEqual({ rolls: { [A]: 8, [B]: 12 } });
  });

  it("after a restart mid-roll, the order is set as soon as every team is back and has rolled", async () => {
    const g = started();
    g.roll(0, 8);
    const second = makeRoom(g.storage);
    expect(await second.room.restore()).toBe("restored");
    [[B, 1, 12], [C, 2, 3]].forEach(([id, i, face]) => {
      const back = makeConn(`back${i}`);
      second.room.onConnect(back);
      send(second.room, back, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊", "丙隊"][i as number] });
      second.queue.push(face as number);
      send(second.room, back, { type: "TEAM_ROLL_INITIATIVE" });
    });
    expect((second.room as any).initiative).toMatchObject({ rolls: { [A]: 8, [B]: 12, [C]: 3 }, order: [B, A, C] });
  });

  it("drops a saved 擲先攻 when the save has no game in play", async () => {
    const g = started();
    g.roll(0, 8);
    const snap = [...g.storage.data.entries()].find(([, v]) => (v as any)?.initiative)!;
    g.storage.data.set(snap[0], { ...(snap[1] as any), game: null });
    const second = makeRoom(g.storage);
    await second.room.restore();
    expect((second.room as any).initiative).toBeNull();
    vi.advanceTimersByTime(INITIATIVE_MS + INITIATIVE_ORDER_MS); // no timer reads the missing game
  });

  it("rolls made before a restart are kept, and the wait starts again", async () => {
    const g = started();
    g.roll(0, 8);
    const second = makeRoom(g.storage);
    expect(await second.room.restore()).toBe("restored");
    expect((second.room as any).initiative).toEqual({ rolls: { [A]: 8 } });
    second.queue.push(3, 13);
    vi.advanceTimersByTime(INITIATIVE_MS);
    expect((second.room as any).initiative).toMatchObject({ rolls: { [A]: 8, [B]: 3, [C]: 13 }, order: [C, A, B] });
  });

  it("a restart mid-intro still rolls 擲先攻 after the last page", async () => {
    const g = started({ initiative: true, intro: true });
    const second = makeRoom(g.storage);
    expect(await second.room.restore()).toBe("restored");
    const host = makeConn("host2");
    second.room.onConnect(host);
    send(second.room, host, { type: "HOST_CLAIM", token: TOKEN });
    for (const page of [2, 3, 4, 5]) send(second.room, host, { type: "HOST_INTRO", page });
    expect((second.room as any).initiative).toEqual({ rolls: {} });
  });
});
