"use client";

import { AnswerClock } from "@/components/answer-clock";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { useRoomSocket } from "@/lib/use-room-socket";
import { DISCONNECTED_NOTICE, UNREACHABLE_NOTICE, UNREACHABLE_RETRY_LABEL, offlineNotice, type DropSnapshot } from "@/lib/offline-notice";
import { joinRejection, type JoinRejection } from "@/lib/join-rejection";
import { getOrCreateTeamId, getOrCreateTeamKey, storeTeam } from "@/lib/room-code";
import { joinPasswordFor } from "@/lib/stored";
import { MAX_TYPED_ANSWER, REACTIONS, REACT_GAP_MS, cleanTypedAnswer, scoreName, type ClientMessage, type Reaction, type LobbyTeams, type PublicQuestion, type StateMessage, type EventReveal } from "@/lib/protocol";
import { ABILITY_USES, CATCH_PAY, CHEF_BONUS_PERCENT, ORACLE_USES, MORE_ABILITY_USES, CLASS_ICONS, CLASS_IDS, CLASS_LABELS, SNEAK_REWARD_MULTIPLIER, WARRIOR_TARGET, FORTUNE_EFFECTS, checkKey, type ClassId } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { describeTurn } from "@/lib/turn-info";
import { sprintSeen } from "@/lib/transitions";
import { ordinal } from "@/lib/ordinal";
import { isPending, keepLatest, type NarrationState } from "@/lib/narration/client";
import { DialogueBox, LabelChip, Panel, PixelButton, QuestionMedia, SceneBackground, Sprite, TurnRibbon } from "@/components/pixel";
import { memoryPhoneHint } from "@/lib/memory-copy";
import { dishUp, useCookStep, useFinaleStep, useRevealTime } from "@/components/cooking";
import { PHONE_LAG_MS, placeLabel, revealNow, teamPlace } from "@/lib/podium";
import { McOption } from "@/components/mc-option";
import { D20 } from "@/components/d20";
import { MageHint } from "@/components/mage-hint";
import { SORT_ITEMS, sortCode, sortOrderOf } from "@/lib/sort-order";
import { introDots, introStatus } from "@/components/how-to-play";
import { BOON_TEXT, EVENT_OUTCOME_TITLE, eventEffectLine, FORK_DOOR_LABEL, FORK_SIDE_LABEL, FORTUNE_CONDITION_TEXT, FORTUNE_EFFECT_TEXT } from "@/lib/event-text";

/** What each class does, for the lobby cards (docs/designs/class-abilities.md). */
const CLASS_HINTS: Record<ClassId, string> = {
  warrior: `擲 1d20 代替答題，${WARRIOR_TARGET} 以上算答對`,
  mage: "選擇題刪 2 個錯的選項；填空題看答案第一個字",
  cleric: "答錯後，這回合再答一次",
  thief: `偷襲：這題答對，獎勵分 ×${SNEAK_REWARD_MULTIPLIER}、boss 扣血 ×2`,
  chef: `被動：每次拿到獎勵分都多 ${CHEF_BONUS_PERCENT}%，不用按`,
};

/** The lobby's class picker (D10=A): five cards and 不選; the passive chef takes a whole row (chef design D6). */
function ClassPicker({ current, send }: { current?: ClassId; send: (m: ClientMessage) => void }) {
  return (
    <Panel tone="lav" className="flex flex-col gap-2 px-[10px] py-[10px]">
      <div className="text-[18px]">選一個職業（戰士、法師技能一場 {MORE_ABILITY_USES} 次，其他 {ABILITY_USES} 次）</div>
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

/** 🧪 喝下幸運藥水 (docs/designs/lucky-potion.md D2, D6), right above the control it affects. The caller shows it only while
 * a crit or check die can still roll; this hides it in a buzzer phase, without a potion, or once drunk on this question. */
function PotionButton({ game, teamId, questionId, send }: { game: StateMessage; teamId: string; questionId: string; send: (m: ClientMessage) => void }) {
  const me = game.view.teams.find((t) => t.id === teamId);
  if (!me?.item || me.itemArmed || game.view.buzz) return null;
  return (
    <PixelButton data-testid="drink-potion" className="!m-0 mt-1 flex !min-h-[56px] flex-col !text-[20px]" onClick={() => send({ type: "TEAM_DRINK_POTION", questionId, eventId: game.eventId })}>
      🧪 喝下幸運藥水<small className="text-[13px]">下一顆骰子擲兩次取高</small>
    </PixelButton>
  );
}

/** The team card's potion line (D2, D4, D5): held, drunk on the question it faces now, or back after a question with no roll
 * (E2: until the team's next turn). */
function potionLine(team: StateMessage["view"]["teams"][number] | undefined, myTurn: boolean): { text: string; drunk?: true } | null {
  if (!team?.item) return null;
  if (team.itemArmed) return { text: "🧪 已喝下：這題的下一顆骰擲兩次取高", drunk: true };
  return { text: team.itemArmedFor && !myTurn ? "🧪 藥水還在：這題沒擲到骰" : "🧪 有一瓶幸運藥水" };
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
        <small className="text-[13px]">這題答對獎勵分 ×{SNEAK_REWARD_MULTIPLIER}・答錯就沒了・剩 {me.abilityUses} 次</small>
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
  } else if (me.classId === "thief" && !q.checkFirst) {
    // Not before the check: 偷襲 is armed once the question is up.
    body = button("🗝️", "偷襲：這題答對加碼", `${scoreName(game.cuisine)} ×${SNEAK_REWARD_MULTIPLIER}、boss 扣血 ×2・剩 ${me.abilityUses} 次`, "#ff8787", use);
  } else if (me.classId === "mage" && q.options && q.options.length - 1 - gone.length >= 2) {
    // The room keeps one wrong option: with 2 left it removes 1.
    body = button("🔮", `刪掉 ${Math.min(2, q.options.length - 2 - gone.length)} 個錯的選項`, `剩 ${me.abilityUses} 次`, "#c9b3ff", () => {
      setCast({ qid: q.id, eventId: game.eventId, before: gone.length });
      use();
    });
  } else if (me.classId === "mage" && q.items && game.view.mageHints[q.id] === undefined) {
    body = button("🔮", "看第 1 個是誰", `大家都看得到・剩 ${me.abilityUses} 次`, "#c9b3ff", use);
  } else if (me.classId === "mage" && !q.options && !q.items && game.view.mageHints[q.id] === undefined && !q.checkFirst && game.view.checks?.[checkKey(q.id, teamId)]?.hint === undefined) {
    // Not before the check (the question is not up yet); after it, only when it gave no first character.
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
 * either the beat (locked) or, after a wrong lock, 下輪再答 / 逃跑. Eliminated options are grey and inert.
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
      {sorting && !frozen && <div className="text-[16px]">按住 ☰ 拖曳排順序</div>}
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
              ✝️ 祈禱<small className="text-[13px]">現在再答一次・剩 {me!.abilityUses} 次</small>
            </PixelButton>
          )}
          <PixelButton variant="ok" className="!m-0 mt-1 flex !min-h-[64px] flex-col !text-[23px]" onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "retry" })}>
            {prayed ? "現在再答" : "下輪再答"}<small className="text-[13px]">{prayed ? "立刻再答這題" : "先換下一隊"}</small>
          </PixelButton>
          <FleeButtons questionId={q.id} send={send} prayed={prayed} />
        </>
      ) : rolling ? (
        <ClassAbility game={game} teamId={teamId} send={send} />
      ) : lock ? (
        <div className="px-bar mt-1" role="status">已鎖定！看大螢幕揭曉 ▶</div>
      ) : inFlight ? (
        <div className="px-bar ok mt-1" role="status">鎖定中…</div>
      ) : (
        <>
        <PotionButton game={game} teamId={teamId} questionId={q.id} send={send} />
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
        </>
      )}
      {!wrong && !rolling && <ClassAbility game={game} teamId={teamId} send={send} frozen={frozen} />}
      {lockFailed && !frozen && <div className="text-center text-[14px]">沒送出，再按一次</div>}
    </Panel>
  );
}

/** After a wrong answer: 逃跑・同房 and 逃跑・換房 (a new monster, same room). The boss room has one 逃跑, a new question. */
function FleeButtons({ questionId, send, prayed = false, boss = false }: { questionId: string; send: (m: ClientMessage) => void; prayed?: boolean; boss?: boolean }) {
  const flee = (choice: "flee" | "switch") => () => send({ type: "TEAM_WRONG_CHOICE", questionId, choice });
  const cls = "!m-0 flex !min-h-[72px] flex-1 flex-col whitespace-nowrap !text-[21px]";
  return (
    <div className="mt-1 flex gap-2">
      <PixelButton className={cls} style={{ background: "var(--lav)" }} onClick={flee("flee")}>
        {boss ? "逃跑" : "逃跑・同房"}<small className="text-[13px]">{boss ? "換一題" : prayed ? "同一隻怪，你們再答" : "同一隻怪，換簡單題"}</small>
      </PixelButton>
      {!boss && (
        <PixelButton className={cls} style={{ background: "var(--lav)" }} onClick={flee("switch")}>
          逃跑・換房<small className="text-[13px]">{prayed ? "換一隻怪，你們再答" : "換一隻怪，換簡單題"}</small>
        </PixelButton>
      )}
    </div>
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
/** `buzzed`: we buzzed first in a buzzer phase, so typing is optional, with no check and no ability (boss-music-buzzer.md M2). */
function TextAnswerPanel({ game, teamId, send, offline, noHint, buzzed = false }: { game: StateMessage; teamId: string; send: (m: ClientMessage) => void; offline: boolean; noHint: boolean; buzzed?: boolean }) {
  const q = game.question!;
  const sent = game.view.teams.find((t) => t.id === teamId)?.typedAnswer ?? null;
  const [text, setText] = useState("");
  const [boxes, setBoxes] = useState<string[]>(() => (q.fields ?? []).map(() => ""));
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
  const needCheck = !buzzed && game.view.checks !== undefined && !check;

  return (
    <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
      {!buzzed && questionLine(q) && <QuestionStrip text={questionLine(q)!} />}
      {!buzzed && <MageHint hint={game.view.mageHints?.[q.id]} testId="mage-hint" />}
      {wrong ? (
        <>
          <div className="flex items-center gap-2 text-[22px]" role="status">
            <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center border-[3px] border-[var(--k)] bg-[var(--danger)] text-[14px] text-white">✕</span>
            答錯了！要怎麼辦？
          </div>
          <div className="mt-1 flex gap-2">
            {canPray && (
              <PixelButton className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" style={{ background: "#ffe066" }} onClick={() => send({ type: "TEAM_USE_ABILITY", questionId: q.id })}>
                祈禱<small className="text-[13px]">現在再答一次・剩 {me!.abilityUses} 次</small>
              </PixelButton>
            )}
            <PixelButton variant="ok" className="!m-0 flex !min-h-[72px] flex-1 flex-col !text-[23px]" onClick={() => send({ type: "TEAM_WRONG_CHOICE", questionId: q.id, choice: "retry" })}>
              {/* In the boss room the boss rotates its question, so the team comes back to a new one. */}
              {me?.inBossPhase ? "下輪換題" : "下輪再答"}<small className="text-[13px]">先換下一隊</small>
            </PixelButton>
          </div>
          <FleeButtons questionId={q.id} send={send} boss={!!me?.inBossPhase} />
        </>
      ) : needCheck && sent === null ? (
        // The die's beat: nothing to press, the roll banner above says to watch the big screen.
        rolling ? null : <>
        <PotionButton game={game} teamId={teamId} questionId={q.id} send={send} />
        <PixelButton
          variant="ok"
          data-testid="roll-check"
          className="!m-0 mt-1 flex !min-h-[72px] flex-col !text-[23px]"
          disabled={offline}
          onClick={() => send({ type: "TEAM_ROLL_CHECK", questionId: q.id, eventId: game.eventId })}
        >
          🎲 擲骰說服
          <small className="text-[13px]">必擲・不花次數・過了給第一個字</small>
        </PixelButton>
        </>
      ) : sent !== null ? (
        <div className="px-bar mt-1 [overflow-wrap:anywhere]" role="status" data-testid="typed-answer-sent">
          {/* A buzzer phase hides the text from STATE (multi-field.md E4): "" only says it was sent. */}
          {sent ? `已送出：${sent}` : "已送出"}・等主持人判
        </div>
      ) : (
        <>
        {/* A passed check with no hint and a mage hint on the question: the mage's came first. A too-short answer never
            gets a mage hint later (mageHint refuses it, no_hint), so this label does not flip afterwards. */}
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
            send({ type: "TEAM_SUBMIT_TEXT", questionId: q.id, text, eventId: game.eventId, ...(q.fields ? { fields: boxes } : {}) });
          }}
        >
          {/* A music question with fields: one box each, any may stay blank (docs/designs/multi-field.md F4). */}
          {q.fields ? (
            q.fields.map((label, i) => (
              <label key={i} className="flex flex-col gap-1 text-[16px]">
                {label}
                <input
                  type="text"
                  className="px-input text-[20px]"
                  aria-label={label}
                  placeholder="選填，可空白"
                  value={boxes[i] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBoxes((b) => b.map((x, j) => (j === i ? v : x)));
                  }}
                  maxLength={MAX_TYPED_ANSWER}
                  disabled={inFlight || rolling || needCheck}
                  autoComplete="off"
                />
              </label>
            ))
          ) : (
          <input
            type="text"
            className="px-input text-[20px]"
            aria-label="你們的答案"
            placeholder={buzzed ? "也可以打字給主持人看（選填）" : "打你們的答案"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_TYPED_ANSWER}
            disabled={inFlight || rolling || needCheck}
            autoComplete="off"
          />
          )}
          <PixelButton type="submit" variant="ok" disabled={!(q.fields ? boxes.some(cleanTypedAnswer) : cleanTypedAnswer(text)) || inFlight || rolling || needCheck || offline} className="!m-0 !min-h-[62px] !text-[23px]">
            {inFlight ? "送出中…" : "送出"}
          </PixelButton>
          {/* Every box blank: nothing to send (multi-field.md D3). */}
          {q.fields && !boxes.some(cleanTypedAnswer) && <div className="text-center text-[14px]">不打字就直接講答案</div>}
          {failed && !inFlight && <div className="text-center text-[14px]">沒送出，再按一次，或直接唸給主持人聽</div>}
        </form>
        </>
      )}
      {!buzzed && sent === null && !inFlight && !wrong && <ClassAbility game={game} teamId={teamId} send={send} noHint={noHint} />}
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
function FinishedPanel({ place, reward, cuisine, finale, podium, onPodium }: { place: number | null; reward: number; cuisine?: boolean; finale: boolean; podium?: StateMessage["podium"]; onPodium: (up: boolean) => void }) {
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
      <div className={!up || place === null ? "text-[26px]" : "text-[18px]"}>遊戲結束！</div>
      {!up || place === null ? (
        <div className="mt-2 text-[18px]">冒險結束！看大螢幕 📺</div>
      ) : (
        <>
          <div data-testid="phone-place" className="mt-1 text-[30px]">{placeLabel(place)}</div>
          <div className="mt-2 text-[20px]">
            <span className="px-num">{reward}</span> {scoreName(cuisine)}
          </div>
        </>
      )}
    </Panel>
  );
}

/** 抓包與神諭 (docs/designs/anti-ai-cheating.md) on a phone: 🔮 公開問神諭 under the answer on our own turn, 🚨 抓包 for a
 * waiting team, the open catch's status for everyone. Shown only while the room's window is open (the question up, not
 * yet answered, a room turn); the room checks every press again. */
function AntiCheatPanel({ game, teamId, isMyTurn, send }: { game: StateMessage; teamId: string; isMyTurn: boolean; send: (m: ClientMessage) => void }) {
  const ac = game.view.antiCheat;
  const q = game.question;
  const me = game.view.teams.find((t) => t.id === teamId);
  const accused = game.view.teams.find((t) => t.id === game.view.currentTurnTeamId);
  if (!ac || !me || !accused || !q) return null;
  if (ac.openCatch) {
    const name = (id: string) => game.view.teams.find((t) => t.id === id)?.name ?? "";
    return (
      <div data-testid="catch-open" role="status" className="px-bar mt-1 !text-[17px]" style={{ background: "var(--danger)", color: "#fff" }}>
        🚨 {name(ac.openCatch.by)}說{name(ac.openCatch.teamId)}在問 AI・等主持人裁決
      </div>
    );
  }
  if (isMyTurn && me.oracle) {
    return <div data-testid="oracle-on" role="status" className="px-bar mt-1 !text-[17px]" style={{ background: "#c9b3ff" }}>🔮 請示了神諭：這題答對獎勵減半</div>;
  }
  // The window: a room turn whose question is up and not answered (a typed answer waiting still lets a catch in).
  const open = ac.on && !q.checkFirst && !q.memorize && !accused.inBossPhase && !game.view.buzz && !game.view.pendingWrong && !game.pendingLock && !game.pendingRoll;
  if (!open) return null;
  if (isMyTurn) {
    if (!me.oracleLeft || me.typedAnswer !== null) return null;
    return (
      <PixelButton data-testid="use-oracle" className="!m-0 mt-2 flex !min-h-[56px] flex-col !text-[20px]" style={{ background: "#c9b3ff" }} onClick={() => send({ type: "TEAM_ORACLE", questionId: q.id })}>
        🔮 公開問神諭<small className="text-[13px]">整場 {ORACLE_USES} 次・這題答對獎勵減半・這題不會被抓包</small>
      </PixelButton>
    );
  }
  if (me.catchesLeft === undefined) return null;
  const why = accused.oracle ? "這題他們公開問了神諭" : ac.caught ? "這題已經抓過了" : me.catchesLeft <= 0 ? "抓包次數用完了" : null;
  return (
    <PixelButton
      data-testid="file-catch"
      aria-disabled={!!why}
      className="!m-0 mb-3 flex !min-h-[60px] flex-col !text-[20px]"
      style={why ? { background: "var(--cream2)", color: "var(--dim-ink)", cursor: "default" } : { background: "var(--danger)", color: "#fff" }}
      onClick={() => !why && send({ type: "TEAM_CATCH", questionId: q.id })}
    >
      🚨 抓包！{accused.name}在問 AI<small className="text-[13px]">{why ?? `剩 ${me.catchesLeft} 次・成立 +${CATCH_PAY.bounty}，冤枉 −${CATCH_PAY.falseReport}`}</small>
    </PixelButton>
  );
}

type ReactSent = { reaction: Reaction; at: number };
/** 觀眾反應 (docs/designs/audience-reactions.md): a waiting team's four fixed reactions, in one row above the
 * dialogue box. After a tap all four go grey for REACT_GAP_MS, the room's own limit (it allows REACT_JITTER_MS of network delay). */
function ReactBar({ send, sent, setSent }: { send: (m: ClientMessage) => void; sent: ReactSent | null; setSent: (s: ReactSent | null) => void }) {
  // The cooldown is the page's, not this bar's: the bar unmounts on our own turn, and may come back inside the gap.
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(null), Math.max(0, sent.at + REACT_GAP_MS - Date.now()));
    return () => clearTimeout(t);
  }, [sent, setSent]);
  return (
    <div data-testid="react-bar" className="mb-5 flex flex-col gap-1">
      <div role="status" className="text-center text-[15px] text-[var(--cream)]" style={{ textShadow: "2px 2px 0 var(--k)" }}>
        {sent ? `已送出 ${REACTIONS[sent.reaction].emoji}，${REACT_GAP_MS / 1000} 秒後可再按` : "點一下，大螢幕會飄出來"}
      </div>
      <div className="grid grid-cols-4 gap-[6px]">
        {(Object.keys(REACTIONS) as Reaction[]).map((r) => (
          <PixelButton
            key={r}
            aria-disabled={!!sent}
            className="!m-0 flex !min-h-[76px] flex-col !p-1 !text-[16px] leading-tight"
            // Cooling: the D5 grey (phone-answering.md D12), drawn, not :disabled opacity.
            style={sent ? { background: "var(--cream2)", color: "var(--dim-ink)", cursor: "default", boxShadow: "0 -4px 0 0 var(--dim-line), 0 4px 0 0 var(--dim-line), -4px 0 0 0 var(--dim-line), 4px 0 0 0 var(--dim-line)" } : { background: "var(--cream)" }}
            onClick={() => {
              if (sent) return;
              send({ type: "REACT", reaction: r });
              setSent({ reaction: r, at: Date.now() });
            }}
          >
            <span aria-hidden className="text-[30px] leading-[1.1]">{REACTIONS[r].emoji}</span>
            {REACTIONS[r].label}
          </PixelButton>
        ))}
      </div>
    </div>
  );
}

/** The buzzer phase's one button (boss-buzzer.md D7): grey while the music waits for ▶, red to buzz, gold once we
 * buzzed first, grey again when another team holds it or we were judged wrong on this question. */
function BuzzButton({ game, buzz, teamId, send }: { game: StateMessage; buzz: NonNullable<StateMessage["view"]["buzz"]>; teamId: string; send: (m: ClientMessage) => void }) {
  const holder = game.view.teams.find((t) => t.id === buzz.teamId);
  const waiting = game.question?.content.kind === "youtube" && !buzz.open;
  const GREY = "#5a4a60";
  const [look, label]: [string, React.ReactNode] =
    buzz.teamId === teamId
      ? ["var(--warn)", <>你們搶到了！<span className="block text-[18px]">大聲說答案</span></>]
      : holder
        ? [GREY, <><span className="block px-8 text-[22px] [overflow-wrap:anywhere]">{holder.name}</span>搶到了</>]
        : buzz.out.includes(teamId)
          ? [GREY, <>這題答錯了<span className="block text-[16px]">等下一題</span></>]
          : waiting
            ? [GREY, "等音樂開始…"]
            : ["#ff5050", "搶答！"];
  const live = !buzz.teamId && !buzz.out.includes(teamId) && !waiting;
  return (
    <div data-testid="buzz" className="flex justify-center py-2">
      <button
        type="button"
        disabled={!live}
        aria-live="polite"
        onClick={() => send({ type: "TEAM_BUZZ", questionId: buzz.questionId })}
        className="flex aspect-square w-[min(72vw,280px)] flex-col items-center justify-center rounded-full text-center text-[34px]"
        style={{ background: look, color: live ? "#fff" : look === "var(--warn)" ? "var(--ink)" : "#ccc", boxShadow: "0 0 0 5px var(--k), inset 0 -12px 0 #0004", textShadow: live ? "3px 3px 0 var(--k)" : undefined }}
      >
        {label}
      </button>
    </div>
  );
}

/** The buzz winner picks the next song's category (boss-music-buzzer.md M5), and may change it until the host's ▶. */
function CategoryPanel({ categories, chosen, send }: { categories: string[]; chosen?: string; send: (m: ClientMessage) => void }) {
  return (
    <div data-testid="pick-category">
    <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
      <div className="text-[20px]">答對了！選下一首的類別</div>
      <div className="grid grid-cols-2 gap-2">
        {categories.map((c) => (
          <PixelButton key={c} aria-pressed={c === chosen} className="!m-0 !min-h-[56px] !text-[20px] [overflow-wrap:anywhere]" style={{ background: c === chosen ? "var(--ok)" : "var(--cream)" }} onClick={() => send({ type: "TEAM_PICK_CATEGORY", category: c })}>
            {c}
          </PixelButton>
        ))}
      </div>
      <div className="text-[13px]">{chosen ? `已選：${chosen}・主持人按 ▶ 前都能改` : "不選就照順序出下一首"}</div>
    </Panel>
    </div>
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
  /** A waiting late team typed a wrong handoff code: said on the waiting screen, which it must not lose (late-join.md). */
  const [badCode, setBadCode] = useState(false);
  /** This connection has shown the waiting screen: a wrong code typed there is never a refused JOIN, even when the
   * host lets the team in (or goes back to the lobby) before the room's bad_code arrives. */
  const waited = useRef(false);

  const [teamId, setTeamId] = useState("");
  const [lobby, setLobby] = useState<LobbyTeams | null>(null);
  const [game, setGame] = useState<StateMessage | null>(null);
  const [narration, setNarration] = useState<NarrationState>(null);
  const [epilogue, setEpilogue] = useState<string | null>(null);
  /** A boss kill seen live (cooking I5): the end card and the epilogue wait for the big screen's podium. */
  const [finale, setFinale] = useState(false);
  const [podium, setPodium] = useState(true);
  /** ⚔️ 最後衝刺 seen on this connection (lib/transitions.ts sprintSeen), and its 3-second card for a blessed team. */
  const sprintSeenRef = useRef<boolean | null>(null);
  const [sprintCard, setSprintCard] = useState(false);
  useEffect(() => {
    if (!sprintCard) return;
    const id = setTimeout(() => setSprintCard(false), 3000);
    return () => clearTimeout(id);
  }, [sprintCard]);


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
      waited.current = false;
      livePhase.current = null;
      sprintSeenRef.current = null;
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
          // Not once turned away: the refusal screen has its own wrong-code sentence.
          if (msg.error === "bad_code" && waited.current && !removed.current) {
            setBadCode(true);
            break;
          }
          const refused = joinRejection(msg.error, msg.detail, !!sentPassword.current, joined.current);
          if (msg.error === "team_removed") removed.current = true;
          if (refused) setRejected(refused);
          else if (msg.detail === "no_hint") setNoHintQid(lastGame.current?.question?.id ?? null);
          break;
        }
        case "TEAM_CLAIMED":
          // The host handed us this team: be it from now on, and JOIN as it (its key skips the password and name checks).
          claimed.current = true;
          // A phone the host turned away (不收, 移除) is this team now: its reconnects must JOIN again.
          removed.current = false;
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
          sprintSeenRef.current = false;
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
          {
            const s = sprintSeen(sprintSeenRef.current, msg.view);
            sprintSeenRef.current = s.seen;
            if (s.play && msg.view.sprint!.teamIds.includes(getOrCreateTeamId())) {
              setSprintCard(true);
              navigator.vibrate?.(80);
            }
          }
          if ([...msg.view.teams, ...(msg.late?.teams ?? [])].some((t) => t.id === getOrCreateTeamId())) joined.current = true;
          if (msg.late?.teams.some((t) => t.id === getOrCreateTeamId())) waited.current = true;
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
  // A fortune holds it as well, from the crystal ball to the card (fortune-teller.md).
  const held = !!revealed || !!eventRevealed || !!game?.fortune;
  // The dish line waits for the big screen's cooking (cooking I10); a phone opened after it shows it at once.
  const cookStep = useCookStep(revealed?.dish && revealed.served ? `${game!.eventId}` : null);
  const roster = game?.view.teams ?? lobby ?? [];
  const myIndex = Math.max(0, roster.findIndex((t) => t.id === teamId));
  const myTeam = game?.view.teams.find((t) => t.id === teamId);
  const turn = game ? describeTurn(game.view, game.question, game.phaseCard?.monster) : null;
  const isMyTurn = !!game && game.view.currentTurnTeamId === teamId;
  const potion = game ? potionLine(myTeam, isMyTurn) : null;
  const [reactSent, setReactSent] = useState<ReactSent | null>(null);
  const finished = game?.phase === "finished";
  /** A buzzer boss phase (docs/designs/boss-buzzer.md): one big 搶答 button, answers spoken aloud. */
  const buzz = !finished && !game?.phaseCard ? game?.view.buzz : undefined;
  /** The how-to-play page on the big screen: the phone points there and never repeats the rules (D7). */
  const intro = !finished ? (game?.intro?.page ?? null) : null;
  /** 擲先攻 (lib/initiative.ts): the phone rolls here, the big screen shows every team's die. */
  const initiative = !finished ? (game?.initiative ?? null) : null;
  const myRoll = initiative && teamId ? initiative.rolls[teamId] : undefined;
  const cards = (
    <>
      {/* While waiting, the roster above already highlights our own team. */}
      {game && (
        <Panel tone={isMyTurn && !initiative ? "turn" : "cream"} className="flex items-center gap-3 px-3 py-[10px]">
          <Sprite kind="hero" variant={myIndex} scale={3} className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px]">{myTeam?.name ?? teamName}</div>
            {myTeam?.classId && (
              <div className="text-[15px]">
                {CLASS_ICONS[myTeam.classId]} {CLASS_LABELS[myTeam.classId]}・{myTeam.classId === "chef" ? "被動" : `剩 ${myTeam.abilityUses} 次`}
              </div>
            )}
            {myTeam?.boon && <div data-testid="phone-boon" className="text-[15px]">{BOON_TEXT[myTeam.boon]}</div>}
            {potion && (
              <div data-testid="phone-potion" className="text-[15px]" style={potion.drunk ? { background: "var(--lav)" } : undefined}>
                {potion.text}
              </div>
            )}
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
          {/* 每題作答倒數 (answer-countdown.md D5): only the turn's own phone, and silent. */}
          {isMyTurn && typeof game.answerClock?.left === "number" && <AnswerClock key={`${game.eventId}:${game.answerClock.left}`} ms={game.answerClock.left} variant="chip" />}
        </Panel>
      )}

      {game && !finished && !held && !intro && !initiative && turn?.team && !turn.team.fork && !game.forkBeat && (
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
            {/* Mid-game every refusal keeps the code input (team-handoff.md): a replacement phone that types its team's own
                name, or finds the room full, is refused before it could wait (late-join.md L12). */}
            {(rejected.handoff || game) && <HandoffForm send={send} />}
            <a href={`/?code=${code}`} className="text-[16px] underline underline-offset-2">{rejected.link === "password" ? "回首頁輸入密碼" : "回首頁"}</a>
          </Panel>
        </div>
      </main>
    );
  }

  // Joined after the start (docs/designs/late-join.md): nothing of the running game shows until the host lets us in.
  const waiting = game?.late?.teams.find((t) => t.id === teamId);
  if (game && waiting) {
    const closed = !!game.late!.closed;
    return (
      <main className="relative min-h-screen overflow-hidden">
        <SceneBackground theme="stone" cols={48} rows={100} arch={false} className="fixed inset-0" />
        <div className="relative z-10 flex min-h-screen flex-col gap-4 px-[14px] pb-4 pt-5">
          {disconnected && !rested && (
            <Panel tone="turn" role="status" className="px-3 py-2 text-center text-[16px]">
              {DISCONNECTED_NOTICE}
            </Panel>
          )}
          <div data-testid="late-wait">
            <Panel tone="lav" role="status" className="px-4 py-5 text-center">
              <div className="text-[20px]">{closed ? "這場快結束了，等下一場" : "等主持人讓你們加入…"}</div>
              <div className="mt-2 text-[15px]">{closed ? `下一場開始前，${waiting.name}會自動進大廳。` : `${waiting.name}會從第一間房開始，排在最後一個。可以先選職業。`}</div>
            </Panel>
          </div>
          <ClassPicker current={waiting.classId} send={send} />
          {/* A phone that only wants to take a team over still can (docs/designs/team-handoff.md). */}
          <Panel className="px-4 py-3">
            {badCode && <div role="alert" className="mb-2 text-[16px]" style={{ color: "var(--danger)" }}>配對碼不對或過期了，請主持人再按一次</div>}
            <HandoffForm
              send={(m) => {
                setBadCode(false);
                send(m);
              }}
            />
          </Panel>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <SceneBackground theme={turn?.theme ?? "stone"} cols={48} rows={100} arch={false} className="fixed inset-0" />

      {sprintCard && (
        // Covers for 3 s and takes no input (last-sprint.md D2).
        <div data-testid="sprint-card" className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center px-6">
          <Panel tone="turn" role="status" className="px-5 py-5 text-center">
            <div className="text-[24px]">✨ 你們拿到祝福！</div>
            <div className="mt-2 text-[14px]">魔王門開了：下次答對多一半</div>
          </Panel>
        </div>
      )}
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

        {initiative && (
          // Panel takes no data-testid, so the wrapper carries it.
          <div data-testid="phone-initiative">
            <Panel tone="lav" role="status" className="flex flex-col items-center gap-2 px-3 py-5 text-center">
              {myRoll === undefined ? (
                <>
                  <div className="text-[20px]">擲先攻！點數大的先上場</div>
                  <PixelButton variant="ok" className="!m-0 !min-h-[72px] !text-[23px]" onClick={() => send({ type: "TEAM_ROLL_INITIATIVE" })}>
                    🎲 擲骰
                  </PixelButton>
                </>
              ) : (
                <>
                  <D20 value={myRoll} size={90} />
                  <div className="text-[18px]">
                    {initiative.order?.includes(teamId!) ? `你們擲出 ${myRoll}，第${ordinal(initiative.order.indexOf(teamId!) + 1)}個上場` : `你們擲出 ${myRoll}，看大螢幕 👀`}
                  </div>
                </>
              )}
            </Panel>
          </div>
        )}

        {game && !finished && !intro && !initiative && turn && (
          <TurnRibbon color={isMyTurn ? undefined : "#6ab4ff"}>
            {buzz ? (turn.team ? `${turn.team.name}搶到了！` : "搶答時間！") : isMyTurn ? (eventRevealed ? "下一個是我們！" : "輪到我們了！") : `輪到：${turn.team?.name ?? "…"}`}
          </TurnRibbon>
        )}

        {/* The boss's phase card, as the big screen shows it (docs/designs/boss-phases.md D4): the new rule
            reaches the back of the room too. The next question waits for the host's 下一題. */}
        {game && !finished && game.phaseCard && game.bossPhaseInfo && (
          <div data-testid="phone-phase-card">
            <Panel tone="lav" role="status" className="flex flex-col items-center gap-2 px-3 py-[14px] text-center">
              <LabelChip>還沒結束！</LabelChip>
              <div className="px-title-danger px-title-sm text-[24px]">第{ordinal(game.view.bossPhase)}階段：{game.bossPhaseInfo.name}</div>
              <div className="text-[18px]">{game.bossPhaseInfo.rule}</div>
            </Panel>
          </div>
        )}

        {/* From phase 2 on, a boss turn keeps the phase's rule in view (D5). */}
        {game && !finished && !game.phaseCard && (turn?.inBoss || buzz) && game.bossPhaseInfo && (
          <div data-testid="phone-phase-rule">
            <Panel tone="turn" className="px-3 py-[6px] text-[16px]">
              {game.bossPhaseInfo.name}：{game.bossPhaseInfo.rule}
            </Panel>
          </div>
        )}

        {/* 叉路 (branch-fork.md): a door opening first, then a ❓ outcome, then the doors, so a beat never shows live buttons. */}
        {game && !finished && !intro && game.fortune ? (
          <FortunePanel game={game} teamId={teamId} send={send} />
        ) : game && !finished && !intro && (game.forkBeat || (!eventRevealed && !revealed && !game.phaseCard && !game.phaseCardDue && turn?.team?.fork === "choosing")) ? (
          <ForkPanel game={game} teamId={teamId} send={send} />
        ) : game && !finished && !intro && eventRevealed ? (
          <EventPanel reveal={eventRevealed} game={game} teamId={teamId} />
        ) : null}

        {/* D2: on our own multipleChoice turn the options come first, right under the ribbon. */}
        {/* 記憶題 (memory-questions.md): while its media plays the question is hidden and nobody answers yet. The image
            stays off the phone too: a screenshot would beat the memory test. */}
        {game && !finished && !held && game.question?.memorize && (
          <div data-testid="play-memorize">
            <Panel tone="lav" role="status" className="flex flex-col items-center gap-1 px-3 py-[14px] text-center">
              <LabelChip>🧠 記憶題</LabelChip>
              <div className="text-[22px]">{memoryPhoneHint(game.question)}，記住內容</div>
              {(isMyTurn || buzz) && <div className="text-[16px]">題目等一下才出來，還不能作答</div>}
            </Panel>
          </div>
        )}

        {game && buzz && !held && game.question && !game.question.memorize && <BuzzButton game={game} buzz={buzz} teamId={teamId} send={send} />}

        {game && buzz && !held && buzz.teamId === teamId && game.question && (
          <TextAnswerPanel key={`${game.question.id}:${game.eventId}`} game={game} teamId={teamId} send={send} offline={disconnected} noHint buzzed />
        )}

        {game && buzz?.picker === teamId && game.buzzCategories && <CategoryPanel categories={game.buzzCategories} chosen={buzz.category} send={send} />}

        {game && !finished && !buzz && !held && isMyTurn && !game.question?.memorize && (game.question?.options || game.question?.items) && <MyChoicePanel game={game} teamId={teamId} send={send} />}

        {/* #104: our own host-judged text turn is a fill-in: the team types its answer for the host. */}
        {game && !finished && !buzz && !held && isMyTurn && game.question && !game.question.memorize && !game.question.options && !game.question.items && (
          <TextAnswerPanel key={`${game.question.id}:${game.eventId}:${game.question.checkFirst ? "check" : "q"}`} game={game} teamId={teamId} send={send} offline={disconnected} noHint={noHintQid === game.question.id} />
        )}

        {/* 🔮 under 送出 on our own turn; the open catch for everyone (anti-ai-cheating.md). */}
        {game && !finished && !buzz && !held && isMyTurn && <AntiCheatPanel game={game} teamId={teamId} isMyTurn send={send} />}

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
        {game && !finished && !held && game.question?.content.kind === "youtube" && !game.question.memorize && (
          <div data-testid="play-media-hint" className="self-start border-[3px] border-[var(--k)] bg-[var(--lav)] px-3 py-1 text-[18px]">
            {game.question.content.audioOnly ? "🎵 聽大螢幕" : "▶ 看大螢幕"}
          </div>
        )}

        {game && !finished && !held && game.question && game.question.content.kind === "image" && !game.question.memorize && (
          <Panel className="flex justify-center px-3 py-3">
            {/* key tied to the question forces a fresh DOM node per question — without it, React
                would reuse the same node across consecutive media questions and a broken image
                (or a stale video) would stay hidden/showing for every question after it
                (adversarial review finding, carried forward from image-question-type.md). */}
            <QuestionMedia key={game.question.id} content={game.question.content} maxWidth={280} maxHeight={200} />
          </Panel>
        )}

        {isMyTurn && cards}

        {/* The game over card takes its place: the last question's answer is old news by then. */}
        {game && revealed && !finished && (
          <Panel tone="turn" className="flex flex-col items-center gap-2 px-3 py-3 text-center">
            {/* Won before its question was shown (a persuasion 20, or judged before the roll): the question comes with its answer. */}
            {revealed.asked && (revealed.asked.content.kind === "text" ? revealed.asked.content.value : revealed.asked.prompt) && (
              <div data-testid="phone-reveal-question" className="text-[18px] [overflow-wrap:anywhere]">{revealed.asked.content.kind === "text" ? revealed.asked.content.value : revealed.asked.prompt}</div>
            )}
            {revealed.asked?.content.kind === "image" && <QuestionMedia key={`asked-${revealed.questionId}`} content={revealed.asked.content} maxWidth={260} maxHeight={180} />}
            <div className="text-[18px]">正解：{revealed.answer}</div>
            {revealed.explanation && revealed.explanation.kind === "text" && (
              <div className="text-[16px]">{revealed.explanation.value}</div>
            )}
            {/* Its shortcode never reaches a phone (instagram-explanations.md). */}
            {(revealed.explanation?.kind === "instagram" || revealed.explanation?.kind === "file") && <div data-testid="play-instagram-hint" className="text-[16px]">▶ 詳解請看大螢幕</div>}
            {revealed.explanation && revealed.explanation.kind !== "text" && revealed.explanation.kind !== "instagram" && revealed.explanation.kind !== "file" && (
              // key tied to questionId — same broken-image-stays-hidden-forever guard every
              // other media render site in this diff carries (adversarial review finding, /ship).
              <QuestionMedia key={revealed.questionId} content={revealed.explanation} label="詳解" maxWidth={260} maxHeight={180} zhCaptions />
            )}
            {dishUp(cookStep) && revealed.dish && <div data-testid="phone-dish" className="text-[18px]">🍲 今晚的菜：{revealed.dish.name}</div>}
          </Panel>
        )}

        {finished && game && <FinishedPanel place={teamPlace(game.view.teams, game.podium?.ranking, teamId)} reward={myTeam?.reward ?? 0} cuisine={game.cuisine} finale={finale} podium={game.podium} onPodium={setPodium} />}

        <div className="mt-auto">
          {/* Waiting teams only: never on our own turn, nor in a buzzer phase where every team is answering; and only
              while connected, since a tap sent offline reaches the room before the phone has rejoined its team. */}
          {/* 🚨 抓包 for a waiting team, above its reactions (anti-ai-cheating.md). */}
          {game && !finished && !isMyTurn && !held && !intro && !initiative && !disconnected && !unreachable && !rested && <AntiCheatPanel game={game} teamId={teamId} isMyTurn={false} send={send} />}
          {game && !finished && !isMyTurn && !game.view.buzz && !intro && !initiative && !disconnected && !unreachable && !rested && <ReactBar send={send} sent={reactSent} setSent={setReactSent} />}
          <DialogueBox
            compact
            // The intro narrates nothing: after a replay eventId is past the last narration, so it must not spin.
            loading={!!game && !finished && intro === null && !initiative && isPending(game.eventId, narration)}
            lines={
              finished
                ? epilogue && podium
                  ? [epilogue]
                  : narration
                    ? narration.lines
                    : ["冒險結束了，大螢幕正在頒獎。"]
                : intro !== null || initiative
                  ? [initiative ? "擲完先攻，輪到你們時這裡會出現題目" : "說明結束後，輪到你們時這裡會出現題目"]
                  : narration
                  ? narration.lines
                  : [turn?.team ? `輪到${turn.team.name}了，${turn.monster.name}擋在前面……` : "火光搖曳，冒險者們正在集合……"]
            }
            // A host edit of this narration reads on from the edited line instead of starting over (D13).
            id={narration && intro === null && !initiative && !(finished && epilogue && podium) ? narration.eventId : undefined}
          />
        </div>
      </div>
    </main>
  );
}

/** ❓ 神秘房's outcome on a phone (event-rooms.md D10, branch-fork.md): the team reads what it got; every other phone looks up. */
function EventPanel({ reveal, game, teamId }: { reveal: EventReveal; game: StateMessage; teamId: string }) {
  const team = game.view.teams.find((t) => t.id === reveal.teamId);
  if (!team) return null;
  if (team.id !== teamId) {
    return (
      <Panel className="px-3 py-[10px] text-[17px]">
        <span data-testid="phone-event-watch">{team.name}打開了神秘房……看大螢幕 📺</span>
      </Panel>
    );
  }
  return (
    <div data-testid="phone-event-result" className="flex flex-col gap-3">
      <Panel className="flex flex-col items-center gap-1 px-3 py-[12px] text-center">
        <LabelChip>❓ 神秘房</LabelChip>
        <div className="px-title-gold px-title-sm text-[26px]">{EVENT_OUTCOME_TITLE[reveal.outcome]}</div>
        <div className="text-[18px]">{reveal.dish ? `${reveal.dish.name}！` : ""}{eventEffectLine({ ...reveal, chefBonus: undefined })}</div>
        {reveal.chefBonus ? <div className="text-[15px]">（廚師 +{reveal.chefBonus}）</div> : null}
      </Panel>
      <Panel className="px-3 py-[10px] text-[16px]">看大螢幕 📺　主持人按「下一題」後，我們{reveal.entersBoss ? "走進首領房" : "走到下一間房"}</Panel>
    </div>
  );
}

/** 占卜師 on a phone (fortune-teller.md): the drawing team gets the condition, the clock and a button an effect, locked
 * under the crystal ball and once pressed; every other phone is told to watch the big screen. After the reveal a team the
 * condition hit reads what it got. */
function FortunePanel({ game, teamId, send }: { game: StateMessage; teamId: string; send: (msg: ClientMessage) => void }) {
  const fortune = game.fortune!;
  const team = game.view.teams.find((t) => t.id === fortune.teamId);
  const [pressed, setPressed] = useState<number | null>(null);
  useEffect(() => {
    if (pressed === null) return;
    const t = setTimeout(() => setPressed(null), 5000);
    return () => clearTimeout(t);
  }, [pressed]);
  if (!team) return null;
  if (fortune.step === "card" && fortune.effect) {
    const fx = FORTUNE_EFFECT_TEXT[fortune.effect];
    const hit = !!fortune.matchIds?.includes(teamId);
    return (
      <Panel className="flex flex-col items-center gap-1 px-3 py-[12px] text-center text-[18px]">
        <LabelChip>🔮 占卜師</LabelChip>
        <span data-testid="phone-fortune-result">{hit ? `你們中了：${fx.icon} ${fx.name}` : `${fx.icon} ${fx.name}，你們沒中`}</span>
        {hit && <span className="text-[15px]">{fx.line}</span>}
        <span className="text-[15px]">看大螢幕 📺　主持人按「下一題」後繼續</span>
      </Panel>
    );
  }
  if (team.id !== teamId || fortune.step === "beat") {
    return (
      <Panel className="px-3 py-[10px] text-[17px]">
        <span data-testid="phone-fortune-watch">{fortune.step === "beat" ? "命運揭曉中……看大螢幕 📺" : `${team.name} 正在決定命運… 是不是你？看大螢幕 📺`}</span>
      </Panel>
    );
  }
  const locked = fortune.step !== "choose" || pressed === game.eventId;
  return (
    <>
      <Panel className="flex flex-col gap-1 px-3 py-[10px] text-[18px]">
        <div className="flex items-center justify-between">
          <span>🔮 占卜師：{FORTUNE_CONDITION_TEXT[fortune.condition].text}</span>
          {typeof game.fortuneLeft === "number" && fortune.step === "choose" ? <AnswerClock key={game.fortuneLeft} ms={game.fortuneLeft} variant="chip" /> : null}
        </div>
        <span className="text-[15px]">可能包括你自己！挑一個命運；時間到會隨機選一個</span>
      </Panel>
      <div data-testid="phone-fortune" className="sticky bottom-2 z-30 grid grid-cols-2 gap-2">
        {FORTUNE_EFFECTS.map((e) => (
          <PixelButton
            key={e}
            data-testid={`phone-fortune-${e}`}
            disabled={locked}
            variant={FORTUNE_EFFECT_TEXT[e].tone === "bad" ? "flee" : FORTUNE_EFFECT_TEXT[e].tone === "good" ? "ok" : "retry"}
            onClick={() => {
              setPressed(game.eventId);
              send({ type: "TEAM_CHOOSE_FORTUNE", effect: e, eventId: game.eventId });
            }}
            className="!m-0 flex min-h-[64px] flex-col items-center justify-center text-[18px]"
          >
            <span>{FORTUNE_EFFECT_TEXT[e].icon} {FORTUNE_EFFECT_TEXT[e].name}</span>
            <span className="text-[12px]">{FORTUNE_EFFECT_TEXT[e].line}</span>
          </PixelButton>
        ))}
      </div>
    </>
  );
}

/** 叉路 on a phone (branch-fork.md): the team on turn gets two big unmarked doors, 左門 and 右門, pinned to the bottom of
 * the screen so nothing pushes them away; a door opening locks them and names only the opened one. Every other phone reads that the team is at a fork. */
function ForkPanel({ game, teamId, send }: { game: StateMessage; teamId: string; send: (msg: ClientMessage) => void }) {
  const beat = game.forkBeat;
  const team = game.view.teams.find((t) => t.id === (beat ? beat.teamId : game.view.currentTurnTeamId));
  // A press waiting for the room, keyed to the eventId; a refused one gives the doors back.
  const [pressed, setPressed] = useState<number | null>(null);
  useEffect(() => {
    if (pressed === null) return;
    const t = setTimeout(() => setPressed(null), 5000);
    return () => clearTimeout(t);
  }, [pressed]);
  if (!team) return null;
  if (team.id !== teamId) {
    return (
      <Panel className="px-3 py-[10px] text-[17px]">
        <span data-testid="phone-fork-watch">{beat ? `${team.name}推開了門……看大螢幕 📺` : `${team.name}在叉路口猶豫中……看大螢幕 📺`}</span>
      </Panel>
    );
  }
  const locked = !!beat || pressed === game.eventId;
  return (
    <>
      <Panel className="flex items-center justify-between px-3 py-[10px] text-[20px]">
        <span>🔀 叉路！走哪一扇門？</span>
        {beat?.timeout ? <span className="px-chip">⏳ 時間到</span> : typeof game.forkLeft === "number" && !beat ? <AnswerClock key={game.forkLeft} ms={game.forkLeft} variant="chip" /> : null}
      </Panel>
      {/* Sticky, so the doors stay in view however long the page gets (TODOS: the old event panel was pushed off screen). */}
      <div data-testid="phone-fork" className="sticky bottom-2 z-30 flex gap-3">
        {(["left", "right"] as const).map((side) => (
          <PixelButton
            key={side}
            data-testid={`phone-fork-${side}`}
            disabled={locked}
            onClick={() => {
              setPressed(game.eventId);
              send({ type: "TEAM_CHOOSE_FORK", side, eventId: game.eventId });
            }}
            className="!m-0 min-h-[72px] flex-1 text-[24px]"
            // The picked door stays bright during the opening and shows what was behind it; the other is never told.
            style={beat ? { opacity: beat.side === side ? 1 : 0.35 } : undefined}
          >{beat?.side === side ? FORK_DOOR_LABEL[beat.door] : FORK_SIDE_LABEL[side]}</PixelButton>
        ))}
      </div>
    </>
  );
}
