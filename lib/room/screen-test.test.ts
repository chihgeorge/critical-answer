// HOST_SCREEN_TEST (docs/designs/screen-media-test.md): the keyed big screen test-loads every clip in the room's bank.
import { describe, it, expect, vi } from "vitest";
import { sendSettled } from "./test-send";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import type { Bank } from "../question-bank";
import { parseClientMessage } from "../protocol";

const TOKEN = "host-token-0123456789abcdef";
const TEAM = "00000000-0000-0000-0000-000000000001";
const VIDEO = "dQw4w9WgXcQ";
const bank: Bank = {
  pools: {
    1: [
      { kind: "text", id: "q1", content: { kind: "youtube", value: VIDEO }, prompt: "猜歌名", answer: "秘密答案" },
      { kind: "text", id: "q2", content: { kind: "youtube", value: VIDEO }, prompt: "再猜一次", answer: "秘密答案二" },
    ],
    2: [],
    3: [],
    4: [],
    5: [],
  },
  rooms: [{ monster: "slime-soft", difficulty: 1, reward: 10 }],
  boss: { monster: "dragon", hitReward: 10, phases: [{ name: "", rule: "", maxHp: 10, questions: [{ kind: "text", id: "b1", content: { kind: "text", value: "魔王？" }, answer: "魔王答案" }] }] },
};

const conn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const sent = (c: { send: ReturnType<typeof vi.fn> }) => c.send.mock.calls.map(([m]) => JSON.parse(m as string));
const of = (c: { send: ReturnType<typeof vi.fn> }, type: string) => sent(c).filter((m) => m.type === type);

function setup() {
  const io = { broadcast: vi.fn(), env: {} } as unknown as RoomIO;
  const room = new DungeonRoom(io, () => 0);
  (room as unknown as { bank: Bank }).bank = bank;
  const send = (c: Conn, msg: object) => sendSettled(room, c, msg);
  const host = conn("host");
  room.onConnect(host);
  send(host, { type: "HOST_CLAIM", token: TOKEN });
  const key = of(host, "HOST_OK")[0].screenKey as string;
  const screen = conn("screen");
  room.onConnect(screen);
  send(screen, { type: "SCREEN_HELLO", key });
  return { room, host, screen, send, key };
}

it("parses HOST_SCREEN_TEST and SCREEN_TEST_RESULT, refusing an unknown error", () => {
  expect(parseClientMessage({ type: "HOST_SCREEN_TEST" })).toEqual({ type: "HOST_SCREEN_TEST" });
  expect(parseClientMessage({ type: "SCREEN_TEST_RESULT", runId: 3, index: 0, error: null })).toEqual({ type: "SCREEN_TEST_RESULT", runId: 3, index: 0, error: null });
  expect(parseClientMessage({ type: "SCREEN_TEST_RESULT", runId: 3, index: 1, error: "blocked" })).toMatchObject({ error: "blocked" });
  expect(parseClientMessage({ type: "SCREEN_TEST_RESULT", runId: 3, index: 1, error: "nope" })).toBeNull();
  expect(parseClientMessage({ type: "SCREEN_TEST_RESULT", runId: -1, index: 1, error: null })).toBeNull();
});

describe("HOST_SCREEN_TEST", () => {
  it("sends the deduplicated clips to the keyed screen only, then each result's rows to the host, with no answer or id", () => {
    const { host, screen, send } = setup();
    const viewer = conn("viewer");
    send(viewer, { type: "SCREEN_HELLO" }); // no key
    send(host, { type: "HOST_SCREEN_TEST" });
    const [test] = of(screen, "SCREEN_TEST");
    expect(test.items).toEqual([{ kind: "youtube", videoId: VIDEO }]);
    expect(JSON.stringify(test)).not.toContain("秘密答案");
    expect(of(viewer, "SCREEN_TEST")).toHaveLength(0);
    expect(of(host, "HOST_SCREEN_TEST").at(-1)).toEqual({ type: "HOST_SCREEN_TEST", done: 0, total: 1, rows: [] });

    send(screen, { type: "SCREEN_TEST_RESULT", runId: test.runId, index: 0, error: "blocked" });
    const last = of(host, "HOST_SCREEN_TEST").at(-1);
    expect(last).toMatchObject({ done: 1, total: 1 });
    expect(last.rows).toEqual([
      expect.objectContaining({ level: "red", questionId: "q1", where: "難度 1", label: "猜歌名" }),
      expect.objectContaining({ level: "red", questionId: "q2", label: "再猜一次" }),
    ]);
    expect(JSON.stringify(last)).not.toContain(VIDEO);
    expect(JSON.stringify(last)).not.toContain("秘密答案");
  });

  it("refuses a player, a room with no keyed screen, and a started game", () => {
    const io = { broadcast: vi.fn(), env: {} } as unknown as RoomIO;
    const room = new DungeonRoom(io, () => 0);
    const send = (c: Conn, msg: object) => room.onMessage(JSON.stringify(msg), c);
    const host = conn("host");
    send(host, { type: "HOST_CLAIM", token: TOKEN });
    const phone = conn("phone");
    send(phone, { type: "HOST_SCREEN_TEST" });
    expect(of(phone, "ERROR").at(-1)).toMatchObject({ error: "not_host" });
    send(host, { type: "HOST_SCREEN_TEST" });
    expect(of(host, "ERROR").at(-1)).toMatchObject({ detail: "no_screen" });
    send(phone, { type: "JOIN", teamId: TEAM, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    send(host, { type: "HOST_START" });
    send(host, { type: "HOST_SCREEN_TEST" });
    expect(of(host, "ERROR").at(-1)).toMatchObject({ error: "game_already_started" });
  });

  it("drops results from another socket, an old run, an index out of range, and a repeat", () => {
    const { host, screen, send, key } = setup();
    const other = conn("other");
    send(other, { type: "SCREEN_HELLO", key });
    send(host, { type: "HOST_SCREEN_TEST" });
    const first = of(screen, "SCREEN_TEST")[0].runId as number;
    expect(of(other, "SCREEN_TEST")).toHaveLength(0); // the oldest keyed screen runs it
    send(host, { type: "HOST_SCREEN_TEST" }); // starts over
    const runId = of(screen, "SCREEN_TEST")[1].runId as number;
    expect(runId).toBeGreaterThan(first);
    const before = of(host, "HOST_SCREEN_TEST").length;
    send(other, { type: "SCREEN_TEST_RESULT", runId, index: 0, error: "gone" });
    send(screen, { type: "SCREEN_TEST_RESULT", runId: first, index: 0, error: "gone" });
    send(screen, { type: "SCREEN_TEST_RESULT", runId, index: 5, error: "gone" });
    expect(of(host, "HOST_SCREEN_TEST")).toHaveLength(before);
    send(screen, { type: "SCREEN_TEST_RESULT", runId, index: 0, error: null });
    send(screen, { type: "SCREEN_TEST_RESULT", runId, index: 0, error: "gone" });
    expect(of(host, "HOST_SCREEN_TEST")).toHaveLength(before + 1);
    expect(of(host, "HOST_SCREEN_TEST").at(-1)).toEqual({ type: "HOST_SCREEN_TEST", done: 1, total: 1, rows: [] });
  });

  it("a finished run does not read as stopped when the screen leaves; another bank picked drops the run", () => {
    const { room, host, screen, send } = setup();
    send(host, { type: "HOST_SCREEN_TEST" });
    let runId = of(screen, "SCREEN_TEST")[0].runId;
    send(screen, { type: "SCREEN_TEST_RESULT", runId, index: 0, error: null });
    const n = of(host, "HOST_SCREEN_TEST").length;
    room.onClose(screen);
    expect(of(host, "HOST_SCREEN_TEST")).toHaveLength(n);

    const { room: room2, host: host2, screen: screen2, send: send2 } = setup();
    send2(host2, { type: "HOST_SCREEN_TEST" });
    runId = of(screen2, "SCREEN_TEST")[0].runId;
    (room2 as unknown as { bankChoice: { id: string; name: string } }).bankChoice = { id: "other", name: "別的題庫" };
    const m = of(host2, "HOST_SCREEN_TEST").length;
    send2(screen2, { type: "SCREEN_TEST_RESULT", runId, index: 0, error: "blocked" });
    expect(of(host2, "HOST_SCREEN_TEST")).toHaveLength(m); // the old bank's rows never come back
  });

  it("resends the progress to a host that reconnects mid-test", () => {
    const { room, host, send } = setup();
    send(host, { type: "HOST_SCREEN_TEST" });
    const again = conn("host");
    room.onConnect(again);
    send(again, { type: "HOST_CLAIM", token: TOKEN });
    expect(of(again, "HOST_SCREEN_TEST").at(-1)).toMatchObject({ done: 0, total: 1 });
  });

  it("tells the host when the testing screen closes or reconnects before it finishes", () => {
    const { room, host, screen, send, key } = setup();
    send(host, { type: "HOST_SCREEN_TEST" });
    room.onClose(screen);
    expect(of(host, "HOST_SCREEN_TEST").at(-1)).toMatchObject({ done: 0, total: 1, stopped: true });

    const tv = conn("tv");
    room.onConnect(tv);
    send(tv, { type: "SCREEN_HELLO", key });
    send(host, { type: "HOST_SCREEN_TEST" });
    const runId = of(tv, "SCREEN_TEST")[0].runId;
    const again = conn("tv"); // same id, a fresh page
    room.onConnect(again);
    expect(of(host, "HOST_SCREEN_TEST").at(-1)).toMatchObject({ stopped: true });
    send(again, { type: "SCREEN_HELLO", key });
    const count = of(host, "HOST_SCREEN_TEST").length;
    send(again, { type: "SCREEN_TEST_RESULT", runId, index: 0, error: null });
    expect(of(host, "HOST_SCREEN_TEST")).toHaveLength(count);
  });
});
