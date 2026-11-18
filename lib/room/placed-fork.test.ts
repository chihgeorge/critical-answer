// 題庫指定叉路 (#286): a bank places a fork on a room, unlabelled or with two labelled doors (monster, mystery, hard,
// category). The bank's check, the room's fork rule, what each door deals, the timeout, and what STATE shows.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DungeonRoom, FORK_BEAT_MS } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { parseBank, poolCategories, roomForkProblem, roomTemplates } from "../question-bank";
import { bankProblems } from "../bank-editor-problems";
import { FORK_MS, type ForkDoorSpec } from "../game-state";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TOKEN = "host-token-0123456789abcdef";
const KEY = "team-key-0123456789abcdef";
const video = (id: string, category?: string) => ({ kind: "text" as const, id, content: { kind: "youtube" as const, value: "dQw4w9WgXcQ" }, prompt: "這首歌是？", answer: `答案 ${id}`, ...(category ? { category } : {}) });
const rawBank = (fork?: unknown, extra: object = {}, forkRooms = [1]) => ({
  pools: {
    "1": [0, 1, 2, 3, 4, 5, 6, 7].map((i) => video(`a${i}`, i % 2 ? "動漫" : "電影")),
    "2": [0, 1, 2, 3].map((i) => video(`h${i}`)),
  },
  rooms: [0, 1, 2, 3, 4].map((r) => ({ monster: "slime-soft", difficulty: 1, reward: 10, ...(forkRooms.includes(r) && fork ? { fork } : {}) })),
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [video("boss-a")] },
  ...extra,
});
const DOORS: ForkDoorSpec[] = [{ kind: "hard" }, { kind: "category", category: "動漫" }];

type Spy = ReturnType<typeof vi.fn>;
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn;
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const state = (room: DungeonRoom) =>
  (room.room.broadcast as Spy).mock.calls
    .map((c) => JSON.parse(c[0]))
    .filter((m) => m.type === "STATE")
    .at(-1);

function setup(fork: unknown, teams = 1, forkRooms = [1]) {
  const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []) } as unknown as RoomIO;
  // e2eEventTeam forces the random roll on every eligible answer: a bank with a placed fork must ignore it.
  const room = new DungeonRoom(io, () => 0, { bank: parseBank(rawBank(fork, {}, forkRooms)), e2eEventTeam: "EventTeam", epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = [T1, T2].slice(0, teams).map((id, i) => {
    const phone = makeConn(`p${i}`);
    room.onConnect(phone);
    send(room, phone, { type: "JOIN", teamId: id, teamKey: KEY, teamName: i === 0 ? "EventTeam" : "Plain" });
    return phone;
  });
  send(room, host, { type: "HOST_START" });
  return { room, host, phones };
}
type S = ReturnType<typeof setup>;

function answerRight(s: S, i: number) {
  const t = s.room.game!.teams[i];
  send(s.room, s.host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(s.room).eventId });
  const eventId = state(s.room).eventId;
  send(s.room, s.host, { type: "HOST_SERVE", eventId });
  (s.room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(s.room, s.host, { type: "HOST_NEXT", eventId });
}
const pick = (s: S, side: "left" | "right") => send(s.room, s.phones[0], { type: "TEAM_CHOOSE_FORK", side, eventId: state(s.room).eventId });

afterEach(() => {
  vi.useRealTimers();
});

describe("題庫指定叉路: the bank (#286)", () => {
  // Value: protects=old banks stay valid and a bad fork is refused with a fix; fails_when=parseBank or the editor's
  // check lets a fork through that the room cannot play; no_claim=the wording of each message.
  it("old banks need no fork; a valid fork is kept and copied to the room templates", () => {
    expect(roomTemplates(parseBank(rawBank())).some((r) => r.fork)).toBe(false);
    expect(parseBank(rawBank({})).rooms[1].fork).toEqual({});
    const b = parseBank(rawBank({ doors: DOORS }));
    expect(b.rooms[1].fork).toEqual({ doors: DOORS });
    expect(roomTemplates(b)[1].fork).toEqual({ doors: DOORS });
  });

  it("refuses a fork the room cannot play, and the editor flags the same before a save", () => {
    const bad: [unknown, RegExp][] = [
      [{ doors: [{ kind: "monster" }] }, /兩扇門/],
      [{ doors: [{ kind: "boss" }, { kind: "monster" }] }, /只能是/],
      [{ doors: [{ kind: "category", category: "體育" }, { kind: "monster" }] }, /找不到/],
      [{ doors: [{ kind: "category" }, { kind: "monster" }] }, /要寫類別/],
      [{ doors: [{ kind: "monster", category: "動漫" }, { kind: "mystery" }] }, /只有類別門/],
      [{ doors: [{ kind: "mystery" }, { kind: "mystery" }] }, /一樣/],
      ["yes", /格式不對/],
    ];
    for (const [fork, msg] of bad) {
      expect(() => parseBank(rawBank(fork))).toThrow(msg);
      const editor = { ...parseBank(rawBank()) };
      editor.rooms = editor.rooms.map((r, i) => (i === 1 ? { ...r, fork: fork as never } : r));
      expect(bankProblems(editor).find((p) => p.tab === "rooms")?.message).toMatch(msg);
    }
    // First and last room, hard in a difficulty-5 room, and hard over an empty harder pool.
    const { pools } = parseBank(rawBank());
    expect(roomForkProblem({}, 0, 4, 1, pools)).toMatch(/第一間和最後一間/);
    expect(roomForkProblem({}, 4, 5, 1, pools)).toMatch(/第一間和最後一間/);
    expect(roomForkProblem({ doors: [{ kind: "hard" }, { kind: "monster" }] }, 1, 4, 5, pools)).toMatch(/難度 5/);
    expect(roomForkProblem({ doors: [{ kind: "hard" }, { kind: "monster" }] }, 1, 4, 2, pools)).toMatch(/難度 3 題庫沒有題目/);
    expect(roomForkProblem({ doors: [{ kind: "hard" }, { kind: "monster" }] }, 1, 4, 1, pools)).toBeNull();
    expect([...poolCategories(pools[1])].sort()).toEqual(["動漫", "電影"]);
  });
});

describe("題庫指定叉路: the room (#286)", () => {
  // Value: protects=the bank's layout is the plan: forks where it places them, none elsewhere; fails_when=a placed fork
  // is skipped or a random one appears; no_claim=which event a ❓ door draws.
  it("a placed fork always comes on its room, and a bank with one draws no random fork elsewhere", async () => {
    vi.useFakeTimers();
    const s = setup({});
    answerRight(s, 0);
    expect(s.room.game!.teams[0].fork?.phase).toBe("choosing");
    // Unlabelled: no doors in STATE.
    expect(state(s.room).forkDoors).toBeUndefined();
    // ❓ (the right side: the room drew ⚔️ left) walks the team into room 2 by the event, not an answer.
    pick(s, "right");
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    const eventId = state(s.room).eventId;
    send(s.room, s.host, { type: "HOST_NEXT", eventId });
    expect(s.room.game!.teams[0].roomIndex).toBe(2);
    // Into room 3, which has no fork: e2eEventTeam would roll one in a bank without placed forks.
    const t = s.room.game!.teams[0];
    send(s.room, s.host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(s.room).eventId });
    expect(s.room.game!.teams[0].roomIndex).toBe(3);
    expect(s.room.game!.teams[0].fork).toBeUndefined();
  });

  // Value: protects=labelled doors show their destination and deal what they say; fails_when=STATE hides the doors,
  // hard keeps the room's pool, or category deals another category; no_claim=which question of the category.
  it("labelled doors: STATE shows them; the category door deals that category, the hard door the next pool", async () => {
    vi.useFakeTimers();
    const s = setup({ doors: DOORS });
    answerRight(s, 0);
    expect(s.room.game!.teams[0].fork).toMatchObject({ phase: "choosing", monsterSide: "left" });
    expect(state(s.room).forkDoors).toEqual(DOORS);
    pick(s, "right");
    const team = s.room.game!.teams[0];
    expect(team.forks?.at(-1)).toEqual({ side: "right", door: "category", category: "動漫" });
    expect(Number(team.currentQuestionId.slice(1)) % 2).toBe(1);
    expect(state(s.room).forkBeat).toMatchObject({ door: "category", category: "動漫" });
    // The beat still shows the doors; once it is over, they are gone.
    expect(state(s.room).forkDoors).toEqual(DOORS);
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    expect(state(s.room).forkDoors).toBeUndefined();

    const h = setup({ doors: DOORS });
    answerRight(h, 0);
    pick(h, "left");
    expect(h.room.game!.teams[0].currentQuestionId).toMatch(/^h/);
    expect(h.room.game!.teams[0].currentDifficulty).toBe(2);
    // The door's line names it, never ⚔️.
    expect((h.room as unknown as { forkBeat: { line?: { text: string } } }).forkBeat.line?.text).toMatch(/💀 難題/);
    expect((h.room as unknown as { forkBeat: { line?: { text: string } } }).forkBeat.line?.text).not.toMatch(/⚔️/);
    // A correct answer to the hard question earns difficulty 2's progress.
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    const before = h.room.game!.teams[0].score;
    const t = h.room.game!.teams[0];
    send(h.room, h.host, { type: "HOST_JUDGE", teamId: t.id, questionId: t.currentQuestionId, correct: true, eventId: state(h.room).eventId });
    expect(h.room.game!.teams[0].score - before).toBe(2);
  });

  it("placed forks on neighbouring rooms both come, even after the ⚔️ door", async () => {
    vi.useFakeTimers();
    const s = setup({}, 1, [1, 2]);
    answerRight(s, 0);
    pick(s, "left");
    expect(s.room.game!.teams[0].fork).toEqual({ phase: "monster" });
    await vi.advanceTimersByTimeAsync(FORK_BEAT_MS);
    answerRight(s, 0);
    expect(s.room.game!.teams[0].roomIndex).toBe(2);
    expect(s.room.game!.teams[0].fork?.phase).toBe("choosing");
  });

  it("the clock runs out on labelled doors: the left door opens", async () => {
    vi.useFakeTimers();
    const s = setup({ doors: [{ kind: "category", category: "電影" }, { kind: "mystery" }] });
    answerRight(s, 0);
    await vi.advanceTimersByTimeAsync(FORK_MS);
    expect(s.room.game!.teams[0].forks?.at(-1)).toEqual({ side: "left", door: "category", category: "電影", timeout: true });
    expect(Number(s.room.game!.teams[0].currentQuestionId.slice(1)) % 2).toBe(0);
  });

  it("a category door with no question left to deal keeps the team's question", () => {
    const s = setup({ doors: [{ kind: "category", category: "動漫" }, { kind: "mystery" }] });
    answerRight(s, 0);
    const g = s.room.game!;
    // Every 動漫 question is revealed already.
    (s.room as unknown as { game: typeof g }).game = { ...g, revealedQuestionIds: [...g.revealedQuestionIds, "a1", "a3", "a5", "a7"] };
    const before = s.room.game!.teams[0].currentQuestionId;
    pick(s, "left");
    expect(s.room.game!.teams[0].currentQuestionId).toBe(before);
    expect(s.room.game!.teams[0].fork).toEqual({ phase: "monster" });
  });
});
