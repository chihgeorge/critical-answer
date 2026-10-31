// Runs one narration event: asks the provider, waits at most `holdMs`, and
// always emits a complete set of segments (mixing the provider's valid segments
// with scripted fallbacks segment-by-segment, same as before — see run()).
// No upgrade, no second message for the same event.

import type { NarrationEvent, NextTurn } from "./events";
import type { NarrationProvider } from "./scripted";

/** One narration segment. 40 was too tight for the tone the model writes; 50 fits the dialogue box in two lines. */
export const MAX_LINE = 50;
/** 2 s timed out 3 of 21 lines in a real game (answers took up to 1.9 s once every line has two parts). */
export const DEFAULT_HOLD_MS = 3000;
export const DEFAULT_EPILOGUE_HOLD_MS = 15000;
export const MAX_EPILOGUE_LINE = 160;

/** Segment count for a non-epilogue event: 3 (result + atmosphere + transition) when there's a next
 * team, 2 (result + atmosphere) when there isn't — boss-kill, or the game's last judged event. See
 * docs/designs/multi-segment-narration.md's D3. */
export function targetSegmentCount(event: NarrationEvent): number {
  if (event.type === "epilogue") return 1;
  return event.next ? 3 : 2;
}

export interface TranscriptEntry {
  eventId: number;
  at: string;
  event: NarrationEvent;
  /** Team name -> score when the event happened. */
  scores?: Record<string, number>;
  lines: string[];
  /** Same length as lines: each segment's source ("scripted", or the live provider's name). */
  sources: string[];
  /** The overall provider used — the live provider's name if segment 0 came from it, else "scripted". */
  provider: string;
  latencyMs: number;
  /** Why the live provider's attempt failed for this event as a whole: a named LLM failure, timeout, or invalid output. Unset when segment 0 succeeded. */
  fallbackReason?: string;
}

/** Things the host did by hand, kept in the same transcript so a playtest can be reconstructed. */
export interface DirectorEntry {
  kind: "notes" | "edit" | "breaker" | "next";
  at: string;
  text: string;
  eventId?: number;
}

export type TranscriptItem = TranscriptEntry | DirectorEntry;

/** Folds width variants (NFKC) and drops whitespace and punctuation, so 「能吃嗎?」 matches 能吃嗎？. */
const bare = (text: string) => text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");

/** Whether a segment contains the host's line, ignoring punctuation, spacing and full/half width. */
export function saysLine(segment: string, line: string): boolean {
  const want = bare(line);
  return want.length > 0 && bare(segment).includes(want);
}

/** Non-empty, short enough for the dialogue box, and no markup. */
export function validLine(line: unknown, max = MAX_LINE): line is string {
  return typeof line === "string" && line.trim().length > 0 && line.trim().length <= max && !/[<>]/.test(line);
}

export function createRunner(opts: {
  provider: NarrationProvider;
  fallback: { line(event: NarrationEvent): string; atmosphereLine(event: NarrationEvent): string; nextLine(next: NextTurn): string };
  holdMs?: number;
  /** The epilogue is one long call after the game, so it may take longer. */
  epilogueHoldMs?: number;
  emit(eventId: number, lines: string[], event: NarrationEvent): void;
  record(entry: TranscriptEntry): void;
}) {
  return {
    /** Resolves after emitting. Provider failures never reject; callers still guard emit() themselves. */
    async run(eventId: number, event: NarrationEvent, scores?: Record<string, number>): Promise<void> {
      const started = Date.now();
      const isEpilogue = event.type === "epilogue";
      const holdMs = isEpilogue ? (opts.epilogueHoldMs ?? DEFAULT_EPILOGUE_HOLD_MS) : (opts.holdMs ?? DEFAULT_HOLD_MS);
      const max = isEpilogue ? MAX_EPILOGUE_LINE : MAX_LINE;
      const targetCount = targetSegmentCount(event);
      let providerLines: string[] | undefined;
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
          const raw = got.split(/\n+/).map((s) => s.trim()).filter(Boolean);
          if (validLine(raw[0], max)) providerLines = raw;
          else reason = "invalid";
        }
      } catch (err) {
        reason = err instanceof Error && "reason" in err ? String((err as { reason: unknown }).reason) : "error";
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (reason === "timeout") abort.abort(); // stop paying for a call nobody will read
      }
      const providerName = opts.provider.name;
      const provider = providerLines !== undefined ? providerName : "scripted";

      // Fill each segment independently — a good segment 0 from the provider stands even if segment 1
      // came back empty or too long; that segment alone falls back to scripted. Same mix-and-match
      // spirit as the original 2-segment design (the "then" line could fall back on its own).
      const fallbackFor = (i: number): string => {
        // event.type === "epilogue" (not the isEpilogue local) narrows event's type here, so
        // .next below is safe to access on the non-epilogue branch.
        if (event.type === "epilogue" || i === 0) return opts.fallback.line(event);
        if (i === targetCount - 1 && event.next) return opts.fallback.nextLine(event.next);
        return opts.fallback.atmosphereLine(event);
      };
      const lines: string[] = [];
      const sources: string[] = [];
      for (let i = 0; i < targetCount; i++) {
        const candidate = providerLines?.[i];
        // Segment 0 already passed validLine(max) above (that's what set providerLines).
        if (candidate !== undefined && (i === 0 || validLine(candidate, max))) {
          lines.push(candidate);
          sources.push(providerName);
        } else {
          lines.push(fallbackFor(i));
          sources.push("scripted");
        }
      }

      // The host's queued line always ends up in segment 2: kept when the provider wrote it there, otherwise
      // written over whatever is there, so a paraphrase is replaced rather than shown twice (host-next-line.md D9).
      if (event.type !== "epilogue" && event.hostLine && !saysLine(lines[1], event.hostLine)) {
        lines[1] = event.hostLine;
        sources[1] = "host";
      }

      opts.emit(eventId, lines, event);
      opts.record({
        eventId,
        at: new Date().toISOString(),
        event,
        scores,
        lines,
        sources,
        provider,
        latencyMs: Date.now() - started,
        ...(reason ? { fallbackReason: reason } : {}),
      });
    },
  };
}
