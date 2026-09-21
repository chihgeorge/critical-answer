// Runs one narration event: asks the provider, waits at most `holdMs`, and
// always emits exactly one line (the provider's, or the scripted fallback).
// No upgrade, no second message for the same event.

import type { NarrationEvent, NextTurn } from "./events";
import type { NarrationProvider } from "./scripted";

/** One narration line. 40 was too tight for the tone the model writes; 50 fits the dialogue box in two lines. */
export const MAX_LINE = 50;
/** 2 s timed out 3 of 21 lines in a real game (answers took up to 1.9 s once every line has two parts). */
export const DEFAULT_HOLD_MS = 3000;
export const DEFAULT_EPILOGUE_HOLD_MS = 15000;
export const MAX_EPILOGUE_LINE = 160;

export interface TranscriptEntry {
  eventId: number;
  at: string;
  event: NarrationEvent;
  /** Team name -> score when the event happened. */
  scores?: Record<string, number>;
  line: string;
  /** The follow-up line about the team now on turn, when there is one. */
  then?: string;
  /** Who wrote `then`: the provider, or "scripted" when its line was missing or invalid. */
  thenSource?: string;
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
  fallback: { line(event: NarrationEvent): string; nextLine(next: NextTurn): string };
  holdMs?: number;
  /** The epilogue is one long call after the game, so it may take longer. */
  epilogueHoldMs?: number;
  emit(eventId: number, line: string, provider: string, event: NarrationEvent, then?: string): void;
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
      let second: string | undefined;
      let reason: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = new AbortController();
      try {
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), holdMs);
        });
        const got = await Promise.race([opts.provider.narrate(event, { signal: abort.signal }), timeout]);
        if (got === null) reason = "timeout";
        else {
          // A provider may return the result line and the follow-up on two lines.
          const [first, next] = got.split(/\n+/).map((s) => s.trim()).filter(Boolean);
          if (validLine(first, max)) {
            line = first;
            second = next;
          } else reason = "invalid";
        }
      } catch (err) {
        reason = err instanceof Error && "reason" in err ? String((err as { reason: unknown }).reason) : "error";
      } finally {
        clearTimeout(timer);
        if (reason === "timeout") abort.abort(); // stop paying for a call nobody will read
      }
      const provider = line === undefined ? "scripted" : opts.provider.name;
      const final = line ?? opts.fallback.line(event);
      // Only a turn event has someone next. The follow-up is the provider's if it is usable, else scripted.
      const next = event.type === "epilogue" ? undefined : event.next;
      let then: string | undefined;
      let thenSource: string | undefined;
      if (next) {
        if (line !== undefined && validLine(second, MAX_LINE)) {
          then = second.trim();
          thenSource = opts.provider.name;
        } else {
          then = opts.fallback.nextLine(next);
          thenSource = "scripted";
        }
      }
      opts.emit(eventId, final, provider, event, then);
      opts.record({
        eventId,
        at: new Date().toISOString(),
        event,
        scores,
        line: final,
        ...(then ? { then, thenSource } : {}),
        provider,
        latencyMs: Date.now() - started,
        ...(reason ? { fallbackReason: reason } : {}),
      });
    },
  };
}
