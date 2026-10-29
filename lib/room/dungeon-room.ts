import type { Conn, RoomIO } from "./io";
import { CLOSE_EXPIRED, CLOSE_IDLE } from "./close-codes";
import { parseSnapshot, SCHEMA_VERSION, SNAPSHOT_KEY, type RoomSnapshot } from "./snapshot";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  answerQuestion,
  enterNextBossPhase,
  recordBranchChoice,
  sendToBoss,
  queueQuestion,
  pickBlock,
  pickableQuestionIds,
  recordOptionSelection,
  recordWrongLock,
  currentQuestionIdOf,
  setTeamOnline,
  getSpectatorView,
  currentTurnTeamId,
  isInBossPhase,
  InvalidActionError,
  type BranchOptionId,
  type GameState,
  type LockedOption,
} from "../game-state";
import { MAX_EDIT_LINE, MAX_NOTES, MAX_TEAMS, parseClientMessage, sanitizeText, type AnswerReveal, type HostPick, type ServerMessage, type SoundCue } from "../protocol";
import { UUID_RE, allQuestions, answerText, bossPhaseStates, findQuestion, inShownOrder, poolQuestionIds, publicExplanation, publicQuestion, roomTemplates, shuffledOptionOrders, type Bank } from "../question-bank";
import { BANK } from "../question-bank-data";
import { tokensEqual } from "../tokens";
import { toNarrationEvent, type NarrationEvent, type NextTurn } from "../narration/events";
import { createScriptedProvider, type NarrationProvider } from "../narration/scripted";
import { createRunner, type TranscriptItem } from "../narration/runner";
import { createLlmProvider } from "../narration/llm";
import { createBreaker, withBreaker } from "../narration/breaker";

const MAX_TEAM_NAME_LENGTH = 20;
const MAX_TRANSCRIPT = 500;
/** Long enough for a pizza break, short enough that a TV left on overnight is not billed all night. */
const IDLE_MS = 2 * 60 * 60 * 1000;
export const EXPIRE_MS = 24 * 60 * 60 * 1000;
/** Sockets per room: players, screens and the host, with room to spare. Stops one client opening thousands. */
const MAX_CONNECTIONS = 60;
/** Lets the kill-shot line be read before the story arrives. */
const EPILOGUE_DELAY_MS = 4000;
/** Phone answering (docs/designs/phone-answering.md D10, E2–E4): a lock is held this long before it is
 * judged, and a correct multipleChoice reveal closes on its own after ADVANCE_MS, or once the voice has
 * read the narration (estimated at SPEECH_CHARS_PER_S), never later than ADVANCE_CAP_MS. */
const BEAT_MS = 2000;
const ADVANCE_MS = 8000;
const ADVANCE_CAP_MS = 15000;
const SPEECH_CHARS_PER_S = 4;
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
}
const STYLE_EXAMPLES = 5;
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
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
export class DungeonRoom {
  game: GameState | null = null;
  private pendingTeams: { id: string; name: string }[] = [];
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
  /** Live connections we accepted, for the per-room cap. */
  private conns = new Set<string>();

  /** Counts the start and every accepted judgment; each gets exactly one NARRATION. */
  private eventSeq = 0;
  private lastNarration: { eventId: number; lines: string[] } | null = null;
  /** The latest event's sound effect, sent with STATE (memory only: a restart just has none). */
  private cue: SoundCue | null = null;
  private epilogue: string | null = null;
  /** Set synchronously before anything awaits, so a re-broadcast of GAME_OVER cannot start a second epilogue. */
  private epilogueRequested = false;
  /** The answer on show until the host moves on (D7). In memory only: a restart simply drops it. */
  private reveal: AnswerReveal | null = null;
  /** The boss's phase card is up (docs/designs/boss-phases.md): the next phase has started but its first
   * question waits for the host's 下一題. Saved, unlike the reveal: a restart shows the card again. */
  private phaseCard = false;
  /** A miss used up a boss phase: its card opens once the retry line has been read (D7). Memory only:
   * a restart opens the card at once. */
  private phaseCardDue = false;
  private phaseCardTimer: ReturnType<typeof setTimeout> | null = null;
  /** The lock being held for the beat (E2). Memory only, like the reveal: a restart drops it and the team locks again. */
  private pendingLock: LockedOption | null = null;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  /** Closes a correct multipleChoice reveal on its own (E3); cancelled by HOST_NEXT. */
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private revealAt = 0;
  private transcript: TranscriptItem[] = [];
  /** Host director: notes for the LLM and the last few hand-edited lines. */
  private notes = "";
  /** Asked of new teams at JOIN when not "" (HOST_SET_PASSWORD). Known teams rejoin with their key alone. */
  private joinPassword = "";
  private editedLines: string[] = [];
  /** Turned on by the host at HOST_START, and only effective when a key exists. */
  private aiNarration = false;
  private llm: NarrationProvider | null = null;
  private breaker = createBreaker({ onTrip: (why) => this.onBreakerTrip(why) });
  private scripted: ReturnType<typeof createScriptedProvider>;
  private runner: ReturnType<typeof createRunner>;
  private epilogueDelayMs: number;
  /** The last snapshot handed to storage, so an unchanged room does not write again. */
  private lastSaved = "";
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
    this.bankAnswers = allAnswers(this.bank);
    this.scripted = createScriptedProvider(rng);
    this.epilogueDelayMs = opts.epilogueDelayMs ?? EPILOGUE_DELAY_MS;
    // The key lives in room.env (server only), never in a NEXT_PUBLIC_ variable.
    const apiKey = room.env?.ANTHROPIC_API_KEY;
    this.aiAvailable = !!apiKey;
    if (apiKey || opts.fetch) {
      this.llm = withBreaker(
        createLlmProvider({
          apiKey,
          fetch: opts.fetch,
          getNotes: () => this.notes,
          getStyleExamples: () => this.editedLines,
          forbidden: () => this.bankAnswers,
        }),
        this.breaker,
      );
    }
    const active = (): NarrationProvider => opts.provider ?? (this.aiNarration && this.llm ? this.llm : this.scripted);
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
        if (event.type === "epilogue") {
          this.epilogue = lines[0];
          this.broadcast({ type: "EPILOGUE", text: lines[0] });
          return;
        }
        // Narrations run concurrently (a judgment never waits for the previous event's line), so an
        // older, slower LLM call can resolve after a newer one. Drop it rather than overwrite the
        // newer line on every screen and in the replay a reconnecting client gets. An eventId above
        // eventSeq is a leftover from before a reset(), which zeroes eventSeq.
        if (eventId > this.eventSeq || (this.lastNarration && eventId < this.lastNarration.eventId)) return;
        this.lastNarration = { eventId, lines };
        this.broadcast({ type: "NARRATION", eventId, lines });
        if (eventId === this.eventSeq) this.rearmAdvance(lines);
      },
      record: (entry) => this.addTranscript(entry),
    });
  }

  /** Whether this server has an API key at all; the host may only switch AI on when true. */
  private aiAvailable: boolean;

  private addTranscript(item: TranscriptItem) {
    this.transcript.push(item);
    if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.shift();
  }

  /** Trips are logged apart from fallback counts: a breaker trip is an outage, not a slow line. */
  private onBreakerTrip(why: string) {
    console.warn(JSON.stringify({ narration: "breaker_open", why }));
    this.addTranscript({ kind: "breaker", at: new Date().toISOString(), text: `LLM narration switched off: ${why}` });
  }

  private broadcast(msg: ServerMessage) {
    this.persist();
    this.room.broadcast(JSON.stringify(msg));
  }

  private sendTo(conn: Conn, msg: ServerMessage) {
    this.persist();
    conn.send(JSON.stringify(msg));
    if (msg.type === "ERROR" && conn === this.dispatching) this.rejected = true;
  }

  /** What survives a restart. Teams are saved offline: after a restart nobody is connected until a phone says so. */
  private persistedState(): RoomSnapshot {
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
      notes: this.notes,
      joinPassword: this.joinPassword,
      editedLines: this.editedLines,
      aiNarration: this.aiNarration,
      // Rounded so a run of messages with no other state change does not force a write every time (persist()
      // skips a write when the JSON is unchanged). The granularity scales down with idleMs so a short test
      // duration (seconds) is never rounded away entirely; production's 2-hour default still rounds to the
      // minute. Capped so it never exceeds 60s even for a very long idleMs.
      lastActivityAt: this.lastActivityAt === null ? null : roundActivity(this.lastActivityAt, this.idleMs),
      bank: this.bank,
      phaseCard: this.phaseCard,
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
    if (json === this.lastSaved) return;
    this.lastSaved = json;
    const failed = (err: unknown) => {
      this.lastSaved = ""; // whatever we believed was saved, retry on the next message
      console.error(JSON.stringify({ event: "persist_failed", error: String(err) }));
    };
    try {
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
    if (!s) {
      console.warn(JSON.stringify({ event: "state_discarded", reason: "unreadable" }));
      return "discarded";
    }
    this.roomEpoch = s.roomEpoch;
    // A save from before branchChoices existed has teams missing that field (snapshot.ts's
    // game validation is shallow — it never re-validates individual Team fields, or even that
    // each team entry is an object at all). Backfill so every read site (recordBranchChoice,
    // getSpectatorView) can assume the field always exists. Defensive: a team entry that isn't
    // a real object (which snapshot.ts's own shallow check wouldn't catch) is left
    // as-is rather than crashing here — the room ends up as broken as the corrupt data already
    // made it, same as every other Team field this file never re-validates, not a new failure
    // mode this backfill introduces (see the /review adversarial pass, 2026-09-21).
    this.game =
      s.game && {
        ...s.game,
        // A save from before revealedQuestionIds existed (question-media-content.md's D4/D5)
        // hits the same shallow-snapshot-validation gap as branchChoices above — deal() and
        // nextBossQuestionId() both call .includes() on it unconditionally, so an undamaged
        // backfill here is required or the next correct answer throws inside handleHostJudge's
        // try/catch and gets silently turned into an ERROR sent to the host (test-coverage audit
        // finding, /ship).
        revealedQuestionIds: Array.isArray(s.game.revealedQuestionIds) ? s.game.revealedQuestionIds : [],
        // Same shallow-validation backfill for saves from before phone answering (phone-answering.md).
        eliminated: s.game.eliminated ?? {},
        pendingWrong: restoredPendingWrong(s.game),
        // Not for old saves (SCHEMA_VERSION 5 refuses them): guards a v5 snapshot missing the field.
        optionOrder: s.game.optionOrder ?? {},
        teams: s.game.teams.map((t) =>
          t && typeof t === "object" ? { ...t, branchChoices: t.branchChoices ?? {}, currentSelection: t.currentSelection ?? null } : t,
        ),
      };
    this.pendingTeams = s.pendingTeams;
    this.hostToken = s.hostToken;
    this.teamKeys = new Map(s.teamKeys);
    this.eventSeq = s.eventSeq;
    this.lastNarration = s.lastNarration;
    this.epilogue = s.epilogue;
    this.epilogueRequested = s.epilogueRequested;
    this.notes = s.notes;
    this.joinPassword = s.joinPassword;
    this.editedLines = s.editedLines;
    this.aiNarration = this.aiAvailable && s.aiNarration;
    this.bank = s.bank;
    this.bankAnswers = allAnswers(s.bank);
    this.phaseCard = s.phaseCard ?? false;
    // A save from before boss phases has a one-phase boss.
    if (this.game && !Array.isArray(this.game.boss.phases)) {
      const b = this.game.boss;
      this.game = { ...this.game, boss: { ...b, phases: [{ maxHp: b.maxHp, questionIds: b.questionIds }], phaseIndex: 0 } };
    }
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
    // The story that ends a finished game is written by a promise that a restart loses: ask for it again.
    if (this.game?.phase === "finished" && !this.epilogue) {
      this.epilogueRequested = true;
      void this.sendEpilogue(Promise.resolve(), this.eventSeq).catch((err) => console.error("epilogue failed", err));
    }
    return "restored";
  }

  /** The question in play for the team on turn: what everyone may see, and the host-only answer. */
  private currentQuestion() {
    const game = this.game;
    if (!game || game.phase !== "playing") return null;
    const teamId = currentTurnTeamId(game);
    const team = game.teams.find((t) => t.id === teamId);
    if (!team) return null;
    const id = isInBossPhase(game, team.id) ? game.boss.currentQuestionId : team.currentQuestionId;
    const pub = publicQuestion(this.bank, id, team.roomIndex, this.room.env?.R2_PUBLIC_BASE_URL ?? "", game.optionOrder[id]);
    const q = this.question(id);
    return pub ? { pub, answer: q ? answerText(q) : "" } : null;
  }

  /** A bank question as this game shows it (options in the game's shuffled order). */
  private question(id: string) {
    const q = findQuestion(this.bank, id);
    return q && inShownOrder(q, this.game?.optionOrder[id]);
  }

  /** Who is on turn now and what they face, for the narrator's second line. Null when the game is over. */
  private nextTurn(): NextTurn | null {
    const game = this.game;
    const q = this.currentQuestion();
    const teamId = game && currentTurnTeamId(game);
    const team = game?.teams.find((t) => t.id === teamId);
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
    if (!this.game) return { type: "LOBBY", teams: this.pendingTeams, roomEpoch: this.roomEpoch };
    return {
      type: "STATE",
      view: getSpectatorView(this.game),
      phase: this.game.phase,
      winners: this.game.winners,
      roomEpoch: this.roomEpoch,
      // The card holds the new phase's first question back until the host's 下一題.
      question: this.phaseCard ? null : (this.currentQuestion()?.pub ?? null),
      reveal: this.reveal,
      ...(this.phaseCard ? { phaseCard: { monster: this.bank.boss.monster } } : {}),
      ...this.bossPhaseInfo(),
      pendingLock: this.pendingLock,
      eventId: this.eventSeq,
      ...(this.cue ? { cue: this.cue } : {}),
    };
  }

  private scores(): Record<string, number> {
    return Object.fromEntries((this.game?.teams ?? []).map((t) => [t.name, t.reward]));
  }

  /** Fire-and-forget: narration must never block or break the game. */
  private narrate(eventId: number, event: NarrationEvent): Promise<void> {
    return this.runner.run(eventId, event, this.scores()).catch((err) => {
      console.error("narration failed", err);
    });
  }

  private async sendEpilogue(afterKillShot: Promise<void>, eventId: number) {
    const game = this.game;
    if (!game) return;
    await afterKillShot;
    await wait(this.epilogueDelayMs);
    const ranking = game.teams.map((t) => ({ name: t.name, score: t.reward })).sort((a, b) => b.score - a.score);
    const winners = game.winners.map((id) => game.teams.find((t) => t.id === id)?.name ?? "");
    // One EPILOGUE, whoever writes it: the LLM within its hold, otherwise the program-built story.
    await this.runner.run(eventId, { type: "epilogue", ranking, winners }, this.scores());
  }

  private broadcastState() {
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
    // A lock beat or auto-advance firing during the awaits below would broadcast into a room being deleted.
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
    this.pendingTeams = [];
    this.hostToken = "";
    this.hostConns.clear();
    this.connTeam.clear();
    this.teamKeys.clear();
    this.conns.clear();
    this.eventSeq = 0;
    this.lastNarration = null;
    this.cue = null;
    this.epilogue = null;
    this.epilogueRequested = false;
    this.reveal = null;
    this.phaseCard = false;
    this.phaseCardDue = false;
    this.clearAnswerTimers();
    this.transcript = [];
    this.notes = "";
    this.joinPassword = "";
    this.editedLines = [];
    this.aiNarration = false;
    this.bank = this.initialBank;
    this.bankAnswers = allAnswers(this.bank);
    this.roomEpoch = crypto.randomUUID();
    this.lastSaved = "";
    this.lastActivityAt = null;
    this.alarmAt = null;
  }

  onConnect(conn: Conn) {
    if (this.expiring) {
      conn.close();
      return;
    }
    if (this.conns.size >= MAX_CONNECTIONS) {
      conn.close();
      return;
    }
    // /screen never sends a message at all, so a room that only ever gets watched (never played) needs its own
    // baseline: prime the clock once so it is still eventually rested. Later screen-only reconnects (after that
    // first tick) do NOT touch this again — only an accepted message does — or leaving a TV on would postpone
    // resting forever exactly the way this whole feature exists to prevent.
    if (this.lastActivityAt === null) this.markActivity();
    this.conns.add(conn.id);
    this.sendTo(conn, this.snapshot());
    if (this.lastNarration) this.sendTo(conn, { type: "NARRATION", ...this.lastNarration });
    if (this.epilogue) this.sendTo(conn, { type: "EPILOGUE", text: this.epilogue, replay: true });
  }

  onClose(conn: Conn) {
    this.conns.delete(conn.id);
    this.hostConns.delete(conn.id);
    const teamId = this.connTeam.get(conn.id);
    this.connTeam.delete(conn.id);
    if (!teamId || !this.game) return;
    // The team may already have a newer connection (a reload or reconnect): then it is still online.
    if ([...this.connTeam.values()].includes(teamId)) return;
    try {
      this.game = setTeamOnline(this.game, teamId, false);
      this.broadcastState();
    } catch {
      // Team no longer exists in this game instance — nothing to do.
    }
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
          this.handleJoin(sender, msg.teamId, msg.teamKey, msg.teamName, msg.password ?? "");
          break;
        case "REJOIN":
          this.handleRejoin(sender, msg.teamId, msg.teamKey);
          break;
        case "HOST_START":
          this.handleHostStart(sender, msg.aiNarration);
          break;
        case "HOST_SET_NOTES":
          this.handleSetNotes(sender, msg.notes);
          break;
        case "HOST_SET_PASSWORD":
          if (!this.requireHost(sender)) break;
          this.joinPassword = msg.password.trim();
          // Every host page shows the room's real password only once the room has it.
          for (const conn of this.hostConns.values()) this.sendTo(conn, { type: "HOST_OK", aiAvailable: this.aiAvailable, joinPassword: this.joinPassword });
          break;
        case "HOST_EDIT_NARRATION":
          this.handleEditNarration(sender, msg.line);
          break;
        case "HOST_GET_TRANSCRIPT":
          this.handleTranscript(sender);
          break;
        case "HOST_NEXT":
          this.handleHostNext(sender, msg.eventId);
          break;
        case "HOST_SEND_TO_BOSS":
          this.handleSendToBoss(sender, msg.teamId);
          break;
        case "HOST_QUEUE_QUESTION":
          this.handleQueueQuestion(sender, msg.target, msg.questionId);
          break;
        case "HOST_JUDGE":
          this.handleHostJudge(sender, msg.teamId, msg.questionId, msg.correct, msg.fleeChoice, msg.eventId);
          break;
        case "TEAM_BRANCH_CHOICE":
          this.handleTeamBranchChoice(sender, msg.roomIndex, msg.choice);
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
      }
      // A transcript download changes nothing; a rejected message did not either; and an automatic
      // reconnect's re-identification (`resume`) is a device, not a person.
      const resumed = "resume" in msg && msg.resume === true;
      if (msg.type !== "HOST_GET_TRANSCRIPT" && !this.rejected && !resumed) {
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
    this.sendTo(conn, { type: "HOST_OK", aiAvailable: this.aiAvailable, joinPassword: this.joinPassword });
    this.sendAnswer(conn);
    this.sendPicks(conn);
  }

  private handleJoin(conn: Conn, teamId: string, teamKey: string, rawName: string, password: string) {
    if (!UUID_RE.test(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
      return;
    }
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
    if (this.joinPassword && !tokensEqual(this.joinPassword, password.trim())) {
      this.sendTo(conn, { type: "ERROR", error: "bad_password" });
      return;
    }
    const name = sanitizeText(rawName, MAX_TEAM_NAME_LENGTH);
    if (!name) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_name" });
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
    const known = this.teamKeys.get(teamId);
    if (known === undefined) {
      this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
      return;
    }
    if (!this.claimTeam(conn, teamId, teamKey, known)) return;
    if (this.game) this.broadcastState();
    else this.sendTo(conn, this.snapshot());
  }

  /** Binds `conn` to an existing team if `teamKey` matches the team's key `known`, and marks the team online. */
  private claimTeam(conn: Conn, teamId: string, teamKey: string, known: string): boolean {
    if (!tokensEqual(known, teamKey)) {
      this.sendTo(conn, { type: "ERROR", error: "bad_token" });
      return false;
    }
    this.connTeam.set(conn.id, teamId);
    if (this.game) this.game = setTeamOnline(this.game, teamId, true);
    return true;
  }

  private handleHostNext(conn: Conn, eventId: number) {
    if (!this.requireHost(conn)) return;
    // The reveal is always set in the same judgment that bumps eventSeq, so a HOST_NEXT for an
    // older STATE is stale — ignore it rather than close a reveal nobody has seen.
    if (!this.paused() || eventId !== this.eventSeq) return;
    if (this.reveal) return this.closeReveal();
    if (this.phaseCardDue) return this.openPhaseCard();
    this.phaseCard = false;
    this.broadcastState();
  }

  /** An answer reveal or the boss's phase card is up: nobody answers until the host moves on. */
  private paused(): boolean {
    return !!this.reveal || this.phaseCard || this.phaseCardDue;
  }

  private closeReveal() {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
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
    this.cue = "boss-phase";
    const phase = this.bank.boss.phases[game.boss.phaseIndex];
    this.broadcastState();
    const event: NarrationEvent = { type: "boss-phase", monster: this.bank.boss.monster.name, phase: game.boss.phaseIndex + 1, name: phase.name, rule: phase.rule };
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
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    if (this.phaseCardTimer) clearTimeout(this.phaseCardTimer);
    this.lockTimer = this.advanceTimer = this.phaseCardTimer = null;
    this.pendingLock = null;
  }

  /**
   * (Re)arms the auto-advance of the open multipleChoice reveal (E4): 8 s after the reveal, later if the
   * voice is still reading `lines` (counted from now, when they reached the screens), never past 15 s.
   * A no-op unless an auto-advancing reveal is open, so text questions keep waiting for HOST_NEXT.
   */
  private rearmAdvance(lines?: string[]) {
    if (!this.reveal || (lines && !this.advanceTimer)) return;
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    const sinceReveal = this.now() - this.revealAt;
    const due = Math.min(ADVANCE_CAP_MS, Math.max(ADVANCE_MS, lines ? sinceReveal + speechMs(lines) : 0));
    const eventId = this.eventSeq;
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null;
      // Only the reveal this timer was set for (R2-4): HOST_NEXT or a newer judgment already moved on.
      if (this.reveal && this.eventSeq === eventId) this.closeReveal();
    }, Math.max(0, due - sinceReveal));
  }

  private handleTranscript(conn: Conn) {
    if (!this.requireHost(conn)) return;
    this.sendTo(conn, { type: "TRANSCRIPT", entries: this.transcript });
  }

  private handleSetNotes(conn: Conn, raw: string) {
    if (!this.requireHost(conn)) return;
    this.notes = sanitizeText(raw, MAX_NOTES);
    this.addTranscript({ kind: "notes", at: new Date().toISOString(), text: this.notes });
  }

  /** The host rewrites the line on screen. It wins over anything the LLM does later for that event. */
  private handleEditNarration(conn: Conn, raw: string) {
    if (!this.requireHost(conn)) return;
    const line = sanitizeText(raw, MAX_EDIT_LINE);
    if (!this.lastNarration) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "no_narration" });
      return;
    }
    if (!line) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "empty_line" });
      return;
    }
    // Edits only the first segment (the "what happened" line) — the host has no visibility into
    // which segment a given client is currently displaying (that timing is client-side, in
    // Sequence), so editing later segments is left for a future redesign. See
    // docs/designs/multi-segment-narration.md's Open Questions.
    const { eventId, lines } = this.lastNarration;
    const newLines = [line, ...lines.slice(1)];
    this.lastNarration = { eventId, lines: newLines };
    this.editedLines = [...this.editedLines, line].slice(-STYLE_EXAMPLES);
    this.addTranscript({ kind: "edit", at: new Date().toISOString(), text: line, eventId });
    this.broadcast({ type: "NARRATION", eventId, lines: newLines });
    // A longer line read out again must not be cut off by the auto-advance (E12).
    if (eventId === this.eventSeq) this.rearmAdvance(newLines);
  }

  private handleHostStart(conn: Conn, aiNarration?: boolean) {
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
    this.game = createGame(
      this.pendingTeams,
      roomTemplates(this.bank),
      poolQuestionIds(this.bank),
      firstPhase.questionIds,
      DEFAULT_GAME_CONFIG,
      firstPhase.maxHp,
      this.rng,
      this.bank.boss.hitReward,
      shuffledOptionOrders(this.bank, this.rng),
      laterPhases,
    );
    // Default on when a key exists; the host can switch it off before starting.
    // gstack-shortcut(dec-db628e32): no cap on paid narration calls per room or overall (anyone can
    // host a room), only the Anthropic spend limit; upgrade when that limit is hit or usage shows
    // abuse: a per-room narration budget that falls back to scripted lines (TODOS.md).
    this.aiNarration = this.aiAvailable && aiNarration !== false;
    const eventId = ++this.eventSeq;
    this.cue = "start";
    this.broadcastState();
    const next = this.nextTurn();
    void this.narrate(eventId, { type: "start", teams: this.pendingTeams.map((t) => t.name), ...(next ? { next } : {}) });
  }

  private handleHostJudge(
    conn: Conn,
    teamId: string,
    questionId: string,
    correct: boolean,
    fleeChoice?: "flee" | "retry",
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
    if (this.paused() || this.pendingLock) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: this.paused() ? "reveal_pending" : "lock_pending" });
      return;
    }
    // A multipleChoice question is judged by its lock; the host may only pick 重答 / 逃跑 for a stuck
    // team (E5), never 答對.
    if (correct && this.question(questionId)?.kind === "multipleChoice") {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "auto_judged" });
      return;
    }
    try {
      this.judge(teamId, questionId, correct, fleeChoice ?? "retry", false);
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }

  private handleSendToBoss(conn: Conn, teamId: string) {
    if (!this.requireHost(conn)) return;
    if (!this.game) {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }
    // A lock in its beat would then be judged against a room question the team no longer faces.
    if (this.pendingLock?.teamId === teamId) {
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

  /** Applies one answer; throws InvalidActionError (from answerQuestion) before changing anything. */
  private judge(teamId: string, questionId: string, correct: boolean, fleeChoice: "flee" | "retry", autoAdvance: boolean) {
    const prev = this.game;
    if (!prev) return;
    // Captured before `this.game` reassigns to the post-judgment state below: the monster name
    // and the reveal must describe the question that was JUST answered, not whatever
    // currentQuestion() would return afterwards (the next one) — a trap this file's own
    // narration code already had to work around once (Outside Voice finding, /plan-eng-review).
    const justAnswered = this.currentQuestion();
    const monster = justAnswered?.pub.monster.name ?? "怪物";
    // A boss MC miss has no flee (D2=B): the host's stuck row (button or key 3) resolves it as the beat would.
    if (!correct && prev.pendingWrong?.teamId === teamId && isInBossPhase(prev, teamId)) fleeChoice = "retry";
    const { game, outcome } = answerQuestion(prev, teamId, questionId, correct, fleeChoice, this.rng);
    // Everything up to broadcastState is synchronous: state changes and the eventId are
    // fixed before any narration awaits, so concurrent judgments cannot interleave.
    this.game = game;
    const eventId = ++this.eventSeq;
    const phaseName = prev.boss.phaseIndex > 0 ? this.bank.boss.phases[prev.boss.phaseIndex]?.name : undefined;
    const base = toNarrationEvent(prev, outcome, monster, this.nextTurn() ?? undefined, phaseName);
    // A phase out of questions: no "try again" and no hearts count, its card comes next.
    const event = game.boss.phasePending === "exhausted" && (base.type === "retry" || base.type === "boss-hit") ? { ...base, exhausted: true as const } : base;
    this.cue = event.type === "epilogue" ? null : event.type;
    // Shown to everyone (D3), but only on a genuinely correct answer (D5): a retry or a flee
    // must never reveal it, or the question loses its point; game-state.ts's deal()/boss ring
    // treat a revealed question (answered, or fled after a wrong lock) as not safe to redeal. Set before broadcastState so the reveal and the post-judgment state arrive
    // together in one STATE — no window where a client shows the next question first.
    this.reveal = null;
    if ((outcome.type === "correct-room-advance" || outcome.type === "correct-boss-hit") && justAnswered) {
      const imageBaseUrl = this.room.env?.R2_PUBLIC_BASE_URL ?? "";
      const explanation = publicExplanation(this.bank, questionId, imageBaseUrl);
      const q = this.question(questionId);
      const choice =
        autoAdvance && q?.kind === "multipleChoice"
          ? { options: q.options, correctIndex: q.correctIndex, teamId, points: outcome.reward }
          : undefined;
      this.reveal = { questionId, answer: justAnswered.answer, ...(explanation ? { explanation } : {}), ...(choice ? { choice } : {}) };
      this.revealAt = this.now();
      // Armed before narrate() so the narration's arrival can re-arm it (E4).
      if (autoAdvance && game.phase === "playing") this.rearmAdvance();
    }
    this.broadcastState();
    const narration = this.narrate(eventId, event);
    if (game.phase === "finished" && !this.epilogueRequested) {
      this.epilogueRequested = true;
      void this.sendEpilogue(narration, eventId).catch((err) => console.error("epilogue failed", err));
    }
    // A miss that used up a boss phase has no answer to show: its card follows once the retry line has
    // been read (D7), held like a reveal; 下一題 opens it sooner.
    if (game.phase === "playing" && game.boss.phasePending && !this.reveal) {
      this.phaseCardDue = true;
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

  /** A team locks its current pick (E2, E11). Judged after the beat, in resolveLock. `shown` is the
   * pick the phone showed when pressed; a different room pick means another phone on the team changed it. */
  private handleTeamLockOption(conn: Conn, questionId: string, shown?: number) {
    const teamId = this.playingTeam(conn);
    const game = this.game;
    if (!teamId || !game) return;
    const team = game.teams.find((t) => t.id === teamId);
    const q = this.question(questionId);
    const reject = (detail: string) => this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    if (this.paused()) return reject("reveal_pending");
    if (this.pendingLock || game.pendingWrong) return reject("answer_pending");
    if (game.phase !== "playing" || currentTurnTeamId(game) !== teamId) return reject("not_your_turn");
    if (q?.kind !== "multipleChoice" || currentQuestionIdOf(game, teamId) !== questionId) return reject("stale_question");
    const pick = team?.currentSelection ?? null;
    if (pick === null || pick >= q.options.length || game.eliminated[questionId]?.includes(pick)) return reject("no_selection");
    if (shown !== undefined && shown !== pick) return reject("selection_changed");
    this.pendingLock = { teamId, questionId, optionIndex: pick };
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
      // The team's phone dropped during the beat and the turn moved on (E9): drop the lock; it locks again.
      if (currentTurnTeamId(game) !== lock.teamId || currentQuestionIdOf(game, lock.teamId) !== lock.questionId) {
        this.broadcastState();
      } else if (q?.kind === "multipleChoice" && q.correctIndex === lock.optionIndex) {
        this.judge(lock.teamId, lock.questionId, true, "retry", true);
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
  }

  /** A wrong boss lock has no 重答 / 逃跑 choice (boss redesign D2=B): both would rotate the shared
   * question anyway. The red tile shows for a beat, then it resolves as a retry on its own. */
  private armBossMiss() {
    const pending = this.game?.pendingWrong;
    if (!pending || !isInBossPhase(this.game!, pending.teamId)) return;
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => {
      // Resolved early (the host judged it): lockTimer may already be the next lock's beat.
      if (this.game?.pendingWrong !== pending) return;
      this.lockTimer = null;
      try {
        this.judge(pending.teamId, pending.questionId, false, "retry", false);
      } catch (err) {
        console.error(JSON.stringify({ event: "boss_miss_failed", error: String(err) }));
      }
    }, BEAT_MS);
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
    // A boss miss resolves on its own beat (D2=B): a phone cannot cut the red tile short.
    if (isInBossPhase(this.game!, teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "boss_miss" });
      return;
    }
    try {
      this.judge(teamId, questionId, false, choice, false);
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

  /** DM branching interlude pick. The team is derived from `connTeam` — never from a
   * client-supplied id — so a connection can only ever choose for its own team. */
  private handleTeamBranchChoice(conn: Conn, roomIndex: number, choice: BranchOptionId) {
    const teamId = this.playingTeam(conn);
    if (!teamId || !this.game) return;
    try {
      this.game = recordBranchChoice(this.game, teamId, roomIndex, choice);
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
    if (this.pendingLock?.teamId === teamId || this.game.pendingWrong?.teamId === teamId) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "answer_pending" });
      return;
    }
    // The protocol layer only checked optionIndex >= 0; the real bounds check needs the
    // live question's actual options.length, which only this layer (with bank access) has.
    const q = this.question(questionId);
    if (!q || q.kind !== "multipleChoice" || optionIndex >= q.options.length) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: `bad optionIndex for ${questionId}` });
      return;
    }
    // Re-tapping the option a team already has selected is a no-op: nothing about the game
    // state would actually change, so skip the persist()+broadcast() this message would
    // otherwise unconditionally trigger. TEAM_SELECT_OPTION has no other rate limit (unlike
    // TEAM_BRANCH_CHOICE, which self-limits to one accepted pick per room) — this at least
    // keeps an idle-fingered phone from writing/broadcasting on every repeat tap of the same
    // button (adversarial review finding).
    if (this.game.teams.find((t) => t.id === teamId)?.currentSelection === optionIndex) return;
    try {
      this.game = recordOptionSelection(this.game, teamId, questionId, optionIndex);
      this.broadcastState();
    } catch (err) {
      this.sendInvalid(conn, err);
    }
  }
}
