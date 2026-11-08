"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { isPending, keepLatest, type NarrationState } from "@/lib/narration/client";
import { useParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { UNREACHABLE_NOTICE, UNREACHABLE_RETRY_LABEL } from "@/lib/offline-notice";
import { useRoomSocket } from "@/lib/use-room-socket";
import { useWakeLock } from "@/lib/use-wake-lock";
import { freshAttempt, freshHostPath, generateRoomCode, getHostToken, isFreshRoomHash, MAX_FRESH_ATTEMPTS, settledHash } from "@/lib/room-code";
import { HANDOFF_MS, INTRO_PAGES, MAX_PASSWORD, scoreName, SERVE_HOLD_MS, type ClientMessage, type LobbyTeams, type MediaAction, type MediaCommand, type ServerMessage, type StateMessage } from "@/lib/protocol";
import { forgetStored, writeStored } from "@/lib/stored";
import { BOSS_THRESHOLD, describeTurn } from "@/lib/turn-info";
import { ordinal } from "@/lib/ordinal";
import { CLASS_ICONS, CLASS_LABELS } from "@/lib/game-state";
import { Panel, PixelButton, QuestionMedia, SceneBackground, ScoreMeter, Sprite, TurnRibbon } from "@/components/pixel";
import { Qr } from "@/components/qr";
import { MageHint } from "@/components/mage-hint";
import { clericStage, HOST_KEYS, hostKeyAction, introKeyAction } from "@/lib/host-keys";
import { INTRO_PAGE_TEXT, introDots } from "@/components/how-to-play";
import { optionLetter } from "@/components/mc-option";
import { sortOrderOf } from "@/lib/sort-order";
import { AI_ERRORS, AI_STORE, AiExhausted, AiPanel, aiKeyMessage, readSavedAiKey, type AiCredential, type AiStatus } from "@/components/host-ai";
import { MoreDrawer } from "@/components/more-drawer";
import { NarrationPanel, type EditRefusal } from "@/components/narration-panel";
import { QuestionPicker } from "@/components/question-picker";
import { createAiKeyQueue } from "@/lib/host-ai-queue";

/** D11: the stuck-team row waits this long with no lock (or no choice after a wrong lock). */
const STUCK_MS = 15_000;
/** A cleric's wait, and the prayed attempt after it, ignore keys and clicks this long after they appear, so a
 * double-tap of 答錯 never lands on 祈禱 / 重答, nor one of 祈禱 on the new attempt's 答對 / 答錯 (#106). */
const CLERIC_WAIT_DELAY_MS = 500;
const noSubscribe = () => () => {};
/** HOST_EDIT_NARRATION refusals: the narration panel shows them in its editor, not the page's error line. */
const NARRATION_REFUSALS = new Set(["no_narration", "stale_narration", "bad_index", "line_read", "empty_edit"]);

type Picks = Extract<ServerMessage, { type: "HOST_PICKS" }>;

export default function HostPage() {
  // "" on the server, the real origin after hydration: reading location in render would mismatch the server HTML.
  const origin = useSyncExternalStore(noSubscribe, () => location.origin, () => "");
  const { code } = useParams<{ code: string }>();
  useWakeLock();

  const [lobby, setLobby] = useState<LobbyTeams>([]);
  /** The room has played a game (LOBBY `replay`), so the intro checkbox starts unchecked (how-to-play.md D8, eng D5). */
  const [replay, setReplay] = useState(false);
  /** The host's own tick of the intro checkbox, kept only for the replay state it was made in. */
  const [introPick, setIntroPick] = useState<{ replay: boolean; on: boolean } | null>(null);
  const introOn = introPick && introPick.replay === replay ? introPick.on : !replay;
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
  /** Team id -> the handoff code the room gave this page, shown in that team's row (docs/designs/team-handoff.md). */
  const [handoffs, setHandoffs] = useState<Record<string, string>>({});
  const dropHandoff = (teamId: string, code?: string) =>
    setHandoffs((h) => {
      if (!(teamId in h) || (code !== undefined && h[teamId] !== code)) return h;
      const rest = { ...h };
      delete rest[teamId];
      return rest;
    });
  /** The open picker's target: a team id or "boss". */
  const [picking, setPicking] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  /** null until the room reports its queued line: an older room would not understand HOST_NEXT_LINE (D5). */
  const [nextLine, setNextLine] = useState<string | null>(null);
  /** The key the room last accepted. The room keeps keys in memory only, so this is resent after every HOST_OK. */
  const aiSaved = useRef<AiCredential | null>(null);
  /** A key sent but not yet confirmed by HOST_AI_STATUS. */
  const aiPending = useRef<{ credential: AiCredential; remember: boolean } | null>(null);
  const [aiQueue] = useState(createAiKeyQueue);
  const aiSend = (msg: ClientMessage) => aiQueue.choose(msg, send);
  const [aiRemembered, setAiRemembered] = useState(false);
  /** The limit the host said 不用了 to, so the prompt stays closed until the limit changes. */
  const [aiDismissedAt, setAiDismissedAt] = useState<number | null>(null);
  useEffect(() => {
    aiSaved.current = readSavedAiKey();
    setAiRemembered(aiSaved.current !== null);
  }, []);
  const forgetAiKey = () => {
    aiSaved.current = null;
    aiPending.current = null;
    forgetStored(AI_STORE.own);
    forgetStored(AI_STORE.owner);
    setAiRemembered(false);
  };
  const [joinPassword, setJoinPassword] = useState("");
  const [savedPassword, setSavedPassword] = useState("");
  const [narration, setNarration] = useState<NarrationState>(null);
  /** How far the big screen has read, per narration (host-narration-edit.md D3). */
  const [readTo, setReadTo] = useState<{ eventId: number; done: number } | null>(null);
  /** The room's last refusal of a narration edit, shown in the panel's editor (D10). */
  const [editRefusal, setEditRefusal] = useState<EditRefusal | null>(null);
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
      aiQueue.closed();
      setPendingTeamId(null);
    },
    onMessage(msg) {
      switch (msg.type) {
        case "HOST_OK":
          setClaimed(true);
          // The room is ours: from now on this link can no longer swap its code.
          if (isFreshRoomHash(location.hash)) history.replaceState(null, "", location.pathname + location.search + settledHash(location.hash));
          aiQueue.hostOk(aiSaved.current && aiKeyMessage(aiSaved.current), room.send);
          setJoinPassword(msg.joinPassword);
          setSavedPassword(msg.joinPassword);
          break;
        case "HOST_AI_STATUS": {
          setAiStatus(msg);
          const p = aiPending.current;
          if (p) {
            const c = p.credential;
            const applied = c.source === "own" ? msg.source === "own" && msg.keyHint === `…${c.key.slice(-4)}` : msg.source === "owner" && !msg.keyMissing;
            // No clearing on an error: a status sent for something else (a limit change) can carry the room's
            // old error while this key is still being checked. A refused key simply never gets applied.
            if (applied) {
              aiPending.current = null;
              aiSaved.current = c;
              forgetStored(AI_STORE.own);
              forgetStored(AI_STORE.owner);
              if (p.remember) writeStored(AI_STORE[c.source], c.source === "own" ? c.key : c.ownerKey);
              setAiRemembered(p.remember);
            }
          }
          // The host's own key refused mid-game: never resend it. (In owner mode the server's key is at fault, not OWNER_KEY.)
          if (msg.error === "invalid_key" && msg.keyMissing && msg.source === "own") forgetAiKey();
          break;
        }
        case "HOST_NEXT_LINE_STATE":
          setNextLine(msg.line);
          break;
        case "NARRATION":
          setNarration((n) => keepLatest(n, msg));
          break;
        case "HOST_NARRATION_PROGRESS":
          setReadTo(msg);
          break;
        case "TRANSCRIPT": {
          // Host-only download of every narration line with provider, latency and fallback reason.
          const blob = new Blob([JSON.stringify(msg.entries, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `critical-answer-${code}-transcript.json`;
          a.click();
          // Safari starts the download after click() returns; revoking at once can cancel it.
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          break;
        }
        case "HOST_ANSWER":
          setAnswer({ questionId: msg.questionId, answer: msg.answer });
          break;
        case "HOST_PICKS":
          setPicks(msg);
          break;
        case "HANDOFF_CODE":
          setHandoffs((h) => ({ ...h, [msg.teamId]: msg.code }));
          // The room forgets a code after HANDOFF_MS, so the page stops showing it then (unless a newer one replaced it).
          setTimeout(() => dropHandoff(msg.teamId, msg.code), HANDOFF_MS);
          break;
        case "LOBBY":
          setLobby(msg.teams);
          setReplay(!!msg.replay);
          setGame(null);
          setPicks(null);
          setPicking(null);
          setHandoffs({});
          // Back from a finished game (回到大廳): its last line and answer are not the next game's.
          setNarration(null);
          setReadTo(null);
          setAnswer(null);
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
          // Any error releases an edit in flight (no stuck 送出中…); the edit refusals show in the panel, not the error line.
          setEditRefusal((r) => ({ detail: msg.detail ?? msg.error, seq: (r?.seq ?? 0) + 1 }));
          if (msg.detail && NARRATION_REFUSALS.has(msg.detail)) break;
          setError(
            msg.error === "bad_token"
              ? "主持人金鑰不符，這個瀏覽器不是這個房間的主持人"
              : msg.detail === "reveal_pending"
                ? `大螢幕正在揭曉，先按「${toServe ? "🍲 上菜" : "下一題"}」`
                : msg.detail === "duplicate_name"
                ? "已經有隊伍叫這個名字了"
                : msg.error === "invalid_name"
                ? "隊名不能用，請換一個"
                : `${msg.error}${msg.detail ? `: ${msg.detail}` : ""}`,
          );
          setPendingTeamId(null);
          break;
      }
    },
  });

  const { reset, rested, unreachable } = room;
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

  function judge(teamId: string, questionId: string, correct: boolean, fleeChoice?: "flee" | "retry" | "team" | "pray") {
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
  // The intro's pages count too: 下一頁 turns into 開始冒險 in its slot, and then into the judge buttons.
  // A dish reveal takes 🍲 上菜 first (monster-cuisine.md cooking R5); serving swaps it for 上菜中… then 下一題.
  const toServe = game?.phase === "playing" && !!game.reveal?.dish && !game.reveal.served;
  const servedUp = !!game?.reveal?.served;
  const pauseKey = game?.reveal ? `reveal-${game.eventId}${servedUp ? "-served" : ""}` : game?.phaseCard ? `card-${game.eventId}` : game?.intro ? `intro-${game.intro.page}` : "";
  const [armedFor, setArmedFor] = useState(pauseKey);
  const swapArmed = armedFor === pauseKey;
  useEffect(() => {
    // After 上菜, 下一題 waits out the cooking as the room does (cooking I2).
    const t = setTimeout(() => setArmedFor(pauseKey), pauseKey.endsWith("-served") ? SERVE_HOLD_MS : 500);
    return () => clearTimeout(t);
  }, [pauseKey]);
  // 改判答對 shows up under the judge buttons, which the bottom-anchored column then pushes up: it waits out a double tap
  // on 答錯 like every other swap (red-team review).
  const undoKey = game?.undoWrong ? `${game.undoWrong.teamId}|${game.undoWrong.questionId}|${game.eventId}` : "";
  const [undoArmedFor, setUndoArmedFor] = useState(undoKey);
  useEffect(() => {
    const t = setTimeout(() => setUndoArmedFor(undoKey), 500);
    return () => clearTimeout(t);
  }, [undoKey]);
  const canUndo = ready && !!game?.undoWrong && undoArmedFor === undoKey;
  // A warrior's roll in its beat is judged by the room (class-abilities.md R2): the host waits it out too.
  const roll = game?.pendingRoll ?? null;
  // A lock waiting for 公布答案 holds every judgment too (the room refuses with lock_pending).
  const canJudge = ready && swapArmed && !!turn?.team && pendingTeamId !== turn.team.id && !roll && !game?.pendingLock;

  // Phone answering (docs/designs/phone-answering.md D3, D11, D13): a multipleChoice turn is judged by
  // the team's lock, which waits for the host's 公布答案 (host-reveal.md); the host gets 替選・重答 / 逃跑 after 15 s of no progress.
  const isMc = !game?.reveal && !!(game?.question?.options || game?.question?.items);
  const lock = game?.pendingLock ?? null;
  // The lock waits for the host's 公布答案 (docs/designs/host-reveal.md); its team may no longer be on turn.
  const lockTeam = lock ? game?.view.teams.find((t) => t.id === lock.teamId)?.name ?? "" : "";
  const lockWaiting = !!lock && !lock.revealing;
  // A sort lock names a whole order: the host reads it out against the answer.
  const sortItems = lock && game?.question?.id === lock.questionId ? game.question.items : undefined;
  const sortedLock = sortItems && sortOrderOf(lock!.optionIndex)?.map((i) => sortItems[i]).join(" → ");
  const wrong = game?.view.pendingWrong ?? null;
  // A wrong boss lock resolves on its own after a beat (D2=B). The stuck row still comes after 15 s,
  // as the way out if that beat never resolves.
  const bossMiss = !!wrong && wrong.optionIndex !== null && !!game?.view.teams.find((t) => t.id === wrong.teamId)?.inBossPhase;
  // A cleric's fill-in (#106): one 答錯 that waits for the team, then 祈禱 / 重答 / 逃跑 for whoever presses first.
  const cleric = game && !isMc && turn?.team ? clericStage(game.view, turn.team.id) : undefined;
  const turnKey = turn?.team ? `${turn.team.id}|${turn.questionId}` : null;
  // The last wait's team and question, kept after it ends: the same team's next judge buttons on it hold too.
  const [lastWait, setLastWait] = useState<string | null>(null);
  if (cleric === "wait" && turnKey && lastWait !== turnKey) setLastWait(turnKey);
  const holdKey = turnKey && (cleric === "wait" || lastWait === turnKey) ? `${turnKey}|${game?.eventId}|${cleric ?? ""}` : null; // the stage too: a wait keeps its 答錯's eventId
  const [releasedFor, setReleasedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!holdKey) return;
    const t = setTimeout(() => setReleasedFor(holdKey), CLERIC_WAIT_DELAY_MS);
    return () => clearTimeout(t);
  }, [holdKey]);
  const held = !!holdKey && releasedFor !== holdKey;
  const stuckKey = isMc && turn?.team && !lock && !roll ? `${turn.team.id}|${turn.questionId}|${wrong ? "wrong" : "pick"}|${game?.eventId}` : null;
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
  // The intro's own keys (D7): → / Enter and ←. The judge keys below stay off while it shows.
  const introPage = game?.phase === "playing" ? (game.intro?.page ?? null) : null;
  useEffect(() => {
    if (introPage === null || !ready) return;
    function onKey(e: KeyboardEvent) {
      if (picking || drawer || !swapArmed) return;
      const action = introKeyAction({ key: e.key, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      if (!action || introPage === null || (action === "prev" && introPage === 1)) return;
      send({ type: "HOST_INTRO", page: introPage + (action === "next" ? 1 : -1) });
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // send is a plain function over state this effect already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introPage, ready, picking, drawer, swapArmed]);

  useLayoutEffect(() => {
    if (game?.phase !== "playing" || game.intro) return;
    function onKey(e: KeyboardEvent) {
      // An open picker or drawer covers the turn: a key there must not judge it or close a reveal.
      if (picking || drawer) return;
      // Fields spelled out: KeyboardEvent's are prototype getters, which `{ ...e }` would not copy.
      const target = e.target as HTMLElement | null;
      const action = hostKeyAction(
        { key: e.key, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target },
        revealUp,
        isMc ? { stuck } : undefined,
        cleric,
        lockWaiting,
      );
      if (!action || !game) return;
      if (action === "undo") {
        if (!canUndo || !game.undoWrong) return;
        send({ type: "HOST_UNDO_WRONG", ...game.undoWrong, eventId: game.eventId });
      } else if (action === "reveal") {
        if (!ready || !lock) return;
        send({ type: "HOST_REVEAL", teamId: lock.teamId, questionId: lock.questionId });
      } else if (action === "next") {
        if (!ready || !swapArmed) return;
        send({ type: toServe ? "HOST_SERVE" : "HOST_NEXT", eventId: game.eventId });
      } else {
        if (!canJudge || !turn?.team || !turn.questionId) return;
        // No 祈禱 button once the team cannot pray: its key does nothing too.
        if (held || (cleric === "wait" && action === "pray" && game.view.awaitingPrayer !== turn.team.id)) return;
        if (action === "correct") judge(turn.team.id, turn.questionId, true);
        else if (action === "wrong") judge(turn.team.id, turn.questionId, false, "team");
        else if (!(bossMiss && action === "flee")) judge(turn.team.id, turn.questionId, false, action); // no 逃跑 button on a boss miss
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // judge/send are plain functions over state this effect already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, ready, swapArmed, canJudge, canUndo, turn, isMc, stuck, picking, drawer, revealUp, cleric, held, lock, lockWaiting]);

  // 公布答案 (host-reveal.md D6): under the status panel, where 下一題 takes over key 1 after the beat.
  const revealButton = lock && (
    <PixelButton variant="ok" disabled={!ready || !lockWaiting} onClick={() => send({ type: "HOST_REVEAL", teamId: lock.teamId, questionId: lock.questionId })}>
      {connected ? "公布答案" : "重新連線中"}
      <span className="px-key" aria-hidden="true">{HOST_KEYS.reveal}</span>
    </PixelButton>
  );

  const aiPanel = (
    <AiPanel
      status={aiStatus}
      remembered={aiRemembered}
      send={aiSend}
      onUse={(credential, remember) => {
        aiPending.current = { credential, remember };
        aiSend(aiKeyMessage(credential));
      }}
      onForget={() => {
        forgetAiKey();
        aiSend({ type: "HOST_AI_KEY", source: "none" });
      }}
    />
  );

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
        <Panel tone="lav" className="px-3 py-2">
          <div className="text-[15px]">大螢幕（在電視或投影機開這個網址）</div>
          {/* A new tab, so opening it never navigates the host page away from its socket. */}
          <a href={`/room/${code}/screen`} target="_blank" rel="noopener" className="block break-all text-[14px] underline underline-offset-2">{`${origin}/room/${code}/screen`}</a>
        </Panel>

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
        {unreachable && !rested && !noToken && (
          <Panel tone="turn" role="alert" className="flex flex-col items-center gap-2 px-3 py-2 text-center text-[16px]">
            {UNREACHABLE_NOTICE}
            <PixelButton onClick={room.reconnect} className="!m-0 !px-4 !py-2 text-[16px]">{UNREACHABLE_RETRY_LABEL}</PixelButton>
          </Panel>
        )}
        {!connected && !noToken && !rested && !unreachable && <Panel tone="turn" className="px-3 py-2 text-center text-[16px]">重新連線中…</Panel>}
        {error && <Panel className="px-3 py-2 text-[14px]" style={{ background: "#ffd9d9" }}>{error}</Panel>}
        {game && aiStatus && aiStatus.source !== "none" && aiStatus.exhausted && aiDismissedAt !== aiStatus.limit && (
          <AiExhausted key={aiStatus.limit} status={aiStatus} send={send} onDismiss={() => setAiDismissedAt(aiStatus.limit)} />
        )}
        {game && aiStatus?.error && (aiStatus.error === "ai_stopped" || aiStatus.keyMissing) && (
          <Panel tone="turn" role="status" className="px-3 py-2 text-[14px]">
            {AI_ERRORS[aiStatus.error]}。到「⚙ 更多」換 key。
          </Panel>
        )}

        {!game && (
          <section className="flex flex-1 flex-col gap-3">
            <Panel tone="lav" className="px-3 py-2 text-[18px]">等待隊伍加入…</Panel>
            <ul className="flex flex-col gap-2">
              {lobby.map((t, i) => (
                <Panel key={t.id} className="flex items-center gap-3 px-3 py-2">
                  <Sprite kind="hero" variant={i} scale={2} />
                  <span className="min-w-0 flex-1 truncate text-[18px]">{t.name}</span>
                  {t.classId && <span className="text-[15px]">{CLASS_ICONS[t.classId]} {CLASS_LABELS[t.classId]}</span>}
                  <PixelButton
                    disabled={!ready}
                    onClick={() => {
                      const name = window.prompt("新的隊名", t.name);
                      if (name !== null && name.trim() && name.trim() !== t.name) send({ type: "HOST_RENAME_TEAM", teamId: t.id, teamName: name });
                    }}
                    className="!m-0 min-h-[44px] !px-3 !py-1 text-[15px]"
                  >
                    改名
                  </PixelButton>
                  <PixelButton
                    disabled={!ready}
                    onClick={() => {
                      if (window.confirm(`移除「${t.name}」？那支手機會看到隊伍被移除了，要重新加入得回首頁。`)) send({ type: "HOST_REMOVE_TEAM", teamId: t.id });
                    }}
                    className="!m-0 min-h-[44px] !px-3 !py-1 text-[15px]"
                  >
                    移除
                  </PixelButton>
                </Panel>
              ))}
              {lobby.length === 0 && <Panel className="px-3 py-2 text-[15px]">還沒有隊伍加入</Panel>}
            </ul>
            <Panel className="flex items-center gap-3 px-3 py-2">
              {origin ? <Qr text={`${origin}/?code=${code}`} size={120} /> : null}
              <div className="text-[15px]">
                <div className="text-[18px]">玩家掃描加入</div>
                <div className="mt-1 text-[14px]">或輸入房間代碼 {code}</div>
              </div>
            </Panel>
            <Panel tone="lav" className="px-3 py-2">{aiPanel}</Panel>
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
                  maxLength={MAX_PASSWORD}
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
            <Panel className="mt-auto px-3 py-2">
              <label className="flex min-h-[44px] items-center gap-3 text-[18px]">
                <input
                  type="checkbox"
                  checked={introOn}
                  onChange={(e) => setIntroPick({ replay, on: e.target.checked })}
                  className="h-6 w-6 accent-[var(--k)]"
                />
                開始前播放玩法說明
              </label>
            </Panel>
            <PixelButton
              variant="primary"
              className="min-h-[78px] text-[26px]"
              disabled={!ready || lobby.length === 0}
              // AI narration follows the room's key (HOST_AI_KEY), so a key added mid-game still takes effect.
              onClick={() => send({ type: "HOST_START", intro: introOn })}
            >
              開始遊戲 ▶
            </PixelButton>
          </section>
        )}

        {introPage !== null && (
          <section data-testid="host-intro" className="flex flex-1 flex-col gap-3">
            <Panel className="px-3 py-3 text-center">
              <span className="px-chip">
                怎麼玩？ <span className="px-num text-[11px]">{introPage}/{INTRO_PAGES}</span>
              </span>
              <div className="mt-2 text-[20px]">大螢幕正在說明規則</div>
              <div className="mt-1 text-[15px]" style={{ color: "#6a5a7a" }}>這頁：{INTRO_PAGE_TEXT[introPage - 1]?.topic}</div>
            </Panel>
            <Panel tone="lav" className="px-3 py-2 text-[16px] leading-relaxed">
              講稿提示：{INTRO_PAGE_TEXT[introPage - 1]?.script}
            </Panel>
            <div aria-hidden className="text-center text-[18px] tracking-[6px] text-white">
              {introDots(introPage)}
            </div>
            <div className="mt-auto flex items-stretch gap-2">
              {introPage > 1 && (
                <PixelButton disabled={!ready || !swapArmed} className="!m-0 min-h-[78px] w-[110px] text-[18px]" onClick={() => send({ type: "HOST_INTRO", page: introPage - 1 })}>
                  ◀ 上一頁
                </PixelButton>
              )}
              <PixelButton variant="primary" disabled={!ready || !swapArmed} className="!m-0 min-h-[78px] flex-1 text-[26px]" onClick={() => send({ type: "HOST_INTRO", page: introPage + 1 })}>
                {introPage === INTRO_PAGES ? "開始冒險 ▶" : "下一頁 ▶"}
              </PixelButton>
            </div>
            <div className="text-center text-[13px] text-[#e9defa]">鍵盤：→ 或 Enter 下一頁，← 上一頁</div>
          </section>
        )}

        {game && game.phase === "playing" && !game.intro && (
          <>
            {/* No team on turn (every phone offline): the team rows and their 交給新手機 still show. */}
            {turn?.team && (
            <>
            <TurnRibbon>{turn.inBoss ? "首領戰　" : ""}輪到：{turn.team.name}</TurnRibbon>
            <Panel tone="turn" className="px-3 py-[10px]">
              <div className="flex items-center gap-3">
                <Sprite kind={turn.monster.kind} hue={turn.monster.hue} accessory={turn.monster.accessory} scale={turn.miniScale} className="flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]" style={{ color: "#6b4a2a" }}>{turn.inBoss ? "首領房" : `第 ${turn.room + 1} 房`}　{turn.monster.name}</div>
                  <div data-testid="host-question" className="text-[20px] leading-snug">
                    {game.question?.content.kind === "text" ? game.question.content.value : (game.question?.prompt ?? `題目 ${turn.questionId}`)}
                  </div>
                  {/* The host previously never saw question media at all (text-only preview) —
                      a small preview so judging an image/video question doesn't mean squinting
                      at the big screen from across the room (complexity-gate scope, /plan-eng-review). */}
                  {game.question?.content.kind === "image" && (
                    <QuestionMedia key={game.question.id} content={game.question.content} maxWidth={120} maxHeight={90} className="mt-1" />
                  )}
                  {/* A 120px YouTube embed is below the player's minimum size and won't play — the
                      host watches the big screen instead. */}
                  {game.question?.content.kind === "youtube" && (
                    <div className="mt-1 inline-block bg-[var(--k)] px-2 py-[2px] text-[14px] text-[var(--cream)]">
                      {game.question.content.audioOnly ? "🎵 聽歌題（聽大螢幕）" : "▶ 影片題（看大螢幕）"}
                    </div>
                  )}
                </div>
              </div>
              {game.question?.content.kind === "youtube" && !revealUp && (
                <MediaControls questionId={game.question.id} media={game.media} disabled={!ready} send={send} />
              )}
              <div className="mt-2">
                <ScoreMeter score={turn.team.score} active />
              </div>
              {game.question && !game.question.options && (
                <MageHint hint={game.view.mageHints?.[game.question.id]} sort={!!game.question.items} testId="host-mage-hint" className="mt-2 inline-block px-2 py-1 text-[18px]" />
              )}
              {/* #104: a text question's typed answer, judged with the buttons below. */}
              {game.question && !game.question.options && !game.question.items && (
                <div data-testid="host-typed-answer" className="mt-2 text-[18px] [overflow-wrap:anywhere]">
                  {turn.team.typedAnswer ? `隊伍答：${turn.team.typedAnswer}` : "（還沒送出）"}
                </div>
              )}
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
                  {picks && picks.bossPhases.length > 1 &&
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
            </>
            )}

            <ul className="flex flex-col gap-2">
              {game.view.teams.map((t, i) => (
                <Panel key={t.id} className={`flex flex-wrap items-center gap-2 px-3 py-1 ${t.online ? "" : "opacity-50"}`}>
                  <Sprite kind="hero" variant={i} scale={1} className="flex-none" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{t.name}{t.online ? "" : "（離線）"}</span>
                  {t.classId && <span className="text-[13px]" title={t.classId === "chef" ? `${CLASS_LABELS.chef}，被動` : `${CLASS_LABELS[t.classId]}，剩 ${t.abilityUses} 次`}>{CLASS_ICONS[t.classId]}{t.classId === "chef" ? "" : t.abilityUses}</span>}
                  {t.sneakArmed && <span className="text-[13px]" title="偷襲準備好了：這題答對加倍">🗝️×2</span>}
                  <span className="px-num text-[10px]" style={{ color: "#a8470f" }}>{t.score}/{BOSS_THRESHOLD}</span>
                  <span className="px-num text-[10px]" style={{ color: "#2f6a2c" }} title={scoreName(game.cuisine)}>{t.reward}</span>
                  {picks && !t.inBossPhase && !picks.queued[t.id] && pickButton(t.id)}
                  <PixelButton
                    className="!m-0 min-h-[44px] !px-3 !py-0 text-[14px]"
                    onClick={() => (!t.online || confirm(`${t.name}還在線上，確定要交給新手機？`)) && send({ type: "HOST_HANDOFF", teamId: t.id })}
                  >
                    交給新手機
                  </PixelButton>
                  {handoffs[t.id] && (
                    <div data-testid="handoff-code" className="flex basis-full flex-col gap-1 pl-6 text-[14px]">
                      <span>請{t.name}的新手機打開房間網址，輸入這組配對碼：</span>
                      <span className="px-num pl-[0.5em] text-center text-[28px] tracking-[0.5em]">{handoffs[t.id]}</span>
                      <span className="text-[13px]">{HANDOFF_MS / 60_000} 分鐘內有效，只能用一次。</span>
                      <PixelButton className="!m-0 min-h-[44px] !py-0 text-[14px]" onClick={() => dropHandoff(t.id)}>
                        關閉
                      </PixelButton>
                    </div>
                  )}
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
            <NarrationPanel
              narration={narration}
              pending={isPending(game.eventId, narration)}
              done={readTo && readTo.eventId === narration?.eventId ? readTo.done : 0}
              nextLine={nextLine}
              refusal={editRefusal}
              disabled={!ready}
              send={send}
            />
            {turn?.team && (
            <>
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
                  {/* The answered question's video is up again on the big screen (D17). */}
                  {game.reveal?.video && (
                    <Panel tone="lav" className="px-3 pb-2 pt-1">
                      <MediaControls questionId={game.reveal.questionId} media={game.media} disabled={!ready} send={send} />
                    </Panel>
                  )}
                  <PixelButton variant="ok" disabled={!ready || !swapArmed} onClick={() => send({ type: toServe ? "HOST_SERVE" : "HOST_NEXT", eventId: game.eventId })}>
                    {!connected ? "重新連線中" : toServe ? "🍲 上菜" : servedUp && !swapArmed ? "🍲 上菜中…" : "下一題"}
                    <span className="px-key" aria-hidden="true">{HOST_KEYS.next}</span>
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
                        ? `${lockTeam}鎖定了 ${sortedLock ?? optionLetter(lock.optionIndex)}…`
                        : bossMiss
                          ? "答錯！首領換一題…"
                          : wrong
                          ? `答錯！等${turn.team.name}選重答或逃跑`
                          : `等${turn.team.name}鎖定答案…`}
                    </div>
                    <div className="text-[14px]">{roll?.kind === "kill" ? "大螢幕擲 4d20 擊殺獎勵後結算" : roll || lock?.revealing ? "大螢幕停頓 2 秒後揭曉" : lock ? "按公布答案揭曉" : `${game.question?.items ? "排序題" : "選擇題"}由隊伍手機作答，主持人公布`}</div>
                  </Panel>
                  </div>
                  {revealButton}
                  {stuck && (
                    <>
                      <div className="px-1 pt-2 text-center text-[14px] text-white">{turn.team.name}好像卡住了</div>
                      <div className="px-1 pt-1 text-[14px] text-white">隊伍卡住時：</div>
                      <div className={bossMiss ? "grid" : "grid grid-cols-2"}>
                        <PixelButton variant="retry" className="!min-h-[48px] text-[15px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "retry")}>
                          替{turn.team.name}選・重答
                          <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.retry}</span>
                        </PixelButton>
                        {!bossMiss && (
                          <PixelButton variant="flee" className="!min-h-[48px] text-[15px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "flee")}>
                            替{turn.team.name}選・逃跑
                            <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.flee}</span>
                          </PixelButton>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  {/* A lock whose turn moved on to a fill-in still needs its 公布答案 before anyone is judged. */}
                  {revealButton}
                  {roll && (
                    <Panel tone="lav" className="px-3 py-2 text-center text-[22px]" role="status">
                      {turn.team.name}擲出了骰子…
                    </Panel>
                  )}
                  {cleric === "wait" ? (
                    <>
                      <div className="px-1 pt-1 text-center text-[20px] text-white" role="status">答錯了！等{turn.team.name}選，或替他們選：</div>
                      <div className="grid grid-cols-3">
                        {game.view.awaitingPrayer === turn.team.id && (
                          <PixelButton className="text-[16px]" style={{ background: "#ffe066" }} disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, false, "pray")}>
                            祈禱
                            <span className="px-key" aria-hidden="true">{HOST_KEYS.wait.pray}</span>
                          </PixelButton>
                        )}
                        <PixelButton variant="retry" className="text-[16px]" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, false, "retry")}>
                          重答
                          <span className="px-key" aria-hidden="true">{HOST_KEYS.wait.retry}</span>
                        </PixelButton>
                        <PixelButton variant="flee" className="text-[16px]" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, false, "flee")}>
                          逃跑
                          <span className="px-key" aria-hidden="true">{HOST_KEYS.wait.flee}</span>
                        </PixelButton>
                      </div>
                    </>
                  ) : (
                  <>
                  <PixelButton variant="ok" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, true)}>
                    {connected ? "答對！" : "重新連線中"}
                    <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.correct}</span>
                  </PixelButton>
                  {cleric === "before" ? (
                    <PixelButton variant="retry" className="text-[16px]" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, false, "team")}>
                      答錯
                      <span className="px-key" aria-hidden="true">{HOST_KEYS.before.wrong}</span>
                    </PixelButton>
                  ) : (
                  <div className="grid grid-cols-2">
                    <PixelButton variant="retry" className="text-[16px]" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, false, "retry")}>
                      答錯・重答
                      <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.retry}</span>
                    </PixelButton>
                    <PixelButton variant="flee" className="text-[16px]" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, false, "flee")}>
                      答錯・逃跑
                      <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.flee}</span>
                    </PixelButton>
                  </div>
                  )}
                  </>
                  )}
                </>
              )}
            </>
            )}
            {/* 改判答對 (TODOS.md): under the judge buttons, held for half a second after it shows up (canUndo). */}
            {game.undoWrong && !revealUp && (
              <PixelButton className="!mt-4 text-[16px]" style={{ background: "#fff" }} disabled={!canUndo} onClick={() => send({ type: "HOST_UNDO_WRONG", ...game.undoWrong!, eventId: game.eventId })}>
                ↩ 剛才的{teamName(game.undoWrong.teamId)}改判答對
                <span className="px-key" aria-hidden="true">{HOST_KEYS.undo}</span>
              </PixelButton>
            )}
            {/* No team on turn (every phone offline): a waiting lock still gets its 公布答案. */}
            {!turn?.team && !revealUp && revealButton}
            </div>
          </>
        )}

        {game && game.phase === "finished" && (
          <Panel tone="lav" className="mt-8 px-4 py-8 text-center">
            <div className="text-[28px]">遊戲結束！</div>
            <div className="mt-2 text-[18px]">
              {game.winners.map((id) => game.view.teams.find((t) => t.id === id)?.name ?? id).join("、")} 獲勝
            </div>
            <PixelButton variant="primary" className="!mx-auto !mt-6 !block min-h-[64px] text-[22px]" disabled={!ready} onClick={() => send({ type: "HOST_BACK_TO_LOBBY" })}>
              回到大廳，再玩一場
            </PixelButton>
            <div className="mt-2 text-[13px]">隊伍不用重新加入，分數歸零。這場公布過答案的題目，下一場會排到最後才出。</div>
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
          origin={origin}
          code={code}
          onClose={() => setDrawer(false)}
          send={send}
          ai={game ? aiPanel : null}
          bossable={game?.phase === "playing" ? game.view.teams.filter((t) => !t.inBossPhase) : []}
          playing={game?.phase === "playing"}
        />
      )}
    </main>
  );
}

/** ▶ ⏸ ⟲ for the video on the big screen (docs/designs/youtube-questions.md D19). Three buttons, not a toggle: a
 * second press of ▶ on slow Wi-Fi is still ▶. The lit button is the host's last command (D7): the page cannot see
 * the clip stop at its end. */
function MediaControls({ questionId, media, disabled, send }: { questionId: string; media?: MediaCommand; disabled: boolean; send: (m: ClientMessage) => void }) {
  // A command for another question, or none (an older server), is paused.
  const playing = media?.questionId === questionId && media.state === "playing";
  const press = (action: MediaAction) => send({ type: "HOST_MEDIA", questionId, action });
  const look = (lit: boolean) => ({ minHeight: 56, background: lit ? "var(--ok)" : "var(--cream)" });
  return (
    <div data-testid="host-media" className="mt-2">
      <div className="text-[14px]" role="status">
        大螢幕：{playing ? "播放中" : "已暫停"}
      </div>
      <div className="flex">
        <PixelButton aria-label="播放" aria-pressed={playing} disabled={disabled} className="flex-1 text-[18px]" style={look(playing)} onClick={() => press("play")}>
          ▶ 播放
        </PixelButton>
        <PixelButton aria-label="暫停" aria-pressed={!playing} disabled={disabled} className="flex-1 text-[18px]" style={look(!playing)} onClick={() => press("pause")}>
          ⏸ 暫停
        </PixelButton>
        <PixelButton aria-label="從頭播放" disabled={disabled} className="flex-1 text-[18px]" style={look(false)} onClick={() => press("restart")}>
          ⟲ 從頭
        </PixelButton>
      </div>
      <div className="mt-1 text-[13px]" style={{ color: "#6b4a2a" }}>
        沒聲音？看大螢幕提示
      </div>
    </div>
  );
}
