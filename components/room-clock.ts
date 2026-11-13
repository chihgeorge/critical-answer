"use client";
// Clock sync with the room for timing questions (docs/designs/timing-tap.md 時間怎麼量 1): the phone and the big screen
// both ping, and both read `offset()` to turn their performance.now() into the room's Date.now().
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage } from "@/lib/protocol";
import { addSample, bestOffset, clockSample, CLOCK_BURST, CLOCK_BURST_GAP_MS, CLOCK_REFRESH_MS, type ClockSample } from "@/lib/server-clock";

export function useRoomClock(sendRef: { current: (m: ClientMessage) => void }) {
  const samples = useRef<ClockSample[]>([]);
  /** Pings in flight by their `t`: a pong for anything else is dropped. */
  const sent = useRef(new Set<number>());
  const [, setTick] = useState(0);
  const ping = useCallback(() => {
    const t = performance.now();
    if (sent.current.size > 32) sent.current.clear(); // pongs lost to a dropped socket
    sent.current.add(t);
    sendRef.current({ type: "CLOCK_PING", t });
  }, [sendRef]);
  const offset = useCallback(() => bestOffset(samples.current, performance.now()), []);
  /** A CLOCK_PONG: a new sample, and a render so a button waiting on 連線中… lights up. */
  const onPong = useCallback((t: number, server: number) => {
    if (!sent.current.delete(t)) return;
    samples.current = addSample(samples.current, clockSample(t, performance.now(), server));
    setTick((n) => n + 1);
  }, []);
  return { ping, offset, onPong };
}
export type RoomClock = ReturnType<typeof useRoomClock>;

/** While `active`: a burst of pings (again for each new `key`, and back from sleep), then one every few seconds. */
export function useClockPings(ping: () => void, active: boolean, key: string) {
  useEffect(() => {
    if (!active) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const burst = () => {
      clearTimeout(t);
      let n = 0;
      const one = () => {
        ping();
        if (++n < CLOCK_BURST) t = setTimeout(one, CLOCK_BURST_GAP_MS);
      };
      one();
    };
    burst();
    const every = setInterval(ping, CLOCK_REFRESH_MS);
    const wake = () => {
      if (document.visibilityState === "visible") burst();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(t);
      clearInterval(every);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ping, active, key]);
}
