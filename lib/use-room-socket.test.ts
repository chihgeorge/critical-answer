// Value: protects=players see 「伺服器重新啟動，遊戲已重置」 after the room server restarts; fails_when=the epoch
// comparison is dropped, inverted or fires on first contact; why_new=no e2e ever changes roomEpoch; seam=none
// (readRoomMessage is what useRoomSocket itself calls on every frame).
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  LIVENESS_CHECK_MS,
  LIVENESS_DEAD_AFTER_MS,
  LIVENESS_PING_AFTER_MS,
  LIVENESS_PING_T,
  livenessAction,
  readRoomMessage,
  shouldWakeReconnect,
  startLivenessCheck,
  WAKE_RECONNECT_AFTER_MS,
} from "./use-room-socket";

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

describe("shouldWakeReconnect", () => {
  it("reconnects a socket that is not open, and an open one only after a long time away", () => {
    expect(shouldWakeReconnect(WebSocket.CONNECTING, 0)).toBe(true);
    expect(shouldWakeReconnect(WebSocket.CLOSED, 0)).toBe(true);
    expect(shouldWakeReconnect(WebSocket.OPEN, 0)).toBe(false);
    expect(shouldWakeReconnect(WebSocket.OPEN, WAKE_RECONNECT_AFTER_MS - 1)).toBe(false);
    expect(shouldWakeReconnect(WebSocket.OPEN, WAKE_RECONNECT_AFTER_MS)).toBe(true);
    expect(shouldWakeReconnect(WebSocket.OPEN, Infinity)).toBe(true);
  });
});

// Value: protects=the big screen and host laptop notice a socket that is dead but still OPEN (audit 2026-11-16 #3);
// fails_when=the ping or reconnect thresholds drift, a reconnect repeats every tick (storm), or it runs while rested,
// hidden or already reconnecting; why_new=no e2e can fake a silently dead socket; seam=startLivenessCheck is the hook's interval.
describe("startLivenessCheck", () => {
  afterEach(() => vi.useRealTimers());

  const fakeSocket = () => ({ readyState: WebSocket.OPEN as number, send: vi.fn(), reconnect: vi.fn() });

  it("pings a quiet socket, reconnects once it stays quiet, then waits a full window before the next reconnect", () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const lastHeard = { current: Date.now() };
    const stop = startLivenessCheck(socket, lastHeard, () => false);
    vi.advanceTimersByTime(LIVENESS_CHECK_MS); // 10 s quiet: nothing
    expect(socket.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIVENESS_CHECK_MS); // 20 s: a ping the clock-sync code ignores
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "CLOCK_PING", t: LIVENESS_PING_T }));
    expect(socket.reconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3 * LIVENESS_CHECK_MS); // 50 s, past LIVENESS_DEAD_AFTER_MS
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LIVENESS_DEAD_AFTER_MS - LIVENESS_CHECK_MS); // still dead, but not another reconnect yet
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(10 * LIVENESS_DEAD_AFTER_MS);
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
  });

  it("a frame resets the clock; nothing happens while paused (rested, hidden) or while not OPEN", () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const lastHeard = { current: Date.now() };
    let paused = false;
    startLivenessCheck(socket, lastHeard, () => paused);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(LIVENESS_CHECK_MS);
      lastHeard.current = Date.now(); // the room keeps talking
    }
    expect(socket.send).not.toHaveBeenCalled();
    paused = true;
    vi.advanceTimersByTime(5 * LIVENESS_DEAD_AFTER_MS);
    paused = false;
    socket.readyState = WebSocket.CONNECTING;
    vi.advanceTimersByTime(5 * LIVENESS_DEAD_AFTER_MS);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  it("livenessAction thresholds", () => {
    expect(livenessAction(LIVENESS_PING_AFTER_MS - 1)).toBe("ok");
    expect(livenessAction(LIVENESS_PING_AFTER_MS)).toBe("ping");
    expect(livenessAction(LIVENESS_DEAD_AFTER_MS - 1)).toBe("ping");
    expect(livenessAction(LIVENESS_DEAD_AFTER_MS)).toBe("reconnect");
  });
});
