"use client";

import { AnswerClock } from "@/components/answer-clock";
import { ANSWER_SECONDS, DEFAULT_ANSWER_SECONDS } from "@/lib/answer-clock";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { isPending, keepLatest, type NarrationState } from "@/lib/narration/client";
import { useParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { UNREACHABLE_NOTICE, UNREACHABLE_RETRY_LABEL } from "@/lib/offline-notice";
import { useRoomSocket } from "@/lib/use-room-socket";
import { useWakeLock } from "@/lib/use-wake-lock";
import { freshAttempt, freshHostPath, generateRoomCode, getHostToken, isFreshRoomHash, MAX_FRESH_ATTEMPTS, settledHash } from "@/lib/room-code";
import { HANDOFF_MS, INTRO_PAGES, MAX_PASSWORD, scoreName, SERVE_HOLD_MS, serveSecondsLeft, type ClientMessage, type LobbyTeams, type MediaAction, type MediaCommand, type ServerMessage, type StateMessage } from "@/lib/protocol";
import { forgetStored, writeStored } from "@/lib/stored";
import { BOSS_THRESHOLD, describeTurn } from "@/lib/turn-info";
import { ordinal } from "@/lib/ordinal";
import { bankSizeWarning, bankSizeWarningText, type BankSize } from "@/lib/bank-size";
import { CLASS_ICONS, CLASS_LABELS, SNEAK_REWARD_MULTIPLIER } from "@/lib/game-state";
import { Panel, PixelButton, QuestionMedia, SceneBackground, ScoreMeter, Sprite, TurnRibbon } from "@/components/pixel";
import { Qr } from "@/components/qr";
import { MageHint } from "@/components/mage-hint";
import { clericStage, HOST_KEYS, hostKeyAction, introKeyAction } from "@/lib/host-keys";
import { INTRO_PAGE_TEXT, introDots } from "@/components/how-to-play";
import { INITIATIVE_MS } from "@/lib/initiative";
import { optionLetter } from "@/components/mc-option";
import { sortOrderOf } from "@/lib/sort-order";
import { AI_ERRORS, AI_STORE, AiExhausted, aiKeyApplied, aiKeyRefused, AiPanel, aiKeyMessage, aiResendAfterRefusal, aiResendMessage, aiSavedKeyDead, newKeyId, readSavedAiKey, type AiCredential, type AiStatus } from "@/components/host-ai";
import { MoreDrawer } from "@/components/more-drawer";
import { LateTeams } from "@/components/late-teams";
import { FieldJudge } from "@/components/field-judge";
import { NarrationPanel, type EditRefusal } from "@/components/narration-panel";
import { QuestionPicker } from "@/components/question-picker";
import { createAiKeyQueue } from "@/lib/host-ai-queue";
import { EVENT_OUTCOME_TITLE, FORK_DOOR_LABEL, FORK_SIDE_LABEL } from "@/lib/event-text";
import { hostBuzzWait, hostMediaStatus } from "@/lib/youtube";

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
  /** The room bank's question counts (LOBBY `bankSize`), for the too-few-questions warning by 開始遊戲. */
  const [bankSize, setBankSize] = useState<BankSize | null>(null);
  const sizeWarning = bankSize && bankSizeWarning(bankSize, lobby.length);
  const [game, setGame] = useState<StateMessage | null>(null);
  /** 手動停頓 (docs/designs/manual-pacing.md): the room's switch, as its last LOBBY or STATE said. */
  const [manual, setManual] = useState(false);
  /** 每題作答倒數 for the next game (answer-countdown.md D2): this page's pick, so a replay keeps it. */
  const [answerSeconds, setAnswerSeconds] = useState<number>(DEFAULT_ANSWER_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [noToken, setNoToken] = useState(false);
  const [connected, setConnected] = useState(false);
  const [claimed, setClaimed] = useState(false);
  /** Host-only: the answer to the question in play. Never shown on /screen or /play. */
  const [answer, setAnswer] = useState<Pick<Extract<ServerMessage, { type: "HOST_ANSWER" }>, "questionId" | "answer" | "typed"> | null>(null);
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
  /** The key the room last accepted. The room keeps keys in memory only, so this is resent after every HOST_OK
   * (unless a key is pending: that one is resent instead). */
  const aiSaved = useRef<AiCredential | null>(null);
  /** A key sent but not yet confirmed by HOST_AI_STATUS. */
  const aiPending = useRef<{ credential: AiCredential; remember: boolean; keyId: string } | null>(null);
  const [aiQueue] = useState(createAiKeyQueue);
  const aiSend = (msg: ClientMessage) => aiQueue.choose(msg, send);
  const [aiRemembered, setAiRemembered] = useState(false);
  /** The limit the host said 不用了 to, so the prompt stays closed until the limit changes. */
  const [aiDismissedAt, setAiDismissedAt] = useState<number | null>(null);
  useEffect(() => {
    aiSaved.current = readSavedAiKey();
    setAiRemembered(aiSaved.current !== null);
  }, []);
  const forgetSavedAiKey = () => {
    aiSaved.current = null;
    forgetStored(AI_STORE.own);
    forgetStored(AI_STORE.owner);
    setAiRemembered(false);
  };
  const forgetAiKey = () => {
    forgetSavedAiKey();
    aiPending.current = null;
  };
  const [joinPassword, setJoinPassword] = useState("");
  const [savedPassword, setSavedPassword] = useState("");
  /** The room's screen key (HOST_OK), for the big screen link: "" until the room sends it. */
  const [screenKey, setScreenKey] = useState("");
  const screenHash = screenKey ? `#s=${screenKey}` : "";
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
          // A pending key may already be in use (its status lost with the socket) or mid-check: resending the saved key
          // would swap the room back to it, or cancel the check and leave the panel waiting.
          aiQueue.hostOk(aiResendMessage(aiPending.current, aiSaved.current), room.send);
          setJoinPassword(msg.joinPassword);
          setSavedPassword(msg.joinPassword);
          setScreenKey(msg.screenKey ?? "");
          break;
        case "HOST_AI_STATUS": {
          setAiStatus(msg);
          const p = aiPending.current;
          if (p) {
            const c = p.credential;
            // Applied only when the room names this key's id; a refused key never gets it. Dropped only when the room
            // names it refused: a status sent before the room got this key can carry an older refusal.
            if (aiKeyApplied(p.keyId, msg)) {
              aiPending.current = null;
              aiSaved.current = c;
              forgetStored(AI_STORE.own);
              forgetStored(AI_STORE.owner);
              if (p.remember) writeStored(AI_STORE[c.source], c.source === "own" ? c.key : c.ownerKey);
              setAiRemembered(p.remember);
            } else if (aiKeyRefused(p.keyId, msg)) {
              aiPending.current = null;
              const back = aiResendAfterRefusal(msg, aiSaved.current);
              if (back) aiSend(back);
            }
          }
          // The host's own key refused mid-game: never resend it. (In owner mode the server's key is at fault, not OWNER_KEY.)
          // A refused paste (named by refusedKeyId) is not the saved key, so it keeps it.
          if (aiSavedKeyDead(msg, aiPending.current !== null)) forgetSavedAiKey();
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
          setAnswer({ questionId: msg.questionId, answer: msg.answer, typed: msg.typed });
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
          setManual(msg.pacing === "manual");
          setLobby(msg.teams);
          setReplay(!!msg.replay);
          setBankSize(msg.bankSize ?? null);
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
          setManual(msg.pacing === "manual");
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
                : msg.detail === "late_closed"
                ? "現在不能收這隊：首領戰開始了，或大螢幕還在開場、開門"
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
        className="!m-0 min-h-[44px] !px-2 !py-0 text-[14px] md:!px-3"
      >
        {queued ? "取消" : target === "boss" ? "指定" : "指定下一題"}
      </PixelButton>
    );
  }
  function send(msg: ClientMessage) {
    setError(null);
    room.send(msg);
  }

  function judge(teamId: string, questionId: string, correct: boolean, fleeChoice?: "flee" | "retry" | "team" | "pray", fields?: boolean[]) {
    setPendingTeamId(teamId);
    send({ type: "HOST_JUDGE", teamId, questionId, correct, fleeChoice, ...(game ? { eventId: game.eventId } : {}), ...(fields ? { fields } : {}) });
  }

  // Disconnect UI: judge buttons disable and "重新連線中" shows here; /play and /screen show their own
  // notice (lib/offline-notice.ts), and a phone is told after reconnecting if its turn was skipped.
  const ready = connected && claimed;
  const turn = game ? describeTurn(game.view, game.question, game.phaseCard?.monster) : null;
  // Fresh per-field marks for each buzz: a new question, team or event remounts FieldJudge.
  // Nobody may be on turn (a buzzer phase, a reveal): `team` is then undefined at run time though typed as present.
  const fieldJudgeId = game ? `${turn?.questionId}:${turn?.team?.id}:${game.eventId}` : "";
  // The judge buttons and 下一題 swap in the same slot the moment a STATE arrives, so a double-tap
  // on one would land on the other (judging the next question, or closing a reveal nobody saw).
  // Both stay disabled for a beat after every swap.
  // The boss's phase card is a pause like a reveal: 下一題 closes it (docs/designs/boss-phases.md D3).
  // A ❓ 神秘房's result is one more (event-rooms.md D3). A door opening (branch-fork.md) is not: 下一題 waits it out.
  const revealUp = !!game?.reveal || !!game?.phaseCard || !!game?.eventReveal;
  /** A buzzer boss phase (docs/designs/boss-buzzer.md): teams buzz in, the host judges the one that buzzed first. */
  const buzz = game?.phase === "playing" && !revealUp ? game.view.buzz : undefined;
  // Keyed on the pause itself, not just "a pause is up": the answer reveal turning into the phase card
  // swaps 下一題 for another 下一題, and a double-tap must not close the card nobody has seen.
  // The intro's pages count too: 下一頁 turns into 開始冒險 in its slot, and then into the judge buttons.
  // So does a new buzz (boss-buzzer.md): 答錯 tapped twice must not judge the next team before it speaks.
  // A dish reveal takes 🍲 上菜 first (monster-cuisine.md cooking R5); serving swaps it for 上菜中… then 下一題.
  const toServe = game?.phase === "playing" && !!game.reveal?.dish && !game.reveal.served;
  const servedUp = !!game?.reveal?.served;
  // A manual room's hold (manual-pacing.md) is one more: ▶ 下一步 takes the slot, and each new hold arms it again.
  const hold = game?.hold;
  const pauseKey = hold ? `hold-${hold.id}` : game?.reveal ? `reveal-${game.eventId}${servedUp ? "-served" : ""}` : game?.phaseCard ? `card-${game.eventId}` : game?.forkBeat ? `fork-${game.eventId}` : game?.eventReveal ? `event-${game.eventId}` : game?.intro ? `intro-${game.intro.page}` : buzz?.teamId ? `buzz-${buzz.teamId}-${game!.eventId}` : "";
  const [armedFor, setArmedFor] = useState(pauseKey);
  const swapArmed = armedFor === pauseKey;
  const [serveLeft, setServeLeft] = useState({ key: "", left: 0 });
  const serveSeconds = serveLeft.key === pauseKey ? serveLeft.left : serveSecondsLeft(0);
  useEffect(() => {
    // After 上菜, 下一題 waits out the cooking as the room does (cooking I2).
    const served = pauseKey.endsWith("-served");
    // The seconds left on 「🍲 上菜中…」, so the host knows how long the meal still runs.
    const start = Date.now();
    const tick = served ? setInterval(() => setServeLeft({ key: pauseKey, left: serveSecondsLeft(Date.now() - start) }), 250) : undefined;
    const t = setTimeout(() => {
      clearInterval(tick);
      setArmedFor(pauseKey);
    }, served ? SERVE_HOLD_MS : 500);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
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
  // 叉路 (branch-fork.md D3): the host only watches; in auto the room's own 15 s clock sends a team that never picks into ⚔️, in manual the host's ▶ 下一步 does.
  // An answer or a card on show keeps its 下一題: the hold's ▶ 下一步 takes over once it is gone. A finished game has
  // no 下一題 (the kill's answer stays up), so the podium's hold always shows.
  const holdUp = !!hold && (!revealUp || game?.phase === "finished");
  const atFork = !revealUp && !game?.phaseCardDue && (!!game?.forkBeat || turn?.team?.fork === "choosing");

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
    if (game?.phase !== "playing" || game.intro || game.initiative) return;
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
      // A manual hold has ▶ 下一步 on key 1 (the effect below); only 改判答對, whose button stays up, keeps its key.
      if (holdUp && action !== "undo") return;
      // A music question with fields is judged field by field on screen only (multi-field.md D4): no judge key.
      if (game.question?.fields && !revealUp && action !== "next" && action !== "reveal" && action !== "undo") return;
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
  }, [game, ready, swapArmed, canJudge, canUndo, turn, isMc, stuck, picking, drawer, revealUp, cleric, held, lock, lockWaiting, holdUp]);

  // ▶ 下一步 (manual-pacing.md): key 1 or Enter, like 下一題, in every phase a hold can be up (擲先攻 and the podium too).
  const stepNow = () => game && hold && send({ type: "HOST_STEP", eventId: game.eventId, step: hold.id });
  useEffect(() => {
    if (!holdUp || !ready) return;
    function onKey(e: KeyboardEvent) {
      if (picking || drawer || !swapArmed) return;
      if (hostKeyAction({ key: e.key, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target: e.target as HTMLElement | null }, true) !== "next") return;
      stepNow();
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // stepNow is a plain function over state this effect already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdUp, hold?.id, game?.eventId, ready, picking, drawer, swapArmed]);
  const holdPanel = hold && (
    <div className="mt-3 flex flex-col gap-3">
      <div data-testid="host-hold" role="status" className="border-4 border-dashed border-[var(--k)] bg-[var(--turn)] px-3 py-2 text-left text-[var(--k)]">
        {/* The label is one block: it drops to its own line whole on a phone, never leaving one character behind. */}
        <div className="text-[18px]"><span className="whitespace-nowrap">⏸ 停在這裡：</span><span className="inline-block text-balance">{hold.label}</span></div>
        <div className="text-[13px]">手動模式，按「下一步」才會繼續</div>
      </div>
      <PixelButton variant="ok" data-testid="host-step" disabled={!ready || !swapArmed} onClick={stepNow}>
        {connected ? "▶ 下一步" : "重新連線中"}
        <span className="px-key" aria-hidden="true">{HOST_KEYS.next}</span>
      </PixelButton>
    </div>
  );

  // 下一題 (or 上菜) under an answer reveal or a phase card, with the revealed video's controls.
  const revealPanel = game && revealUp && (
    <>
      <Panel tone="lav" className="px-3 py-2 text-center text-[16px]">
        {/* What is on show is one block (as in the hold panel): it drops to its own line whole when it does not fit. */}
        <div data-testid="host-reveal">
          大螢幕正在揭曉：<span className="inline-block text-balance">{game.eventReveal ? `❓ 神秘房－${EVENT_OUTCOME_TITLE[game.eventReveal.outcome]}` : game.reveal ? game.reveal.answer : `第${ordinal(game.view.bossPhase)}階段－${game.bossPhaseInfo?.name ?? ""}`}</span>
        </div>
      </Panel>
      {/* The answered question's video is up again on the big screen (D17). */}
      {game.reveal?.video && (
        <Panel tone="lav" className="px-3 pb-2 pt-1">
          <MediaControls questionId={game.reveal.questionId} media={game.media} disabled={!ready} send={send} />
        </Panel>
      )}
      <PixelButton variant="ok" disabled={!ready || !swapArmed} onClick={() => send({ type: toServe ? "HOST_SERVE" : "HOST_NEXT", eventId: game.eventId })}>
        {!connected ? "重新連線中" : toServe ? "🍲 上菜" : servedUp && !swapArmed ? `🍲 上菜中… ${serveSeconds}` : "下一題"}
        <span className="px-key" aria-hidden="true">{HOST_KEYS.next}</span>
      </PixelButton>
    </>
  );

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
        const keyId = newKeyId();
        aiPending.current = { credential, remember, keyId };
        aiSend(aiKeyMessage(credential, keyId));
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
        <header className="flex items-center justify-between gap-2">
          <Panel className="px-3 py-1">
            <span className="px-num text-[18px] tracking-[0.2em]" style={{ color: "var(--danger)" }}>
              {code}
            </span>
          </Panel>
          {/* 手動停頓 (manual-pacing.md): one tap either way, any time. */}
          <div data-testid="host-pacing" role="group" aria-label="停頓模式" className="flex flex-none whitespace-nowrap">
            {(["auto", "manual"] as const).map((mode) => (
              <PixelButton
                key={mode}
                aria-pressed={manual === (mode === "manual")}
                disabled={!ready}
                onClick={() => send({ type: "HOST_PACING", mode })}
                className="!m-0 min-h-[44px] !px-2 !py-2 text-[16px] focus-visible:z-10"
                style={manual === (mode === "manual") ? { background: "var(--k)", color: "#fff" } : { background: "#fff" }}
              >
                {mode === "manual" ? "⏸ 手動" : "自動"}
              </PixelButton>
            ))}
          </div>
          <PixelButton onClick={() => setDrawer(true)} className="!m-0 min-h-[44px] whitespace-nowrap !px-3 !py-2 text-[16px]">
            ⚙ 更多
          </PixelButton>
        </header>
        <Panel tone="lav" className="px-3 py-2">
          <div className="text-[15px]">大螢幕（在電視或投影機開這個網址）</div>
          {/* A new tab, so opening it never navigates the host page away from its socket. */}
          {/* With the room's screen key: only a big screen opened by this link is sent the question videos. */}
          {claimed ? (
            <a data-testid="screen-link" href={`/room/${code}/screen${screenHash}`} target="_blank" rel="noopener" className="block break-all text-[14px] underline underline-offset-2">{`${origin}/room/${code}/screen${screenHash}`}</a>
          ) : (
            // Not before the room has sent the key: a link copied now would open a big screen that plays no video.
            <div className="text-[14px]">連線中…</div>
          )}
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
              <label className="flex min-h-[44px] items-center gap-3 text-[18px]">
                每題作答時間
                <select
                  data-testid="answer-seconds"
                  value={answerSeconds}
                  onChange={(e) => setAnswerSeconds(Number(e.target.value))}
                  className="border-4 border-[var(--k)] bg-white px-2 py-1 text-[18px]"
                >
                  {ANSWER_SECONDS.map((s) => (
                    <option key={s} value={s}>
                      {s === 0 ? "關" : `${s} 秒`}
                    </option>
                  ))}
                </select>
              </label>
            </Panel>
            {sizeWarning && (
              <div data-testid="host-bank-size" role="status" className="text-[15px]" style={{ color: "var(--warn)" }}>
                ⚠ {bankSizeWarningText(sizeWarning, lobby.length)}
              </div>
            )}
            <PixelButton
              variant="primary"
              className="min-h-[78px] text-[26px]"
              disabled={!ready || lobby.length === 0}
              // AI narration follows the room's key (HOST_AI_KEY), so a key added mid-game still takes effect.
              onClick={() => {
                // The warning shows only for a room pool smaller than the team count, which deals repeats or another difficulty's questions: ask first.
                if (sizeWarning && !window.confirm(`${bankSizeWarningText(sizeWarning, lobby.length)}\n確定要開始？`)) return;
                send({ type: "HOST_START", intro: introOn, initiative: true, answerSeconds });
              }}
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

        {game?.phase === "playing" && !game.intro && game.initiative && (
          <section data-testid="host-initiative" className="flex flex-1 flex-col gap-3">
            <Panel className="px-3 py-3 text-center">
              <span className="px-chip">擲先攻</span>
              <div className="mt-2 text-[20px]">{game.initiative.order ? (manual ? "先攻順序出爐" : "先攻順序出爐，即將開始") : "各隊用手機擲骰，大螢幕在看"}</div>
              <div className="mt-1 text-[15px]" style={{ color: "#6a5a7a" }}>
                {game.initiative.order
                  ? game.initiative.order.map((id) => game.view.teams.find((t) => t.id === id)?.name ?? "").join(" → ")
                  : `已擲 ${Object.keys(game.initiative.rolls).length}／${game.view.teams.length} 隊，${manual ? "按「下一步」替沒擲的隊代擲" : `${INITIATIVE_MS / 1000} 秒後沒擲的隊由系統代擲`}`}
              </div>
            </Panel>
            {holdUp ? (
              <div className="mt-auto">{holdPanel}</div>
            ) : (
              <PixelButton variant="primary" disabled={!ready || !!game.initiative.order} className="!m-0 mt-auto min-h-[78px] text-[26px]" onClick={() => send({ type: "HOST_ROLL_INITIATIVE" })}>
                🎲 全部代擲
              </PixelButton>
            )}
          </section>
        )}

        {game && game.phase === "playing" && !game.intro && !game.initiative && (
          <>
            {/* No team on turn (every phone offline): the team rows and their 交給新手機 still show. */}
            {turn && (turn.team || buzz) && (
            <>
            <TurnRibbon>{buzz ? (turn.team ? `搶答：${turn.team.name}搶到了` : "首領戰　搶答中") : `${turn.inBoss ? "首領戰　" : ""}輪到：${turn.team?.name}`}</TurnRibbon>
            <Panel tone="turn" className="px-3 py-[10px]">
              <div className="flex items-center gap-3">
                {/* A fork holds no monster and no question (branch-fork.md). */}
                {turn.team?.fork ? (
                  <Sprite kind="door" scale={2} className="flex-none" />
                ) : (
                  <Sprite kind={turn.monster.kind} hue={turn.monster.hue} accessory={turn.monster.accessory} scale={turn.miniScale} className="flex-none" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]" style={{ color: "#6b4a2a" }}>{turn.inBoss ? "首領房" : `第 ${turn.room + 1} 房`}　{turn.team?.fork ? "🔀 叉路" : turn.monster.name}</div>
                  <div data-testid="host-question" className="text-[20px] leading-snug">
                    {turn.team?.fork ? <>⚔️ 怪物房，<span className="inline-block">還是 ❓ 神秘房？</span></> : game.phaseCard ? "新階段的第一題（按「下一題」後出題）" : game.question?.content.kind === "text" ? game.question.content.value : (game.question?.prompt ?? `題目 ${turn.questionId}`)}
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
                  {/* 每題作答倒數 (answer-countdown.md): only a nudge, the host still judges (D1). */}
                  {game.answerClock && (
                    <div className="mt-1">
                      {game.answerClock.left === null ? (
                        <span data-testid="answer-clock-wait" className="text-[14px]">⏱ 影片播完後開始倒數</span>
                      ) : (
                        <AnswerClock key={game.answerClock.left} ms={game.answerClock.left} variant="chip" />
                      )}
                    </div>
                  )}
                </div>
              </div>
              {/* The big screen cannot play this video (boss-music-buzzer.md M4): the host plays the song live. */}
              {game.question?.content.kind === "youtube" && !revealUp && game.clipError && (
                <div data-testid="host-clip-error" role="alert" className="mt-2 flex flex-col gap-1 p-2 text-[15px]" style={{ background: "#ffd6dc", boxShadow: "0 0 0 3px var(--k)" }}>
                  <div className="text-[16px]">大螢幕：這支影片放不出來</div>
                  <div className="text-[13px]">（影片無法播放／被擋）{buzz && !buzz.open ? "用你的手機或喇叭放歌，再按下面的鈕開放搶答。" : "用你的手機或喇叭放歌。"}</div>
                  {buzz && !buzz.open && (
                    <PixelButton className="!m-0 min-h-[48px] text-[16px]" style={{ background: "var(--turn)" }} disabled={!ready} onClick={() => send({ type: "HOST_BUZZ_OPEN", questionId: buzz.questionId })}>
                      🎤 現場放歌，開放搶答
                    </PixelButton>
                  )}
                </div>
              )}
              {game.question?.content.kind === "youtube" && !revealUp && (
                <MediaControls questionId={game.question.id} media={game.media} disabled={!ready} send={send} liveOpen={!!game.clipError && !!buzz?.open && !buzz.teamId} />
              )}
              {buzz && (
                <div data-testid="host-buzz" className="mt-2 flex flex-col gap-1 text-[16px]">
                  {((line) => line && <div>{line}</div>)(
                    buzz.teamId
                      ? `${teamName(buzz.teamId)} 搶到了：聽他們說答案，按下方答對／答錯`
                      : hostBuzzWait(game.question?.content.kind === "youtube", !!buzz.open, !!game.clipError),
                  )}
                  {/* The buzzing team may also type its answer (boss-music-buzzer.md M2). */}
                  {buzz.teamId && (
                    <div data-testid="host-typed-answer" className="text-[18px] [overflow-wrap:anywhere]">
                      {/* Host-only (HOST_ANSWER): STATE hides it from the other teams (multi-field.md E4). */}
                      {((typed) => (typed ? `隊伍打字：${typed}` : "（口頭作答，或等他們打字）"))(answer?.typed?.teamId === buzz.teamId ? answer.typed.text : undefined)}
                    </div>
                  )}
                  {buzz.category && <div className="text-[14px]">{teamName(buzz.picker ?? "")} 選的類別：{buzz.category}</div>}
                  {buzz.out.length > 0 && <div className="text-[14px]">已鎖住：{buzz.out.map(teamName).join("、")}</div>}
                  {!buzz.teamId && (
                    <PixelButton className="!m-0 min-h-[44px] text-[15px]" disabled={!ready} onClick={() => send({ type: "HOST_BUZZ_SKIP", questionId: buzz.questionId })}>
                      沒人答對，換下一題
                    </PixelButton>
                  )}
                </div>
              )}
              {turn.team && !buzz && (
              <div className="mt-2">
                <ScoreMeter score={turn.team.score} active />
              </div>
              )}
              {game.question && !game.question.options && (
                <MageHint hint={game.view.mageHints?.[game.question.id]} sort={!!game.question.items} testId="host-mage-hint" className="mt-2 inline-block px-2 py-1 text-[18px]" />
              )}
              {/* #104: a text question's typed answer, judged with the buttons below. */}
              {turn.team && !buzz && game.question && !game.question.options && !game.question.items && (
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
                        turn.team?.currentSelection === i
                          ? { background: "var(--turn)", boxShadow: "inset 0 0 0 3px var(--turn2)" }
                          : { background: "var(--cream2)" }
                      }
                    >
                      <b className="px-num inline-flex h-6 w-6 flex-none items-center justify-center text-[11px]" style={{ background: "var(--k)", color: "var(--turn2)" }}>{optionLetter(i)}</b>
                      <span className={game.view.eliminated?.[game.question!.id]?.includes(i) ? "line-through" : ""}>{opt}</span>
                      {turn.team?.currentSelection === i && <span className="ml-2 text-[13px]">← 隊伍目前選的</span>}
                    </div>
                  ))}
                </div>
              )}
              {/* The phase card holds the question back (STATE's question is null), so its answer waits too.
                  So does a door opening (branch-fork.md): ⚔️'s question is not up until the door has opened. */}
              {answer && answer.questionId === turn.questionId && !game.phaseCard && !game.forkBeat && (
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
                  {/* The name and its numbers take the whole first row under 768px, so the buttons never squeeze the name to two characters. */}
                  <div className="flex min-w-0 flex-1 basis-full items-center gap-2 md:basis-0">
                  <Sprite kind="hero" variant={i} scale={1} className="flex-none" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{t.name}{t.online ? "" : "（離線）"}</span>
                  {t.classId && <span className="text-[13px]" title={t.classId === "chef" ? `${CLASS_LABELS.chef}，被動` : `${CLASS_LABELS[t.classId]}，剩 ${t.abilityUses} 次`}>{CLASS_ICONS[t.classId]}{t.classId === "chef" ? "" : t.abilityUses}</span>}
                  {t.fork && <span data-testid="host-team-fork" className="text-[13px]">🚪 在叉路口</span>}
                  {t.sneakArmed && <span className="text-[13px]" title={`偷襲準備好了：這題答對獎勵分 ×${SNEAK_REWARD_MULTIPLIER}、boss 扣血 ×2`}>🗝️</span>}
                  <span className="px-num text-[10px]" style={{ color: "#a8470f" }}>{t.score}/{BOSS_THRESHOLD}</span>
                  <span className="px-num text-[10px]" style={{ color: "#2f6a2c" }} title={scoreName(game.cuisine)}>{t.reward}</span>
                  </div>
                  {picks && !t.inBossPhase && !picks.queued[t.id] && pickButton(t.id)}
                  {/* 🧪 幸運藥水 (docs/designs/lucky-potion.md D3): one at a time, greyed while the team holds one. */}
                  <PixelButton data-testid="give-potion" className="!m-0 min-h-[44px] !px-2 !py-0 text-[14px] md:!px-3" disabled={!!t.item} onClick={() => send({ type: "HOST_GIVE_ITEM", teamId: t.id })}>
                    {t.item ? "🧪 已有" : "🧪 給藥水"}
                  </PixelButton>
                  <PixelButton
                    className="!m-0 min-h-[44px] !px-2 !py-0 text-[14px] md:!px-3"
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
            {game.late && <LateTeams late={game.late} disabled={!ready || !!game.forkBeat} send={send} />}

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
            {holdUp ? (
              holdPanel
            ) : turn?.team ? (
            <>
              {!ready && connected && <div className="px-1 text-center text-[14px] text-white">等待主持人驗證…</div>}
              {revealUp ? (
                // D7: the big screen and every phone show the answer in place of the next
                // question until the host moves on — judging waits until then. The boss's phase card
                // waits the same way (boss-phases.md D3).
                revealPanel
              ) : atFork ? (
                <div data-testid="host-fork">
                  <Panel tone="lav" className="flex items-center justify-center gap-2 px-3 py-2 text-center text-[20px]">
                    {game.forkBeat ? (
                      // Only the opened door is named: the room never tells the host which side hid what.
                      <span data-testid="host-fork-beat">{game.forkBeat.timeout ? "⏳ 時間到，" : ""}大螢幕正在打開{FORK_SIDE_LABEL[game.forkBeat.side]}：{FORK_DOOR_LABEL[game.forkBeat.door]}</span>
                    ) : (
                      <>
                        <span>{turn.team.name}在叉路口，選左門或右門</span>
                        {typeof game.forkLeft === "number" && <AnswerClock key={game.forkLeft} ms={game.forkLeft} variant="chip" />}
                      </>
                    )}
                  </Panel>
                </div>
              ) : isMc ? (
                <>
                  <div data-testid="host-mc-status">
                  <Panel tone="lav" className="px-3 py-2 text-center">
                    <div className="text-balance text-[22px]">
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
                          <span className="text-balance">替{turn.team.name}選・重答</span>
                          <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.retry}</span>
                        </PixelButton>
                        {!bossMiss && (
                          <PixelButton variant="flee" className="!min-h-[48px] text-[15px]" disabled={!canJudge} onClick={() => judge(turn.team!.id, turn.questionId!, false, "flee")}>
                            <span className="text-balance">替{turn.team.name}選・逃跑</span>
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
                  ) : buzz && game.question?.fields ? (
                    // A music question with fields: the host judges each one (docs/designs/multi-field.md F5).
                    <FieldJudge
                      key={fieldJudgeId}
                      labels={game.question.fields}
                      typed={answer?.typed?.teamId === turn.team.id ? answer.typed.fields : undefined}
                      disabled={!canJudge || held}
                      onJudge={(fields) => judge(turn.team!.id, turn.questionId!, fields.some(Boolean), fields.some(Boolean) ? undefined : "retry", fields)}
                    />
                  ) : (
                  <>
                  <PixelButton variant="ok" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, true)}>
                    {connected ? "答對！" : "重新連線中"}
                    <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.correct}</span>
                  </PixelButton>
                  {buzz ? (
                    <PixelButton variant="retry" className="text-[16px]" disabled={!canJudge || held} onClick={() => judge(turn.team!.id, turn.questionId!, false, "retry")}>
                      答錯（這題不能再搶）
                      <span className="px-key" aria-hidden="true">{HOST_KEYS.plain.retry}</span>
                    </PixelButton>
                  ) : cleric === "before" ? (
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
            ) : (
              // A buzzer phase has nobody on turn between buzzes (boss-buzzer.md): the reveal and the phase card still get 下一題.
              revealPanel
            )}
            {/* 改判答對 (TODOS.md): under the judge buttons, held for half a second after it shows up (canUndo). */}
            {game.undoWrong && !revealUp && (
              <PixelButton className="!mt-4 text-[16px]" style={{ background: "#fff" }} disabled={!canUndo} onClick={() => send({ type: "HOST_UNDO_WRONG", ...game.undoWrong!, eventId: game.eventId })}>
                {/* A music question with fields reopens its per-field judging instead (multi-field.md E2). */}
                ↩ 剛才的{teamName(game.undoWrong.teamId)}{game.question?.id === game.undoWrong.questionId && game.question.fields ? "重新逐欄判定" : "改判答對"}
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
            {/* A long epilogue is split into pages on the big screen; the host turns them, like the intro. */}
            {game.epiloguePage && game.epiloguePage.of > 1 && (
              <div data-testid="host-epilogue-pages" className="mt-6 flex items-center justify-center gap-3">
                <PixelButton disabled={!ready || game.epiloguePage.page === 0} className="!m-0 min-h-[56px] text-[18px]" onClick={() => send({ type: "HOST_EPILOGUE_PAGE", page: game.epiloguePage!.page - 1 })}>
                  ◀ 上一頁
                </PixelButton>
                <span className="text-[18px]">後記 {game.epiloguePage.page + 1}／{game.epiloguePage.of}</span>
                <PixelButton disabled={!ready || game.epiloguePage.page >= game.epiloguePage.of - 1} className="!m-0 min-h-[56px] text-[18px]" onClick={() => send({ type: "HOST_EPILOGUE_PAGE", page: game.epiloguePage!.page + 1 })}>
                  下一頁 ▶
                </PixelButton>
              </div>
            )}
            {holdUp && <div className="mt-3">{holdPanel}</div>}
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
function MediaControls({ questionId, media, disabled, send, liveOpen = false }: { questionId: string; media?: MediaCommand; disabled: boolean; send: (m: ClientMessage) => void; liveOpen?: boolean }) {
  // A command for another question, or none (an older server), is paused.
  const playing = media?.questionId === questionId && media.state === "playing";
  const press = (action: MediaAction) => send({ type: "HOST_MEDIA", questionId, action });
  const look = (lit: boolean) => ({ minHeight: 56, background: lit ? "var(--ok)" : "var(--cream)" });
  return (
    <div data-testid="host-media" className="mt-2">
      <div className="text-[14px]" role="status">
        大螢幕：{hostMediaStatus(playing, liveOpen)}
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
