"use client";

// The shared big screen. Public: it only ever receives the spectator view and
// never a host-only message, so it can be cast to a TV without leaking answers.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { useRoomSocket } from "@/lib/use-room-socket";
import { useWakeLock } from "@/lib/use-wake-lock";
import { DISCONNECTED_NOTICE, UNREACHABLE_NOTICE, UNREACHABLE_RETRY_LABEL } from "@/lib/offline-notice";
import { REACTIONS, REACT_ROOM_MAX, type AnswerReveal, type EventReveal, type LobbyTeams, type MediaCommand, type PendingRoll, type PodiumReveal, type PublicMediaContent, type PublicQuestion, type Reaction, type SoundCue, type StateMessage } from "@/lib/protocol";
import { epiloguePages, revealNow, unemoji, type Beat } from "@/lib/podium";
import { checkKey, type LockedOption, type SpectatorView, type WrongAnswer } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { describeTurn, monsterLook, PHASE_HUE_STEP, roomTheme } from "@/lib/turn-info";
import { ordinal } from "@/lib/ordinal";
import { firstChange, isPending, keepLatest, readCount, type NarrationState } from "@/lib/narration/client";
import { pickVoice, shouldSpeakNarration, speechTimeoutMs, type SpokenNarration } from "@/lib/narration/tts";
import { createBgmPlayer, type BgmPlayer } from "@/lib/bgm-player";
import { ANSWER_TICK, ANSWER_TIME_UP, BOSS_ALARM, EAT_DONE, SFX, SPRINT_FANFARE } from "@/lib/sfx";
import { AnswerClock } from "@/components/answer-clock";
import { ANSWER_WARN_SECONDS } from "@/lib/answer-clock";
import { IN_LOBBY, nextTransition, UNSEEN, type Transition } from "@/lib/transitions";
import { TransitionOverlay } from "@/components/transition-overlay";
import { DialogueBox, LabelChip, Nameplate, Panel, PixelButton, prefersReducedMotion, QuestionMedia, SceneBackground, Sprite, TurnRibbon } from "@/components/pixel";
import { MapStrip } from "@/components/map-strip";
import { McOption, optionLetter, type OptionLook } from "@/components/mc-option";
import { Qr } from "@/components/qr";
import { Stage } from "@/components/stage";
import { InitiativeOverlay, KillRollOverlay, RollOverlay, TieRollOverlay } from "@/components/d20";
import { MageHint } from "@/components/mage-hint";
import { YoutubePlayer } from "@/components/youtube-player";
import { HowToPlay, INTRO_PAGE_TEXT } from "@/components/how-to-play";
import { CookFrame, dishLine, DishOnStage, dishUp, useCookStep, useFinaleStep, useRevealTime } from "@/components/cooking";
import { readStored, writeStored } from "@/lib/stored";
import { sortOrderOf } from "@/lib/sort-order";
import { EventStage } from "@/components/event-room";
import { BOON_TEXT, EVENT_OUTCOME_TITLE, EVENT_SCENE_TEXT, eventEffectLine } from "@/lib/event-text";

const TTS_ENABLED_STORAGE = "screen-tts-enabled";
const BGM_ENABLED_STORAGE = "screen-bgm-enabled";
const bgmSupported = () => "AudioContext" in window;

/** True only in a browser that actually implements the Web Speech API — the toggle button
 * doesn't render at all otherwise (a rendered-but-disabled button implies the feature could
 * work here if only the user did something, which isn't true). */
const ttsSupported = () => "speechSynthesis" in window;
/** Browser support never changes while the page is open, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};


const look = (i: number) => TEAM_LOOKS[i % TEAM_LOOKS.length];

function Torches() {
  return (
    <>
      <div className="px-glow px-tf1" style={{ left: -40, bottom: 120 }} />
      <div className="px-glow" style={{ right: -40, bottom: 120 }} />
      {(["left", "right"] as const).map((side) => (
        <div key={side} className="absolute" style={{ [side]: 66, bottom: 176, width: 54, height: 84, zIndex: 3 }}>
          <Sprite kind="torch" variant={0} scale={6} className="px-tf1 absolute inset-0" />
          <Sprite kind="torch" variant={1} scale={6} className="px-tf2 absolute inset-0" />
        </div>
      ))}
    </>
  );
}

function Sparks() {
  return (
    <>
      {[[310, 300, 0], [640, 330, -1], [200, 360, -2], [760, 290, -0.5]].map(([x, y, d]) => (
        <i key={x} className="px-spark" style={{ left: x, top: y, animationDelay: `${d}s`, zIndex: 3 }} />
      ))}
    </>
  );
}

function Lobby({ code, teams }: { code: string; teams: LobbyTeams }) {
  const joinUrl = typeof location === "undefined" ? "" : `${location.origin}/?code=${code}`;
  return (
    <>
      <SceneBackground theme="stone" />
      <Torches />
      <Sparks />
      <div className="absolute inset-x-0 text-center" style={{ top: 34, zIndex: 5 }}>
        <div className="text-[22px] text-white" style={{ textShadow: "2px 2px 0 var(--k)" }}>
          冒險者集合！輸入房間代碼，或掃描 QR
        </div>
      </div>
      <Panel className="absolute flex items-center gap-8" style={{ left: 190, right: 190, top: 84, padding: "10px 30px", zIndex: 5 }}>
        <div className="flex-1 text-center">
          <div className="text-[18px]">房間代碼</div>
          <div className="px-num" style={{ fontSize: 56, letterSpacing: "0.2em", color: "var(--danger)", textShadow: "3px 3px 0 var(--k)" }}>
            {code}
          </div>
        </div>
        <Qr text={joinUrl} size={132} />
      </Panel>
      {/* The campfire (design review 2A), with the teams gathering around it: first half on the left,
          the rest on the right, high enough that no nameplate sits under the dialogue box's 地城主 tag. At
          5+ teams each side stacks in two rows, so 8 names still fit. */}
      <div className="absolute inset-x-0 flex items-end justify-center" style={{ bottom: 136, zIndex: 4, gap: 18 }}>
        <TeamGroup teams={teams} from={0} to={Math.ceil(teams.length / 2)} align="end" />
        <div className="relative shrink-0" style={{ width: 26 * 5, height: 22 * 5 }}>
          <div className="px-glow px-tf1" style={{ left: 65 - 150, top: 40 - 150 }} />
          <Sprite kind="campfire" variant={0} scale={5} className="px-tf1 absolute inset-0" />
          <Sprite kind="campfire" variant={1} scale={5} className="px-tf2 absolute inset-0" />
        </div>
        <TeamGroup teams={teams} from={Math.ceil(teams.length / 2)} to={teams.length} align="start" />
      </div>
      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        lines={[teams.length === 0 ? "篝火燒得正旺，等待第一支隊伍加入……" : `${teams.length} 支隊伍已就位，等主持人宣布開始！`]}
      />
    </>
  );
}

/** One side of the campfire: teams[from, to), each running in. `variant` stays the team's overall
 * index so its look matches the rest of the game. */
function TeamGroup({ teams, from, to, align }: { teams: LobbyTeams; from: number; to: number; align: "start" | "end" }) {
  const crowded = teams.length > 4;
  // Two rows of two cells per side when crowded: a cell's nameplate fits about 8 CJK characters, and a
  // longer name ends in "…" (names are capped at 20). Up to 4 teams, two cells of 132 fit a side inside the torches (a side is 397 wide, the torch ends at x 120).
  const cell = crowded ? 190 : 132;
  return (
    <div
      className={`flex flex-1 flex-wrap items-end gap-x-2 gap-y-1 ${align === "end" ? "justify-end" : "justify-start"}`}
      style={crowded ? { maxWidth: cell * 2 + 8 } : undefined}
    >
      {teams.slice(from, to).map((t, j) => (
        // Crowded: the hero stands beside its nameplate, so two rows clear the room-code panel above.
        <div key={t.id} className={`flex items-center gap-1 ${crowded ? "flex-row" : "flex-col"}`} style={{ width: crowded ? cell : undefined, maxWidth: cell }}>
          <div className="px-run">
            <Sprite kind="hero" variant={from + j} scale={crowded ? 2 : 4} />
          </div>
          <Nameplate className="min-w-0 text-[14px]" style={{ maxWidth: cell, padding: "3px 8px" }}>
            {/* text-overflow needs a block box: the Nameplate itself is a flex container. */}
            <span className="block min-w-0 truncate">{t.name}</span>
          </Nameplate>
        </div>
      ))}
    </div>
  );
}

/** D1: A and C on the wall left of the monster, B and D on the right (960x540 stage). */
// Rows start below a two-line question box (it ends near y 232) and end above the dialogue box.
const TILE_SPOTS = [
  { left: 22, top: 246 },
  { left: 622, top: 246 },
  { left: 22, top: 320 },
  { left: 622, top: 320 },
];

/**
 * The option tiles on the wall (docs/designs/phone-answering.md D1, D8, D9): plain while the team
 * thinks, 🔒 during the beat, the wrong pick red while the team decides, the answer green on a
 * correct reveal. Eliminated options are the grey ✕ 答錯 tile; a mage's removal (`magic`) is grey with no label (D13=A).
 */
function WallOptions({ options, gone, magic, lock, wrong, correct, teamName }: { options: string[]; gone: number[]; magic: number[]; lock: LockedOption | null; wrong: WrongAnswer | null; correct: number | null; teamName: string }) {
  return (
    <>
      {options.slice(0, TILE_SPOTS.length).map((opt, i) => {
        let look: OptionLook = "plain";
        let label: string | undefined;
        if (correct !== null) [look, label] = i === correct ? ["ok", "✓ 正解"] : ["dim", undefined];
        else if (lock?.optionIndex === i) [look, label] = ["lock", `🔒 ${teamName}`];
        else if (wrong?.optionIndex === i) [look, label] = ["bad", `✕ ${teamName}答錯`];
        else if (gone.includes(i)) [look, label] = ["dim", magic.includes(i) ? undefined : "✕ 答錯"];
        return (
          <McOption
            key={i}
            index={i}
            text={opt}
            look={look}
            label={label}
            tabIndex={-1}
            data-testid={`wall-option-${i}`}
            data-look={look}
            className="wall absolute !text-[24px] leading-[1.05]"
            style={{ ...TILE_SPOTS[i], width: 316, height: 62, zIndex: 5 }}
          />
        );
      })}
    </>
  );
}

/** 觀眾反應 (docs/designs/audience-reactions.md): waiting teams' reactions float up behind everything on the stage
 * (z 2: above the wall, under the torches, tiles, panels and dialogue box), so they show only in the gaps and never
 * cover the question, the options or the countdown. Each climbs out from behind the option tiles in its lane and fades. */
type Float = { id: number; teamId: string; reaction: Reaction; x: number };
let floatSeq = 0;
const FLOAT_MS = 2400;
/** Two full rooms' worth: a second burst may start while the first is still climbing. */
const MAX_FLOATS = 2 * REACT_ROOM_MAX;
/** Where the wall shows on every scene: the gutters beside the question panel (x < 110, x > 850) and the arch's sides. */
const FLOAT_LANES = [24, 878, 352, 560, 64, 838];
function ReactionFloats({ floats, teams }: { floats: Float[]; teams: SpectatorView["teams"] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 2 }}>
      {floats.map((f) => (
        <div key={f.id} data-testid="reaction-float" className="px-react-rise absolute flex flex-col items-center" style={{ left: f.x, top: 120, filter: "drop-shadow(3px 3px 0 var(--k))" }}>
          <span className="text-[38px] leading-none">{REACTIONS[f.reaction].emoji}</span>
          <span className="max-w-[80px] truncate text-[13px] text-[var(--cream)]">{teams.find((t) => t.id === f.teamId)?.name ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

/** A sort question's tiles (no option index of their own): the items while the team thinks, then in the team's
 * locked order, its wrong order marked per place (only which places are right, never the answer, D5), or the answer. */
type SortTile = { text: string; look: OptionLook; label?: string };
function sortTiles(question: PublicQuestion | null, reveal: AnswerReveal | null, lock: LockedOption | null, wrong: WrongAnswer | null, wrongSlots: boolean[] | undefined): SortTile[] | null {
  if (reveal) return reveal.sorted ? reveal.sorted.items.map((text) => ({ text, look: "ok", label: "✓" })) : null;
  const items = question?.items;
  if (!items) return null;
  const inOrder = (code: number) => (sortOrderOf(code) ?? []).map((i) => items[i]);
  if (lock?.questionId === question.id) return inOrder(lock.optionIndex).map((text) => ({ text, look: "lock", label: "🔒" }));
  if (wrong?.questionId === question.id && wrong.optionIndex !== null && wrongSlots) {
    return inOrder(wrong.optionIndex).map((text, i) => (wrongSlots[i] ? { text, look: "ok", label: "✓" } : { text, look: "bad", label: "✕" }));
  }
  return items.map((text) => ({ text, look: "plain" }));
}

/** Numbered 1–4 like the phone's rows, before the lock too (the phone starts from the same order). */
function SortWall({ tiles }: { tiles: SortTile[] }) {
  return (
    <>
      {tiles.slice(0, TILE_SPOTS.length).map((t, i) => (
        <McOption
          key={i}
          index={i}
          badge={i + 1}
          text={t.text}
          look={t.look}
          label={t.label}
          tabIndex={-1}
          data-testid={`wall-sort-${i}`}
          data-look={t.look}
          className="wall absolute !text-[24px] leading-[1.05]"
          style={{ ...TILE_SPOTS[i], width: 316, height: 62, zIndex: 5 }}
        />
      ))}
    </>
  );
}

type YoutubeContent = Extract<PublicMediaContent, { kind: "youtube" }>;
/** A chip that stands in the side column beside a video (D14), at the same 20px as the hints. */
const CHIP = { fontSize: 20, padding: "4px 10px", color: "var(--k)", border: "4px solid var(--k)", whiteSpace: "normal", borderRadius: 12 } as const;

function Playing({ view, question, reveal, pendingLock, pendingRoll, wrongSlots, eventId, narration, phaseCard, bossPhaseInfo, media, needsTap, onVideoPlaying, onClipEnded, onClipError, clipError, answerLeft, onClockSecond, say, onRead, onEaten }: { view: SpectatorView; question: PublicQuestion | null; reveal: AnswerReveal | null; pendingLock: LockedOption | null; pendingRoll: PendingRoll | null; wrongSlots?: boolean[]; eventId: number; narration: NarrationState; phaseCard?: StateMessage["phaseCard"]; bossPhaseInfo?: StateMessage["bossPhaseInfo"]; media?: MediaCommand; needsTap: boolean; onVideoPlaying: (playing: boolean) => void; onClipEnded: (questionId: string) => void; onClipError: (questionId: string) => void; clipError?: true; answerLeft?: number | null; onClockSecond: (s: number) => void; say: (lines: string[]) => void; onRead: (eventId: number, count: number) => void; onEaten: () => void }) {
  const turnInfo = describeTurn(view, question, phaseCard?.monster);
  const { team: turn, teamIndex: turnIdx, inBoss, bossHits: hits } = turnInfo;
  // A dish reveal keeps the defeated monster and its room on stage until 下一題 (cooking I6): the next question is
  // already dealt, so describeTurn would show the next team's monster.
  const dish = reveal?.dish;
  const eaterIdx = dish ? view.teams.findIndex((t) => t.id === dish.teamId) : -1;
  const eater = view.teams[eaterIdx];
  const bossScene = dish ? dish.room === null : turnInfo.bossScene;
  const monster = dish ? monsterLook(dish.monster) : turnInfo.monster;
  const theme = dish ? roomTheme(dish.room) : turnInfo.theme;
  // A team removed mid-reveal still leaves its dish line, without the name.
  const line = dish ? dishLine(dish, eater?.name ?? "", false) : "";
  const cook = useCookStep(dish && reveal.served ? `${eventId}` : null, () => say(["上菜！"]), () => say([line]), eater ? onEaten : undefined); // no 嗝 when the eater's team has left (no one is shown eating)
  const served = cook !== null;
  // The phase card (docs/designs/boss-phases.md, approved mockup panel 1) takes the question's slot, as a reveal does.
  const card = phaseCard && bossPhaseInfo;
  const wrong = view.pendingWrong ?? null;
  const nameOf = (id?: string) => view.teams.find((t) => t.id === id)?.name ?? "";
  // A buzzer boss phase (docs/designs/boss-buzzer.md D7): who buzzed, who is out, or the call to buzz.
  const buzz = !reveal && !card && question ? view.buzz : undefined;
  const buzzBox = buzz && (
    <div data-testid="screen-buzz" className="flex flex-col items-center gap-2">
      <div className="px-chip" style={{ ...CHIP, fontSize: buzz.teamId ? 30 : 22, background: buzz.teamId ? "var(--turn)" : "var(--lav)" }}>
        {buzz.teamId ? `${nameOf(buzz.teamId)} 搶到了！` : question?.content.kind === "youtube" && !buzz.open ? "等主持人按 ▶" : "♪ 快搶！"}
      </div>
      {/* The category the last winner picked (boss-music-buzzer.md M5). */}
      {buzz.category && question?.content.kind === "youtube" && !buzz.open && !buzz.teamId && (
        <div data-testid="screen-buzz-category" className="px-chip" style={{ ...CHIP, fontSize: 20, background: "var(--warn)" }}>
          下一題：{buzz.category}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2 text-[18px]">
        {view.teams.filter((t) => t.online).map((t) => (
          <span key={t.id} className="px-chip" style={{ ...CHIP, fontSize: 18, background: t.id === buzz.teamId ? "var(--turn)" : buzz.out.includes(t.id) ? "#5a4a60" : "var(--lav)", color: buzz.out.includes(t.id) ? "#ccc" : "var(--k)", textDecoration: buzz.out.includes(t.id) ? "line-through" : undefined }}>
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
  // During a correct reveal the tiles are the answered question's (the next one is already dealt).
  const wall = served
    ? null
    : reveal?.choice
    ? { options: reveal.choice.options, correct: reveal.choice.correctIndex, team: nameOf(reveal.choice.teamId), gone: [] as number[], magic: [] as number[] }
    : !reveal && question?.options && question.options.length <= TILE_SPOTS.length
      ? { options: question.options, correct: null, team: nameOf(pendingLock?.teamId ?? wrong?.teamId), gone: view.eliminated?.[question.id] ?? [], magic: view.mageRemoved?.[question.id] ?? [] }
      : null;
  const sortWall = served ? null : sortTiles(question, reveal, pendingLock, wrong, wrongSlots);
  // Fixed lines, not an LLM call (D8, D9): nothing is narrated until the outcome is known.
  const held = buzz?.teamId
    ? `${nameOf(buzz.teamId)}搶到了！大聲說出答案！`
    : pendingRoll
    ? `${nameOf(pendingRoll.teamId)}擲出了骰子……`
    : pendingLock
    ? `${nameOf(pendingLock.teamId)}鎖定了 ${question?.items ? "順序" : optionLetter(pendingLock.optionIndex)}……`
    : wrong
      ? view.awaitingPrayer === wrong.teamId
        ? `${nameOf(wrong.teamId)}答錯了！牧師祈禱中……`
        : wrong.prayed
          ? `${nameOf(wrong.teamId)}祈禱了！這回合再答一次……`
          : inBoss
        ? `${nameOf(wrong.teamId)}答錯了！首領換一題……`
        : `${nameOf(wrong.teamId)}答錯了！他們正在決定：重答，還是逃跑……`
      : null;
  // Persuasion check (dnd design R6): a fill-in turn rolls before it answers; its record shows once the beat ends.
  const fillIn = !!question && !question.options && !question.items && !reveal && !card;
  const check = fillIn && turn ? view.checks?.[checkKey(question!.id, turn.id)] : undefined;
  // The narration keeps the last outcome; the DC sign carries the waiting line instead.
  const awaitingCheck = fillIn && !check && !pendingRoll && !wrong;
  const stars = question ? "★".repeat(question.difficulty) + "☆".repeat(Math.max(0, 5 - question.difficulty)) : "";
  // A YouTube question, or the reveal showing the answered question's video where it stopped (D17). One slot, one
  // key, so the player is not rebuilt between the question and its reveal.
  const asking = !reveal && !card && question?.content.kind === "youtube";
  const video: { id: string; content: YoutubeContent } | null = reveal?.video
    ? { id: reveal.questionId, content: reveal.video }
    : asking
      ? { id: question!.id, content: question!.content as YoutubeContent }
      : null;
  const sneakChip = turn?.sneakArmed && !reveal && !card;
  // A buzzer phase has no persuasion check (boss-buzzer.md D6).
  const dcChip = fillIn && !buzz && !turn?.sneakArmed ? turn?.checkTarget : undefined;
  // On a YouTube question the chips, hints and typed answer stand beside the video, not over it (D14).
  const beside = (
    <>
      {buzzBox}
      {sneakChip && (
        <div className="px-chip" style={{ ...CHIP, background: "#ff8787" }}>
          🗝️ 偷襲！這題答對加碼
        </div>
      )}
      {dcChip && (
        <div data-testid="screen-check-dc" className="px-chip" style={{ ...CHIP, background: "var(--warn)" }}>
          🗣️ 說服 DC {dcChip.dc}（+{dcChip.bonus}）{awaitingCheck && `　${turn!.name}：按手機上的「擲骰說服」`}
        </div>
      )}
      {question && <MageHint hint={view.mageHints?.[question.id]} sort={!!question.items} testId="screen-mage-hint" className="block w-fit px-3 py-1 text-[20px]" />}
      {check?.hint !== undefined && <MageHint hint={check.hint} testId="screen-check-hint" className="block w-fit px-3 py-1 text-[20px]" />}
      {/* A buzzer phase's typed answer is for the host only (boss-music-buzzer.md M2): the others could still buzz. */}
      {turn?.typedAnswer && !buzz && (
        <div data-testid="screen-typed-answer" className="text-[20px] [overflow-wrap:anywhere]">
          ⚔️ {turn.name}：{turn.typedAnswer}
        </div>
      )}
    </>
  );
  const lone = !!reveal && reveal.explanation?.kind !== "text";
  const mediaExplanation = reveal?.explanation && reveal.explanation.kind !== "text" ? reveal.explanation : null;

  return (
    <>
      <SceneBackground theme={theme} />
      {/* D1: the tiles stand where the torches hang. */}
      {!wall && !sortWall && <Torches />}
      <Sparks />
      {wall && <WallOptions options={wall.options} gone={wall.gone} magic={wall.magic} lock={pendingLock} wrong={wrong} correct={wall.correct} teamName={wall.team} />}
      {sortWall && <SortWall tiles={sortWall} />}

      <div className="absolute flex items-start gap-3" style={{ left: 18, right: 18, top: 24, zIndex: 6 }}>
        {dish && eater ? (
          <TurnRibbon color={look(eaterIdx).hat} maxWidth={420}>🍲 {eater.name}</TurnRibbon>
        ) : (
          buzz ? (
            <TurnRibbon color={turn ? look(turnIdx).hat : undefined} maxWidth={420}>{turn ? `${turn.name} 搶到了！` : "首領戰　搶答！"}</TurnRibbon>
          ) : (
            turn && <TurnRibbon color={look(turnIdx).hat} maxWidth={420 /* a 20-character name must leave the map its width (live map D8) */}>{inBoss ? "首領戰　" : ""}輪到：{turn.name}</TurnRibbon>
          )
        )}
        <MapStrip view={view} />
      </div>

      {/* 上菜 puts the panel away (cooking R4): the stage is the monster's, then the dish's. */}
      {/* The dish stands where the monster stood; its card takes the panel's place. */}
      {dishUp(cook) && dish && <DishOnStage dish={dish} cardTop={96} bottom={146} step={cook} eater={eaterIdx} />}
      {!served && (
      <Panel className="absolute text-center" style={{ left: 110, right: 110, top: 96, padding: "32px 24px 12px", fontSize: 30, lineHeight: 1.3, zIndex: 5 }}>
        <div className="absolute flex items-start justify-between text-[14px]" style={{ left: 16, right: 16, top: 6 }}>
          <LabelChip>{card ? "還沒結束！" : reveal ? "正解揭曉" : inBoss ? "首領題" : `難度 ${stars}`}</LabelChip>
          {/* From phase 2 on the chip names the phase under way (D5); phase 1 looks like any boss. */}
          {!reveal && !card && inBoss && <LabelChip>{bossPhaseInfo?.name ?? "最後的挑戰！"}</LabelChip>}
          {/* The buzz winner picked the next song's category (boss-music-buzzer.md M5). Up here: under the reveal's
              video the boss nameplate and the narrator box cover it. */}
          {reveal && !card && view.buzz?.category && (
            <span data-testid="screen-next-category" className="px-chip text-[20px] leading-none" style={{ background: "var(--warn)", color: "var(--k)" }}>
              下一題：{view.buzz.category}
            </span>
          )}
          {/* A curse or blessing waits on the team's next correct answer (event-rooms.md D12). */}
          {!reveal && !card && turn?.boon && <span data-testid="screen-boon"><LabelChip>{BOON_TEXT[turn.boon]}</LabelChip></span>}
          {/* 🧪 The team on turn holds a potion, or drank it on this question (lucky-potion.md D1, D8). */}
          {!reveal && !card && turn?.item && (
            <span data-testid="screen-potion">
              <LabelChip>{turn.itemArmed ? "🧪 已喝下！" : "🧪 有幸運藥水"}</LabelChip>
            </span>
          )}
        </div>
        {/* The reveal takes the question's own slot until the host presses 下一題 (D7), so the
            next question never shows underneath (or behind) the previous answer. */}
        {card ? (
          <div data-testid="phase-card" className="flex flex-col items-center gap-2">
            <div className="px-title-danger px-title-sm" style={{ fontSize: 34, lineHeight: 1.25 }}>
              第{ordinal(view.bossPhase)}階段：{card.name}
            </div>
            <div className="text-[22px]">{card.rule}</div>
          </div>
        ) : reveal ? (
          <div data-testid="answer-reveal" className="flex flex-col items-center gap-2">
            <div>正解：{reveal.answer}</div>
            {/* With the video up, its text explanation stands beside it instead. */}
            {!video && reveal.explanation?.kind === "text" && <div className="text-[20px]">{reveal.explanation.value}</div>}
            {mediaExplanation && (
              // A video explanation is at least 356×200 (YouTube's minimum, D11). The dish waits for 上菜 (cooking R4).
              // key tied to questionId: a 404'd explanation image must not stay hidden on later reveals.
              <QuestionMedia key={reveal.questionId} content={mediaExplanation} label="詳解" maxWidth={356} maxHeight={200} className="mx-auto block" />
            )}
          </div>
        ) : question ? (
          question.content.kind === "text" ? question.content.value : <div style={{ fontSize: 26 }}>{question.prompt ?? ""}</div>
        ) : "……"}
        {video && (
          // A reveal with nothing beside its video centres it (D18); the player stays the first child, so it is kept.
          <div key={video.id} className={`mt-3 flex items-start gap-4 text-left${lone ? " justify-center" : ""}`}>
            <YoutubePlayer
              videoId={video.content.videoId}
              start={video.content.start}
              end={video.content.end}
              command={media?.questionId === video.id ? media : null}
              width={384}
              height={216}
              cover={!reveal && !!video.content.audioOnly}
              needsTap={needsTap}
              onPlayingChange={onVideoPlaying}
              onEnded={reveal ? undefined : () => onClipEnded(video.id)}
              onError={reveal ? undefined : () => onClipError(video.id)}
              // The host plays the song from their own device (boss-music-buzzer.md M4).
              errorNote={!reveal && clipError && view.buzz?.open ? "🎤 主持人現場放歌" : undefined}
              title={reveal ? "正解影片" : "題目影片"}
            />
            {!lone && (
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              {reveal ? (
                reveal.explanation?.kind === "text" && <div className="text-[20px]">{reveal.explanation.value}</div>
              ) : (
                beside
              )}
            </div>
            )}
          </div>
        )}
        {!reveal && question && question.content.kind === "image" && (
          // Inline content inside the Panel, not a second independently-positioned absolute
          // element — the Panel's height already grows with wrapped question text, so a
          // media block positioned at a fixed pixel offset would overlap 2+ line questions
          // (design review finding). Living inside the flow means it always sits below
          // whatever the text actually rendered to, no matter how many lines it took.
          // See the matching comment in app/room/[code]/play/page.tsx — a key tied to the
          // question forces a fresh DOM node, or a broken image would stay hidden forever
          // once React reuses this node for the next media question (adversarial review).
          <QuestionMedia key={question.id} content={question.content} maxWidth={260} maxHeight={160} className="mx-auto mt-3 block" />
        )}
        {!asking && buzzBox && <div className="mt-3">{buzzBox}</div>}
        {!asking && !reveal && !card && question && !question.options && (
          <MageHint hint={view.mageHints?.[question.id]} sort={!!question.items} testId="screen-mage-hint" className="mx-auto mt-3 block w-fit px-3 py-1 text-[24px]" />
        )}
        {!asking && check?.hint !== undefined && <MageHint hint={check.hint} testId="screen-check-hint" className="mx-auto mt-3 block w-fit px-3 py-1 text-[24px]" />}
        {/* #104: the team's typed answer to a text question, for the room to see. */}
        {!asking && !reveal && !card && !buzz && question && !question.options && !question.items && turn?.typedAnswer && (
          <div data-testid="screen-typed-answer" className="mt-3 text-[24px] [overflow-wrap:anywhere]">
            ⚔️ {turn.name}：{turn.typedAnswer}
          </div>
        )}
      </Panel>
      )}

      {/* D17=A: a thief's armed Sneak Attack hangs over the monster until its answer is judged. */}
      {sneakChip && !asking && (
        <div className="px-chip absolute" style={{ left: "50%", top: 262, transform: "translateX(-50%)", zIndex: 6, fontSize: 22, padding: "6px 14px", background: "#ff8787", color: "var(--k)", border: "4px solid var(--k)" }}>
          🗝️ 偷襲！這題答對加碼
        </div>
      )}
      {dcChip && !asking && (
        <div data-testid="screen-check-dc" className="px-chip absolute" style={{ left: "50%", top: 262, transform: "translateX(-50%)", zIndex: 6, fontSize: 22, padding: "6px 14px", background: "var(--warn)", color: "var(--k)", border: "4px solid var(--k)" }}>
          🗣️ 說服 DC {dcChip.dc}（+{dcChip.bonus}）{awaitingCheck && `　${turn!.name}：按手機上的「擲骰說服」`}
        </div>
      )}
      <div className="absolute" style={{ left: "50%", bottom: 136, width: bossScene ? 210 : 170, height: 18, transform: "translateX(-50%)", background: "#0007", zIndex: 3, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" }} />
      {cook === 1 || cook === 2 ? <CookFrame step={cook} bottom={140} /> : !dishUp(cook) && (
      <div key={`${monster.kind}-${hits}`} className="absolute" style={{ left: "50%", bottom: monster.float ? 150 : 146, transform: "translateX(-50%)", zIndex: 4 }}>
        <div key={card ? `card-${eventId}` : undefined} className={card ? "px-phase-blink" : hits > 0 && inBoss ? "px-hit" : monster.float ? "px-float" : "px-idle"}>
          <Sprite kind={monster.kind} scale={monster.scale} hue={monster.hue} accessory={monster.accessory} />
        </div>
      </div>
      )}
      {/* 每題作答倒數 (answer-countdown.md D5): the round clock right of the monster; with tiles on the wall, a pill under B/D,
          above the dialogue box (z 7) so a three-row narration line never hides it. */}
      {typeof answerLeft === "number" && !reveal && !card && (
        <div className="absolute" style={wall || sortWall ? { right: 22, bottom: 116, zIndex: 8 } : { left: "calc(50% + 170px)", bottom: 150, zIndex: 6 }}>
          <AnswerClock key={answerLeft} ms={answerLeft} variant={wall || sortWall ? "wall" : "big"} onSecond={onClockSecond} />
        </div>
      )}
      {(cook === null || cook === 0) && (
      <Nameplate className="absolute" style={{ left: "50%", bottom: 112, transform: "translateX(-50%)", zIndex: 5, color: bossScene ? "#b02a3a" : undefined }}>
        <span>{monster.name}</span>
        {bossScene && (
          <span className="ml-[14px] flex gap-[3px]">
            {Array.from({ length: view.bossMaxHp }, (_, i) =>
              card ? (
                // The new bar fills one heart at a time (D7).
                <span key={`card-${eventId}-${i}`} className="px-heart-in" style={{ animationDelay: `${i * 0.15}s` }}>
                  <Sprite kind="heart" variant={1} scale={2} />
                </span>
              ) : (
                <Sprite key={i} kind="heart" variant={i < view.bossHp ? 1 : 0} scale={2} />
              ),
            )}
          </span>
        )}
      </Nameplate>
      )}

      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        accent={bossScene ? "var(--danger)" : undefined}
        loading={!served && !held && isPending(eventId, narration)}
        lines={dishUp(cook) ? [line] : served ? ["上菜！"] : held ? [held] : narration ? narration.lines : [turn ? `輪到${turn.name}了，${monster.name}擋在前面……` : "……"]}
        {...(!served && !held && narration ? { id: narration.eventId, onRead: (count: number) => onRead(narration.eventId, count) } : {})}
      />
      {pendingRoll?.kind === "kill" && pendingRoll.values ? (
        <KillRollOverlay key={`kill-${pendingRoll.teamId}-${eventId}`} teamName={nameOf(pendingRoll.teamId)} values={pendingRoll.values} value={pendingRoll.value} />
      ) : (
        pendingRoll && pendingRoll.kind !== "kill" && <RollOverlay key={`${pendingRoll.teamId}-${eventId}`} teamName={nameOf(pendingRoll.teamId)} value={pendingRoll.value} values={pendingRoll.values} kind={pendingRoll.kind ?? "warrior"} critable={!!(question?.options || question?.items)} bonus={pendingRoll.bonus} dc={pendingRoll.dc} />
      )}
    </>
  );
}

/** An event room on the big screen (docs/designs/event-rooms.md D6): the scene stands in the arch, the panel carries
 * its line, then, once the team presses, the outcome until 下一題. */
function EventRoomScreen({ view, reveal, eventId, narration, onRead }: { view: SpectatorView; reveal: EventReveal | null; eventId: number; narration: NarrationState; onRead: (eventId: number, count: number) => void }) {
  // After the press the turn has passed on: the stage stays the event team's, one room back.
  const idx = view.teams.findIndex((t) => t.id === (reveal ? reveal.teamId : view.currentTurnTeamId));
  const team = view.teams[idx];
  const scene = reveal?.scene ?? team?.eventScene ?? "chest";
  const text = EVENT_SCENE_TEXT[scene];
  const name = team?.name ?? "";
  return (
    <>
      <SceneBackground theme={roomTheme(Math.max(0, (team?.roomIndex ?? 0) - (reveal ? 1 : 0)))} />
      <Torches />
      <Sparks />
      <div className="absolute flex items-start gap-3" style={{ left: 18, right: 18, top: 24, zIndex: 6 }}>
        {team && <TurnRibbon color={look(idx).hat} maxWidth={420}>{reveal ? `❓ ${name}` : `輪到：${name}`}</TurnRibbon>}
        <MapStrip view={view} />
      </div>
      <Panel className="absolute text-center" style={{ left: 110, right: 110, top: 96, padding: "32px 24px 12px", fontSize: 30, lineHeight: 1.3, zIndex: 5 }}>
        <div className="absolute flex justify-between text-[14px]" style={{ left: 16, right: 16, top: 6 }}>
          <LabelChip>❓ 事件房</LabelChip>
        </div>
        {reveal ? (
          <div data-testid="event-result" className="flex flex-col items-center gap-1">
            <div className="px-title-gold px-title-sm" style={{ fontSize: 38, lineHeight: 1.2 }}>{EVENT_OUTCOME_TITLE[reveal.outcome]}</div>
            <div className="text-[24px]">{reveal.dish ? `${reveal.dish.name}！` : ""}{name} {eventEffectLine(reveal)}</div>
          </div>
        ) : (
          <>
            <div data-testid="event-line">{text.line}</div>
            <div className="text-[20px]">{name}：按手機上的「{text.button.replace(/^\S+\s/, "")}」</div>
          </>
        )}
      </Panel>
      <div className="absolute" style={{ left: "50%", bottom: 136, width: 170, height: 18, transform: "translateX(-50%)", background: "#0007", zIndex: 3, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" }} />
      <div key={`${scene}-${reveal ? "open" : "shut"}`} className="absolute" style={{ left: "50%", bottom: 146, transform: "translateX(-50%)", zIndex: 4 }}>
        <EventStage scene={scene} reveal={reveal} height={120} />
      </div>
      <Nameplate className="absolute" style={{ left: "50%", bottom: 112, transform: "translateX(-50%)", zIndex: 5 }}>
        <span>{text.name}</span>
      </Nameplate>
      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        loading={isPending(eventId, narration)}
        lines={narration ? narration.lines : [`${name}走進了事件房……`]}
        {...(narration ? { id: narration.eventId, onRead: (count: number) => onRead(narration.eventId, count) } : {})}
      />
    </>
  );
}

const PODIUM = [
  { place: 2, bg: "#c9c9d6", h: 108, hero: 5 },
  { place: 1, bg: "#ffcf4a", h: 136, hero: 6 },
  { place: 3, bg: "#e39a5d", h: 92, hero: 5 },
];
const CONFETTI = ["#ff6b6b", "#ffcf4a", "#6fd36a", "#6ab4ff", "#ff9db8", "#fff"];

/** A title's card, centre stage, cut to the next one each beat (podium-titles.md D1, D5): the title, each winner's
 * hero and name (two at most, then 等 N 隊), and the reason. A lone name wraps to two rows; a tie keeps one row each. */
function AwardCard({ beat, teams }: { beat: Extract<Beat, { kind: "award" }>; teams: SpectatorView["teams"] }) {
  const tie = beat.teamIds.length > 1;
  return (
    <div data-testid="award-card" className="absolute" style={{ left: "50%", top: 110, width: 400, transform: "translateX(-50%)", zIndex: 8 }}>
      <Panel tone="turn" className="flex flex-col items-center gap-2 px-4 py-3 text-center leading-snug">
        <div className="text-[30px]">{beat.icon} {beat.title}</div>
        <div className="flex justify-center gap-6">
          {beat.teamIds.slice(0, 2).map((id, j) => (
            <div key={id} className="flex flex-col items-center gap-1" style={{ maxWidth: tie ? 170 : 360 }}>
              <Sprite kind="hero" variant={Math.max(0, teams.findIndex((t) => t.id === id))} scale={4} />
              <div className={tie ? "w-full truncate text-[22px]" : "line-clamp-2 break-all text-[22px]"}>{beat.names[j]}</div>
            </div>
          ))}
        </div>
        {beat.teamIds.length > 2 && <div className="text-[18px]">等 {beat.teamIds.length - 2} 隊</div>}
        <div data-testid="award-reason" className="text-[20px]">{beat.reason}</div>
      </Panel>
    </div>
  );
}

function Finished({ view, winners, reveal, podium, narration, unread, typedTo, epilogue, page, cuisine, finale, say, onRead, onCook, onCue, onPodium }: { view: SpectatorView; winners: string[]; reveal: AnswerReveal | null; podium?: PodiumReveal; narration: NarrationState; unread: boolean; typedTo: number; epilogue: string | null; page: number; cuisine?: true; finale: boolean; say: (lines: string[]) => void; onRead: (eventId: number, count: number) => void; onCook: () => void; onCue: (cue: SoundCue) => void; onPodium: () => void }) {
  const dish = reveal?.dish;
  const line = dish ? dishLine(dish, "", true) : "";
  // The boss cooks first and the winner waits (cooking R8, I4): only a kill this screen saw live plays it.
  const step = useFinaleStep(finale && !!dish, onCook, () => say([line]));
  const cooked = step === 4;
  // Then the narrator calls the places on the room's clock (podium-reveal.md); the scores wait for first place.
  const t = useRevealTime(podium);
  const now = revealNow(podium, t);
  const beats: Beat[] = podium?.beats ?? [];
  const current = cooked && now.beat >= 0 && !now.done ? beats[now.beat] : undefined;
  const called = new Set(beats.slice(0, now.beat + 1).flatMap((b) => (b.kind === "place" ? [b.place] : [])));
  // Reduced motion skips the beats (t null): the titles stand as a still list instead, one row a team (eng E3).
  const titleRows = t === null ? view.teams.flatMap((x) => {
    const icons = beats.flatMap((b) => (b.kind === "award" && b.teamIds.includes(x.id) ? [b.icon] : [])).join("");
    return icons ? [{ id: x.id, name: x.name, icons }] : [];
  }) : [];
  const ended = cooked && now.done;
  // The narrator's calls are still being written: 「…」, not the kill-shot line left over (storyboard row 1).
  // A narration still being read after 結束冒險 stays up: the room starts the reveal once this screen has read it.
  // Only after 結束冒險 (no dish): after a boss kill the kill-shot line has had the cooking to be read (storyboard row 1).
  const holdNarration = unread && !dish;
  const waiting = cooked && !!podium && podium.beats === null && !holdNarration;
  // After 結束冒險 the box picks up at the line the game screen had reached, so the room's wait is not a second pass.
  const [from] = useState(() => (dish || !narration ? 0 : Math.min(typedTo, narration.lines.length - 1)));
  useEffect(() => {
    if (ended) onPodium();
    // It runs once, when the story may be read; onPodium also reads the epilogue page from this render's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);
  // Each beat's line is read as it comes up (a roll's chip too); a title's opens on a chime, 🎲 on the crit's (D3).
  const spoken = current && t !== null ? now.beat : -1;
  useEffect(() => {
    const beat = beats[spoken];
    if (spoken < 0 || !beat) return;
    if (beat.kind === "award") onCue(beat.icon === "🎲" ? "crit" : "correct");
    say([unemoji(beat.line)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spoken]);
  const result = cooked && now.result;
  const byRank = podium?.ranking.map((id) => view.teams.findIndex((x) => x.id === id)).filter((i) => i >= 0);
  const order = byRank ?? view.teams.map((_, i) => i).sort((a, b) => view.teams[b].reward - view.teams[a].reward);
  const ranked = order.slice(0, 3).map((i) => ({ ...view.teams[i], i }));
  const names = winners.map((id) => view.teams.find((t) => t.id === id)?.name ?? id).join("、");
  // The winner is the reward total, not the kill (scoring-and-score-pools.md S7), so the kill gets its own line. It
  // hides while the places are called (D13).
  const killer = view.teams.find((t) => t.id === view.bossKilledBy)?.name;
  // A long epilogue shows one page at a time (≤ 3 rows, so the box stays under the steps); the host turns them.
  const shownEpilogue = epilogue && (epiloguePages(epilogue)[page] ?? epilogue);
  const turned = useRef(page);
  useEffect(() => {
    // Read out a page the host just turned to; a page already on show when this screen joined stays quiet, and a turn
    // during the places is read by onPodium.
    if (page === turned.current) return;
    turned.current = page;
    if (ended && shownEpilogue) say([shownEpilogue]);
  }, [page, ended, shownEpilogue, say]);
  return (
    <>
      <SceneBackground theme="moss" arch={false} />
      {result && Array.from({ length: 26 }, (_, i) => (
        <i key={i} className="px-confetti" style={{ left: 20 + ((i * 37) % 920), background: CONFETTI[i % 6], animationDelay: `${-((i * 0.37) % 3.6)}s`, animationDuration: `${2.6 + ((i * 0.13) % 2)}s`, zIndex: 6 }} />
      ))}
      <div className="absolute inset-x-0 text-center" style={{ top: 20, zIndex: 6, fontSize: 54, color: "var(--warn)", textShadow: "4px 4px 0 var(--k), -3px -3px 0 var(--k), 3px -3px 0 var(--k), -3px 3px 0 var(--k), 0 6px 0 var(--k)" }}>
        <small className="mb-1 block text-[16px] text-white" style={{ letterSpacing: "0.4em", textShadow: "2px 2px 0 var(--k)" }}>
          冒　險　結　束
        </small>
        {result && <>{names}奪得榜首！</>}
        {cooked && !result && <span style={{ fontSize: 36 }}>名次揭曉中…</span>}
        {killer && !cooked && <small data-testid="final-blow" className="mt-1 block text-[18px] text-white" style={{ textShadow: "2px 2px 0 var(--k)" }}>最後一擊：{killer}</small>}
      </div>
      {/* The winning answer: the last correct judgment ends the game, so its reveal lands here, not on
          <Playing>. The podium is centered and about 546px wide, which leaves the left margin free
          below the title — a banner up top would sit on the crown. */}
      {/* Before the podium the boss cooks centre stage, with hard cuts between frames (cooking I8). */}
      {!cooked && dish && (step === 1 || step === 2) && <CookFrame step={step} bottom={150} />}
      {!cooked && dish && step === 0 && (
        <div className="absolute flex flex-col items-center" style={{ left: "50%", bottom: 140, transform: "translateX(-50%)", zIndex: 4 }}>
          <Sprite kind={dish.monster.sprite} scale={monsterLook(dish.monster).scale} hue={(dish.monster.hue + PHASE_HUE_STEP * (view.bossPhase - 1)) % 360} />
          <Nameplate className="mt-2" style={{ color: "#b02a3a" }}>{dish.monster.name}</Nameplate>
        </div>
      )}
      {!cooked && dish && step === 3 && <DishOnStage dish={dish} title="今晚的大菜" cardTop={120} bottom={140} />}
      {result && (reveal || killer) && (
        <div data-testid="answer-reveal" className="absolute" style={{ left: 18, top: 160, width: 170, zIndex: 6 }}>
          <Panel tone="turn" className="px-3 py-2 text-[16px] leading-snug">
            {/* With the podium up, the kill line lives here: under the title it sat on the winner's crown. */}
            {killer && <div data-testid="final-blow">最後一擊：{killer}</div>}
            {reveal && <>最後一題正解：{reveal.answer}</>}
            {reveal?.dish && <div data-testid="dish-card">🍲 今晚的大菜：{reveal.dish.name}</div>}
          </Panel>
        </div>
      )}
      {cooked && titleRows.length > 0 && (
        <div data-testid="title-list" className="absolute" style={{ right: 18, top: 160, width: 170, zIndex: 6 }}>
          <Panel tone="turn" className="flex flex-col gap-1 px-3 py-2 text-[16px] leading-snug">
            {titleRows.map((r) => (
              <div key={r.id} className="truncate">{r.icons} {r.name}</div>
            ))}
          </Panel>
        </div>
      )}
      {cooked && (
      <div data-testid="podium" className="absolute inset-x-0 flex items-end justify-center gap-12" style={{ bottom: 130, zIndex: 5 }}>
        {PODIUM.map((p) => {
          const t = ranked[p.place - 1];
          if (!t) return <div key={p.place} style={{ width: 150 }} />;
          // A place is a white ？ until it is called, then a hard cut to the team (D2; DESIGN.md: no tweens).
          const shown = result || called.has(p.place);
          return (
            <div key={p.place} data-testid={`podium-${p.place}`} data-shown={shown || undefined} className="flex flex-col items-center">
              {result && p.place === 1 && <Sprite kind="crown" scale={3} style={{ marginBottom: -10, zIndex: 2 }} />}
              {shown ? (
                <Sprite kind="hero" variant={t.i} scale={p.hero} />
              ) : (
                <div className="text-[64px] leading-none text-white" style={{ textShadow: "4px 4px 0 var(--k), -4px -4px 0 var(--k), 4px -4px 0 var(--k), -4px 4px 0 var(--k)" }}>？</div>
              )}
              <div className="flex flex-col items-center pt-2 text-white" style={{ width: 150, height: p.h, background: p.bg, boxShadow: "0 0 0 4px var(--k), inset 0 6px 0 #ffffff55, inset 0 -8px 0 #0003" }}>
                <span className="px-num text-[22px]" style={{ textShadow: "3px 3px 0 var(--k)" }}>{p.place}</span>
                {shown && <b className="mt-[6px] truncate text-[18px] font-normal" style={{ maxWidth: 140, textShadow: "2px 2px 0 var(--k)" }}>{t.name}</b>}
                {result && <s className="mt-[2px] text-[14px] no-underline" style={{ color: "#fff6c0", textShadow: "2px 2px 0 var(--k)" }}>{t.reward} {cuisine ? "飽足感" : "分"}</s>}
              </div>
            </div>
          );
        })}
      </div>
      )}
      {current?.kind === "roll" && <TieRollOverlay key={now.beat} line={current.line} names={current.names} values={current.values} result={current.result} />}
      {current?.kind === "award" && <AwardCard beat={current} teams={view.teams} />}
      {/* The kill-shot line is read first, then each beat's call, then the story as one typewriter line — on a screen
          that saw the game end, only once first place's beat is over (cooking I4). */}
      <DialogueBox
        className="absolute"
        // The epilogue runs three lines or more; at 22px it stays under the podium (bottom 130) instead of covering the names.
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7, ...(ended && epilogue ? { fontSize: 22, lineHeight: 1.35 } : {}) }}
        loading={!(ended && epilogue) && !current && (!narration || waiting) && step !== 3}
        lines={step === 3 ? [line] : ended && shownEpilogue ? [shownEpilogue] : current ? [current.line] : waiting ? [] : (narration?.lines.slice(from) ?? [])}
        {...(step !== 3 && !(ended && epilogue) && !current && !waiting && narration ? { id: narration.eventId, onRead: (count: number) => onRead(narration.eventId, count + from) } : {})}
      />
    </>
  );
}

export default function ScreenPage() {
  const { code } = useParams<{ code: string }>();
  useWakeLock();
  const [lobby, setLobby] = useState<LobbyTeams>([]);
  const [game, setGame] = useState<StateMessage | null>(null);
  /** A network drop (not a rest): shown so a frozen screen doesn't look like a quiet game. */
  const [disconnected, setDisconnected] = useState(false);
  const [narration, setNarration] = useState<NarrationState>(null);
  const [epilogue, setEpilogue] = useState<string | null>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  /** The boss kill came in live, so the end screen cooks the boss before the podium (cooking R8). */
  const [finale, setFinale] = useState(false);
  /** The phase of the last STATE on this connection: playing → finished is a kill seen live. */
  const lastPhase = useRef<StateMessage["phase"] | null>(null);
  /** The doors and the boss alarm (lib/transitions.ts): what this connection has seen, and the one playing. */
  const transitionSeen = useRef(UNSEEN);
  const [transition, setTransition] = useState<Transition | null>(null);
  /** A boss alarm due while ⚔️ 最後衝刺's banner shows waits for it to end, sound included (last-sprint.md: the sprint wins). */
  const queuedBoss = useRef<Transition | null>(null);
  const sprintShowing = useRef(false);
  const stopTransitions = () => {
    queuedBoss.current = null;
    sprintShowing.current = false;
    setTransition(null);
  };
  const endTransition = useCallback(() => {
    const next = queuedBoss.current;
    queuedBoss.current = null;
    sprintShowing.current = false;
    setTransition(next);
    if (next) bgm.current?.playCue(BOSS_ALARM);
  }, []);
  /** The eventId of the last served reveal: its late narration line must not cut off 上菜's lines (cooking I1),
   * nor be read over the next question once 下一題 closes it (closing a reveal does not move eventId). */
  const servedEvent = useRef<number | null>(null);
  /** False while the finale holds the podium; an epilogue arriving then waits to be read (cooking I4). */
  const podiumReady = useRef(true);
  const heldEpilogue = useRef<string | null>(null);
  function onPodium() {
    podiumReady.current = true;
    // The page on show: the host may have turned it while the places were called.
    if (heldEpilogue.current) speak([epiloguePages(heldEpilogue.current)[game?.epiloguePage?.page ?? 0] ?? heldEpilogue.current]);
    heldEpilogue.current = null;
  }

  // --- TTS (docs/designs/dm-voice-narration-tts.md) ---
  const [ttsOn, setTtsOn] = useState(false);
  /** The how-to-play page whose owl line was last spoken (D11). */
  const introSpoken = useRef<number | null>(null);
  const [ttsVoice, setTtsVoice] = useState<SpeechSynthesisVoice | undefined>(undefined);
  /** Reset on every socket open AND on every LOBBY (a room reset can happen without a socket
   * reconnect, and a new game's eventIds start over from 0 — see tts.ts's shouldSpeakNarration
   * doc comment). null = "not yet established"; the next STATE message sets it from that
   * event's own eventId, so onConnect's resent lastNarration (same eventId as that STATE) is
   * correctly excluded, and a brand-new room with no narration yet (baseline 0) still speaks
   * its first live line. */
  const narrationBaseline = useRef<number | null>(null);
  /** The highest eventId whose sound effect this connection has already handled. Starts at the
   * first STATE after connecting, so reconnecting never replays the current event's effect. */
  const sfxSeen = useRef<number | null>(null);
  /** The last NARRATION this connection has SEEN, not just spoken — updated on every NARRATION
   * message regardless of whether shouldSpeakNarration() decided to speak it. This is what lets
   * a later correction (same eventId, different text) to the connect-time replay be recognized
   * and spoken: if this only tracked what was actually spoken, the replay (correctly not
   * spoken) would never update it, and a correction to it would have nothing to compare against
   * (adversarial review finding — see shouldSpeakNarration's doc comment for the fixed bug). */
  const lastSpokenNarration = useRef<SpokenNarration | null>(null);

  // ttsSupported() reads `window`, which doesn't exist during SSR: the server snapshot (false)
  // keeps the first client render matching the server HTML, no hydration mismatch.
  const showTtsToggle = useSyncExternalStore(noSubscribe, ttsSupported, () => false);
  useEffect(() => {
    // A named function, not the effect body itself: react-hooks/set-state-in-effect.
    function restore() {
      if (readStored(TTS_ENABLED_STORAGE) === "true") setTtsOn(true);
    }
    restore();
  }, []);

  useEffect(() => {
    if (!ttsSupported()) return;
    const load = () => {
      const found = pickVoice(window.speechSynthesis.getVoices());
      if (found) setTtsVoice(found);
    };
    load(); // some browsers already have the list on first call
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  /** The latest lines that arrived while TTS was on but the voice list hadn't loaded yet (it loads
   * asynchronously, via voiceschanged). Spoken as soon as a voice turns up, so the first narration
   * after the toggle isn't silently lost. Only the latest is kept: a newer line replaces it. */
  const pendingLines = useRef<{ lines: string[]; eventId: number | null; from: number } | null>(null);

  /** What the voice is reading, one line at a time: `at` is the line being spoken. One utterance at a time
   * (not all queued at once) so a host edit can swap a later line, or restart from the edited one (D13).
   * `eventId` is the narration's, or null for any other line (intro, 上菜, epilogue). */
  const speech = useRef<{ lines: string[]; at: number; eventId: number | null; utter: SpeechSynthesisUtterance | null } | null>(null);

  function speakAt(q: NonNullable<typeof speech.current>) {
    if (speech.current !== q || !ttsVoice) return;
    if (q.at >= q.lines.length) {
      speech.current = null;
      return;
    }
    const utter = new SpeechSynthesisUtterance(q.lines[q.at]);
    utter.voice = ttsVoice;
    utter.lang = ttsVoice.lang;
    q.utter = utter;
    // Guarded by identity: cancel() fires onerror on the cut utterance, which must not advance anything.
    const next = (stuck = false) => {
      if (speech.current !== q || q.utter !== utter) return;
      clearTimeout(watchdog);
      q.utter = null; // before cancel(): its onerror must find nothing to advance
      if (stuck) window.speechSynthesis.cancel();
      q.at++;
      if (q.eventId !== null) markRead(q.eventId, { spoken: q.at });
      speakAt(q);
    };
    utter.onend = () => next();
    utter.onerror = () => next();
    // No onend in time: treat the line as spoken and read on (see speechTimeoutMs).
    const watchdog = setTimeout(() => next(true), speechTimeoutMs(utter.text));
    window.speechSynthesis.speak(utter);
  }

  /** Cancels anything in progress, then reads `lines` from line `from`, one after another. No-ops (does not
   * even cancel) when TTS is off or the API is unsupported; with no voice loaded yet it keeps the lines in
   * pendingLines instead. `eventId` marks a narration, whose spoken progress counts toward the host's (D11). */
  function speak(lines: string[], eventId: number | null = null, from = 0) {
    if (!ttsOn || !ttsSupported()) return;
    if (!ttsVoice) {
      pendingLines.current = { lines, eventId, from };
      return;
    }
    const p = progress.current;
    // Another line cuts the narration's voice short: from here on, only its typing counts.
    if (p && p.eventId !== eventId) p.spoken = null;
    else if (p) p.spoken = Math.min(p.spoken ?? from, from);
    speech.current = null; // before cancel(): see speakAt's guard
    window.speechSynthesis.cancel();
    const q = { lines, at: from, eventId, utter: null };
    speech.current = q;
    speakAt(q);
  }

  // --- How far this screen has read the narration (host-narration-edit.md D3, D11, D14) ---
  /** typed: lines finished typing. spoken: lines finished speaking, or null when the voice isn't reading it.
   * sent: the last `done` reported to the room. */
  const progress = useRef<{ eventId: number; rev: number; lines: string[]; typed: number; spoken: number | null; sent: number } | null>(null);
  /** The narration this screen has not read out yet (the end screen keeps it up after 結束冒險), or null. */
  const [unreadId, setUnreadId] = useState<number | null>(null);
  /** Lines of the current narration typed so far, so the end screen picks up there instead of typing it over. */
  const [typedTo, setTypedTo] = useState(0);

  function markRead(eventId: number, read: { typed?: number; spoken?: number }) {
    const p = progress.current;
    if (!p || p.eventId !== eventId) return;
    if (read.typed !== undefined) {
      p.typed = Math.max(p.typed, read.typed);
      setTypedTo(p.typed);
    }
    if (read.spoken !== undefined && p.spoken !== null) p.spoken = Math.max(p.spoken, read.spoken);
    const done = readCount(p.typed, p.spoken);
    if (done <= p.sent) return;
    p.sent = done;
    if (done >= p.lines.length) setUnreadId(null);
    send({ type: "SCREEN_NARRATION_PROGRESS", eventId, rev: p.rev, done });
  }

  /** A NARRATION arrived: a new one starts the count over; the same eventId with changed lines is a host edit
   * from line `d`, read again from there — the line being spoken finishes first unless it is the edited one.
   * `voice`: read it aloud (see shouldSpeakNarration). */
  function trackNarration(msg: { eventId: number; lines: string[]; rev?: number }, voice: boolean) {
    const p = progress.current;
    const rev = msg.rev ?? 0;
    if (p && p.eventId > msg.eventId) return;
    if (!p || p.eventId !== msg.eventId) {
      progress.current = { eventId: msg.eventId, rev, lines: msg.lines, typed: 0, spoken: null, sent: 0 };
      setUnreadId(msg.eventId);
      setTypedTo(0);
      if (voice) speak(msg.lines, msg.eventId);
      return;
    }
    const d = firstChange(p.lines, msg.lines);
    const newRev = rev !== p.rev;
    p.rev = rev;
    p.lines = msg.lines;
    if (d !== -1) {
      p.typed = Math.min(p.typed, d);
      if (p.spoken !== null) p.spoken = Math.min(p.spoken, d);
      setUnreadId(msg.eventId);
      setTypedTo(p.typed);
    }
    // A report sent under the old rev may have crossed the edit and been dropped: say it again under the new one.
    if (newRev) {
      p.sent = 0;
      markRead(msg.eventId, {});
    }
    if (d === -1 || !voice) return;
    const q = speech.current;
    if (q && q.eventId === msg.eventId && d > q.at) q.lines = msg.lines;
    else speak(msg.lines, msg.eventId, d);
  }

  // The voice just loaded: speak whatever arrived while waiting for it (see pendingLines).
  useEffect(() => {
    if (!ttsVoice || !pendingLines.current) return;
    const { lines, eventId, from } = pendingLines.current;
    pendingLines.current = null;
    speak(lines, eventId, from);
    // Only a newly loaded voice should trigger this; speak() itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsVoice]);

  function toggleTts() {
    if (!ttsOn && ttsSupported()) {
      // The unlock speak() call must run synchronously inside this click handler — Safari/iOS
      // gate audio output behind a user gesture that itself produces sound (see design doc's
      // Approach A note). A later, async speak() from a NarrationEvent arriving minutes on
      // wouldn't count as "inside the gesture" and can silently fail there.
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    } else if (ttsOn) {
      speech.current = null;
      window.speechSynthesis.cancel();
      pendingLines.current = null; // turned off: nothing waiting should play later
      if (progress.current) progress.current.spoken = null;
    }
    setTtsOn((on) => {
      writeStored(TTS_ENABLED_STORAGE, String(!on));
      return !on;
    });
  }

  // --- Background music (lib/bgm.ts): off by default, like the narration voice ---
  const [bgmOn, setBgmOn] = useState(false);
  const showBgmToggle = useSyncExternalStore(noSubscribe, bgmSupported, () => false);
  const bgm = useRef<BgmPlayer | null>(null);
  const player = () => (bgm.current ??= createBgmPlayer());
  // The music stays silent from a buzz until the host judges it, and while the host plays the song from their own
  // device (boss-music-buzzer.md M3, M4): the room must hear the answer, and the song.
  const videoPlaying = useRef(false);
  const bgmHeld = useRef(false);
  const buzzView = game?.phase === "playing" ? game.view.buzz : undefined;
  const held = !!buzzView?.teamId || (!!game?.clipError && !!buzzView?.open);
  useEffect(() => {
    bgmHeld.current = held;
    player().mute(held || videoPlaying.current);
  }, [held]);

  useEffect(() => {
    // Read in an effect so SSR and the first render agree.
    // A named function, not the effect body itself: react-hooks/set-state-in-effect.
    function restore(): boolean {
      if (!bgmSupported()) return false;
      const on = readStored(BGM_ENABLED_STORAGE) === "true";
      if (on) setBgmOn(true);
      return on;
    }
    if (!restore()) return;
    // Browsers only let audio start inside a user gesture, so a remembered "on" waits for the
    // first click or key press on the page.
    // One gesture unlocks: both listeners go, or a later key press restarts music the 🎵 button just turned off.
    const off = () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    const unlock = () => {
      off();
      void player().start();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return off;
  }, []);

  // Keep the music under the narration voice: lower it while speechSynthesis is talking.
  useEffect(() => {
    if (!bgmOn) return;
    const id = setInterval(() => bgm.current?.duck(ttsSupported() && window.speechSynthesis.speaking), 250);
    return () => clearInterval(id);
  }, [bgmOn]);

  useEffect(() => () => bgm.current?.stop(), []);

  // --- YouTube questions (docs/designs/youtube-questions.md) ---
  // The browser blocks a video's sound until someone taps the page: say so in the lobby, and on the video (D16).
  const [tapped, setTapped] = useState(true);
  useEffect(() => {
    function read() {
      setTapped(navigator.userActivation?.hasBeenActive ?? true);
    }
    read();
    const on = () => setTapped(true);
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, []);
  /** From the player's real state (the clip stops itself at its end): the music goes silent (D10) and a line still
   * being read stops, since the host pressed ▶ to hear the song (D20). */
  /** The question whose video this screen's player shows 影片無法播放 for: re-sent on every SCREEN_HELLO, so a room that
   * restarted (clipError lives in memory) gets the warning back. Any playing / paused report means the player recovered. */
  const clipErrored = useRef<string | null>(null);
  function onVideoPlaying(playing: boolean) {
    clipErrored.current = null;
    videoPlaying.current = playing;
    player().mute(playing || bgmHeld.current);
    if (playing && ttsSupported()) {
      window.speechSynthesis.cancel();
      pendingLines.current = null;
    }
  }

  function onClipEnded(questionId: string) {
    send({ type: "SCREEN_CLIP_ENDED", questionId });
  }
  function onClipError(questionId: string) {
    clipErrored.current = questionId;
    send({ type: "SCREEN_CLIP_ERROR", questionId });
  }
  /** The lowest second the answer clock has shown. A STATE remounts the clock, which can show the same second or one
   * above it again (network delay): neither ticks twice. A jump of more than a second up is a new count. */
  const lastTick = useRef<number | null>(null);
  const onClockSecond = useCallback((s: number) => {
    const last = lastTick.current;
    if (last !== null && s >= last && s <= last + 1) return;
    lastTick.current = s;
    if (last !== null && s > last) return; // a new count starts silent
    if (s === 0) bgm.current?.playCue(ANSWER_TIME_UP);
    else if (s <= ANSWER_WARN_SECONDS) bgm.current?.playCue(ANSWER_TICK);
  }, []);

  function toggleBgm() {
    const next = !bgmOn;
    // start() runs inside this click, which is what lets the browser play it.
    if (next) void player().start();
    else bgm.current?.stop();
    setBgmOn(next);
    writeStored(BGM_ENABLED_STORAGE, String(next));
  }

  const { reset, rested, unreachable, reconnect, send } = useRoomSocket(code, {
    onOpen() {
      // First, so the room takes this socket's SCREEN_* reports: it ignores them from an unannounced socket.
      send({ type: "SCREEN_HELLO" });
      // shortcut: a stale id (the player unmounted while in error) is re-sent too; the room drops it unless that video shows.
      if (clipErrored.current) send({ type: "SCREEN_CLIP_ERROR", questionId: clipErrored.current });
      setDisconnected(false);
      narrationBaseline.current = null;
      sfxSeen.current = null;
      lastPhase.current = null;
      transitionSeen.current = UNSEEN;
      stopTransitions();
      // A 回到大廳 missed while offline restarts eventIds at 0: an old high eventId would drop every new narration.
      progress.current = null;
    },
    onClose({ rested, openedBefore }) {
      if (!rested && openedBefore) setDisconnected(true);
    },
    onMessage(msg) {
      switch (msg.type) {
        case "LOBBY":
          setLobby(msg.teams);
          setFloats([]);
          setGame(null);
          setNarration(null);
          setEpilogue(null);
          setFinale(false);
          lastPhase.current = null;
          transitionSeen.current = IN_LOBBY;
          stopTransitions();
          podiumReady.current = true;
          heldEpilogue.current = null;
          servedEvent.current = null;
          // A room reset can arrive without a socket reconnect, and the next game's eventIds
          // start over from 0 — re-arm the baseline the same way onOpen does.
          narrationBaseline.current = null;
          sfxSeen.current = null;
          pendingLines.current = null;
          speech.current = null;
          progress.current = null;
          window.speechSynthesis?.cancel();
          break;
        case "STATE":
          setGame(msg);
          {
            const t = nextTransition(transitionSeen.current, msg);
            transitionSeen.current = t.seen;
            if (t.play?.kind === "boss" && sprintShowing.current) queuedBoss.current = t.play;
            else if (t.play) {
              setTransition(t.play);
              sprintShowing.current = t.play.kind === "sprint";
              if (t.play.kind === "boss") bgm.current?.playCue(BOSS_ALARM);
              if (t.play.kind === "sprint") bgm.current?.playCue(SPRINT_FANFARE);
            }
          }
          if (msg.phase === "finished" && lastPhase.current === "playing" && msg.reveal?.dish) setFinale(true);
          // The story waits for the boss to cook (cooking I4) and the places to be called (podium-reveal.md), on every
          // STATE: a screen that (re)connects mid-reveal must not read the winner's story first. Finished's clock
          // restarts from this STATE too, so its onPodium comes once the reveal is done.
          if (msg.phase === "finished" && lastPhase.current === "playing" && msg.reveal?.dish) podiumReady.current = false;
          if (msg.phase === "finished" && msg.podium && !revealNow(msg.podium, prefersReducedMotion() ? null : msg.podium.elapsedMs).done) podiumReady.current = false;
          lastPhase.current = msg.phase;
          if (msg.reveal?.served) servedEvent.current = msg.eventId;
          // D11: each how-to-play page's owl line is spoken once, when the page comes up.
          if (msg.intro && msg.intro.page !== introSpoken.current) speak([INTRO_PAGE_TEXT[msg.intro.page - 1]?.owl ?? ""]);
          introSpoken.current = msg.intro?.page ?? null;
          if (narrationBaseline.current === null) narrationBaseline.current = msg.eventId;
          // A new cue: play it once (only while the 🎵 music is on, see playCue). cueSeq counts cues, a roll's too;
          // an older server has none, and its cues came only with a new eventId.
          {
            const seq = msg.cueSeq ?? msg.eventId;
            if (sfxSeen.current === null) sfxSeen.current = seq;
            else if (seq > sfxSeen.current) {
              sfxSeen.current = seq;
              if (msg.cue) bgm.current?.playCue(SFX[msg.cue]);
            }
          }
          break;
        case "NARRATION":
          setNarration((n) => keepLatest(n, msg));
          {
            let speakIt = false;
            if (narrationBaseline.current !== null) {
              speakIt = shouldSpeakNarration(msg, narrationBaseline.current, lastSpokenNarration.current);
              lastSpokenNarration.current = msg; // always, even when not spoken — see the ref's doc comment
            }
            trackNarration(msg, speakIt && msg.eventId !== servedEvent.current);
          }
          break;
        case "EPILOGUE":
          setEpilogue(msg.text);
          // Speak the live broadcast, never onConnect's replay (the server marks it `replay: true`).
          if (msg.replay) break;
          if (podiumReady.current) speak([epiloguePages(msg.text)[0]]);
          else heldEpilogue.current = msg.text;
          break;
        case "GAME_OVER":
          setGame((g) => (g ? { ...g, phase: "finished", winners: msg.winners } : g));
          break;
        case "REACTION": {
          const id = ++floatSeq;
          const f: Float = { id, teamId: msg.teamId, reaction: msg.reaction, x: FLOAT_LANES[id % FLOAT_LANES.length] };
          setFloats((fs) => [...fs.slice(-(MAX_FLOATS - 1)), f]);
          setTimeout(() => setFloats((fs) => fs.filter((o) => o !== f)), FLOAT_MS);
          break;
        }
      }
    },
  });

  return (
    <>
      <Stage>
        {!game && <Lobby code={code} teams={lobby} />}
        {game?.phase === "playing" && game.intro && (
          <>
            <SceneBackground theme="stone" />
            <Torches />
            <HowToPlay page={game.intro.page} cuisine={!!game.cuisine} />
          </>
        )}
        {game?.phase === "playing" && !game.intro && game.initiative && (
          <>
            <SceneBackground theme="stone" />
            <Torches />
            <InitiativeOverlay key={game.initiative.order ? "order" : "rolling"} ini={game.initiative} teams={game.view.teams} />
          </>
        )}
        {game?.phase === "playing" && !game.intro && !game.initiative && (game.eventReveal || (!game.reveal && !game.phaseCard && !game.phaseCardDue && describeTurn(game.view, null).team?.eventScene)) ? (
          <EventRoomScreen view={game.view} reveal={game.eventReveal ?? null} eventId={game.eventId} narration={narration} onRead={(id, count) => markRead(id, { typed: count })} />
        ) : game?.phase === "playing" && !game.intro && !game.initiative && <Playing view={game.view} question={game.question} reveal={game.reveal} pendingLock={game.pendingLock ?? null} pendingRoll={game.pendingRoll ?? null} wrongSlots={game.wrongSlots} eventId={game.eventId} narration={narration} phaseCard={game.phaseCard} bossPhaseInfo={game.bossPhaseInfo} media={game.media} needsTap={!tapped} onVideoPlaying={onVideoPlaying} onClipEnded={onClipEnded} onClipError={onClipError} clipError={game.clipError} answerLeft={game.answerClock?.left} onClockSecond={onClockSecond} say={speak} onRead={(id, count) => markRead(id, { typed: count })} onEaten={() => bgm.current?.playCue(EAT_DONE)} />}
        {game?.phase === "finished" && <Finished view={game.view} winners={game.winners} reveal={game.reveal} podium={game.podium} narration={narration} unread={!!narration && unreadId === narration.eventId} typedTo={typedTo} epilogue={epilogue} page={game.epiloguePage?.page ?? 0} cuisine={game.cuisine} finale={finale} say={speak} onRead={(id, count) => markRead(id, { typed: count })} onCook={() => bgm.current?.playCue(SFX.cook)} onCue={(cue) => bgm.current?.playCue(SFX[cue])} onPodium={onPodium} />}
        {game?.phase === "playing" && <ReactionFloats floats={floats} teams={game.view.teams} />}
        {transition && <TransitionOverlay key={`${transition.kind}`} play={transition} onDone={endTransition} />}
        {/* A normal flow stack, not two independently-positioned banners: whichever show, they never overlap. */}
        <div className="absolute inset-x-0 top-0 flex flex-col" style={{ zIndex: 20 }}>
          {!game && !tapped && (
            // 32px tall: it ends above the lobby's title line (top 34).
            <div role="status" data-testid="tap-for-sound" className="text-center text-[16px] leading-[22px]" style={{ background: "#fff0a8", color: "var(--ink)", padding: 3, borderBottom: "4px solid var(--k)" }}>
              👆 點一下大螢幕，開啟影片和音樂的聲音
            </div>
          )}
          {disconnected && !rested && (
            <div role="status" className="text-center text-[20px]" style={{ background: "var(--turn)", color: "var(--ink)", padding: 6 }}>
              {DISCONNECTED_NOTICE}
            </div>
          )}
          {unreachable && (
            <div role="alert" className="flex items-center justify-center gap-4 text-center text-[20px]" style={{ background: "var(--turn)", color: "var(--ink)", padding: 6 }}>
              {UNREACHABLE_NOTICE}
              <PixelButton onClick={reconnect} className="!m-0 !px-4 !py-1 text-[18px]">{UNREACHABLE_RETRY_LABEL}</PixelButton>
            </div>
          )}
          {rested && (
            <div role="status" className="flex items-center justify-center gap-4 text-center text-[20px]" style={{ background: "var(--turn)", color: "var(--ink)", padding: 6 }}>
              {REST_NOTICE[rested]}
              <PixelButton onClick={reconnect} className="!m-0 !px-4 !py-1 text-[18px]">{RESTED_RECONNECT_LABEL}</PixelButton>
            </div>
          )}
          {reset && (
            <div className="text-center text-[20px] text-white" style={{ background: "var(--danger)", padding: 6 }}>
              伺服器重新啟動，遊戲已重置
            </div>
          )}
        </div>
      </Stage>
      {/* Outside <Stage>, fixed to the real viewport (not scaled/letterboxed with the 960x540
          canvas) — the 960x540 stage has no free margin left in any phase (Lobby/Playing/
          Finished all use the full width), so a toggle drawn inside it would collide with the
          team-status row or the top banner depending on game phase. A real-size corner control,
          like a video player's mute button living outside the video frame, sidesteps all of
          that and stays a consistent, comfortably tappable size regardless of TV scale
          (/review design finding: the original in-Stage placement was both too small a touch
          target and overlapped the team-status row during Playing). */}
      {showTtsToggle && (
        <PixelButton
          onClick={toggleTts}
          className="!m-0 !px-4 !py-2 text-[16px]"
          style={{ position: "fixed", bottom: 12, right: 12, zIndex: 30 }}
        >
          {ttsOn ? "🔊 語音開" : "🔇 語音關"}
        </PixelButton>
      )}
      {showBgmToggle && (
        <PixelButton
          onClick={toggleBgm}
          className="!m-0 !px-4 !py-2 text-[16px]"
          // Left of the voice toggle, same corner and size (see the comment above it).
          style={{ position: "fixed", bottom: 12, right: showTtsToggle ? 150 : 12, zIndex: 30 }}
        >
          {bgmOn ? "🎵 音樂開" : "🎵 音樂關"}
        </PixelButton>
      )}
    </>
  );
}
