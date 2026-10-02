"use client";

import { useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import { restKindOf, type RestKind } from "./room/close-codes";
import type { ClientMessage, ServerMessage } from "./protocol";
import { PARTY_HOST } from "./party-host";

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
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if ((msg.type === "LOBBY" || msg.type === "STATE") && msg.roomEpoch) {
        if (epoch.current && epoch.current !== msg.roomEpoch) setReset(true);
        epoch.current = msg.roomEpoch;
      }
      handlers.onMessage(msg);
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
