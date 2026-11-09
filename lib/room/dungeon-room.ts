import type { Conn, RoomIO } from "./io";
import { CLOSE_EXPIRED, CLOSE_IDLE } from "./close-codes";
import { BANK_KEY, parseSavedBank, parseSnapshot, SCHEMA_VERSION, SNAPSHOT_KEY, type RoomSnapshot } from "./snapshot";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  answerQuestion,
  endGame,
  enterNextBossPhase,
  buzzIn,
  isBuzzPhase,
  openBuzz,
  skipBuzz,
  sendToBoss,
  queueQuestion,
  pickBlock,
  pickableQuestionIds,
  recordOptionSelection,
  submitText,
  recordWrongLock,
  currentQuestionIdOf,
  setTeamOnline,
  getSpectatorView,
  currentTurnTeamId,
  isInBossPhase,
  rollD20,
  rollBossKillDice,
  spendAbility,
  mageEliminate,
  mageHint,
  armSneak,
  pray,
  canPray,
  recordTextWrong,
  warriorRoll,
  recordCheck,
  checkKey,
  checkTarget,
  drawEvent,
  enterEventRoom,
  eventEligible,
  openEvent,
  EVENT_CHANCE,
  InvalidActionError,
  type ClassId,
  type GameState,
  type LockedOption,
} from "../game-state";
import {
  DEFAULT_AI_LIMIT,
  HANDOFF_MS,
  INTRO_PAGES,
  MAX_EDIT_LINE,
  MAX_TEAMS,
  parseClientMessage,
  sanitizeText,
  cleanTypedAnswer,
  type AiKeyError,
  type AiProviderId,
  type AiSource,
  type AnswerReveal,
  type ClientMessage,
  type EventReveal,
  type HostPick,
  type MediaAction,
  type MediaCommand,
  type PendingRoll,
  type ServerMessage,
  type SoundCue,
  type PodiumReveal,
  FINISH_PODIUM_MS,
  SERVE_HOLD_MS,
  REACT_GAP_MS,
  REACT_JITTER_MS,
  REACT_ROOM_MAX,
  type Reaction,
} from "../protocol";
import { epiloguePages, revealBeats, revealCalls } from "../podium";
import { INITIATIVE_MS, INITIATIVE_ORDER_MS, INITIATIVE_TIE_MS, initiativeOrder, type Initiative } from "../initiative";
import { gameLog } from "../game-log";
import { nextAnswerClock, type AnswerClock } from "../answer-clock";
import { catalogMonster, gameMonsters, monsterById, MONSTERS } from "../monster-catalog";
import { UUID_RE, allQuestions, answerText, bossPhaseStates, findQuestion, inShownOrder, isAutoJudged, poolQuestionIds, publicExplanation, publicMediaContent, publicQuestion, roomTemplates, shuffledOptionOrders, sortShownOrder, type Bank } from "../question-bank";
import { SORT_ORDERS, sortSlots } from "../sort-order";
import { BANK } from "../question-bank-data";
import { tokensEqual } from "../tokens";
import { epilogueParts, titleFacts, toNarrationEvent, type NarrationEvent, type NextTurn } from "../narration/events";
import { createScriptedProvider, type NarrationProvider } from "../narration/scripted";
import { createRunner, type TranscriptItem } from "../narration/runner";
import { editedLine } from "../narration/client";
import { PROVIDERS } from "../narration/providers";
import { RECENT_LINES } from "../narration/llm";
import { keyHint, withBudget } from "./ai-budget";
import { createBreaker, withBreaker } from "../narration/breaker";

const MAX_TEAM_NAME_LENGTH = 20;
const MAX_TRANSCRIPT = 500;
/** 5 wrong claims in the room burn every live handoff code (team-handoff.md D4). */
const HANDOFF_MAX_WRONG = 5;
/** Wrong join passwords the whole room takes per window; past it every password JOIN waits for the next window, so a
 * script needs hours for a 4-digit password. Room-wide, since a script picks a fresh connection id for free. */
const JOIN_PASSWORD_MAX_WRONG = 10;
const JOIN_PASSWORD_WINDOW_MS = 60_000;
/** Long enough for a pizza break, short enough that a TV left on overnight is not billed all night. */
const IDLE_MS = 2 * 60 * 60 * 1000;
export const EXPIRE_MS = 24 * 60 * 60 * 1000;
/** Sockets per room: players, screens and the host, with room to spare. Stops one client opening thousands. */
const MAX_CONNECTIONS = 60;
/** A full room makes space by closing its oldest spare socket; this many announced screens are never spare. */
const KEPT_SCREENS = 2;
/** With no boss to cook, the podium reveal starts this long after the game ends, so the last line is read first. */
const EPILOGUE_DELAY_MS = 4000;
/** 結束冒險 while the big screen is still reading the last narration: the reveal waits for it to finish, at most this
 * long (a screen gone or stuck never reports), then starts within READ_GAP_MS of the last line. */
const END_READ_CAP_MS = 20_000;
const READ_GAP_MS = 1000;
/** The drum roll after the host reveals a lock, and the warrior's die on screen (phone-answering.md D10,
 * host-reveal.md). Every answer reveal then waits for the host's 下一題. */
const BEAT_MS = 2000;
/** The boss kill's 4d20 on screen (docs/designs/kill-roll.md): the dice land one by one, then the total stays up. */
const KILL_BEAT_MS = 4000;

/** A roll whose answer is already right (a crit die, a kill's 4d20) or must not be rerolled (a check): its team keeps
 * the turn through a dropped phone, like a locked one. */
function holdsTurn(roll: PendingRoll | null): roll is PendingRoll {
  return roll?.kind === "crit" || roll?.kind === "check" || roll?.kind === "kill";
}
/** A boss phase card that follows a miss waits for the voice (estimated at SPEECH_CHARS_PER_S), never longer than this. */
const ADVANCE_CAP_MS = 15000;
const SPEECH_CHARS_PER_S = 4;
/** How long checking a pasted key may take before the host is told it failed. */
const KEY_CHECK_MS = 5000;
const speechMs = (lines: string[]) => (lines.join("").length / SPEECH_CHARS_PER_S) * 1000 + 1000;

export interface RoomOptions {
  /** How long a narration may take before the scripted line is used. */
  holdMs?: number;
  epilogueDelayMs?: number;
  /** How long the game-over story may take from the LLM before the program-built one is used. */
  epilogueHoldMs?: number;
  /** Replace the narrator entirely (tests). Scripted is always the fallback. */
  provider?: NarrationProvider;
  /** Replace fetch for the LLM narrator (tests). */
  fetch?: typeof fetch;
  /** The question bank this room plays with. Defaults to the bundled one until banks come from a store. */
  bank?: Bank;
  /** No state-changing message for this long: close every connection (the game stays saved). Default 2 hours. */
  idleMs?: number;
  /** No state-changing message for this long: forget the room and free its code. Default 24 hours. */
  expireMs?: number;
  /** The clock (tests). */
  now?: () => number;
  /** Every d20 lands here instead of on rng (e2e, worker E2E_DIE). */
  fixedDie?: number;
  /** e2e only (worker E2E_EVENT_TEAM): the team with this exact name always walks into an event room when it may, and
   * no other team ever does, so other specs never meet one (docs/designs/event-rooms.md). */
  e2eEventTeam?: string;
  /** How long the 擲先攻 order holds before the first question (e2e, worker INITIATIVE_HOLD_MS). Default INITIATIVE_ORDER_MS. */
  initiativeHoldMs?: number;
}

/** E2E_DIE as a die face: an integer 1-20, anything else is no fixed die. */
export function fixedDie(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 && n <= 20 ? n : undefined;
}
const STYLE_EXAMPLES = 5;
/** `s` cut to `max` UTF-16 units (as sanitizeText counts), its 「…」 included, never splitting a code point. */
function capUnits(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length + 1 > max) break;
    out += ch;
  }
  return `${out}…`;
}

/** ⚔️ 最後衝刺's owl line (last-sprint.md): 14 fixed units, names capped to 10 and 14, so at most 38 of MAX_EDIT_LINE's 40. */
export function sprintLine(entering: string, blessed: string[]): string {
  return `🦉 ${capUnits(entering, 10)}進魔王房了！${capUnits(blessed.join("、"), 14)}獲得祝福！`;
}

/** Server-side only: every answer in a bank, so a narration line that repeats one is rejected. */
const allAnswers = (bank: Bank) => allQuestions(bank).map(answerText);

/**
 * Round an activity timestamp down for storage, at a granularity scaled to idleMs so the rounding error
 * a restart could introduce is always small relative to the idle window (at most idleMs/60, capped at 60s).
 */
function roundActivity(at: number, idleMs: number): number {
  const granularity = Math.max(1, Math.min(60_000, Math.floor(idleMs / 60)));
  return Math.floor(at / granularity) * granularity;
}

/** A natural 20 rolled on the turn team's current question and never judged: a restart cut off its beat (R7). Its win
 * moves the team on and drops the record, so one still there was never applied. */
function lostCritOf(g: GameState): { teamId: string; questionId: string } | null {
  if (g.phase !== "playing") return null;
  // Only the team on turn rolls, so at most one team can hold one (the turn index may point past it at an offline team).
  for (const team of g.teams) {
    if (!team || team.typedAnswer !== undefined) continue;
    const questionId = currentQuestionIdOf(g, team.id);
    if (g.checks?.[checkKey(questionId, team.id)]?.value === 20) return { teamId: team.id, questionId };
  }
  return null;
}

/** Shallow snapshot validation: a saved pendingWrong must name a team and the question it faces now, or it pins the turn forever. */
function restoredPendingWrong(g: GameState): GameState["pendingWrong"] {
  const p = g.pendingWrong;
  const team = p ? g.teams.find((t) => t?.id === p.teamId) : undefined;
  if (!p || !team) return null;
  return p.questionId === (team.inBoss ? g.boss.currentQuestionId : team.currentQuestionId) ? p : null;
}

/**
 * One game room. It knows nothing about the platform: messages come in through onMessage/onConnect/onClose
 * and go out through RoomIO.
 *
 * Persistence (RoomIO.storage): before the room says anything to anyone, `persist()` saves what it knows.
 * On Cloudflare a Durable Object holds outgoing messages until the write is confirmed and resets itself if
 * the write fails, so a player never sees a state that was not saved. `restore()` reads it back after a
 * restart. Without storage (tests, the temporary PartyKit adapter) the room is in memory only.
 */
/** A chef's share of a reveal's points, left out for every other team. */
const chefOf = (o: { chefBonus?: number }) => (o.chefBonus ? { chefBonus: o.chefBonus } : {});
/** Names a reader can't tell apart (full-width vs half-width, case) count as one team name. */
const sameTeamName = (a: string, b: string) => a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase();

export class DungeonRoom {
  game: GameState | null = null;
  private pendingTeams: { id: string; name: string; classId?: ClassId }[] = [];
  /**
   * Trust on first use: the first HOST_CLAIM sets the token, later claims must
   * match. The only protection is the 4-letter room code (23^4) plus this token.
   */
  private hostToken = "";
  // ponytail: in-memory Map. If hibernation is ever enabled it must move to conn.setState.
  private hostConns = new Map<string, Conn>();
  /** The last HOST_PICKS sent to the host pages, so an unchanged picker is not sent again. */
  private lastPicks: string | null = null;
  /** Changes whenever the room instance restarts, so clients can show "game reset". */
  private roomEpoch = crypto.randomUUID();
  /** connection id -> team id, so onClose can mark the right team offline. Only set after the connection proved the team key. */
  private connTeam = new Map<string, string>();
  /** team id -> team secret, set by the team's first JOIN (teamId is public, the key is not). */
  private teamKeys = new Map<string, string>();
  /** team id -> the live one-time code that hands it to a new phone (team-handoff.md). Memory only (D1). */
  private handoffs = new Map<string, { code: string; expiresAt: number }>();
  /** Wrong TEAM_CLAIM codes since the last burn; HANDOFF_MAX_WRONG burns every live code (D4). */
  private handoffWrong = 0;
  /** Live connections we accepted, for the per-room cap. */
  private conns = new Map<string, Conn>();
  /** Connections that sent SCREEN_HELLO, oldest first: only they may send SCREEN_* messages. */
  private screenConns = new Set<string>();
  /** Sockets the room closed or replaced: whatever they still send is ignored. */
  private gone = new WeakSet<Conn>();
  /** Wrong join passwords since passwordWindowAt (JOIN_PASSWORD_MAX_WRONG). Memory only. */
  private passwordWrong = 0;
  private passwordWindowAt = 0;

  /** Counts the start and every accepted judgment; each gets exactly one NARRATION. */
  private eventSeq = 0;
  /** `rev` counts host edits of this eventId; `done` is how many lines the big screen has read (host-narration-edit.md D14). */
  private lastNarration: { eventId: number; lines: string[]; rev: number; done: number } | null = null;
  /** The latest sound effect (an event's, or a roll's), sent with STATE (memory only: a restart just has none). */
  private cue: SoundCue | null = null;
  /** Goes up with every new cue (setCue), so the big screen plays a roll's cue, which bumps no eventId. */
  private cueSeq = 0;
  private epilogue: string | null = null;
  /** Set synchronously before anything awaits, so a re-broadcast of GAME_OVER cannot start a second epilogue. */
  private epilogueRequested = false;
  /** The podium reveal (podium-reveal.md eng D20): the narrator's calls, and when their first beat starts on the room's
   * clock. Null until the narration is in. Saved, so a restart keeps the reveal where it was. */
  private podium: { lines: string[]; titles?: string[]; at: number } | null = null;
  /** The epilogue page on the big screen, turned by the host (HOST_EPILOGUE_PAGE). */
  private epiloguePage = 0;
  /** The earliest the reveal's first beat may start, set when the game finishes: after the boss cooks, after the last
   * line is read, or at most END_READ_CAP_MS after 結束冒險, when revealAfterRead may move it up once the screen has
   * read the last narration. Saved, so a restart mid-cooking still waits for the dish. */
  private revealFrom: number | null = null;
  /** 結束冒險 came while the screen was still reading the last narration: its last line read moves revealFrom up.
   * shortcut: not saved, so a restarted room waits the whole END_READ_CAP_MS; fine for a one-off pause. */
  private revealOnRead = false;
  /** Narration for an eventId below this is stale and dropped: set by 結束冒險 (a judgment line still in flight
   * would hand the turn on over the podium) and by 回到大廳 (a late epilogue or line from the game just left).
   * Memory only, like the narration calls it guards. */
  private staleBeforeSeq: number | null = null;
  /** Answers earlier games in this room showed: the next game deals them last. */
  private playedQuestionIds: string[] = [];
  /** Teams the host removed in the lobby: an automatic reconnect (`resume`) of one is turned away, since a phone
   * asleep at the removal never heard. A fresh page load joins again. Memory only: a restart forgets it. */
  private removedTeamIds = new Set<string>();
  /** The answer on show until the host moves on (D7). In memory only: a restart simply drops it. */
  private reveal: AnswerReveal | null = null;
  /** The last buzz stopped playing music (boss-buzzer.md D5): a wrong answer or a dropped phone plays it on. Memory only, like media. */
  private buzzPaused = false;
  /** An opened event on show until 下一題 (docs/designs/event-rooms.md). Memory only, like the reveal: its effect is saved. */
  private eventReveal: EventReveal | null = null;
  /** When the host pressed 上菜 on the reveal up now (only read while `reveal.served`). */
  private servedAt = 0;
  /** The host's last ▶ ⏸ ⟲ (docs/designs/youtube-questions.md). In memory only (D6): a restart forgets it. */
  private media: MediaCommand | null = null;
  /** The boss's phase card is up (docs/designs/boss-phases.md): the next phase has started but its first
   * question waits for the host's 下一題. Saved, unlike the reveal: a restart shows the card again. */
  private phaseCard = false;
  /** A miss used up a boss phase: its card opens once the retry line has been read (D7). Memory only:
   * a restart opens the card at once. */
  private phaseCardDue = false;
  /** How-to-play page on show (1..INTRO_PAGES), or null (docs/designs/how-to-play.md). The game exists but its
   * first question, the start cue and the start narration wait for the host to leave the last page (eng D3).
   * Saved, like the phase card: a restart shows the same page (D9). */
  private intro: number | null = null;
  /** 擲先攻 (lib/initiative.ts), after the intro and before the first question, or null. Saved: a restart keeps the
   * rolls and starts the wait again. */
  private initiative: Initiative | null = null;
  private initiativeTimer: ReturnType<typeof setTimeout> | null = null;
  /** This game's HOST_START asked for 擲先攻: it follows the intro. Saved, so a restart mid-intro still rolls. */
  private initiativeOn = false;
  /** When initiativeTimer fires, for the countdown on the big screen. Memory only. */
  private initiativeEndsAt = 0;
  private phaseCardTimer: ReturnType<typeof setTimeout> | null = null;
  /** The lock being held for the beat (E2). Memory only, like the reveal: a restart drops it and the team locks again. */
  private pendingLock: LockedOption | null = null;
  /** Dice in their beat: a warrior's roll, a correct lock's crit die, a persuasion check, or the kill's 4d20 (value is
   * then the scored bonus). Memory only, like pendingLock: a restart drops it (a warrior's use stays spent; a crit team
   * locks again; a cut-off kill, with pendingKill, is lost: the team answers the final blow again, and a lost natural 20 comes back
   * through lostCrit with fresh dice). Shares lockTimer. */
  private pendingRoll: PendingRoll | null = null;
  /** 每題作答倒數 (docs/designs/answer-countdown.md): this game's seconds (0 is off), the running count, and the last
   * question whose video clip the big screen reported ended (D4). Saved with a wall-clock deadline: a restart keeps
   * the count going, and time spent down counts, as it does for the players watching. */
  private answerSeconds = 0;
  private answerClock: AnswerClock | null = null;
  /** 觀眾反應 (docs/designs/audience-reactions.md): each team's last reaction, and the room's recent ones. In memory only. */
  private reactedAt = new Map<string, number>();
  private roomReacts: number[] = [];
  private clipEnded: string | null = null;
  /** The judgment a kill's 4d20 holds back (kill-roll.md): resolveRoll makes it with the shown dice. */
  private pendingKill: { correct: boolean; fleeChoice: "flee" | "retry"; roll?: { kind: "warrior" | "crit"; value: number } } | null = null;
  /** A natural 20 whose beat a restart cut off (R7), applied by applyLostCrit. In memory only: restore() sets it. */
  private lostCrit: { teamId: string; questionId: string } | null = null;
  /** The host's last 答錯 on a fill-in, which 改判答對 undoes while the game is still `after`: any later move in the game
   * ends it, a phone going on or offline does not (setOnline). `prev` is the game before that 答錯. Memory only. */
  private undo: { prev: GameState; after: GameState; teamId: string; questionId: string } | null = null;
  /** The undo a 答錯 being judged right now will leave (withUndo), so the STATE it sends already offers it. */
  private undoPending: { prev: GameState; teamId: string; questionId: string } | null = null;
  /** True inside judge(): a lost natural 20 waits for it to finish rather than judging inside it. */
  private judging = false;
  /** The beat of a revealed lock or a roll, or a boss miss's red tile. A stale one may be left behind: whether the
   * host revealed a lock is pendingLock.revealing, never this. */
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private transcript: TranscriptItem[] = [];
  /** Asked of new teams at JOIN when not "" (HOST_SET_PASSWORD). Known teams rejoin with their key alone. */
  private joinPassword = "";
  /** The last few hand-edited lines: style examples for the LLM. */
  private editedLines: string[] = [];
  /** This room's latest AI lines that reached the screens, so the next prompt avoids them. Memory only: a restart
   * forgets them. Kept across 回到大廳 (same audience), cleared on reset (the next host of this code). */
  private recentLines: string[] = [];
  /** The host's line for the next narration's second segment (host-next-line.md). `gen` grows on every queue or
   * cancel, so a narration started before a re-queue of the same text cannot clear the new one (D7). */
  private nextLine: { text: string; gen: number } | null = null;
  private nextLineGen = 0;
  /** Scripted lines for narration `eventId` that has not landed yet (appendLine). Memory only. */
  private heldLines: { eventId: number; lines: string[] } | null = null;
  /** eventId -> the nextLine gen its narration carries, until that narration is emitted. */
  private hostLineGens = new Map<number, number>();
  /** The host's choice at HOST_START. Only effective while the room has a key and budget left. */
  private aiNarration = false;
  /** Who pays (saved), and the key itself (memory only: never saved, logged, broadcast or sent back). Each applied
   * key gets a new generation, so a late 401 from a key the host already replaced cannot drop the new one. */
  private aiSource: AiSource = "none";
  private credential: { provider: AiProviderId; apiKey: string; generation: number; keyId?: string } | null = null;
  private credentialGeneration = 0;
  private aiUsed = 0;
  private aiLimit = DEFAULT_AI_LIMIT;
  /** The key in use failed: refused mid-game, or the breaker tripped. Shown to the host until the next key is applied. */
  private aiError: AiKeyError | undefined;
  /** Why the host's last HOST_AI_KEY was refused. Every status carries it until the next HOST_AI_KEY, so a narration's status cannot wipe it. */
  private keyError: AiKeyError | undefined;
  /** The pasted key being checked now, if any: a newer HOST_AI_KEY aborts it. */
  private keyCheck: AbortController | null = null;
  private fetchImpl: typeof fetch | undefined;
  private llm: NarrationProvider;
  private breaker = createBreaker({ onTrip: (why) => this.onBreakerTrip(why) });
  private scripted: ReturnType<typeof createScriptedProvider>;
  private runner: ReturnType<typeof createRunner>;
  private epilogueDelayMs: number;
  /** The last snapshot handed to storage, so an unchanged room does not write again. */
  private lastSaved = "";
  /** The bank last handed to storage under BANK_KEY, or null when storage may not hold this one. */
  private savedBank: Bank | null = null;
  private idleMs: number;
  private expireMs: number;
  private now: () => number;
  private initialBank: Bank;
  /** Last message that changed something (not a transcript download). Null until the first one. */
  private lastActivityAt: number | null = null;
  /** The connection onMessage is currently dispatching for, and whether that dispatch sent it an ERROR: only an
   * accepted message counts as activity, so a stranger guessing keys forever cannot keep a room from resting. */
  private dispatching: Conn | null = null;
  private rejected = false;
  /** When the room's alarm is set to wake it, or null. In memory only: a restart re-sets it in restore(). */
  private alarmAt: number | null = null;
  /** True only while expire() is clearing storage: a connection or write that lands in this window is dropped,
   * not persisted, so it cannot resurrect a room whose storage is being wiped out from under it. */
  private expiring = false;
  /** The bank this room plays with, and every answer in it (server-side only, so an LLM line that repeats one is rejected). */
  private bank: Bank;
  private bankAnswers: string[];
  private fixedDie: number | undefined;
  private e2eEventTeam: string | undefined;
  private initiativeHoldMs: number;

  constructor(
    readonly room: RoomIO,
    private rng: () => number = Math.random,
    opts: RoomOptions = {},
  ) {
    this.initialBank = opts.bank ?? BANK;
    this.bank = this.initialBank;
    this.idleMs = opts.idleMs ?? IDLE_MS;
    // Below idleMs there would be no rest period: the very first idle check would expire the room outright.
    this.expireMs = Math.max(opts.expireMs ?? EXPIRE_MS, this.idleMs);
    this.now = opts.now ?? Date.now;
    this.fixedDie = opts.fixedDie;
    this.e2eEventTeam = opts.e2eEventTeam;
    this.initiativeHoldMs = opts.initiativeHoldMs ?? INITIATIVE_ORDER_MS;
    this.bankAnswers = allAnswers(this.bank);
    this.scripted = createScriptedProvider(rng);
    this.epilogueDelayMs = opts.epilogueDelayMs ?? EPILOGUE_DELAY_MS;
    this.fetchImpl = opts.fetch;
    const llmOptions = {
      getApiKey: () => this.credential?.apiKey,
      fetch: opts.fetch,
      getStyleExamples: () => this.editedLines,
      forbidden: () => this.bankAnswers,
      getRecentLines: () => this.recentLines,
    };
    const byProvider: NarrationProvider = {
      name: "llm",
      narrate: (event, o) => PROVIDERS[this.credential?.provider ?? "anthropic"].createNarrator(llmOptions).narrate(event, o),
    };
    this.llm = withBreaker(
      withBudget(byProvider, {
        canSpend: () => this.aiUsed < this.aiLimit,
        spend: () => {
          this.aiUsed++;
          this.sendAiStatus();
          return this.credential?.generation ?? -1;
        },
        isCurrent: (generation) => this.credential?.generation === generation,
        onAuthRejected: () => {
          this.credential = null;
          this.aiError = "invalid_key";
          this.keyError = undefined; // the newest error wins
          this.sendAiStatus();
        },
      }),
      this.breaker,
    );
    const active = (): NarrationProvider =>
      opts.provider ?? (this.aiNarration && this.credential && this.aiUsed < this.aiLimit ? this.llm : this.scripted);
    this.runner = createRunner({
      // Resolved per call, so the host's AI switch (set at HOST_START) takes effect immediately.
      provider: {
        get name() {
          return active().name;
        },
        narrate: (event, o) => active().narrate(event, o),
      },
      fallback: this.scripted,
      holdMs: opts.holdMs,
      epilogueHoldMs: opts.epilogueHoldMs,
      emit: (eventId, lines, event) => {
        if (this.staleBeforeSeq !== null && eventId < this.staleBeforeSeq) {
          this.hostLineGens.delete(eventId);
          // The line it carried was never said, and no narration of a finished game will say it.
          this.dropUnsaidLine();
          return;
        }
        if (event.type === "epilogue") {
          // The calls come first, the story last (epilogueParts). The first call waits for the boss to cook, or for
          // the kill-shot line to be read.
          this.epilogue = lines[lines.length - 1];
          this.epiloguePage = 0; // a new story (scripted, after a failed try) starts on its first page
          // A reveal already under way (scripted, after a failed try) keeps its clock: it never starts over.
          // The titles come before the calls (epilogueParts); both are fixed with the first emit, like the clock.
          const titles = epilogueParts(event).filter((p) => p.kind === "title").length;
          this.podium ??= { lines: lines.slice(titles, -1), titles: lines.slice(0, titles), at: Math.max(this.now(), this.revealFrom ?? this.now() + this.epilogueDelayMs) };
          this.broadcast({ type: "EPILOGUE", text: this.epilogue });
          this.broadcast(this.snapshot());
          return;
        }
        // Narrations run concurrently (a judgment never waits for the previous event's line), so an
        // older, slower LLM call can resolve after a newer one. Drop it rather than overwrite the
        // newer line on every screen and in the replay a reconnecting client gets. An eventId above
        // eventSeq is a leftover from before a reset(), which zeroes eventSeq.
        const gen = this.hostLineGens.get(eventId);
        this.hostLineGens.delete(eventId);
        const held = this.heldLines?.eventId === eventId ? this.heldLines.lines : [];
        if (held.length) this.heldLines = null;
        if (eventId > this.eventSeq || (this.lastNarration && eventId < this.lastNarration.eventId)) {
          this.dropUnsaidLine();
          return;
        }
        // Cleared before the broadcast, so the one save it triggers cannot bring the line back after a restart.
        const said = gen !== undefined && this.nextLine?.gen === gen;
        if (said) this.nextLine = null;
        // A held line goes out with its narration, unless the game ended meanwhile.
        if (this.game?.phase === "playing") lines = [...lines, ...held];
        this.lastNarration = { eventId, lines, rev: 0, done: 0 };
        this.broadcast({ type: "NARRATION", eventId, lines, rev: 0 });
        if (said) this.sendNextLineState();
      },
      record: (entry) => {
        this.addTranscript(entry);
        // Called right after emit: only a narration emit just put on the screens counts, and only its AI lines
        // (not scripted fallbacks or the host's line). The epilogue's podium calls repeat names by design.
        if (entry.event.type === "epilogue" || entry.eventId !== this.lastNarration?.eventId) return;
        const ai = entry.lines.filter((_, i) => entry.sources[i] === "llm");
        if (ai.length) this.recentLines = [...this.recentLines, ...ai].slice(-RECENT_LINES);
      },
    });
  }

  private addTranscript(item: TranscriptItem) {
    this.transcript.push(item);
    if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.shift();
  }

  /** Trips are logged apart from fallback counts: a breaker trip is an outage, not a slow line. */
  private onBreakerTrip(why: string) {
    console.warn(JSON.stringify({ narration: "breaker_open", why }));
    this.addTranscript({ kind: "breaker", at: new Date().toISOString(), text: `LLM narration switched off: ${why}` });
    // A refused key already says invalid_key (onAuthRejected dropped it); anything else is "AI stopped".
    if (this.credential) {
      this.aiError = "ai_stopped";
      this.keyError = undefined; // the newest error wins
    }
    this.sendAiStatus();
  }

  /** To one host connection, or every one. */
  private sendAiStatus(only?: Conn) {
    const msg: ServerMessage = {
      type: "HOST_AI_STATUS",
      source: this.aiSource,
      provider: this.credential?.provider ?? null,
      keyHint: this.aiSource === "own" && this.credential ? keyHint(this.credential.apiKey) : null,
      keyMissing: this.aiSource !== "none" && !this.credential,
      used: this.aiUsed,
      limit: this.aiLimit,
      exhausted: this.aiUsed >= this.aiLimit,
      ...((this.keyError ?? this.aiError) ? { error: this.keyError ?? this.aiError } : {}),
      ...(this.credential?.keyId ? { appliedKeyId: this.credential.keyId } : {}),
    };
    for (const conn of only ? [only] : this.hostConns.values()) this.sendTo(conn, msg);
  }

  private refuseKey(error: AiKeyError) {
    this.keyError = error;
    this.sendAiStatus();
  }

  private applyCredential(source: AiSource, credential: { provider: AiProviderId; apiKey: string; keyId?: string } | null) {
    this.aiSource = source;
    this.credential = credential && { ...credential, generation: ++this.credentialGeneration };
    this.aiError = undefined;
    this.keyError = undefined; // the newest outcome wins
    // Whatever tripped the breaker (a dead key, no credit) may be fixed by this key.
    if (credential) this.breaker.reset();
    this.sendAiStatus();
  }

  private handleAiKey(conn: Conn, msg: Extract<ClientMessage, { type: "HOST_AI_KEY" }>) {
    if (!this.requireHost(conn)) return;
    this.keyCheck?.abort();
    this.keyCheck = null;
    // A key the host chose (only those carry a keyId) answers the last refusal; the page's resend on reconnect does not.
    if (msg.source === "none" || msg.keyId) this.keyError = undefined;
    if (msg.source === "none") return this.applyCredential("none", null);
    if (msg.source === "owner") {
      const ownerKey = this.room.env?.OWNER_KEY;
      const serverKey = this.room.env?.ANTHROPIC_API_KEY;
      if (!ownerKey || !serverKey) return this.refuseKey("owner_unavailable");
      if (!tokensEqual(ownerKey, msg.ownerKey)) return this.refuseKey("wrong_owner_key");
      // Already in use (the page's resend on reconnect): nothing to apply, and a keyless resend keeps the page's keyId.
      if (this.aiSource === "owner" && this.credential && !this.aiError) {
        if (msg.keyId) this.credential.keyId = msg.keyId;
        return this.sendAiStatus();
      }
      return this.applyCredential("owner", { provider: "anthropic", apiKey: serverKey, keyId: msg.keyId });
    }
    const provider = PROVIDERS[msg.provider];
    if (!provider.keyFormat.test(msg.key)) return this.refuseKey("invalid_key");
    // The host page resends its key after every reconnect: the same key needs no new check, and a flaky check must not drop it.
    // After "AI stopped" the host pastes it again on purpose (credit topped up): apply it, which resets the breaker.
    if (this.aiSource === "own" && this.credential?.provider === msg.provider && this.credential.apiKey === msg.key) {
      if (this.aiError) return this.applyCredential("own", { provider: msg.provider, apiKey: msg.key, keyId: msg.keyId });
      if (msg.keyId) this.credential.keyId = msg.keyId;
      return this.sendAiStatus();
    }
    const check = new AbortController();
    this.keyCheck = check;
    void provider.checkKey(msg.key, { fetch: this.fetchImpl, signal: AbortSignal.any([check.signal, AbortSignal.timeout(KEY_CHECK_MS)]) }).then((result) => {
      // Superseded by a newer HOST_AI_KEY, or the room expired meanwhile.
      if (check.signal.aborted) return;
      this.keyCheck = null;
      // A failed check leaves the key the room already had in place.
      if (result === "ok") this.applyCredential("own", { provider: msg.provider, apiKey: msg.key, keyId: msg.keyId });
      else this.refuseKey(result === "invalid" ? "invalid_key" : "check_failed");
    });
  }

  private broadcast(msg: ServerMessage) {
    this.persist();
    this.room.broadcast(JSON.stringify(msg));
  }

  private sendTo(conn: Conn, msg: ServerMessage) {
    // A refusal carries no room state, so it need not wait for a save: serializing the whole room (bank included)
    // for every junk message is what let one socket slow a live game.
    if (msg.type !== "ERROR") this.persist();
    conn.send(JSON.stringify(msg));
    if (msg.type === "ERROR" && conn === this.dispatching) this.rejected = true;
  }

  /** What survives a restart. Teams are saved offline: after a restart nobody is connected until a phone says so. */
  private persistedState(): RoomSnapshot {
    this.syncAnswerClock();
    return {
      schemaVersion: SCHEMA_VERSION,
      roomEpoch: this.roomEpoch,
      game: this.game && { ...this.game, teams: this.game.teams.map((t) => ({ ...t, online: false })) },
      pendingTeams: this.pendingTeams,
      hostToken: this.hostToken,
      teamKeys: [...this.teamKeys],
      eventSeq: this.eventSeq,
      lastNarration: this.lastNarration,
      epilogue: this.epilogue,
      epilogueRequested: this.epilogueRequested,
      podium: this.podium,
      epiloguePage: this.epiloguePage,
      revealFrom: this.revealFrom,
      playedQuestionIds: this.playedQuestionIds,
      notes: "",
      joinPassword: this.joinPassword,
      editedLines: this.editedLines,
      nextLine: this.nextLine,
      aiNarration: false,
      aiWanted: this.aiNarration,
      aiSource: this.aiSource,
      aiUsed: this.aiUsed,
      aiLimit: this.aiLimit,
      // Rounded so a run of messages with no other state change does not force a write every time (persist()
      // skips a write when the JSON is unchanged). The granularity scales down with idleMs so a short test
      // duration (seconds) is never rounded away entirely; production's 2-hour default still rounds to the
      // minute. Capped so it never exceeds 60s even for a very long idleMs.
      lastActivityAt: this.lastActivityAt === null ? null : roundActivity(this.lastActivityAt, this.idleMs),
      phaseCard: this.phaseCard,
      ...(this.intro !== null ? { intro: this.intro } : {}),
      ...(this.initiative ? { initiative: this.initiative } : {}),
      ...(this.initiativeOn && this.opening() ? { initiativeOn: true as const } : {}),
      ...(this.answerSeconds ? { answerSeconds: this.answerSeconds, answerClock: this.answerClock, clipEnded: this.clipEnded } : {}),
    };
  }

  /**
   * Save the room, without awaiting. Called before every outgoing message: on Cloudflare the message is then
   * held until this write is durable, and a failed write resets the object instead of letting the message out.
   * A write that changes nothing is skipped.
   */
  private persist() {
    if (this.expiring) return;
    const storage = this.room.storage;
    if (!storage) return;
    const state = this.persistedState();
    const json = JSON.stringify(state);
    // The bank is not in the snapshot JSON, so a changed bank must write even when the snapshot did not change.
    if (json === this.lastSaved && this.bank === this.savedBank) return;
    this.lastSaved = json;
    const failed = (err: unknown) => {
      this.lastSaved = ""; // whatever we believed was saved, retry on the next message
      this.savedBank = null;
      console.error(JSON.stringify({ event: "persist_failed", error: String(err) }));
    };
    try {
      // The bank goes first, in the same unawaited batch as the snapshot: Durable Object storage commits the puts of one
      // turn together, so no snapshot is ever saved without its bank.
      if (this.bank !== this.savedBank) {
        this.savedBank = this.bank;
        void Promise.resolve(storage.put(BANK_KEY, this.bank)).catch(failed);
      }
      void Promise.resolve(storage.put(SNAPSHOT_KEY, state)).catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  /**
   * Read the room back after a restart. Returns what happened, for the caller's log:
   * "none" = nothing saved (a new room), "restored", or "discarded" = saved data we cannot use, so the room
   * starts fresh under a NEW roomEpoch (clients then show "game reset").
   */
  async restore(): Promise<"none" | "restored" | "discarded"> {
    const storage = this.room.storage;
    if (!storage) return "none";
    const raw = await storage.get(SNAPSHOT_KEY);
    if (raw === undefined) return "none";
    const s = parseSnapshot(raw);
    // A bank inside the snapshot wins: only a save from before BANK_KEY, or from an older Worker after a rollback, has one,
    // and then BANK_KEY is missing or older. persist() then writes it under BANK_KEY before the next snapshot.
    const stored = s && !s.bank ? parseSavedBank(await storage.get(BANK_KEY)) : null;
    const bank = s?.bank ?? stored;
    if (!s || !bank) {
      console.warn(JSON.stringify({ event: "state_discarded", reason: "unreadable" }));
      return "discarded";
    }
    this.roomEpoch = s.roomEpoch;
    this.game = s.game && { ...s.game, pendingWrong: restoredPendingWrong(s.game) };
    this.pendingTeams = s.pendingTeams;
    this.hostToken = s.hostToken;
    this.teamKeys = new Map(s.teamKeys);
    this.eventSeq = s.eventSeq;
    this.lastNarration = s.lastNarration && { ...s.lastNarration, rev: s.lastNarration.rev ?? 0, done: s.lastNarration.done ?? 0 };
    this.epilogue = s.epilogue;
    this.epilogueRequested = s.epilogueRequested;
    this.podium = s.podium ?? null;
    const pages = this.epilogue ? epiloguePages(this.epilogue).length : 1;
    this.epiloguePage = Number.isInteger(s.epiloguePage) && s.epiloguePage! >= 0 && s.epiloguePage! < pages ? s.epiloguePage! : 0; // a damaged save shows the first page
    this.revealFrom = s.revealFrom ?? null;
    this.playedQuestionIds = s.playedQuestionIds ?? [];
    this.joinPassword = s.joinPassword;
    this.editedLines = s.editedLines;
    this.nextLine = s.nextLine ?? null;
    this.nextLineGen = this.nextLine?.gen ?? 0;
    // Saved mid ending narration: that narration did not survive the restart, so the line never will be said.
    this.dropUnsaidLine();
    // The key is not saved: the host page sends it again after HOST_OK (keyMissing until then).
    this.aiNarration = s.aiWanted ?? false;
    this.aiSource = s.aiSource ?? "none";
    this.aiUsed = s.aiUsed ?? 0;
    this.aiLimit = s.aiLimit ?? DEFAULT_AI_LIMIT;
    this.bank = bank;
    this.bankAnswers = allAnswers(bank);
    this.savedBank = stored;
    this.phaseCard = s.phaseCard ?? false;
    this.intro = s.intro ?? null;
    // An initiative without a game in play (a damaged save) is dropped: its timer would start a game that is not there.
    this.initiative = this.game?.phase === "playing" ? (s.initiative ?? null) : null;
    this.initiativeOn = s.initiativeOn === true;
    this.answerSeconds = s.answerSeconds ?? 0;
    this.answerClock = s.answerClock ?? null;
    this.clipEnded = s.clipEnded ?? null;
    if (this.initiative) this.armInitiative(this.initiative.order ? (this.initiative.tieRolls?.length ?? 0) * INITIATIVE_TIE_MS + this.initiativeHoldMs : INITIATIVE_MS);
    // The answer reveal does not survive a restart, so a phase that ended under it goes straight to its card.
    if (this.game?.phase === "playing" && this.game.boss.phasePending) this.openPhaseCard(false);
    // A save from before activity was tracked counts as active now: never expire a room we cannot date.
    this.lastActivityAt = s.lastActivityAt ?? this.now();
    this.lastSaved = JSON.stringify(this.persistedState());
    const idleFor = this.now() - this.lastActivityAt;
    this.setAlarmAt(Math.max(this.now(), this.lastActivityAt + (idleFor >= this.idleMs ? this.expireMs : this.idleMs)));
    console.log(JSON.stringify({ event: "state_restored", phase: this.game?.phase ?? "lobby", eventSeq: this.eventSeq }));
    // A restart loses the beat that resolves a wrong boss lock.
    this.armBossMiss();
    try {
      this.lostCrit = this.game ? lostCritOf(this.game) : null;
    } catch {
      this.lostCrit = null; // a damaged save (a null team) restores without it
    }
    // The story that ends a finished game is written by a promise that a restart loses: ask for it again.
    if (this.game?.phase === "finished" && !this.epilogue) {
      this.epilogueRequested = true;
      void this.sendEpilogue(Promise.resolve(), this.eventSeq).catch((err) => this.epilogueFailed(err, this.eventSeq));
    }
    return "restored";
  }

  /** Hands the finished game's record to the platform, and to the logs. A failure is logged and dropped: the room never waits. */
  private logGame(game: GameState) {
    // A game nobody answered in says nothing about tuning, and skipping it stops 開始/結束 spam filling the log.
    if (game.lastTurnIndex === undefined) return;
    try {
      const log = gameLog(game, this.now());
      console.log(JSON.stringify({ event: "game_log", log }));
      void Promise.resolve(this.room.logGame?.(log)).catch((err) => console.error(JSON.stringify({ event: "game_log_failed", error: String(err) })));
    } catch (err) {
      console.error(JSON.stringify({ event: "game_log_failed", error: String(err) }));
    }
  }

  /** This game's boss (gameMonsters), or the bank's when no game drew one or a save names no catalog boss. */
  private bossId() {
    const drawn = this.game?.bossMonsterId;
    return drawn && monsterById(drawn)?.boss ? drawn : this.bank.boss.monster;
  }

  /** The boss as the stage draws it (a boss never wears a variant). */
  private bossLook() {
    const m = catalogMonster(this.bossId());
    return { id: m.id, name: m.name, sprite: m.sprite, hue: m.hue };
  }

  /** The question in play for the team on turn: what everyone may see, and the host-only answer. */
  private currentQuestion() {
    const game = this.game;
    if (!game || game.phase !== "playing") return null;
    const teamId = currentTurnTeamId(game);
    const team = game.teams.find((t) => t.id === teamId);
    // A team in an event room has no question until it walks out (event-rooms.md): its held deal stays hidden.
    if (!team || team.event) return null;
    const id = currentQuestionIdOf(game, team.id);
    // The team's own count from when it walked in, so its monster never changes mid-room (monster-catalog.md §3).
    const roomMonster = game.rooms[team.roomIndex]?.monsterId;
    const defeats = team.metDefeats === undefined || !roomMonster ? game.defeats ?? {} : { ...game.defeats, [roomMonster]: team.metDefeats };
    const pub = publicQuestion(this.bank, id, team.roomIndex, this.room.env?.R2_PUBLIC_BASE_URL ?? "", game.optionOrder[id], { seed: game.variantSeed ?? 0, defeats }, { room: roomMonster, boss: this.bossId() });
    const q = this.question(id);
    return pub ? { pub, answer: q ? answerText(q) : "" } : null;
  }

  /** The turn answering now (answer-countdown.md D3), or null: nobody is answering while an answer waits for the host,
   * a die other than a persuasion check is in its beat, or the screen shows something other than the question.
   * "hold": every phone is offline (a restart, a Wi-Fi drop), so the count is kept for whoever comes back. */
  private answering(): { key: string; questionId: string; video: boolean } | null | "hold" {
    const game = this.game;
    if (!this.answerSeconds || game?.phase !== "playing" || this.paused()) return null;
    if (this.pendingLock || game.pendingWrong || (this.pendingRoll && this.pendingRoll.kind !== "check")) return null;
    // A buzzer phase is its own race: the team that buzzed answers out loud at once, so no count runs (boss-buzzer.md).
    if (isBuzzPhase(game)) return null;
    const teamId = currentTurnTeamId(game);
    if (!teamId) return "hold";
    const pub = this.currentQuestion()?.pub;
    if (!pub || game.teams.find((t) => t.id === teamId)?.typedAnswer !== undefined) return null;
    return { key: `${teamId}:${pub.id}`, questionId: pub.id, video: pub.content.kind === "youtube" };
  }

  /** Brings the countdown up to date with the room and returns what STATE shows of it. Called whenever the room is
   * saved or sent, so it needs no hooks of its own. */
  private syncAnswerClock(): { answerClock?: { left: number | null } } {
    const want = this.answering();
    if (want === "hold") return {};
    const waiting = !!want?.video && this.clipEnded !== want.questionId;
    this.answerClock = nextAnswerClock(this.answerClock, want && !waiting ? want.key : null, this.now(), this.answerSeconds * 1000);
    if (waiting) return { answerClock: { left: null } };
    return this.answerClock ? { answerClock: { left: Math.max(0, this.answerClock.endsAt - this.now()) } } : {};
  }

  /** SCREEN_CLIP_ENDED (D4): for the question video on screen right now, even while an answer waits (a 重答 then
   * counts at once). The first report counts. */
  private handleClipEnded(questionId: string) {
    if (!this.answerSeconds || this.reveal || this.shownVideoId() !== questionId || this.clipEnded === questionId) return;
    this.clipEnded = questionId;
    this.broadcastState();
  }

  /** A bank question as this game shows it (options in the game's shuffled order). */
  private question(id: string) {
    const q = findQuestion(this.bank, id);
    return q && inShownOrder(q, this.game?.optionOrder[id]);
  }

  /** How many picks a lock on `q` may name: its options, or every order of a sort question's items. */
  private pickCount(q: ReturnType<DungeonRoom["question"]>): number {
    return q?.kind === "multipleChoice" ? q.options.length : q?.kind === "sort" ? SORT_ORDERS.length : 0;
  }

  /** Per slot, whether a sort pick put the right item there (lib/sort-order.ts). */
  private sortSlotsOf(questionId: string, code: number): boolean[] {
    return sortSlots(code, sortShownOrder(this.game?.optionOrder[questionId]));
  }

  /** A wrong sort lock waiting for its 重答 / 逃跑: which slots it got right. Never the correct order (D5). */
  private wrongSlots(): { wrongSlots?: boolean[] } {
    const wrong = this.game?.pendingWrong;
    if (!wrong || wrong.optionIndex === null || this.question(wrong.questionId)?.kind !== "sort") return {};
    return { wrongSlots: this.sortSlotsOf(wrong.questionId, wrong.optionIndex) };
  }

  /** Who is on turn now and what they face, for the narrator's second line. Null when the game is over. */
  private nextTurn(): NextTurn | null {
    const game = this.game;
    const q = this.currentQuestion();
    // A buzzer phase has no turns: nobody is up next until someone buzzes (boss-buzzer.md).
    const teamId = game && !isBuzzPhase(game) && currentTurnTeamId(game);
    const team = game?.teams.find((t) => t.id === teamId);
    if (team?.event) return { team: team.name, monster: "", boss: false, event: team.event.scene };
    return q && team ? { team: team.name, monster: q.pub.monster.name, boss: q.pub.boss } : null;
  }

  private sendAnswer(conn: Conn) {
    const q = this.currentQuestion();
    if (q) this.sendTo(conn, { type: "HOST_ANSWER", questionId: q.pub.id, answer: q.answer });
  }

  /** Host-only: the picker's questions with their answers, what each target may queue and what is queued. */
  private picksMessage(): ServerMessage | null {
    const game = this.game;
    if (!game || game.phase !== "playing") return null;
    const bankQuestions = new Map(allQuestions(this.bank).map((q) => [q.id, q]));
    const questions: HostPick[] = [...game.pools.flat(), ...game.boss.questionIds].flatMap((id) => {
      const q = bankQuestions.get(id);
      if (!q) return [];
      const label = q.content.kind === "text" ? q.content.value : q.content.kind === "image" ? "（圖片題）" : "（YouTube 題）";
      const block = pickBlock(game, id);
      return [{ id, label, answer: answerText(q), ...(block ? { block } : {}) }];
    });
    const targets = [...game.teams.filter((t) => !t.inBoss).map((t) => t.id), "boss"];
    const options = Object.fromEntries(targets.map((t) => [t, pickableQuestionIds(game, t)]));
    const queued: Record<string, string> = {};
    for (const t of game.teams) if (t.queuedQuestionId) queued[t.id] = t.queuedQuestionId;
    if (game.boss.queuedQuestionId) queued.boss = game.boss.queuedQuestionId;
    // Host-only, like the answers: the players never learn how many phases are left (boss-phases.md D4).
    const bossPhases = this.bank.boss.phases.map(({ name, rule, maxHp }) => ({ name, rule, maxHp }));
    return { type: "HOST_PICKS", questions, options, queued, bossPhases, bossPhaseIndex: game.boss.phaseIndex };
  }

  /** The picker carries the whole bank, so the host pages get it again only when it changed (a phone's
   * option taps broadcast STATE too). `claimed` is a host that just claimed: it gets a copy even when
   * nothing changed. `lastPicks` always records what the connected hosts hold, and null when none are. */
  private sendPicks(claimed?: Conn) {
    const msg = this.hostConns.size > 0 ? this.picksMessage() : null;
    const text = msg && JSON.stringify(msg);
    const changed = text !== this.lastPicks;
    this.lastPicks = text;
    if (!msg) return;
    for (const conn of changed ? [...this.hostConns.values()] : claimed ? [claimed] : []) this.sendTo(conn, msg);
  }


  private snapshot(): ServerMessage {
    if (!this.game) {
      // A game that showed a question counts as played: the host page then leaves the intro unchecked (eng D5).
      const replay = this.playedQuestionIds.length > 0;
      return { type: "LOBBY", teams: this.pendingTeams, roomEpoch: this.roomEpoch, ...(replay ? { replay: true as const } : {}) };
    }
    const view = getSpectatorView(this.game);
    // A check is written when its die is rolled, so a restart inside the beat cannot reroll it; it shows once the beat ends.
    const rolling = this.pendingRoll?.kind === "check" ? checkKey(this.pendingRoll.questionId, this.pendingRoll.teamId) : null;
    if (rolling && view.checks) view.checks = Object.fromEntries(Object.entries(view.checks).filter(([k]) => k !== rolling));
    return {
      type: "STATE",
      view,
      phase: this.game.phase,
      winners: this.game.winners,
      roomEpoch: this.roomEpoch,
      // The card holds the new phase's first question back until the host's 下一題.
      question: this.phaseCard || this.opening() ? null : (this.currentQuestion()?.pub ?? null),
      reveal: this.reveal,
      ...(this.eventReveal ? { eventReveal: this.eventReveal } : {}),
      ...this.liveMedia(),
      // No dish: the boss's dish is served on the kill, not before (monster-cuisine.md).
      ...(this.phaseCard ? { phaseCard: { monster: this.bossLook() } } : {}),
      ...(this.phaseCardDue ? { phaseCardDue: true as const } : {}),
      ...(this.intro !== null ? { intro: { page: this.intro } } : {}),
      ...(this.initiative ? { initiative: { ...this.initiative, left: Math.max(0, this.initiativeEndsAt - this.now()) } } : {}),
      ...this.syncAnswerClock(),
      ...this.bossPhaseInfo(),
      cuisine: true as const,
      pendingLock: this.pendingLock,
      pendingRoll: this.pendingRoll,
      ...this.wrongSlots(),
      ...this.podiumView(),
      ...(this.epilogue ? { epiloguePage: { page: this.epiloguePage, of: epiloguePages(this.epilogue).length } } : {}),
      eventId: this.eventSeq,
      ...this.undoWrong(),
      ...(this.cue ? { cue: this.cue } : {}),
      cueSeq: this.cueSeq,
    };
  }

  /** The 答錯 改判答對 may undo now: the one being judged, or the last one while nothing has moved since. */
  private undoWrong(): { undoWrong?: { teamId: string; questionId: string } } {
    const undo = this.undoPending ? (this.undoHeld() ? null : this.undoPending) : this.undoOpen(this.undo) ? this.undo : null;
    return undo ? { undoWrong: { teamId: undo.teamId, questionId: undo.questionId } } : {};
  }

  /** The reveal on the room's clock (eng D20). Only for a game ranked by finishGame: an older one shows the podium. */
  private podiumView(): { podium?: PodiumReveal } {
    const game = this.game;
    if (game?.phase !== "finished" || !game.ranking) return {};
    // No calls but the story is in: a damaged save lost them, so show the podium rather than wait for nothing.
    if (!this.podium) return this.epilogue ? {} : { podium: { ranking: game.ranking, beats: null, elapsedMs: 0 } };
    const beats = revealBeats(game.teams, game.ranking, game.tieRolls ?? [], this.podium.lines, this.podium.titles);
    return { podium: { ranking: game.ranking, beats, elapsedMs: this.now() - this.podium.at } };
  }

  private scores(): Record<string, number> {
    return Object.fromEntries((this.game?.teams ?? []).map((t) => [t.name, t.reward]));
  }

  /** Fire-and-forget: narration must never block or break the game. */
  private narrate(eventId: number, event: NarrationEvent): Promise<void> {
    // One narration in flight carries the line at a time, so two quick judgments cannot both say it.
    if (this.nextLine && event.type !== "epilogue" && !this.lineInFlight()) {
      const text = this.nextLine.text;
      // A line holding a bank answer would make llm.ts reject the whole AI reply: it goes in word for word instead.
      const verbatim = this.bankAnswers.some((a) => a.length >= 3 && text.includes(a));
      event = { ...event, hostLine: text, ...(verbatim ? { hostLineVerbatim: true as const } : {}) };
      this.hostLineGens.set(eventId, this.nextLine.gen);
    }
    // The game-ending judgment narrates after its broadcastState(), so the line is dropped here, once that narration has it.
    this.dropUnsaidLine();
    return this.runner.run(eventId, event, this.scores()).catch((err) => {
      console.error("narration failed", err);
      this.hostLineGens.delete(eventId);
      this.dropUnsaidLine();
    });
  }

  /** A dish name holding a bank answer would make llm.ts reject the whole AI reply (monster-cuisine.md R1, R3). */
  private sayable(dish: string): boolean {
    return !this.bankAnswers.some((a) => a.length >= 3 && dish.includes(a));
  }

  /** The epilogue threw before its lines came in: the reveal runs on scripted calls rather than wait for nothing. A
   * failure from a game already left (回到大廳) is dropped, like its lines would be. */
  private epilogueFailed(err: unknown, eventId: number) {
    console.error("epilogue failed", err);
    if (this.game?.phase !== "finished" || this.podium || (this.staleBeforeSeq !== null && eventId < this.staleBeforeSeq)) return;
    this.podium = { lines: [], at: Math.max(this.now(), this.revealFrom ?? this.now()) };
    try {
      this.broadcast(this.snapshot());
    } catch (e) {
      console.error("epilogue fallback failed", e); // the snapshot hit the same fault: the next STATE tries again
    }
  }

  private async sendEpilogue(afterKillShot: Promise<void>, eventId: number) {
    const game = this.game;
    if (!game) return;
    await afterKillShot;
    // Best first, ties broken by the d20 (finishGame); a game finished before that by reward.
    const order = game.ranking ?? [...game.teams].sort((a, b) => b.reward - a.reward).map((t) => t.id);
    const ranking = order.flatMap((id) => {
      const t = game.teams.find((x) => x.id === id);
      if (!t) return [];
      const dishes = (t.dishes ?? []).filter((d) => this.sayable(d));
      return [{ name: t.name, score: t.reward, ...(dishes.length ? { dishes } : {}) }];
    });
    const winners = game.winners.map((id) => game.teams.find((t) => t.id === id)?.name ?? "");
    // The host ended it early (結束冒險): the story must not have anyone slay the boss.
    const bossStanding = game.boss.killedByTeamId === null;
    const { titles, calls } = revealCalls(game.teams, order);
    const podium = game.ranking ? { calls, ...(titles.length ? { titles: titles.map((t) => ({ team: t.name, facts: titleFacts(t) })) } : {}) } : {};
    // One EPILOGUE, whoever writes it: the LLM within its hold, otherwise the program-built story. It carries the
    // podium calls before the story (eng D21).
    await this.runner.run(eventId, { type: "epilogue", ranking, winners, ...(bossStanding ? { bossStanding: true as const } : {}), ...podium }, this.scores());
  }

  private broadcastState() {
    if (this.lostCrit && this.applyLostCrit()) return;
    this.broadcast(this.snapshot());
    // The answer goes only to connections that hold the host token, never to broadcast.
    for (const conn of this.hostConns.values()) this.sendAnswer(conn);
    this.sendPicks();
    if (this.game?.phase === "finished") {
      this.broadcast({ type: "GAME_OVER", winners: this.game.winners });
    }
  }

  private markActivity() {
    const now = this.now();
    this.lastActivityAt = now;
    const due = now + this.idleMs;
    // Only move the alarm earlier: while people are active the alarm already waiting is sooner than `due`.
    // Fire-and-forget is safe here: onMessage always sends or broadcasts something right after this call, in the
    // same synchronous turn, and Cloudflare holds that outgoing message until this write is durable.
    if (this.alarmAt === null || this.alarmAt > due) void this.setAlarmAt(due);
  }

  /**
   * Returns the underlying write so callers with no following send/broadcast to anchor an output gate to — namely
   * onAlarm, whose own completion is what tells the platform this alarm was handled — can await it: otherwise the
   * Durable Object could be considered "done" and evicted before the rescheduled alarm actually lands, silently
   * losing it (see e.g. a5a7f Claude adversarial review, 2026-09-21).
   */
  private async setAlarmAt(at: number): Promise<void> {
    this.alarmAt = at;
    try {
      await this.room.storage?.setAlarm?.(at);
    } catch (err) {
      console.error(JSON.stringify({ event: "alarm_failed", error: String(err) }));
    }
  }

  /**
   * The room's alarm. Idle for `idleMs`: close every connection, keep the game. Idle for `expireMs`: forget the
   * room, so its code can be used again. Anything in between just sets the alarm for the next check.
   */
  async onAlarm() {
    this.alarmAt = null;
    const last = this.lastActivityAt;
    if (last === null) return;
    const idleFor = this.now() - last;
    if (idleFor >= this.expireMs) {
      await this.expire();
    } else if (idleFor >= this.idleMs) {
      this.room.closeAll?.(CLOSE_IDLE, "idle");
      console.log(JSON.stringify({ event: "room_idle_closed", idleMs: idleFor }));
      await this.setAlarmAt(last + this.expireMs);
    } else {
      await this.setAlarmAt(last + this.idleMs);
    }
  }

  private async expire() {
    // Set before any await: a connection that sneaks in between the awaits below (onConnect, or a fire-and-forget
    // persist() from one) checks this and skips writing, so it cannot resurrect the room storage.deleteAll is
    // about to clear (Claude adversarial review, 2026-09-21).
    this.expiring = true;
    // A lock beat or a phase-card timer firing during the awaits below would broadcast into a room being deleted.
    this.clearAnswerTimers();
    this.room.closeAll?.(CLOSE_EXPIRED, "expired");
    const storage = this.room.storage;
    // Storage first: if clearing it fails this throws with the room still intact, and the alarm's retry runs expire
    // again. Resetting memory first would leave the old room saved, to come back at the next restart.
    await storage?.deleteAlarm?.();
    await storage?.deleteAll?.();
    this.reset();
    this.expiring = false;
    console.log(JSON.stringify({ event: "room_expired" }));
  }

  /** Back to a room nobody has ever used, under a new epoch (a client that still has the old one shows "game reset"). */
  private reset() {
    this.lastPicks = null;
    this.game = null;
    this.undo = null;
    this.pendingTeams = [];
    this.hostToken = "";
    this.hostConns.clear();
    this.connTeam.clear();
    this.screenConns.clear();
    this.teamKeys.clear();
    this.handoffs.clear();
    this.handoffWrong = 0;
    this.conns.clear();
    this.eventSeq = 0;
    this.lastNarration = null;
    this.heldLines = null;
    this.cue = null;
    this.cueSeq = 0;
    this.epilogue = null;
    this.epilogueRequested = false;
    this.podium = null;
    this.epiloguePage = 0;
    this.revealFrom = null;
    this.revealOnRead = false;
    this.staleBeforeSeq = null;
    this.playedQuestionIds = [];
    this.removedTeamIds.clear();
    this.reveal = this.eventReveal = null;
    this.phaseCard = false;
    this.phaseCardDue = false;
    this.intro = null;
    this.clearAnswerTimers();
    this.transcript = [];
    this.joinPassword = "";
    this.editedLines = [];
    this.recentLines = [];
    this.nextLine = null;
    this.hostLineGens.clear();
    this.aiNarration = false;
    // The next host of this code must not inherit this host's key or budget.
    this.keyCheck?.abort();
    this.keyCheck = null;
    this.aiSource = "none";
    this.credential = null;
    this.aiUsed = 0;
    this.aiLimit = DEFAULT_AI_LIMIT;
    this.aiError = undefined;
    this.keyError = undefined;
    this.bank = this.initialBank;
    this.bankAnswers = allAnswers(this.bank);
    this.roomEpoch = crypto.randomUUID();
    this.lastSaved = "";
    this.savedBank = null; // expire() just cleared storage
    this.lastActivityAt = null;
    this.alarmAt = null;
  }

  onConnect(conn: Conn) {
    this.gone.delete(conn);
    if (this.expiring) {
      this.gone.add(conn);
      conn.close();
      return;
    }
    // A reconnect reuses its id (partysocket's _pk): close the old socket, so one client cannot hold many sockets
    // under one id, outside the cap below, each getting every broadcast. Its later close is ignored by onClose.
    const prev = this.conns.get(conn.id);
    if (prev && prev !== conn) {
      this.gone.add(prev);
      prev.close();
      // Host-only messages would go to the closed socket until the new one re-sends HOST_CLAIM (it does on open).
      this.hostConns.delete(conn.id);
    } else if (this.conns.size >= MAX_CONNECTIONS && !this.closeSpareConn()) {
      this.gone.add(conn);
      conn.close();
      return;
    }
    // /screen sends only device messages (SCREEN_*), so a room that only ever gets watched (never played) needs its own
    // baseline: prime the clock once so it is still eventually rested. Later screen-only reconnects (after that
    // first tick) do NOT touch this again — only an accepted message does — or leaving a TV on would postpone
    // resting forever exactly the way this whole feature exists to prevent.
    if (this.lastActivityAt === null) this.markActivity();
    this.conns.set(conn.id, conn);
    this.sendTo(conn, this.snapshot());
    if (this.lastNarration) {
      const { eventId, lines, rev } = this.lastNarration;
      this.sendTo(conn, { type: "NARRATION", eventId, lines, rev });
    }
    if (this.epilogue) this.sendTo(conn, { type: "EPILOGUE", text: this.epilogue, replay: true });
  }

  /**
   * Room full: close the oldest socket that is not a host, not one of the first KEPT_SCREENS screens, and not a team's
   * only connection — an unannounced socket, a later screen, or a team's extra one. So 60 junk sockets cannot keep the
   * host, the TV or a reconnecting phone out. Returns false when every socket is one of those.
   */
  private closeSpareConn(): boolean {
    const kept = new Set([...this.screenConns].slice(0, KEPT_SCREENS));
    const perTeam = new Map<string, number>();
    for (const t of this.connTeam.values()) perTeam.set(t, (perTeam.get(t) ?? 0) + 1);
    for (const c of this.conns.values()) {
      const team = this.connTeam.get(c.id);
      if (this.hostConns.has(c.id) || kept.has(c.id) || (team && perTeam.get(team) === 1)) continue;
      c.close();
      this.onClose(c); // the platform's own close event comes later; onClose is safe to run twice
      return true;
    }
    return false;
  }

  onClose(conn: Conn) {
    this.gone.add(conn);
    // Ids come from the client (partysocket's _pk) and survive a reconnect: an old socket's late close must not
    // unregister the new socket that already took its id (a TV that re-sent SCREEN_HELLO, a host, a phone).
    const live = this.conns.get(conn.id);
    if (live && live !== conn) return;
    this.conns.delete(conn.id);
    this.hostConns.delete(conn.id);
    this.screenConns.delete(conn.id);
    const teamId = this.connTeam.get(conn.id);
    this.connTeam.delete(conn.id);
    if (!teamId || !this.game) return;
    // The team may already have a newer connection (a reload or reconnect): then it is still online.
    if ([...this.connTeam.values()].includes(teamId)) return;
    // A team whose lock waits for 公布答案 keeps the turn, like a sent fill-in: it put the phone down after locking
    // (/review D9 = A). syncLockTeam marks it offline once the lock is gone.
    if (this.pendingLock?.teamId === teamId) return;
    // So does a correct lock's crit die: the answer is already right, a dropped phone must not lose it. And a persuasion
    // check: a team that closes its phone on a bad roll must not get a fresh one when it comes back.
    if (holdsTurn(this.pendingRoll) && this.pendingRoll.teamId === teamId) return;
    try {
      this.setOnline(teamId, false);
      this.broadcastState();
    } catch {
      // Team no longer exists in this game instance — nothing to do.
    }
  }

  /** Sent SCREEN_HELLO, and is not also a team's phone or a host page. */
  private isScreen(conn: Conn): boolean {
    return this.screenConns.has(conn.id) && !this.connTeam.has(conn.id) && !this.hostConns.has(conn.id);
  }

  private isHost(conn: Conn): boolean {
    return this.hostConns.has(conn.id);
  }

  /** For host-only messages: anyone else gets not_host. Use as `if (!this.requireHost(conn)) return;`. */
  private requireHost(conn: Conn): boolean {
    if (this.isHost(conn)) return true;
    this.sendTo(conn, { type: "ERROR", error: "not_host" });
    return false;
  }

  onMessage(message: string, sender: Conn) {
    // A socket the room closed, or one a reconnect replaced, may keep talking if its client ignores the close.
    const live = this.conns.get(sender.id);
    if (this.gone.has(sender) || (live && live !== sender)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      raw = null;
    }
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.sendTo(sender, { type: "ERROR", error: "invalid_action", detail: "bad_message" });
      return;
    }

    this.dispatching = sender;
    this.rejected = false;
    try {
      switch (msg.type) {
        case "HOST_CLAIM":
          this.handleHostClaim(sender, msg.token);
          break;
        case "JOIN":
          this.handleJoin(sender, msg.teamId, msg.teamKey, msg.teamName, msg.password ?? "", msg.resume === true);
          break;
        case "REJOIN":
          this.handleRejoin(sender, msg.teamId, msg.teamKey);
          break;
        case "HOST_START":
          this.handleHostStart(sender, msg.aiNarration, msg.intro, msg.initiative, msg.answerSeconds);
          break;
        case "HOST_INTRO":
          this.handleHostIntro(sender, msg.page);
          break;
        case "HOST_AI_KEY":
          this.handleAiKey(sender, msg);
          break;
        case "HOST_AI_LIMIT":
          if (!this.requireHost(sender)) break;
          this.aiLimit = msg.limit;
          this.sendAiStatus();
          break;
        case "HOST_SET_PASSWORD":
          if (!this.requireHost(sender)) break;
          this.joinPassword = msg.password.trim();
          // A new password makes earlier guesses worthless: the host can lift a guessing lock this way.
          this.passwordWrong = 0;
          // Every host page shows the room's real password only once the room has it.
          for (const conn of this.hostConns.values()) this.sendTo(conn, { type: "HOST_OK", joinPassword: this.joinPassword });
          break;
        case "HOST_EDIT_NARRATION":
          this.handleEditNarration(sender, msg.eventId, msg.rev, msg.index, msg.line);
          break;
        case "SCREEN_HELLO":
          if (this.conns.has(sender.id)) this.screenConns.add(sender.id);
          break;
        case "SCREEN_NARRATION_PROGRESS":
          // Only from a /screen page: a player cannot lock the host's edits from their own phone (D3), nor from a
          // second socket that never joined a team.
          if (!this.isScreen(sender)) break;
          this.handleNarrationProgress(msg.eventId, msg.rev, msg.done);
          break;
        case "SCREEN_CLIP_ENDED":
          if (!this.isScreen(sender)) break;
          this.handleClipEnded(msg.questionId);
          break;
        case "HOST_NEXT_LINE":
          this.handleNextLine(sender, msg.line);
          break;
        case "HOST_GET_TRANSCRIPT":
          this.handleTranscript(sender);
          break;
        case "HOST_NEXT":
          this.handleHostNext(sender, msg.eventId);
          break;
        case "HOST_SERVE":
          this.handleHostServe(sender, msg.eventId);
          break;
        case "HOST_SEND_TO_BOSS":
          this.handleSendToBoss(sender, msg.teamId);
          break;
        case "HOST_OPEN_EVENT":
          if (this.requireHost(sender)) this.handleOpenEvent(sender, msg.teamId, msg.eventId);
          break;
        case "TEAM_OPEN_EVENT": {
          const teamId = this.playingTeam(sender);
          if (teamId) this.handleOpenEvent(sender, teamId, msg.eventId);
          break;
        }
        case "HOST_QUEUE_QUESTION":
          this.handleQueueQuestion(sender, msg.target, msg.questionId);
          break;
        case "HOST_END_GAME":
          this.handleEndGame(sender);
          break;
        case "HOST_BACK_TO_LOBBY":
          this.handleBackToLobby(sender);
          break;
        case "HOST_EPILOGUE_PAGE":
          this.handleEpiloguePage(sender, msg.page);
          break;
        case "HOST_REMOVE_TEAM":
          this.handleRemoveTeam(sender, msg.teamId);
          break;
        case "HOST_RENAME_TEAM":
          this.handleRenameTeam(sender, msg.teamId, msg.teamName);
          break;
        case "HOST_HANDOFF":
          this.handleHandoff(sender, msg.teamId);
          break;
        case "HOST_REVEAL":
          this.handleHostReveal(sender, msg.teamId, msg.questionId);
          break;
        case "HOST_MEDIA":
          this.handleHostMedia(sender, msg.questionId, msg.action);
          break;
        case "TEAM_CLAIM":
          this.handleClaim(sender, msg.code);
          break;
        case "HOST_JUDGE":
          this.handleHostJudge(sender, msg.teamId, msg.questionId, msg.correct, msg.fleeChoice, msg.eventId);
          break;
        case "HOST_UNDO_WRONG":
          this.handleHostUndoWrong(sender, msg.teamId, msg.questionId, msg.eventId);
          break;
        case "TEAM_SELECT_OPTION":
          this.handleTeamSelectOption(sender, msg.questionId, msg.optionIndex);
          break;
        case "TEAM_LOCK_OPTION":
          this.handleTeamLockOption(sender, msg.questionId, msg.optionIndex);
          break;
        case "TEAM_WRONG_CHOICE":
          this.handleTeamWrongChoice(sender, msg.questionId, msg.choice);
          break;
        case "TEAM_PICK_CLASS":
          this.handleTeamPickClass(sender, msg.classId);
          break;
        case "TEAM_USE_ABILITY":
          this.handleTeamUseAbility(sender, msg.questionId);
          break;
        case "TEAM_ROLL_CHECK":
          this.handleTeamRollCheck(sender, msg.questionId, msg.eventId);
          break;
        case "TEAM_ROLL_INITIATIVE":
          this.handleTeamRollInitiative(sender);
          break;
        case "HOST_ROLL_INITIATIVE":
          this.handleHostRollInitiative(sender);
          break;
        case "TEAM_SUBMIT_TEXT":
          this.handleTeamSubmitText(sender, msg.questionId, msg.text, msg.eventId);
          break;
        case "TEAM_BUZZ":
          this.handleTeamBuzz(sender, msg.questionId);
          break;
        case "HOST_BUZZ_SKIP":
          this.handleHostBuzzSkip(sender, msg.questionId);
          break;
        case "REACT":
          this.handleReact(sender, msg.reaction);
          break;
      }
      // A transcript download changes nothing; a rejected message did not either; and an automatic
      // reconnect's re-identification (`resume`) is a device, not a person.
      const resumed = "resume" in msg && msg.resume === true;
      // A big screen's reading progress is a device too: a TV left on retypes the line after every reconnect.
      // A reaction changes no saved state, so it neither counts as activity nor saves.
      if (msg.type !== "HOST_GET_TRANSCRIPT" && msg.type !== "SCREEN_HELLO" && msg.type !== "REACT" && msg.type !== "SCREEN_NARRATION_PROGRESS" && msg.type !== "SCREEN_CLIP_ENDED" && !this.rejected && !resumed) {
        this.markActivity();
        // A handler above may already have saved this message's real effect (with the old activity time); flush
        // the new one too, so a restart never reads back a stale lastActivityAt for a room that was actually in use.
        this.persist();
      }
    } finally {
      // However a handler exits — including throwing — the next message must start with a clean slate, or a
      // stuck `dispatching` could misattribute an unrelated later ERROR on this connection as this message's.
      this.dispatching = null;
      this.rejected = false;
    }
  }

  private handleHostClaim(conn: Conn, token: string) {
    if (!this.hostToken) this.hostToken = token;
    if (!tokensEqual(this.hostToken, token)) {
      this.sendTo(conn, { type: "ERROR", error: "bad_token" });
      return;
    }
    this.hostConns.set(conn.id, conn);
    this.sendTo(conn, { type: "HOST_OK", joinPassword: this.joinPassword });
    this.sendTo(conn, { type: "HOST_NEXT_LINE_STATE", line: this.nextLine?.text ?? "" });
    if (this.lastNarration) this.sendTo(conn, { type: "HOST_NARRATION_PROGRESS", eventId: this.lastNarration.eventId, done: this.lastNarration.done });
    this.sendAiStatus(conn);
    this.sendAnswer(conn);
    this.sendPicks(conn);
  }

  private handleJoin(conn: Conn, teamId: string, teamKey: string, rawName: string, password: string, resume = false) {
    if (!UUID_RE.test(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
      return;
    }
    if (this.inOtherTeam(conn, teamId)) return;
    const known = this.teamKeys.get(teamId);
    if (known !== undefined) {
      // An existing team: only the client holding its key may speak for it. During a game this is a
      // reconnect or a page reload (the phone sends JOIN each time its socket opens).
      if (this.claimTeam(conn, teamId, teamKey, known)) this.broadcastState();
      return;
    }
    if (this.game) {
      this.sendTo(conn, { type: "ERROR", error: "game_already_started" });
      return;
    }
    if (this.removedTeamIds.has(teamId)) {
      if (resume) {
        this.sendTo(conn, { type: "ERROR", error: "team_removed" });
        return;
      }
      this.removedTeamIds.delete(teamId);
    }
    if (this.joinPassword) {
      const t = this.now();
      if (t - this.passwordWindowAt >= JOIN_PASSWORD_WINDOW_MS) {
        this.passwordWindowAt = t;
        this.passwordWrong = 0;
      }
      if (this.passwordWrong >= JOIN_PASSWORD_MAX_WRONG) {
        this.sendTo(conn, { type: "ERROR", error: "bad_password", detail: "too_many_attempts" });
        return;
      }
      if (!tokensEqual(this.joinPassword, password.trim())) {
        // An empty password is a phone that has not asked its team for one yet, not a guess.
        if (password.trim()) this.passwordWrong++;
        this.sendTo(conn, { type: "ERROR", error: "bad_password" });
        return;
      }
    }
    const name = sanitizeText(rawName, MAX_TEAM_NAME_LENGTH);
    // Same rule as handleRenameTeam: the epilogue and the transcript tell teams apart by name.
    if (!name || this.pendingTeams.some((t) => sameTeamName(t.name, name))) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_name", ...(name ? { detail: "duplicate_name" } : {}) });
      return;
    }
    if (this.pendingTeams.length >= MAX_TEAMS) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "room_full" });
      return;
    }

    this.teamKeys.set(teamId, teamKey);
    this.connTeam.set(conn.id, teamId);
    this.pendingTeams.push({ id: teamId, name });
    this.broadcastState();
  }

  private handleRejoin(conn: Conn, teamId: string, teamKey: string) {
    if (!UUID_RE.test(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
      return;
    }
    if (this.inOtherTeam(conn, teamId)) return;
    const known = this.teamKeys.get(teamId);
    if (known === undefined) {
      this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
      return;
    }
    if (!this.claimTeam(conn, teamId, teamKey, known)) return;
    if (this.game) this.broadcastState();
    else this.sendTo(conn, this.snapshot());
  }

  /** One team per connection: else one socket could JOIN eight fresh ids and fill the room. The same id again (a
   * resend, a reconnect) is fine. Sends the refusal itself. */
  private inOtherTeam(conn: Conn, teamId: string): boolean {
    const bound = this.connTeam.get(conn.id);
    if (bound === undefined || bound === teamId) return false;
    this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "already_in_team" });
    return true;
  }

  /** Binds `conn` to an existing team if `teamKey` matches the team's key `known`, and marks the team online. */
  private claimTeam(conn: Conn, teamId: string, teamKey: string, known: string): boolean {
    if (!tokensEqual(known, teamKey)) {
      this.sendTo(conn, { type: "ERROR", error: "bad_token" });
      return false;
    }
    this.connTeam.set(conn.id, teamId);
    if (this.game) this.setOnline(teamId, true);
    return true;
  }

  /** 結束冒險: the host ends the game now, ranked by the reward each team has (host-controls). Whatever was
   * mid-way (a lock's beat, a roll, a reveal, the boss's phase card) is dropped, and the epilogue follows as usual. */
  private handleEndGame(conn: Conn) {
    if (!this.requireHost(conn)) return;
    if (!this.game || this.game.phase === "finished") {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }
    this.clearAnswerTimers();
    this.reveal = this.eventReveal = null;
    this.phaseCard = false;
    this.phaseCardDue = false;
    this.intro = null;
    this.game = endGame(this.game, this.rng);
    this.logGame(this.game);
    // The first place call would cut off the narration still being read on the big screen (speak() cancels it).
    const n = this.lastNarration;
    this.revealOnRead = !!n && n.done < n.lines.length;
    this.revealFrom = this.now() + (this.revealOnRead ? END_READ_CAP_MS : this.epilogueDelayMs);
    const eventId = ++this.eventSeq;
    this.staleBeforeSeq = eventId;
    this.cue = null;
    this.broadcastState();
    this.dropUnsaidLine();
    this.epilogueRequested = true;
    void this.sendEpilogue(Promise.resolve(), eventId).catch((err) => this.epilogueFailed(err, eventId));
  }

  /** 回到大廳: a finished game goes back to the lobby with the same teams (names, classes, keys and connections),
   * and the room's settings. Its shown answers are dealt last next game; everything else about it is gone. */
  private handleBackToLobby(conn: Conn) {
    if (!this.requireHost(conn)) return;
    if (this.game?.phase !== "finished") {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "game_not_over" });
      return;
    }
    const all = new Set(this.bankQuestionIds());
    const played = [...new Set([...this.playedQuestionIds, ...this.game.revealedQuestionIds])].filter((id) => all.has(id));
    // Once every question has been shown, start avoiding over with just this game's.
    this.playedQuestionIds = played.length >= all.size ? [...this.game.revealedQuestionIds] : played;
    this.game = null;
    this.handoffs.clear();
    this.clearAnswerTimers();
    this.reveal = this.eventReveal = null;
    this.phaseCard = false;
    this.phaseCardDue = false;
    this.intro = null;
    this.epilogue = null;
    this.epilogueRequested = false;
    this.podium = null;
    this.epiloguePage = 0;
    this.revealFrom = null;
    this.revealOnRead = false;
    this.lastNarration = null;
    this.heldLines = null;
    this.cue = null;
    this.staleBeforeSeq = ++this.eventSeq;
    // A line queued in the game just left belongs to it, even if a narration still in flight carries it.
    if (this.nextLine) {
      this.nextLine = null;
      this.sendNextLineState();
    }
    this.broadcastState();
  }

  /** Every question the bank can deal: room pools and every boss phase. */
  private bankQuestionIds(): string[] {
    return [...poolQuestionIds(this.bank).flat(), ...bossPhaseStates(this.bank).flatMap((p) => p.questionIds)];
  }

  /** Lobby only: the host takes a team out. Its phones are told why; their page won't JOIN again by itself. */
  private handleRemoveTeam(conn: Conn, teamId: string) {
    if (!this.lobbyTeamFor(conn, teamId)) return;
    this.pendingTeams = this.pendingTeams.filter((t) => t.id !== teamId);
    this.teamKeys.delete(teamId);
    this.removedTeamIds.add(teamId);
    for (const [connId, tid] of [...this.connTeam]) {
      if (tid !== teamId) continue;
      this.connTeam.delete(connId);
      const phone = this.conns.get(connId);
      if (phone) this.sendTo(phone, { type: "ERROR", error: "team_removed" });
    }
    this.broadcastState();
  }

  /** During a game: a 4-digit one-time code, sent to this host page only, that hands `teamId` to a new phone. */
  private handleHandoff(conn: Conn, teamId: string) {
    if (!this.requireHost(conn)) return;
    if (!this.game) return void this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
    if (!this.game.teams.some((t) => t.id === teamId)) return void this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
    const live = new Set([...this.handoffs].filter(([id]) => id !== teamId).map(([, h]) => h.code));
    let n: number;
    // 14 random bits, redrawn above 9999, so every code is equally likely (a modulo would favor low codes).
    do n = crypto.getRandomValues(new Uint16Array(1))[0] & 0x3fff;
    while (n >= 10_000 || live.has(String(n).padStart(4, "0")));
    const code = String(n).padStart(4, "0");
    this.pruneHandoffs();
    this.handoffs.set(teamId, { code, expiresAt: this.now() + HANDOFF_MS });
    this.sendTo(conn, { type: "HANDOFF_CODE", teamId, code });
  }

  /** A phone types the host's code: it gets the team's id and key and JOINs with them (D2: the key is shared, not replaced). */
  private handleClaim(conn: Conn, code: string) {
    // A phone already playing for a team would leave that team marked online when its JOIN rebinds the connection.
    if (this.connTeam.has(conn.id)) return void this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "already_in_team" });
    this.pruneHandoffs();
    const hit = [...this.handoffs].find(([, h]) => h.code === code);
    const teamId = hit?.[0];
    const teamKey = teamId && this.teamKeys.get(teamId);
    if (!teamId || !teamKey) {
      // A guess while no code is live cannot hit, so it does not use up the next code's guesses.
      if (this.handoffs.size > 0 && ++this.handoffWrong >= HANDOFF_MAX_WRONG) {
        this.handoffs.clear();
        this.handoffWrong = 0;
      }
      return void this.sendTo(conn, { type: "ERROR", error: "bad_code" });
    }
    this.handoffs.delete(teamId);
    this.sendTo(conn, { type: "TEAM_CLAIMED", teamId, teamKey });
  }

  /** Drops expired codes; with none live, earlier wrong guesses no longer count against the next code. */
  private pruneHandoffs() {
    for (const [id, h] of this.handoffs) if (h.expiresAt <= this.now()) this.handoffs.delete(id);
    if (this.handoffs.size === 0) this.handoffWrong = 0;
  }

  /** Lobby only: the host renames a team, with JOIN's name check, and never to another team's name. */
  private handleRenameTeam(conn: Conn, teamId: string, rawName: string) {
    const team = this.lobbyTeamFor(conn, teamId);
    if (!team) return;
    const name = sanitizeText(rawName, MAX_TEAM_NAME_LENGTH);
    if (!name || this.pendingTeams.some((t) => t.id !== teamId && sameTeamName(t.name, name))) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_name", ...(name ? { detail: "duplicate_name" } : {}) });
      return;
    }
    team.name = name;
    this.broadcastState();
  }

  /** The host's lobby team `teamId`, or null after sending the error that says why not. */
  private lobbyTeamFor(conn: Conn, teamId: string): { id: string; name: string } | null {
    if (!this.requireHost(conn)) return null;
    if (this.game) {
      this.sendTo(conn, { type: "ERROR", error: "game_already_started" });
      return null;
    }
    const team = this.pendingTeams.find((t) => t.id === teamId);
    if (!team) this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
    return team ?? null;
  }

  private handleHostNext(conn: Conn, eventId: number) {
    if (!this.requireHost(conn)) return;
    // The reveal is always set in the same judgment that bumps eventSeq, so a HOST_NEXT for an
    // older STATE is stale — ignore it rather than close a reveal nobody has seen.
    // The intro turns pages with HOST_INTRO only.
    if (!this.paused() || this.opening() || eventId !== this.eventSeq) return;
    // A dish is served before 下一題, and the cooking plays out first (cooking I2): a double press or a stale tab can't skip it.
    if (this.reveal?.dish && (!this.reveal.served || this.now() - this.servedAt < SERVE_HOLD_MS)) return;
    if (this.reveal) return this.closeReveal();
    if (this.eventReveal) {
      this.eventReveal = null;
      return this.broadcastState();
    }
    if (this.phaseCardDue) return this.openPhaseCard();
    this.phaseCard = false;
    this.broadcastState();
  }

  /** 🍲 上菜: the screen cooks the revealed monster (monster-cuisine.md cooking R5). Once per reveal; the video stops first (I9). */
  private handleHostServe(conn: Conn, eventId: number) {
    if (!this.requireHost(conn)) return;
    const reveal = this.reveal;
    if (!reveal?.dish || reveal.served || eventId !== this.eventSeq || this.game?.phase !== "playing") return;
    this.reveal = { ...reveal, served: true };
    this.servedAt = this.now();
    if (this.media?.questionId === reveal.questionId) this.media = { ...this.media, state: "paused" };
    this.setCue("cook");
    this.broadcastState();
  }

  /** An answer reveal or the boss's phase card is up: nobody answers until the host moves on. */
  private paused(): boolean {
    return !!this.reveal || !!this.eventReveal || this.phaseCard || this.phaseCardDue || this.opening();
  }

  /** The intro or 擲先攻 is on: the game exists, but no question is dealt yet. */
  private opening(): boolean {
    return this.intro !== null || !!this.initiative;
  }

  private closeReveal() {
    this.reveal = null;
    // A hit that ended a boss phase showed its answer first; the phase card comes next (boss-phases.md).
    if (this.game?.phase === "playing" && this.game.boss.phasePending) return this.openPhaseCard();
    this.broadcastState();
  }

  /** Starts the boss's next phase and shows its card until 下一題. `announce` is false on a restart, which
   * replays no narration. */
  private openPhaseCard(announce = true) {
    const game = enterNextBossPhase(this.game!);
    this.game = game;
    this.phaseCard = true;
    this.phaseCardDue = false;
    if (this.phaseCardTimer) clearTimeout(this.phaseCardTimer);
    this.phaseCardTimer = null;
    if (!announce) return;
    const eventId = ++this.eventSeq;
    this.setCue("boss-phase");
    const phase = this.bank.boss.phases[game.boss.phaseIndex];
    this.broadcastState();
    const event: NarrationEvent = { type: "boss-phase", monster: catalogMonster(this.bossId()).name, phase: game.boss.phaseIndex + 1, name: phase.name, rule: phase.rule };
    const next = this.nextTurn();
    void this.narrate(eventId, next ? { ...event, next } : event);
  }

  /** The boss phase under way, for /screen and /play, once players know there are phases: from phase 2 on. */
  private bossPhaseInfo(): { bossPhaseInfo?: { name: string; rule: string } } {
    const i = this.game?.boss.phaseIndex ?? 0;
    const phase = i > 0 ? this.bank.boss.phases[i] : undefined;
    return phase ? { bossPhaseInfo: { name: phase.name, rule: phase.rule } } : {};
  }

  private clearAnswerTimers() {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    if (this.phaseCardTimer) clearTimeout(this.phaseCardTimer);
    this.lockTimer = this.phaseCardTimer = null;
    // The game this 擲先攻 was for has ended or gone.
    if (this.initiativeTimer) clearTimeout(this.initiativeTimer);
    this.initiativeTimer = null;
    this.initiative = null;
    // A crit die's, a check's or a kill's team was kept on turn like a locked one (onClose): it too may be offline now.
    const lockTeam = this.pendingLock?.teamId ?? (holdsTurn(this.pendingRoll) ? this.pendingRoll.teamId : undefined);
    this.pendingLock = null;
    this.pendingRoll = this.pendingKill = null;
    if (lockTeam) this.syncLockTeam(lockTeam);
  }

  /** After a lock is gone: its team, kept on turn while the lock waited (onClose), shows offline if no phone is left. */
  private syncLockTeam(teamId: string) {
    if (!this.game || [...this.connTeam.values()].includes(teamId)) return;
    try {
      this.setOnline(teamId, false);
    } catch {
      // Team no longer exists in this game instance — nothing to do.
    }
  }

  private handleTranscript(conn: Conn) {
    if (!this.requireHost(conn)) return;
    this.sendTo(conn, { type: "TRANSCRIPT", entries: this.transcript });
  }

  /** The host queues a line for the next narration; "" cancels. */
  private handleNextLine(conn: Conn, raw: string) {
    if (!this.requireHost(conn)) return;
    if (this.game?.phase === "finished") {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "game_over" });
      return;
    }
    // One line on screen and in the prompt: a raw socket could send newlines the <input> cannot.
    const text = sanitizeText(raw.replace(/\s+/g, " "), MAX_EDIT_LINE);
    // Typed text that cleans down to nothing is a mistake, not a cancel: only the 取消 button sends "" (D11).
    if (raw !== "" && !text) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "empty_line" });
      return;
    }
    this.nextLine = text ? { text, gen: ++this.nextLineGen } : null;
    this.addTranscript({ kind: "next", at: new Date().toISOString(), text });
    this.sendNextLineState();
  }

  private lineInFlight(): boolean {
    const gen = this.nextLine?.gen;
    return gen !== undefined && [...this.hostLineGens.values()].includes(gen);
  }

  /** Once the game is over no narration will come, so a line no narration in flight carries is never said (D10). */
  private dropUnsaidLine() {
    if (this.game?.phase !== "finished" || !this.nextLine || this.lineInFlight()) return;
    this.nextLine = null;
    this.sendNextLineState();
  }

  private sendNextLineState() {
    for (const conn of this.hostConns.values()) this.sendTo(conn, { type: "HOST_NEXT_LINE_STATE", line: this.nextLine?.text ?? "" });
  }

  /** Adds a scripted line after narration `eventId` (last-sprint.md E5, shared with lucky-potion.md E5): at once with
   * `rev + 1`, as a host edit goes out, or held until that narration lands. Cut to MAX_EDIT_LINE (team names are user
   * text); dropped once the game is over. */
  private appendLine(eventId: number, raw: string) {
    const line = sanitizeText(raw, MAX_EDIT_LINE);
    if (!line || this.game?.phase !== "playing") return;
    const n = this.lastNarration;
    if (n?.eventId === eventId) {
      this.lastNarration = { ...n, lines: [...n.lines, line], rev: n.rev + 1 };
      this.broadcast({ type: "NARRATION", eventId, lines: this.lastNarration.lines, rev: n.rev + 1 });
    } else if (!n || n.eventId < eventId) {
      this.heldLines = { eventId, lines: [...(this.heldLines?.eventId === eventId ? this.heldLines.lines : []), line] };
    }
  }

  /** The host rewrites line `index` of narration `eventId` (host-narration-edit.md D9). It wins over anything the LLM
   * does later for that event. A line the big screen has already read stays as it is (D3). */
  private handleEditNarration(conn: Conn, eventId: number, rev: number, index: number, raw: string) {
    if (!this.requireHost(conn)) return;
    const n = this.lastNarration;
    const refuse = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    if (!n) return refuse("no_narration");
    // The narration changed while the host typed (a new turn, or a second host device's edit): never edit the newer text.
    // eventSeq ahead: the next narration is on its way, so the big screen no longer shows this one.
    if (eventId !== n.eventId || rev !== n.rev || this.eventSeq > n.eventId) return refuse("stale_narration");
    if (index >= n.lines.length) return refuse("bad_index");
    if (index < n.done) return refuse("line_read");
    // One line in the dialogue box: a raw socket could send newlines the <input> cannot.
    const line = editedLine(raw);
    // Its own name, not HOST_NEXT_LINE's "empty_line": the host page shows this one in the narration panel's editor.
    if (!line) return refuse("empty_edit");
    const lines = n.lines.map((l, i) => (i === index ? line : l));
    this.lastNarration = { ...n, lines, rev: n.rev + 1 };
    this.editedLines = [...this.editedLines, line].slice(-STYLE_EXAMPLES);
    this.addTranscript({ kind: "edit", at: new Date().toISOString(), text: line, eventId });
    this.broadcast({ type: "NARRATION", eventId, lines, rev: n.rev + 1 });
  }

  /** The big screen read up to `done` lines. Only a report about the text on screen now, that moves forward, counts:
   * several screens make the fastest one win, and a reconnecting screen retyping from line 1 changes nothing (D14). */
  private handleNarrationProgress(eventId: number, rev: number, done: number) {
    const n = this.lastNarration;
    if (!n || eventId !== n.eventId || rev !== n.rev || done <= n.done || done > n.lines.length) return;
    this.lastNarration = { ...n, done };
    // Saved even with no host page connected (sendTo saves only when it sends), so a restart keeps read lines locked.
    this.persist();
    for (const conn of this.hostConns.values()) this.sendTo(conn, { type: "HOST_NARRATION_PROGRESS", eventId, done });
    if (this.revealOnRead && done === n.lines.length && this.game?.phase === "finished") this.revealAfterRead();
  }

  /** The screen has read the last narration out after 結束冒險: the reveal starts shortly, calls already in or not. */
  private revealAfterRead() {
    this.revealOnRead = false;
    const from = this.now() + Math.min(this.epilogueDelayMs, READ_GAP_MS);
    if (this.revealFrom !== null && from >= this.revealFrom) return;
    this.revealFrom = from;
    if (this.podium && this.podium.at > from) this.podium = { ...this.podium, at: from };
    this.broadcast(this.snapshot());
  }

  private handleHostStart(conn: Conn, aiNarration?: boolean, intro?: boolean, initiative?: boolean, answerSeconds?: number) {
    if (!this.requireHost(conn)) return;
    if (this.game) {
      this.sendTo(conn, { type: "ERROR", error: "game_already_started" });
      return;
    }
    if (this.pendingTeams.length === 0) {
      this.sendTo(conn, { type: "ERROR", error: "not_enough_teams" });
      return;
    }

    const [firstPhase, ...laterPhases] = bossPhaseStates(this.bank);
    const monsters = gameMonsters(this.bank, this.rng);
    const game = createGame(
      this.pendingTeams,
      roomTemplates(this.bank, monsters.rooms),
      poolQuestionIds(this.bank),
      firstPhase.questionIds,
      DEFAULT_GAME_CONFIG,
      firstPhase.maxHp,
      this.rng,
      this.bank.boss.hitReward,
      shuffledOptionOrders(this.bank, this.rng),
      laterPhases,
      catalogMonster(monsters.boss).dish.name,
      this.playedQuestionIds,
    );
    this.game = { ...game, startedAt: this.now(), ...(this.bank.randomMonsters ? { bossMonsterId: monsters.boss } : {}) };
    // Default on; it only takes effect while the room has a key (HOST_AI_KEY) and budget left.
    this.aiNarration = aiNarration !== false;
    this.intro = intro ? 1 : null;
    this.initiativeOn = !!initiative;
    this.answerSeconds = answerSeconds ?? 0;
    this.answerClock = null;
    this.clipEnded = null;
    if (intro) {
      this.broadcastState();
      return;
    }
    this.beginInitiative();
  }

  /** 擲先攻 (lib/initiative.ts): every phone rolls, then the order shows, then the start (announceStart). */
  private beginInitiative() {
    if (!this.initiativeOn) return this.announceStart();
    this.initiative = { rolls: {} };
    this.armInitiative(INITIATIVE_MS);
    this.broadcastState();
  }

  /** While rolling: rolls for the teams left after `ms`. Once the order is set: starts the game after `ms`. */
  private armInitiative(ms: number) {
    if (this.initiativeTimer) clearTimeout(this.initiativeTimer);
    this.initiativeEndsAt = this.now() + ms;
    this.initiativeTimer = setTimeout(() => {
      this.initiativeTimer = null;
      if (!this.initiative?.order) return this.finishInitiative();
      this.initiative = null;
      this.announceStart();
    }, ms);
  }

  /** A phone's 擲先攻 roll: once per team, while the room still waits for rolls. */
  private handleTeamRollInitiative(conn: Conn) {
    const teamId = this.playingTeam(conn);
    const ini = this.initiative;
    if (!teamId || !ini || ini.order || ini.rolls[teamId] !== undefined) return;
    this.initiative = { rolls: { ...ini.rolls, [teamId]: this.fixedDie ?? rollD20(this.rng) } };
    this.setCue("roll");
    if (!this.finishIfRolled()) this.broadcastState();
  }

  /** Every team has rolled. An offline team is not rolled for early: a phone locked during the intro gets the whole wait. */
  private finishIfRolled(): boolean {
    const ini = this.initiative;
    if (!ini || ini.order || !this.game!.teams.every((t) => ini.rolls[t.id] !== undefined)) return false;
    this.finishInitiative();
    return true;
  }

  /** 全部代擲: the host rolls for every team that has not rolled yet. */
  private handleHostRollInitiative(conn: Conn) {
    if (!this.requireHost(conn)) return;
    if (this.initiative && !this.initiative.order) this.finishInitiative();
  }

  /** Rolls for the teams left, sets the turn order (ties rerolled), and holds it on screen before the first question. */
  private finishInitiative() {
    const game = this.game!;
    const ids = game.turnOrder;
    const rolls = { ...this.initiative!.rolls };
    for (const id of ids) rolls[id] ??= this.fixedDie ?? rollD20(this.rng);
    // A fixed die (e2e) ties every team on every reroll: keep the lobby order instead.
    const { order, tieRolls } = this.fixedDie === undefined ? initiativeOrder(ids, rolls, () => rollD20(this.rng)) : { order: ids, tieRolls: [] };
    this.game = { ...game, turnOrder: order, currentTurnIndex: 0 };
    this.initiative = { rolls, order, tieRolls };
    this.armInitiative(tieRolls.length * INITIATIVE_TIE_MS + this.initiativeHoldMs);
    this.broadcastState();
  }

  /** The start's fanfare and narration: at HOST_START, or when the host leaves the intro's last page (eng D3). */
  private announceStart() {
    const eventId = ++this.eventSeq;
    this.setCue("start");
    this.broadcastState();
    const next = this.nextTurn();
    void this.narrate(eventId, { type: "start", teams: this.game!.turnOrder.flatMap((id) => this.game!.teams.find((t) => t.id === id)?.name ?? []), ...(this.initiativeOn ? { initiative: true as const } : {}), ...(next ? { next } : {}) });
  }

  /** The epilogue's pages on the big screen: the host turns them one at a time. */
  private handleEpiloguePage(conn: Conn, page: number) {
    if (!this.requireHost(conn) || !this.epilogue) return;
    // Like the intro: only one page away from the one on show, so a double tap or a second tab turns it once.
    if (Math.abs(page - this.epiloguePage) !== 1 || page >= epiloguePages(this.epilogue).length) return;
    this.epiloguePage = page;
    this.broadcastState();
  }

  /** How-to-play: one page at a time (eng D4). A page past the last one ends the intro. */
  private handleHostIntro(conn: Conn, page: number) {
    if (!this.requireHost(conn)) return;
    // Not current ±1: a double tap or a second tab already turned this page. Dropped quietly, like a stale HOST_NEXT.
    if (this.intro === null || Math.abs(page - this.intro) !== 1) return;
    if (page > INTRO_PAGES) {
      this.intro = null;
      this.beginInitiative();
      return;
    }
    this.intro = page;
    this.broadcastState();
  }

  private handleHostJudge(
    conn: Conn,
    teamId: string,
    questionId: string,
    correct: boolean,
    fleeChoice?: "flee" | "retry" | "team" | "pray",
    eventId?: number,
  ) {
    if (!this.requireHost(conn)) return;
    // Judged from an older STATE (a key pressed as the turn moved on): drop it, like a stale HOST_NEXT.
    // The STATE that made it stale is already on its way to the host.
    if (eventId !== undefined && eventId !== this.eventSeq) return;
    if (!this.game) {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }
    // D7: judging waits until the host closes the reveal — a second host device or a stale page
    // must not skip past an answer the room hasn't been shown yet. Nor may it judge a lock that is
    // still in its beat (phone-answering.md E10).
    if (this.paused() || this.pendingLock || this.pendingRoll) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: this.paused() ? "reveal_pending" : this.pendingRoll ? "roll_pending" : "lock_pending" });
      return;
    }
    if (fleeChoice === "team" || fleeChoice === "pray") return this.hostClericWrong(conn, teamId, questionId, fleeChoice);
    // A multipleChoice or sort question is judged by its lock; the host may only pick 重答 / 逃跑 for a stuck
    // team (E5), never 答對.
    if (correct && isAutoJudged(this.question(questionId))) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "auto_judged" });
      return;
    }
    try {
      const judge = () => this.judge(teamId, questionId, correct, fleeChoice ?? "retry");
      if (correct) judge();
      else this.withUndo(teamId, questionId, judge);
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }

  /** setTeamOnline, keeping an undoable 答錯 undoable: a phone dropping or coming back is not a move in the game. */
  private setOnline(teamId: string, online: boolean) {
    const holding = this.game!.buzz?.teamId === teamId;
    this.keepUndoOpen(setTeamOnline(this.game!, teamId, online));
    // The buzzing phone dropped and let go of the buzz: the music it stopped plays on for the others (codex review).
    if (holding && !online) this.resumeBuzzMusic(this.game!.boss.currentQuestionId);
  }

  /** Plays on the music a buzz stopped (handleTeamBuzz), if it still shows. */
  private resumeBuzzMusic(questionId: string) {
    if (this.buzzPaused && this.media?.questionId === questionId) this.media = { ...this.media, state: "playing", press: this.media.press + 1 };
    this.buzzPaused = false;
  }

  /** Sets the game, carrying an open undo along: for changes that are not a move (a phone dropping, an option tapped). */
  private keepUndoOpen(game: GameState) {
    if (this.undo?.after === this.game) this.undo.after = game;
    this.game = game;
  }

  /** Whether 改判答對 may undo `undo` now: nothing has moved since, and no answer, card or beat is on show. A boss phase the
   * 答錯 used up has not opened its card yet (phaseCardDue): opening it is a move, waiting is not. */
  private undoOpen(undo: { after: GameState } | null): boolean {
    return !!undo && this.game === undo.after && !this.undoHeld();
  }

  private undoHeld(): boolean {
    return !!this.reveal || this.phaseCard || this.opening() || !!this.pendingLock || !!this.pendingRoll;
  }

  /** Runs `judge`, a 答錯 on a fill-in, so that 改判答對 may undo it. A cleric's wait and the 重答 / 逃跑 after it chain to the
   * first 答錯, so the undo goes back to before the wait. A 祈禱 ends the chain: it is a move. Throws what `judge` throws. */
  private withUndo(teamId: string, questionId: string, judge: () => void) {
    const prev = this.game!;
    const chained = this.undo?.after === prev && this.undo.teamId === teamId && this.undo.questionId === questionId;
    // A wait the chain no longer reaches cannot be undone: answerQuestion refuses 答對 while a wrong answer waits.
    const undoable = this.question(questionId)?.kind === "text" && (chained || !prev.pendingWrong);
    this.undoPending = undoable ? { prev: chained ? this.undo!.prev : prev, teamId, questionId } : null;
    try {
      judge();
    } finally {
      const pending = this.undoPending;
      this.undoPending = null;
      if (pending && this.game && this.game !== prev) this.undo = { ...pending, after: this.game };
    }
  }

  /** 改判答對 (TODOS.md): the host's last 答錯 on a fill-in becomes 答對, judged from the game before it, so score,
   * rewards, abilities, dishes and narration all go as if it had been judged right. Only while nothing has moved since
   * (withUndo); phones that went on or offline meanwhile stay so. */
  private handleHostUndoWrong(conn: Conn, teamId: string, questionId: string, eventId: number) {
    if (!this.requireHost(conn)) return;
    // Pressed under an older STATE (a double press, or a judgment meanwhile): dropped, like a stale HOST_JUDGE.
    if (eventId !== this.eventSeq) return;
    const undo = this.undo;
    const now = this.game;
    if (!undo || !now || !this.undoOpen(undo) || undo.teamId !== teamId || undo.questionId !== questionId) {
      return void this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "no_undo" });
    }
    // What changed since without being a move (keepUndoOpen) stays: phones on or offline, other teams' tapped options.
    const live = new Map(now.teams.map((t) => [t.id, t]));
    this.game = {
      ...undo.prev,
      teams: undo.prev.teams.map((t) => {
        const n = live.get(t.id);
        // A tap is kept only on the question it was made on.
        const tapped = t.id !== teamId && currentQuestionIdOf(undo.prev, t.id) === currentQuestionIdOf(now, t.id);
        return !n ? t : { ...t, online: n.online, ...(tapped ? { currentSelection: n.currentSelection } : {}) };
      }),
    };
    this.undo = null;
    try {
      this.judge(teamId, questionId, true, "retry");
    } catch (err) {
      // E.g. the team's phones all went offline, so it is not on turn in the old game: the 答錯 stands, still undoable.
      this.game = now;
      this.undo = undo;
      return this.sendInvalid(conn, err);
    }
    // A boss phase the 答錯 used up was not used up after all. A correct answer never sets phaseCardDue: its reveal comes first.
    this.phaseCardDue = false;
    if (this.phaseCardTimer) clearTimeout(this.phaseCardTimer);
    this.phaseCardTimer = null;
  }

  /** The host's 答錯 on a cleric's fill-in (#106): "team" waits for the team's 祈禱 / 重答 / 逃跑, "pray" picks
   * 祈禱 for it. 重答 / 逃跑 from the wait are plain HOST_JUDGE retry / flee. The first press wins: a later
   * one finds no wait (or a settled one) and is refused. */
  private hostClericWrong(conn: Conn, teamId: string, questionId: string, choice: "team" | "pray") {
    const game = this.game!;
    if (this.question(questionId)?.kind !== "text") return void this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "not_text" });
    try {
      if (choice === "team") {
        return this.withUndo(teamId, questionId, () => {
          this.game = recordTextWrong(game, teamId, questionId);
          this.broadcastState();
        });
      }
      const wrong = game.pendingWrong;
      if (wrong?.teamId !== teamId || wrong.questionId !== questionId || wrong.optionIndex !== null) {
        return void this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "no_wrong_answer" });
      }
      this.game = pray(game, teamId);
    } catch (err) {
      return this.sendInvalid(conn, err);
    }
    this.retryAfterPrayer(teamId, questionId);
  }

  private handleSendToBoss(conn: Conn, teamId: string) {
    if (!this.requireHost(conn)) return;
    if (!this.game) {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }
    // A lock in its beat would then be judged against a room question the team no longer faces.
    if (this.pendingLock?.teamId === teamId || this.pendingRoll?.teamId === teamId) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "lock_pending" });
      return;
    }
    try {
      this.game = sendToBoss(this.game, teamId);
      this.broadcastState();
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }

  private handleQueueQuestion(conn: Conn, target: string, questionId: string | null) {
    if (!this.requireHost(conn)) return;
    if (!this.game) {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }
    try {
      this.game = queueQuestion(this.game, target, questionId);
      // Nothing anyone else sees changed: only the host pages hear about it.
      this.sendPicks();
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }

  /** Applies one answer; throws InvalidActionError (from answerQuestion) before changing anything.
   * `roll`: a warrior's d20 stands in for the answer (warriorRoll), and `correct` is ignored; on a
   * multipleChoice or sort question it is the crit die too. A crit die (`kind: "crit"`) rides on a correct answer. */
  /** judgeNow, with a lost natural 20 held back until it is done (it narrates first and its phase card is due) and
   * tried after: the turn may now be the crit team's. */
  private judge(...args: Parameters<DungeonRoom["judgeNow"]>) {
    this.judging = true;
    try {
      this.judgeNow(...args);
    } finally {
      this.judging = false;
    }
    if (this.lostCrit) this.applyLostCrit();
  }

  private judgeNow(teamId: string, questionId: string, correct: boolean, fleeChoice: "flee" | "retry", roll?: { kind: "warrior" | "crit"; value: number }, killDice?: number[]) {
    const prev = this.game;
    if (!prev) return;
    // Captured before `this.game` reassigns to the post-judgment state below: the monster name
    // and the reveal must describe the question that was JUST answered, not whatever
    // currentQuestion() would return afterwards (the next one) — a trap this file's own
    // narration code already had to work around once (Outside Voice finding, /plan-eng-review).
    const justAnswered = this.currentQuestion();
    const monster = justAnswered?.pub.monster.name ?? "怪物";
    // A boss MC miss has no flee (D2=B): the host's stuck row (button or key 3) resolves it as the beat would.
    // A cleric's fill-in wait (optionIndex null) keeps its 逃跑, which rotates the question (#106 D2=A).
    if (!correct && prev.pendingWrong?.teamId === teamId && prev.pendingWrong.optionIndex !== null && isInBossPhase(prev, teamId)) fleeChoice = "retry";
    // A wrong buzz has no flee (boss-buzzer.md D4): a laptop's 逃跑 key only shuts the team out, like 答錯.
    if (isBuzzPhase(prev)) fleeChoice = "retry";
    const run = (rng: () => number, dice?: number[]) =>
      roll?.kind === "warrior"
        ? warriorRoll(prev, teamId, questionId, roll.value, rng, isAutoJudged(this.question(questionId)), dice)
        : answerQuestion(prev, teamId, questionId, correct, fleeChoice, rng, roll?.value, dice);
    // A killing blow waits for its 4d20 on screen (kill-roll.md D1): a trial run, on an rng it must not consume, says
    // whether this judgment kills; then the room rolls the dice and judges again with them when the beat ends.
    if (!killDice) {
      const trial = run(() => 0).outcome;
      if (trial.type === "correct-boss-hit" && trial.bossKilled) {
        const dice = this.fixedDie !== undefined ? [this.fixedDie, this.fixedDie, this.fixedDie, this.fixedDie] : rollBossKillDice(this.rng);
        const shown = run(() => 0, dice).outcome;
        this.pendingKill = { correct, fleeChoice, roll };
        // Pin the turn, as a lock does: a skipped offline team whose phone comes back must not take it during the beat.
        this.game = { ...prev, currentTurnIndex: prev.turnOrder.indexOf(teamId) };
        this.startRoll("kill", teamId, questionId, { values: dice, value: shown.type === "correct-boss-hit" ? shown.killBonus! : 0 });
        this.broadcastState();
        return;
      }
    }
    const judged = run(this.rng, killDice);
    const { outcome } = judged;
    // The next room may hold an event instead of its monster (event-rooms.md D2, D5): drawn now, so a restart cannot reroll it.
    // A room the host picked the question for (指定下一題) keeps its monster: an event there would burn the pick.
    const queued = prev.teams.find((t) => t.id === teamId)?.queuedQuestionId;
    const picked = queued !== undefined && judged.game.teams.find((t) => t.id === teamId)?.currentQuestionId === queued;
    const game = !picked && eventEligible(judged.game, outcome) && this.rollsEvent(teamId) ? enterEventRoom(judged.game, teamId, drawEvent(this.rng)) : judged.game;
    // A wrong buzz: the music picks up where the buzz stopped it, for the teams still in (boss-buzzer.md D5).
    if (isBuzzPhase(prev) && outcome.type === "incorrect-retry" && !outcome.newBossQuestion) this.resumeBuzzMusic(questionId);
    // A ruling on the team (the host's, or the lost natural 20 itself) settles its lost natural 20; one refused above does not.
    if (this.lostCrit?.teamId === teamId) this.lostCrit = null;
    // Everything up to broadcastState is synchronous: state changes and the eventId are
    // fixed before any narration awaits, so concurrent judgments cannot interleave.
    this.game = game;
    const eventId = ++this.eventSeq;
    const phaseName = prev.boss.phaseIndex > 0 ? this.bank.boss.phases[prev.boss.phaseIndex]?.name : undefined;
    // The dish the answer just ate: game-state appended it to the team's dishes (a game saved before dishes appends none).
    const before = prev.teams.find((t) => t.id === teamId);
    const ateDish = (game.teams.find((t) => t.id === teamId)?.dishes?.length ?? 0) > (before?.dishes?.length ?? 0);
    const ateFrom = !ateDish || !before ? undefined : outcome.type === "correct-boss-hit" ? this.bossId() : (prev.rooms[before.roomIndex]?.monsterId ?? this.bank.rooms[before.roomIndex]?.monster);
    const dish = ateFrom ? catalogMonster(ateFrom).dish : undefined;
    const told = toNarrationEvent(prev, outcome, monster, this.nextTurn() ?? undefined, phaseName);
    // The dish is named only once it is served on the big screen (cooking I1, I4); the line just counts 飽足感.
    const base = dish && (told.type === "correct" || told.type === "boss-kill") ? { ...told, cooked: true as const } : told;
    // A phase out of questions: no "try again" and no hearts count, its card comes next.
    const exhaustedEvent = game.boss.phasePending === "exhausted" && (base.type === "retry" || base.type === "boss-hit") ? { ...base, exhausted: true as const } : base;
    // A wrong buzz that leaves the question to the others (boss-buzzer.md): no "try again" line.
    const buzzed = isBuzzPhase(prev) && exhaustedEvent.type === "retry" && !exhaustedEvent.boss && !exhaustedEvent.exhausted ? { ...exhaustedEvent, buzzOut: true as const } : exhaustedEvent;
    // The narrator says the warrior's d20 (TODOS: 旁白念出戰士擲到幾點); a flee never follows a roll.
    const event = roll?.kind === "warrior" && buzzed.type !== "flee" ? { ...buzzed, warriorRoll: roll.value } : buzzed;
    // A natural 20 or 1 swaps the correct / boss-hit sound; the boss kill keeps its own (E2).
    const mark = "roll" in outcome ? outcome.roll : undefined;
    this.setCue(event.type === "epilogue" || event.type === "event-room" ? null : event.type !== "boss-kill" && mark?.kind === "crit" ? (mark.value === 20 ? "crit" : "fumble") : event.type);
    // Shown to everyone (D3), but only on a genuinely correct answer (D5): a retry or a flee
    // must never reveal it, or the question loses its point; game-state.ts's deal()/boss ring
    // treat a revealed question (answered, or fled after a wrong lock) as not safe to redeal. Set before broadcastState so the reveal and the post-judgment state arrive
    // together in one STATE — no window where a client shows the next question first.
    this.reveal = null;
    if ((outcome.type === "correct-room-advance" || outcome.type === "correct-boss-hit") && justAnswered) {
      const imageBaseUrl = this.room.env?.R2_PUBLIC_BASE_URL ?? "";
      const explanation = publicExplanation(this.bank, questionId, imageBaseUrl);
      const q = this.question(questionId);
      // The option wall, green tile and points of a correct lock or a warrior's success on a multipleChoice question.
      const choice = q?.kind === "multipleChoice" ? { options: q.options, correctIndex: q.correctIndex, teamId, points: outcome.reward, ...chefOf(outcome) } : undefined;
      const sorted = q?.kind === "sort" ? { items: q.items, teamId, points: outcome.reward, ...chefOf(outcome) } : undefined;
      // The answer stops the clip; the reveal shows the video where it stopped (D17).
      if (this.media?.questionId === questionId) this.media = { ...this.media, state: "paused" };
      const video = q?.content.kind === "youtube" && (!explanation || explanation.kind === "text") ? publicMediaContent(q.content, imageBaseUrl, questionId) : undefined;
      this.reveal = {
        questionId,
        answer: justAnswered.answer,
        ...(explanation ? { explanation } : {}),
        ...(video?.kind === "youtube" ? { video } : {}),
        ...(choice ? { choice } : {}),
        ...(sorted ? { sorted } : {}),
        ...(dish ? { dish: { ...dish, points: outcome.reward, ...chefOf(outcome), monster: justAnswered.pub.monster, room: outcome.type === "correct-boss-hit" ? null : before!.roomIndex, teamId } } : {}),
      };
    }
    // Fixed before the STATE is saved: the boss cooks first (cooking R8), otherwise the kill-shot line is read first.
    if (game.phase === "finished" && !this.epilogueRequested) this.revealFrom = this.now() + (this.reveal?.dish ? FINISH_PODIUM_MS : this.epilogueDelayMs);
    // A miss that used up a boss phase has no answer to show: its card follows once the retry line has
    // been read (D7), held like a reveal; 下一題 opens it sooner. Set before the STATE, which tells the clients.
    const cardDue = game.phase === "playing" && !!game.boss.phasePending && !this.reveal;
    if (cardDue) this.phaseCardDue = true;
    this.broadcastState();
    const narration = this.narrate(eventId, event);
    // ⚔️ 最後衝刺 fired on this answer: the owl names who walked in and who was blessed (last-sprint.md).
    if (!prev.sprint && game.sprint) {
      const name = (id: string) => game.teams.find((t) => t.id === id)?.name ?? "";
      this.appendLine(eventId, sprintLine(name(teamId), game.sprint.teamIds.map(name)));
    }
    if (game.phase === "finished" && !this.epilogueRequested) {
      this.logGame(game);
      this.epilogueRequested = true;
      void this.sendEpilogue(narration, eventId).catch((err) => this.epilogueFailed(err, eventId));
    }
    if (cardDue) {
      void narration.then(() => {
        if (!this.phaseCardDue) return;
        const lines = this.lastNarration?.eventId === eventId ? this.lastNarration.lines : [];
        this.phaseCardTimer = setTimeout(() => {
          this.phaseCardTimer = null;
          if (this.phaseCardDue) this.openPhaseCard();
        }, Math.min(ADVANCE_CAP_MS, Math.max(BEAT_MS, speechMs(lines))));
      });
    }
  }

  /** A team locks its current pick (E2, E11). It waits for the host's HOST_REVEAL, then the beat, then resolveLock. `shown` is the
   * pick the phone showed when pressed; a different room pick means another phone on the team changed it. */
  private handleTeamLockOption(conn: Conn, questionId: string, shown?: number) {
    const teamId = this.playingTeam(conn);
    const game = this.game;
    if (!teamId || !game) return;
    const team = game.teams.find((t) => t.id === teamId);
    const q = this.question(questionId);
    const reject = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    if (this.paused()) return reject("reveal_pending");
    if (this.pendingLock || this.pendingRoll || game.pendingWrong) return reject("answer_pending");
    if (game.phase !== "playing" || currentTurnTeamId(game) !== teamId) return reject("not_your_turn");
    if (!isAutoJudged(q) || currentQuestionIdOf(game, teamId) !== questionId) return reject("stale_question");
    const pick = team?.currentSelection ?? null;
    if (pick === null || pick >= this.pickCount(q) || game.eliminated[questionId]?.includes(pick)) return reject("no_selection");
    if (shown !== undefined && shown !== pick) return reject("selection_changed");
    this.pendingLock = { teamId, questionId, optionIndex: pick };
    // Pin the turn to the locking team: the stored index may point at an offline team the turn skipped, and that
    // team coming back must not take the turn while the lock waits for 公布答案 (/review fix pass).
    this.game = { ...game, currentTurnIndex: game.turnOrder.indexOf(teamId) };
    this.broadcastState();
  }

  /** The question whose YouTube video the big screen shows now, or null: the question in play, or during a
   * reveal the answered question, unless an image or a video explanation takes its place (D17). */
  private shownVideoId(): string | null {
    if (this.game?.phase !== "playing") return null;
    if (this.reveal) return this.reveal.video ? this.reveal.questionId : null;
    if (this.phaseCard || this.opening()) return null;
    const pub = this.currentQuestion()?.pub;
    return pub?.content.kind === "youtube" ? pub.id : null;
  }

  /** The media command for the video on screen. One for another question is dropped here, so a question that
   * comes round again starts paused, whatever path moved the game on. */
  private liveMedia(): { media?: MediaCommand } {
    if (this.media && this.media.questionId !== this.shownVideoId()) this.media = null;
    return this.media ? { media: this.media } : {};
  }

  /** ▶ ⏸ ⟲ from the host page. Ignored unless it names the video on screen: a second host device may still show
   * an older question. */
  private handleHostMedia(conn: Conn, questionId: string, action: MediaAction) {
    if (!this.requireHost(conn)) return;
    if (questionId !== this.shownVideoId()) return;
    const same = this.media?.questionId === questionId ? this.media : null;
    const seq = same?.seq ?? 0;
    this.media = { questionId, state: action === "pause" ? "paused" : "playing", seq: action === "restart" ? seq + 1 : seq, press: (same?.press ?? 0) + 1 };
    // The host took the controls after a buzz: a wrong answer or a drop leaves the music as the host set it (outside-voice review).
    this.buzzPaused = false;
    // The first ▶ on a buzzer phase's video opens buzzing (boss-buzzer.md D5).
    // A reveal's video is the answered question's, even when the same question comes round again (red-team review).
    if (action !== "pause" && this.game && !this.reveal) this.keepUndoOpen(openBuzz(this.game, questionId));
    this.broadcastState();
  }

  /** 搶答 from a phone (boss-buzzer.md). The room handles one message at a time, so the first buzz to arrive wins.
   * A video waits for the host's first ▶ (D5); any other question is open as soon as it shows. The music stops. */
  private handleTeamBuzz(conn: Conn, questionId: string) {
    const teamId = this.playingTeam(conn);
    if (!teamId || !this.game) return;
    if (this.paused() || this.pendingRoll || this.pendingLock) return this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "reveal_pending" });
    const open = this.question(questionId)?.content.kind !== "youtube";
    try {
      this.game = buzzIn(this.game, teamId, questionId, open);
    } catch (err) {
      return this.sendInvalid(conn, err);
    }
    // Only music that was playing stops, and only that music starts again after a wrong answer or a dropped phone.
    this.buzzPaused = this.media?.questionId === questionId && this.media.state === "playing";
    if (this.buzzPaused) this.media = { ...this.media!, state: "paused", press: this.media!.press + 1 };
    this.setCue("buzz");
    this.broadcastState();
  }

  /** A waiting team's reaction (audience-reactions.md): dropped without a reply when it is not a joined team's, the
   * game has not reached its first question (intro, initiative), the team is the one answering (or every team is, in
   * a buzzer phase), the team reacted in the last REACT_GAP_MS (less REACT_JITTER_MS), or the room already sent
   * REACT_ROOM_MAX in that time. The phone hides or greys its buttons in all of these, so a drop needs no ERROR. */
  private handleReact(conn: Conn, reaction: Reaction) {
    const teamId = this.connTeam.get(conn.id);
    if (!teamId || this.game?.phase !== "playing" || this.opening()) return;
    if (currentTurnTeamId(this.game) === teamId || isBuzzPhase(this.game)) return;
    const now = this.now();
    // One window for both limits, so a team tapping as fast as it may never counts twice against the room's cap.
    const gap = REACT_GAP_MS - REACT_JITTER_MS;
    if (now - (this.reactedAt.get(teamId) ?? -Infinity) < gap) return;
    this.roomReacts = this.roomReacts.filter((t) => now - t < gap);
    if (this.roomReacts.length >= REACT_ROOM_MAX) return;
    this.reactedAt.set(teamId, now);
    this.roomReacts.push(now);
    // Straight to the sockets, not this.broadcast: a reaction changes nothing to save, so it skips persist().
    this.room.broadcast(JSON.stringify({ type: "REACTION", teamId, reaction } satisfies ServerMessage));
  }

  /** 沒人答對，換下一題 (boss-buzzer.md D4): a new question, the old one unrevealed. Not narrated. */
  private handleHostBuzzSkip(conn: Conn, questionId: string) {
    if (!this.requireHost(conn) || !this.game) return;
    if (this.paused() || this.pendingRoll || questionId !== this.game.boss.currentQuestionId) return this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "stale_question" });
    try {
      this.game = skipBuzz(this.game);
    } catch (err) {
      return this.sendInvalid(conn, err);
    }
    this.broadcastState();
  }

  /** The host's 公布答案 (host-reveal.md): starts the beat of the pending lock. No fallback timer (D5): a lock
   * waits for the host like a fill-in. A lock whose turn moved on is still revealed, so resolveLock drops it (E9). */
  private handleHostReveal(conn: Conn, teamId: string, questionId: string) {
    if (!this.requireHost(conn)) return;
    const lock = this.pendingLock;
    const reject = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    if (!this.game || !lock || lock.teamId !== teamId || lock.questionId !== questionId) return reject("no_lock");
    // A double press: the beat already runs.
    if (lock.revealing) return reject("reveal_pending");
    // Nothing else may hold the timer now (a lock is refused during a roll or a miss): what is left is stale,
    // e.g. a boss miss the host settled inside its beat (/review, 2026-11-05).
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.pendingLock = { ...lock, revealing: true };
    this.lockTimer = setTimeout(() => this.resolveLock(), BEAT_MS);
    this.broadcastState();
  }

  private resolveLock() {
    const lock = this.pendingLock;
    const game = this.game;
    this.pendingLock = null;
    this.lockTimer = null;
    if (!lock || !game) return;
    // The reveal is the room doing something: the idle clock starts after it, not at the lock.
    this.markActivity();
    const q = this.question(lock.questionId);
    try {
      // The turn moved on some other way (the team's phone cannot drop it: onClose keeps a locked team on turn):
      // drop the lock; it locks again.
      if (currentTurnTeamId(game) !== lock.teamId || currentQuestionIdOf(game, lock.teamId) !== lock.questionId) {
        this.broadcastState();
      } else if ((q?.kind === "multipleChoice" && q.correctIndex === lock.optionIndex) || (q?.kind === "sort" && this.sortSlotsOf(lock.questionId, lock.optionIndex).every(Boolean))) {
        // Right: the crit die shows for a beat, then resolveRoll judges it (R9). Nothing is scored before.
        this.startRoll("crit", lock.teamId, lock.questionId);
        this.broadcastState();
      } else {
        // No eventSeq bump: nothing is narrated until the team chooses (E7).
        this.game = recordWrongLock(game, lock.teamId, lock.questionId, lock.optionIndex);
        this.broadcastState();
        this.armBossMiss();
      }
    } catch (err) {
      console.error(JSON.stringify({ event: "lock_failed", error: String(err) }));
      this.broadcastState();
    }
    // Its phone may have closed while the lock waited (onClose): show it offline now, or after its crit die.
    if (this.pendingRoll?.kind !== "crit") this.syncLockTeamAndShow(lock.teamId);
  }

  private syncLockTeamAndShow(teamId: string) {
    const wasOnline = this.game?.teams.find((t) => t.id === teamId)?.online;
    this.syncLockTeam(teamId);
    if (wasOnline && !this.game?.teams.find((t) => t.id === teamId)?.online) this.broadcastState();
  }

  /** A wrong boss lock has no 重答 / 逃跑 choice (boss redesign D2=B): both would rotate the shared
   * question anyway. The red tile shows for a beat, then it resolves as a retry on its own. */
  private armBossMiss() {
    const pending = this.game?.pendingWrong;
    // A cleric that may pray decides itself (祈禱 / 不用); the host's stuck row covers a team that never does (R1b).
    if (!pending || pending.optionIndex === null || !isInBossPhase(this.game!, pending.teamId) || canPray(this.game!, pending.teamId)) return;
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => {
      // Resolved early (the host judged it): lockTimer may already be the next lock's beat.
      if (this.game?.pendingWrong !== pending) return;
      this.lockTimer = null;
      try {
        this.judge(pending.teamId, pending.questionId, false, "retry");
      } catch (err) {
        console.error(JSON.stringify({ event: "boss_miss_failed", error: String(err) }));
      }
    }, BEAT_MS);
  }

  /** Lobby only (class-abilities.md): any phone of the team may pick; the last pick before HOST_START counts. */
  private handleTeamPickClass(conn: Conn, classId: ClassId | null) {
    const teamId = this.connTeam.get(conn.id);
    const team = this.pendingTeams.find((t) => t.id === teamId);
    if (!team) return void this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
    if (this.game) return void this.sendTo(conn, { type: "ERROR", error: "game_already_started" });
    if ((team.classId ?? null) === classId) return;
    if (classId) team.classId = classId;
    else delete team.classId;
    this.broadcastState();
  }

  /** The team's class ability (class-abilities.md). The warrior: the room spends the use and rolls at
   * once, then shows the die for a beat; resolveRoll judges it as a warrior's roll (R2; R3 reversed in /review: a roll
   * dropped in its beat is not free, or a reload would throw a bad die away). The mage and the thief
   * act at once and the team then answers. The cleric prays on its wrong answer; in the boss room the
   * miss then resolves at once, rotating the question as usual, and the cleric answers the new one. On a
   * fill-in wait (#106) it resolves at once too, and the cleric answers the same question again. */
  private handleTeamUseAbility(conn: Conn, questionId: string) {
    const teamId = this.playingTeam(conn);
    const game = this.game;
    if (!teamId || !game) return;
    const reject = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    if (this.paused()) return reject("reveal_pending");
    if (this.pendingLock || this.pendingRoll) return reject("answer_pending");
    const classId = game.teams.find((t) => t.id === teamId)?.classId;
    const q = this.question(questionId);
    let next: GameState;
    try {
      if (classId === "cleric") next = pray(game, teamId);
      else if (classId === "thief") next = armSneak(game, teamId);
      else if (classId === "mage") {
        if (q?.kind === "multipleChoice") next = mageEliminate(game, teamId, questionId, q.correctIndex, q.options.length, this.rng);
        else if (q?.kind === "text") next = mageHint(game, teamId, questionId, q.answer);
        // The first item, whole: the phone and the screen label it 第 1 個 on a sort question.
        else if (q?.kind === "sort") next = mageHint(game, teamId, questionId, q.items[0], true);
        else return reject("stale_question"); // not in the bank
      } else next = spendAbility(game, teamId, "warrior");
    } catch (err) {
      return this.sendInvalid(conn, err);
    }
    if (currentQuestionIdOf(game, teamId) !== questionId || (classId === "cleric" && game.pendingWrong?.questionId !== questionId)) return reject("stale_question");
    // A fill-in question is a persuasion check first; the warrior's roll comes after it (dnd design R2).
    if (classId === "warrior" && q?.kind === "text" && !game.checks?.[checkKey(questionId, teamId)]) return reject("check_needed");
    this.game = next;
    if (classId === "warrior") {
      this.startRoll("warrior", teamId, questionId);
    } else if (classId === "cleric" && (isInBossPhase(next, teamId) || game.pendingWrong?.optionIndex === null)) {
      return this.retryAfterPrayer(teamId, questionId);
    }
    this.broadcastState();
  }

  /** A prayer that resolves at once: in the boss room, or on a fill-in (#106), where the cleric answers again
   * straight away, keeping the turn. Shared by the team's 祈禱 and the host's. */
  private retryAfterPrayer(teamId: string, questionId: string) {
    try {
      this.judge(teamId, questionId, false, "retry");
    } catch (err) {
      // The prayer stands; the miss falls back to the host's keys, like a cleric that never chose.
      console.error(JSON.stringify({ event: "prayer_failed", error: String(err) }));
      this.broadcastState();
    }
  }

  /** Rolls the d20 the beat shows (pendingRoll) and arms resolveRoll. Logged here, not on judging, so a roll whose
   * room restarts inside the beat still counts (eng review D10): the event's 20s and 1s are counted from these. */
  private startRoll(kind: "warrior" | "crit" | "check", teamId: string, questionId: string, target?: { bonus: number; dc: number }): void;
  /** A kill's 4d20: rolled by judgeNow, which also knows the bonus they score. */
  private startRoll(kind: "kill", teamId: string, questionId: string, kill: { values: number[]; value: number }): void;
  private startRoll(kind: PendingRoll["kind"] & string, teamId: string, questionId: string, extra?: { bonus: number; dc: number } | { values: number[]; value: number }) {
    const value = extra && "value" in extra ? extra.value : (this.fixedDie ?? rollD20(this.rng));
    this.pendingRoll = { teamId, questionId, value, kind, ...extra };
    console.log(JSON.stringify({ event: "roll", kind, value, ...(extra && "values" in extra ? { values: extra.values } : {}) }));
    this.setCue("roll");
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => this.resolveRoll(), kind === "kill" ? KILL_BEAT_MS : BEAT_MS);
  }

  /** The one place a cue is set: a new one bumps cueSeq, so the big screen plays it once. */
  private setCue(cue: SoundCue | null) {
    this.cue = cue;
    if (cue) this.cueSeq++;
  }

  private resolveRoll() {
    const roll = this.pendingRoll;
    const kill = this.pendingKill;
    const game = this.game;
    this.pendingRoll = this.pendingKill = null;
    this.lockTimer = null;
    if (!roll || !game) return;
    this.markActivity();
    try {
      // The turn moved on during the beat (the phone dropped): drop the roll, like a lock (E9). The use stays spent.
      if (currentTurnTeamId(game) !== roll.teamId || currentQuestionIdOf(game, roll.teamId) !== roll.questionId) {
        this.broadcastState();
      } else if (roll.kind === "check") {
        this.resolveCheck(roll.teamId, roll.questionId, roll.value);
      } else if (roll.kind === "kill") {
        // pendingKill is always set with a kill roll; without it there is nothing to judge.
        if (kill) this.judge(roll.teamId, roll.questionId, kill.correct, kill.fleeChoice, kill.roll, roll.values);
        else this.broadcastState();
      } else {
        // kind is optional in the protocol (an older server's STATE); this room always sets it.
        this.judge(roll.teamId, roll.questionId, roll.kind === "crit", "retry", { kind: roll.kind ?? "warrior", value: roll.value });
      }
    } catch (err) {
      console.error(JSON.stringify({ event: "roll_failed", error: String(err) }));
      this.broadcastState();
    }
    // A crit or check that killed has started the kill's beat: its team stays on turn until that beat lands.
    if (holdsTurn(roll) && (this.pendingRoll as PendingRoll | null)?.kind !== "kill") this.syncLockTeamAndShow(roll.teamId);
  }

  /** The check's beat is over (dnd design R6): its record, written at the roll, shows now with the hint it earned. A
   * natural 20 wins outright, along the host's 答對 path (R7). */
  private resolveCheck(teamId: string, questionId: string, value: number) {
    if (!this.game!.checks?.[checkKey(questionId, teamId)]) return this.broadcastState();
    // A natural 20 goes straight to the win: one STATE, with the correct answer's cue (dnd design E2).
    if (value === 20) return this.judge(teamId, questionId, true, "retry");
    this.setCue(this.game!.checks![checkKey(questionId, teamId)].passed ? "check-pass" : "check-fail");
    this.broadcastState();
  }

  /** A restart during a natural 20's beat lost the win the beat applies (R7). restore() marks it, and the next STATE
   * with its team on turn applies it (a judgment needs a team online, so not restore itself). The host judging that
   * team first, or the question leaving play, cancels it. Returns whether it judged (judge sent the STATE). */
  private applyLostCrit(): boolean {
    const lost = this.lostCrit;
    const game = this.game;
    if (!lost || game?.phase !== "playing") return false;
    if (this.judging || game.pendingWrong || this.pendingRoll || this.pendingLock || this.paused()) return false;
    const team = game.teams.find((t) => t?.id === lost.teamId);
    if (!team || currentQuestionIdOf(game, lost.teamId) !== lost.questionId || game.checks?.[checkKey(lost.questionId, lost.teamId)]?.value !== 20) {
      this.lostCrit = null;
      return false;
    }
    if (currentTurnTeamId(game) !== lost.teamId || team.typedAnswer !== undefined) return false;
    this.lostCrit = null;
    // Applied right after a 答錯 (inside withUndo): undoing that 答錯 would wipe this win for good, so it is not undoable.
    const pending = this.undoPending;
    this.undoPending = null;
    try {
      this.judge(lost.teamId, lost.questionId, true, "retry");
    } catch (err) {
      this.undoPending = pending;
      console.error(JSON.stringify({ event: "lost_crit_failed", error: String(err) }));
      return false;
    }
    return true;
  }

  /** Whether the team that just walked into a new room finds an event there (D5). e2e names its one event team. */
  private rollsEvent(teamId: string): boolean {
    if (this.e2eEventTeam !== undefined) return this.game?.teams.find((t) => t.id === teamId)?.name === this.e2eEventTeam;
    // The top of the range, so a test room on rng () => 0 never meets an event.
    return this.rng() >= 1 - EVENT_CHANCE;
  }

  /** The turn's team (its phone, or the host for it) opens its event (event-rooms.md D3, D10): the effect lands and the
   * turn passes at once, and the result stays on show until 下一題, like an answer reveal. */
  private handleOpenEvent(conn: Conn, teamId: string, eventId: number) {
    const game = this.game;
    if (!game) return;
    const reject = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    // A double press, or a second phone of the team: the first one already opened it.
    if (eventId !== this.eventSeq) return reject("stale_event");
    if (this.paused() || this.pendingLock || this.pendingRoll) return reject("reveal_pending");
    let opened: ReturnType<typeof openEvent>;
    try {
      opened = openEvent(game, teamId, this.rng);
    } catch (err) {
      if (err instanceof InvalidActionError) return reject(err.message);
      throw err;
    }
    const { result } = opened;
    this.game = opened.game;
    const id = ++this.eventSeq;
    // A feast serves a dish from the catalog: the room monsters', since the boss's is the last night's feast.
    // Only a dish the room may say aloud, like the dishes the epilogue names; none left means no dish.
    const pool = MONSTERS.filter((m) => !m.boss && this.sayable(m.dish.name));
    const m = result.outcome === "feast" && pool.length ? pool[Math.floor(this.rng() * pool.length)] : undefined;
    this.eventReveal = { ...result, ...(m ? { dish: { name: m.dish.name, sprite: m.sprite, hue: m.hue } } : {}) };
    const bad = result.outcome === "rotten" || result.outcome === "bad" || result.boon === "curse";
    this.setCue(bad ? "fumble" : "correct");
    this.broadcastState();
    const team = game.teams.find((t) => t.id === teamId)!;
    const next = this.nextTurn();
    void this.narrate(id, {
      type: "event-room",
      team: team.name,
      ...(team.classId ? { classId: team.classId } : {}),
      scene: result.scene,
      outcome: result.outcome,
      satiety: result.satiety,
      ...(result.abilityUse ? { abilityUse: true as const } : {}),
      ...(m ? { dish: m.dish.name } : {}),
      ...(next ? { next } : {}),
    });
  }

  /** 擲骰說服 (dnd design R-E1, R-E4): the team on turn rolls its check on its own fill-in question, once. */
  private handleTeamRollCheck(conn: Conn, questionId: string, eventId: number) {
    const teamId = this.playingTeam(conn);
    const game = this.game;
    if (!teamId || !game) return;
    const reject = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    // Pressed under an older STATE (the host judged meanwhile): it was for another attempt.
    if (eventId !== this.eventSeq) return reject("stale_event");
    if (this.paused()) return reject("reveal_pending");
    if (this.pendingLock || this.pendingRoll || game.pendingWrong) return reject("answer_pending");
    if (game.phase !== "playing" || currentTurnTeamId(game) !== teamId) return reject("not_your_turn");
    // No checks in a buzzer phase (boss-buzzer.md D6): refused before the die rolls, not after.
    if (isBuzzPhase(game)) return reject("buzzer_phase");
    // An event room holds no question to roll on: its held deal stays hidden.
    if (game.teams.find((t) => t.id === teamId)?.event) return reject("event_room");
    if (this.question(questionId)?.kind !== "text" || currentQuestionIdOf(game, teamId) !== questionId) return reject("stale_question");
    if (game.checks?.[checkKey(questionId, teamId)]) return reject("check_done");
    // A typed answer already waits for the host: a natural 20 must not win over it.
    if (game.teams.find((t) => t.id === teamId)?.typedAnswer !== undefined) return reject("answer_submitted");
    const q = this.question(questionId);
    if (q?.kind !== "text") return reject("stale_question");
    this.startRoll("check", teamId, questionId, checkTarget(game, teamId, questionId));
    // Written now and persisted with the STATE, but hidden until the beat ends (snapshot): a restart cannot reroll it.
    this.game = recordCheck(game, teamId, questionId, this.pendingRoll!.value, q.answer);
    this.broadcastState();
  }

  /** 重答 / 逃跑 from the team that just locked wrong. */
  private handleTeamWrongChoice(conn: Conn, questionId: string, choice: "retry" | "flee") {
    const teamId = this.playingTeam(conn);
    const pending = this.game?.pendingWrong;
    if (!teamId) return;
    if (!pending || pending.teamId !== teamId || pending.questionId !== questionId) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "no_wrong_answer" });
      return;
    }
    // A boss miss resolves on its own beat (D2=B): a phone cannot cut the red tile short. A cleric
    // that may pray has no beat: its 不用 is a retry. A fill-in wait has no red tile: 重答 and 逃跑 both stand (#106).
    if (pending.optionIndex !== null && isInBossPhase(this.game!, teamId) && !(choice === "retry" && canPray(this.game!, teamId))) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "boss_miss" });
      return;
    }
    try {
      this.withUndo(teamId, questionId, () => this.judge(teamId, questionId, false, choice));
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }

  private sendInvalid(conn: Conn, err: unknown) {
    const detail = err instanceof InvalidActionError ? err.message : "unknown error";
    this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
  }

  /** The connection's own team while a game runs; otherwise sends the matching ERROR and returns null. */
  private playingTeam(conn: Conn): string | null {
    const teamId = this.connTeam.get(conn.id);
    if (!teamId) this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
    else if (!this.game) this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
    else return teamId;
    return null;
  }

  /** A typed answer to a text question, shown to the host to judge (fill-in, #104). Not narrated. */
  private handleTeamSubmitText(conn: Conn, questionId: string, raw: string, eventId?: number) {
    const teamId = this.playingTeam(conn);
    if (!teamId || !this.game) return;
    const reject = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    // Typed before the host judged that attempt (a slow send on a retry of the same question): drop it,
    // so it never fills the new attempt and blocks the team's real answer with already_submitted.
    if (eventId !== undefined && eventId !== this.eventSeq) return reject("stale_event");
    if (this.paused()) return reject("reveal_pending");
    if (this.pendingRoll) return reject("roll_pending");
    if (this.question(questionId)?.kind !== "text") return reject("not_text_question");
    // The persuasion check comes before the answer (dnd design R6): the phone locks the box, the room enforces it.
    if (!this.game.checks?.[checkKey(questionId, teamId)]) return reject("check_needed");
    const text = cleanTypedAnswer(raw);
    if (!text) return reject("invalid_text");
    try {
      this.game = submitText(this.game, teamId, questionId, text);
      this.broadcastState();
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }

  private handleTeamSelectOption(conn: Conn, questionId: string, optionIndex: number) {
    const teamId = this.playingTeam(conn);
    if (!teamId || !this.game) return;
    // /play hides the options during a reveal (D7); a stale client must not pre-pick the next
    // question before it has even been shown.
    if (this.paused()) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "reveal_pending" });
      return;
    }
    // A locked or wrong-locked pick is final until the turn resolves (phone-answering.md premise 2).
    if (this.pendingLock?.teamId === teamId || this.pendingRoll?.teamId === teamId || this.game.pendingWrong?.teamId === teamId) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "answer_pending" });
      return;
    }
    // The protocol layer only checked optionIndex >= 0; the real bounds check needs the
    // live question's actual options.length, which only this layer (with bank access) has.
    const q = this.question(questionId);
    if (!q || optionIndex >= this.pickCount(q)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: `bad optionIndex for ${questionId}` });
      return;
    }
    // Re-tapping the option a team already has selected is a no-op: nothing about the game
    // state would actually change, so skip the persist()+broadcast() this message would
    // otherwise unconditionally trigger. TEAM_SELECT_OPTION has no other rate limit — this at least
    // keeps an idle-fingered phone from writing/broadcasting on every repeat tap of the same
    // button (adversarial review finding).
    if (this.game.teams.find((t) => t.id === teamId)?.currentSelection === optionIndex) return;
    try {
      this.keepUndoOpen(recordOptionSelection(this.game, teamId, questionId, optionIndex));
      this.broadcastState();
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }
}
