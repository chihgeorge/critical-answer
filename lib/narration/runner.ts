// Runs one narration event: asks the provider, waits at most `holdMs`, and
// always emits exactly one line (the provider's, or the scripted fallback).
// No upgrade, no second message for the same event.

import type { NarrationEvent } from "./events";
import type { NarrationProvider } from "./scripted";

export const MAX_LINE = 40;
export const DEFAULT_HOLD_MS = 2000;

export interface TranscriptEntry {
  eventId: number;
  at: string;
  event: NarrationEvent;
  /** Team name -> score when the event happened. */
  scores?: Record<string, number>;
  line: string;
  provider: string;
  latencyMs: number;
  fallbackReason?: "timeout" | "error" | "invalid";
}

/** Non-empty, short enough for the dialogue box, and no markup. */
export function validLine(line: unknown): line is string {
  return typeof line === "string" && line.trim().length > 0 && line.trim().length <= MAX_LINE && !/[<>]/.test(line);
}

export function createRunner(opts: {
  provider: NarrationProvider;
  fallback: { line(event: NarrationEvent): string };
  holdMs?: number;
  emit(eventId: number, line: string, provider: string): void;
  record(entry: TranscriptEntry): void;
}) {
  const holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
  return {
    /** Resolves after emitting. Provider failures never reject; callers still guard emit() themselves. */
    async run(eventId: number, event: NarrationEvent, scores?: Record<string, number>): Promise<void> {
      const started = Date.now();
      let line: string | undefined;
      let reason: TranscriptEntry["fallbackReason"];
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), holdMs);
        });
        const got = await Promise.race([opts.provider.narrate(event), timeout]);
        if (got === null) reason = "timeout";
        else if (validLine(got)) line = got.trim();
        else reason = "invalid";
      } catch {
        reason = "error";
      } finally {
        clearTimeout(timer);
      }
      const provider = line === undefined ? "scripted" : opts.provider.name;
      const final = line ?? opts.fallback.line(event);
      opts.emit(eventId, final, provider);
      opts.record({
        eventId,
        at: new Date().toISOString(),
        event,
        scores,
        line: final,
        provider,
        latencyMs: Date.now() - started,
        ...(reason ? { fallbackReason: reason } : {}),
      });
    },
  };
}
