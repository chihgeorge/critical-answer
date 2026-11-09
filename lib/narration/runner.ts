// Runs one narration event: asks the provider, waits at most `holdMs`, and
// always emits a complete set of segments (mixing the provider's valid segments
// with scripted fallbacks segment-by-segment, same as before — see run()).
// No upgrade, no second message for the same event.

import { epilogueParts, type EpiloguePart, type NarrationEvent, type NextTurn } from "./events";
import type { NarrationProvider } from "./scripted";
import { MAX_TITLE, MAX_TITLE_REASON, parseTitle } from "../podium";

/** One narration segment. 40 was too tight for the tone the model writes; 50 fits the dialogue box in two lines. */
export const MAX_LINE = 50;
/** 2 s timed out 3 of 21 lines in a real game (answers took up to 1.9 s once every line has two parts). */
export const DEFAULT_HOLD_MS = 3000;
export const DEFAULT_EPILOGUE_HOLD_MS = 15000;
export const MAX_EPILOGUE_LINE = 160;
/** A place call, read in one podium beat (podium-reveal.md D9). */
export const MAX_CALL_LINE = 20;
/** The longest raw AI title line 「稱號｜理由」 (podium-titles.md R2-4): a story must be longer. */
export const MAX_TITLE_LINE = MAX_TITLE + 1 + MAX_TITLE_REASON;
/** Words that place a team or hint at its score: a title is read before every place, so it says none (eng E1). */
export const RANK_WORDS = /冠軍|[亞季]軍|榜首|奪冠|第.{1,2}名|第[一二三1-3]|[金銀銅]牌|頭號|No\.?\s*1|墊底|倒數|最後一|吊車尾|殿後|上台|頒獎|名次|前三|領先|落後|最飽|飽足|分數|最高分|贏|輸/i;

/**
 * An AI epilogue segment fits its part: a title splits into 稱號｜理由 and says no place and no other team; a call is
 * short, names its team and no team called after it (a higher place, which would spoil the reveal); the story is
 * longer than any title. Only a title holds a ｜, so a line out of step never passes as another part. `parts` is the
 * whole reveal, in epilogueParts order.
 */
export function fitsPart(parts: EpiloguePart[], i: number, line: string): boolean {
  const part = parts[i];
  if (part.kind === "title") {
    const t = parseTitle(line);
    return !!t && validLine(line, MAX_EPILOGUE_LINE) && !RANK_WORDS.test(t.title + t.reason) && !part.others.some((n) => saysLine(line, n));
  }
  if (/[｜|]/.test(line)) return false;
  // With titles or calls before it, a title-length story is one of them out of place.
  if (part.kind === "story") return validLine(line, MAX_EPILOGUE_LINE) && (parts.length === 1 || line.trim().length > MAX_TITLE_LINE);
  const later = parts.slice(i + 1).flatMap((p) => (p.kind === "place" && p.team !== part.team ? [p.team] : []));
  return validLine(line, MAX_CALL_LINE) && saysLine(line, part.team) && !later.some((n) => saysLine(line, n));
}

/**
 * An AI epilogue's lines lined up with its parts. Extra lines are a story written over several lines, joined, when the
 * calls before them all fit. Otherwise the calls are out of step and are scripted: with too few lines the last one may
 * be the whole story and is kept; with too many (a header line) it may be a fragment, so the story is scripted too.
 */
function epilogueCandidates(parts: EpiloguePart[], raw: string[]): (string | undefined)[] {
  const n = parts.length;
  if (raw.length === n) return raw;
  const calls = raw.slice(0, n - 1);
  if (raw.length > n && calls.every((line, i) => fitsPart(parts, i, line))) return [...calls, raw.slice(n - 1).join("")];
  return [...Array<undefined>(n - 1), raw.length < n ? raw.at(-1) : undefined];
}

/** Segment count for a non-epilogue event: 3 (result + atmosphere + transition) when there's a next
 * team, 2 (result + atmosphere) when there isn't — boss-kill, or the game's last judged event. See
 * docs/designs/multi-segment-narration.md's D3. */
export function targetSegmentCount(event: NarrationEvent): number {
  if (event.type === "epilogue") return epilogueParts(event).length;
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
  kind: "edit" | "breaker" | "next";
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
  fallback: {
    line(event: NarrationEvent): string;
    atmosphereLine(event: NarrationEvent): string;
    nextLine(next: NextTurn): string;
    epilogueLines(event: NarrationEvent): string[];
  };
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
      const parts = event.type === "epilogue" ? epilogueParts(event) : null;
      let scriptedEpilogue: string[] | undefined;
      const fallbackFor = (i: number): string => {
        // event.type === "epilogue" (not the isEpilogue local) narrows event's type here, so
        // .next below is safe to access on the non-epilogue branch.
        if (event.type === "epilogue") return (scriptedEpilogue ??= opts.fallback.epilogueLines(event))[i];
        if (i === 0) return opts.fallback.line(event);
        if (i === targetCount - 1 && event.next) return opts.fallback.nextLine(event.next);
        return opts.fallback.atmosphereLine(event);
      };
      const lines: string[] = [];
      const sources: string[] = [];
      const candidates = parts && providerLines ? epilogueCandidates(parts, providerLines) : providerLines;
      for (let i = 0; i < targetCount; i++) {
        const candidate = candidates?.[i];
        // Segment 0 already passed validLine(max) above (that's what set providerLines); an epilogue's every segment
        // is held to its own part.
        const fits = parts ? candidate !== undefined && fitsPart(parts, i, candidate) : i === 0 || validLine(candidate, max);
        if (candidate !== undefined && fits) {
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
