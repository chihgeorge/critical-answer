// #362: during an answer reveal the turn has already moved on, and STATE deals the next team's question. Its text must
// wait for the host's 下一題: the big screen and the phones get the question's shape with blank text, the host pages get
// the whole question with HOST_ANSWER.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSettled } from "./test-send";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { parseBank } from "../question-bank";
import { SERVE_HOLD_MS } from "../protocol";

const IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const TOKEN = "host-token-0123456789abcdef";
const mc = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "text", value: `題目 ${id}` }, options: [`甲${id}`, `乙${id}`, `丙${id}`, `丁${id}`], correctIndex: 0 });
const bank = parseBank({
  rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [mc("r1"), mc("r2"), mc("r3"), mc("r4")] }],
  boss: { monster: "dragon", maxHp: 1, questions: [mc("b1")] },
});
const makeConn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const msgs = (calls: unknown[][]) => calls.map((c) => JSON.parse(c[0] as string));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#362 the next question under a reveal", () => {
  it("STATE blanks its text until 下一題; the host still gets the whole question", () => {
    const io = { broadcast: vi.fn(), storage: { get: async () => undefined, put: () => {} } } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
    const room = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0 });
    const state = () => msgs(io.broadcast.mock.calls).findLast((m) => m.type === "STATE");
    const host = makeConn("host");
    room.onConnect(host);
    sendSettled(room, host, { type: "HOST_CLAIM", token: TOKEN });
    const phones = IDS.map((id, i) => {
      const conn = makeConn(`p${i}`);
      room.onConnect(conn);
      sendSettled(room, conn, { type: "JOIN", teamId: id, teamKey: `team-key-0123456789abcde${i}`, teamName: ["甲隊", "乙隊"][i] });
      return conn;
    });
    sendSettled(room, host, { type: "HOST_START", aiNarration: false, intro: false, initiative: false });
    const first = state();
    expect(first.question.content.value).toMatch(/^題目 /);
    const phone = phones[IDS.indexOf(first.view.currentTurnTeamId)];
    sendSettled(room, phone, { type: "TEAM_SELECT_OPTION", questionId: first.question.id, optionIndex: 0 });
    sendSettled(room, phone, { type: "TEAM_LOCK_OPTION", questionId: first.question.id });
    sendSettled(room, host, { type: "HOST_REVEAL", teamId: first.view.currentTurnTeamId, questionId: first.question.id });
    vi.advanceTimersByTime(8000); // the lock's beat; the answer's reveal then waits for 🎲 擲料理骰
    sendSettled(room, host, { type: "HOST_NEXT", eventId: state().eventId }); // the dish die, landed at once

    const during = state();
    expect(during.reveal).toMatchObject({ questionId: first.question.id });
    const next = during.question;
    expect(next.id).not.toBe(first.question.id);
    expect(next.content).toEqual({ kind: "text", value: "" });
    expect(next.options).toEqual(["", "", "", ""]);
    expect(JSON.stringify(during)).not.toContain(`題目 ${next.id}`);
    const answer = msgs(host.send.mock.calls).findLast((m) => m.type === "HOST_ANSWER");
    expect(answer).toMatchObject({ questionId: next.id, question: { id: next.id, content: { kind: "text", value: `題目 ${next.id}` }, options: [`甲${next.id}`, `乙${next.id}`, `丙${next.id}`, `丁${next.id}`] } });

    sendSettled(room, host, { type: "HOST_SERVE", eventId: during.eventId });
    vi.advanceTimersByTime(SERVE_HOLD_MS);
    sendSettled(room, host, { type: "HOST_NEXT", eventId: state().eventId });
    const after = state();
    expect(after.reveal).toBeNull();
    expect(after.question).toMatchObject({ id: next.id, content: { kind: "text", value: `題目 ${next.id}` } });
    expect(msgs(host.send.mock.calls).findLast((m) => m.type === "HOST_ANSWER")).not.toHaveProperty("question");
  });
});
