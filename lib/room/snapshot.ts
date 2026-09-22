import type { GameState } from "../game-state";
import { parseBank, type Bank } from "../question-bank";

/**
 * Everything a room must get back after its Durable Object restarts, as plain data.
 *
 * Not saved on purpose: connections (phones rejoin on their own), the narration transcript (only the
 * host's download), and the LLM circuit breaker. Teams are saved as offline: nobody is connected after a
 * restart until their phone says so.
 *
 * Bump SCHEMA_VERSION whenever a field changes meaning. An unreadable snapshot is discarded, never guessed at.
 */
export const SCHEMA_VERSION = 1;
export const SNAPSHOT_KEY = "room";

export interface RoomSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Clients show "game reset" when this changes, so it must survive a restart unchanged. */
  roomEpoch: string;
  game: GameState | null;
  pendingTeams: { id: string; name: string }[];
  hostToken: string;
  /** team id -> team secret */
  teamKeys: [string, string][];
  eventSeq: number;
  lastNarration: { eventId: number; line: string; then?: string } | null;
  epilogue: string | null;
  epilogueRequested: boolean;
  notes: string;
  editedLines: string[];
  aiNarration: boolean;
  /** When someone last did something that changes the room, rounded down to the minute so it does not make every message a write. Null in a save from before this field existed. */
  lastActivityAt: number | null;
  /** The full bank the game is dealt from, not just question ids: editing or deleting a bank must not change a game in progress. */
  bank: Bank;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns the snapshot if it is one we wrote and can use, otherwise null (the caller starts a fresh room). */
export function parseSnapshot(raw: unknown): RoomSnapshot | null {
  if (!isObject(raw) || raw.schemaVersion !== SCHEMA_VERSION) return null;
  try {
    const game = raw.game;
    if (game !== null && !(isObject(game) && Array.isArray(game.teams) && Array.isArray(game.turnOrder) && isString(game.phase))) return null;
    if (!isString(raw.roomEpoch) || !isString(raw.hostToken)) return null;
    if (!Array.isArray(raw.pendingTeams) || !raw.pendingTeams.every((t) => isObject(t) && isString(t.id) && isString(t.name))) return null;
    if (!Array.isArray(raw.teamKeys) || !raw.teamKeys.every((p) => Array.isArray(p) && p.length === 2 && isString(p[0]) && isString(p[1]))) return null;
    if (typeof raw.eventSeq !== "number" || !Number.isInteger(raw.eventSeq) || raw.eventSeq < 0) return null;
    const n = raw.lastNarration;
    if (n !== null && !(isObject(n) && typeof n.eventId === "number" && isString(n.line) && (n.then === undefined || isString(n.then)))) return null;
    if (raw.epilogue !== null && !isString(raw.epilogue)) return null;
    if (typeof raw.epilogueRequested !== "boolean" || typeof raw.aiNarration !== "boolean" || !isString(raw.notes)) return null;
    if (!Array.isArray(raw.editedLines) || !raw.editedLines.every(isString)) return null;
    const at = raw.lastActivityAt ?? null;
    if (at !== null && !(typeof at === "number" && Number.isFinite(at) && at >= 0)) return null;
    const bank = parseBank(raw.bank); // throws on a bank that would not load today
    return { ...(raw as unknown as RoomSnapshot), lastActivityAt: at, bank };
  } catch {
    return null;
  }
}
