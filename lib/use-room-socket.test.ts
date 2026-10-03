// Value: protects=players see 「伺服器重新啟動，遊戲已重置」 after the room server restarts; fails_when=the epoch
// comparison is dropped, inverted or fires on first contact; why_new=no e2e ever changes roomEpoch; seam=none
// (readRoomMessage is what useRoomSocket itself calls on every frame).
import { describe, it, expect } from "vitest";
import { readRoomMessage } from "./use-room-socket";

const lobby = (roomEpoch?: string) => JSON.stringify({ type: "LOBBY", teams: [], ...(roomEpoch ? { roomEpoch } : {}) });

describe("readRoomMessage", () => {
  it("records the first roomEpoch it sees without calling it a reset", () => {
    expect(readRoomMessage(lobby("e1"), null)).toMatchObject({ epoch: "e1", reset: false, msg: { type: "LOBBY" } });
  });

  it("reports a reset when the epoch changes, and adopts the new one", () => {
    expect(readRoomMessage(lobby("e2"), "e1")).toMatchObject({ epoch: "e2", reset: true });
  });

  it("does not report a reset for the same epoch again", () => {
    expect(readRoomMessage(lobby("e1"), "e1")).toMatchObject({ epoch: "e1", reset: false });
  });

  it("treats STATE like LOBBY", () => {
    const state = JSON.stringify({ type: "STATE", roomEpoch: "e2" });
    expect(readRoomMessage(state, "e1")).toMatchObject({ epoch: "e2", reset: true });
  });

  it("leaves the epoch alone for messages that carry none", () => {
    expect(readRoomMessage(JSON.stringify({ type: "NARRATION", eventId: 1, lines: ["…"] }), "e1")).toMatchObject({ epoch: "e1", reset: false });
    expect(readRoomMessage(lobby(), "e1")).toMatchObject({ epoch: "e1", reset: false });
  });

  it("returns null for a frame that is not JSON, so the page ignores it instead of crashing", () => {
    expect(readRoomMessage("not json", "e1")).toBeNull();
  });
});
