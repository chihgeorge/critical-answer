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
    { monster: "slime-soft", baseDifficulty: 1, reward: 10, questions: [text("r0-t1"), text("r0-t2"), text("r0-t3"), { kind: "multipleChoice", id: "r0-mc", content: { kind: "text", value: "？" }, options: ["A", "B"], correctIndex: 1 }] },
    // pregate-literal: MAX_BOSS_HP=20 not the HP cap
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

/** Two teams (team 0 a cleric with `cleric`), team 0 on turn with 「台北市」 typed; `next` is team 1's question. */
function game(cleric = false, next?: string) {
  const room = new DungeonRoom({ id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []) } as unknown as RoomIO, () => 0, { bank });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const conns = [makeConn("p0"), makeConn("p1")];
  [T1, T2].forEach((id, i) => send(room, conns[i], { type: "JOIN", teamId: id, teamKey: "team-key-0123456789abcdef", teamName: `Team ${i}` }));
  if (cleric) send(room, conns[0], { type: "TEAM_PICK_CLASS", classId: "cleric" });
  send(room, host, { type: "HOST_START" });
  if (next) room.game = { ...room.game!, teams: room.game!.teams.map((t, i) => (i === 1 ? { ...t, currentQuestionId: next } : t)) };
  passChecks(room);
  const q = room.game!.teams[0].currentQuestionId;
  send(room, conns[0], { type: "TEAM_SUBMIT_TEXT", questionId: q, text: "台北市", eventId: state(room).eventId });
  const judge = (correct: boolean, fleeChoice?: string) =>
    send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: q, correct, ...(fleeChoice ? { fleeChoice } : {}), eventId: state(room).eventId });
  const undo = (eventId = state(room).eventId) => send(room, host, { type: "HOST_UNDO_WRONG", teamId: T1, questionId: q, eventId });
  const sends = () => (host.send as ReturnType<typeof vi.fn>).mock.calls.length;
  /** Team 1 makes a move: it types an answer to its fill-in. */
  const move = () => send(room, conns[1], { type: "TEAM_SUBMIT_TEXT", questionId: room.game!.teams[1].currentQuestionId, text: "高雄", eventId: state(room).eventId });
  /** Presses 改判答對 where nothing may be undone: refused, and nothing changes. */
  const refused = () => {
    const before = room.game;
    undo();
    expect(lastSent(host)).toMatchObject({ type: "ERROR", detail: "no_undo" });
    expect(room.game).toBe(before);
  };
  return { room, host, conns, q, judge, undo, sends, move, refused };
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

  // Value: protects=a press from an older STATE (a double press, a second host device) is dropped silently, even while the undo
  // is open; fails_when=the eventId check goes and an old press undoes or errors; seam=room
  it("drops a press from an older STATE without a word", () => {
    const g = game();
    g.judge(false, "retry");
    const eventId = state(g.room).eventId;
    const before = g.room.game;
    let n = g.sends();
    g.undo(eventId - 1);
    expect(g.room.game).toBe(before);
    expect(g.sends()).toBe(n);
    expect(state(g.room).undoWrong).toBeDefined();
    g.undo(eventId);
    const after = g.room.game;
    n = g.sends();
    g.undo(eventId);
    expect(g.room.game).toBe(after);
    expect(g.sends()).toBe(n);
    expect(g.room.game!.teams[0].reward).toBe(10);
  });

  // Value: protects=a re-judge that fails leaves the 答錯 standing and still undoable, never the room rewound to before it;
  // fails_when=the catch stops restoring `now` / `undo`; seam=room
  it("keeps the 答錯, still undoable, when the 答對 cannot be judged", () => {
    const g = game();
    // Judged with nothing sent (a typed answer would keep the turn), then its only phone goes: it cannot take the turn back.
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t, i) => (i === 0 ? { ...t, typedAnswer: undefined } : t)) };
    g.judge(false, "retry");
    g.room.onClose(g.conns[0]);
    const now = g.room.game;
    g.undo();
    expect(lastSent(g.host).type).toBe("ERROR");
    expect(g.room.game).toBe(now);
    expect(state(g.room).undoWrong).toEqual({ teamId: T1, questionId: g.q });
  });

  // Value: protects=only a fill-in's 答錯 is undoable (a multipleChoice one is judged by the lock); fails_when=the kind check in
  // withUndo goes; seam=room
  it("never offers to undo a multipleChoice 答錯", () => {
    const g = game();
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t, i) => (i === 0 ? { ...t, currentQuestionId: "r0-mc", typedAnswer: undefined } : t)) };
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: T1, questionId: "r0-mc", correct: false, fleeChoice: "retry", eventId: state(g.room).eventId });
    expect(state(g.room).undoWrong).toBeUndefined();
    const before = g.room.game;
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: T1, questionId: "r0-mc", eventId: state(g.room).eventId });
    expect(lastSent(g.host)).toMatchObject({ type: "ERROR", detail: "no_undo" });
    expect(g.room.game).toBe(before);
  });

  // Value: protects=only the host undoes, and only the 答錯 it names; fails_when=requireHost or the team check goes; seam=room
  it("refuses a phone, and a press naming another team", () => {
    const g = game();
    g.judge(false, "retry");
    const before = g.room.game;
    send(g.room, g.conns[0], { type: "HOST_UNDO_WRONG", teamId: T1, questionId: g.q, eventId: state(g.room).eventId });
    expect(lastSent(g.conns[0])).toMatchObject({ type: "ERROR", error: "not_host" });
    expect(g.room.game).toBe(before);
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: T2, questionId: g.q, eventId: state(g.room).eventId });
    expect(lastSent(g.host)).toMatchObject({ type: "ERROR", detail: "no_undo" });
    expect(g.room.game).toBe(before);
  });

  // Value: protects=the next team tapping an option is not a move: the undo stays, and so does its tap; fails_when=the tap ends
  // the window, or the undo throws the tap away; seam=room
  it("stays open through the next team's tapped option, which it keeps", () => {
    const g = game(false, "r0-mc");
    g.judge(false, "retry");
    send(g.room, g.conns[1], { type: "TEAM_SELECT_OPTION", questionId: "r0-mc", optionIndex: 1 });
    expect(state(g.room).undoWrong).toBeDefined();
    g.undo();
    expect(g.room.game!.teams[0].reward).toBe(10);
    expect(g.room.game!.teams[1].currentSelection).toBe(1);
  });

  // pregate-literal: MAX_BOSS_HP=20 not the HP cap
  // Value: protects=a lost natural 20 (restart in its beat) won right after a 答錯 is never wiped by undoing that 答錯;
  // fails_when=applyLostCrit stops clearing undoPending; seam=room
  it("is not offered when the 答錯 also hands a lost natural 20 its win", () => { // pregate-literal: MAX_BOSS_HP=20 not the HP cap
    const g = game();
    const r = g.room as unknown as { lostCrit: unknown; reveal: unknown };
    const q2 = g.room.game!.teams[1].currentQuestionId;
    g.room.game = { ...g.room.game!, checks: { ...g.room.game!.checks, [checkKey(q2, T2)]: { value: 20, bonus: 0, dc: 8, passed: true } } }; // pregate-literal: MAX_BOSS_HP=20 not the HP cap
    r.lostCrit = { teamId: T2, questionId: q2 };
    g.judge(false, "retry");
    expect(g.room.game!.teams[1].reward).toBeGreaterThan(0);
    expect(state(g.room).undoWrong).toBeUndefined();
    r.reveal = null; // 上菜 / 下一題 close it without a new game
    g.refused();
    expect(g.room.game!.teams[1].reward).toBeGreaterThan(0);
  });

  // pregate-literal: MAX_BOSS_HP=20 not the HP cap
  // Value: protects=a lost natural 20 that fails to judge leaves the 答錯 before it undoable; fails_when=applyLostCrit's
  // catch stops restoring undoPending; seam=room; no_claim=a real restart
  it("stays offered when a lost natural 20 fails to judge after the 答錯", () => { // pregate-literal: MAX_BOSS_HP=20 not the HP cap
    const g = game();
    const r = g.room as unknown as { lostCrit: unknown; judge: (...a: unknown[]) => void };
    const q2 = g.room.game!.teams[1].currentQuestionId;
    g.room.game = { ...g.room.game!, checks: { ...g.room.game!.checks, [checkKey(q2, T2)]: { value: 20, bonus: 0, dc: 8, passed: true } } }; // pregate-literal: MAX_BOSS_HP=20 not the HP cap
    r.lostCrit = { teamId: T2, questionId: q2 };
    const judge = r.judge.bind(g.room);
    let calls = 0;
    r.judge = (...a) => {
      if (++calls === 2) throw new Error("crit judge failed"); // the 答錯 is call 1, the lost crit call 2
      judge(...a);
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    g.judge(false, "retry");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    expect(state(g.room).undoWrong).toEqual({ teamId: T1, questionId: g.q });
    g.undo();
    expect(g.room.game!.teams[0].reward).toBe(10);
  });

  // Value: protects=a cleric's 答錯 wait, and the 重答 after it, undo back to before the wait without spending a prayer;
  // fails_when=the undo is refused while waiting (answerQuestion refuses 答對 with a wrong waiting) or 祈禱 stays undoable;
  // seam=room; no_claim=the phone's buttons
  it("undoes a cleric's wait and the 重答 / 逃跑 after it, the host's or the phone's; 祈禱 ends it", () => {
    for (const then of [null, "retry", "flee", "phone-retry", "phone-flee"]) {
      const g = game(true);
      g.judge(false, "team");
      if (then?.startsWith("phone-")) send(g.room, g.conns[0], { type: "TEAM_WRONG_CHOICE", questionId: g.q, choice: then.slice(6) });
      else if (then) g.judge(false, then);
      expect(state(g.room).undoWrong).toEqual({ teamId: T1, questionId: g.q });
      g.undo();
      expect(g.room.game!.pendingWrong).toBeNull();
      expect(g.room.game!.teams[0]).toMatchObject({ reward: 10, abilityUses: 2, roomIndex: 1 });
    }
    const p = game(true);
    p.judge(false, "team");
    p.judge(false, "pray");
    expect(state(p.room).undoWrong).toBeUndefined();
    p.refused();
  });

  // Value: protects=every kind of undoable 答錯 closes at the next move (the state matrix's drop cells); fails_when=a chain or a
  // flee keeps an undo past a later move, which would throw that move away; seam=room
  it("closes at the next move after every kind of undoable 答錯", () => {
    const kinds: [boolean, (g: ReturnType<typeof game>) => void][] = [
      [false, (g) => g.judge(false, "flee")],
      [true, (g) => (g.judge(false, "team"), g.judge(false, "retry"))],
      [true, (g) => (g.judge(false, "team"), g.judge(false, "flee"))],
      [true, (g) => (g.judge(false, "team"), send(g.room, g.conns[0], { type: "TEAM_WRONG_CHOICE", questionId: g.q, choice: "retry" }))],
    ];
    for (const [cleric, wrong] of kinds) {
      const g = game(cleric);
      wrong(g);
      passChecks(g.room);
      g.move();
      expect(state(g.room).undoWrong).toBeUndefined();
      g.refused();
    }
  });

  // Generated by /ship coverage audit.
  // Value: protects=a phone coming back (JOIN again) is not a move: the undo stays open and works; fails_when=claimTeam's
  // setOnline goes back to a bare setTeamOnline, closing the window; seam=none; no_claim=REJOIN with a resume token
  it("stays open through a phone that comes back", () => {
    const g = game();
    g.judge(false, "retry");
    g.room.onClose(g.conns[1]);
    const back = makeConn("p1-back");
    g.room.onConnect(back);
    send(g.room, back, { type: "JOIN", teamId: T2, teamKey: "team-key-0123456789abcdef", teamName: "Team 1" });
    expect(g.room.game!.teams[1].online).toBe(true);
    expect(state(g.room).undoWrong).toEqual({ teamId: T1, questionId: g.q });
    g.undo();
    expect(g.room.game!.teams[0].reward).toBe(10);
    expect(g.room.game!.teams[1].online).toBe(true);
  });

  // Generated by /ship coverage audit.
  // Value: protects=a 答錯 the room refuses leaves nothing to undo; fails_when=withUndo's `game !== prev` guard goes, so 改判答對
  // could re-judge a 答錯 that never happened; seam=none; no_claim=none beyond protects
  it("leaves nothing to undo when the 答錯 itself is refused", () => {
    const g = game();
    const q2 = g.room.game!.teams[1].currentQuestionId;
    const before = g.room.game;
    send(g.room, g.host, { type: "HOST_JUDGE", teamId: T2, questionId: q2, correct: false, fleeChoice: "retry", eventId: state(g.room).eventId });
    expect(lastSent(g.host).type).toBe("ERROR");
    expect(g.room.game).toBe(before);
    send(g.room, g.host, { type: "HOST_UNDO_WRONG", teamId: T2, questionId: q2, eventId: state(g.room).eventId });
    expect(lastSent(g.host)).toMatchObject({ type: "ERROR", detail: "no_undo" });
    expect(g.room.game).toBe(before);
  });
});
