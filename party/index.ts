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
import type { ClientMessage, ServerMessage } from "../lib/protocol";

const MAX_TEAM_NAME_LENGTH = 20;
const MAX_TEAMS = 8;

function sanitizeTeamName(name: string): string {
  return name
    .replace(/[<>&"']/g, "")
    .trim()
    .slice(0, MAX_TEAM_NAME_LENGTH);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidTeamId(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Iteration 1 has no persistence (Open Questions: 純 in-memory 決定) — a
 * server restart loses the whole game, and that's a known/accepted
 * limitation for a single lightweight playtest session, not a bug.
 */
export default class DungeonRoom implements Party.Server {
  game: GameState | null = null;
  private pendingTeams: { id: string; name: string }[] = [];
  private hostConnId = "";
  /** connection id -> team id, so onClose can mark the right team offline. */
  private connTeam = new Map<string, string>();

  constructor(readonly room: Party.Room) {}

  private broadcast(msg: ServerMessage) {
    this.room.broadcast(JSON.stringify(msg));
  }

  private sendTo(conn: Party.Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastState() {
    if (!this.game) {
      this.broadcast({ type: "LOBBY", teams: this.pendingTeams });
      return;
    }
    const view = getSpectatorView(this.game);
    this.broadcast({ type: "STATE", view, phase: this.game.phase, winners: this.game.winners });
    if (this.game.phase === "finished") {
      this.broadcast({ type: "GAME_OVER", winners: this.game.winners });
    }
  }

  onConnect(conn: Party.Connection) {
    if (!this.hostConnId) this.hostConnId = conn.id;
    if (this.game) {
      const view = getSpectatorView(this.game);
      this.sendTo(conn, { type: "STATE", view, phase: this.game.phase, winners: this.game.winners });
    } else {
      this.sendTo(conn, { type: "LOBBY", teams: this.pendingTeams });
    }
  }

  onClose(conn: Party.Connection) {
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
    return conn.id === this.hostConnId;
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
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

  private handleJoin(conn: Party.Connection, teamId: string, rawName: string) {
    if (!isValidTeamId(teamId)) {
      this.sendTo(conn, { type: "ERROR", error: "invalid_team_id" });
      return;
    }
    if (this.game) {
      this.sendTo(conn, { type: "ERROR", error: "game_already_started" });
      return;
    }
    const name = sanitizeTeamName(rawName);
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
    this.sendTo(conn, { type: "LOBBY", teams: this.pendingTeams });
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
