// The room side of a timing question (docs/designs/timing-tap.md): the big screen's clock, every team's one tap,
// the round's close, the hit and the small bonuses, and every refusal and race the design names.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { parseBank } from "../question-bank";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"];
const KEYS = IDS.map((_, i) => `team-key-0123456789abcde${i}`);
const TOKEN = "host-token-0123456789abcdef";
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
/** The clip runs 10–40 s of the video; the beat is at 20 s. */
const tap = (id: string) => ({ kind: "timing", id, content: { kind: "youtube", value: "dQw4w9WgXcQ", audioOnly: true, start: 10, end: 40 }, target: 20, label: "蹬" });
const T0 = 1_000_000;
/** The song is at 15 s at T0: the beat (20 s) plays at T0 + 5000. */
const ANCHOR = T0 - 15_000;

type Spy = Conn & { send: ReturnType<typeof vi.fn> };
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Spy;
const send = (room: DungeonRoom, conn: Conn, msg: object) => room.onMessage(JSON.stringify(msg), conn);
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

function tapGame() {
  const data = new Map<string, unknown>();
  const storage = { get: async (k: string) => structuredClone(data.get(k)), put: vi.fn((k: string, v: unknown) => void data.set(k, structuredClone(v))) } as unknown as RoomStorage & { put: ReturnType<typeof vi.fn> };
  const io = { broadcast: vi.fn(), storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const bank = parseBank({
    rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [text("r1"), text("r2"), text("r3")] }],
    boss: { monster: "dragon", phases: [{ maxHp: 1, questions: [text("p1-a")] }, { name: "最終決戰", rule: "卡點", maxHp: 3, buzzer: true, questions: [tap("t-a"), tap("t-b"), tap("t-c")] }] },
  });
  const room = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0, now: () => Date.now() });
  const host = makeConn("host");
  room.onConnect(host);
  send(room, host, { type: "HOST_CLAIM", token: TOKEN });
  const phones = IDS.map((id, i) => {
    const c = makeConn(`phone-${i}`);
    room.onConnect(c);
    send(room, c, { type: "JOIN", teamId: id, teamKey: KEYS[i], teamName: `隊${i}` });
    return c;
  });
  send(room, host, { type: "HOST_START", aiNarration: false });
  send(room, host, { type: "HOST_SEND_TO_BOSS", teamId: IDS[0] });
  room.game = { ...room.game!, currentTurnIndex: 0 };
  const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
  const next = () => {
    send(room, host, { type: "HOST_SERVE", eventId: state().eventId });
    (room as unknown as { servedAt: number }).servedAt = -Infinity;
    send(room, host, { type: "HOST_NEXT", eventId: state().eventId });
  };
  send(room, host, { type: "HOST_JUDGE", teamId: IDS[0], questionId: "p1-a", correct: true, fleeChoice: "retry", eventId: state().eventId });
  next(); // the phase card
  next(); // the first timing question
  const key = msgs(host.send.mock.calls).find((m) => m.type === "HOST_OK").screenKey;
  const screen = (id = "screen") => {
    const c = makeConn(id);
    room.onConnect(c);
    send(room, c, { type: "SCREEN_HELLO", key });
    return c;
  };
  const tv = screen();
  const qid = () => room.game!.boss.currentQuestionId;
  const seq = () => (room as unknown as { media: { seq: number } | null }).media?.seq ?? 0;
  const media = (action: string) => send(room, host, { type: "HOST_MEDIA", questionId: qid(), action });
  const clock = (anchor: number | null = ANCHOR, from: Conn = tv, s = seq()) => send(room, from, { type: "SCREEN_TAP_CLOCK", questionId: qid(), seq: s, anchor });
  /** Time passes with the big screen's heartbeat every second. */
  const advance = (ms: number, beat = true) => {
    for (let left = ms; left > 0; left -= 1000) {
      vi.advanceTimersByTime(Math.min(1000, left));
      if (beat) clock();
    }
  };
  const tapAt = (i: number, at = Date.now(), round = room.game!.buzz?.tapRound ?? 0, conn: Conn = phones[i]) => send(room, conn, { type: "TEAM_TAP", questionId: qid(), round, at });
  const lastOf = (conn: Spy, type: string) => msgs(conn.send.mock.calls).findLast((m) => m.type === type);
  const team = (i: number) => room.game!.teams.find((t) => t.id === IDS[i])!;
  return { room, io, storage, host, phones, tv, screen, state, media, clock, advance, tapAt, lastOf, team, qid, seq, next };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("timing question in the room", () => {
  it("the closest tap hits the boss, the others get their bonus, and the reveal shows every error while the song plays on", () => {
    const g = tapGame();
    expect(g.state()).toMatchObject({ question: { id: "t-a", timing: { label: "蹬" } } });
    g.media("play");
    g.clock();
    expect(g.state()).toMatchObject({ tapLive: true, view: { buzz: { open: true } } });
    g.advance(4880);
    g.tapAt(1); // 0.12 s early
    g.advance(120);
    g.tapAt(0); // on the beat
    g.advance(400, false);
    g.tapAt(2); // 0.4 s late: everyone tapped, the round waits until target + 0.5 s
    expect(g.state().reveal).toBeNull();
    vi.advanceTimersByTime(100);
    expect(g.state()).toMatchObject({
      cue: "boss-hit",
      media: { state: "playing" },
      view: { bossHp: 2 },
      reveal: { questionId: "t-a", answer: "0:20.00「蹬」", timing: { targetMs: 20_000, label: "蹬", rows: [{ teamId: IDS[0], errorMs: 0, bonus: 0 }, { teamId: IDS[1], errorMs: -120, bonus: 3 }, { teamId: IDS[2], errorMs: 400, bonus: 2 }] } },
    });
    expect([g.team(1).reward, g.team(2).reward]).toEqual([3, 2]);
    // The winner picks the next category, like a buzz winner (M5).
    expect(g.room.game!.buzz).toMatchObject({ picker: IDS[0] });
  });

  // Value: protects=the target and the taps never reach a phone before the reveal (timing-tap.md 作弊); fails_when=STATE spreads the bank question or BuzzState; seam=none
  it("STATE carries no target, no tap and no ms; TAP_OK goes to every phone of the tapping team only, again on reconnect", () => {
    const g = tapGame();
    const second = makeConn("phone-0b");
    g.room.onConnect(second);
    send(g.room, second, { type: "JOIN", teamId: IDS[0], teamKey: KEYS[0], teamName: "隊0" });
    g.media("play");
    g.clock();
    g.tapAt(0);
    const text = JSON.stringify(g.state());
    expect(text).not.toMatch(/target|"taps"|20000|"ms"/);
    expect(g.lastOf(g.phones[0], "TAP_OK")).toEqual({ type: "TAP_OK", questionId: "t-a", round: 0 });
    expect(g.lastOf(second, "TAP_OK")).toBeDefined();
    expect(g.lastOf(g.phones[1], "TAP_OK")).toBeUndefined();
    expect(g.lastOf(g.host, "HOST_ANSWER")).toMatchObject({ answer: "0:20.00「蹬」", tap: { count: 1, eligible: 3 } });
    const back = makeConn("phone-0c");
    g.room.onConnect(back);
    send(g.room, back, { type: "JOIN", teamId: IDS[0], teamKey: KEYS[0], teamName: "隊0", resume: true });
    expect(g.lastOf(back, "TAP_OK")).toMatchObject({ round: 0 });
  });

  it("refuses a second tap, a stale round, a tap with no clock or while paused, and a stamp more than 1 s old; clamps a future one", () => {
    const g = tapGame();
    const err = (i: number) => g.lastOf(g.phones[i], "ERROR")?.detail;
    g.tapAt(0);
    expect(err(0)).toBe("tap_closed"); // before ▶
    g.media("play");
    g.tapAt(0);
    expect(err(0)).toBe("not_playing"); // no clock yet
    g.clock();
    g.tapAt(0, Date.now(), 1);
    expect(err(0)).toBe("stale_question");
    g.tapAt(0, Date.now() - 1500);
    expect(err(0)).toBe("tap_late");
    g.tapAt(0, Date.now() + 5000);
    expect(g.room.game!.buzz!.taps).toEqual([{ teamId: IDS[0], ms: 15_300 }]);
    g.tapAt(0);
    expect(err(0)).toBe("tap_taken");
    g.media("pause");
    expect(g.state().tapLive).toBeUndefined();
    g.tapAt(1);
    expect(err(1)).toBe("not_playing");
  });

  it("the host cannot judge it, nor open it without the big screen", () => {
    const g = tapGame();
    send(g.room, g.host, { type: "HOST_BUZZ_OPEN", questionId: "t-a" });
    expect(g.lastOf(g.host, "ERROR")).toMatchObject({ detail: "timing_needs_screen" });
    g.media("play");
    for (const correct of [true, false]) {
      send(g.room, g.host, { type: "HOST_JUDGE", teamId: IDS[0], questionId: "t-a", correct, fleeChoice: "retry", eventId: g.state().eventId });
      expect(g.lastOf(g.host, "ERROR")).toMatchObject({ detail: "auto_judged" });
    }
    send(g.room, g.phones[0], { type: "TEAM_BUZZ", questionId: "t-a" });
    expect(g.lastOf(g.phones[0], "ERROR")).toMatchObject({ detail: "tap_closed" });
  });

  it("closes at target + 2 s without everyone; a speaker latency moves the close and the taps by as much", () => {
    const g = tapGame();
    send(g.room, g.host, { type: "HOST_TAP_LATENCY", ms: 250.4 });
    expect(g.state()).toMatchObject({ tapLatency: 250 });
    g.media("play");
    g.clock();
    g.advance(5250);
    g.tapAt(0); // heard on the beat, through the latency
    expect(g.room.game!.buzz!.taps).toEqual([{ teamId: IDS[0], ms: 20_000 }]);
    g.advance(1999); // song 21.999 s
    expect(g.state().reveal).toBeNull();
    g.advance(1);
    expect(g.state().reveal).toMatchObject({ timing: { rows: [{ teamId: IDS[0], errorMs: 0 }] } });
  });

  it("nobody tapped: the question moves on unrevealed", () => {
    const g = tapGame();
    g.media("play");
    g.clock();
    g.advance(7000);
    expect(g.state()).toMatchObject({ reveal: null, question: { id: "t-b" } });
    expect(g.room.game!.revealedQuestionIds).not.toContain("t-a");
  });

  // Value: protects=a ⟲ starts a fresh round (timing-tap.md E1); fails_when=old taps, an old-seq clock or an old clip end leak into the new round; seam=none
  it("⟲ clears the taps and bumps the round; an old-seq clock and an old clip end are ignored", () => {
    const g = tapGame();
    g.media("play");
    g.clock();
    g.tapAt(0);
    g.media("restart");
    expect(g.room.game!.buzz).toMatchObject({ taps: undefined, tapRound: 1 });
    expect(g.state()).toMatchObject({ view: { buzz: { tapRound: 1 } } });
    expect(g.state().tapLive).toBeUndefined();
    g.clock(ANCHOR, g.tv, 0);
    expect(g.state().tapLive).toBeUndefined();
    send(g.room, g.tv, { type: "SCREEN_CLIP_ENDED", questionId: "t-a", seq: 0 });
    expect(g.state().question.id).toBe("t-a");
    g.tapAt(0, Date.now(), 0);
    expect(g.lastOf(g.phones[0], "ERROR")).toMatchObject({ detail: "stale_question" });
    g.clock();
    expect(g.state().tapLive).toBe(true);
    g.tapAt(0);
    expect(g.lastOf(g.phones[0], "TAP_OK")).toMatchObject({ round: 1 });
    send(g.room, g.tv, { type: "SCREEN_CLIP_ENDED", questionId: "t-a", seq: 1 });
    expect(g.state().reveal).toMatchObject({ timing: { rows: [{ teamId: IDS[0] }] } });
  });

  it("one screen owns the clock until it goes stale or closes; CLOCK_PING is answered without a save; an unchanged clock does not broadcast", () => {
    const g = tapGame();
    g.media("play");
    g.clock();
    const other = g.screen("screen-2");
    g.clock(ANCHOR + 5000, other);
    g.tapAt(0);
    expect(g.room.game!.buzz!.taps![0].ms).toBe(15_000); // the first screen's anchor
    const before = g.io.broadcast.mock.calls.length;
    const puts = g.storage.put.mock.calls.length;
    g.clock(ANCHOR + 3);
    send(g.room, g.phones[1], { type: "CLOCK_PING", t: 12.5 });
    expect(g.io.broadcast.mock.calls.length).toBe(before);
    expect(g.storage.put.mock.calls.length).toBe(puts);
    expect(g.lastOf(g.phones[1], "CLOCK_PONG")).toEqual({ type: "CLOCK_PONG", t: 12.5, server: Date.now() });
    // The first screen freezes: after 2.5 s its clock is gone, and the other screen takes over.
    vi.advanceTimersByTime(2600);
    expect(g.state().tapLive).toBeUndefined();
    g.clock(ANCHOR, other);
    expect(g.state().tapLive).toBe(true);
    g.room.onClose(other);
    expect(g.state().tapLive).toBeUndefined();
  });

  it("a SCREEN_TAP_CLOCK from a phone or a keyless screen is ignored; a NaN tap is a bad message", () => {
    const g = tapGame();
    g.media("play");
    g.clock(ANCHOR, g.phones[0]);
    const bare = makeConn("bare");
    g.room.onConnect(bare);
    send(g.room, bare, { type: "SCREEN_HELLO" });
    g.clock(ANCHOR, bare);
    expect(g.state().tapLive).toBeUndefined();
    g.room.onMessage('{"type":"TEAM_TAP","questionId":"t-a","round":0,"at":"NaN"}', g.phones[0]);
    expect(g.lastOf(g.phones[0], "ERROR")).toMatchObject({ detail: "bad_message" });
  });

  it("when every online boss-room team is stunned, ▶ clears them all so they can tap; one stunned team sits out", () => {
    const g = tapGame();
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t) => ({ ...t, stunned: true as const })) };
    g.media("play");
    expect(g.room.game!.teams.some((t) => t.stunned)).toBe(false);
    g.room.game = { ...g.room.game!, teams: g.room.game!.teams.map((t, i) => (i === 2 ? { ...t, stunned: true as const } : t)) };
    g.clock();
    g.tapAt(2);
    expect(g.lastOf(g.phones[2], "ERROR")).toMatchObject({ detail: "stunned" });
    g.advance(5000);
    g.tapAt(0);
    g.tapAt(1);
    vi.advanceTimersByTime(500); // the two who may tap did: closes at target + 0.5 s
    expect(g.state().reveal).toMatchObject({ timing: { stunned: [IDS[2]] } });
  });

  // Value: protects=a no-tap close on the phase's last unrevealed timing question (it comes round as itself) does not close again and again; fails_when=the song keeps playing past the target after skipBuzz; seam=none
  it("no tap on the last timing question left: it comes round again paused, the next ▶ replays it from the start, and a tapped team may tap again", () => {
    const g = tapGame();
    g.room.game = { ...g.room.game!, revealedQuestionIds: [...g.room.game!.revealedQuestionIds, "t-b", "t-c"] };
    g.media("play");
    g.clock();
    const seq = g.seq();
    const before = g.io.broadcast.mock.calls.length;
    g.advance(8000);
    expect(g.io.broadcast.mock.calls.length - before).toBeLessThan(20);
    expect(g.qid()).toBe("t-a");
    expect(g.state()).toMatchObject({ media: { state: "paused" }, view: { buzz: { open: true } } });
    expect(g.state().tapLive).toBeUndefined();
    g.media("play");
    expect(g.seq()).toBe(seq + 1);
    // The host skips it after a tap: the same question's new round lets that team tap again.
    g.clock();
    g.tapAt(0);
    send(g.room, g.host, { type: "HOST_BUZZ_SKIP", questionId: "t-a" });
    expect(g.room.game!.buzz).toMatchObject({ questionId: "t-a", tapRound: 2 });
    expect(g.room.game!.buzz!.taps).toBeUndefined();
    g.media("play");
    g.clock();
    g.tapAt(0);
    // The replay is a ⟲ too, so the round moved on again; the team's tap counts in it.
    expect(g.lastOf(g.phones[0], "TAP_OK")).toMatchObject({ round: 3 });
    expect(g.room.game!.buzz!.taps).toHaveLength(1);
  });

  // Value: protects=a killing tap keeps its table and the runner-up's bonus through the 4d20 beat; fails_when=tapReveal is dropped before the deferred reveal; seam=none
  it("a tap that kills the boss keeps the timing table and the bonuses through the kill roll", () => {
    const g = tapGame();
    g.room.game = { ...g.room.game!, boss: { ...g.room.game!.boss, hp: 1 } };
    g.media("play");
    g.clock();
    g.advance(4880);
    g.tapAt(1);
    g.advance(120);
    g.tapAt(0);
    g.advance(30_000, false);
    expect(g.state().reveal).toMatchObject({ timing: { rows: [{ teamId: IDS[0] }, { teamId: IDS[1], bonus: 3 }] } });
    expect(g.team(1).reward).toBeGreaterThanOrEqual(3);
  });

  // Value: protects=a team that taps, then locks its phone, cannot freeze the boss fight by winning while offline; fails_when=settleTaps hands the buzz to an offline team; seam=none
  it("a tapped team whose phone dropped before the close does not take the hit: the closest online team does", () => {
    const g = tapGame();
    g.media("play");
    g.clock();
    g.advance(4880);
    g.tapAt(1); // 0.12 s early
    g.advance(120);
    g.tapAt(0); // on the beat
    g.room.onClose(g.phones[0]);
    g.advance(3000);
    expect(g.state().reveal).toMatchObject({ timing: { rows: [{ teamId: IDS[1] }] } });
    expect(g.state().reveal.timing.rows).toHaveLength(1);
  });

  it("only the screen timing the round may end it with a clip end; the latency cannot change once a team tapped", () => {
    const g = tapGame();
    const other = g.screen("screen-2");
    g.media("play");
    g.clock();
    g.advance(4880);
    g.tapAt(0);
    send(g.room, other, { type: "SCREEN_CLIP_ENDED", questionId: g.qid(), seq: g.seq() });
    expect(g.state().reveal).toBeFalsy();
    send(g.room, g.host, { type: "HOST_TAP_LATENCY", ms: 200 });
    expect(g.lastOf(g.host, "ERROR")).toMatchObject({ detail: "tap_live" });
    send(g.room, g.tv, { type: "SCREEN_CLIP_ENDED", questionId: g.qid(), seq: g.seq() });
    expect(g.state().reveal).toMatchObject({ timing: { rows: [{ teamId: IDS[0] }] } });
  });

  it("a tap whose song time falls before the clip start (a seek or ⟲ in flight) is not_playing", () => {
    const g = tapGame();
    g.media("play");
    g.clock(T0 - 5_000);
    g.tapAt(0);
    expect(g.lastOf(g.phones[0], "ERROR")).toMatchObject({ detail: "not_playing" });
    expect(g.room.game!.buzz!.taps).toBeUndefined();
  });

  it("logs one timing_round line per closed round and keeps the latency across a restart", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const g = tapGame();
    send(g.room, g.host, { type: "HOST_TAP_LATENCY", ms: 5000 });
    expect(g.state().tapLatency).toBe(1000);
    g.media("play");
    g.clock();
    g.tapAt(0);
    g.advance(8000);
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("timing_round"));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "timing_round", questionId: "t-a", taps: 1, eligible: 3, latencyMs: 1000 });
    const again = new DungeonRoom({ broadcast: vi.fn(), storage: g.storage } as unknown as RoomIO, () => 0, { now: () => Date.now() });
    await again.restore();
    expect((again as unknown as { tapLatency: number }).tapLatency).toBe(1000);
    log.mockRestore();
  });
});
