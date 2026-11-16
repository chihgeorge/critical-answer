"use client";

import { useEffect, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import { restKindOf, type RestKind } from "./room/close-codes";
import type { ClientMessage, ServerMessage } from "./protocol";
import { PARTY_HOST } from "./party-host";

/** Parses one frame from the room and tracks `roomEpoch`, the id the server picks each time it starts
 * a fresh game. A different epoch than the one we last saw means the server restarted and the game
 * we were showing is gone (`reset`). The first epoch only gets recorded. Not JSON: null (ignored). */
export function readRoomMessage(data: string, lastEpoch: string | null): { msg: ServerMessage; epoch: string | null; reset: boolean } | null {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(data) as ServerMessage;
  } catch {
    return null;
  }
  if ((msg.type === "LOBBY" || msg.type === "STATE") && msg.roomEpoch) {
    return { msg, epoch: msg.roomEpoch, reset: lastEpoch !== null && lastEpoch !== msg.roomEpoch };
  }
  return { msg, epoch: lastEpoch, reset: false };
}

/** How long the 「伺服器重新啟動」 notice stays up. */
export const RESET_NOTICE_MS = 10_000;

/** Away this long, an OPEN socket may be a dead one iOS still calls open; reconnecting it costs one round trip. */
export const WAKE_RECONNECT_AFTER_MS = 10_000;

/** On waking (page visible again, or back online): reconnect a socket that is not open, or one that is open but was
 * hidden long enough to be dead. One reconnect per wake event, so no storm. */
export function shouldWakeReconnect(readyState: number, awayMs: number): boolean {
  return readyState !== WebSocket.OPEN || awayMs >= WAKE_RECONNECT_AFTER_MS;
}

/** A socket can stay OPEN after the network dropped it (a venue AP drops an idle link, a laptop roams or sleeps), and
 * nothing would notice. So every LIVENESS_CHECK_MS: quiet for LIVENESS_PING_AFTER_MS, send a CLOCK_PING (the room
 * always answers and does not count it as activity, so an idle room still rests); quiet for LIVENESS_DEAD_AFTER_MS,
 * reconnect, so the page shows its offline notice. Generous, for slow venue Wi-Fi: about three pings go unanswered first. */
export const LIVENESS_CHECK_MS = 10_000;
export const LIVENESS_PING_AFTER_MS = 15_000;
export const LIVENESS_DEAD_AFTER_MS = 45_000;
/** A CLOCK_PING `t` no clock-sync ping uses, so useRoomClock drops its pong. */
export const LIVENESS_PING_T = -1;

export function livenessAction(quietMs: number): "ok" | "ping" | "reconnect" {
  return quietMs >= LIVENESS_DEAD_AFTER_MS ? "reconnect" : quietMs >= LIVENESS_PING_AFTER_MS ? "ping" : "ok";
}

/** Runs the liveness check on `socket` until the returned stop is called. `lastHeard` is the time of the last frame or open. */
export function startLivenessCheck(
  socket: { readyState: number; send(data: string): void; reconnect(): void },
  lastHeard: { current: number },
  paused: () => boolean,
): () => void {
  const id = setInterval(() => {
    if (paused() || socket.readyState !== WebSocket.OPEN) return;
    const action = livenessAction(Date.now() - lastHeard.current);
    if (action === "ping") socket.send(JSON.stringify({ type: "CLOCK_PING", t: LIVENESS_PING_T } satisfies ClientMessage));
    else if (action === "reconnect") {
      lastHeard.current = Date.now(); // the next reconnect waits a full LIVENESS_DEAD_AFTER_MS again
      socket.reconnect();
    }
  }, LIVENESS_CHECK_MS);
  return () => clearInterval(id);
}

/** How long a page waits for its first connection before saying it can't reach the server. */
export const FIRST_CONNECT_TIMEOUT_MS = 10_000;

/** The room connection the host, play and screen pages share: parsed messages, the server-restart
 * check (`reset`), and the idle rest that stops automatic reconnecting (`rested`). */
export function useRoomSocket(
  code: string,
  handlers: {
    /** `resume`: an automatic reconnect, not a person coming back, so it must not count as activity. */
    onOpen?(resume: boolean): void;
    /** `rested`: the room closed us on purpose. `openedBefore`: false while the first connect is still failing. */
    onClose?(info: { rested: boolean; openedBefore: boolean }): void;
    onMessage(msg: ServerMessage): void;
  },
) {
  const [reset, setReset] = useState(false);
  /** The room closed our connection on purpose after a long idle time. The game is saved; a tap reconnects. */
  const [rested, setRested] = useState<RestKind | null>(null);
  /** `rested` for the wake listener, which outlives renders. */
  const restedNow = useRef(false);
  const epoch = useRef<string | null>(null);
  /** Whether this page has connected before, and whether the next reconnect was asked for by a tap:
   * together they tell an automatic reconnect (`resume`) from a person coming back. */
  const openedOnce = useRef(false);
  const reconnectByHand = useRef(false);
  /** When the last frame came in (or the socket opened), for the liveness check. */
  const lastHeard = useRef(0);
  /** The first connect hasn't opened within FIRST_CONNECT_TIMEOUT_MS. partysocket keeps retrying meanwhile. */
  const [unreachable, setUnreachable] = useState(false);
  /** Bumped by `reconnect()` to restart the first-connect timer. */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (openedOnce.current) return;
    const id = setTimeout(() => setUnreachable(!openedOnce.current), FIRST_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [attempt]);

  const socket = usePartySocket({
    host: PARTY_HOST,
    room: code,
    onOpen() {
      setRested(null);
      restedNow.current = false;
      setUnreachable(false);
      lastHeard.current = Date.now();
      const resume = openedOnce.current && !reconnectByHand.current;
      openedOnce.current = true;
      reconnectByHand.current = false;
      handlers.onOpen?.(resume);
    },
    onClose(event: CloseEvent) {
      // Stop the automatic reconnecting, or an unused room would be woken up again straight away.
      const restKind = restKindOf(event);
      if (restKind) {
        socket.close();
        setRested(restKind);
        restedNow.current = true;
      }
      handlers.onClose?.({ rested: restKind !== null, openedBefore: openedOnce.current });
    },
    onMessage(event: MessageEvent) {
      lastHeard.current = Date.now();
      const read = readRoomMessage(event.data as string, epoch.current);
      if (!read) return;
      if (read.reset) setReset(true);
      epoch.current = read.epoch;
      handlers.onMessage(read.msg);
    },
  });

  // The server-restart notice is news, not a state: the new game is already showing (the frame that set it came in).
  useEffect(() => {
    if (!reset) return;
    const id = setTimeout(() => setReset(false), RESET_NOTICE_MS);
    return () => clearTimeout(id);
  }, [reset]);

  // A phone back from the lock screen or onto another access point may hold a socket that is dead without a close
  // event (iOS Safari). Reconnect at once instead of waiting out partysocket's backoff, as a `resume`.
  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : 0;
    const wake = (e: Event) => {
      if (document.hidden) {
        hiddenAt ||= Date.now(); // an `online` while hidden must not shorten the time away
        return;
      }
      // Back online: a socket that says open was opened on the network we lost.
      const away = e.type === "online" ? Infinity : hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (restedNow.current) return; // the room closed us on purpose: only a tap reconnects
      if (shouldWakeReconnect(socket.readyState, away)) socket.reconnect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [socket]);

  // The liveness check (LIVENESS_*). Skipped while hidden (the wake listener above covers coming back), while rested,
  // and while not OPEN (partysocket's own backoff is reconnecting then), so it cannot start a reconnect storm.
  useEffect(() => startLivenessCheck(socket, lastHeard, () => restedNow.current || document.hidden), [socket]);

  return {
    reset,
    rested,
    unreachable,
    send: (msg: ClientMessage) => socket.send(JSON.stringify(msg)),
    /** The rested and unreachable notices' button: reconnect as a person coming back, not a `resume`. */
    reconnect() {
      reconnectByHand.current = true;
      setUnreachable(false);
      setAttempt((a) => a + 1);
      socket.reconnect();
    },
  };
}
