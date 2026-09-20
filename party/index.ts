import type * as Party from "partykit/server";
import {
  createGame,
  answerQuestion,
  setTeamOnline,
  getSpectatorView,
  currentTurnTeamId,
  isInBossPhase,
  InvalidActionError,
  type GameState,
} from "../lib/game-state";
import { DEFAULT_ROOMS, DEFAULT_BOSS_QUESTION_IDS, DEFAULT_BOSS_MAX_HP, DEFAULT_GAME_CONFIG } from "../lib/fixtures";
import { MAX_TEAMS, parseClientMessage, sanitizeText, type ServerMessage } from "../lib/protocol";
import { BANK, findQuestion, publicQuestion } from "../lib/question-bank";
import { toNarrationEvent, type NarrationEvent } from "../lib/narration/events";
import { createScriptedProvider, scriptedEpilogue, type NarrationProvider } from "../lib/narration/scripted";
import { createRunner, type TranscriptEntry } from "../lib/narration/runner";

const MAX_TEAM_NAME_LENGTH = 20;
const MAX_TRANSCRIPT = 500;
/** Lets the kill-shot line be read before the story arrives. */
const EPILOGUE_DELAY_MS = 4000;

export interface RoomOptions {
  /** How long a narration may take before the scripted line is used. */
  holdMs?: number;
  epilogueDelayMs?: number;
  /** Swap in another narrator (an LLM, later). Scripted is always the fallback. */
  provider?: NarrationProvider;
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidTeamId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Compare in time that does not depend on where the strings first differ. */
function tokensEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Iteration 1 has no persistence (Open Questions: 純 in-memory 決定) — a
 * server restart loses the whole game, and that's a known/accepted
 * limitation for a single lightweight playtest session, not a bug.
 */
export default class DungeonRoom implements Party.Server {
  game: GameState | null = null;
  private pendingTeams: { id: string; name: string }[] = [];
  /**
   * Trust on first use: the first HOST_CLAIM sets the token, later claims must
   * match. The only protection is the 4-letter room code (23^4) plus this token.
   */
  private hostToken = "";
  // ponytail: in-memory Map. If hibernation is ever enabled it must move to conn.setState.
  private hostConns = new Map<string, Party.Connection>();
  /** Changes whenever the room instance restarts, so clients can show "game reset". */
  private roomEpoch = crypto.randomUUID();
  /** connection id -> team id, so onClose can mark the right team offline. */
  private connTeam = new Map<string, string>();

  /** `rng` is injectable so tests can make question dealing deterministic. */
  /** Counts the start and every accepted judgment; each gets exactly one NARRATION. */
  private eventSeq = 0;
  private lastNarration: { eventId: number; line: string } | null = null;
  private epilogue: string | null = null;
  /** Set synchronously before anything awaits, so a re-broadcast of GAME_OVER cannot start a second epilogue. */
  private epilogueRequested = false;
  private transcript: TranscriptEntry[] = [];
  private scripted: ReturnType<typeof createScriptedProvider>;
  private runner: ReturnType<typeof createRunner>;
  private epilogueDelayMs: number;

  constructor(
    readonly room: Party.Room,
    private rng: () => number = Math.random,
    opts: RoomOptions = {},
  ) {
    this.scripted = createScriptedProvider(rng);
    this.epilogueDelayMs = opts.epilogueDelayMs ?? EPILOGUE_DELAY_MS;
    this.runner = createRunner({
      provider: opts.provider ?? this.scripted,
      fallback: this.scripted,
      holdMs: opts.holdMs,
      emit: (eventId, line) => {
        this.lastNarration = { eventId, line };
        this.broadcast({ type: "NARRATION", eventId, line });
      },
      record: (entry) => {
        this.transcript.push(entry);
        if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.shift();
      },
    });
  }

  private broadcast(msg: ServerMessage) {
    this.room.broadcast(JSON.stringify(msg));
  }

  private sendTo(conn: Party.Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  /** The question in play for the team on turn: what everyone may see, and the host-only answer. */
  private currentQuestion() {
    const game = this.game;
    if (!game || game.phase !== "playing") return null;
    const teamId = currentTurnTeamId(game);
    const team = game.teams.find((t) => t.id === teamId);
    if (!team) return null;
    const id = isInBossPhase(game, team.id) ? game.boss.currentQuestionId : team.currentQuestionId;
    const pub = publicQuestion(BANK, id, team.currentDifficulty);
    return pub ? { pub, answer: findQuestion(BANK, id)?.answer ?? "" } : null;
  }

  private sendAnswer(conn: Party.Connection) {
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

  private async sendEpilogue(afterKillShot: Promise<void>) {
    const game = this.game;
    if (!game) return;
    await afterKillShot;
    await wait(this.epilogueDelayMs);
    const ranking = game.teams.map((t) => ({ name: t.name, score: t.score })).sort((a, b) => b.score - a.score);
    const winners = game.winners.map((id) => game.teams.find((t) => t.id === id)?.name ?? "");
    this.epilogue = scriptedEpilogue(ranking, winners, this.rng);
    this.broadcast({ type: "EPILOGUE", text: this.epilogue });
  }

  private broadcastState() {
    this.broadcast(this.snapshot());
    // The answer goes only to connections that hold the host token, never to broadcast.
    for (const conn of this.hostConns.values()) this.sendAnswer(conn);
    if (this.game?.phase === "finished") {
      this.broadcast({ type: "GAME_OVER", winners: this.game.winners });
    }
  }

  onConnect(conn: Party.Connection) {
    this.sendTo(conn, this.snapshot());
    if (this.lastNarration) this.sendTo(conn, { type: "NARRATION", ...this.lastNarration });
    if (this.epilogue) this.sendTo(conn, { type: "EPILOGUE", text: this.epilogue });
  }

  onClose(conn: Party.Connection) {
    this.hostConns.delete(conn.id);
    const teamId = this.connTeam.get(conn.id);
    this.connTeam.delete(conn.id);
    if (!teamId || !this.game) return;
    try {
      this.game = setTeamOnline(this.game, teamId, false);
      this.broadcastState();
    } catch {
      // Team no longer exists in this game instance — nothing to do.
    }
  }

  private isHost(conn: Party.Connection): boolean {
    return this.hostConns.has(conn.id);
  }

  onMessage(message: string, sender: Party.Connection) {
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
        this.handleJoin(sender, msg.teamId, msg.teamName);
        break;
      case "REJOIN":
        this.handleRejoin(sender, msg.teamId);
        break;
      case "HOST_START":
        this.handleHostStart(sender);
        break;
      case "HOST_GET_TRANSCRIPT":
        this.handleTranscript(sender);
        break;
      case "HOST_JUDGE":
        this.handleHostJudge(sender, msg.teamId, msg.questionId, msg.correct, msg.fleeChoice);
        break;
    }
  }

  private handleHostClaim(conn: Party.Connection, token: string) {
    if (!this.hostToken) this.hostToken = token;
    if (!tokensEqual(this.hostToken, token)) {
      this.sendTo(conn, { type: "ERROR", error: "bad_token" });
      return;
    }
    this.hostConns.set(conn.id, conn);
    this.sendTo(conn, { type: "HOST_OK" });
    this.sendAnswer(conn);
  }

  private handleJoin(conn: Party.Connection, teamId: string, rawName: string) {
    if (!isValidTeamId(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
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
    if (
      this.pendingTeams.length >= MAX_TEAMS &&
      !this.pendingTeams.some((t) => t.id === teamId)
    ) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail: "room_full" });
      return;
    }

    this.connTeam.set(conn.id, teamId);
    if (!this.pendingTeams.some((t) => t.id === teamId)) {
      this.pendingTeams.push({ id: teamId, name });
    }
    this.broadcastState();
  }

  private handleRejoin(conn: Party.Connection, teamId: string) {
    if (!isValidTeamId(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
      return;
    }

    if (this.game) {
      const known = this.game.teams.some((t) => t.id === teamId);
      if (!known) {
        this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
        return;
      }
      this.connTeam.set(conn.id, teamId);
      this.game = setTeamOnline(this.game, teamId, true);
      this.broadcastState();
      return;
    }

    const known = this.pendingTeams.some((t) => t.id === teamId);
    if (!known) {
      this.sendTo(conn, { type: "ERROR", error: "unknown_team" });
      return;
    }
    this.connTeam.set(conn.id, teamId);
    this.sendTo(conn, this.snapshot());
  }

  private handleTranscript(conn: Party.Connection) {
    if (!this.isHost(conn)) {
      this.sendTo(conn, { type: "ERROR", error: "not_host" });
      return;
    }
    this.sendTo(conn, { type: "TRANSCRIPT", entries: this.transcript });
  }

  private handleHostStart(conn: Party.Connection) {
    if (!this.isHost(conn)) {
      this.sendTo(conn, { type: "ERROR", error: "not_host" });
      return;
    }
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
      DEFAULT_ROOMS,
      DEFAULT_BOSS_QUESTION_IDS,
      DEFAULT_GAME_CONFIG,
      DEFAULT_BOSS_MAX_HP,
      this.rng,
    );
    const eventId = ++this.eventSeq;
    this.broadcastState();
    void this.narrate(eventId, { type: "start", teams: this.pendingTeams.map((t) => t.name) });
  }

  private handleHostJudge(
    conn: Party.Connection,
    teamId: string,
    questionId: string,
    correct: boolean,
    fleeChoice?: "flee" | "retry",
  ) {
    if (!this.isHost(conn)) {
      this.sendTo(conn, { type: "ERROR", error: "not_host" });
      return;
    }
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
      const event = toNarrationEvent(prev, outcome, monster);
      this.broadcastState();
      const narration = this.narrate(eventId, event);
      if (game.phase === "finished" && !this.epilogueRequested) {
        this.epilogueRequested = true;
        void this.sendEpilogue(narration).catch((err) => console.error("epilogue failed", err));
      }
    } catch (err) {
      const detail = err instanceof InvalidActionError ? err.message : "unknown error";
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    }
  }
}
