"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import usePartySocket from "partysocket/react";
import type { ClientMessage, ServerMessage } from "@/lib/protocol";
import type { SpectatorView, GamePhase } from "@/lib/game-state";

type LobbyState = { teams: { id: string; name: string }[] };
type PlayState = { view: SpectatorView; phase: GamePhase; winners: string[] };

export default function HostPage() {
  const { code } = useParams<{ code: string }>();

  const [lobby, setLobby] = useState<LobbyState>({ teams: [] });
  const [game, setGame] = useState<PlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Team whose judge buttons are disabled while we wait for the server's
  // STATE broadcast to confirm the judgment — doubles as visible click
  // feedback (buttons dim + show a spinner) and blocks accidental
  // double-clicks from firing two judgments for the same turn.
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999",
    room: code,
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
          setPendingTeamId(null);
          break;
        case "GAME_OVER":
          setGame((g) => (g ? { ...g, phase: "finished", winners: msg.winners } : g));
          setPendingTeamId(null);
          break;
        case "ERROR":
          setError(`${msg.error}${msg.detail ? `: ${msg.detail}` : ""}`);
          setPendingTeamId(null);
          break;
      }
    },
  });

  function send(msg: ClientMessage) {
    setError(null);
    socket.send(JSON.stringify(msg));
  }

  function judge(teamId: string, questionId: string, correct: boolean, fleeChoice?: "flee" | "retry") {
    setPendingTeamId(teamId);
    send({ type: "HOST_JUDGE", teamId, questionId, correct, fleeChoice });
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-black">dungeon_master</h1>
        <div className="rounded-xl bg-[var(--surface)] px-4 py-2 font-mono text-2xl tracking-[0.3em]">{code}</div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl bg-[var(--danger)]/20 px-4 py-2 text-sm text-[var(--danger)]">{error}</div>
      )}

      {!game && (
        <section className="flex flex-col gap-6">
          <h2 className="text-xl font-bold">等待隊伍加入…</h2>
          <ul className="flex flex-wrap gap-3">
            {lobby.teams.map((t) => (
              <li key={t.id} className="rounded-xl bg-[var(--surface)] px-4 py-3 font-bold">
                {t.name}
              </li>
            ))}
            {lobby.teams.length === 0 && <p className="text-[var(--ink2)]">還沒有隊伍加入</p>}
          </ul>
          <button
            type="button"
            disabled={lobby.teams.length === 0}
            onClick={() => send({ type: "HOST_START" })}
            className="w-fit rounded-xl bg-[var(--accent)] px-6 py-3 font-black text-white disabled:opacity-40"
          >
            開始遊戲 ▶
          </button>
        </section>
      )}

      {game && game.phase === "playing" && (
        <section className="flex flex-col gap-6">
          <div className="rounded-xl bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--ink2)]">首領血量</p>
            <div className="mt-1 h-4 w-full overflow-hidden rounded-full bg-[var(--surface2)]">
              <div
                className="h-full bg-[var(--danger)] transition-all"
                style={{ width: `${(game.view.bossHp / game.view.bossMaxHp) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--ink2)]">
              {game.view.bossHp} / {game.view.bossMaxHp}
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {game.view.teams.map((t) => {
              const isCurrent = t.id === game.view.currentTurnTeamId;
              const questionId = t.inBossPhase ? game.view.bossCurrentQuestionId : t.currentQuestionId;
              return (
                <li
                  key={t.id}
                  className={`rounded-xl p-4 ${isCurrent ? "bg-[var(--accent)]/20 ring-2 ring-[var(--accent)]" : "bg-[var(--surface)]"} ${!t.online ? "opacity-40" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">
                      {t.name} {!t.online && "（離線）"}
                    </span>
                    <span className="font-mono text-lg">{t.score} 分</span>
                  </div>
                  <p className="text-xs text-[var(--ink2)]">
                    {t.inBossPhase ? "首領房" : `第 ${t.roomIndex + 1} 房`} · 題目 {questionId}
                  </p>
                  {isCurrent && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingTeamId === t.id}
                        onClick={() => judge(t.id, questionId, true)}
                        className="rounded-lg bg-[var(--ok)] px-3 py-2 text-sm font-bold text-black transition active:scale-95 disabled:animate-pulse disabled:opacity-60"
                      >
                        ✅ 答對
                      </button>
                      <button
                        type="button"
                        disabled={pendingTeamId === t.id}
                        onClick={() => judge(t.id, questionId, false, "retry")}
                        className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm font-bold transition active:scale-95 disabled:animate-pulse disabled:opacity-60"
                      >
                        🔁 答錯・重答
                      </button>
                      <button
                        type="button"
                        disabled={pendingTeamId === t.id}
                        onClick={() => judge(t.id, questionId, false, "flee")}
                        className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm font-bold transition active:scale-95 disabled:animate-pulse disabled:opacity-60"
                      >
                        😨 答錯・逃跑
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {game && game.phase === "finished" && (
        <section className="flex flex-col items-center gap-4 py-16 text-center">
          <h2 className="text-3xl font-black">遊戲結束！</h2>
          <p className="text-lg">
            {game.winners
              .map((id) => game.view.teams.find((t) => t.id === id)?.name ?? id)
              .join("、")}{" "}
            獲勝
          </p>
        </section>
      )}
    </main>
  );
}
