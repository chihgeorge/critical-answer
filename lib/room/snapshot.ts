import { abilityUsesFor, isClassId, type ClassId, type GameState } from "../game-state";
import { parseBank, type Bank } from "../question-bank";
import { DEFAULT_AI_LIMIT, INTRO_PAGES, MAX_AI_LIMIT, type AiSource } from "../protocol";

/**
 * Everything a room must get back after its Durable Object restarts, as plain data.
 *
 * Not saved on purpose: connections (phones rejoin on their own), the narration transcript (only the
 * host's download), and the LLM circuit breaker. Teams are saved as offline: nobody is connected after a
 * restart until their phone says so.
 *
 * Bump SCHEMA_VERSION whenever a field changes meaning. An unreadable snapshot is discarded, never guessed at.
 */
export const SCHEMA_VERSION = 5; // questions moved to pools by difficulty, games gained optionOrder (scoring-and-score-pools.md); see the comment above.
export const SNAPSHOT_KEY = "room";
/** The room's bank, saved on its own and only when it changes, so a message's save does not rewrite it. */
export const BANK_KEY = "bank";

export interface RoomSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Clients show "game reset" when this changes, so it must survive a restart unchanged. */
  roomEpoch: string;
  game: GameState | null;
  pendingTeams: { id: string; name: string; classId?: ClassId }[];
  hostToken: string;
  /** team id -> team secret */
  teamKeys: [string, string][];
  eventSeq: number;
  /** `rev`, `done`: host edits and how many lines the big screen has read (host-narration-edit.md D14). Missing in a save from before them: 0. */
  lastNarration: { eventId: number; lines: string[]; rev?: number; done?: number } | null;
  epilogue: string | null;
  epilogueRequested: boolean;
  /** Answers earlier games in this room showed, dealt last in the next one (回到大廳). Missing in a save from before it. */
  playedQuestionIds?: string[];
  /** Always "": the director notes are gone, but a reverted server still requires the field to read the save. */
  notes: string;
  /** "" when the room has none. Missing in a save from before join passwords. */
  joinPassword: string;
  editedLines: string[];
  /** The host's queued line for the next narration (HOST_NEXT_LINE). Missing in a save from before it. */
  nextLine?: { text: string; gen: number } | null;
  /** Always false since host-owned keys: a reverted server reads this, and must not switch on its own key for a room
   * whose host paid with theirs. The host's real choice is aiWanted. */
  aiNarration: boolean;
  /** The host asked for AI narration at HOST_START. Missing in a save from before host-owned keys. */
  aiWanted?: boolean;
  /** Who pays for AI narration. The key itself is never saved: after a restart the host page sends it again. */
  aiSource?: AiSource;
  /** Paid AI calls made so far, and the most this room may make. */
  aiUsed?: number;
  aiLimit?: number;
  /** When someone last did something that changes the room, rounded down to the minute so it does not make every message a write. Null in a save from before this field existed. */
  lastActivityAt: number | null;
  /** The full bank the game is dealt from, not just question ids: editing or deleting a bank must not change a game in progress.
   * Only in a save from before BANK_KEY (or one an older Worker wrote): newer saves keep it under BANK_KEY. */
  bank?: Bank;
  /** The boss's phase card is up. Missing in a save from before boss phases. */
  phaseCard?: boolean;
  /** How-to-play page on show (1..INTRO_PAGES). Missing means no intro, as in a save from before it. */
  intro?: number;
  /** A finished game's podium: the narrator's calls (the story is `epilogue`) and when the first beat starts. */
  podium?: { lines: string[]; at: number } | null;
  /** The earliest the podium reveal may start, set when the game finished. Missing in a save from before the reveal. */
  revealFrom?: number | null;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns the snapshot if it is one we wrote and can use, otherwise null (the caller starts a fresh room). */
export function parseSnapshot(raw: unknown): RoomSnapshot | null {
  if (!isObject(raw) || raw.schemaVersion !== SCHEMA_VERSION) return null;
  try {
    const game = raw.game;
    if (game !== null && !(isObject(game) && Array.isArray(game.teams) && Array.isArray(game.turnOrder) && isString(game.phase))) return null;
    // deal() indexes both by pool: a malformed one would stick the room on ERROR instead of starting fresh.
    const fivePools = (v: unknown) => Array.isArray(v) && v.length === 5 && v.every((p) => Array.isArray(p) && p.every(isString));
    if (game !== null && !(fivePools(game.pools) && fivePools(game.usedQuestionIds))) return null;
    // Boss phases came after v5 with no backfill: a save from before them is discarded, never restored and stuck on ERROR.
    if (game !== null && !(isObject(game.boss) && Array.isArray(game.boss.phases))) return null;
    if (!isString(raw.roomEpoch) || !isString(raw.hostToken)) return null;
    // Classes came later (class-abilities.md) without a version bump: a missing class is none, missing uses are a full set.
    const classOk = (t: Record<string, unknown>) => t.classId === undefined || isClassId(t.classId);
    if (!Array.isArray(raw.pendingTeams) || !raw.pendingTeams.every((t) => isObject(t) && isString(t.id) && isString(t.name) && classOk(t))) return null;
    // A non-object team entry is left as it is, like before classes (persistence.test.ts covers a null one).
    if (game !== null && !(game.teams as unknown[]).every((t) => !isObject(t) || (classOk(t) && (t.abilityUses === undefined || Number.isInteger(t.abilityUses))))) return null;
    const withUses = game === null ? null : { ...game, teams: (game.teams as unknown[]).map((t) => (isObject(t) ? { ...t, abilityUses: t.abilityUses ?? abilityUsesFor(isClassId(t.classId) ? t.classId : undefined) } : t)) };
    if (!Array.isArray(raw.teamKeys) || !raw.teamKeys.every((p) => Array.isArray(p) && p.length === 2 && isString(p[0]) && isString(p[1]))) return null;
    if (typeof raw.eventSeq !== "number" || !Number.isInteger(raw.eventSeq) || raw.eventSeq < 0) return null;
    const n = raw.lastNarration;
    if (n !== null && !(isObject(n) && typeof n.eventId === "number" && Array.isArray(n.lines) && n.lines.length > 0 && n.lines.length <= 3 && n.lines.every(isString))) return null;
    const count = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0);
    if (n !== null && !(count(n.rev) && count(n.done) && ((n.done as number | undefined) ?? 0) <= (n.lines as string[]).length)) return null;
    if (raw.epilogue !== null && !isString(raw.epilogue)) return null;
    if (typeof raw.epilogueRequested !== "boolean" || typeof raw.aiNarration !== "boolean") return null;
    if (!Array.isArray(raw.editedLines) || !raw.editedLines.every(isString)) return null;
    const joinPassword = raw.joinPassword ?? "";
    if (!isString(joinPassword)) return null;
    if (raw.playedQuestionIds !== undefined && !(Array.isArray(raw.playedQuestionIds) && raw.playedQuestionIds.every(isString))) return null;
    const nextLine = raw.nextLine ?? null;
    if (nextLine !== null && !(isObject(nextLine) && isString(nextLine.text) && Number.isInteger(nextLine.gen))) return null;
    const at = raw.lastActivityAt ?? null;
    if (at !== null && !(typeof at === "number" && Number.isFinite(at) && at >= 0)) return null;
    const bank = raw.bank === undefined ? undefined : parseBank(raw.bank); // throws on a bank that would not load today
    if (raw.phaseCard !== undefined && typeof raw.phaseCard !== "boolean") return null;
    if (raw.intro !== undefined && !(Number.isInteger(raw.intro) && (raw.intro as number) >= 1 && (raw.intro as number) <= INTRO_PAGES)) return null;
    // Host-owned AI keys came later without a version bump: missing fields mean no AI and a fresh budget.
    const aiWanted = raw.aiWanted ?? false;
    const aiSource = raw.aiSource ?? "none";
    const aiUsed = raw.aiUsed ?? 0;
    const aiLimit = raw.aiLimit ?? DEFAULT_AI_LIMIT;
    if (typeof aiWanted !== "boolean" || !(aiSource === "none" || aiSource === "own" || aiSource === "owner")) return null;
    if (!Number.isInteger(aiUsed) || (aiUsed as number) < 0 || !Number.isInteger(aiLimit) || (aiLimit as number) < 1 || (aiLimit as number) > MAX_AI_LIMIT) return null;
    // A damaged podium only loses the reveal: the screen shows the full podium.
    const pod = raw.podium;
    const podium = isObject(pod) && Array.isArray(pod.lines) && pod.lines.every(isString) && typeof pod.at === "number" && Number.isFinite(pod.at) ? { lines: pod.lines as string[], at: pod.at } : null;
    const revealFrom = typeof raw.revealFrom === "number" && Number.isFinite(raw.revealFrom) ? raw.revealFrom : null;
    return {
      ...(raw as unknown as RoomSnapshot),
      ...(raw.podium !== undefined ? { podium } : {}),
      ...(raw.revealFrom !== undefined ? { revealFrom } : {}),
      game: withUses as GameState | null,
      joinPassword,
      nextLine: nextLine as RoomSnapshot["nextLine"],
      lastActivityAt: at,
      bank,
      aiWanted,
      aiSource,
      aiUsed: aiUsed as number,
      aiLimit: aiLimit as number,
    };
  } catch {
    return null;
  }
}

/** The bank saved under BANK_KEY if it would load today, otherwise null. */
export function parseSavedBank(raw: unknown): Bank | null {
  try {
    return parseBank(raw);
  } catch {
    return null;
  }
}
