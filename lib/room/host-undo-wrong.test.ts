// 改判答對 (TODOS.md 「主持人按錯「答錯」可以改回答對」): the host's last 答錯 on a fill-in becomes 答對, judged from the
// game before it, while nothing has moved since.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { parseBank } from "../question-bank";
import { checkKey, currentTurnTeamId } from "../game-state";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text" as const, id, content: { kind: "text" as const, value: "？" }, answer: "台北市" });
const bank = parseBank({
  rooms: [
    { monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [text("r0-t1"), text("r0-t2"), text("r0-t3")] },
    { monster: "slime-soft", baseDifficulty: 1, reward: 20, questions: [text("r1-t1"), text("r1-t2")] },
  ],
  boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [text("boss-t1"), text("boss-t2")] },
});

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const state = (room: DungeonRoom) => JSON.parse((room.room.broadcast as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
const lastSent = (conn: Conn) => JSON.parse((conn.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);

/** Every team's current question gets a plain passed persuasion check, so a fill-in can be answered. */
function passChecks(room: DungeonRoom) {
  const g = room.game!;
  const checks = { ...g.checks };
  for (const t of g.teams) checks[checkKey(t.currentQuestionId, t.id)] ??= { value: 10, bonus: 0, dc: 8, passed: true };
  room.game = { ...g, checks };
}

/** Two teams (team 0 a cleric with `cleric`), team 0 on turn with 「台北市」 typed. */
function game(cleric = false) {
  const room = new DungeonRoom({ id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []) } as unknown as RoomIO, () => 0, { bank });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const conns = [makeConn("p0"), makeConn("p1")];
  [T1, T2].forEach((id, i) => send(room, conns[i], { type: "JOIN", teamId: id, teamKey: "team-key-0123456789abcdef", teamName: `Team ${i}` }));
  if (cleric) send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "cleric" });
  send(room, host, { type: "HOST_START" });
  passChecks(room);
  const q = room.game!.teams[0].currentQuestionId;
  send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "台北市", eventId: state(room).eventId });
  const judge = (correct: boolean, fleeChoice?: string) =>
    send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: q, correct, ...(fleeChoice ? { fleeChoice } : {}), eventId: state(room).eventId });
  const undo = (eventId = state(room).eventId) => send(room, host, { type: "HOST_UNDO_WRONG", teamId: T1, questionId: q, eventId });
  return { room, host, conns, q, judge, undo };
}

/** What the answer changed for the teams: everything but `online`. */
const teams = (room: DungeonRoom) => room.game!.teams.map((t) => ({ ...t, online: undefined }));

describe("改判答對: the host's 答錯 on a fill-in becomes 答對", () => {
  // Value: protects=an undone 答錯・重答 or 答錯・逃跑 ends exactly as a straight 答對 (score, reward, dish, room, reveal, turn);
  // fails_when=the undo keeps the miss's turn change, a fled question, or skips the reveal; seam=room; no_claim=narration text
  it("答錯・重答 and 答錯・逃跑, undone, end as a straight 答對", () => {
    const right = game();
    right.judge(true);
    for (const flee of ["retry", "flee"]) {
      const g = game();
      g.judge(false, flee);
      expect(state(g.room).undoWrong).toEqual({ teamId: T1, questionId: g.q });
      g.undo();
      expect(teams(g.room)).toEqual(teams(right.room));
      expect(currentTurnTeamId(g.room.game!)).toBe(currentTurnTeamId(right.room.game!));
      expect(state(g.room).reveal).toEqual(state(right.room).reveal);
      expect(state(g.room).cue).toBe("correct");
      expect(state(g.room).undoWrong).toBeUndefined();
    }
  });

  // Value: protects=the window closes at the next move in the game but not at a phone dropping; fails_when=a later typed answer
  // is thrown away by an undo, or a reconnect closes the window; seam=room; no_claim=the host page's button
  it("is refused once anything moves, but a phone going offline keeps it open", () => {
    const a = game();
    a.judge(false, "retry");
    a.room.onClose(a.conns[1]);
    expect(state(a.room).undoWrong).toBeDefined();
    a.undo();
    expect(a.room.game!.teams[0].reward).toBe(10);
    expect(a.room.game!.teams[1].online).toBe(false);

    const b = game();
    b.judge(false, "retry");
    const next = b.room.game!.teams[1].currentQuestionId;
    send(b.room, b.conns[1], { type: "TEAM_SUBMIT_TEXT", questionId: next, text: "高雄", eventId: state(b.room).eventId });
    const moved = b.room.game;
    expect(state(b.room).undoWrong).toBeUndefined();
    b.undo();
    expect(lastSent(b.host)).toMatchObject({ type: "ERROR", detail: "no_undo" });
    expect(b.room.game).toBe(moved);
  });

  // Value: protects=a double press of 改判答對 judges once; fails_when=the second press errors or scores twice; seam=room
  it("drops a second press from the older STATE", () => {
    const g = game();
    g.judge(false, "retry");
    const eventId = state(g.room).eventId;
    g.undo(eventId);
    const after = g.room.game;
    g.undo(eventId);
    expect(g.room.game).toBe(after);
    expect(g.room.game!.teams[0].reward).toBe(10);
  });

  // Value: protects=a cleric's 答錯 wait, and the 重答 after it, undo back to before the wait without spending a prayer;
  // fails_when=the undo is refused while waiting (answerQuestion refuses 答對 with a wrong waiting) or 祈禱 stays undoable;
  // seam=room; no_claim=the phone's buttons
  it("undoes a cleric's wait and the 重答 after it; 祈禱 ends it", () => {
    for (const then of [null, "retry"]) {
      const g = game(true);
      g.judge(false, "team");
      if (then) g.judge(false, then);
      expect(state(g.room).undoWrong).toEqual({ teamId: T1, questionId: g.q });
      g.undo();
      expect(g.room.game!.pendingWrong).toBeNull();
      expect(g.room.game!.teams[0]).toMatchObject({ reward: 10, abilityUses: 2, roomIndex: 1 });
    }
    const p = game(true);
    p.judge(false, "team");
    p.judge(false, "pray");
    expect(state(p.room).undoWrong).toBeUndefined();
  });
});
