"use client";

import { useRef, useState } from "react";
import { keepLatest, type NarrationState } from "@/lib/narration/client";
import { useParams } from "next/navigation";
import usePartySocket from "partysocket/react";
import { getHostToken } from "@/lib/room-code";
import type { ClientMessage, PublicQuestion, ServerMessage } from "@/lib/protocol";
import type { SpectatorView, GamePhase } from "@/lib/game-state";
import { BOSS_THRESHOLD, describeTurn } from "@/lib/turn-info";
import { Panel, PixelButton, SceneBackground, ScoreMeter, Sprite, TurnRibbon } from "@/components/pixel";
import { Qr } from "@/components/qr";

type LobbyState = { teams: { id: string; name: string }[] };
type PlayState = { view: SpectatorView; phase: GamePhase; winners: string[]; question: PublicQuestion | null; eventId: number };

/** The host's own link carries the token, so it is shown here and never on /screen or /play. */
function MoreDrawer({
  code,
  onClose,
  onTranscript,
  currentLine,
  onNotes,
  onEdit,
  aiOn,
}: {
  code: string;
  onClose: () => void;
  onTranscript: () => void;
  currentLine: string;
  onNotes: (notes: string) => void;
  onEdit: (line: string) => void;
  aiOn: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [line, setLine] = useState(currentLine);
  const origin = location.origin;
  const token = getHostToken(code);
  const joinUrl = `${origin}/?code=${code}`;
  const hostUrl = token ? `${origin}/room/${code}/host#k=${token}` : "";
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <Panel tone="lav" className="max-h-[85vh] w-full overflow-y-auto p-4">
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[20px]">更多</span>
            <PixelButton onClick={onClose} className="!m-0 !px-4 !py-1 text-[16px]">
              關閉
            </PixelButton>
          </div>
          <section>
            <div className="text-[15px]">大螢幕（在電視或投影機開這個網址）</div>
            <div className="break-all text-[14px]">{`${origin}/room/${code}/screen`}</div>
          </section>
          <section className="flex items-center gap-3">
            <Qr text={joinUrl} size={120} />
            <div className="text-[14px]">
              <div className="text-[15px]">玩家掃描加入</div>
              <div className="break-all">{joinUrl}</div>
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <div className="text-[15px]">導演筆記{aiOn ? "（AI 每次寫旁白都會參考）" : "（AI 旁白已關閉，只會記錄）"}</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} placeholder="例如：用武俠口吻，紅隊是一群恐龍" className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
            <PixelButton onClick={() => onNotes(notes)} className="!m-0 !px-4 !py-2 text-[16px]">
              儲存導演筆記
            </PixelButton>
          </section>
          <section className="flex flex-col gap-2">
            <div className="text-[15px]">改寫目前旁白（最多 40 字）</div>
            <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={40} disabled={!currentLine} className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
            <PixelButton onClick={() => onEdit(line)} disabled={!currentLine || !line.trim()} className="!m-0 !px-4 !py-2 text-[16px]">
              送出，立刻換上大螢幕
            </PixelButton>
          </section>
          <section>
            <PixelButton onClick={onTranscript} className="!m-0 !px-4 !py-2 text-[16px]">
              下載旁白紀錄（JSON）
            </PixelButton>
            <div className="mt-3 text-[13px]">每一句旁白的事件、分數、來源與延遲。伺服器重啟後會消失。</div>
          </section>
          {hostUrl && (
            <section className="flex items-center gap-3">
              <Qr text={hostUrl} size={120} />
              <div className="text-[14px]">
                <div className="text-[15px]">用另一台裝置主持</div>
                <div>這個連結擁有主持權，不要給玩家。</div>
              </div>
            </section>
          )}
        </div>
      </Panel>
    </div>
  );
}

export default function HostPage() {
  const { code } = useParams<{ code: string }>();

  const [lobby, setLobby] = useState<LobbyState>({ teams: [] });
  const [game, setGame] = useState<PlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noToken, setNoToken] = useState(false);
  const [connected, setConnected] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [reset, setReset] = useState(false);
  /** Host-only: the answer to the question in play. Never shown on /screen or /play. */
  const [answer, setAnswer] = useState<{ questionId: string; answer: string } | null>(null);
  const [drawer, setDrawer] = useState(false);
  /** Server has an API key, so AI narration can be switched on. Default on when it can. */
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const [narration, setNarration] = useState<NarrationState>(null);
  // Team whose judge buttons are disabled while we wait for the server's
  // STATE broadcast to confirm the judgment — doubles as visible click
  // feedback (buttons dim) and blocks accidental double-clicks from firing
  // two judgments for the same turn.
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const epoch = useRef<string | null>(null);

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999",
    room: code,
    onOpen() {
      setConnected(true);
      // Claim on every (re)connect: the server forgets host rights when the socket closes.
      const t = getHostToken(code);
      if (t) socket.send(JSON.stringify({ type: "HOST_CLAIM", token: t } satisfies ClientMessage));
      else setNoToken(true);
    },
    onClose() {
      setConnected(false);
      setClaimed(false);
      setPendingTeamId(null);
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
        case "HOST_OK":
          setClaimed(true);
          setAiAvailable(msg.aiAvailable);
          break;
        case "NARRATION":
          setNarration((n) => keepLatest(n, msg));
          break;
        case "TRANSCRIPT": {
          // Host-only download of every narration line with provider, latency and fallback reason.
          const blob = new Blob([JSON.stringify(msg.entries, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `critical-answer-${code}-transcript.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          break;
        }
        case "HOST_ANSWER":
          setAnswer({ questionId: msg.questionId, answer: msg.answer });
          break;
        case "LOBBY":
          setLobby({ teams: msg.teams });
          setGame(null);
          break;
        case "STATE":
          setGame({ view: msg.view, phase: msg.phase, winners: msg.winners, question: msg.question, eventId: msg.eventId });
          setPendingTeamId(null);
          break;
        case "GAME_OVER":
          setGame((g) => (g ? { ...g, phase: "finished", winners: msg.winners } : g));
          setPendingTeamId(null);
          break;
        case "ERROR":
          setError(msg.error === "bad_token" ? "主持人金鑰不符，這個瀏覽器不是這個房間的主持人" : `${msg.error}${msg.detail ? `: ${msg.detail}` : ""}`);
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

  // gstack-shortcut(dec-ac659960): disconnect UI on /host only (judge buttons disable, "重新連線中");
  // /play and /screen show nothing, so a dropped player sees a frozen screen. Upgrade when playtest 2
  // shows confusion about missed turns, or when the game leaves LAN.
  const ready = connected && claimed;
  const turn = game ? describeTurn(game.view, game.question) : null;
  const canJudge = ready && !!turn?.team && pendingTeamId !== turn.team.id;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <SceneBackground theme={turn?.theme ?? "stone"} cols={48} rows={100} arch={false} className="fixed inset-0" />

      <div className="relative z-10 flex min-h-screen flex-col gap-3 px-[14px] pb-4 pt-5">
        <header className="flex items-center justify-between gap-3">
          <Panel className="px-3 py-1">
            <span className="px-num text-[18px] tracking-[0.2em]" style={{ color: "var(--danger)" }}>
              {code}
            </span>
          </Panel>
          <PixelButton onClick={() => setDrawer(true)} className="!m-0 !px-4 !py-2 text-[16px]">
            ⚙ 更多
          </PixelButton>
        </header>

        {reset && <Panel className="px-3 py-2 text-center text-[14px]" style={{ background: "var(--danger)", color: "#fff" }}>伺服器重新啟動，遊戲已重置，轉錄紀錄已消失</Panel>}
        {noToken && <Panel tone="lav" className="px-3 py-2 text-[14px]">這個瀏覽器沒有主持人金鑰。請回首頁按「主持遊戲」，或用建立房間時的連結／QR 開啟。</Panel>}
        {!connected && !noToken && <Panel tone="turn" className="px-3 py-2 text-center text-[16px]">重新連線中…</Panel>}
        {error && <Panel className="px-3 py-2 text-[14px]" style={{ background: "#ffd9d9" }}>{error}</Panel>}

        {!game && (
          <section className="flex flex-1 flex-col gap-3">
            <Panel tone="lav" className="px-3 py-2 text-[18px]">等待隊伍加入…</Panel>
            <ul className="flex flex-col gap-2">
              {lobby.teams.map((t, i) => (
                <Panel key={t.id} className="flex items-center gap-3 px-3 py-2">
                  <Sprite kind="hero" variant={i} scale={2} />
                  <span className="text-[18px]">{t.name}</span>
                </Panel>
              ))}
              {lobby.teams.length === 0 && <Panel className="px-3 py-2 text-[15px]">還沒有隊伍加入</Panel>}
            </ul>
            <Panel tone="lav" className="px-3 py-2">
              <label className="flex items-center gap-3 text-[16px]">
                <input type="checkbox" className="h-5 w-5" checked={aiAvailable && aiOn} disabled={!aiAvailable} onChange={(e) => setAiOn(e.target.checked)} />
                AI 旁白
              </label>
              <div className="mt-1 text-[13px]">
                {aiAvailable ? "由 Claude 即時寫旁白，失敗或太慢時自動改用腳本旁白。" : "伺服器沒有設定 API 金鑰，會使用腳本旁白。"}
              </div>
            </Panel>
            <PixelButton
              variant="primary"
              className="mt-auto min-h-[78px] text-[26px]"
              disabled={!ready || lobby.teams.length === 0}
              onClick={() => send({ type: "HOST_START", aiNarration: aiAvailable && aiOn })}
            >
              開始遊戲 ▶
            </PixelButton>
          </section>
        )}

        {game && game.phase === "playing" && turn?.team && (
          <>
            <TurnRibbon>{turn.inBoss ? "首領戰　" : ""}輪到：{turn.team.name}</TurnRibbon>
            <Panel tone="turn" className="px-3 py-[10px]">
              <div className="flex items-center gap-3">
                <Sprite kind={turn.monster.kind} hue={turn.monster.hue} scale={Math.max(1, Math.floor(turn.monster.scale / 3))} className="flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]" style={{ color: "#6b4a2a" }}>{turn.inBoss ? "首領房" : `第 ${turn.room + 1} 房`}　{turn.monster.name}</div>
                  <div data-testid="host-question" className="text-[20px] leading-snug">{game.question?.text ?? `題目 ${turn.questionId}`}</div>
                </div>
              </div>
              <div className="mt-2">
                <ScoreMeter score={Math.min(turn.team.score, BOSS_THRESHOLD)} max={BOSS_THRESHOLD} active />
              </div>
              {answer && answer.questionId === turn.questionId && (
                <div className="mt-2 px-3 py-1" style={{ background: "#d6f5c2", color: "#1e5a1c", boxShadow: "inset 0 0 0 3px #6fd36a" }}>
                  <div className="text-[11px]" style={{ color: "#2f6a2c" }}>答案（只有你看得到）</div>
                  <div data-testid="host-answer" className="text-[19px]">{answer.answer}</div>
                </div>
              )}
              {turn.inBoss && <div className="mt-1 text-[14px]">首領血量 {game.view.bossHp} / {game.view.bossMaxHp}</div>}
            </Panel>

            <ul className="flex flex-col gap-2">
              {game.view.teams.map((t, i) => (
                <Panel key={t.id} className={`flex items-center gap-2 px-3 py-1 ${t.online ? "" : "opacity-50"}`}>
                  <Sprite kind="hero" variant={i} scale={1} className="flex-none" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{t.name}{t.online ? "" : "（離線）"}</span>
                  <span className="px-num text-[10px]" style={{ color: "#a8470f" }}>{t.score}/{BOSS_THRESHOLD}</span>
                </Panel>
              ))}
            </ul>

            <div className="mt-auto flex flex-col">
              {!ready && connected && <div className="px-1 text-center text-[14px] text-white">等待主持人驗證…</div>}
              <PixelButton variant="ok" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, true)}>
                {connected ? "答對！" : "重新連線中"}
              </PixelButton>
              <div className="grid grid-cols-2">
                <PixelButton variant="retry" className="text-[16px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "retry")}>
                  答錯・重答
                </PixelButton>
                <PixelButton variant="flee" className="text-[16px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "flee")}>
                  答錯・逃跑
                </PixelButton>
              </div>
            </div>
          </>
        )}

        {game && game.phase === "finished" && (
          <Panel tone="lav" className="mt-8 px-4 py-8 text-center">
            <div className="text-[28px]">遊戲結束！</div>
            <div className="mt-2 text-[18px]">
              {game.winners.map((id) => game.view.teams.find((t) => t.id === id)?.name ?? id).join("、")} 獲勝
            </div>
          </Panel>
        )}
      </div>

      {drawer && (
        <MoreDrawer
          code={code}
          onClose={() => setDrawer(false)}
          onTranscript={() => send({ type: "HOST_GET_TRANSCRIPT" })}
          currentLine={narration?.line ?? ""}
          onNotes={(notes) => send({ type: "HOST_SET_NOTES", notes })}
          onEdit={(line) => send({ type: "HOST_EDIT_NARRATION", line })}
          aiOn={aiAvailable && aiOn}
        />
      )}
    </main>
  );
}
