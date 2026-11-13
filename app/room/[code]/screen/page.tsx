"use client";

// The shared big screen. Public: it only ever receives the spectator view and
// never a host-only message, so it can be cast to a TV without leaking answers.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { REST_NOTICE, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { useRoomSocket } from "@/lib/use-room-socket";
import { useWakeLock } from "@/lib/use-wake-lock";
import { DISCONNECTED_NOTICE, UNREACHABLE_NOTICE, UNREACHABLE_RETRY_LABEL } from "@/lib/offline-notice";
import { MAX_HEARTS, REACTIONS, REACT_ROOM_MAX, scoreName, type AnswerReveal, type EventReveal, type FileVideo, type FortuneView, type LobbyTeams, type MediaCommand, type PendingRoll, type PodiumReveal, type PublicMediaContent, type PublicQuestion, type Reaction, type ScreenAudio, type ServerMessage, type SoundCue, type StateMessage, type HostEffect } from "@/lib/protocol";
import { epiloguePages, revealNow, unemoji, type Beat } from "@/lib/podium";
import { CATCH_PAY, checkKey, type LockedOption, type SpectatorView, type WrongAnswer } from "@/lib/game-state";
import { FORK_ARCH, sceneFloor, TEAM_LOOKS } from "@/lib/pixel-art";
import { describeTurn, monsterLook, PHASE_HUE_STEP, roomTheme } from "@/lib/turn-info";
import { ordinal } from "@/lib/ordinal";
import { firstChange, isPending, keepLatest, readCount, type NarrationState } from "@/lib/narration/client";
import { pickVoice, shouldSpeakNarration, speechTimeoutMs, type SpokenNarration } from "@/lib/narration/tts";
import { createBgmPlayer, type BgmPlayer } from "@/lib/bgm-player";
import { ANSWER_TICK, ANSWER_TIME_UP, BOSS_ALARM, BOSS_PARRY, BOSS_RUMBLE, CHEF_SIZZLE, CLERIC_PRAYER, DOOR_CREAK, EAT_DONE, GROWL, HEARTBEAT, MAGE_SPELL, SFX, SOUND_ON, SPRINT_FANFARE, THIEF_SNEAK, THUNDER } from "@/lib/sfx";
import { BOSS_RAGE_THEME, DUNGEON_THEME } from "@/lib/bgm";
import { bossClock, heartbeatTimes, PARRY_MS, parryFor, rageNow } from "@/lib/boss-fx";
import { CLASS_COLOR, CLASS_PULSE, CLASS_TINT, createFlashBudget, GROWL_TINT, HEART_TINT, PARRY_TINT, THUNDER_PULSE, THUNDER_TINT } from "@/lib/flash-budget";
import { playHostEffect, type HostFxLook } from "@/lib/host-fx";
import { CLASS_FX_MS, CLASS_FX_TEXT, classFxFor, playClassFx, type ClassFx, type ClassFxLook } from "@/lib/class-fx";
import { AnswerClock } from "@/components/answer-clock";
import { memoryLine } from "@/lib/memory-copy";
import { ANSWER_WARN_SECONDS } from "@/lib/answer-clock";
import { antiCheatBanner, IN_LOBBY, nextTransition, UNSEEN, type CheatSeen, type Transition } from "@/lib/transitions";
import { TransitionOverlay } from "@/components/transition-overlay";
import { DialogueBox, LabelChip, Nameplate, Panel, PixelButton, prefersReducedMotion, QuestionMedia, SceneBackground, Sprite, TurnRibbon } from "@/components/pixel";
import { FogRevealContext, MapStrip } from "@/components/map-strip";
import { McOption, optionLetter, type OptionLook } from "@/components/mc-option";
import { Qr } from "@/components/qr";
import { Stage } from "@/components/stage";
import { InitiativeOverlay, KillRollOverlay, RollOverlay, TieRollOverlay } from "@/components/d20";
import { MageHint } from "@/components/mage-hint";
import { YoutubePlayer } from "@/components/youtube-player";
import { InstagramPlayer } from "@/components/instagram-player";
import { FilePlayer } from "@/components/file-player";
import { resendClipError, type ClipErrorSeen } from "@/lib/youtube";
import { HowToPlay, INTRO_PAGE_TEXT } from "@/components/how-to-play";
import { CookFrame, dishLine, DishOnStage, dishUp, useCookStep, useFinaleStep, useRevealTime } from "@/components/cooking";
import { ambienceFor, FOG_REVEAL_DELAY_MS, FOG_REVEAL_MS, revealFor, screenAudioOf, type FogReveal } from "@/lib/ambience";
import { getScreenKey } from "@/lib/room-code";
import { sortOrderOf } from "@/lib/sort-order";
import { EventStage } from "@/components/event-room";
import { FortuneCard, FortunePizza } from "@/components/fortune";
import { BOON_TEXT, EVENT_OUTCOME_TITLE, EVENT_SCENE_TEXT, eventEffectLine, FORK_DOOR_LABEL, FORK_SIDE_LABEL, FORTUNE_CONDITION_TEXT } from "@/lib/event-text";

const bgmSupported = () => "AudioContext" in window;

/** True only in a browser that actually implements the Web Speech API. */
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
/** A tile's box. `narrow`: a video question's tiles give the 356 px player (YouTube's minimum, D11) the middle of the wall. */
const tileSpot = (i: number, narrow?: boolean) =>
  narrow ? { left: i % 2 ? 658 : 22, top: TILE_SPOTS[i].top, width: 280 } : { ...TILE_SPOTS[i], width: 316 };

/**
 * The option tiles on the wall (docs/designs/phone-answering.md D1, D8, D9): plain while the team
 * thinks, 🔒 during the beat, the wrong pick red while the team decides, the answer green on a
 * correct reveal. Eliminated options are the grey ✕ 答錯 tile; a mage's removal (`magic`) is grey with no label (D13=A).
 */
function WallOptions({ options, gone, magic, lock, wrong, correct, teamName, narrow }: { options: string[]; gone: number[]; magic: number[]; lock: LockedOption | null; wrong: WrongAnswer | null; correct: number | null; teamName: string; narrow?: boolean }) {
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
            style={{ ...tileSpot(i, narrow), height: 62, zIndex: 5 }}
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
function SortWall({ tiles, narrow }: { tiles: SortTile[]; narrow?: boolean }) {
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
          style={{ ...tileSpot(i, narrow), height: 62, zIndex: 5 }}
        />
      ))}
    </>
  );
}

type YoutubeContent = Extract<PublicMediaContent, { kind: "youtube" }>;
/** The room's last SCREEN_VIDEO: it comes only when this page was opened with the screen key (screen-video-key.md). */
type ShownVideo = Extract<ServerMessage, { type: "SCREEN_VIDEO" }>;
/** A chip that stands in the side column beside a video (D14), at the same 20px as the hints. */
const CHIP = { fontSize: 20, padding: "4px 10px", color: "var(--k)", border: "4px solid var(--k)", whiteSpace: "normal", borderRadius: 12 } as const;

/** ② The parry's beats (lib/boss-fx.ts PARRY_MS). */
type ParryBeat = "charge" | "parry" | "counter";

function Playing({ view, question, reveal, pendingLock, pendingRoll, wrongSlots, eventId, narration, phaseCard, bossPhaseInfo, media, shownVideo, locked, needsTap, onVideoPlaying, onClipEnded, onClipError, clipError, answerLeft, onClockSecond, say, onRead, onEaten, onChef, cuisine, parry, rage }: { view: SpectatorView; question: PublicQuestion | null; reveal: AnswerReveal | null; pendingLock: LockedOption | null; pendingRoll: PendingRoll | null; wrongSlots?: boolean[]; eventId: number; narration: NarrationState; phaseCard?: StateMessage["phaseCard"]; bossPhaseInfo?: StateMessage["bossPhaseInfo"]; media?: MediaCommand; shownVideo: ShownVideo | null; locked: boolean; needsTap: boolean; onVideoPlaying: (playing: boolean) => void; onClipEnded: (questionId: string) => void; onClipError: (questionId: string) => void; clipError?: true; answerLeft?: number | null; onClockSecond: (s: number) => void; say: (lines: string[]) => void; onRead: (eventId: number, count: number) => void; onEaten: () => void; onChef: (bonus?: number) => void; cuisine?: true; parry: ParryBeat | null; rage: boolean }) {
  const turnInfo = describeTurn(view, question, phaseCard?.monster);
  const { team: turn, teamIndex: turnIdx, inBoss, bossHits: hits } = turnInfo;
  // A dish reveal keeps the defeated monster and its room on stage until 下一題 (cooking I6): the next question is
  // already dealt, so describeTurn would show the next team's monster.
  const dish = reveal?.dish;
  const eaterIdx = dish ? view.teams.findIndex((t) => t.id === dish.teamId) : -1;
  // Who scored; a team removed mid-reveal gets no line rather than a nameless one.
  const scorer = reveal?.scored && view.teams.find((t) => t.id === reveal.scored!.teamId);
  const eater = view.teams[eaterIdx];
  const bossScene = dish ? dish.room === null : turnInfo.bossScene;
  const monster = dish ? monsterLook(dish.monster) : turnInfo.monster;
  const theme = dish ? roomTheme(dish.room) : turnInfo.theme;
  // A team removed mid-reveal still leaves its dish line, without the name.
  const line = dish ? dishLine(dish, eater?.name ?? "", false) : "";
  const cook = useCookStep(dish && reveal.served ? `${eventId}` : null, () => say(["上菜！"]), () => (say([line]), onChef(dish?.chefBonus)), eater ? onEaten : undefined); // no 嗝 when the eater's team has left (no one is shown eating)
  const served = cook !== null;
  // The phase card (docs/designs/boss-phases.md, approved mockup panel 1) takes the question's slot, as a reveal does.
  const card = phaseCard && bossPhaseInfo;
  /** ④ The boss's rage shows only while the boss itself is on screen; the music follows it game-wide. */
  const raging = rage && bossScene && !card && !dish;
  const wrong = view.pendingWrong ?? null;
  const nameOf = (id?: string) => view.teams.find((t) => t.id === id)?.name ?? "";
  // A buzzer boss phase (docs/designs/boss-buzzer.md D7): who buzzed, who is out, or the call to buzz.
  // Not while a memory question's media plays: nobody may buzz yet (memory-questions.md).
  const buzz = !reveal && !card && question && !question.memorize ? view.buzz : undefined;
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
  // A reveal with a video, image or Instagram clip needs the panel's full height: it would grow over the tiles, so they
  // go (正解 above names the answer).
  const mediaReveal = !!reveal && (!!reveal.video || (!!reveal.explanation && reveal.explanation.kind !== "text"));
  const wall = served || mediaReveal
    ? null
    : reveal?.choice
    ? { options: reveal.choice.options, correct: reveal.choice.correctIndex, team: nameOf(reveal.choice.teamId), gone: [] as number[], magic: [] as number[] }
    : !reveal && question?.options && question.options.length <= TILE_SPOTS.length
      ? { options: question.options, correct: null, team: nameOf(pendingLock?.teamId ?? wrong?.teamId), gone: view.eliminated?.[question.id] ?? [], magic: view.mageRemoved?.[question.id] ?? [] }
      : null;
  const sortWall = served || mediaReveal ? null : sortTiles(question, reveal, pendingLock, wrong, wrongSlots);
  // Fixed lines, not an LLM call (D8, D9): nothing is narrated until the outcome is known.
  const caught = !reveal ? view.antiCheat?.openCatch : undefined;
  const held = caught
    ? `🚨 ${nameOf(caught.by)}說${nameOf(caught.teamId)}在問 AI！等主持人裁決……`
    : buzz?.teamId
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
        : `${nameOf(wrong.teamId)}答錯了！他們正在決定：下輪再答，還是逃跑……`
      : null;
  // Persuasion check (dnd design R6): a fill-in turn rolls before it answers; its record shows once the beat ends.
  // A memory question's options and items stay hidden while it plays: it is not known as a fill-in until it ends.
  const fillIn = !!question && !question.memorize && !question.options && !question.items && !reveal && !card;
  const check = fillIn && turn ? view.checks?.[checkKey(question!.id, turn.id)] : undefined;
  const stars = question ? "★".repeat(question.difficulty) + "☆".repeat(Math.max(0, 5 - question.difficulty)) : "";
  // A YouTube question, or the reveal showing the answered question's video where it stopped (D17). One slot, one
  // key, so the player is not rebuilt between the question and its reveal.
  const asking = !reveal && !card && question?.content.kind === "youtube";
  // An uploaded video/audio explanation plays in the same slot (uploaded-media.md D4).
  const fileExplanation = reveal?.explanation?.kind === "file" ? reveal.explanation : null;
  const videoQuestion = reveal?.video || fileExplanation ? reveal!.questionId : asking ? question!.id : null;
  // `content` is null while the room has not sent this video's id: for a moment after connecting, or for good when
  // the page was opened without the screen key (`locked`).
  const video: { id: string; content: YoutubeContent | FileVideo | null } | null =
    videoQuestion === null ? null : { id: videoQuestion, content: !locked && shownVideo?.questionId === videoQuestion && (shownVideo.video.kind === "youtube" || shownVideo.video.kind === "file") ? shownVideo.video : null };
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
          🗣️ 說服 DC {dcChip.dc}（+{dcChip.bonus}）
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
  // A video question with option or sort tiles: the panel has no room for the player (it would grow over the tiles),
  // so it stands over the monster between the two tile columns, smaller.
  const tileVideo = asking && !!(wall || sortWall);
  const player = (v: NonNullable<typeof video>, width: number, height: number) =>
    !v.content ? (
      <div data-testid={locked ? "video-locked" : undefined} className="flex shrink-0 items-center justify-center bg-[var(--lav)] p-4 text-center text-[22px] text-[var(--k)]" style={{ width, height, boxShadow: "0 0 0 4px var(--k)" }}>
        {locked && "🔒 請用主持人頁上的大螢幕網址開啟，才會播放影片"}
      </div>
    ) : v.content.kind === "file" ? (
      <FilePlayer
        url={v.content.url}
        command={media?.questionId === v.id ? media : null}
        width={width}
        height={height}
        cover={!!v.content.audioOnly}
        cardTitle={fileExplanation ? "詳解音樂" : reveal ? "正解音樂" : "聽歌猜題"}
        needsTap={needsTap}
        onPlayingChange={onVideoPlaying}
        onEnded={reveal ? undefined : () => onClipEnded(v.id)}
        // An explanation's error reaches the host too (the room clears the question's own at the reveal).
        onError={reveal && !fileExplanation ? undefined : () => onClipError(v.id)}
        errorNote={!reveal && clipError && view.buzz?.open ? "🎤 主持人現場放歌" : undefined}
        title={fileExplanation ? "詳解影片" : reveal ? "正解影片" : "題目影片"}
      />
    ) : (
      <YoutubePlayer
        videoId={v.content.videoId}
        start={v.content.start}
        end={v.content.end}
        command={media?.questionId === v.id ? media : null}
        width={width}
        height={height}
        cover={!reveal && !!v.content.audioOnly}
        needsTap={needsTap}
        onPlayingChange={onVideoPlaying}
        onEnded={reveal ? undefined : () => onClipEnded(v.id)}
        onError={reveal ? undefined : () => onClipError(v.id)}
        // The host plays the song from their own device (boss-music-buzzer.md M4).
        errorNote={!reveal && clipError && view.buzz?.open ? "🎤 主持人現場放歌" : undefined}
        title={reveal ? "正解影片" : "題目影片"}
        // Not while answering: a music question's captions would show the lyrics or the title.
        zhCaptions={!!reveal}
      />
    );
  const lone = !!reveal && reveal.explanation?.kind !== "text";
  const mediaExplanation = reveal?.explanation && reveal.explanation.kind !== "text" && reveal.explanation.kind !== "instagram" && reveal.explanation.kind !== "file" ? reveal.explanation : null;
  // An Instagram explanation (instagram-explanations.md): its shortcode comes in SCREEN_VIDEO, like a question video's id.
  const instagram = reveal?.explanation?.kind === "instagram" ? { content: !locked && shownVideo?.questionId === reveal.questionId && shownVideo.video.kind === "instagram" ? shownVideo.video : null } : null;

  return (
    <>
      <SceneBackground theme={theme} />
      {/* D1: the tiles stand where the torches hang. */}
      {!wall && !sortWall && <Torches />}
      <Sparks />
      {wall && <WallOptions options={wall.options} gone={wall.gone} magic={wall.magic} lock={pendingLock} wrong={wrong} correct={wall.correct} teamName={wall.team} narrow={tileVideo} />}
      {sortWall && <SortWall tiles={sortWall} narrow={tileVideo} />}

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
          {/* 🔮 The team on turn asked the oracle about this question (anti-ai-cheating.md): everyone knows it pays half. */}
          {!reveal && !card && turn?.oracle && (
            <span data-testid="screen-oracle" className="px-chip text-[18px] leading-none" style={{ background: "#c9b3ff", color: "var(--k)" }}>
              🔮 {turn.name}請示了神諭（獎勵減半）
            </span>
          )}
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
          // A portrait Instagram clip stands beside the answer: below it, it would run off the stage.
          <div data-testid="answer-reveal" className={instagram ? "flex items-start justify-center gap-6" : "flex flex-col items-center gap-2"}>
            <div className="flex flex-col items-center gap-2">
            {/* Won before its question was shown (a persuasion 20, or judged before the roll): the question comes with its answer. */}
            {reveal.asked && (reveal.asked.content.kind === "text" ? reveal.asked.content.value : reveal.asked.prompt) && (
              <div data-testid="reveal-question" className="text-[24px] [overflow-wrap:anywhere]">{reveal.asked.content.kind === "text" ? reveal.asked.content.value : reveal.asked.prompt}</div>
            )}
            {reveal.asked?.content.kind === "image" && <QuestionMedia key={`asked-${reveal.questionId}`} content={reveal.asked.content} maxWidth={260} maxHeight={160} className="mx-auto block" />}
            {/* A music question with fields: which ones the team got (docs/designs/multi-field.md F7). */}
            {reveal.fields ? (
              <ul data-testid="reveal-fields" className="flex flex-col gap-1">
                {reveal.fields.marks.map((f, i) => (
                  <li key={i} style={f.right ? undefined : { opacity: 0.6 }}>
                    <span aria-label={f.right ? "答對" : "沒答對"}>{f.right ? "✓" : "✗"}</span> {f.label}：{f.answer}
                  </li>
                ))}
                {/* Only a partial answer says what it earned (multi-field.md D5). */}
                {((k, n) =>
                  k > 0 && k < n && (
                    <li data-testid="reveal-fields-partial" className="text-[18px]">
                      {view.teams.find((t) => t.id === reveal.fields!.teamId)?.name} 對 {k}/{n}：打掉 {k} 格血、獎勵拿 {Math.round((k / n) * 100)}%
                    </li>
                  ))(reveal.fields.marks.filter((f) => f.right).length, reveal.fields.marks.length)}
              </ul>
            ) : (
              <div>正解：{reveal.answer}</div>
            )}
            {/* Who scored, the one line the room reads off the reveal (no scoreboard: the meters say the rest). A partial
                music answer has its own 「對 k/n」 line above, so it gets no 「答對」. */}
            {reveal.caught && (
              <div data-testid="reveal-caught" className="text-[24px] [overflow-wrap:anywhere]" style={{ color: "var(--danger)" }}>
                🚨 抓包成立：{nameOf(reveal.caught.teamId)} 這題不算，{nameOf(reveal.caught.by)} +{CATCH_PAY.bounty}
              </div>
            )}
            {reveal.scored && scorer && !reveal.fields?.marks.some((f) => !f.right) && (
              <div data-testid="reveal-result" className="text-[24px] [overflow-wrap:anywhere]">
                ✅ {scorer.name} 答對 +{reveal.scored.points} {scoreName(cuisine)}
              </div>
            )}
            {/* With the video up, its text explanation stands beside it instead. */}
            {!video && reveal.explanation?.kind === "text" && <div className="text-[20px]">{reveal.explanation.value}</div>}
            {mediaExplanation && (
              // A video explanation is at least 356×200 (YouTube's minimum, D11). The dish waits for 上菜 (cooking R4).
              // key tied to questionId: a 404'd explanation image must not stay hidden on later reveals.
              <QuestionMedia key={reveal.questionId} content={mediaExplanation} label="詳解" maxWidth={356} maxHeight={200} className="mx-auto block" zhCaptions />
            )}
            </div>
            {instagram &&
              (instagram.content ? (
                // Portrait, so it gets a tall box of its own rather than the 356×200 a YouTube explanation has: as tall as
                // the panel can grow before the dialogue box.
                <InstagramPlayer key={reveal.questionId} shortcode={instagram.content.shortcode} end={instagram.content.end} command={media?.questionId === reveal.questionId ? media : null} maxWidth={260} maxHeight={280} onPlayingChange={onVideoPlaying} />
              ) : (
                <div data-testid={locked ? "video-locked" : undefined} className="flex items-center justify-center bg-[var(--lav)] p-4 text-center text-[20px] text-[var(--k)]" style={{ width: 260, height: 160, boxShadow: "0 0 0 4px var(--k)" }}>
                  {locked && "🔒 請用主持人頁上的大螢幕網址開啟，才會播放影片"}
                </div>
              ))}
          </div>
        ) : question ? (
          // Check first, question after: the room sends no text until the die's beat ends.
          question.checkFirst ? <span data-testid="screen-check-first">{wrong || (pendingRoll && pendingRoll.kind !== "check") ? "……" : pendingRoll || !turn ? "🎲 說服檢定中……擲完才出題" : `${turn.name}：按手機上的「🎲 擲骰說服」，擲完才出題`}</span> :
          // 記憶題 (memory-questions.md): the room sends only the media while it plays; the question comes after.
          question.memorize ? (
            <span data-testid="screen-memorize" role="status" className="inline-flex flex-wrap items-center justify-center gap-2">
              {memoryLine(question, view.buzz ? undefined : turn?.name, media)}
              {question.memoryLeft !== undefined && <AnswerClock key={`memory:${question.id}:${question.memoryLeft}`} ms={question.memoryLeft} variant="chip" />}
            </span>
          ) :
          question.content.kind === "text" ? question.content.value : <div style={{ fontSize: 26 }}>{question.prompt ?? ""}</div>
        ) : "……"}
        {tileVideo && <div className="mt-3 flex flex-col items-center gap-2">{beside}</div>}
        {video && !tileVideo && (
          // A reveal with nothing beside its video centres it (D18); the player stays the first child, so it is kept.
          <div key={video.id} className={`mt-3 flex items-start gap-4 text-left${lone ? " justify-center" : ""}`}>
            {/* One size for the question and its reveal: width/height rebuild the player (D17). */}
            {player(video, 384, 216)}
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
        {!reveal && question && question.content.kind === "image" && !wall && !sortWall && (
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
      {/* With option or sort tiles on the wall the panel has no room for an image: it would grow over the tiles.
          It stands over the monster instead, between the two tile columns (before the chips, which stay on top). */}
      {!served && !reveal && !card && question?.content.kind === "image" && (wall || sortWall) && (
        <Panel className="absolute" style={{ left: "50%", top: 236, transform: "translateX(-50%)", padding: 4, zIndex: 6 }}>
          <QuestionMedia key={question.id} content={question.content} maxWidth={260} maxHeight={126} className="block" />
        </Panel>
      )}
      {tileVideo && video && (
        <div key={video.id} className="absolute" style={{ left: "50%", top: 196, transform: "translateX(-50%)", zIndex: 6 }}>
          {player(video, 356, 200)}
        </div>
      )}

      {/* D17=A: a thief's armed Sneak Attack hangs over the monster until its answer is judged. */}
      {sneakChip && !asking && (
        <div className="px-chip absolute" style={{ left: "50%", top: 262, transform: "translateX(-50%)", zIndex: 6, fontSize: 22, padding: "6px 14px", background: "#ff8787", color: "var(--k)", border: "4px solid var(--k)" }}>
          🗝️ 偷襲！這題答對加碼
        </div>
      )}
      {dcChip && !asking && (
        <div data-testid="screen-check-dc" className="px-chip absolute" style={{ left: "50%", top: 262, transform: "translateX(-50%)", zIndex: 6, fontSize: 22, padding: "6px 14px", background: "var(--warn)", color: "var(--k)", border: "4px solid var(--k)" }}>
          🗣️ 說服 DC {dcChip.dc}（+{dcChip.bonus}）
        </div>
      )}
      <div className="absolute" style={{ left: "50%", bottom: 136, width: bossScene ? 210 : 170, height: 18, transform: "translateX(-50%)", background: "#0007", zIndex: 3, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" }} />
      {cook === 1 || cook === 2 ? <CookFrame step={cook} bottom={140} /> : !dishUp(cook) && (
      <div key={`${monster.kind}-${hits}`} className="absolute" style={{ left: "50%", bottom: monster.float ? 150 : 146, transform: "translateX(-50%)", zIndex: 4 }}>
        {/* ④ Rage jitters the whole boss; ② the parry's charge and counter wrap the sprite, whose own class never changes
            (a class coming back would replay its animation, px-hit's shake after a miss). */}
        <div className={raging ? "px-rage" : undefined}>
          <div className={parry === "charge" ? "px-parry-charge" : parry === "counter" ? "px-parry-counter" : undefined}>
            <div key={card ? `card-${eventId}` : undefined} className={`${card ? "px-phase-blink" : hits > 0 && inBoss ? "px-hit" : monster.float ? "px-float" : "px-idle"}${raging ? " px-rage-outline" : ""}`}>
              <Sprite kind={monster.kind} scale={monster.scale} hue={monster.hue} accessory={monster.accessory} />
            </div>
          </div>
        </div>
      </div>
      )}
      {/* ② The parry (0.6–0.9 s): a shield in front of the boss, the attack's sword bounced off with a spark. */}
      {parry === "parry" && (
        <div data-testid="boss-parry" aria-hidden className="pointer-events-none absolute" style={{ left: "50%", bottom: 190, transform: "translateX(-50%)", zIndex: 5, fontSize: 64, lineHeight: 1 }}>
          <span>🛡️</span>
          <span className="absolute" style={{ left: 70, top: -40, fontSize: 48 }}>⚔️</span>
          <span className="absolute text-[var(--warn)]" style={{ left: 52, top: -8, fontSize: 32 }}>✦</span>
        </div>
      )}
      {/* 每題作答倒數 (answer-countdown.md D5): the round clock right of the monster; with tiles on the wall, a pill under B/D,
          above the dialogue box (z 7) so a three-row narration line never hides it. */}
      {typeof answerLeft === "number" && !reveal && !card && (
        <div className="absolute" style={wall || sortWall ? { right: 22, bottom: 116, zIndex: 8 } : { left: "calc(50% + 170px)", bottom: 150, zIndex: 6 }}>
          <AnswerClock key={`${eventId}:${answerLeft}`} ms={answerLeft} variant={wall || sortWall ? "wall" : "big"} onSecond={onClockSecond} />
        </div>
      )}
      {(cook === null || cook === 0) && (
      <Nameplate className="absolute" style={{ left: "50%", bottom: 112, transform: "translateX(-50%)", zIndex: 5, color: bossScene ? "#b02a3a" : undefined }}>
        <span>{monster.name}</span>
        {/* Over 20 HP (multi-field.md E5) hearts no longer fit 1280 px (25 px each): one continuous bar with the count. */}
        {bossScene && view.bossMaxHp > MAX_HEARTS && (
          <span data-testid="boss-hp-bar" className="ml-[14px] flex items-center gap-2">
            <span className="relative inline-block h-[16px] w-[300px]" style={{ background: "#3a2b55", boxShadow: "0 0 0 3px var(--k)" }}>
              <span className="absolute inset-y-0 left-0" style={{ width: `${(100 * (card ? view.bossMaxHp : view.bossHp)) / view.bossMaxHp}%`, background: "var(--danger)" }} />
            </span>
            <span className="px-num text-[14px]">{card ? view.bossMaxHp : view.bossHp}/{view.bossMaxHp}</span>
          </span>
        )}
        {bossScene && view.bossMaxHp <= MAX_HEARTS && (
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
        {raging && (
          <span data-testid="boss-rage" className="ml-[10px] text-[16px] text-white" style={{ background: "var(--danger)", padding: "0 6px", boxShadow: "0 0 0 3px var(--k)" }}>
            🔥 暴走！
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

/** ❓ 神秘房's outcome on the big screen (event-rooms.md D6, branch-fork.md): the scene in the arch and what it did, until
 * 下一題. The turn has passed on: the stage stays the event team's, one room back. */
function EventRoomScreen({ view, reveal, eventId, narration, onRead }: { view: SpectatorView; reveal: EventReveal; eventId: number; narration: NarrationState; onRead: (eventId: number, count: number) => void }) {
  const idx = view.teams.findIndex((t) => t.id === reveal.teamId);
  const team = view.teams[idx];
  const text = EVENT_SCENE_TEXT[reveal.scene];
  const name = team?.name ?? "";
  return (
    <>
      <SceneBackground theme={roomTheme(Math.max(0, (team?.roomIndex ?? 0) - 1))} />
      <Torches />
      <Sparks />
      <div className="absolute flex items-start gap-3" style={{ left: 18, right: 18, top: 24, zIndex: 6 }}>
        {team && <TurnRibbon color={look(idx).hat} maxWidth={420}>{`❓ ${name}`}</TurnRibbon>}
        <MapStrip view={view} />
      </div>
      <Panel className="absolute text-center" style={{ left: 110, right: 110, top: 96, padding: "32px 24px 12px", fontSize: 30, lineHeight: 1.3, zIndex: 5 }}>
        <div className="absolute flex justify-between text-[14px]" style={{ left: 16, right: 16, top: 6 }}>
          <LabelChip>❓ 神秘房</LabelChip>
        </div>
        <div data-testid="event-result" className="flex flex-col items-center gap-1">
          <div className="px-title-gold px-title-sm" style={{ fontSize: 38, lineHeight: 1.2 }}>{EVENT_OUTCOME_TITLE[reveal.outcome]}</div>
          <div className="text-[24px]">{reveal.dish ? `${reveal.dish.name}！` : ""}{name} {eventEffectLine(reveal)}</div>
        </div>
      </Panel>
      <div className="absolute" style={{ left: "50%", bottom: 136, width: 170, height: 18, transform: "translateX(-50%)", background: "#0007", zIndex: 3, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" }} />
      <div key={`${reveal.scene}-open`} className="absolute" style={{ left: "50%", bottom: 146, transform: "translateX(-50%)", zIndex: 4 }}>
        <EventStage scene={reveal.scene} reveal={reveal} height={120} />
      </div>
      <Nameplate className="absolute" style={{ left: "50%", bottom: 112, transform: "translateX(-50%)", zIndex: 5 }}>
        <span>{text.name}</span>
      </Nameplate>
      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        loading={isPending(eventId, narration)}
        lines={narration ? narration.lines : [`${name}打開了神秘房……`]}
        {...(narration ? { id: narration.eventId, onRead: (count: number) => onRead(narration.eventId, count) } : {})}
      />
    </>
  );
}

/** 占卜師 on the big screen (fortune-teller.md): the crystal ball with the condition, then the pizza and its clock, the
 * picked slice lit, then the effect card with every team the condition hit, until 下一題. The view is the game from before
 * the pick until the card. */
function FortuneScreen({ view, fortune, left, eventId, narration, onRead }: { view: SpectatorView; fortune: FortuneView; left?: number; eventId: number; narration: NarrationState; onRead: (eventId: number, count: number) => void }) {
  const idx = view.teams.findIndex((t) => t.id === fortune.teamId);
  const team = view.teams[idx];
  const name = team?.name ?? "";
  return (
    <>
      <SceneBackground theme={roomTheme(Math.max(0, (team?.roomIndex ?? 0) - (fortune.step === "card" ? 1 : 0)))} />
      <Torches />
      <Sparks />
      <div className="absolute flex items-start gap-3" style={{ left: 18, right: 18, top: 24, zIndex: 6 }}>
        {team && <TurnRibbon color={look(idx).hat} maxWidth={420}>{`🔮 ${name}`}</TurnRibbon>}
        <MapStrip view={view} />
      </div>
      <div className="absolute" style={{ right: 60, top: 108, zIndex: 6 }}>
        {fortune.timeout ? (
          <span className="px-chip" style={{ fontSize: 26, background: "var(--danger)", color: "var(--k)" }}>⏳ 時間到</span>
        ) : typeof left === "number" && fortune.step === "choose" ? (
          <AnswerClock key={left} ms={left} variant="big" />
        ) : null}
      </div>
      <Panel className="absolute text-center" style={{ left: 110, right: 110, top: 96, padding: "16px 24px 12px", fontSize: 26, lineHeight: 1.3, zIndex: 5 }}>
        <div data-testid="fortune-screen" data-step={fortune.step}>{fortune.step === "card" ? (
          <FortuneCard fortune={fortune} teams={view.teams} heroScale={4} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="px-title-gold px-title-sm" style={{ fontSize: 34, lineHeight: 1.2 }}>{EVENT_OUTCOME_TITLE.fortune}</div>
            <div data-testid="fortune-condition">{FORTUNE_CONDITION_TEXT[fortune.condition].text}……</div>
            {fortune.step === "intro" ? (
              <div className="px-float" style={{ fontSize: 120, lineHeight: 1 }}>🔮</div>
            ) : (
              <FortunePizza lit={fortune.effect} size={210} />
            )}
          </div>
        )}</div>
      </Panel>
      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        loading={isPending(eventId, narration)}
        lines={narration ? narration.lines : [`占卜師看著${name}……`]}
        {...(narration ? { id: narration.eventId, onRead: (count: number) => onRead(narration.eventId, count) } : {})}
      />
    </>
  );
}

/** 叉路 on the big screen (branch-fork.md): the middle arch is bricked up and a door stands in each of two doorways, 左門
 * and 右門, nothing behind either told. Once a side is picked (forkBeat) its door swings open and names what was behind it;
 * the other dims and stays unnamed. A timeout is marked ⏳ first. */
function ForkScreen({ view, beat, left, eventId, narration, onRead }: { view: SpectatorView; beat?: StateMessage["forkBeat"]; left?: number; eventId: number; narration: NarrationState; onRead: (eventId: number, count: number) => void }) {
  const idx = view.teams.findIndex((t) => t.id === (beat ? beat.teamId : view.currentTurnTeamId));
  const team = view.teams[idx];
  const name = team?.name ?? "";
  // The doors sit on the background's doorways: scene pixels (160x90) times the stage's 6 (960x540).
  const px = 960 / 160;
  const doorTop = (sceneFloor(90) - FORK_ARCH.h) * px;
  return (
    <>
      <SceneBackground theme={roomTheme(team?.roomIndex ?? 0)} arch="fork" />
      <Torches />
      <Sparks />
      <div className="absolute flex items-start gap-3" style={{ left: 18, right: 18, top: 24, zIndex: 6 }}>
        {team && <TurnRibbon color={look(idx).hat} maxWidth={420}>{`輪到：${name}`}</TurnRibbon>}
        <MapStrip view={view} />
      </div>
      <Panel className="absolute text-center" style={{ left: 250, right: 250, top: 104, padding: "10px 24px", zIndex: 5 }}>
        <div className="px-title-gold px-title-sm" style={{ fontSize: 40, lineHeight: 1.2 }}>🔀 叉路！</div>
      </Panel>
      <div className="absolute" style={{ right: 60, top: 108, zIndex: 6 }}>
        {beat?.timeout ? (
          <span data-testid="fork-timeout" className="px-chip" style={{ fontSize: 26, background: "var(--danger)", color: "var(--k)" }}>⏳ 時間到</span>
        ) : typeof left === "number" && !beat ? (
          <AnswerClock key={left} ms={left} variant="big" />
        ) : null}
      </div>
      <div data-testid="fork-doors" className="pointer-events-none absolute inset-0">
        {(["left", "right"] as const).map((side) => {
          const open = beat?.side === side;
          const dim = !!beat && !open;
          const x = (80 + (side === "left" ? -FORK_ARCH.dx : FORK_ARCH.dx) - FORK_ARCH.w / 2) * px;
          return (
            <div key={side} data-side={side} {...(open ? { "data-testid": "fork-door-open", "data-door": beat.door } : {})} style={{ opacity: dim ? 0.3 : 1, filter: dim ? "grayscale(1)" : undefined }}>
              <Nameplate className="absolute" style={{ left: x + (FORK_ARCH.w * px) / 2, top: doorTop - 62, transform: "translateX(-50%)", zIndex: 5 }}>
                <span>{open ? FORK_DOOR_LABEL[beat.door] : FORK_SIDE_LABEL[side]}</span>
              </Nameplate>
              {/* The opened door swings in on its hinge, leaving the dark doorway behind it. */}
              <div className="absolute" style={{ left: x, top: doorTop, zIndex: 4, transformOrigin: "left center", transform: open ? "perspective(600px) rotateY(-80deg)" : undefined, transition: prefersReducedMotion() ? undefined : "transform 700ms ease-out" }}>
                <Sprite kind="door" scale={px} />
              </div>
            </div>
          );
        })}
      </div>
      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        loading={isPending(eventId, narration)}
        lines={narration ? narration.lines : [`${name}走到了叉路口……`]}
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
        {/* N is every holder, as in the narration's 「{first}等 N 隊」 (lib/podium.ts): 「等 1 隊」 after two names read as one team. */}
        {beat.teamIds.length > 2 && <div className="text-[18px]">等 {beat.teamIds.length} 隊</div>}
        <div data-testid="award-reason" className="text-[20px]">{beat.reason}</div>
      </Panel>
    </div>
  );
}

function Finished({ view, winners, reveal, podium, narration, unread, typedTo, epilogue, page, cuisine, finale, say, onRead, onCook, onChef, onCue, onPodium }: { view: SpectatorView; winners: string[]; reveal: AnswerReveal | null; podium?: PodiumReveal; narration: NarrationState; unread: boolean; typedTo: number; epilogue: string | null; page: number; cuisine?: true; finale: boolean; say: (lines: string[]) => void; onRead: (eventId: number, count: number) => void; onCook: () => void; onChef: (bonus?: number) => void; onCue: (cue: SoundCue) => void; onPodium: () => void }) {
  const dish = reveal?.dish;
  const line = dish ? dishLine(dish, "", true) : "";
  // The boss cooks first and the winner waits (cooking R8, I4): only a kill this screen saw live plays it.
  const step = useFinaleStep(finale && !!dish, onCook, () => (say([line]), onChef(dish?.chefBonus)));
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
  const [shownVideo, setShownVideo] = useState<ShownVideo | null>(null);
  /** The room refused this page's screen key, or it has none (SCREEN_KEY): it will be sent no question video. */
  const [locked, setLocked] = useState(false);
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
  /** 抓包與神諭's banners (anti-ai-cheating.md): what this connection last saw; null until a STATE after connecting. */
  const cheatSeen = useRef<CheatSeen | null>(null);
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
    if (next) {
      bgm.current?.playCue(BOSS_ALARM);
      bgm.current?.playCue(BOSS_RUMBLE, "boss");
    }
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

  // --- The host's sound switches (immersion.md PR3, UC1): ⚙ 更多 sets 🎵, 🔊 and 🌧 for every big screen ---
  const [screenAudio, setScreenAudio] = useState(() => screenAudioOf(null));

  // --- TTS (docs/designs/dm-voice-narration-tts.md) ---
  const ttsOn = screenAudio.voice;
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

  /** The voice has been primed inside a gesture: Safari/iOS gate speech behind a user gesture that itself speaks (see
   * the design doc's Approach A note), and a narration arriving minutes later is no gesture. Primed whatever 🔊 is set
   * to, so the host can turn it on later without anyone touching the TV. */
  const ttsPrimed = useRef(false);
  function primeTts() {
    if (ttsPrimed.current || !ttsSupported()) return;
    ttsPrimed.current = true;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }

  // --- Background music (lib/bgm.ts): the host's 🎵 switch, on by default ---
  const bgmOn = screenAudio.music;
  const showBgmToggle = useSyncExternalStore(noSubscribe, bgmSupported, () => false);
  const bgm = useRef<BgmPlayer | null>(null);
  /** The AudioContext is awake (a tap on the page woke it): sound can play. */
  const [audioRunning, setAudioRunning] = useState(false);
  const player = () => (bgm.current ??= createBgmPlayer(() => setAudioRunning(bgm.current?.running() ?? false)));
  /** 聲音就緒 (immersion.md PR0): the context is awake and 🎵 is on. The 語音 switch does not count. */
  const soundReady = audioRunning && bgmOn;
  // The music stays silent from a buzz until the host judges it, and while the host plays the song from their own
  // device (boss-music-buzzer.md M3, M4): the room must hear the answer, and the song.
  const buzzView = game?.phase === "playing" ? game.view.buzz : undefined;
  const held = !!buzzView?.teamId || (!!game?.clipError && !!buzzView?.open);
  useEffect(() => {
    player().hold(held);
  }, [held]);

  /** Wake the sound inside a gesture (a click or a key press: browsers only let audio start then), start the music if
   * the host's 🎵 is on, and prime the voice. */
  function wakeSound() {
    primeTts();
    if (bgmSupported()) void player().unlock();
  }
  useEffect(() => {
    // The first click or key press on the page wakes the sound (immersion.md eng: unlock is not music). One gesture
    // unlocks; after that, only the 「👆 開聲音」 button does.
    const off = () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    const unlock = () => {
      off();
      wakeSound();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return off;
    // Once, on mount: wakeSound reads refs, not render values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the music under the narration voice: lower it while speechSynthesis is talking.
  useEffect(() => {
    if (!bgmOn) return;
    const id = setInterval(() => bgm.current?.duck(ttsSupported() && window.speechSynthesis.speaking), 250);
    return () => clearInterval(id);
  }, [bgmOn]);

  useEffect(() => () => bgm.current?.close(), []);

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
  /** The video this screen's player shows 影片無法播放 for, re-sent after a reconnect (resendClipError). Any playing /
   * paused report clears it, and so does the player's cleanup (a retry or unmount reports not playing). */
  const clipErrored = useRef<ClipErrorSeen | null>(null);
  /** Set by onOpen: the next STATE decides whether to report clipErrored again. */
  const clipResendDue = useRef(false);
  /** The last question whose clip ended here, re-sent after a reconnect: a report sent while the socket was down
   * reaches the room before this socket's SCREEN_HELLO, so the room drops it. Forgotten once another question is up
   * or the game is over: the same question may come round again, and then its clip has not ended. */
  const clipEnded = useRef<string | null>(null);
  /** This screen's player is playing a clip: a SCREEN_EFFECT is dropped (immersion.md PR2). */
  const videoPlaying = useRef(false);
  /** From the player's real state (the clip stops itself at its end): the music goes silent (D10) and a line still
   * being read stops, since the host pressed ▶ to hear the song (D20). */
  function onVideoPlaying(playing: boolean) {
    clipErrored.current = null;
    videoPlaying.current = playing;
    player().mute(playing);
    if (playing && ttsSupported()) {
      window.speechSynthesis.cancel();
      pendingLines.current = null;
    }
  }

  function onClipEnded(questionId: string) {
    clipEnded.current = questionId;
    send({ type: "SCREEN_CLIP_ENDED", questionId });
  }
  function onClipError(questionId: string) {
    clipErrored.current = { questionId, press: game?.media?.questionId === questionId ? game.media.press : 0 };
    send({ type: "SCREEN_CLIP_ERROR", questionId });
  }
  // --- Boss effects (docs/designs/immersion.md PR1 ②–④) ---
  /** The shared flash budget: every new effect asks before it flashes; reduced motion never flashes. */
  const flashBudget = useRef(createFlashBudget());
  const flash = useCallback(() => !prefersReducedMotion() && flashBudget.current.take(), []);
  /** The last STATE on this connection, null until the first after connecting (live-only effects). */
  const prevState = useRef<StateMessage | null>(null);
  /** ② The running parry's beat, its edge flash, and the key of the last wrong answer parried. */
  const [parry, setParry] = useState<ParryBeat | null>(null);
  const [parryEdge, setParryEdge] = useState<"flash" | "tint" | null>(null);
  const parryKey = useRef<string | null>(null);
  const parryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const parryRunning = useRef(false);
  /** A `retry` cue that came while the parry ran: it plays when the counter ends. */
  const parryRetry = useRef(false);
  function endParry() {
    parryTimers.current.forEach(clearTimeout);
    parryTimers.current = [];
    parryRunning.current = false;
    setParry(null);
    setParryEdge(null);
    if (parryRetry.current) bgm.current?.playCue(SFX.retry);
    parryRetry.current = false;
  }
  function startParry() {
    parryTimers.current.forEach(clearTimeout);
    parryRunning.current = true;
    const at = (ms: number, f: () => void) => parryTimers.current.push(setTimeout(f, ms));
    bgm.current?.playCue(BOSS_PARRY, "boss");
    setParry("charge");
    setParryEdge(null);
    at(PARRY_MS.parry, () => setParry("parry"));
    at(PARRY_MS.counter, () => {
      setParry("counter");
      // One red edge pulse, or the static tint held 500 ms when the budget (or reduced motion) says no.
      const lit = flash();
      setParryEdge(lit ? "flash" : "tint");
      at(lit ? 250 : 500, () => setParryEdge(null));
    });
    at(PARRY_MS.end, endParry);
  }
  /** ④ The song the last STATE asked for: rage or not, null until the first STATE after connecting. */
  const rageMusic = useRef<boolean | null>(null);
  /** ③ The boss clock's turn (`teamId:questionId`) while one runs, and the heartbeat playing for it. */
  const heartKey = useRef<string | null>(null);
  const heart = useRef<{ key: string; cancel: () => void } | null>(null);
  const [heartGlow, setHeartGlow] = useState<"pulse" | "tint" | null>(null);
  const bgmOnNow = useRef(false);
  const transitionOn = useRef(false);
  const stopHeart = useCallback(() => {
    heart.current?.cancel();
    heart.current = null;
    setHeartGlow(null);
  }, []);
  const startHeart = useCallback(
    (s: number) => {
      const key = heartKey.current;
      if (!key || heart.current || !bgmOnNow.current) return;
      const times = heartbeatTimes(s);
      const silence = bgm.current?.pattern(HEARTBEAT, times, "boss") ?? (() => {});
      // Each beat's edge glow is one flash: lit then dark. Over a transition, or refused, the static tint instead.
      const timers = times.map((t) =>
        setTimeout(() => {
          if (transitionOn.current || !flash()) return setHeartGlow("tint");
          setHeartGlow("pulse");
          setTimeout(() => setHeartGlow((g) => (g === "pulse" ? null : g)), 150);
        }, t * 1000),
      );
      heart.current = {
        key,
        cancel: () => {
          silence();
          timers.forEach(clearTimeout);
        },
      };
    },
    [flash],
  );
  useEffect(() => {
    bgmOnNow.current = bgmOn;
  }, [bgmOn]);
  /** The switches a LOBBY or STATE carries, applied at once (on connect and reconnect too). 🎵 off stops the music and
   * ③'s heartbeat with it (the host layer still sounds); 🔊 off cuts the voice and drops anything waiting to be read. */
  function applyScreenAudio(next: ScreenAudio) {
    const voiceWasOn = screenAudio.voice;
    setScreenAudio(next);
    player().setMusic(next.music);
    bgmOnNow.current = next.music; // now, not after the render: a countdown tick in between must not restart the heartbeat
    // stopHeart's body, inline: calling it from here makes the React compiler give up on the page's memoization.
    if (!next.music && heart.current) {
      heart.current.cancel();
      heart.current = null;
      setHeartGlow(null);
    }
    if (!voiceWasOn || next.voice || !ttsSupported()) return; // only when 🔊 turns off, not on every STATE
    speech.current = null; // before cancel(): see speakAt's guard
    window.speechSynthesis.cancel();
    pendingLines.current = null;
    if (progress.current) progress.current.spoken = null;
  }
  useEffect(() => {
    transitionOn.current = !!transition;
  }, [transition]);
  const heldNow = useRef(false);
  useEffect(() => {
    heldNow.current = held;
  }, [held]);
  // The room ambience (immersion.md PR3): one per room, crossfaded when the room on stage changes. Never wakes the sound.
  const ambience = ambienceFor(game);
  useEffect(() => {
    player().setAmbience(ambience);
  }, [ambience]);
  // The fog reveal (immersion.md PR3): clouds sit on the room a team just opened, then blow off with the door's creak
  // once the correct-answer cue has played. A video, a buzz waiting on the host or a banner then skips it.
  const [fogReveal, setFogReveal] = useState<FogReveal | null>(null);
  const fogTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  function clearFog() {
    fogTimers.current.forEach(clearTimeout);
    fogTimers.current = [];
    setFogReveal(null);
  }
  function startFog(room: number) {
    clearFog(); // a newer room replaces the old reveal
    setFogReveal({ room, step: "covered", lit: false });
    fogTimers.current.push(
      setTimeout(() => {
        if (videoPlaying.current || heldNow.current || transitionOn.current) return clearFog();
        bgm.current?.playCue(DOOR_CREAK);
        setFogReveal({ room, step: "blow", lit: flash() });
        fogTimers.current.push(setTimeout(clearFog, FOG_REVEAL_MS));
      }, FOG_REVEAL_DELAY_MS),
    );
  }
  useEffect(
    () => () => {
      parryTimers.current.forEach(clearTimeout);
      fogTimers.current.forEach(clearTimeout);
      heart.current?.cancel();
      if (hostFxTimer.current) clearTimeout(hostFxTimer.current);
      classTimers.current.forEach(clearTimeout);
    },
    [],
  );

  // --- The class moments (lib/class-fx.ts): the mage's, cleric's and thief's edge pulse or tint, badge and sound.
  const [classFx, setClassFx] = useState<{ fx: ClassFxLook; edge: boolean; parried: boolean } | null>(null);
  const classTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearClassFx = useCallback(() => {
    classTimers.current.splice(0).forEach(clearTimeout);
    setClassFx(null);
  }, []);
  const onClassFx = useCallback(
    (fx: ClassFx) => {
      playClassFx(fx, {
        clipPlaying: videoPlaying.current,
        reducedMotion: prefersReducedMotion(),
        transitionUp: transitionOn.current,
        parrying: parryRunning.current,
        takeFlash: () => flashBudget.current.take(),
        play: (k) => bgm.current?.playCue(k === "mage" ? MAGE_SPELL : k === "cleric" ? CLERIC_PRAYER : THIEF_SNEAK),
        show: (look) => {
          // A newer moment replaces a running one. The pulse is lit 0.25 s, a tint held 0.5 s; the badge stays CLASS_FX_MS.
          clearClassFx();
          // A spend during a parry keeps its badge hidden even after the parry ends: it would pop up late and cut short.
          setClassFx({ fx: look, edge: true, parried: parryRunning.current });
          classTimers.current.push(setTimeout(() => setClassFx((c) => (c && { ...c, edge: false })), look.look === "flash" ? 250 : 500));
          classTimers.current.push(setTimeout(() => setClassFx(null), CLASS_FX_MS));
        },
      });
    },
    [clearClassFx],
  );
  /** The chef's （廚師 +N） on the dish card: a small pop, never over this screen's own clip. */
  const onChef = useCallback((bonus?: number) => {
    if (bonus && !videoPlaying.current) bgm.current?.playCue(CHEF_SIZZLE);
  }, []);

  // --- The host's pads (immersion.md PR2): ⚡ an edge pulse or tint, 👹 a shake or tint, over everything but the banners.
  const [hostFx, setHostFx] = useState<HostFxLook | null>(null);
  const hostFxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHostEffect = useCallback((effect: HostEffect) => {
    playHostEffect(effect, {
      clipPlaying: videoPlaying.current,
      reducedMotion: prefersReducedMotion(),
      transitionUp: transitionOn.current,
      shaking: parryRunning.current,
      takeFlash: () => flashBudget.current.take(),
      playCue: (e) => bgm.current?.playCue(e === "thunder" ? THUNDER : GROWL, "host"),
      show: (fx) => {
        if (hostFxTimer.current) clearTimeout(hostFxTimer.current);
        setHostFx(fx);
        // The pulse is lit for two 0.1 s frames; a tint is held 500 ms; the shake runs its 0.4 s.
        hostFxTimer.current = setTimeout(() => setHostFx(null), fx.look === "flash" ? 200 : fx.look === "shake" ? 400 : 500);
      },
    });
  }, []);
  /** The lowest second the answer clock has shown. A STATE remounts the clock, which can show the same second or one
   * above it again (network delay): neither ticks twice. A jump of more than a second up is a new count. */
  const lastTick = useRef<number | null>(null);
  const onClockSecond = useCallback((s: number) => {
    const last = lastTick.current;
    if (last !== null && s >= last && s <= last + 1) return;
    lastTick.current = s;
    // ③ The boss room's last seconds beat instead of ticking; a new count already inside them (a 5 s clock, a
    // reconnect) beats too, though it starts silent otherwise.
    if (s > 0 && s <= ANSWER_WARN_SECONDS) startHeart(s);
    if (s === 0) stopHeart();
    if (last !== null && s > last) return; // a new count starts silent
    if (s === 0) bgm.current?.playCue(ANSWER_TIME_UP);
    else if (s <= ANSWER_WARN_SECONDS && !heartKey.current) bgm.current?.playCue(ANSWER_TICK);
  }, [startHeart, stopHeart]);

  // The keyed link pasted into this open tab changes only the fragment: no reload, no new socket. Load the page again,
  // so it says hello with the key (getScreenKey then takes it out of the address bar, which fires no hashchange).
  useEffect(() => {
    const onHash = () => {
      if (new URLSearchParams(location.hash.slice(1)).get("s")) location.reload();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /** The unlock buttons' label after a press: 開啟中… at once, 再點一次 if the sound is still asleep 1 s later. */
  const [unlockPress, setUnlockPress] = useState<"opening" | "again" | null>(null);
  /** The lobby's 「點一下開啟音效與氣氛」 and the corner 「👆 開聲音」 (immersion.md PR0): wake the sound inside the click.
   * What plays is the host's call (⚙ 更多's switches, PR3). */
  function enableSound() {
    setUnlockPress("opening");
    // Still asleep a second later: ask for another tap. Awake: back to the plain label, for the next time it falls asleep.
    setTimeout(() => setUnlockPress((p) => (p !== "opening" ? p : bgm.current?.running() ? null : "again")), 1000);
    wakeSound();
  }
  /** The 聲音就緒 last sent to the room. */
  const soundSent = useRef<boolean | null>(null);

  const { reset, rested, unreachable, reconnect, send } = useRoomSocket(code, {
    onOpen() {
      // Before any new report: the room ignores SCREEN_* reports from a socket that has not sent the screen key.
      // The screen key came in the link's fragment, like the host's token: never in a request or a Referer.
      const key = getScreenKey(code);
      send({ type: "SCREEN_HELLO", ...(key ? { key } : {}) });
      // The room forgets a screen's sound report when its socket closes: tell it again.
      send({ type: "SCREEN_SOUND", ready: soundSent.current ?? false });
      clipResendDue.current = true;
      setDisconnected(false);
      narrationBaseline.current = null;
      sfxSeen.current = null;
      lastPhase.current = null;
      transitionSeen.current = UNSEEN;
      cheatSeen.current = null;
      stopTransitions();
      prevState.current = null;
      rageMusic.current = null;
      parryKey.current = null;
      parryRetry.current = false; // a buzz from before the drop would come in late
      endParry();
      clearFog();
      clearClassFx();
      // A 回到大廳 missed while offline restarts eventIds at 0: an old high eventId would drop every new narration.
      progress.current = null;
    },
    onClose({ rested, openedBefore }) {
      if (!rested && openedBefore) setDisconnected(true);
    },
    onMessage(msg) {
      switch (msg.type) {
        case "LOBBY":
          clipEnded.current = null;
          applyScreenAudio(screenAudioOf(msg));
          clearFog();
          setLobby(msg.teams);
          setFloats([]);
          setGame(null);
          setNarration(null);
          setEpilogue(null);
          setFinale(false);
          lastPhase.current = null;
          transitionSeen.current = IN_LOBBY;
          cheatSeen.current = null;
          stopTransitions();
          prevState.current = null;
          rageMusic.current = false;
          player().setSong(DUNGEON_THEME);
          parryKey.current = null;
          parryRetry.current = false; // no wrong-answer buzz over the lobby
          endParry();
          clearClassFx();
          stopHeart();
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
        case "SCREEN_KEY":
          setLocked(!msg.ok);
          break;
        case "SCREEN_VIDEO":
          setShownVideo(msg);
          break;
        case "STATE":
          setGame(msg);
          applyScreenAudio(screenAudioOf(msg));
          if (msg.question?.id !== clipEnded.current) clipEnded.current = null;
          if (clipResendDue.current) {
            clipResendDue.current = false;
            const seen = clipErrored.current;
            if (seen && resendClipError(seen, msg.media)) send({ type: "SCREEN_CLIP_ERROR", questionId: seen.questionId });
            if (clipEnded.current) send({ type: "SCREEN_CLIP_ENDED", questionId: clipEnded.current });
          }
          {
            const t = nextTransition(transitionSeen.current, msg);
            transitionSeen.current = t.seen;
            if (t.play?.kind === "boss" && sprintShowing.current) queuedBoss.current = t.play;
            else if (t.play) {
              setTransition(t.play);
              sprintShowing.current = t.play.kind === "sprint";
              if (t.play.kind === "boss") {
                bgm.current?.playCue(BOSS_ALARM);
                bgm.current?.playCue(BOSS_RUMBLE, "boss");
              }
              if (t.play.kind === "sprint") bgm.current?.playCue(SPRINT_FANFARE);
            }
            const c = antiCheatBanner(cheatSeen.current, msg.view);
            cheatSeen.current = c.seen;
            // A door, boss or sprint banner wins (a sprint still showing too), and the intro pages are never covered; the
            // catch stays on screen in its own line anyway.
            const catchPlays = !!c.play && !t.play && !queuedBoss.current && !sprintShowing.current && !msg.intro;
            if (catchPlays) {
              setTransition(c.play);
              bgm.current?.playCue(BOSS_ALARM);
            }
            // ② A boss wrong answer: the parry. A transition or a phase card starting now cancels it (its retry plays at once).
            const prev = prevState.current;
            const k = parryFor(prev, msg, parryKey.current);
            if (k) parryKey.current = k;
            if ((t.play && !queuedBoss.current) || catchPlays || (msg.phaseCard && !prev?.phaseCard)) endParry();
            else if (k) startParry();
            // A class ability spent: its moment, after the parry so a parry starting now owns the spot. Off the playing phase, none.
            const cfx = classFxFor(prev, msg);
            if (msg.phase !== "playing") clearClassFx();
            else if (cfx) onClassFx(cfx);
            // ④ Rage music, game-wide: the 0.5 s silence only when rage starts live; a (re)connect just picks the song.
            const rage = rageNow(msg);
            if (rage !== rageMusic.current) {
              player().setSong(rage ? BOSS_RAGE_THEME : DUNGEON_THEME, rage && rageMusic.current === false ? 0.5 : 0);
              rageMusic.current = rage;
            }
            // ③ A heartbeat belongs to one boss clock: another turn, no clock or no boss scene ends it.
            const turn = describeTurn(msg.view, msg.question, msg.phaseCard?.monster);
            heartKey.current = bossClock(msg) ? `${turn.team?.id ?? ""}:${turn.questionId ?? ""}` : null;
            if (heart.current && heart.current.key !== heartKey.current) stopHeart();
            // A room just opened: its fog reveal. Off the playing phase, none.
            const opened = revealFor(prev, msg);
            if (msg.phase !== "playing") clearFog();
            else if (opened !== null) startFog(opened);
            prevState.current = msg;
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
              // ② The wrong answer's buzz waits for the parry's counter to end.
              if (msg.cue === "retry" && parryRunning.current) parryRetry.current = true;
              else if (msg.cue) bgm.current?.playCue(SFX[msg.cue]);
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
        case "SCREEN_EFFECT":
          onHostEffect(msg.effect);
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

  // Report 聲音就緒 to the room whenever it changes (the host page warns while no screen is ready), and chime when the
  // sound comes on so the room hears the TV.
  useEffect(() => {
    if (soundSent.current === soundReady) return;
    if (soundReady && soundSent.current === false) bgm.current?.playCue(SOUND_ON);
    soundSent.current = soundReady;
    send({ type: "SCREEN_SOUND", ready: soundReady });
  }, [soundReady, send]);

  const unlockLabel = unlockPress === "opening" ? "開啟中…" : unlockPress === "again" && !audioRunning ? "再點一次" : null;

  return (
    <FogRevealContext.Provider value={fogReveal}>
      <Stage>
        {/* 👹's shake moves the stage content only, never Stage's scaled element, the edge glows or the banners. A parry
            counter starting meanwhile takes the shake over: two shakes never stack past 8px. */}
        <div className={`absolute inset-0${hostFx?.look === "shake" && parry !== "counter" ? " px-growl" : ""}`}>
        {!game && <Lobby code={code} teams={lobby} />}
        {!game && showBgmToggle && !audioRunning && (
          // Between the room-code panel (ends near y 236) and the heroes; at most 40px tall.
          <PixelButton
            onClick={enableSound}
            aria-label="開啟音效與氣氛"
            className="absolute !m-0 !flex flex-col items-center !px-4 !py-0.5 text-center"
            style={{ top: 250, left: "50%", transform: "translateX(-50%)", zIndex: 6, background: "var(--warn)", maxHeight: 40 }}
          >
            {unlockLabel ?? (
              <>
                <span className="block text-[16px] leading-[18px]">點一下開啟音效與氣氛</span>
                <span className="block text-[12px] leading-[14px]">音樂・音效・旁白語音</span>
              </>
            )}
          </PixelButton>
        )}
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
        {/* A door opening first (its view is the game before the press), then a ❓ outcome, then a team choosing its door. */}
        {game?.phase === "playing" && !game.intro && !game.initiative && game.fortune ? (
          <FortuneScreen view={game.view} fortune={game.fortune} left={game.fortuneLeft} eventId={game.eventId} narration={narration} onRead={(id, count) => markRead(id, { typed: count })} />
        ) : game?.phase === "playing" && !game.intro && !game.initiative && (game.forkBeat || (!game.eventReveal && !game.reveal && !game.phaseCard && !game.phaseCardDue && describeTurn(game.view, null).team?.fork === "choosing")) ? (
          <ForkScreen view={game.view} beat={game.forkBeat} left={game.forkLeft} eventId={game.eventId} narration={narration} onRead={(id, count) => markRead(id, { typed: count })} />
        ) : game?.phase === "playing" && !game.intro && !game.initiative && game.eventReveal ? (
          <EventRoomScreen view={game.view} reveal={game.eventReveal} eventId={game.eventId} narration={narration} onRead={(id, count) => markRead(id, { typed: count })} />
        ) : game?.phase === "playing" && !game.intro && !game.initiative && <Playing view={game.view} question={game.question} reveal={game.reveal} pendingLock={game.pendingLock ?? null} pendingRoll={game.pendingRoll ?? null} wrongSlots={game.wrongSlots} eventId={game.eventId} narration={narration} phaseCard={game.phaseCard} bossPhaseInfo={game.bossPhaseInfo} media={game.media} shownVideo={shownVideo} locked={locked} needsTap={!tapped} onVideoPlaying={onVideoPlaying} onClipEnded={onClipEnded} onClipError={onClipError} clipError={game.clipError} answerLeft={game.answerClock?.left} onClockSecond={onClockSecond} say={speak} onRead={(id, count) => markRead(id, { typed: count })} onEaten={() => bgm.current?.playCue(EAT_DONE)} onChef={onChef} cuisine={game.cuisine} parry={parry} rage={rageNow(game)} />}
        {game?.phase === "finished" && <Finished view={game.view} winners={game.winners} reveal={game.reveal} podium={game.podium} narration={narration} unread={!!narration && unreadId === narration.eventId} typedTo={typedTo} epilogue={epilogue} page={game.epiloguePage?.page ?? 0} cuisine={game.cuisine} finale={finale} say={speak} onRead={(id, count) => markRead(id, { typed: count })} onCook={() => bgm.current?.playCue(SFX.cook)} onChef={onChef} onCue={(cue) => bgm.current?.playCue(SFX[cue])} onPodium={onPodium} />}
        {game?.phase === "playing" && <ReactionFloats floats={floats} teams={game.view.teams} />}
        </div>
        {/* ③ The heartbeat's and ② the counter's edge glows: inset shadows, the middle of the stage stays clear. */}
        {heartGlow && <div aria-hidden data-testid="heart-glow" className="px-edge" style={{ zIndex: 9, boxShadow: `inset 0 0 90px 8px ${heartGlow === "pulse" ? "#b02a3a4d" : HEART_TINT}` }} />}
        {parryEdge && <div aria-hidden className="px-edge" style={{ zIndex: 9, boxShadow: `inset 0 0 90px 8px ${parryEdge === "flash" ? "#ff6b6b66" : PARRY_TINT}` }} />}
        {hostFx && hostFx.look !== "shake" && (
          <div aria-hidden data-testid="host-fx" className="px-edge" style={{ zIndex: 9, boxShadow: `inset 0 0 90px 8px ${hostFx.look === "flash" ? THUNDER_PULSE : hostFx.effect === "thunder" ? THUNDER_TINT : GROWL_TINT}` }} />
        )}
        {classFx?.edge && <div aria-hidden data-testid="class-fx-edge" className="px-edge" style={{ zIndex: 9, boxShadow: `inset 0 0 90px 8px ${(classFx.fx.look === "flash" ? CLASS_PULSE : CLASS_TINT)[classFx.fx.kind]}` }} />}
        {/* The class badge above the monster (z 4: under the tiles, panel, video and clock). A parry owns that spot. */}
        {classFx && !classFx.parried && game?.phase === "playing" && !parry && (
          <div aria-hidden data-testid="class-fx" className={`pointer-events-none absolute px-chip${classFx.fx.look === "flash" ? " px-class-pop" : ""}`} style={{ ...CHIP, left: "50%", bottom: 200, transform: "translateX(-50%)", zIndex: 4, fontSize: 24, whiteSpace: "nowrap", background: "var(--cream)", border: `4px solid ${CLASS_COLOR[classFx.fx.kind]}`, boxShadow: "0 0 0 4px var(--k)" }}>
            <span className="inline-block max-w-[110px] truncate align-bottom">{classFx.fx.name}</span>・{CLASS_FX_TEXT[classFx.fx.kind]}
          </div>
        )}
        {transition && <TransitionOverlay key={`${transition.kind}`} play={transition} onDone={endTransition} flash={flash} />}
        {/* A normal flow stack, not two independently-positioned banners: whichever show, they never overlap. */}
        <div className="absolute inset-x-0 top-0 flex flex-col" style={{ zIndex: 20 }}>
          {!game && locked ? (
            // In the lobby, before a video question finds out. In place of the tap notice: there is room for one line.
            <div role="status" data-testid="screen-locked" className="text-center text-[16px] leading-[22px]" style={{ background: "#fff0a8", color: "var(--ink)", padding: 3, borderBottom: "4px solid var(--k)" }}>
              🔒 這台大螢幕不會播影片題的影片：請用主持人頁上的大螢幕網址開啟{!tapped && "　👆 並點一下大螢幕開啟聲音"}
            </div>
          ) : !game && !tapped && (
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
      {/* Outside <Stage>, fixed to the real viewport (not scaled/letterboxed with the 960x540 canvas): the stage has no
          free margin in any phase, and a real-size corner control stays comfortably tappable at any TV scale. The
          sound's switches live on the host's ⚙ 更多 (immersion.md PR3, UC1); only the unlock stays here. */}
      {showBgmToggle && game && !audioRunning && (
        // Mid-game, while the sound is still asleep (the page's first tap wakes it; after that only this button does).
        <PixelButton
          onClick={enableSound}
          className="!m-0 !px-4 !py-2 text-[16px]"
          style={{ position: "fixed", bottom: 12, right: 12, zIndex: 30, background: "var(--warn)" }}
        >
          {unlockLabel ?? "👆 開聲音"}
        </PixelButton>
      )}
    </FogRevealContext.Provider>
  );
}
