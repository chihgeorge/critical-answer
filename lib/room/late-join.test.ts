// 中途加入 in the room (docs/designs/late-join.md): a team that JOINs after the start waits for the host's 收這隊 / 不收.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { MAX_TEAMS } from "../protocol";
import { parseSnapshot, SNAPSHOT_KEY } from "./snapshot";

const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const TOKEN = "host-token-0123456789abcdef";
const KEY = "team-key-0123456789abcdef";

const text = (qid: string) => ({ kind: "text" as const, id: qid, content: { kind: "text" as const, value: `題目 ${qid}` }, answer: `答案 ${qid}` });
const bank = parseBank({
  rooms: [0, 1, 2, 3].map((r) => ({ monster: "slime-soft", baseDifficulty: 1, reward: 10 * (r + 1), questions: [0, 1, 2, 3, 4, 5].map((i) => text(`r${r}-${i}`)) })),
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [text("boss-a"), text("boss-b")] },
});

type Spy = ReturnType<typeof vi.fn>;
const makeConn = (cid: string) => ({ id: cid, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: Spy };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const state = (room: DungeonRoom) => (room.room.broadcast as Spy).mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === "STATE" || m.type === "LOBBY").at(-1);
const last = (conn: Conn) => JSON.parse((conn.send as unknown as Spy).mock.calls.at(-1)![0]);

function memoryStorage(): RoomStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => data.get(k), put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), delete: async (k: string) => data.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} } as never;
}
const makeRoom = (storage?: RoomStorage) =>
  new DungeonRoom({ id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []), ...(storage ? { storage } : {}) } as unknown as RoomIO, () => 0, { bank, epilogueDelayMs: 0 });

/** A phone JOINs as team `n`. */
function join(room: DungeonRoom, n: number, extra: object = {}) {
  const conn = makeConn(`p${n}`);
  room.onConnect(conn);
  send(room, conn, { type: "JOIN", teamId: id(n), teamKey: KEY + n, teamName: `隊伍${n}`, ...extra });
  return conn;
}

/** A game of teams 1 and 2, started; `start` adds to HOST_START. */
function setup(o: { storage?: RoomStorage; start?: object } = {}) {
  const room = makeRoom(o.storage);
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = [join(room, 1), join(room, 2)];
  send(room, host, { type: "HOST_START", aiNarration: false, ...o.start });
  return { room, host, phones };
}
const admit = (room: DungeonRoom, host: Conn, n: number, yes = true) => send(room, host, { type: "HOST_LATE_TEAM", teamId: id(n), admit: yes });

afterEach(() => vi.useRealTimers());

describe("late join", () => {
  it("a JOIN after the start waits: named in STATE.late, not in the game, and may pick a class", () => {
    const { room } = setup();
    const late = join(room, 3);
    expect(state(room).late).toEqual({ teams: [{ id: id(3), name: "隊伍3" }] });
    expect(state(room).view.teams.map((t: { id: string }) => t.id)).toEqual([id(1), id(2)]);
    send(room, late, { type: "TEAM_PICK_CLASS", classId: "mage" });
    expect(state(room).late.teams[0].classId).toBe("mage");
    // A playing team's class stays fixed.
    const playing = makeConn("p1b");
    send(room, playing, { type: "JOIN", teamId: id(1), teamKey: KEY + 1, teamName: "x" });
    send(room, playing, { type: "TEAM_PICK_CLASS", classId: "mage" });
    expect(last(playing)).toMatchObject({ error: "game_already_started" });
  });

  it("the usual JOIN checks still apply after the start: password, name, and the 8-team limit counting waiting teams", () => {
    const { room, host } = setup();
    send(room, host, { type: "HOST_SET_PASSWORD", password: "1234" });
    expect(last(join(room, 3, { password: "0000" }))).toMatchObject({ error: "bad_password" });
    send(room, host, { type: "HOST_SET_PASSWORD", password: "" });
    expect(last(join(room, 3, { teamName: "隊伍1" }))).toMatchObject({ error: "invalid_name", detail: "duplicate_name" });
    for (let n = 3; n <= MAX_TEAMS; n++) join(room, n);
    expect(state(room).late.teams).toHaveLength(MAX_TEAMS - 2);
    expect(last(join(room, 9))).toMatchObject({ error: "invalid_action", detail: "room_full" });
    // A waiting team's name is taken too.
    admit(room, host, 8, false);
    expect(last(join(room, 9, { teamName: "隊伍7" }))).toMatchObject({ error: "invalid_name", detail: "duplicate_name" });
  });

  it("收這隊: room 1, last in turn, level with the last-place team, with the class it picked", () => {
    const { room, host } = setup();
    const g = room.game!;
    room.game = { ...g, teams: g.teams.map((t, i) => ({ ...t, score: [5, 3][i], reward: [30, 10][i], roomIndex: 2 })) };
    const late = join(room, 3);
    send(room, late, { type: "TEAM_PICK_CLASS", classId: "warrior" });
    admit(room, host, 3);
    const s = state(room);
    expect(s.late).toBeUndefined();
    const team = s.view.teams.at(-1);
    expect(team).toMatchObject({ id: id(3), name: "隊伍3", score: 3, reward: 10, roomIndex: 0, inBossPhase: false, online: true, classId: "warrior" });
    expect(room.game!.turnOrder).toEqual([id(1), id(2), id(3)]);
    // Its own question, from the shared deck.
    expect(new Set(room.game!.teams.map((t) => t.currentQuestionId)).size).toBe(3);
    expect(s.view.currentTurnTeamId).toBe(id(1));
    // The turn reaches it after the teams before it, and its class pick is closed now.
    for (const n of [1, 2]) send(room, host, { type: "HOST_JUDGE", teamId: id(n), questionId: room.game!.teams[n - 1].currentQuestionId, correct: false, fleeChoice: "retry" });
    expect(state(room).view.currentTurnTeamId).toBe(id(3));
    send(room, late, { type: "TEAM_PICK_CLASS", classId: "mage" });
    expect(last(late)).toMatchObject({ error: "game_already_started" });
    // Only the host lets a team in.
    const other = join(room, 4);
    admit(room, other, 4);
    expect(last(other)).toMatchObject({ error: "not_host" });
    // 回到大廳 keeps the admitted team; the one still waiting goes to the lobby too.
    send(room, host, { type: "HOST_END_GAME" });
    send(room, host, { type: "HOST_BACK_TO_LOBBY" });
    expect(state(room)).toMatchObject({ type: "LOBBY", teams: [{ id: id(1) }, { id: id(2) }, { id: id(3), classId: "warrior" }, { id: id(4) }] });
  });

  it("a team let in with no phone connected starts offline, so its turn is skipped", () => {
    const { room, host } = setup();
    room.onClose(join(room, 3));
    admit(room, host, 3);
    expect(room.game!.teams.at(-1)).toMatchObject({ id: id(3), online: false });
  });

  it("不收: its phones are told, an automatic reconnect stays out, and a fresh JOIN waits again", () => {
    const { room, host } = setup();
    const late = join(room, 3);
    admit(room, host, 3, false);
    expect(last(late)).toMatchObject({ type: "ERROR", error: "team_removed", detail: "not_admitted" });
    expect(state(room).late).toBeUndefined();
    expect(last(join(room, 3, { resume: true }))).toMatchObject({ error: "team_removed" });
    join(room, 3);
    expect(state(room).late.teams).toHaveLength(1);
    // A press for a team that no longer waits (a double press) is dropped.
    const before = (host.send as Spy).mock.calls.length;
    admit(room, host, 5);
    expect((host.send as Spy).mock.calls.length).toBe(before);
  });

  it("a waiting team is not playing: it cannot react, roll 擲先攻 or answer", () => {
    const { room } = setup({ start: { initiative: true } });
    const late = join(room, 3);
    send(room, late, { type: "TEAM_ROLL_INITIATIVE" });
    expect(last(late)).toMatchObject({ error: "unknown_team" });
    expect((room as unknown as { initiative: { rolls: object } }).initiative.rolls).toEqual({});
    const s = setup();
    const waiting = join(s.room, 3);
    send(s.room, waiting, { type: "TEAM_REACT", reaction: "clap" });
    expect((s.room.room.broadcast as Spy).mock.calls.some((c) => JSON.parse(c[0]).type === "REACTION")).toBe(false);
  });

  it("no team is let in during 擲先攻, while a door opens, or after the game ended", () => {
    const rolling = setup({ start: { initiative: true } });
    join(rolling.room, 3);
    admit(rolling.room, rolling.host, 3);
    expect(last(rolling.host)).toMatchObject({ detail: "late_closed" });
    const { room, host } = setup();
    join(room, 3);
    // A door opening (applyForkChoice): STATE shows the game from before, so the team would vanish for the beat.
    const r = room as unknown as { forkBeat: object | null };
    r.forkBeat = { teamId: id(1), side: "left", door: "monster", before: room.game };
    admit(room, host, 3);
    expect(last(host)).toMatchObject({ detail: "late_closed" });
    r.forkBeat = null;
    send(room, host, { type: "HOST_END_GAME" });
    admit(room, host, 3);
    expect(last(host)).toMatchObject({ detail: "late_closed" });
    expect(room.game!.teams).toHaveLength(2);
    expect(state(room).late.teams).toHaveLength(1);
  });

  it("收這隊 closes an open 改判答對: the undo would judge from a game without the team", () => {
    const { room, host } = setup();
    join(room, 3);
    const q = room.game!.teams[0].currentQuestionId;
    send(room, host, { type: "HOST_JUDGE", teamId: id(1), questionId: q, correct: false, fleeChoice: "retry" });
    expect(state(room).undoWrong).toBeDefined();
    admit(room, host, 3);
    expect(state(room).undoWrong).toBeUndefined();
    send(room, host, { type: "HOST_UNDO_WRONG", teamId: id(1), questionId: q, eventId: state(room).eventId });
    expect(last(host)).toMatchObject({ detail: "no_undo" });
    expect(room.game!.teams).toHaveLength(3);
  });

  it("a late team's boss entry is never earned, so its few turns win no ⚡ 閃電突擊", () => {
    const { room, host } = setup();
    const g = room.game!;
    room.game = { ...g, config: { bossThreshold: 3 }, teams: g.teams.map((t) => ({ ...t, score: 2 })) };
    join(room, 3);
    admit(room, host, 3);
    for (const n of [1, 2]) send(room, host, { type: "HOST_JUDGE", teamId: id(n), questionId: room.game!.teams[n - 1].currentQuestionId, correct: false, fleeChoice: "retry" });
    send(room, host, { type: "HOST_JUDGE", teamId: id(3), questionId: room.game!.teams[2].currentQuestionId, correct: true });
    expect(room.game!.teams[2]).toMatchObject({ inBoss: true, late: true });
    expect(room.game!.teams[2].bossAt?.earned).toBeUndefined();
  });

  it("a room reset forgets the waiting teams and their keys", () => {
    const { room } = setup();
    join(room, 3);
    (room as unknown as { reset(): void }).reset();
    const r = room as unknown as { lateTeams: unknown[]; teamKeys: Map<string, string> };
    expect(r.lateTeams).toEqual([]);
    expect(r.teamKeys.size).toBe(0);
  });

  it("once a team is in the boss room nobody is let in: waiting teams are told to wait for the next game", () => {
    const { room, host } = setup();
    join(room, 3);
    send(room, host, { type: "HOST_SEND_TO_BOSS", teamId: id(1) });
    expect(state(room).late).toMatchObject({ closed: true });
    admit(room, host, 3);
    expect(last(host)).toMatchObject({ error: "invalid_action", detail: "late_closed" });
    expect(room.game!.teams).toHaveLength(2);
    // A team that joins now waits the same way, and both play the next game.
    join(room, 4);
    expect(state(room).late).toMatchObject({ closed: true, teams: [{ id: id(3) }, { id: id(4) }] });
    send(room, host, { type: "HOST_END_GAME" });
    expect(state(room).late).toMatchObject({ closed: true });
    send(room, host, { type: "HOST_BACK_TO_LOBBY" });
    expect(state(room).teams.map((t: { id: string }) => t.id)).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it("no team is let in while the intro is on: it would roll 擲先攻 with everyone", () => {
    const { room, host } = setup({ start: { intro: true } });
    join(room, 3);
    expect(state(room).late.closed).toBeUndefined();
    admit(room, host, 3);
    expect(last(host)).toMatchObject({ error: "invalid_action", detail: "late_closed" });
    expect(state(room).late.teams).toHaveLength(1);
  });

  it("a waiting phone that drops and comes back still waits; a wrong key is refused", () => {
    const { room } = setup();
    room.onClose(join(room, 3));
    join(room, 3, { resume: true });
    expect(state(room).late.teams).toHaveLength(1);
    const thief = makeConn("thief");
    send(room, thief, { type: "JOIN", teamId: id(3), teamKey: "wrong-key-0123456789abcdef", teamName: "x" });
    expect(last(thief)).toMatchObject({ error: "bad_token" });
  });

  it("a waiting phone may take a playing team over with the host's code: its own team stops waiting", () => {
    const { room, host, phones } = setup();
    const late = join(room, 3);
    room.onClose(phones[0]);
    send(room, host, { type: "HOST_HANDOFF", teamId: id(1) });
    const { code } = last(host);
    send(room, late, { type: "TEAM_CLAIM", code });
    expect(last(late)).toMatchObject({ type: "TEAM_CLAIMED", teamId: id(1) });
    // The host's row goes at once, even if the phone's JOIN never comes.
    expect(state(room).late).toBeUndefined();
    send(room, late, { type: "JOIN", teamId: id(1), teamKey: last(late).teamKey, teamName: "x" });
    expect(state(room).late).toBeUndefined();
    expect(room.game!.teams[0].online).toBe(true);
  });

  it("a restart keeps the waiting teams: the phone rejoins with its key and the host can still let it in", async () => {
    const storage = memoryStorage();
    const { room } = setup({ storage });
    join(room, 3);
    expect(parseSnapshot(storage.data.get(SNAPSHOT_KEY))?.lateTeams).toEqual([{ id: id(3), name: "隊伍3" }]);
    const again = makeRoom(storage);
    expect(await again.restore()).toBe("restored");
    const host = makeConn("host2");
    again.onConnect(host);
    send(again, host, { type: "HOST_CLAIM", token: TOKEN });
    join(again, 3, { resume: true });
    expect(state(again).late.teams).toEqual([{ id: id(3), name: "隊伍3" }]);
    admit(again, host, 3);
    expect(again.game!.teams.at(-1)).toMatchObject({ id: id(3), online: true });
  });

  it("a damaged waiting list only loses the waiting teams: their keys go too, so the phone's JOIN waits afresh", async () => {
    const storage = memoryStorage();
    const { room } = setup({ storage });
    join(room, 3);
    const damaged = { ...(storage.data.get(SNAPSHOT_KEY) as object), lateTeams: [{ id: 1 }] };
    expect(parseSnapshot(damaged)?.lateTeams).toBeUndefined();
    storage.data.set(SNAPSHOT_KEY, damaged);
    const again = makeRoom(storage);
    expect(await again.restore()).toBe("restored");
    expect(again.game!.teams).toHaveLength(2);
    join(again, 3, { resume: true });
    expect(state(again).late.teams).toEqual([{ id: id(3), name: "隊伍3" }]);
    // The playing teams' keys are kept.
    const back = makeConn("back");
    send(again, back, { type: "JOIN", teamId: id(1), teamKey: KEY + 1, teamName: "x" });
    expect(again.game!.teams[0].online).toBe(true);
  });
});
