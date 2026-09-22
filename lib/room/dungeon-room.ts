import type { Conn, RoomIO } from "./io";
import { CLOSE_IDLE } from "./close-codes";
import { parseSnapshot, SCHEMA_VERSION, SNAPSHOT_KEY, type RoomSnapshot } from "./snapshot";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  answerQuestion,
  recordBranchChoice,
  recordOptionSelection,
  setTeamOnline,
  getSpectatorView,
  currentTurnTeamId,
  isInBossPhase,
  InvalidActionError,
  type BranchOptionId,
  type GameState,
} from "../game-state";
import { MAX_EDIT_LINE, MAX_NOTES, MAX_TEAMS, parseClientMessage, sanitizeText, type ServerMessage } from "../protocol";
import { BANK, answerText, bossQuestionIds, findQuestion, publicQuestion, roomTemplates, type Bank } from "../question-bank";
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
const EXPIRE_MS = 24 * 60 * 60 * 1000;
/** Sockets per room: players, screens and the host, with room to spare. Stops one client opening thousands. */
const MAX_CONNECTIONS = 60;
/** Lets the kill-shot line be read before the story arrives. */
const EPILOGUE_DELAY_MS = 4000;

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
const allAnswers = (bank: Bank) => [...bank.rooms.flatMap((r) => r.questions), ...bank.boss.questions].map(answerText);

/**
 * Round an activity timestamp down for storage, at a granularity scaled to idleMs so the rounding error
 * a restart could introduce is always small relative to the idle window (at most idleMs/60, capped at 60s).
 */
function roundActivity(at: number, idleMs: number): number {
  const granularity = Math.max(1, Math.min(60_000, Math.floor(idleMs / 60)));
  return Math.floor(at / granularity) * granularity;
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidTeamId(id: string): boolean {
  return UUID_RE.test(id);
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
  /** Changes whenever the room instance restarts, so clients can show "game reset". */
  private roomEpoch = crypto.randomUUID();
  /** connection id -> team id, so onClose can mark the right team offline. Only set after the connection proved the team key. */
  private connTeam = new Map<string, string>();
  /** team id -> team secret, set by the team's first JOIN (teamId is public, the key is not). */
  private teamKeys = new Map<string, string>();
  /** Live connections we accepted, for the per-room cap. */
  private conns = new Set<string>();

  /** `rng` is injectable so tests can make question dealing deterministic. */
  /** Counts the start and every accepted judgment; each gets exactly one NARRATION. */
  private eventSeq = 0;
  private lastNarration: { eventId: number; line: string; then?: string } | null = null;
  private epilogue: string | null = null;
  /** Set synchronously before anything awaits, so a re-broadcast of GAME_OVER cannot start a second epilogue. */
  private epilogueRequested = false;
  private transcript: TranscriptItem[] = [];
  /** Host director: notes for the LLM and the last few hand-edited lines. */
  private notes = "";
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
      emit: (eventId, line, _provider, event, then) => {
        if (event.type === "epilogue") {
          this.epilogue = line;
          this.broadcast({ type: "EPILOGUE", text: line });
          return;
        }
        this.lastNarration = { eventId, line, ...(then ? { then } : {}) };
        this.broadcast({ type: "NARRATION", eventId, line, ...(then ? { then } : {}) });
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
      editedLines: this.editedLines,
      aiNarration: this.aiNarration,
      // Rounded so a run of messages with no other state change does not force a write every time (persist()
      // skips a write when the JSON is unchanged). The granularity scales down with idleMs so a short test
      // duration (seconds) is never rounded away entirely; production's 2-hour default still rounds to the
      // minute. Capped so it never exceeds 60s even for a very long idleMs.
      lastActivityAt: this.lastActivityAt === null ? null : roundActivity(this.lastActivityAt, this.idleMs),
      bank: this.bank,
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
    this.editedLines = s.editedLines;
    this.aiNarration = this.aiAvailable && s.aiNarration;
    this.bank = s.bank;
    this.bankAnswers = allAnswers(s.bank);
    // A save from before activity was tracked counts as active now: never expire a room we cannot date.
    this.lastActivityAt = s.lastActivityAt ?? this.now();
    this.lastSaved = JSON.stringify(this.persistedState());
    const idleFor = this.now() - this.lastActivityAt;
    this.setAlarmAt(Math.max(this.now(), this.lastActivityAt + (idleFor >= this.idleMs ? this.expireMs : this.idleMs)));
    console.log(JSON.stringify({ event: "state_restored", phase: this.game?.phase ?? "lobby", eventSeq: this.eventSeq }));
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
    const pub = publicQuestion(this.bank, id, team.currentDifficulty);
    const q = findQuestion(this.bank, id);
    return pub ? { pub, answer: q ? answerText(q) : "" } : null;
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

  private snapshot(): ServerMessage {
    if (!this.game) return { type: "LOBBY", teams: this.pendingTeams, roomEpoch: this.roomEpoch };
    return {
      type: "STATE",
      view: getSpectatorView(this.game),
      phase: this.game.phase,
      winners: this.game.winners,
      roomEpoch: this.roomEpoch,
      question: this.currentQuestion()?.pub ?? null,
      eventId: this.eventSeq,
    };
  }

  private scores(): Record<string, number> {
    return Object.fromEntries((this.game?.teams ?? []).map((t) => [t.name, t.score]));
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
    const ranking = game.teams.map((t) => ({ name: t.name, score: t.score })).sort((a, b) => b.score - a.score);
    const winners = game.winners.map((id) => game.teams.find((t) => t.id === id)?.name ?? "");
    // One EPILOGUE, whoever writes it: the LLM within its hold, otherwise the program-built story.
    await this.runner.run(eventId, { type: "epilogue", ranking, winners }, this.scores());
  }

  private broadcastState() {
    this.broadcast(this.snapshot());
    // The answer goes only to connections that hold the host token, never to broadcast.
    for (const conn of this.hostConns.values()) this.sendAnswer(conn);
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
    this.room.closeAll?.(CLOSE_IDLE, "expired");
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
    this.game = null;
    this.pendingTeams = [];
    this.hostToken = "";
    this.hostConns.clear();
    this.connTeam.clear();
    this.teamKeys.clear();
    this.conns.clear();
    this.eventSeq = 0;
    this.lastNarration = null;
    this.epilogue = null;
    this.epilogueRequested = false;
    this.transcript = [];
    this.notes = "";
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
    if (this.epilogue) this.sendTo(conn, { type: "EPILOGUE", text: this.epilogue });
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
          this.handleJoin(sender, msg.teamId, msg.teamKey, msg.teamName);
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
        case "HOST_EDIT_NARRATION":
          this.handleEditNarration(sender, msg.line);
          break;
        case "HOST_GET_TRANSCRIPT":
          this.handleTranscript(sender);
          break;
        case "HOST_JUDGE":
          this.handleHostJudge(sender, msg.teamId, msg.questionId, msg.correct, msg.fleeChoice);
          break;
        case "TEAM_BRANCH_CHOICE":
          this.handleTeamBranchChoice(sender, msg.roomIndex, msg.choice);
          break;
        case "TEAM_SELECT_OPTION":
          this.handleTeamSelectOption(sender, msg.questionId, msg.optionIndex);
          break;
      }
      // A transcript download changes nothing; a rejected message did not either.
      if (msg.type !== "HOST_GET_TRANSCRIPT" && !this.rejected) {
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
    this.sendTo(conn, { type: "HOST_OK", aiAvailable: this.aiAvailable });
    this.sendAnswer(conn);
  }

  private handleJoin(conn: Conn, teamId: string, teamKey: string, rawName: string) {
    if (!isValidTeamId(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
      return;
    }
    const known = this.teamKeys.get(teamId);
    if (known !== undefined) {
      // An existing team: only the client holding its key may speak for it. During a game this is a
      // reconnect or a page reload (the phone sends JOIN each time its socket opens).
      if (!tokensEqual(known, teamKey)) {
        this.sendTo(conn, { type: "ERROR", error: "bad_token" });
        return;
      }
      this.connTeam.set(conn.id, teamId);
      if (this.game) this.game = setTeamOnline(this.game, teamId, true);
      this.broadcastState();
      return;
    }
    if (this.game) {
      this.sendTo(conn, { type: "ERROR", error: "game_already_started" });
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
    if (!isValidTeamId(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
      return;
    }
    const known = this.teamKeys.get(teamId);
    if (known === undefined) {
      this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
      return;
    }
    if (!tokensEqual(known, teamKey)) {
      this.sendTo(conn, { type: "ERROR", error: "bad_token" });
      return;
    }
    this.connTeam.set(conn.id, teamId);
    if (this.game) {
      this.game = setTeamOnline(this.game, teamId, true);
      this.broadcastState();
      return;
    }
    this.sendTo(conn, this.snapshot());
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
    const { eventId, then } = this.lastNarration;
    this.lastNarration = { eventId, line, ...(then ? { then } : {}) };
    this.editedLines = [...this.editedLines, line].slice(-STYLE_EXAMPLES);
    this.addTranscript({ kind: "edit", at: new Date().toISOString(), text: line, eventId });
    this.broadcast({ type: "NARRATION", eventId, line, ...(then ? { then } : {}) });
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

    this.game = createGame(
      this.pendingTeams,
      roomTemplates(this.bank),
      bossQuestionIds(this.bank),
      DEFAULT_GAME_CONFIG,
      this.bank.boss.maxHp,
      this.rng,
    );
    // Default on when a key exists; the host can switch it off before starting.
    this.aiNarration = this.aiAvailable && aiNarration !== false;
    const eventId = ++this.eventSeq;
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
  ) {
    if (!this.requireHost(conn)) return;
    if (!this.game) {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }

    try {
      const prev = this.game;
      const monster = this.currentQuestion()?.pub.monster.name ?? "怪物";
      const { game, outcome } = answerQuestion(prev, teamId, questionId, correct, fleeChoice ?? "retry", this.rng);
      // Everything up to broadcastState is synchronous: state changes and the eventId are
      // fixed before any narration awaits, so concurrent judgments cannot interleave.
      this.game = game;
      const eventId = ++this.eventSeq;
      const event = toNarrationEvent(prev, outcome, monster, this.nextTurn() ?? undefined);
      this.broadcastState();
      const narration = this.narrate(eventId, event);
      if (game.phase === "finished" && !this.epilogueRequested) {
        this.epilogueRequested = true;
        void this.sendEpilogue(narration, eventId).catch((err) => console.error("epilogue failed", err));
      }
    } catch (err) {
      const detail = err instanceof InvalidActionError ? err.message : "unknown error";
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    }
  }

  /** DM branching interlude pick. The team is derived from `connTeam` — never from a
   * client-supplied id — so a connection can only ever choose for its own team. */
  private handleTeamBranchChoice(conn: Conn, roomIndex: number, choice: BranchOptionId) {
    const teamId = this.connTeam.get(conn.id);
    if (!teamId) {
      this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
      return;
    }
    if (!this.game) {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }
    try {
      this.game = recordBranchChoice(this.game, teamId, roomIndex, choice);
      this.broadcastState();
    } catch (err) {
      const detail = err instanceof InvalidActionError ? err.message : "unknown error";
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    }
  }

  private handleTeamSelectOption(conn: Conn, questionId: string, optionIndex: number) {
    const teamId = this.connTeam.get(conn.id);
    if (!teamId) {
      this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
      return;
    }
    if (!this.game) {
      this.sendTo(conn, { type: "ERROR", error: "no_active_game" });
      return;
    }
    // The protocol layer only checked optionIndex >= 0; the real bounds check needs the
    // live question's actual options.length, which only this layer (with bank access) has.
    const q = findQuestion(this.bank, questionId);
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
      const detail = err instanceof InvalidActionError ? err.message : "unknown error";
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    }
  }
}
