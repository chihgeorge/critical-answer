/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { findQuestion } from "../question-bank";
import { BANK } from "../question-bank-data";

// No vi.mock here, unlike dungeon-room.test.ts: this file plays the real bundled bank, all multipleChoice.
const T1 = "00000000-0000-0000-0000-000000000001";
const conn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn;
const send = (room: DungeonRoom, c: Conn, msg: object) => room.onMessage(JSON.stringify(msg), c);

afterEach(() => vi.useRealTimers());

describe("bundled bank", () => {
  it("a whole game runs on phone locks alone: no HOST_JUDGE, no HOST_NEXT (docs/designs/phone-answering.md PR 2)", async () => {
    vi.useFakeTimers();
    const io = { id: "room-1", broadcast: vi.fn(), getConnections: vi.fn(() => []) } as unknown as RoomIO;
    const room = new DungeonRoom(io as any, () => 0);
    const host = conn("host");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: "host-token-0123456789abcdef" });
    const phone = conn("phone");
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    send(room, host, { type: "HOST_START", aiNarration: false });

    let turns = 0;
    while (room.game!.phase === "playing") {
      expect(++turns).toBeLessThan(200);
      const team = room.game!.teams[0];
      const qid = team.inBoss ? room.game!.boss.currentQuestionId : team.currentQuestionId;
      const q = findQuestion(BANK, qid)!;
      expect(q.kind).toBe("multipleChoice");
      if (q.kind !== "multipleChoice") return;
      send(room, phone, { type: "TEAM_SELECT_OPTION", questionId: qid, optionIndex: q.correctIndex });
      send(room, phone, { type: "TEAM_LOCK_OPTION", questionId: qid, optionIndex: q.correctIndex });
      await vi.advanceTimersByTimeAsync(16_000); // the 2 s lock hold, then auto-advance (capped at 15 s)
    }
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.winners).toEqual([T1]);
  });
});
