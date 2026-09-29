"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import usePartySocket from "partysocket/react";
import { restKindOf, restNoticeFor, RESTED_RECONNECT_LABEL, type RestKind } from "@/lib/room/close-codes";
import { DISCONNECTED_NOTICE, offlineNotice, type DropSnapshot } from "@/lib/offline-notice";
import { getOrCreateTeamId, getOrCreateTeamKey } from "@/lib/room-code";
import type { AnswerReveal, ClientMessage, PublicQuestion, ServerMessage } from "@/lib/protocol";
import { BRANCH_LABELS, BRANCH_OPTIONS, firstPendingBranchRoom, type SpectatorView, type GamePhase } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { BOSS_THRESHOLD, describeTurn } from "@/lib/turn-info";
import { isPending, keepLatest, linesOf, type NarrationState } from "@/lib/narration/client";
import { DialogueBox, Panel, PixelButton, QuestionMedia, SceneBackground, ScoreMeter, Sprite, TurnRibbon } from "@/components/pixel";
import { PARTY_HOST } from "@/lib/party-host";

type LobbyState = { teams: { id: string; name: string }[] };
type PlayState = { view: SpectatorView; phase: GamePhase; winners: string[]; question: PublicQuestion | null; eventId: number };

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const teamName = searchParams.get("name") ?? "隊伍";

  const [teamId, setTeamId] = useState("");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [game, setGame] = useState<PlayState | null>(null);
  const [reset, setReset] = useState(false);
  /** The room closed our connection on purpose after a long idle time. The game is saved; a tap reconnects. */
  const [rested, setRested] = useState<RestKind | null>(null);
  const [narration, setNarration] = useState<NarrationState>(null);
  const [epilogue, setEpilogue] = useState<string | null>(null);
  /** STATE.reveal: the last correct answer, shown in place of the next question until the host
   * presses 下一題 (HOST_NEXT, D7 — docs/designs/question-media-content.md). */
  const [revealed, setRevealed] = useState<AnswerReveal | null>(null);
  const joinedRef = useRef(false);
  const epoch = useRef<string | null>(null);

  /** Same as the host page: an automatic reconnect's JOIN carries `resume` so it isn't activity. */
  const openedOnce = useRef(false);
  const reconnectByHand = useRef(false);

  /** A network drop (not a rest): the room skips an offline team's turn, so the team should know
   * it's disconnected, and after reconnecting whether the game moved on (lib/offline-notice.ts). */
  const [disconnected, setDisconnected] = useState(false);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const lastGame = useRef<PlayState | null>(null);
  const drop = useRef<DropSnapshot | null>(null);
  useEffect(() => {
    if (!offlineMsg) return;
    const id = setTimeout(() => setOfflineMsg(null), 10_000);
    return () => clearTimeout(id);
  }, [offlineMsg]);

  const socket = usePartySocket({
    host: PARTY_HOST,
    room: code,
    // Every (re)connect says who we are again: a phone that slept or changed network comes back
    // as the same team instead of staying "offline" and being skipped.
    onOpen() {
      setRested(null);
      setDisconnected(false);
      const resume = openedOnce.current && !reconnectByHand.current;
      openedOnce.current = true;
      reconnectByHand.current = false;
      send({ type: "JOIN", teamId: getOrCreateTeamId(), teamKey: getOrCreateTeamKey(), teamName, ...(resume ? { resume: true } : {}) });
    },
    onClose(event: CloseEvent) {
      // Stop the automatic reconnecting, or an unused room would be woken up again straight away.
      const restKind = restKindOf(event);
      if (restKind) {
        socket.close();
        setRested(restKind);
        return;
      }
      if (!openedOnce.current) return;
      setDisconnected(true);
      const g = lastGame.current;
      // Keep the first drop's snapshot across several failed reconnect attempts.
      if (g && !drop.current) drop.current = { eventId: g.eventId, wasMyTurn: g.view.currentTurnTeamId === getOrCreateTeamId() };
    },
    onMessage(event: MessageEvent) {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if ((msg.type === "LOBBY" || msg.type === "STATE") && msg.roomEpoch) {
        if (epoch.current && epoch.current !== msg.roomEpoch) setReset(true);
        epoch.current = msg.roomEpoch;
      }
      switch (msg.type) {
        case "LOBBY":
          setLobby({ teams: msg.teams });
          setGame(null);
          lastGame.current = null;
          drop.current = null;
          setRevealed(null);
          break;
        case "STATE": {
          const next = { view: msg.view, phase: msg.phase, winners: msg.winners, question: msg.question, eventId: msg.eventId };
          setGame(next);
          lastGame.current = next;
          if (drop.current) {
            setOfflineMsg(offlineNotice(drop.current, msg.eventId));
            drop.current = null;
          }
          setLobby(null);
          setRevealed(msg.reveal);
          break;
        }
        case "NARRATION":
          setNarration((n) => keepLatest(n, msg));
          break;
        case "EPILOGUE":
          setEpilogue(msg.text);
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

  // Join once the socket is open. Polled rather than driven off the "open"
  // event: React StrictMode's dev-mode mount→cleanup→mount double-invoke can
  // close and replace the underlying socket right around when this effect
  // first runs, so an addEventListener("open", ...) registered at that exact
  // moment can miss the event entirely. Polling is immune to that race.
  useEffect(() => {
    joinedRef.current = false;
    function join() {
      if (joinedRef.current) return;
      joinedRef.current = true;
      const id = getOrCreateTeamId();
      setTeamId(id);
      send({ type: "JOIN", teamId: id, teamKey: getOrCreateTeamKey(), teamName });
    }
    if (socket.readyState === socket.OPEN) {
      join();
      return;
    }
    const pollId = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        join();
        clearInterval(pollId);
      }
    }, 100);
    return () => clearInterval(pollId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, teamName]);

  const roster = game?.view.teams ?? lobby?.teams ?? [];
  const myIndex = Math.max(0, roster.findIndex((t) => t.id === teamId));
  const myTeam = game?.view.teams.find((t) => t.id === teamId);
  const turn = game ? describeTurn(game.view, game.question) : null;
  const isMyTurn = !!game && game.view.currentTurnTeamId === teamId;
  const finished = game?.phase === "finished";
  // Non-blocking DM branching interlude (design doc decision 4B): does not gate turn order,
  // so this is just derived from the broadcast state, not tied to isMyTurn.
  const pendingBranchRoom = myTeam ? firstPendingBranchRoom(myTeam) : null;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <SceneBackground theme={turn?.theme ?? "stone"} cols={48} rows={100} arch={false} className="fixed inset-0" />

      <div className="relative z-10 flex min-h-screen flex-col gap-4 px-[14px] pb-4 pt-5">
        {reset && (
          <div className="px-panel text-center text-[15px]" style={{ background: "var(--danger)", color: "#fff" }}>
            伺服器重新啟動，遊戲已重置
          </div>
        )}

        {disconnected && !rested && (
          <Panel tone="turn" role="status" className="px-3 py-2 text-center text-[16px]">
            {DISCONNECTED_NOTICE}
          </Panel>
        )}
        {offlineMsg && !disconnected && (
          <Panel tone="lav" role="status" className="px-3 py-2 text-center text-[16px]">
            {offlineMsg}
          </Panel>
        )}
        {rested && (
          <Panel tone="turn" role="status" className="flex flex-col items-center gap-3 px-4 py-4 text-center text-[18px]">
            {restNoticeFor(rested)}
            <PixelButton
              onClick={() => {
                reconnectByHand.current = true;
                socket.reconnect();
              }}
              className="!m-0 !px-4 !py-2"
            >{RESTED_RECONNECT_LABEL}</PixelButton>
          </Panel>
        )}

        {!game && (
          <Panel tone="lav" className="px-4 py-5 text-center text-[20px]">
            {lobby ? "等待主持人開始遊戲…" : "連線中…"}
          </Panel>
        )}

        {/* Who has joined so far, updating live while everyone waits for the host. */}
        {!game && lobby && (
          <ul data-testid="roster" className="flex flex-col gap-2">
            {lobby.teams.map((t, i) => (
              <Panel key={t.id} tone={t.id === teamId ? "turn" : "cream"} className="flex items-center gap-3 px-3 py-2">
                <Sprite kind="hero" variant={i} scale={2} className="flex-none" />
                <span className="min-w-0 flex-1 truncate text-[18px]">{t.name}</span>
                {t.id === teamId && <span className="text-[14px]">你們</span>}
              </Panel>
            ))}
          </ul>
        )}

        {game && !finished && turn && (
          <TurnRibbon color={isMyTurn ? undefined : "#6ab4ff"}>
            {isMyTurn ? "輪到我們了！" : `輪到：${turn.team?.name ?? "…"}`}
          </TurnRibbon>
        )}

        {/* While waiting, the roster above already highlights our own team. */}
        {game && (
          <Panel tone={isMyTurn ? "turn" : "cream"} className="flex items-center gap-3 px-3 py-[10px]">
            <Sprite kind="hero" variant={myIndex} scale={3} className="flex-none" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px]">{myTeam?.name ?? teamName}</div>
              <div className="px-num my-1 text-[18px]" style={{ color: "#a8470f" }}>
                {myTeam ? `${myTeam.score} / ${BOSS_THRESHOLD}` : `隊伍 ${TEAM_LOOKS[myIndex % TEAM_LOOKS.length].name}`}
              </div>
              {myTeam && <ScoreMeter score={Math.min(myTeam.score, BOSS_THRESHOLD)} max={BOSS_THRESHOLD} active={isMyTurn} />}
            </div>
          </Panel>
        )}

        {/* DM branching interlude: background choice, never blocks the turn above. */}
        {game && !finished && pendingBranchRoom !== null && (
          <Panel tone="turn" className="flex flex-col items-center gap-2 px-3 py-3 text-center">
            <div className="text-[15px]">冒險出現岔路，你們要怎麼做？</div>
            <div className="flex gap-2">
              {BRANCH_OPTIONS.map((choice) => (
                <PixelButton
                  key={choice}
                  onClick={() => send({ type: "TEAM_BRANCH_CHOICE", roomIndex: pendingBranchRoom, choice })}
                  className="!m-0"
                >
                  {BRANCH_LABELS[choice]}
                </PixelButton>
              ))}
            </div>
          </Panel>
        )}

        {game && !finished && !revealed && turn?.team && (
          <Panel className="flex items-center gap-3 px-3 py-[10px]">
            <Sprite kind={turn.monster.kind} hue={turn.monster.hue} scale={Math.max(1, Math.floor(turn.monster.scale / 3))} className="flex-none" />
            <div className="text-[15px]">
              <div>{turn.team.name} 正在面對</div>
              <div className="text-[18px]">{turn.monster.name}</div>
            </div>
          </Panel>
        )}

        {game && !finished && !revealed && game.question && game.question.content.kind !== "text" && (
          <Panel className="flex justify-center px-3 py-3">
            {/* key tied to the question forces a fresh DOM node per question — without it, React
                would reuse the same node across consecutive media questions and a broken image
                (or a stale video) would stay hidden/showing for every question after it
                (adversarial review finding, carried forward from image-question-type.md). */}
            <QuestionMedia key={game.question.id} content={game.question.content} maxWidth={280} maxHeight={200} />
          </Panel>
        )}

        {game && revealed && (
          <Panel tone="turn" className="flex flex-col items-center gap-2 px-3 py-3 text-center">
            <div className="text-[18px]">正解：{revealed.answer}</div>
            {revealed.explanation && revealed.explanation.kind === "text" && (
              <div className="text-[16px]">{revealed.explanation.value}</div>
            )}
            {revealed.explanation && revealed.explanation.kind !== "text" && (
              // key tied to questionId — same broken-image-stays-hidden-forever guard every
              // other media render site in this diff carries (adversarial review finding, /ship).
              <QuestionMedia key={revealed.questionId} content={revealed.explanation} label="詳解" maxWidth={260} maxHeight={180} />
            )}
          </Panel>
        )}

        {/* multipleChoice options — only our own turn shows the tappable list; re-tappable
            any time before the host judges (see docs/designs/multiple-choice-questions.md
            decision 5), so there's no "locked in" state here beyond the highlight itself. */}
        {game && !finished && !revealed && isMyTurn && game.question?.options && (
          <Panel tone="turn" className="flex flex-col gap-2 px-3 py-3">
            {game.question.options.map((opt, i) => (
              <PixelButton
                key={i}
                variant={myTeam?.currentSelection === i ? "primary" : undefined}
                onClick={() => send({ type: "TEAM_SELECT_OPTION", questionId: game.question!.id, optionIndex: i })}
                className="!m-0"
              >
                {opt}
              </PixelButton>
            ))}
          </Panel>
        )}

        {finished && game && (
          <Panel tone="lav" className="px-4 py-5 text-center">
            <div className="text-[26px]">遊戲結束！</div>
            <div className="mt-2 text-[18px]">{game.winners.includes(teamId) ? "🏆 你們獲勝了！" : "感謝參與！"}</div>
          </Panel>
        )}

        <div className="mt-auto">
          <DialogueBox
            compact
            loading={!!game && !finished && isPending(game.eventId, narration)}
            lines={
              finished
                ? epilogue
                  ? [epilogue]
                  : narration
                    ? linesOf(narration)
                    : ["冒險結束了，大螢幕正在頒獎。"]
                : narration
                  ? linesOf(narration)
                  : [turn?.team ? `輪到${turn.team.name}了，${turn.monster.name}擋在前面……` : "火光搖曳，冒險者們正在集合……"]
            }
          />
        </div>
      </div>
    </main>
  );
}
