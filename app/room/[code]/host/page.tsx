"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { keepLatest, type NarrationState } from "@/lib/narration/client";
import { useParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { useRoomSocket } from "@/lib/use-room-socket";
import { freshAttempt, freshHostPath, generateRoomCode, getHostToken, isFreshRoomHash, MAX_FRESH_ATTEMPTS, settledHash } from "@/lib/room-code";
import type { ClientMessage, HostPick, LobbyTeams, ServerMessage, StateMessage } from "@/lib/protocol";
import { BOSS_THRESHOLD, describeTurn } from "@/lib/turn-info";
import { ordinal } from "@/lib/ordinal";
import { CLASS_ICONS, CLASS_LABELS } from "@/lib/game-state";
import { Panel, PixelButton, QuestionMedia, SceneBackground, ScoreMeter, Sprite, TurnRibbon } from "@/components/pixel";
import { Qr } from "@/components/qr";
import { hostKeyAction } from "@/lib/host-keys";
import { optionLetter } from "@/components/mc-option";

/** D11: the stuck-team row waits this long with no lock (or no choice after a wrong lock). */
const STUCK_MS = 15_000;


/** The host's own link carries the token, so it is shown here and never on /screen or /play. */
function MoreDrawer({
  code,
  onClose,
  send,
  lines,
  aiOn,
  bossable,
}: {
  code: string;
  onClose: () => void;
  send: (msg: ClientMessage) => void;
  /** The current narration's segments (1-3). The edit box below only ever rewrites the first
   * one, so hosts need to know there may be more they can't reach. */
  lines: string[];
  aiOn: boolean;
  /** Teams in play and not yet in the boss room: the host may send one there (scoring-and-score-pools.md S13). */
  bossable: { id: string; name: string }[];
}) {
  const currentLine = lines[0] ?? "";
  const totalSegments = lines.length;
  const [notes, setNotes] = useState("");
  const [line, setLine] = useState(currentLine);
  // 送王房 cannot be undone, so the first tap only arms it for 3 s.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const origin = location.origin;
  const token = getHostToken(code);
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
          {bossable.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="text-[15px]">{`送隊伍進王房（不用等到 ${BOSS_THRESHOLD} 分，送了不能退回）`}</div>
              {bossable.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[16px]">{t.name}</span>
                  <PixelButton
                    onClick={() => {
                      if (armed !== t.id) return setArmed(t.id);
                      setArmed(null);
                      send({ type: "HOST_SEND_TO_BOSS", teamId: t.id });
                    }}
                    className="!m-0 min-h-[44px] !px-3 !py-1 text-[15px]"
                  >
                    {armed === t.id ? "確定送？" : "送王房"}
                  </PixelButton>
                </div>
              ))}
            </section>
          )}
          <section>
            <div className="text-[15px]">大螢幕（在電視或投影機開這個網址）</div>
            {/* A new tab, so opening it never navigates the host page away from its socket. */}
            <a href={`/room/${code}/screen`} target="_blank" rel="noopener" className="block break-all text-[14px] underline underline-offset-2">{`${origin}/room/${code}/screen`}</a>
          </section>
          <section className="flex flex-col gap-2">
            <div className="text-[15px]">導演筆記{aiOn ? "（AI 每次寫旁白都會參考）" : "（AI 旁白已關閉，只會記錄）"}</div>
            <div className="text-[13px]">只影響語氣與風格，不是逐字台詞。想改已經出現的那一句，用下面的「改寫目前旁白」。</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} placeholder="例如：用武俠口吻，紅隊是一群恐龍" className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
            <PixelButton onClick={() => send({ type: "HOST_SET_NOTES", notes })} className="!m-0 !px-4 !py-2 text-[16px]">
              儲存導演筆記
            </PixelButton>
          </section>
          <section className="flex flex-col gap-2">
            <div className="text-[15px]">改寫第一句旁白{totalSegments > 1 ? `（共 ${totalSegments} 句，只能改第一句，最多 40 字）` : "（最多 40 字）"}</div>
            <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={40} disabled={!currentLine} className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
            <PixelButton onClick={() => send({ type: "HOST_EDIT_NARRATION", line })} disabled={!currentLine || !line.trim()} className="!m-0 !px-4 !py-2 text-[16px]">
              送出，立刻換上大螢幕
            </PixelButton>
          </section>
          <section>
            <PixelButton onClick={() => send({ type: "HOST_GET_TRANSCRIPT" })} className="!m-0 !px-4 !py-2 text-[16px]">
              下載旁白紀錄（JSON）
            </PixelButton>
            <div className="mt-3 text-[13px]">每一句旁白的事件、分數、來源與延遲。伺服器重啟後會消失。</div>
          </section>
          {hostUrl && (
            <section className="flex items-center gap-3">
              <Qr text={hostUrl} size={120} alt="主持人 QR" />
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

type Picks = Extract<ServerMessage, { type: "HOST_PICKS" }>;

/** The host picks a target's next question (HOST_QUEUE_QUESTION). The list only ever reaches the host page. */
function QuestionPicker({
  title,
  note,
  questions,
  current,
  teamName,
  onPick,
  onClose,
}: {
  title: string;
  note: string;
  questions: HostPick[];
  /** The target's queued pick, if any: shown as chosen, not as blocked. */
  current: string | undefined;
  teamName: (id: string) => string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = q ? questions.filter((x) => x.label.includes(q) || x.answer.includes(q)) : questions;
  const why = (b: NonNullable<HostPick["block"]>) =>
    b.kind === "revealed" ? "已公布" : b.kind === "held" ? (b.teamId === "boss" ? "王房正在用" : `${teamName(b.teamId)}正在答`) : `已排給${b.teamId === "boss" ? "王房" : teamName(b.teamId)}`;
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <Panel tone="lav" className="max-h-[85vh] w-full overflow-y-auto p-4">
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[19px]">{title}</span>
            <PixelButton onClick={onClose} className="!m-0 !px-4 !py-1 text-[16px]">
              關閉
            </PixelButton>
          </div>
          <div className="text-[13px]">{note}</div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋題目或答案" className="w-full border-4 border-[var(--k)] bg-white p-2 text-[16px]" />
          {shown.length === 0 && <div className="text-[14px]">沒有符合的題目</div>}
          {shown.map((x) => {
            const mine = x.id === current;
            const blocked = x.block && !mine;
            return (
              <button
                key={x.id}
                type="button"
                disabled={!!blocked}
                onClick={() => onPick(x.id)}
                // Blocked rows use DESIGN.md's faded-tile tokens, with the reason in full ink so it stays readable.
                className={`flex w-full items-start gap-2 border-[3px] p-2 text-left ${blocked ? "border-[var(--dim-line)] bg-[var(--cream2)] text-[var(--dim-ink)]" : "border-[var(--k)] bg-[var(--cream)]"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">{x.label}</span>
                  <span className="block text-[12px]" style={blocked ? undefined : { color: "#2f6a2c" }}>答案：{x.answer}</span>
                </span>
                {(blocked || mine) && <span className="flex-none text-[13px]" style={{ color: mine ? "#2f6a2c" : "var(--ink)" }}>{mine ? "目前選的" : why(x.block!)}</span>}
              </button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

export default function HostPage() {
  const { code } = useParams<{ code: string }>();

  const [lobby, setLobby] = useState<LobbyTeams>([]);
  const [game, setGame] = useState<StateMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noToken, setNoToken] = useState(false);
  const [connected, setConnected] = useState(false);
  const [claimed, setClaimed] = useState(false);
  /** Host-only: the answer to the question in play. Never shown on /screen or /play. */
  const [answer, setAnswer] = useState<{ questionId: string; answer: string } | null>(null);
  const [drawer, setDrawer] = useState(false);
  /** Host-only: what the host may queue as a team's (or the boss's) next question, with answers. */
  const [picks, setPicks] = useState<Picks | null>(null);
  /** The open picker's target: a team id or "boss". */
  const [picking, setPicking] = useState<string | null>(null);
  /** Server has an API key, so AI narration can be switched on. Default on when it can. */
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const [joinPassword, setJoinPassword] = useState("");
  const [savedPassword, setSavedPassword] = useState("");
  const [narration, setNarration] = useState<NarrationState>(null);
  // Team whose judge buttons are disabled while we wait for the server's
  // STATE broadcast to confirm the judgment — doubles as visible click
  // feedback (buttons dim) and blocks accidental double-clicks from firing
  // two judgments for the same turn.
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);

  const room = useRoomSocket(code, {
    onOpen(resume) {
      setConnected(true);
      // Claim on every (re)connect: the server forgets host rights when the socket closes.
      const t = getHostToken(code);
      if (t) room.send({ type: "HOST_CLAIM", token: t, ...(resume ? { resume: true } : {}) });
      else setNoToken(true);
    },
    onClose() {
      setConnected(false);
      setClaimed(false);
      setPendingTeamId(null);
    },
    onMessage(msg) {
      switch (msg.type) {
        case "HOST_OK":
          setClaimed(true);
          // The room is ours: from now on this link can no longer swap its code.
          if (isFreshRoomHash(location.hash)) history.replaceState(null, "", location.pathname + location.search + settledHash(location.hash));
          setAiAvailable(msg.aiAvailable);
          setJoinPassword(msg.joinPassword);
          setSavedPassword(msg.joinPassword);
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
        case "HOST_PICKS":
          setPicks(msg);
          break;
        case "LOBBY":
          setLobby(msg.teams);
          setGame(null);
          setPicks(null);
          setPicking(null);
          break;
        case "STATE":
          setGame(msg);
          setPendingTeamId(null);
          break;
        case "GAME_OVER":
          setGame((g) => (g ? { ...g, phase: "finished", winners: msg.winners } : g));
          setPendingTeamId(null);
          setPicks(null);
          setPicking(null);
          break;
        case "ERROR":
          // A room we just created answers bad_token when its code was already taken: pick another code.
          // Bounded: five taken codes in a row is not bad luck, so after that the error below is shown.
          {
            const attempt = freshAttempt(location.hash);
            if (msg.error === "bad_token" && attempt > 0 && attempt < MAX_FRESH_ATTEMPTS) {
              const token = getHostToken(code);
              // token is expected here (we only reach a fresh-room retry after sending HOST_CLAIM with it), but
              // if it somehow vanished, fall through to the normal error instead of leaving the page silent.
              if (token) {
                location.replace(freshHostPath(generateRoomCode(), token, attempt + 1));
                break;
              }
            }
          }
          setError(
            msg.error === "bad_token"
              ? "主持人金鑰不符，這個瀏覽器不是這個房間的主持人"
              : msg.detail === "reveal_pending"
                ? "大螢幕正在揭曉，先按「下一題」"
                : `${msg.error}${msg.detail ? `: ${msg.detail}` : ""}`,
          );
          setPendingTeamId(null);
          break;
      }
    },
  });

  const { reset, rested } = room;
  const teamName = (id: string) => game?.view.teams.find((t) => t.id === id)?.name ?? "";
  const pickLabel = (id: string) => picks?.questions.find((q) => q.id === id)?.label ?? "";
  /** 指定 opens the picker; with a pick queued, 取消 clears it. */
  function pickButton(target: string) {
    const queued = picks?.queued[target];
    return (
      <PixelButton
        onClick={() => (queued ? send({ type: "HOST_QUEUE_QUESTION", target, questionId: null }) : setPicking(target))}
        className="!m-0 min-h-[44px] !px-3 !py-0 text-[14px]"
      >
        {queued ? "取消" : target === "boss" ? "指定" : "指定下一題"}
      </PixelButton>
    );
  }
  function send(msg: ClientMessage) {
    setError(null);
    room.send(msg);
  }

  function judge(teamId: string, questionId: string, correct: boolean, fleeChoice?: "flee" | "retry") {
    setPendingTeamId(teamId);
    send({ type: "HOST_JUDGE", teamId, questionId, correct, fleeChoice, ...(game ? { eventId: game.eventId } : {}) });
  }

  // Disconnect UI: judge buttons disable and "重新連線中" shows here; /play and /screen show their own
  // notice (lib/offline-notice.ts), and a phone is told after reconnecting if its turn was skipped.
  const ready = connected && claimed;
  const turn = game ? describeTurn(game.view, game.question, game.phaseCard?.monster) : null;
  // The judge buttons and 下一題 swap in the same slot the moment a STATE arrives, so a double-tap
  // on one would land on the other (judging the next question, or closing a reveal nobody saw).
  // Both stay disabled for a beat after every swap.
  // The boss's phase card is a pause like a reveal: 下一題 closes it (docs/designs/boss-phases.md D3).
  const revealUp = !!game?.reveal || !!game?.phaseCard;
  // Keyed on the pause itself, not just "a pause is up": the answer reveal turning into the phase card
  // swaps 下一題 for another 下一題, and a double-tap must not close the card nobody has seen.
  const pauseKey = game?.reveal ? `reveal-${game.eventId}` : game?.phaseCard ? `card-${game.eventId}` : "";
  const [armedFor, setArmedFor] = useState(pauseKey);
  const swapArmed = armedFor === pauseKey;
  useEffect(() => {
    const t = setTimeout(() => setArmedFor(pauseKey), 500);
    return () => clearTimeout(t);
  }, [pauseKey]);
  // A warrior's roll in its beat is judged by the room (class-abilities.md R2): the host waits it out too.
  const roll = game?.pendingRoll ?? null;
  const canJudge = ready && swapArmed && !!turn?.team && pendingTeamId !== turn.team.id && !roll;

  // Phone answering (docs/designs/phone-answering.md D3, D11, D13): a multipleChoice turn is judged by
  // the team's lock, so the host only watches it, and gets 替選・重答 / 逃跑 after 15 s of no progress.
  const isMc = !game?.reveal && !!game?.question?.options;
  const lock = game?.pendingLock ?? null;
  const wrong = game?.view.pendingWrong ?? null;
  // A wrong boss lock resolves on its own after a beat (D2=B). The stuck row still comes after 15 s,
  // as the way out if that beat never resolves.
  const bossMiss = !!wrong && !!game?.view.teams.find((t) => t.id === wrong.teamId)?.inBossPhase;
  const stuckKey = isMc && turn?.team && !lock ? `${turn.team.id}|${turn.questionId}|${wrong ? "wrong" : "pick"}|${game?.eventId}` : null;
  const [stuckShownFor, setStuckShownFor] = useState<string | null>(null);
  useEffect(() => {
    if (!stuckKey) return;
    const t = setTimeout(() => setStuckShownFor(stuckKey), STUCK_MS);
    return () => clearTimeout(t);
  }, [stuckKey]);
  const stuck = !!stuckKey && stuckShownFor === stuckKey;

  // Keyboard shortcuts for a host on a laptop (lib/host-keys.ts): each key does exactly what its
  // button does, and only while that button is enabled. A layout effect, so the listener already
  // holds the new turn when it is painted: a key pressed right after a turn change judges that turn.
  useLayoutEffect(() => {
    if (game?.phase !== "playing") return;
    function onKey(e: KeyboardEvent) {
      // An open picker or drawer covers the turn: a key there must not judge it or close a reveal.
      if (picking || drawer) return;
      // Fields spelled out: KeyboardEvent's are prototype getters, which `{ ...e }` would not copy.
      const target = e.target as HTMLElement | null;
      const action = hostKeyAction(
        { key: e.key, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target },
        revealUp,
        isMc ? { stuck } : undefined,
      );
      if (!action || !game) return;
      if (action === "next") {
        if (!ready || !swapArmed) return;
        send({ type: "HOST_NEXT", eventId: game.eventId });
      } else {
        if (!canJudge || !turn?.team || !turn.questionId) return;
        if (action === "correct") judge(turn.team.id, turn.questionId, true);
        else if (!(bossMiss && action === "flee")) judge(turn.team.id, turn.questionId, false, action); // no 逃跑 button on a boss miss
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // judge/send are plain functions over state this effect already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, ready, swapArmed, canJudge, turn, isMc, stuck, picking, drawer, revealUp]);

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
        {rested && (
          <Panel tone="turn" role="status" className="flex flex-col items-center gap-2 px-3 py-2 text-center text-[16px]">
            {REST_NOTICE[rested]}
            <PixelButton
              onClick={room.reconnect}
              className="!m-0 !px-4 !py-2 text-[16px]"
            >{RESTED_RECONNECT_LABEL}</PixelButton>
          </Panel>
        )}
        {!connected && !noToken && !rested && <Panel tone="turn" className="px-3 py-2 text-center text-[16px]">重新連線中…</Panel>}
        {error && <Panel className="px-3 py-2 text-[14px]" style={{ background: "#ffd9d9" }}>{error}</Panel>}

        {!game && (
          <section className="flex flex-1 flex-col gap-3">
            <Panel tone="lav" className="px-3 py-2 text-[18px]">等待隊伍加入…</Panel>
            <ul className="flex flex-col gap-2">
              {lobby.map((t, i) => (
                <Panel key={t.id} className="flex items-center gap-3 px-3 py-2">
                  <Sprite kind="hero" variant={i} scale={2} />
                  <span className="text-[18px]">{t.name}</span>
                  {t.classId && <span className="text-[15px]">{CLASS_ICONS[t.classId]} {CLASS_LABELS[t.classId]}</span>}
                </Panel>
              ))}
              {lobby.length === 0 && <Panel className="px-3 py-2 text-[15px]">還沒有隊伍加入</Panel>}
            </ul>
            <Panel className="flex items-center gap-3 px-3 py-2">
              <Qr text={typeof location === "undefined" ? "" : `${location.origin}/?code=${code}`} size={120} />
              <div className="text-[15px]">
                <div className="text-[18px]">玩家掃描加入</div>
                <div className="mt-1 text-[14px]">或輸入房間代碼 {code}</div>
              </div>
            </Panel>
            <Panel tone="lav" className="px-3 py-2">
              <label className="flex items-center gap-3 text-[16px]">
                <input type="checkbox" className="h-5 w-5" checked={aiAvailable && aiOn} disabled={!aiAvailable} onChange={(e) => setAiOn(e.target.checked)} />
                AI 旁白
              </label>
              <div className="mt-1 text-[13px]">
                {aiAvailable ? "由 Claude 即時寫旁白，失敗或太慢時自動改用腳本旁白。" : "伺服器沒有設定 API 金鑰，會使用腳本旁白。"}
              </div>
            </Panel>
            <Panel tone="lav" className="flex flex-col gap-2 px-3 py-2">
              <div className="text-[16px]">加入密碼（選填）</div>
              <div className="text-[13px]">設了之後，新隊伍要輸入密碼才能加入；已經加入的隊伍不受影響。公開網址建議設定。</div>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  // HOST_OK fills this with the room's password, so typing before it arrives would be overwritten.
                  disabled={!ready}
                  maxLength={32}
                  autoComplete="off"
                  placeholder="不設就留空"
                  className="min-w-0 flex-1 border-4 border-[var(--k)] bg-white px-2 py-1 text-[16px]"
                />
                <PixelButton
                  disabled={!ready || joinPassword.trim() === savedPassword}
                  // 目前密碼 changes on the room's HOST_OK reply, not here: it must show what the room enforces.
                  onClick={() => send({ type: "HOST_SET_PASSWORD", password: joinPassword })}
                  className="!m-0 !px-4 !py-2 text-[16px]"
                >
                  設定
                </PixelButton>
              </div>
              <div className="text-[13px]">{savedPassword ? `目前密碼：${savedPassword}` : "目前沒有密碼，知道代碼就能加入"}</div>
            </Panel>
            <PixelButton
              variant="primary"
              className="mt-auto min-h-[78px] text-[26px]"
              disabled={!ready || lobby.length === 0}
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
                <Sprite kind={turn.monster.kind} hue={turn.monster.hue} scale={turn.miniScale} className="flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]" style={{ color: "#6b4a2a" }}>{turn.inBoss ? "首領房" : `第 ${turn.room + 1} 房`}　{turn.monster.name}</div>
                  <div data-testid="host-question" className="text-[20px] leading-snug">
                    {game.question?.content.kind === "text" ? game.question.content.value : `題目 ${turn.questionId}`}
                  </div>
                  {/* The host previously never saw question media at all (text-only preview) —
                      a small preview so judging an image/video question doesn't mean squinting
                      at the big screen from across the room (complexity-gate scope, /plan-eng-review). */}
                  {game.question?.content.kind === "image" && (
                    <QuestionMedia key={game.question.id} content={game.question.content} maxWidth={120} maxHeight={90} className="mt-1" />
                  )}
                  {/* A 120px YouTube embed is below the player's minimum size and won't play — the
                      host watches the big screen instead. */}
                  {game.question?.content.kind === "youtube" && <div className="mt-1 text-[14px]" style={{ color: "#6b4a2a" }}>影片題（看大螢幕）</div>}
                </div>
              </div>
              <div className="mt-2">
                <ScoreMeter score={turn.team.score} active />
              </div>
              {/* The team's current tap on a multipleChoice question, if any — lets the host see
                  what they picked before judging, same panel timing as the answer reveal below. */}
              {game.question?.options && (
                <div className="mt-2 flex flex-col gap-1">
                  {game.question.options.map((opt, i) => (
                    <div
                      key={i}
                      data-testid={`host-option-${i}`}
                      className="flex items-center gap-2 px-3 py-1 text-[16px]"
                      style={
                        turn.team!.currentSelection === i
                          ? { background: "var(--turn)", boxShadow: "inset 0 0 0 3px var(--turn2)" }
                          : { background: "var(--cream2)" }
                      }
                    >
                      <b className="px-num inline-flex h-6 w-6 flex-none items-center justify-center text-[11px]" style={{ background: "var(--k)", color: "var(--turn2)" }}>{optionLetter(i)}</b>
                      <span className={game.view.eliminated?.[game.question!.id]?.includes(i) ? "line-through" : ""}>{opt}</span>
                      {turn.team!.currentSelection === i && <span className="ml-2 text-[13px]">← 隊伍目前選的</span>}
                    </div>
                  ))}
                </div>
              )}
              {answer && answer.questionId === turn.questionId && (
                <div className="mt-2 px-3 py-1" style={{ background: "#d6f5c2", color: "#1e5a1c", boxShadow: "inset 0 0 0 3px #6fd36a" }}>
                  <div className="text-[11px]" style={{ color: "#2f6a2c" }}>答案（只有你看得到）</div>
                  <div data-testid="host-answer" className="text-[19px]">{answer.answer}</div>
                </div>
              )}
              {turn.inBoss && (
                <div data-testid="host-boss-hp" className="mt-1 text-[14px]">
                  首領血量 {game.view.bossHp} / {game.view.bossMaxHp}
                  {/* Host-only (HOST_PICKS): how many phases there are and what comes next (D2). */}
                  {/* `?.`: a Worker from before boss phases sends HOST_PICKS without them. */}
                  {picks?.bossPhases && picks.bossPhases.length > 1 &&
                    `・第 ${picks.bossPhaseIndex + 1}/${picks.bossPhases.length} 階段・${
                      picks.bossPhaseIndex + 1 < picks.bossPhases.length ? `下一階段：${picks.bossPhases[picks.bossPhaseIndex + 1].name}` : "最後階段"
                    }`}
                </div>
              )}
            </Panel>

            {picks && game.view.teams.some((t) => t.inBossPhase) && (
              <Panel tone="turn" className="flex items-center gap-2 px-3 py-1">
                <span className="min-w-0 flex-1 truncate text-[14px]">首領房下一題：{picks.queued.boss ? pickLabel(picks.queued.boss) : "照順序"}</span>
                {pickButton("boss")}
              </Panel>
            )}

            <ul className="flex flex-col gap-2">
              {game.view.teams.map((t, i) => (
                <Panel key={t.id} className={`flex flex-wrap items-center gap-2 px-3 py-1 ${t.online ? "" : "opacity-50"}`}>
                  <Sprite kind="hero" variant={i} scale={1} className="flex-none" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{t.name}{t.online ? "" : "（離線）"}</span>
                  {t.classId && <span className="text-[13px]" title={`${CLASS_LABELS[t.classId]}，剩 ${t.abilityUses} 次`}>{CLASS_ICONS[t.classId]}{t.abilityUses}</span>}
                  <span className="px-num text-[10px]" style={{ color: "#a8470f" }}>{t.score}/{BOSS_THRESHOLD}</span>
                  <span className="px-num text-[10px]" style={{ color: "#2f6a2c" }} title="獎勵分">{t.reward}</span>
                  {picks && !t.inBossPhase && !picks.queued[t.id] && pickButton(t.id)}
                  {picks?.queued[t.id] && (
                    <div className="flex min-w-0 basis-full items-center gap-2 pl-6 text-[13px]">
                      <span data-testid="queued-pick" className="min-w-0 flex-1 truncate">下一題：{pickLabel(picks.queued[t.id])}</span>
                      {pickButton(t.id)}
                    </div>
                  )}
                </Panel>
              ))}
            </ul>

            <div className="mt-auto flex flex-col">
              {!ready && connected && <div className="px-1 text-center text-[14px] text-white">等待主持人驗證…</div>}
              {revealUp ? (
                // D7: the big screen and every phone show the answer in place of the next
                // question until the host moves on — judging waits until then. The boss's phase card
                // waits the same way (boss-phases.md D3).
                <>
                  <Panel tone="lav" className="px-3 py-2 text-center text-[16px]">
                    <div data-testid="host-reveal">
                      大螢幕正在揭曉：{game.reveal ? game.reveal.answer : `第${ordinal(game.view.bossPhase)}階段－${game.bossPhaseInfo?.name ?? ""}`}
                    </div>
                  </Panel>
                  <PixelButton variant="ok" disabled={!ready || !swapArmed} onClick={() => send({ type: "HOST_NEXT", eventId: game.eventId })}>
                    {connected ? "下一題" : "重新連線中"}
                    <span className="px-key" aria-hidden="true">1</span>
                  </PixelButton>
                </>
              ) : isMc ? (
                <>
                  <div data-testid="host-mc-status">
                  <Panel tone="lav" className="px-3 py-2 text-center">
                    <div className="text-[22px]">
                      {roll
                        ? `${turn.team.name}擲出了骰子…`
                        : lock
                        ? `${turn.team.name}鎖定了 ${optionLetter(lock.optionIndex)}…`
                        : bossMiss
                          ? "答錯！首領換一題…"
                          : wrong
                          ? `答錯！等${turn.team.name}選重答或逃跑`
                          : `等${turn.team.name}鎖定答案…`}
                    </div>
                    <div className="text-[14px]">{lock || roll ? "大螢幕停頓 2 秒後揭曉" : "選擇題由隊伍手機作答，系統自動判定"}</div>
                  </Panel>
                  </div>
                  {stuck && (
                    <>
                      <div className="px-1 pt-2 text-center text-[14px] text-white">{turn.team.name}好像卡住了</div>
                      <div className="px-1 pt-1 text-[14px] text-white">隊伍卡住時：</div>
                      <div className={bossMiss ? "grid" : "grid grid-cols-2"}>
                        <PixelButton variant="retry" className="!min-h-[48px] text-[15px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "retry")}>
                          替{turn.team.name}選・重答
                          <span className="px-key" aria-hidden="true">2</span>
                        </PixelButton>
                        {!bossMiss && (
                          <PixelButton variant="flee" className="!min-h-[48px] text-[15px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "flee")}>
                            替{turn.team.name}選・逃跑
                            <span className="px-key" aria-hidden="true">3</span>
                          </PixelButton>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  {roll && (
                    <Panel tone="lav" className="px-3 py-2 text-center text-[22px]" role="status">
                      {turn.team.name}擲出了骰子…
                    </Panel>
                  )}
                  <PixelButton variant="ok" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, true)}>
                    {connected ? "答對！" : "重新連線中"}
                    <span className="px-key" aria-hidden="true">1</span>
                  </PixelButton>
                  <div className="grid grid-cols-2">
                    <PixelButton variant="retry" className="text-[16px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "retry")}>
                      答錯・重答
                      <span className="px-key" aria-hidden="true">2</span>
                    </PixelButton>
                    <PixelButton variant="flee" className="text-[16px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "flee")}>
                      答錯・逃跑
                      <span className="px-key" aria-hidden="true">3</span>
                    </PixelButton>
                  </div>
                </>
              )}
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

      {picking && picks && game && (
        <QuestionPicker
          title={picking === "boss" ? "指定首領房下一題" : `替${teamName(picking)}指定下一題`}
          note={`${picking === "boss" ? "首領房下一次換題" : `${teamName(picking)}下一次換到這個難度的題目（通常是答對進下一間房）`}時就出這題。只有你看得到這個清單。`}
          questions={(picks.options[picking] ?? []).flatMap((id) => picks.questions.find((x) => x.id === id) ?? [])}
          current={picks.queued[picking]}
          teamName={teamName}
          onPick={(id) => {
            send({ type: "HOST_QUEUE_QUESTION", target: picking, questionId: id });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {drawer && (
        <MoreDrawer
          code={code}
          onClose={() => setDrawer(false)}
          send={send}
          lines={narration?.lines ?? []}
          aiOn={aiAvailable && aiOn}
          bossable={game?.phase === "playing" ? game.view.teams.filter((t) => !t.inBossPhase) : []}
        />
      )}
    </main>
  );
}
