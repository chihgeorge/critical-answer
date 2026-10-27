"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { useRoomSocket } from "@/lib/use-room-socket";
import { DISCONNECTED_NOTICE, offlineNotice, type DropSnapshot } from "@/lib/offline-notice";
import { getOrCreateTeamId, getOrCreateTeamKey } from "@/lib/room-code";
import type { ClientMessage, LobbyTeams, StateMessage } from "@/lib/protocol";
import { BRANCH_LABELS, BRANCH_OPTIONS, firstPendingBranchRoom } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { describeTurn } from "@/lib/turn-info";
import { isPending, keepLatest, type NarrationState } from "@/lib/narration/client";
import { DialogueBox, Panel, PixelButton, QuestionMedia, SceneBackground, Sprite, TurnRibbon } from "@/components/pixel";
import { McOption } from "@/components/mc-option";

/** How long 鎖定中… waits for the room to confirm a lock before offering a retry (phone-answering.md D6). */
const LOCK_CONFIRM_MS = 3000;

/**
 * The team's own multipleChoice turn (docs/designs/phone-answering.md D2, D5–D7): pick, lock, then
 * either the beat (locked) or, after a wrong lock, 重答 / 逃跑. Eliminated options are grey and inert.
 */
function MyChoicePanel({ game, teamId, send }: { game: StateMessage; teamId: string; send: (m: ClientMessage) => void }) {
  const q = game.question!;
  const options = q.options!;
  const pick = game.view.teams.find((t) => t.id === teamId)?.currentSelection ?? null;
  const gone = game.view.eliminated?.[q.id] ?? [];
  const lock = game.pendingLock?.teamId === teamId ? game.pendingLock : null;
  const wrong = game.view.pendingWrong?.teamId === teamId ? game.view.pendingWrong : null;
  // A wrong boss lock has no choice to make: the room brings a new question after a beat (D2=B).
  const bossMiss = !!wrong && !!game.view.teams.find((t) => t.id === teamId)?.inBossPhase;
  // A press waiting for the room: keyed to the question and eventId, so a later turn on the same
  // question (after 重答, which bumps eventId) never looks like it is still in flight.
  const [locking, setLocking] = useState<{ qid: string; eventId: number } | null>(null);
  const [lockFailed, setLockFailed] = useState(false);
  const inFlight = !lock && !wrong && locking?.qid === q.id && locking.eventId === game.eventId;
  useEffect(() => {
    if (!inFlight) return;
    const id = setTimeout(() => {
      setLocking(null);
      setLockFailed(true);
    }, LOCK_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [inFlight]);
  const frozen = !!lock || !!wrong || inFlight;

  return (
    <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
      {wrong && (
        <div className="flex items-center gap-2 text-[22px]">
          <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center border-[3px] border-[var(--k)] bg-[var(--danger)] text-[14px] text-white">✕</span>
          {bossMiss ? "答錯了！" : "答錯了！要怎麼辦？"}
        </div>
      )}
      {options.map((opt, i) => {
        const out = gone.includes(i);
        const locked = lock?.optionIndex === i;
        const picked = !out && pick === i;
        return (
          <McOption
            key={i}
            index={i}
            text={opt}
            look={out ? "dim" : locked || (picked && !lock) ? "sel" : frozen ? "dim" : "plain"}
            label={out ? "✕ 答錯" : locked ? "🔒 已鎖定" : picked && !lock ? "◀ 已選" : undefined}
            aria-pressed={picked || locked}
            disabled={out || frozen}
            onClick={() => {
              setLockFailed(false);
              send({ type: "TEAM_SELECT_OPTION", questionId: q.id, optionIndex: i });
            }}
            className="min-h-[56px] text-[21px]"
          />
        );
      })}
      {bossMiss ? (
        <div className="px-bar mt-1" role="status">首領要換題了 ▶</div>
      ) : wrong ? (
        <div className="mt-1 flex gap-2">
          <PixelButton variant="ok" className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "retry" })}>
            重答<small className="text-[13px]">下一輪再挑一次</small>
          </PixelButton>
          <PixelButton className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" style={{ background: "var(--lav)" }} onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "flee" })}>
            逃跑<small className="text-[13px]">換一題簡單的</small>
          </PixelButton>
        </div>
      ) : lock ? (
        <div className="px-bar mt-1" role="status">已鎖定！看大螢幕揭曉 ▶</div>
      ) : inFlight ? (
        <div className="px-bar ok mt-1" role="status">鎖定中…</div>
      ) : (
        <PixelButton
          variant="ok"
          disabled={pick === null || gone.includes(pick)}
          className="!m-0 mt-1 !min-h-[62px] !text-[23px]"
          onClick={() => {
            setLockFailed(false);
            setLocking({ qid: q.id, eventId: game.eventId });
            send({ type: "TEAM_LOCK_OPTION", questionId: q.id, optionIndex: pick! });
          }}
        >
          鎖定答案
        </PixelButton>
      )}
      {lockFailed && !frozen && <div className="text-center text-[14px]">沒送出，再按一次</div>}
    </Panel>
  );
}

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const teamName = searchParams.get("name") ?? "隊伍";
  const password = searchParams.get("pw") ?? "";
  const [badPassword, setBadPassword] = useState(false);

  const [teamId, setTeamId] = useState("");
  const [lobby, setLobby] = useState<LobbyTeams | null>(null);
  const [game, setGame] = useState<StateMessage | null>(null);
  const [narration, setNarration] = useState<NarrationState>(null);
  const [epilogue, setEpilogue] = useState<string | null>(null);


  /** A network drop (not a rest): the room skips an offline team's turn, so the team should know
   * it's disconnected, and after reconnecting whether the game moved on (lib/offline-notice.ts). */
  const [disconnected, setDisconnected] = useState(false);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const lastGame = useRef<StateMessage | null>(null);
  const drop = useRef<DropSnapshot | null>(null);
  useEffect(() => {
    if (!offlineMsg) return;
    const id = setTimeout(() => setOfflineMsg(null), 10_000);
    return () => clearTimeout(id);
  }, [offlineMsg]);

  const { reset, rested, send, reconnect } = useRoomSocket(code, {
    // Every (re)connect says who we are again: a phone that slept or changed network comes back
    // as the same team instead of staying "offline" and being skipped. An automatic reconnect's
    // JOIN carries `resume` so it isn't activity.
    onOpen(resume) {
      setDisconnected(false);
      const id = getOrCreateTeamId();
      setTeamId(id);
      send({ type: "JOIN", teamId: id, teamKey: getOrCreateTeamKey(), teamName, ...(password ? { password } : {}), ...(resume ? { resume: true } : {}) });
    },
    onClose({ rested, openedBefore }) {
      if (rested || !openedBefore) return;
      setDisconnected(true);
      const g = lastGame.current;
      // Keep the first drop's snapshot across several failed reconnect attempts.
      if (g && !drop.current) drop.current = { eventId: g.eventId, wasMyTurn: g.view.currentTurnTeamId === getOrCreateTeamId() };
    },
    onMessage(msg) {
      switch (msg.type) {
        case "ERROR":
          if (msg.error === "bad_password") setBadPassword(true);
          break;
        case "LOBBY":
          setBadPassword(false);
          setLobby(msg.teams);
          setGame(null);
          lastGame.current = null;
          drop.current = null;
          break;
        case "STATE": {
          setGame(msg);
          lastGame.current = msg;
          if (drop.current) {
            setOfflineMsg(offlineNotice(drop.current, msg.eventId));
            drop.current = null;
          }
          setLobby(null);
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

  /** The last correct answer, shown in place of the next question until the host presses 下一題
   * (HOST_NEXT, D7 — docs/designs/question-media-content.md). */
  const revealed = game?.reveal ?? null;
  const roster = game?.view.teams ?? lobby ?? [];
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
            {REST_NOTICE[rested]}
            <PixelButton
              onClick={reconnect}
              className="!m-0 !px-4 !py-2"
            >{RESTED_RECONNECT_LABEL}</PixelButton>
          </Panel>
        )}

        {badPassword && (
          <Panel role="alert" className="flex flex-col items-center gap-3 px-4 py-4 text-center text-[18px]" style={{ background: "#ffd9d9" }}>
            {password ? "房間密碼不對" : "這個房間要密碼才能加入"}
            <a href={`/?code=${code}`} className="text-[16px] underline underline-offset-2">回首頁輸入密碼</a>
          </Panel>
        )}

        {!game && !badPassword && (
          <Panel tone="lav" className="px-4 py-5 text-center text-[20px]">
            {lobby ? "等待主持人開始遊戲…" : "連線中…"}
          </Panel>
        )}

        {/* Who has joined so far, updating live while everyone waits for the host. */}
        {!game && lobby && (
          <ul data-testid="roster" className="flex flex-col gap-2">
            {lobby.map((t, i) => (
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

        {/* D2: on our own multipleChoice turn the options come first, right under the ribbon. */}
        {game && !finished && !revealed && isMyTurn && game.question?.options && <MyChoicePanel game={game} teamId={teamId} send={send} />}

        {/* D14: our own lock was right — the same tiles, the right one green, and the points. */}
        {game && revealed?.choice && revealed.choice.teamId === teamId && (
          <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
            {revealed.choice.options.map((opt, i) => (
              <McOption key={i} index={i} text={opt} disabled look={i === revealed.choice!.correctIndex ? "ok" : "dim"} label={i === revealed.choice!.correctIndex ? "✓ 答對" : undefined} className="min-h-[56px] text-[21px]" />
            ))}
            <div className="px-bar ok mt-1 !text-[22px]" role="status">
              答對了！{revealed.choice.points > 0 ? `＋${revealed.choice.points} 分` : ""}
            </div>
          </Panel>
        )}

        {/* While waiting, the roster above already highlights our own team. */}
        {game && (
          <Panel tone={isMyTurn ? "turn" : "cream"} className="flex items-center gap-3 px-3 py-[10px]">
            <Sprite kind="hero" variant={myIndex} scale={3} className="flex-none" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px]">{myTeam?.name ?? teamName}</div>
              <div className="my-1 text-[18px]" style={{ color: "#a8470f" }}>
                {myTeam ? (
                  <>
                    <span className="px-num">{myTeam.reward}</span> 獎勵分
                  </>
                ) : (
                  `隊伍 ${TEAM_LOOKS[myIndex % TEAM_LOOKS.length].name}`
                )}
              </div>
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
            <Sprite kind={turn.monster.kind} hue={turn.monster.hue} scale={turn.miniScale} className="flex-none" />
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
                    ? narration.lines
                    : ["冒險結束了，大螢幕正在頒獎。"]
                : narration
                  ? narration.lines
                  : [turn?.team ? `輪到${turn.team.name}了，${turn.monster.name}擋在前面……` : "火光搖曳，冒險者們正在集合……"]
            }
          />
        </div>
      </div>
    </main>
  );
}
