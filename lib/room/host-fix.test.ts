// ⚙ 更多's 修正 (docs/hosting.md): the host corrects a team's reward, ability uses or held potion by hand. Host only,
// clamped server-side, no line on the big screen, and every press kept in the team's game log and the transcript.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";
import { gameLog } from "../game-log";
import { parseClientMessage } from "../protocol";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const [A, B] = IDS;
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const bank = () =>
  parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [text("r1"), text("r2"), text("r3"), text("r4"), text("r5")] }],
    boss: { monster: "dragon", maxHp: 3, questions: [text("b1")] },
  });

const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function memoryStorage() {
  const data = new Map<string, unknown>();
  return { get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage;
}

/** Two teams (甲 a thief, 乙 a chef by default) and a host. */
function started(classes: (string | null)[] = ["thief", "chef"], storage = memoryStorage()) {
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const conn = makeConn(`p${i}`);
    room.onConnect(conn);
    send(room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊"][i] });
    if (classes[i]) send(room, conn, { type: "TEAM_PICK_CLASS", classId: classes[i] });
    return conn;
  });
  send(room, host, { type: "HOST_START", aiNarration: false });
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  const team = (id: string) => room.game!.teams.find((t) => t.id === id)!;
  const lastTo = (conn: Conn & { send: ReturnType<typeof vi.fn> }) => msgs(conn.send.mock.calls).at(-1);
  const fix = (teamId: string, f: string, conn: Conn = host) => send(room, conn, { type: "HOST_FIX", teamId, fix: f });
  return { room, io, host, phones, state, team, lastTo, fix, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("⚙ 更多 修正", () => {
  it("parses only the five fixes with a team id", () => {
    expect(parseClientMessage({ type: "HOST_FIX", teamId: A, fix: "score+" })).toEqual({ type: "HOST_FIX", teamId: A, fix: "score+" });
    expect(parseClientMessage({ type: "HOST_FIX", teamId: A, fix: "score+10" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_FIX", teamId: A, fix: "potion+" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_FIX", fix: "score-" })).toBeNull();
  });

  it("a phone or a big screen gets not_host and changes nothing", () => {
    const g = started();
    g.fix(A, "score+", g.phones[0]);
    expect(g.lastTo(g.phones[0])).toMatchObject({ type: "ERROR", error: "not_host" });
    const screen = makeConn("screen");
    g.room.onConnect(screen);
    send(g.room, screen, { type: "SCREEN_HELLO" });
    g.fix(A, "score+", screen);
    expect(g.lastTo(screen)).toMatchObject({ type: "ERROR", error: "not_host" });
    expect(g.team(A).reward).toBe(0);
    expect(g.team(A).fixes).toBeUndefined();
  });

  it("score ± moves the reward by 5, never below 0, leaves progress alone, and logs each press", () => {
    const g = started();
    const before = g.state().eventId;
    g.fix(A, "score+");
    g.fix(A, "score+");
    expect(g.state().view.teams.find((t: { id: string }) => t.id === A)).toMatchObject({ reward: 10, score: 0 });
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t) => (t.id === A ? { ...t, reward: 3 } : t)) };
    g.fix(A, "score-");
    expect(g.team(A).reward).toBe(0);
    g.fix(A, "score-");
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action", detail: "at_limit" });
    expect(g.team(A).fixes).toEqual([
      { fix: "score+", from: 0, to: 5 },
      { fix: "score+", from: 5, to: 10 },
      { fix: "score-", from: 3, to: 0 },
    ]);
    // No narration, no cue: the eventId does not move.
    expect(g.state().eventId).toBe(before);
    const log = gameLog(g.room.game!, 0).teams.find((t) => t.name === "甲隊")!;
    expect(log.fixes).toHaveLength(3);
    expect(gameLog(g.room.game!, 0).teams.find((t) => t.name === "乙隊")!.fixes).toEqual([]);
    send(g.room, g.host, { type: "HOST_GET_TRANSCRIPT" });
    const entries = g.lastTo(g.host).entries as { kind?: string; text?: string }[];
    expect(entries.filter((e) => e.kind === "fix").map((e) => e.text)).toEqual(["甲隊 score+ 0→5", "甲隊 score+ 5→10", "甲隊 score- 3→0"]);
  });

  it("ability uses stay within 0..the class's set; a chef or a classless team has none to fix", () => {
    const g = started();
    expect(g.team(A).abilityUses).toBe(2);
    g.fix(A, "ability+");
    expect(g.lastTo(g.host)).toMatchObject({ detail: "at_limit" });
    g.fix(A, "ability-");
    g.fix(A, "ability-");
    g.fix(A, "ability-");
    expect(g.lastTo(g.host)).toMatchObject({ detail: "at_limit" });
    expect(g.team(A).abilityUses).toBe(0);
    g.fix(A, "ability+");
    expect(g.team(A).abilityUses).toBe(1);
    g.fix(B, "ability+");
    expect(g.lastTo(g.host)).toMatchObject({ detail: "no_ability" });
    expect(g.team(B).fixes).toBeUndefined();
  });

  it("uses an event room gave raise the cap, and each press moves one step its own way (/review)", () => {
    const g = started();
    // Two 🌸 springs gave the thief 2 more uses: 4 against a set of 2.
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t) => (t.id === A ? { ...t, abilityUses: 4, events: ["spring" as const, "good" as const] } : t)) };
    g.fix(A, "ability-");
    expect(g.team(A).abilityUses).toBe(3);
    g.fix(A, "ability+");
    g.fix(A, "ability+");
    expect(g.lastTo(g.host)).toMatchObject({ detail: "at_limit" });
    expect(g.team(A).fixes).toEqual([
      { fix: "ability-", from: 4, to: 3 },
      { fix: "ability+", from: 3, to: 4 },
    ]);
    expect(g.state().view.teams.find((t: { id: string }) => t.id === A).abilityCap).toBe(4);
    expect(g.state().view.teams.find((t: { id: string }) => t.id === B).abilityCap).toBeUndefined();
  });

  it("waits while the team's die is in its beat, or a fortune card is open", () => {
    const g = started();
    const room = g.room as unknown as { pendingRoll: unknown; fortuneActive: () => boolean };
    room.pendingRoll = { teamId: A };
    g.fix(A, "score+");
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action", detail: "lock_pending" });
    room.pendingRoll = null;
    room.fortuneActive = () => true;
    g.fix(A, "score+");
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action", detail: "paused" });
    expect(g.team(A).reward).toBe(0);
    expect(g.team(A).fixes).toBeUndefined();
  });

  it("a thief's armed 偷襲 counts as a use spent, so its refund never goes past the set", () => {
    const g = started();
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t) => (t.id === A ? { ...t, abilityUses: 1, sneakArmed: true as const } : t)) };
    g.fix(A, "ability+");
    expect(g.lastTo(g.host)).toMatchObject({ detail: "at_limit" });
    expect(g.team(A).abilityUses).toBe(1);
  });

  it("takes back a held potion only, armed or not, without counting it as drunk", () => {
    const g = started();
    g.fix(B, "potion-");
    expect(g.lastTo(g.host)).toMatchObject({ detail: "no_item" });
    send(g.room, g.host, { type: "HOST_GIVE_ITEM", teamId: B });
    g.fix(B, "potion-");
    expect(g.team(B)).toMatchObject({ item: undefined, potionsGiven: 1, fixes: [{ fix: "potion-", from: 1, to: 0 }] });
    expect(g.team(B).potionsDrunk).toBeUndefined();
    send(g.room, g.host, { type: "HOST_GIVE_ITEM", teamId: B });
    expect(g.team(B).item).toBe("luckyPotion");
  });

  it("closes 改判答對: a later undo can never wipe a correction", () => {
    const g = started();
    const q = g.state().question.id;
    send(g.room, g.phones[0], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "猜", eventId: g.state().eventId });
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: A, questionId: q, correct: false, fleeChoice: "retry", eventId: g.state().eventId });
    expect(g.state().undoWrong).toMatchObject({ teamId: A });
    g.fix(B, "score+");
    expect(g.state().undoWrong).toBeUndefined();
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: A, questionId: q, eventId: g.state().eventId });
    expect(g.team(B).reward).toBe(5);
  });

  it("an unknown team, or no game, is refused", () => {
    const g = started();
    g.fix("00000000-0000-0000-0000-00000000000f", "score+");
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action" });
    const io = { broadcast: vi.fn(), storage: memoryStorage() } as unknown as RoomIO;
    const room = new DungeonRoom(io, () => 0, { bank: bank(), epilogueDelayMs: 0 });
    const host = makeConn("host");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: TOKEN });
    send(room, host, { type: "HOST_FIX", teamId: A, fix: "score+" });
    expect(msgs(host.send.mock.calls).at(-1)).toMatchObject({ error: "no_active_game" });
  });

  it("a finished game takes no more corrections", () => {
    const g = started();
    send(g.room, g.host, { type: "HOST_END_GAME" });
    g.fix(A, "score+");
    expect(g.lastTo(g.host)).toMatchObject({ error: "invalid_action" });
    expect(g.team(A).reward).toBe(0);
  });

  it("corrections survive a restart (room snapshot)", async () => {
    const g = started();
    g.fix(A, "score+");
    g.fix(A, "ability-");
    const second = new DungeonRoom({ broadcast: vi.fn(), storage: g.storage } as unknown as RoomIO, () => 0, { bank: bank(), epilogueDelayMs: 0 });
    expect(await second.restore()).toBe("restored");
    expect(second.game!.teams[0]).toMatchObject({ reward: 5, abilityUses: 1, fixes: [{ fix: "score+", from: 0, to: 5 }, { fix: "ability-", from: 2, to: 1 }] });
  });
});
