// Runs one narration event: asks the provider, waits at most `holdMs`, and
// always emits exactly one line (the provider's, or the scripted fallback).
// No upgrade, no second message for the same event.

import type { NarrationEvent } from "./events";
import type { NarrationProvider } from "./scripted";

export const MAX_LINE = 40;
export const DEFAULT_HOLD_MS = 2000;
export const DEFAULT_EPILOGUE_HOLD_MS = 15000;
export const MAX_EPILOGUE_LINE = 160;

export interface TranscriptEntry {
  eventId: number;
  at: string;
  event: NarrationEvent;
  /** Team name -> score when the event happened. */
  scores?: Record<string, number>;
  line: string;
  provider: string;
  latencyMs: number;
  /** Why the scripted line was used: a named LLM failure, or timeout / error / invalid. */
  fallbackReason?: string;
}

/** Things the host did by hand, kept in the same transcript so a playtest can be reconstructed. */
export interface DirectorEntry {
  kind: "notes" | "edit" | "breaker";
  at: string;
  text: string;
  eventId?: number;
}

export type TranscriptItem = TranscriptEntry | DirectorEntry;

/** Non-empty, short enough for the dialogue box, and no markup. */
export function validLine(line: unknown, max = MAX_LINE): line is string {
  return typeof line === "string" && line.trim().length > 0 && line.trim().length <= max && !/[<>]/.test(line);
}

export function createRunner(opts: {
  provider: NarrationProvider;
  fallback: { line(event: NarrationEvent): string };
  holdMs?: number;
  /** The epilogue is one long call after the game, so it may take longer. */
  epilogueHoldMs?: number;
  emit(eventId: number, line: string, provider: string, event: NarrationEvent): void;
  record(entry: TranscriptEntry): void;
}) {
  return {
    /** Resolves after emitting. Provider failures never reject; callers still guard emit() themselves. */
    async run(eventId: number, event: NarrationEvent, scores?: Record<string, number>): Promise<void> {
      const started = Date.now();
      const isEpilogue = event.type === "epilogue";
      const holdMs = isEpilogue ? (opts.epilogueHoldMs ?? DEFAULT_EPILOGUE_HOLD_MS) : (opts.holdMs ?? DEFAULT_HOLD_MS);
      const max = isEpilogue ? MAX_EPILOGUE_LINE : MAX_LINE;
      let line: string | undefined;
      let reason: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = new AbortController();
      try {
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), holdMs);
        });
        const got = await Promise.race([opts.provider.narrate(event, { signal: abort.signal }), timeout]);
        if (got === null) reason = "timeout";
        else if (validLine(got, max)) line = got.trim();
        else reason = "invalid";
      } catch (err) {
        reason = err instanceof Error && "reason" in err ? String((err as { reason: unknown }).reason) : "error";
      } finally {
        clearTimeout(timer);
        if (reason === "timeout") abort.abort(); // stop paying for a call nobody will read
      }
      const provider = line === undefined ? "scripted" : opts.provider.name;
      const final = line ?? opts.fallback.line(event);
      opts.emit(eventId, final, provider, event);
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
