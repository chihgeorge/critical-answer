/* eslint-disable @typescript-eslint/no-explicit-any */
// The room side of a multi-phase boss (docs/designs/boss-phases.md): the answer reveal, then the phase
// card, then the new phase's question, and nothing about a later phase reaching anyone but the host.
import { afterEach, describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import { SCHEMA_VERSION, SNAPSHOT_KEY } from "./snapshot";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
const mc = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "text", value: `題目 ${id}` }, options: ["甲", "乙", "丙", "丁"], correctIndex: 0 });
const PHASE2 = { name: "主題曲之謎", rule: "聽前奏，說出作品名" };

/** Phase 1: two questions, 1 HP. Phase 2: two questions, 2 HP. `q` builds every boss question. */
function phasedBank(q: (id: string) => object = text, hp1 = 1) {
  return parseBank({
    rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, questions: [text("r1"), text("r2")] }],
    boss: {
      monster: { name: "深淵小黑龍", sprite: "dragon", hue: 0, dish: { part: "龍尾", method: "炭火慢烤", name: "龍息烤龍尾", comment: "外脆內嫩。" } },
      phases: [
        { maxHp: hp1, questions: [q("p1-a"), q("p1-b")] },
        { ...PHASE2, maxHp: 2, questions: [q("p2-a"), q("p2-b")] },
      ],
    },
  });
}

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

/** One team (or two), all sent to the boss room, the game started. */
function bossGame(bank = phasedBank(), opts: { teams?: number; storage?: RoomStorage } = {}) {
  const io = { broadcast: vi.fn(), storage: opts.storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0 });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const ids = [T1, T2].slice(0, opts.teams ?? 1);
  const phones = ids.map((id, i) => {
    const c = makeConn(`phone-${i}`);
    room.onConnect(c);
    send(room, c, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: `隊${i}` });
    return c;
  });
  send(room, host, { type: "HOST_START", aiNarration: false });
  for (const id of ids) send(room, host, { type: "HOST_SEND_TO_BOSS", teamId: id });
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  const states = () => msgs(io.broadcast.mock.calls).filter((m) => m.type === "STATE");
  const judge = (correct: boolean) => send(room, host, { type: "HOST_JUDGE", teamId: state().view.currentTurnTeamId, questionId: room.game!.boss.currentQuestionId, correct, fleeChoice: "retry", eventId: state().eventId });
  const next = () => send(room, host, { type: "HOST_NEXT", eventId: state().eventId });
  return { room, io, host, phones, state, states, judge, next };
}

afterEach(() => vi.useRealTimers());

describe("boss phases in the room", () => {
  it("a phase-clearing hit shows its answer at 0 HP, then the card on 下一題, then phase 2's question on 下一題", () => {
    const g = bossGame();
    g.judge(true);
    const reveal = g.state();
    expect(reveal).toMatchObject({ phase: "playing", cue: "boss-hit", reveal: { questionId: "p1-a" } });
    expect(reveal.view).toMatchObject({ bossHp: 0, bossMaxHp: 1, bossPhase: 1, bossKilledBy: null });
    expect(reveal.phaseCard).toBeUndefined();
    expect(msgs(g.io.broadcast.mock.calls).some((m) => m.type === "GAME_OVER")).toBe(false);

    g.next();
    const card = g.state();
    expect(card).toMatchObject({ phaseCard: { monster: { name: "深淵小黑龍", sprite: "dragon", hue: 0 } }, question: null, reveal: null, cue: "boss-phase", eventId: reveal.eventId + 1, bossPhaseInfo: PHASE2 });
    expect(card.phaseCard.monster).not.toHaveProperty("dish"); // served on the kill, not before (monster-cuisine.md)
    expect(card.view).toMatchObject({ bossHp: 2, bossMaxHp: 2, bossPhase: 2 });

    // Nobody answers a question that is not on screen yet.
    g.judge(true);
    expect(msgs(g.host.send.mock.calls).at(-1)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "p2-a", optionIndex: 0 });
    expect(msgs(g.phones[0].send.mock.calls).at(-1)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    // Value: protects=no lock lands while the card hides the question; fails_when=the lock handler checks only the
    // reveal again; why_new=judge and select were covered, lock was not; seam=none; no_claim=multiple-choice timing
    send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "p2-a" });
    expect(msgs(g.phones[0].send.mock.calls).at(-1)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });

    g.next();
    expect(g.state()).toMatchObject({ question: { id: "p2-a" }, bossPhaseInfo: PHASE2 });
    expect(g.state().phaseCard).toBeUndefined();
  });

  it("nothing about phase 2 reaches a phone or the big screen before the card opens; the host gets the phase list", () => {
    const g = bossGame();
    g.judge(true);
    const before = [...msgs(g.io.broadcast.mock.calls), ...msgs(g.phones[0].send.mock.calls)];
    const leaked = JSON.stringify(before);
    for (const secret of ["p2-a", "p2-b", PHASE2.name, PHASE2.rule, "bossPhases"]) expect(leaked).not.toContain(secret);
    expect(before.filter((m) => m.type === "STATE").every((m) => m.view.bossPhase === 1 && !m.bossPhaseInfo)).toBe(true);
    const picks = msgs(g.host.send.mock.calls).findLast((m) => m.type === "HOST_PICKS");
    expect(picks).toMatchObject({ bossPhaseIndex: 0, bossPhases: [{ name: "", rule: "", maxHp: 1 }, { ...PHASE2, maxHp: 2 }] });
    g.next();
    expect(msgs(g.host.send.mock.calls).findLast((m) => m.type === "HOST_PICKS")).toMatchObject({ bossPhaseIndex: 1, options: { boss: ["p2-a", "p2-b"] } });
  });

  it("a stale 下一題 does not close the card", () => {
    const g = bossGame();
    g.judge(true);
    const revealId = g.state().eventId;
    g.next();
    send(g.room, g.host, { type: "HOST_NEXT", eventId: revealId });
    expect(g.state().phaseCard).toBeTruthy();
  });

  it("a multiple-choice reveal that closes itself opens the card, and the card waits for 下一題 (D2)", async () => {
    vi.useFakeTimers();
    const g = bossGame(phasedBank(mc));
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "p1-a", optionIndex: 0 });
    send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: "p1-a" });
    await vi.advanceTimersByTimeAsync(2500);
    expect(g.state().reveal).not.toBeNull();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(g.state()).toMatchObject({ phaseCard: expect.anything(), reveal: null, cue: "boss-phase" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(g.state().phaseCard).toBeTruthy();
  });

  it("a wrong lock that uses up phase 1 sends the retry first, then the card (D7)", async () => {
    vi.useFakeTimers();
    const g = bossGame(phasedBank(mc, 5));
    const lockWrong = async (id: string) => {
      send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: id, optionIndex: 1 });
      send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: id });
      await vi.advanceTimersByTimeAsync(5000); // the lock's beat, then the boss miss's beat
    };
    await lockWrong("p1-a");
    expect(g.room.game!.boss.currentQuestionId).toBe("p1-b");
    const before = g.state().eventId;
    await lockWrong("p1-b");
    // Review finding (red team, 2026-10-28): the card opened in the same tick, so the retry line was never read.
    expect(g.state()).toMatchObject({ cue: "retry", question: { id: "p1-b" } });
    expect(g.state().phaseCard).toBeUndefined();
    send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: "p1-b", optionIndex: 0 });
    expect(msgs(g.phones[0].send.mock.calls).at(-1)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    await vi.advanceTimersByTimeAsync(15_000); // the retry line read out, never past the reveal's cap
    // The first STATE of each new event: what the screens play.
    const events = g.states().filter((m, i, all) => m.eventId > before && m.eventId !== all[i - 1].eventId);
    expect(events.map((m) => [m.cue, !!m.phaseCard])).toEqual([["retry", false], ["boss-phase", true]]);
    expect(g.state().view).toMatchObject({ bossPhase: 2, bossHp: 2 });
  });

  // Review finding (state machine, 2026-10-28): the phase that runs out of questions with HP left had no room test.
  it("a hit that uses up phase 1 with HP left: answer first, judging held, then the card, then phase 2", async () => {
    const g = bossGame(phasedBank(text, 5));
    g.judge(true);
    g.next();
    g.judge(true); // p1-b, the phase's last question
    expect(g.state()).toMatchObject({ reveal: { questionId: "p1-b" } });
    expect(g.state().view).toMatchObject({ bossPhase: 1, bossHp: 3 });
    g.judge(true);
    expect(msgs(g.host.send.mock.calls).at(-1)).toMatchObject({ type: "ERROR", detail: "reveal_pending" });
    g.next();
    expect(g.state()).toMatchObject({ phaseCard: expect.anything(), question: null });
    expect(g.state().view).toMatchObject({ bossPhase: 2, bossHp: 2 });
    g.next();
    expect(g.state().question.id).toBe("p2-a");
    await new Promise((r) => setTimeout(r, 0));
    send(g.room, g.host, { type: "HOST_GET_TRANSCRIPT" });
    const events = msgs(g.host.send.mock.calls).findLast((m) => m.type === "TRANSCRIPT").entries.map((e: { event: { type: string } }) => e.event);
    // The used-up phase's last hit counts no hearts (review finding); the card's own line comes next.
    expect(events.slice(-2)).toEqual([expect.objectContaining({ type: "boss-hit", exhausted: true }), expect.objectContaining({ type: "boss-phase", phase: 2, name: PHASE2.name })]);
  });

  it("after a wrong lock uses up phase 1, 下一題 opens the card early, then closes it", async () => {
    vi.useFakeTimers();
    const g = bossGame(phasedBank(mc, 5));
    for (const id of ["p1-a", "p1-b"]) {
      send(g.room, g.phones[0], { type: "TEAM_SELECT_OPTION", questionId: id, optionIndex: 1 });
      send(g.room, g.phones[0], { type: "TEAM_LOCK_OPTION", questionId: id });
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(g.state().phaseCard).toBeUndefined();
    g.next();
    expect(g.state().phaseCard).toBeTruthy();
    await vi.advanceTimersByTimeAsync(15_000); // the hold's timer, already cleared, opens nothing twice
    expect(g.state().view).toMatchObject({ bossPhase: 2, bossHp: 2 });
    g.next();
    expect(g.state()).toMatchObject({ question: { id: "p2-a" } });
    expect(g.state().phaseCard).toBeUndefined();
  });

  // Review finding (testing, 2026-10-28): D13 was tested only below the room.
  it("names the phase under way when a team walks into the boss room from phase 2 on, and not in phase 1 (D13)", async () => {
    const entering = async (clearFirst: boolean) => {
      const g = bossGame(phasedBank(), { teams: 2 }); // only T1 was sent in: send T2 back out of the boss room
      (g.room as any).game = { ...g.room.game!, teams: g.room.game!.teams.map((t) => (t.id === T2 ? { ...t, inBoss: false } : t)) };
      if (clearFirst) {
        g.judge(true); // T1 empties phase 1
        g.next();
        g.next(); // card closed; T2 is on turn
      } else {
        send(g.room, g.host, { type: "HOST_JUDGE", teamId: T1, questionId: "p1-a", correct: false, fleeChoice: "retry", eventId: g.state().eventId });
      }
      send(g.room, g.host, { type: "HOST_JUDGE", teamId: T2, questionId: g.state().view.teams[1].currentQuestionId, correct: true, eventId: g.state().eventId });
      await new Promise((r) => setTimeout(r, 0));
      send(g.room, g.host, { type: "HOST_GET_TRANSCRIPT" });
      return msgs(g.host.send.mock.calls).findLast((m) => m.type === "TRANSCRIPT").entries.at(-1).event;
    };
    expect(await entering(true)).toMatchObject({ type: "correct", entersBoss: { phase: PHASE2.name } });
    const phase1 = await entering(false);
    expect(phase1).toMatchObject({ type: "correct", entersBoss: {} });
    expect(phase1.entersBoss).not.toHaveProperty("phase");
  });
});

describe("boss phases across a restart", () => {
  function memoryStorage() {
    const data = new Map<string, unknown>();
    return { data, get: async (k: string) => structuredClone(data.get(k)), put: (k: string, v: unknown) => void data.set(k, structuredClone(v)) } as RoomStorage & { data: Map<string, unknown> };
  }
  async function restored(storage: RoomStorage) {
    const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
    const room = new DungeonRoom(io, () => 0, { epilogueDelayMs: 0 });
    expect(await room.restore()).toBe("restored");
    const screen = makeConn("screen");
    room.onConnect(screen);
    return { room, stateOf: () => msgs(screen.send.mock.calls).findLast((m) => m.type === "STATE") };
  }

  it("a restart during the answer reveal of a clearing hit resumes at the phase card", async () => {
    const storage = memoryStorage();
    const g = bossGame(phasedBank(), { storage });
    g.judge(true);
    const { stateOf } = await restored(storage);
    expect(stateOf()).toMatchObject({ phaseCard: expect.anything(), question: null, reveal: null, bossPhaseInfo: PHASE2 });
    expect(stateOf().view.bossPhase).toBe(2);
  });

  it("a restart while the card shows shows it again", async () => {
    const storage = memoryStorage();
    const g = bossGame(phasedBank(), { storage });
    g.judge(true);
    g.next();
    send(g.room, g.host, { type: "HOST_SET_NOTES", notes: "x" }); // any later save
    const { stateOf } = await restored(storage);
    expect(stateOf()).toMatchObject({ phaseCard: expect.anything(), question: null });
  });

  it("restores a save from before boss phases as a one-phase boss", async () => {
    const storage = memoryStorage();
    const g = bossGame(phasedBank(), { storage });
    const saved = storage.data.get(SNAPSHOT_KEY) as any;
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
    const oldBoss = { ...saved.game.boss };
    delete oldBoss.phases;
    delete oldBoss.phaseIndex;
    delete saved.phaseCard;
    storage.data.set(SNAPSHOT_KEY, { ...saved, game: { ...saved.game, boss: oldBoss } });
    const { room, stateOf } = await restored(storage);
    expect(room.game!.boss).toMatchObject({ phaseIndex: 0, phases: [{ maxHp: oldBoss.maxHp, questionIds: oldBoss.questionIds }] });
    expect(stateOf().view.bossPhase).toBe(1);
    void g;
  });
});
