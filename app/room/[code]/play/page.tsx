"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import usePartySocket from "partysocket/react";
import { getOrCreateTeamId } from "@/lib/room-code";
import type { ClientMessage, ServerMessage } from "@/lib/protocol";
import type { SpectatorView, GamePhase } from "@/lib/game-state";

type LobbyState = { teams: { id: string; name: string }[] };
type PlayState = { view: SpectatorView; phase: GamePhase; winners: string[] };

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const teamName = searchParams.get("name") ?? "隊伍";

  // Read lazily on first render only — fine here because this page is
  // always client-rendered (usePartySocket already requires a browser).
  const [teamId, setTeamId] = useState("");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [game, setGame] = useState<PlayState | null>(null);

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999",
    room: code,
    onOpen() {
      const id = getOrCreateTeamId();
      setTeamId(id);
      send({ type: "JOIN", teamId: id, teamName });
    },
    onMessage(event: MessageEvent) {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "LOBBY":
          setLobby({ teams: msg.teams });
          setGame(null);
          break;
        case "STATE":
          setGame({ view: msg.view, phase: msg.phase, winners: msg.winners });
          setLobby(null);
          break;
        case "GAME_OVER":
          setGame((g) => (g ? { ...g, phase: "finished", winners: msg.winners } : g));
          break;
      }
    },
  });

  function send(msg: ClientMessage) {
    socket.send(JSON.stringify(msg));
  }

  const myTeam = game?.view.teams.find((t) => t.id === teamId);
  const isMyTurn = game?.view.currentTurnTeamId === teamId;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-2xl font-black">{teamName}</h1>

      {!game && (
        <p className="text-[var(--ink2)]">
          {lobby ? "等待主持人開始遊戲…" : "連線中…"}
        </p>
      )}

      {game && game.phase === "playing" && myTeam && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <div
            className={`rounded-2xl p-6 ${isMyTurn ? "bg-[var(--accent)]/20 ring-2 ring-[var(--accent)]" : "bg-[var(--surface)]"}`}
          >
            <p className="text-4xl font-black">{myTeam.score}</p>
            <p className="text-sm text-[var(--ink2)]">分數</p>
          </div>
          <p className="text-lg">{myTeam.inBossPhase ? "⚔️ 首領房" : `🚪 第 ${myTeam.roomIndex + 1} 房`}</p>
          {isMyTurn ? (
            <p className="text-xl font-bold text-[var(--accent)]">輪到你們了！</p>
          ) : (
            <p className="text-[var(--ink2)]">等待其他隊伍…</p>
          )}
        </div>
      )}

      {game && game.phase === "finished" && (
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-3xl font-black">遊戲結束！</h2>
          <p className="text-lg">
            {game.winners.includes(teamId) ? "🏆 你們獲勝了！" : "感謝參與！"}
          </p>
        </div>
      )}
    </main>
  );
}
