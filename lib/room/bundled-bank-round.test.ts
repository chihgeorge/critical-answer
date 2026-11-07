import { afterEach, describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { findQuestion } from "../question-bank";
import { BANK } from "../question-bank-data";

// No vi.mock here, unlike dungeon-room.test.ts: this file plays the real bundled bank, all multipleChoice.
const T1 = "00000000-0000-0000-0000-000000000001";
const conn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn;
const send = (room: DungeonRoom, c: Conn, msg: object) => room.onMessage(JSON.stringify(msg), c);
/** 上菜 then 下一題 (monster-cuisine.md cooking I2), skipping the cooking's hold a real host waits out. */
function serveNext(room: DungeonRoom, conn: Conn, eventId: number) {
  send(room, conn, { type: "HOST_SERVE", eventId });
  (room as unknown as { servedAt: number }).servedAt = -Infinity;
  send(room, conn, { type: "HOST_NEXT", eventId });
}


afterEach(() => vi.useRealTimers());

describe("bundled bank", () => {
  it("a whole game runs on phone locks, the host's 公布答案 and 下一題: no HOST_JUDGE (phone-answering.md PR 2, host-reveal.md)", async () => {
    vi.useFakeTimers();
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []) } as unknown as RoomIO;
    const room = new DungeonRoom(io, () => 0);
    const host = conn("host");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: "host-token-0123456789abcdef" });
    const phone = conn("phone");
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    send(room, host, { type: "HOST_START", aiNarration: false });

    let turns = 0;
    while (room.game!.phase === "playing") {
      expect(++turns, "game never finished: a lock or a reveal got stuck?").toBeLessThan(200);
      const team = room.game!.teams[0];
      const qid = team.inBoss ? room.game!.boss.currentQuestionId : team.currentQuestionId;
      const q = findQuestion(BANK, qid)!;
      if (q.kind !== "multipleChoice") throw new Error(`${qid} is not multipleChoice`);
      send(room, phone, { type: "TEAM_SELECT_OPTION", questionId: qid, optionIndex: q.correctIndex });
      send(room, phone, { type: "TEAM_LOCK_OPTION", questionId: qid, optionIndex: q.correctIndex });
      send(room, host, { type: "HOST_REVEAL", teamId: T1, questionId: qid });
      await vi.advanceTimersByTimeAsync(2_500); // the 2 s beat
      serveNext(room, host, (room as unknown as { eventSeq: number }).eventSeq);
    }
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.winners).toEqual([T1]);
  });
});
