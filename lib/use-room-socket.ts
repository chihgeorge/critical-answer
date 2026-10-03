"use client";

import { useRef, useState } from "react";
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
  const epoch = useRef<string | null>(null);
  /** Whether this page has connected before, and whether the next reconnect was asked for by a tap:
   * together they tell an automatic reconnect (`resume`) from a person coming back. */
  const openedOnce = useRef(false);
  const reconnectByHand = useRef(false);

  const socket = usePartySocket({
    host: PARTY_HOST,
    room: code,
    onOpen() {
      setRested(null);
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
      }
      handlers.onClose?.({ rested: restKind !== null, openedBefore: openedOnce.current });
    },
    onMessage(event: MessageEvent) {
      const read = readRoomMessage(event.data as string, epoch.current);
      if (!read) return;
      if (read.reset) setReset(true);
      epoch.current = read.epoch;
      handlers.onMessage(read.msg);
    },
  });

  return {
    reset,
    rested,
    send: (msg: ClientMessage) => socket.send(JSON.stringify(msg)),
    /** The rested notice's button: reconnect as a person coming back, not a `resume`. */
    reconnect() {
      reconnectByHand.current = true;
      socket.reconnect();
    },
  };
}
