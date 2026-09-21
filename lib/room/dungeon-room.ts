import type { Conn, RoomIO } from "./io";
import { parseSnapshot, SCHEMA_VERSION, SNAPSHOT_KEY, type RoomSnapshot } from "./snapshot";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  answerQuestion,
  setTeamOnline,
  getSpectatorView,
  currentTurnTeamId,
  isInBossPhase,
  InvalidActionError,
  type GameState,
} from "../game-state";
import { MAX_EDIT_LINE, MAX_NOTES, MAX_TEAMS, parseClientMessage, sanitizeText, type ServerMessage } from "../protocol";
import { BANK, bossQuestionIds, findQuestion, publicQuestion, roomTemplates, type Bank } from "../question-bank";
import { tokensEqual } from "../tokens";
import { toNarrationEvent, type NarrationEvent, type NextTurn } from "../narration/events";
import { createScriptedProvider, type NarrationProvider } from "../narration/scripted";
import { createRunner, type TranscriptItem } from "../narration/runner";
import { createLlmProvider } from "../narration/llm";
import { createBreaker, withBreaker } from "../narration/breaker";

const MAX_TEAM_NAME_LENGTH = 20;
const MAX_TRANSCRIPT = 500;
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
}
const STYLE_EXAMPLES = 5;
/** Server-side only: every answer in a bank, so a narration line that repeats one is rejected. */
const allAnswers = (bank: Bank) => [...bank.rooms.flatMap((r) => r.questions), ...bank.boss.questions].map((q) => q.answer);
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
  /** The bank this room plays with, and every answer in it (server-side only, so an LLM line that repeats one is rejected). */
  private bank: Bank;
  private bankAnswers: string[];

  constructor(
    readonly room: RoomIO,
    private rng: () => number = Math.random,
    opts: RoomOptions = {},
  ) {
    this.bank = opts.bank ?? BANK;
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
      bank: this.bank,
    };
  }

  /**
   * Save the room, without awaiting. Called before every outgoing message: on Cloudflare the message is then
   * held until this write is durable, and a failed write resets the object instead of letting the message out.
   * A write that changes nothing is skipped.
   */
  private persist() {
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
    this.game = s.game;
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
    this.lastSaved = JSON.stringify(this.persistedState());
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
    return pub ? { pub, answer: findQuestion(this.bank, id)?.answer ?? "" } : null;
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

  onConnect(conn: Conn) {
    if (this.conns.size >= MAX_CONNECTIONS) {
      conn.close();
      return;
    }
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
}
