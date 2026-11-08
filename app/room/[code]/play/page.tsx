"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { useRoomSocket } from "@/lib/use-room-socket";
import { DISCONNECTED_NOTICE, UNREACHABLE_NOTICE, UNREACHABLE_RETRY_LABEL, offlineNotice, type DropSnapshot } from "@/lib/offline-notice";
import { joinRejection, type JoinRejection } from "@/lib/join-rejection";
import { getOrCreateTeamId, getOrCreateTeamKey, storeTeam } from "@/lib/room-code";
import { joinPasswordFor } from "@/lib/stored";
import { MAX_TYPED_ANSWER, cleanTypedAnswer, scoreName, type ClientMessage, type LobbyTeams, type PublicQuestion, type StateMessage } from "@/lib/protocol";
import { CHEF_BONUS_PERCENT, CLASS_ICONS, CLASS_IDS, CLASS_LABELS, WARRIOR_TARGET, checkKey, type ClassId } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { describeTurn } from "@/lib/turn-info";
import { ordinal } from "@/lib/ordinal";
import { isPending, keepLatest, type NarrationState } from "@/lib/narration/client";
import { DialogueBox, LabelChip, Panel, PixelButton, QuestionMedia, SceneBackground, Sprite, TurnRibbon } from "@/components/pixel";
import { useCookStep, useFinaleStep, useRevealTime } from "@/components/cooking";
import { PHONE_LAG_MS, revealNow } from "@/lib/podium";
import { McOption } from "@/components/mc-option";
import { D20 } from "@/components/d20";
import { MageHint } from "@/components/mage-hint";
import { SORT_ITEMS, sortCode, sortOrderOf } from "@/lib/sort-order";
import { introDots, introStatus } from "@/components/how-to-play";
import { BOON_TEXT, EVENT_OUTCOME_TITLE, EVENT_SCENE_TEXT, eventEffectLine } from "@/lib/event-text";

/** What each class does, for the lobby cards (docs/designs/class-abilities.md). */
const CLASS_HINTS: Record<ClassId, string> = {
  warrior: `擲 1d20 代替答題，${WARRIOR_TARGET} 以上算答對`,
  mage: "選擇題刪 2 個錯的選項；填空題看答案第一個字",
  cleric: "答錯後，這回合再答一次",
  thief: "偷襲：這題答對，獎勵分和 boss 扣血 ×2",
  chef: `被動：每次拿到獎勵分都多 ${CHEF_BONUS_PERCENT}%，不用按`,
};

/** The lobby's class picker (D10=A): five cards and 不選; the passive chef takes a whole row (chef design D6). */
function ClassPicker({ current, send }: { current?: ClassId; send: (m: ClientMessage) => void }) {
  return (
    <Panel tone="lav" className="flex flex-col gap-2 px-[10px] py-[10px]">
      <div className="text-[18px]">選一個職業（技能一場用 2 次）</div>
      <div className="grid grid-cols-2 gap-2">
        {CLASS_IDS.map((id) => {
          const picked = current === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={picked}
              onClick={() => send({ type: "TEAM_PICK_CLASS", classId: id })}
              className="px-opt !flex-col !items-start !gap-[2px] !px-[10px] !py-2"
              style={{ minHeight: id === "chef" ? 64 : 96, ...(id === "chef" ? { gridColumn: "span 2" } : {}), ...(picked ? { background: "var(--turn)", outline: "4px solid var(--turn2)", outlineOffset: -2 } : {}) }}
            >
              <span className="text-[22px]">
                {CLASS_ICONS[id]} {CLASS_LABELS[id]}
              </span>
              <span className="text-[13px] leading-[1.3]">{CLASS_HINTS[id]}</span>
              {picked ? <span className="text-[13px]" style={{ color: "#a8470f" }}>◀ 已選</span> : null}
            </button>
          );
        })}
      </div>
      <PixelButton aria-pressed={!current} className="!m-0 !min-h-[48px] !text-[18px]" style={{ background: current ? "var(--cream)" : "var(--turn)" }} onClick={() => send({ type: "TEAM_PICK_CLASS", classId: null })}>
        不選（普通冒險者）
      </PixelButton>
    </Panel>
  );
}

/** The team's class ability on its own turn (D11=A: under 鎖定答案). The warrior's button or its die
 * while the room holds it; the mage's button (multipleChoice, while 2+ wrong options are left; a fill-in
 * or sort question without a hint yet) or what it removed; the thief's button or its armed bar (D16). The cleric prays in MyChoicePanel's wrong panel. */
function ClassAbility({ game, teamId, send, frozen = false, noHint = false }: { game: StateMessage; teamId: string; send: (m: ClientMessage) => void; frozen?: boolean; noHint?: boolean }) {
  const me = game.view.teams.find((t) => t.id === teamId);
  const roll = game.pendingRoll?.teamId === teamId ? game.pendingRoll : null;
  const q = game.question;
  const gone = (q && game.view.eliminated?.[q.id]) ?? [];
  // Which question this phone's mage press was for and how many options were out before it: the bar counts the rest.
  const [cast, setCast] = useState<{ qid: string; eventId: number; before: number } | null>(null);
  const ready = !!me && me.abilityUses > 0 && !frozen && !game.pendingRoll && !game.pendingLock && !game.view.pendingWrong && !!q;
  const button = (icon: string, label: string, sub: string, background: string, onClick: () => void) => (
    <PixelButton className="!m-0 mt-1 flex !min-h-[62px] flex-col !text-[21px]" style={{ background }} onClick={onClick}>
      {icon} {label}
      <small className="text-[13px]">{sub}</small>
    </PixelButton>
  );
  const use = () => send({ type: "TEAM_USE_ABILITY", questionId: q!.id });
  let body;
  if (roll) {
    body = (
      <div className="px-bar mt-1 flex items-center gap-3" role="status">
        {/* A kill's 4d20 has four dice: the big screen shows them (kill-roll.md). */}
        <D20 value={roll.kind === "kill" ? "?" : roll.value} size={54} />
        <span className="text-[20px]">{roll.kind === "kill" ? "最後一擊！擲 4d20 擊殺獎勵，看大螢幕 ▶" : roll.kind === "crit" ? `答對！暴擊骰擲出 ${roll.value}，看大螢幕 ▶` : roll.kind === "check" ? `說服檢定擲出 ${roll.value}，看大螢幕 ▶` : roll.value === 20 && !!(q?.options || q?.items) ? "擲出 20 大成功！看大螢幕 ▶" : `擲出 ${roll.value}！看大螢幕 ▶`}</span>
      </div>
    );
  } else if (me?.classId === "thief" && me.sneakArmed) {
    body = (
      <div className="px-bar mt-1 flex-col !gap-0 !text-[19px]" role="status" style={{ background: "#ff8787", boxShadow: "inset 0 -5px 0 #e03131" }}>
        <span>🗝️ 偷襲準備好了！</span>
        <small className="text-[13px]">這題答對加倍・答錯就沒了・剩 {me.abilityUses} 次</small>
      </div>
    );
  } else if (me?.classId === "mage" && q && cast?.qid === q.id && cast.eventId === game.eventId && gone.length > cast.before) {
    body = (
      <div className="px-bar mt-1 !text-[17px]" role="status">
        🔮 刪掉了 {gone.length - cast.before} 個・剩 {me.abilityUses} 次
      </div>
    );
  } else if (!ready) {
    return null;
  } else if (me.classId === "warrior" && !(q.options === undefined && q.items === undefined && game.view.checks !== undefined && !game.view.checks[checkKey(q.id, teamId)])) {
    // On a fill-in question the warrior rolls only after its persuasion check (dnd design R2).
    body = button("🎲", "擲骰代替答題", `${WARRIOR_TARGET} 以上算答對・剩 ${me.abilityUses} 次`, "#ffa94d", use);
  } else if (me.classId === "thief") {
    body = button("🗝️", "偷襲：這題答對加倍", `${scoreName(game.cuisine)}、boss 扣血 ×2・剩 ${me.abilityUses} 次`, "#ff8787", use);
  } else if (me.classId === "mage" && q.options && q.options.length - 1 - gone.length >= 2) {
    // The room keeps one wrong option: with 2 left it removes 1.
    body = button("🔮", `刪掉 ${Math.min(2, q.options.length - 2 - gone.length)} 個錯的選項`, `剩 ${me.abilityUses} 次`, "#c9b3ff", () => {
      setCast({ qid: q.id, eventId: game.eventId, before: gone.length });
      use();
    });
  } else if (me.classId === "mage" && q.items && game.view.mageHints[q.id] === undefined) {
    body = button("🔮", "看第 1 個是誰", `大家都看得到・剩 ${me.abilityUses} 次`, "#c9b3ff", use);
  } else if (me.classId === "mage" && !q.options && !q.items && game.view.mageHints[q.id] === undefined && game.view.checks?.[checkKey(q.id, teamId)]?.hint === undefined) {
    // The room refused this question (no_hint): a 1-character answer has no first character to give.
    if (noHint) return <div className="px-bar mt-1 !text-[17px]" role="status">🔮 這題答案太短，不能看第一個字・剩 {me.abilityUses} 次</div>;
    body = button("🔮", "看答案第一個字", `大家都看得到・剩 ${me.abilityUses} 次`, "#c9b3ff", use);
  } else return null;
  return body;
}

/** How long 鎖定中… waits for the room to confirm a lock before offering a retry (phone-answering.md D6). */
const LOCK_CONFIRM_MS = 3000;

/** The line a question asks: a text question's own text, or the prompt above its image or video (D5). */
function questionLine(q: PublicQuestion): string | null {
  return q.content.kind === "text" ? q.content.value : (q.prompt ?? null);
}

/** The question on the answering team's own turn (docs/designs/phone-question-text.md D2): a dark
 * strip flush with the top of its turn panel, so nobody reads it as a fifth option. The default
 * margins cancel the panel's px-[10px] py-[10px] padding. */

function QuestionStrip({ id, text, className = "-mx-[10px] -mt-[10px] mb-[2px]" }: { id?: string; text: string; className?: string }) {
  return (
    <h2 id={id} className={`bg-[var(--k)] px-3 py-[10px] text-[20px] font-normal leading-[1.35] text-[var(--cream)] [overflow-wrap:anywhere] ${className}`}>
      {text}
    </h2>
  );
}

/**
 * The team's own multipleChoice turn (docs/designs/phone-answering.md D2, D5–D7): pick, lock, then
 * either the beat (locked) or, after a wrong lock, 重答 / 逃跑. Eliminated options are grey and inert.
 */
function MyChoicePanel({ game, teamId, send }: { game: StateMessage; teamId: string; send: (m: ClientMessage) => void }) {
  const q = game.question!;
  const options = q.options ?? [];
  const pick = game.view.teams.find((t) => t.id === teamId)?.currentSelection ?? null;
  const gone = game.view.eliminated?.[q.id] ?? [];
  const magic = game.view.mageRemoved?.[q.id] ?? [];
  const lock = game.pendingLock?.teamId === teamId ? game.pendingLock : null;
  const wrong = game.view.pendingWrong?.teamId === teamId ? game.view.pendingWrong : null;
  const rolling = game.pendingRoll?.teamId === teamId;
  const me = game.view.teams.find((t) => t.id === teamId);
  // A wrong boss lock has no choice to make: the room brings a new question after a beat (D2=B),
  // unless this team's cleric may pray (祈禱 / 不用).
  const bossMiss = !!wrong && !!me?.inBossPhase;
  const canPray = !!wrong && game.view.awaitingPrayer === teamId;
  const prayed = !!wrong?.prayed;
  // A press waiting for the room: keyed to the question and eventId, so a later turn on the same
  // question (after 重答, which bumps eventId) never looks like it is still in flight.
  const [locking, setLocking] = useState<{ qid: string; eventId: number } | null>(null);
  const [lockFailed, setLockFailed] = useState(false);
  // Not while the crit die rolls: the lock has landed, and the judgment that moves eventId comes after the die.
  const inFlight = !lock && !wrong && !rolling && locking?.qid === q.id && locking.eventId === game.eventId;
  useEffect(() => {
    if (!inFlight) return;
    const id = setTimeout(() => {
      setLocking(null);
      setLockFailed(true);
    }, LOCK_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [inFlight]);
  const frozen = !!lock || !!wrong || inFlight || rolling;
  const stripId = useId();
  const text = questionLine(q);
  // A sort question: this phone's own order until it locks, kept across a 重答 so the team fixes only the ✕ places.
  const [mine, setMine] = useState<{ qid: string; order: number[] } | null>(null);
  const sorting = !!q.items;
  // A reload mid-question starts from the team's pick, else its last wrong order (so a 重答 keeps its ✓ places).
  const seed = sorting ? sortOrderOf(pick ?? gone.at(-1) ?? -1) : undefined;
  const myOrder = mine?.qid === q.id ? mine.order : (seed ?? Array.from({ length: SORT_ITEMS }, (_, i) => i));
  const shownOrder = (lock && sortOrderOf(lock.optionIndex)) || (wrong?.optionIndex != null && sortOrderOf(wrong.optionIndex)) || myOrder;
  const myCode = sortCode(myOrder);
  const pickable = sorting ? !gone.includes(myCode) : pick !== null && !gone.includes(pick);

  return (
    <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
      {text && <QuestionStrip id={stripId} text={text} />}
      {wrong && (
        <div className="flex items-center gap-2 text-[22px]">
          <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center border-[3px] border-[var(--k)] bg-[var(--danger)] text-[14px] text-white">✕</span>
          {prayed ? "祈禱了！這回合再答一次" : bossMiss && !canPray ? "答錯了！" : "答錯了！要怎麼辦？"}
        </div>
      )}
      {sorting && <MageHint hint={game.view.mageHints?.[q.id]} sort testId="mage-hint" />}
      {sorting ? (
        <SortList
          items={q.items!}
          order={shownOrder}
          marks={wrong ? game.wrongSlots : undefined}
          locked={!!lock}
          frozen={frozen}
          labelledBy={text ? stripId : undefined}
          onChange={(order) => {
            setLockFailed(false);
            setMine({ qid: q.id, order });
          }}
        />
      ) : (
      <div role="group" aria-labelledby={text ? stripId : undefined} aria-label={text ? undefined : "選項"} className="flex flex-col gap-2">
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
              label={out ? (magic.includes(i) ? undefined : "✕ 答錯") : locked ? "🔒 已鎖定" : picked && !lock ? "◀ 已選" : undefined}
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
      </div>
      )}
      {bossMiss && canPray ? (
        <div className="mt-1 flex gap-2">
          <PixelButton className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" style={{ background: "#ffe066" }} onClick={() => send({ type: "TEAM_USE_ABILITY", questionId: q.id })}>
            ✝️ 祈禱<small className="text-[13px]">立刻答新題・剩 {me!.abilityUses} 次</small>
          </PixelButton>
          <PixelButton className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" style={{ background: "var(--lav)" }} onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "retry" })}>
            不用<small className="text-[13px]">換下一隊</small>
          </PixelButton>
        </div>
      ) : bossMiss ? (
        <div className="px-bar mt-1" role="status">首領要換題了 ▶</div>
      ) : wrong ? (
        <>
          {canPray && (
            <PixelButton className="!m-0 mt-1 flex !min-h-[62px] flex-col !text-[21px]" style={{ background: "#ffe066" }} onClick={() => send({ type: "TEAM_USE_ABILITY", questionId: q.id })}>
              ✝️ 祈禱：這回合再答一次<small className="text-[13px]">剩 {me!.abilityUses} 次</small>
            </PixelButton>
          )}
          <div className="mt-1 flex gap-2">
            <PixelButton variant="ok" className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "retry" })}>
              重答<small className="text-[13px]">{prayed ? "立刻再答這題" : "下一輪再挑一次"}</small>
            </PixelButton>
            <PixelButton className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" style={{ background: "var(--lav)" }} onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "flee" })}>
              逃跑<small className="text-[13px]">{prayed ? "換一題，還是你們答" : "換一題簡單的"}</small>
            </PixelButton>
          </div>
        </>
      ) : rolling ? (
        <ClassAbility game={game} teamId={teamId} send={send} />
      ) : lock ? (
        <div className="px-bar mt-1" role="status">已鎖定！看大螢幕揭曉 ▶</div>
      ) : inFlight ? (
        <div className="px-bar ok mt-1" role="status">鎖定中…</div>
      ) : (
        <PixelButton
          variant="ok"
          disabled={!pickable}
          className="!m-0 mt-1 !min-h-[62px] !text-[23px]"
          onClick={() => {
            setLockFailed(false);
            setLocking({ qid: q.id, eventId: game.eventId });
            // A sort order is picked here, all at once: the room keeps the pick, the lock names it.
            if (sorting) send({ type: "TEAM_SELECT_OPTION", questionId: q.id, optionIndex: myCode });
            send({ type: "TEAM_LOCK_OPTION", questionId: q.id, optionIndex: sorting ? myCode : pick! });
          }}
        >
          {sorting && !pickable ? "這個順序答錯過了，換一下" : "鎖定答案"}
        </PixelButton>
      )}
      {!wrong && !rolling && <ClassAbility game={game} teamId={teamId} send={send} frozen={frozen} />}
      {lockFailed && !frozen && <div className="text-center text-[14px]">沒送出，再按一次</div>}
    </Panel>
  );
}

/**
 * A sort question's items, top to bottom (the owner's mockup A): drag a row's ☰ up or down to move it. Only the
 * handle takes the touch (touch-action: none), so the rest of the page still scrolls under a finger; the arrow
 * keys move a focused handle too. `order` is shown indices; `marks`, after a wrong lock, says which places are right.
 * Rows are keyed by place, not item, so a drag never moves the DOM node under the finger (iOS can drop a pointer
 * whose node React reinserts); the drag listens on window and ends on up, cancel, a freeze or unmount.
 */
function SortList({ items, order, marks, locked, frozen, labelledBy, onChange }: { items: string[]; order: number[]; marks?: boolean[]; locked: boolean; frozen: boolean; labelledBy?: string; onChange: (order: number[]) => void }) {
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  // The latest order and callback for window listeners, ahead of the rerender a move causes.
  const live = useRef({ order, onChange });
  const at = useRef<number | null>(null);
  const stop = useRef<() => void>(() => {});
  const focusTo = useRef<number | null>(null);
  useLayoutEffect(() => {
    live.current = { order, onChange };
    if (focusTo.current !== null) rows.current[focusTo.current]?.querySelector("button")?.focus();
    focusTo.current = null;
  });
  useEffect(() => () => stop.current(), []);
  useEffect(() => {
    if (frozen) stop.current();
  }, [frozen]);
  const move = (from: number, to: number) => {
    const { order: cur, onChange: change } = live.current;
    if (to < 0 || to >= cur.length || to === from) return false;
    const next = [...cur];
    next.splice(to, 0, ...next.splice(from, 1));
    live.current = { ...live.current, order: next };
    change(next);
    return true;
  };
  const start = (i: number) => {
    stop.current();
    at.current = i;
    setDragging(i);
    const onMove = (e: PointerEvent) => {
      const from = at.current;
      if (from === null) return;
      // The new place: how many other rows have their middle above the finger.
      const to = rows.current.filter((r, j) => r && j !== from && r.getBoundingClientRect().top + r.offsetHeight / 2 < e.clientY).length;
      if (move(from, to)) {
        at.current = to;
        setDragging(to);
      }
    };
    const end = () => {
      at.current = null;
      setDragging(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stop.current = () => {};
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    stop.current = end;
  };
  return (
    <ol aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : "排序"} className="flex flex-col gap-2" data-testid="sort-list">
      {order.map((shown, i) => {
        const mark = marks?.[i];
        const look = mark === true ? "ok" : mark === false ? "bad" : locked ? "lock" : dragging === i ? "sel" : frozen ? "dim" : "";
        return (
          <li
            key={i}
            ref={(el) => {
              rows.current[i] = el;
            }}
            data-testid={`sort-item-${i}`}
            className={`px-opt min-h-[56px] text-[21px] ${look}`}
          >
            <b>{i + 1}</b>
            <span>{items[shown]}</span>
            {mark !== undefined ? (
              <i>{mark ? "✓" : "✕"}</i>
            ) : locked ? (
              <i>🔒</i>
            ) : (
              <button
                type="button"
                aria-label={`移動「${items[shown]}」（第 ${i + 1} 個，上下鍵移動）`}
                disabled={frozen}
                className="-my-1 flex h-[48px] w-[48px] flex-none touch-none items-center justify-center text-[26px]"
                onPointerDown={(e) => {
                  e.preventDefault();
                  start(i);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  const to = e.key === "ArrowUp" ? i - 1 : i + 1;
                  if (move(i, to)) focusTo.current = to;
                }}
              >
                ☰
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The team's own text turn (fill-in, #104): type one answer, send it once, then wait for the host.
 * Mounted per question and eventId, so a 重答 turn starts with an empty box.
 */
function TextAnswerPanel({ game, teamId, send, offline, noHint }: { game: StateMessage; teamId: string; send: (m: ClientMessage) => void; offline: boolean; noHint: boolean }) {
  const q = game.question!;
  const sent = game.view.teams.find((t) => t.id === teamId)?.typedAnswer ?? null;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = sending && sent === null;
  useEffect(() => {
    if (!inFlight) return;
    const id = setTimeout(() => {
      setSending(false);
      setFailed(true);
    }, LOCK_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [inFlight]);
  const rolling = game.pendingRoll?.teamId === teamId;
  // A cleric's 答錯 waits for this team's choice (#106); the host may press for it too.
  const wrong = game.view.pendingWrong?.teamId === teamId && game.view.pendingWrong.optionIndex === null;
  const me = game.view.teams.find((t) => t.id === teamId);
  const canPray = wrong && game.view.awaitingPrayer === teamId;
  // Persuasion check (dnd design R6): the box stays locked until this team's check is written. An older server has no checks.
  const check = game.view.checks?.[checkKey(q.id, teamId)];
  const needCheck = game.view.checks !== undefined && !check;

  return (
    <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
      {questionLine(q) && <QuestionStrip text={questionLine(q)!} />}
      <MageHint hint={game.view.mageHints?.[q.id]} testId="mage-hint" />
      {wrong ? (
        <>
          <div className="flex items-center gap-2 text-[22px]" role="status">
            <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center border-[3px] border-[var(--k)] bg-[var(--danger)] text-[14px] text-white">✕</span>
            答錯了！要怎麼辦？
          </div>
          <div className="mt-1 flex gap-2">
            {canPray && (
              <PixelButton className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" style={{ background: "#ffe066" }} onClick={() => send({ type: "TEAM_USE_ABILITY", questionId: q.id })}>
                祈禱<small className="text-[13px]">再答一次・剩 {me!.abilityUses} 次</small>
              </PixelButton>
            )}
            <PixelButton variant="ok" className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "retry" })}>
              重答<small className="text-[13px]">換下一隊</small>
            </PixelButton>
            <PixelButton className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" style={{ background: "var(--lav)" }} onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "flee" })}>
              逃跑<small className="text-[13px]">換一題</small>
            </PixelButton>
          </div>
        </>
      ) : needCheck && !rolling && sent === null ? (
        <PixelButton
          variant="ok"
          data-testid="roll-check"
          className="!m-0 mt-1 flex !min-h-[72px] flex-col !text-[23px]"
          disabled={offline}
          onClick={() => send({ type: "TEAM_ROLL_CHECK", questionId: q.id, eventId: game.eventId })}
        >
          🎲 擲骰說服
          <small className="text-[13px]">過了 DC，大螢幕給答案第一個字</small>
        </PixelButton>
      ) : sent !== null ? (
        <div className="px-bar mt-1 [overflow-wrap:anywhere]" role="status" data-testid="typed-answer-sent">
          已送出：{sent}・等主持人判
        </div>
      ) : (
        <>
        {check && (
          <div className="px-bar mt-1 !text-[17px]" role="status" data-testid="check-result">
            🗣️ {check.value === 20 ? "說服成功！" : check.value === 1 ? "說服失敗……答對只拿一半" : check.passed ? (check.hint !== undefined ? "過了！看提示" : game.view.mageHints[q.id] !== undefined ? "過了！提示法師已經給了" : "過了！答案太短，沒有提示") : "沒過，直接答吧"}
          </div>
        )}
        {check?.hint !== undefined && <MageHint hint={check.hint} testId="check-hint" />}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFailed(false);
            setSending(true);
            send({ type: "TEAM_SUBMIT_TEXT", questionId: q.id, text, eventId: game.eventId });
          }}
        >
          <input
            type="text"
            className="px-input text-[20px]"
            aria-label="你們的答案"
            placeholder="打你們的答案"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_TYPED_ANSWER}
            disabled={inFlight || rolling || needCheck}
            autoComplete="off"
          />
          <PixelButton type="submit" variant="ok" disabled={!cleanTypedAnswer(text) || inFlight || rolling || needCheck || offline} className="!m-0 !min-h-[62px] !text-[23px]">
            {inFlight ? "送出中…" : "送出"}
          </PixelButton>
          {failed && !inFlight && <div className="text-center text-[14px]">沒送出，再按一次，或直接唸給主持人聽</div>}
        </form>
        </>
      )}
      {sent === null && !inFlight && !wrong && <ClassAbility game={game} teamId={teamId} send={send} noHint={noHint} />}
    </Panel>
  );
}

/** A turned-away phone types the host's 4-digit code to take over a team (docs/designs/team-handoff.md). */
function HandoffForm({ send }: { send: (m: ClientMessage) => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex w-full flex-col gap-2 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        send({ type: "TEAM_CLAIM", code });
      }}
    >
      <label htmlFor="handoff-code" className="text-[16px]">換了手機？輸入主持人給的配對碼：</label>
      <input
        id="handoff-code"
        className="px-input text-center text-[28px] tracking-[0.5em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="____"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
      />
      <PixelButton type="submit" variant="ok" disabled={code.length !== 4} className="!m-0 !min-h-[56px] !text-[20px]">
        接手隊伍
      </PixelButton>
    </form>
  );
}

/** The phone's end card. It waits out the big screen's cooking (cooking I5) and the place calls, on the room's clock and
 * PHONE_LAG_MS behind it, so no phone names the winner before the podium does (podium-reveal.md D16, eng D23). */
function FinishedPanel({ won, finale, podium, onPodium }: { won: boolean; finale: boolean; podium?: StateMessage["podium"]; onPodium: (up: boolean) => void }) {
  const step = useFinaleStep(finale);
  // Reduced motion does not end a phone's wait: it has nothing to animate, and showing the end would spoil first place.
  const t = useRevealTime(podium, PHONE_LAG_MS, false);
  const up = step === 4 && revealNow(podium, t).result;
  // The story (it names the winner) shows exactly while `up` holds; before paint, so it never flashes.
  useLayoutEffect(() => {
    onPodium(up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [up]);
  return (
    <Panel tone="lav" className="px-4 py-5 text-center">
      <div className="text-[26px]">遊戲結束！</div>
      <div className="mt-2 text-[18px]">{!up ? "冒險結束！看大螢幕 📺" : won ? "🏆 你們獲勝了！" : "感謝參與！"}</div>
    </Panel>
  );
}

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const teamName = searchParams.get("name") ?? "隊伍";
  /** Why the room turned this phone's JOIN away (lib/join-rejection.ts); null while it isn't turned away. */
  const [rejected, setRejected] = useState<JoinRejection | null>(null);
  // The question the room refused a mage's hint on (no_hint), so its button gives way to a note.
  const [noHintQid, setNoHintQid] = useState<string | null>(null);
  const sentPassword = useRef("");
  /** This phone has seen its own team in a LOBBY or STATE, so no later ERROR is a refused JOIN. */
  const joined = useRef(false);
  /** The host removed this team: a reconnect must not JOIN it back. Going home and joining again is allowed. */
  const removed = useRef(false);
  /** This connection's TEAM_CLAIM succeeded: a second claim sent by a double tap gets bad_code, which is not a refusal. */
  const claimed = useRef(false);

  const [teamId, setTeamId] = useState("");
  const [lobby, setLobby] = useState<LobbyTeams | null>(null);
  const [game, setGame] = useState<StateMessage | null>(null);
  const [narration, setNarration] = useState<NarrationState>(null);
  const [epilogue, setEpilogue] = useState<string | null>(null);
  /** A boss kill seen live (cooking I5): the end card and the epilogue wait for the big screen's podium. */
  const [finale, setFinale] = useState(false);
  const [podium, setPodium] = useState(true);


  /** A network drop (not a rest): the room skips an offline team's turn, so the team should know
   * it's disconnected, and after reconnecting whether the game moved on (lib/offline-notice.ts). */
  const [disconnected, setDisconnected] = useState(false);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const lastGame = useRef<StateMessage | null>(null);
  // The phase seen on this connection: a phone that reconnects into finished goes to the podium, as the screen does.
  const livePhase = useRef<StateMessage["phase"] | null>(null);
  /** Text of every question this phone has shown, by id: during a reveal `game.question` is already
   * the next one, so the reveal panel looks up the answered question here (phone-question-text.md D6). */
  const seen = useRef(new Map<string, string>());
  const [revealedText, setRevealedText] = useState<string | undefined>();
  const drop = useRef<DropSnapshot | null>(null);
  useEffect(() => {
    if (!offlineMsg) return;
    const id = setTimeout(() => setOfflineMsg(null), 10_000);
    return () => clearTimeout(id);
  }, [offlineMsg]);

  const { reset, rested, unreachable, send, reconnect } = useRoomSocket(code, {
    // Every (re)connect says who we are again: a phone that slept or changed network comes back
    // as the same team instead of staying "offline" and being skipped. An automatic reconnect's
    // JOIN carries `resume` so it isn't activity.
    onOpen(resume) {
      if (removed.current) return;
      setDisconnected(false);
      // A wiped room has forgotten us, so this JOIN may be refused: ask again. The connect-time snapshot may name
      // us before the JOIN is checked; joinRejection still lets a bad key's bad_token through.
      joined.current = false;
      claimed.current = false;
      livePhase.current = null;
      const id = getOrCreateTeamId();
      setTeamId(id);
      const password = (sentPassword.current = joinPasswordFor(code));
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
        case "ERROR": {
          if (msg.error === "bad_code" && claimed.current) break;
          const refused = joinRejection(msg.error, msg.detail, !!sentPassword.current, joined.current);
          if (msg.error === "team_removed") removed.current = true;
          if (refused) setRejected(refused);
          else if (msg.detail === "no_hint") setNoHintQid(lastGame.current?.question?.id ?? null);
          break;
        }
        case "TEAM_CLAIMED":
          // The host handed us this team: be it from now on, and JOIN as it (its key skips the password and name checks).
          claimed.current = true;
          storeTeam(msg.teamId, msg.teamKey);
          setTeamId(msg.teamId);
          setRejected(null);
          send({ type: "JOIN", teamId: msg.teamId, teamKey: msg.teamKey, teamName });
          break;
        case "LOBBY":
          // Not a sign we joined: a connection that failed the password still gets every LOBBY broadcast.
          setLobby(msg.teams);
          if (msg.teams.some((t) => t.id === getOrCreateTeamId())) joined.current = true;
          setGame(null);
          // Back from a finished game (回到大廳): its story is over.
          setNarration(null);
          setEpilogue(null);
          setRevealedText(undefined);
          setFinale(false);
          setPodium(true);
          seen.current.clear();
          lastGame.current = null;
          livePhase.current = null;
          drop.current = null;
          break;
        case "STATE": {
          { const line = msg.question && questionLine(msg.question); if (line) seen.current.set(msg.question!.id, line); }
          setRevealedText(msg.reveal ? seen.current.get(msg.reveal.questionId) : undefined);
          // A boss kill seen live: the winner waits for the big screen's cooking (cooking I5).
          if (msg.phase === "finished" && livePhase.current === "playing" && msg.reveal?.dish) {
            setFinale(true);
            setPodium(false);
          }
          setGame(msg);
          if (msg.view.teams.some((t) => t.id === getOrCreateTeamId())) joined.current = true;
          lastGame.current = msg;
          livePhase.current = msg.phase;
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
  // An event room's result holds the room too (event-rooms.md D3): the next team's question waits for 下一題.
  const eventRevealed = game?.eventReveal ?? null;
  const held = !!revealed || !!eventRevealed;
  // The dish line waits for the big screen's cooking (cooking I10); a phone opened after it shows it at once.
  const cookStep = useCookStep(revealed?.dish && revealed.served ? `${game!.eventId}` : null);
  const roster = game?.view.teams ?? lobby ?? [];
  const myIndex = Math.max(0, roster.findIndex((t) => t.id === teamId));
  const myTeam = game?.view.teams.find((t) => t.id === teamId);
  const turn = game ? describeTurn(game.view, game.question, game.phaseCard?.monster) : null;
  const isMyTurn = !!game && game.view.currentTurnTeamId === teamId;
  const finished = game?.phase === "finished";
  /** The how-to-play page on the big screen: the phone points there and never repeats the rules (D7). */
  const intro = !finished ? (game?.intro?.page ?? null) : null;
  const cards = (
    <>
      {/* While waiting, the roster above already highlights our own team. */}
      {game && (
        <Panel tone={isMyTurn ? "turn" : "cream"} className="flex items-center gap-3 px-3 py-[10px]">
          <Sprite kind="hero" variant={myIndex} scale={3} className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px]">{myTeam?.name ?? teamName}</div>
            {myTeam?.classId && (
              <div className="text-[15px]">
                {CLASS_ICONS[myTeam.classId]} {CLASS_LABELS[myTeam.classId]}・{myTeam.classId === "chef" ? "被動" : `剩 ${myTeam.abilityUses} 次`}
              </div>
            )}
            {myTeam?.boon && <div data-testid="phone-boon" className="text-[15px]">{BOON_TEXT[myTeam.boon]}</div>}
            <div className="my-1 text-[18px]" style={{ color: "#a8470f" }}>
              {myTeam ? (
                <>
                  <span className="px-num">{myTeam.reward}</span> {scoreName(game.cuisine)}
                </>
              ) : (
                `隊伍 ${TEAM_LOOKS[myIndex % TEAM_LOOKS.length].name}`
              )}
            </div>
          </div>
        </Panel>
      )}

      {game && !finished && !held && !intro && turn?.team && !turn.team.eventScene && (
        <Panel className="flex items-center gap-3 px-3 py-[10px]">
          <Sprite kind={turn.monster.kind} hue={turn.monster.hue} accessory={turn.monster.accessory} scale={turn.miniScale} className="flex-none" />
          <div className="text-[15px]">
            <div>{turn.team.name} 正在面對</div>
            <div className="text-[18px]">{turn.monster.name}</div>
          </div>
        </Panel>
      )}
    </>
  );

  // Turned away: the room still broadcasts LOBBY and STATE to this connection, but none of it is ours to show.
  if (rejected) {
    return (
      <main className="relative min-h-screen overflow-hidden">
        <SceneBackground theme="stone" cols={48} rows={100} arch={false} className="fixed inset-0" />
        <div className="relative z-10 flex min-h-screen flex-col gap-4 px-[14px] pb-4 pt-5">
          <Panel role="alert" className="flex flex-col items-center gap-3 px-4 py-4 text-center text-[18px]" style={{ background: "#ffd9d9" }}>
            {rejected.text}
            {rejected.handoff && <HandoffForm send={send} />}
            <a href={`/?code=${code}`} className="text-[16px] underline underline-offset-2">{rejected.link === "password" ? "回首頁輸入密碼" : "回首頁"}</a>
          </Panel>
        </div>
      </main>
    );
  }

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

        {unreachable ? (
          <Panel tone="turn" role="alert" className="flex flex-col items-center gap-3 px-4 py-4 text-center text-[18px]">
            {UNREACHABLE_NOTICE}
            <PixelButton onClick={reconnect} className="!m-0 !px-4 !py-2">{UNREACHABLE_RETRY_LABEL}</PixelButton>
          </Panel>
        ) : (
          !game && (
            <Panel tone="lav" className="px-4 py-5 text-center text-[20px]">
              {lobby ? "等待主持人開始遊戲…" : "連線中…"}
            </Panel>
          )
        )}

        {/* Who has joined so far, updating live while everyone waits for the host. */}
        {!game && lobby && (
          <ul data-testid="roster" className="flex flex-col gap-2">
            {lobby.map((t, i) => (
              <Panel key={t.id} tone={t.id === teamId ? "turn" : "cream"} className="flex items-center gap-3 px-3 py-2">
                <Sprite kind="hero" variant={i} scale={2} className="flex-none" />
                <span className="min-w-0 flex-1 truncate text-[18px]">{t.name}</span>
                {t.classId && <span className="text-[14px]">{CLASS_ICONS[t.classId]} {CLASS_LABELS[t.classId]}</span>}
                {t.id === teamId && <span className="text-[14px]">你們</span>}
              </Panel>
            ))}
          </ul>
        )}
        {!game && lobby?.some((t) => t.id === teamId) && <ClassPicker current={lobby.find((t) => t.id === teamId)?.classId} send={send} />}

        {intro !== null && (
          <div data-testid="phone-intro" className="flex flex-col gap-2">
            <Panel tone="lav" role="status" className="px-3 py-5 text-center">
              <div className="text-[22px]">看大螢幕 👀</div>
              <div className="mt-1 text-[16px]">主持人在講規則</div>
              {/* The live line a screen reader announces on every page (eng D7); the dots below are for the eye. */}
              <div className="mt-2 text-[16px]">{introStatus(intro)}</div>
            </Panel>
            <div aria-hidden className="text-center text-[18px] tracking-[6px] text-white">
              {introDots(intro)}
            </div>
          </div>
        )}

        {game && !finished && !intro && turn && (
          <TurnRibbon color={isMyTurn ? undefined : "#6ab4ff"}>
            {isMyTurn ? "輪到我們了！" : `輪到：${turn.team?.name ?? "…"}`}
          </TurnRibbon>
        )}

        {/* The boss's phase card, as the big screen shows it (docs/designs/boss-phases.md D4): the new rule
            reaches the back of the room too. The next question waits for the host's 下一題. */}
        {game && !finished && game.phaseCard && game.bossPhaseInfo && (
          <div data-testid="phone-phase-card">
            <Panel tone="lav" role="status" className="flex flex-col items-center gap-2 px-3 py-[14px] text-center">
              <LabelChip>還沒結束！</LabelChip>
              <div className="px-title-danger text-[24px]">第{ordinal(game.view.bossPhase)}階段：{game.bossPhaseInfo.name}</div>
              <div className="text-[18px]">{game.bossPhaseInfo.rule}</div>
            </Panel>
          </div>
        )}

        {/* From phase 2 on, a boss turn keeps the phase's rule in view (D5). */}
        {game && !finished && !game.phaseCard && turn?.inBoss && game.bossPhaseInfo && (
          <div data-testid="phone-phase-rule">
            <Panel tone="turn" className="px-3 py-[6px] text-[16px]">
              {game.bossPhaseInfo.name}：{game.bossPhaseInfo.rule}
            </Panel>
          </div>
        )}

        {/* An event room (event-rooms.md D10): the team's one button, then its result; every other phone looks up. */}
        {game && !finished && !intro && (eventRevealed || (!revealed && !game.phaseCard && turn?.team?.eventScene)) && <EventPanel game={game} teamId={teamId} send={send} />}

        {/* D2: on our own multipleChoice turn the options come first, right under the ribbon. */}
        {game && !finished && !held && isMyTurn && (game.question?.options || game.question?.items) && <MyChoicePanel game={game} teamId={teamId} send={send} />}

        {/* #104: our own host-judged text turn is a fill-in: the team types its answer for the host. */}
        {game && !finished && !held && isMyTurn && game.question && !game.question.options && !game.question.items && (
          <TextAnswerPanel key={`${game.question.id}:${game.eventId}`} game={game} teamId={teamId} send={send} offline={disconnected} noHint={noHintQid === game.question.id} />
        )}

        {/* D14: our own lock was right — the same tiles, the right one green, and the points. */}
        {game && !finished && revealed?.choice && revealed.choice.teamId === teamId && (
          <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
            {revealedText && <QuestionStrip text={revealedText} />}
            {revealed.choice.options.map((opt, i) => (
              <McOption key={i} index={i} text={opt} disabled look={i === revealed.choice!.correctIndex ? "ok" : "dim"} label={i === revealed.choice!.correctIndex ? "✓ 答對" : undefined} className="min-h-[56px] text-[21px]" />
            ))}
            <div className="px-bar ok mt-1 !text-[22px]" role="status">
              答對了！{revealed.choice.points > 0 ? `＋${revealed.choice.points} 分` : ""}
              {revealed.choice.chefBonus ? <span style={{ color: "#7a3208" }}>（廚師 +{revealed.choice.chefBonus}）</span> : null}
            </div>
          </Panel>
        )}

        {/* A sort question we got right: the correct order, every place ✓. */}
        {game && !finished && revealed?.sorted && revealed.sorted.teamId === teamId && (
          <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
            {revealedText && <QuestionStrip text={revealedText} />}
            {revealed.sorted.items.map((item, i) => (
              <McOption key={i} index={i} badge={i + 1} text={item} disabled look="ok" label="✓" className="min-h-[56px] text-[21px]" />
            ))}
            <div className="px-bar ok mt-1 !text-[22px]" role="status">
              答對了！{revealed.sorted.points > 0 ? `＋${revealed.sorted.points} 分` : ""}
              {revealed.sorted.chefBonus ? <span style={{ color: "#7a3208" }}>（廚師 +{revealed.sorted.chefBonus}）</span> : null}
            </div>
          </Panel>
        )}

        {/* Eng review R1, R3: one fixed media slot. On our own turn it comes right after the turn panel
            (or the ribbon) and the cards go below it; while waiting the cards stay above it. */}
        {!isMyTurn && cards}

        {/* The video plays on the big screen only (D7): the phone says where to look, and keeps its space for answering (D21). */}
        {game && !finished && !held && game.question?.content.kind === "youtube" && (
          <div data-testid="play-media-hint" className="self-start border-[3px] border-[var(--k)] bg-[var(--lav)] px-3 py-1 text-[18px]">
            {game.question.content.audioOnly ? "🎵 聽大螢幕" : "▶ 看大螢幕"}
          </div>
        )}

        {game && !finished && !held && game.question && game.question.content.kind === "image" && (
          <Panel className="flex justify-center px-3 py-3">
            {/* key tied to the question forces a fresh DOM node per question — without it, React
                would reuse the same node across consecutive media questions and a broken image
                (or a stale video) would stay hidden/showing for every question after it
                (adversarial review finding, carried forward from image-question-type.md). */}
            <QuestionMedia key={game.question.id} content={game.question.content} maxWidth={280} maxHeight={200} />
          </Panel>
        )}

        {isMyTurn && cards}

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
            {cookStep === 3 && revealed.dish && <div data-testid="phone-dish" className="text-[18px]">🍲 今晚的菜：{revealed.dish.name}</div>}
          </Panel>
        )}

        {finished && game && <FinishedPanel won={game.winners.includes(teamId)} finale={finale} podium={game.podium} onPodium={setPodium} />}

        <div className="mt-auto">
          <DialogueBox
            compact
            // The intro narrates nothing: after a replay eventId is past the last narration, so it must not spin.
            loading={!!game && !finished && intro === null && isPending(game.eventId, narration)}
            lines={
              finished
                ? epilogue && podium
                  ? [epilogue]
                  : narration
                    ? narration.lines
                    : ["冒險結束了，大螢幕正在頒獎。"]
                : intro !== null
                  ? ["說明結束後，輪到你們時這裡會出現題目"]
                  : narration
                  ? narration.lines
                  : [turn?.team ? `輪到${turn.team.name}了，${turn.monster.name}擋在前面……` : "火光搖曳，冒險者們正在集合……"]
            }
            // A host edit of this narration reads on from the edited line instead of starting over (D13).
            id={narration && intro === null && !(finished && epilogue && podium) ? narration.eventId : undefined}
          />
        </div>
      </div>
    </main>
  );
}

/** An event room on a phone (event-rooms.md D10). The team on turn presses its one button; after the press it reads
 * the outcome; every other phone reads that the team walked into an event room. */
function EventPanel({ game, teamId, send }: { game: StateMessage; teamId: string; send: (msg: ClientMessage) => void }) {
  const reveal = game.eventReveal;
  const team = game.view.teams.find((t) => t.id === (reveal ? reveal.teamId : game.view.currentTurnTeamId));
  // A press waiting for the room, keyed to the eventId so a later event turn starts with a live button.
  const [pressed, setPressed] = useState<number | null>(null);
  // A press the room refused leaves the eventId as it was: give the button back rather than wait forever.
  useEffect(() => {
    if (pressed === null) return;
    const t = setTimeout(() => setPressed(null), 5000);
    return () => clearTimeout(t);
  }, [pressed]);
  const scene = reveal?.scene ?? team?.eventScene;
  if (!team || !scene) return null;
  const text = EVENT_SCENE_TEXT[scene];
  if (team.id !== teamId) {
    return (
      <Panel className="px-3 py-[10px] text-[17px]">
        <span data-testid="phone-event-watch">{team.name}走進了事件房……看大螢幕 📺</span>
      </Panel>
    );
  }
  if (reveal) {
    return (
      <div data-testid="phone-event-result" className="flex flex-col gap-3">
        <Panel className="flex flex-col items-center gap-1 px-3 py-[12px] text-center">
          <LabelChip>❓ 事件房</LabelChip>
          <div className="px-title-gold text-[26px]">{EVENT_OUTCOME_TITLE[reveal.outcome]}</div>
          <div className="text-[18px]">{reveal.dish ? `${reveal.dish.name}！` : ""}{eventEffectLine({ ...reveal, chefBonus: undefined })}</div>
          {reveal.chefBonus ? <div className="text-[15px]">（廚師 +{reveal.chefBonus}）</div> : null}
        </Panel>
        <Panel className="px-3 py-[10px] text-[16px]">看大螢幕 📺　主持人按「下一題」後，我們{reveal.entersBoss ? "走進首領房" : "走到下一間房"}</Panel>
      </div>
    );
  }
  const waiting = pressed === game.eventId;
  return (
    <div data-testid="phone-event" className="flex flex-col gap-2">
      <Panel className="flex flex-col items-start gap-1 px-3 py-[12px]">
        <LabelChip>❓ 事件房</LabelChip>
        <div className="text-[18px]">{text.line}</div>
      </Panel>
      <PixelButton
        data-testid="phone-event-open"
        disabled={waiting}
        onClick={() => {
          setPressed(game.eventId);
          send({ type: "TEAM_OPEN_EVENT", eventId: game.eventId });
        }}
        className="!m-0 w-full !py-4 text-[24px]"
      >{text.button}</PixelButton>
      <div className="text-center text-[15px] text-white">按下去，大螢幕就會演出來</div>
    </div>
  );
}
