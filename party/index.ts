import type * as Party from "partykit/server";
import {
  createGame,
  answerQuestion,
  setTeamOnline,
  getSpectatorView,
  InvalidActionError,
  type GameState,
} from "../lib/game-state";
import { DEFAULT_ROOMS, DEFAULT_BOSS_QUESTION_IDS, DEFAULT_BOSS_MAX_HP, DEFAULT_GAME_CONFIG } from "../lib/fixtures";
import { parseClientMessage, sanitizeText, type ServerMessage } from "../lib/protocol";

const MAX_TEAM_NAME_LENGTH = 20;
const MAX_TEAMS = 8;

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
  // ponytail: in-memory Set. If hibernation is ever enabled it must move to conn.setState.
  private hostConns = new Set<string>();
  /** Changes whenever the room instance restarts, so clients can show "game reset". */
  private roomEpoch = crypto.randomUUID();
  /** connection id -> team id, so onClose can mark the right team offline. */
  private connTeam = new Map<string, string>();

  constructor(readonly room: Party.Room) {}

  private broadcast(msg: ServerMessage) {
    this.room.broadcast(JSON.stringify(msg));
  }

  private sendTo(conn: Party.Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private snapshot(): ServerMessage {
    if (!this.game) return { type: "LOBBY", teams: this.pendingTeams, roomEpoch: this.roomEpoch };
    return {
      type: "STATE",
      view: getSpectatorView(this.game),
      phase: this.game.phase,
      winners: this.game.winners,
      roomEpoch: this.roomEpoch,
    };
  }

  private broadcastState() {
    this.broadcast(this.snapshot());
    if (this.game?.phase === "finished") {
      this.broadcast({ type: "GAME_OVER", winners: this.game.winners });
    }
  }

  onConnect(conn: Party.Connection) {
    this.sendTo(conn, this.snapshot());
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
    this.hostConns.add(conn.id);
    this.sendTo(conn, { type: "HOST_OK" });
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
    );
    this.broadcastState();
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
      const { game } = answerQuestion(this.game, teamId, questionId, correct, fleeChoice ?? "retry");
      this.game = game;
      this.broadcastState();
    } catch (err) {
      const detail = err instanceof InvalidActionError ? err.message : "unknown error";
      this.sendTo(conn, { type: "ERROR", error: "invalid_action", detail });
    }
  }
}
