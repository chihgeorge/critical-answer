"use client";

// The shared big screen. Public: it only ever receives the spectator view and
// never a host-only message, so it can be cast to a TV without leaking answers.

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { restNoticeFor, RESTED_RECONNECT_LABEL } from "@/lib/room/close-codes";
import { useRoomSocket } from "@/lib/use-room-socket";
import { DISCONNECTED_NOTICE } from "@/lib/offline-notice";
import type { AnswerReveal, LobbyTeams, PublicQuestion, StateMessage } from "@/lib/protocol";
import type { SpectatorView } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { BOSS_THRESHOLD, describeTurn } from "@/lib/turn-info";
import { isPending, keepLatest, linesOf, type NarrationState } from "@/lib/narration/client";
import { pickVoice, shouldSpeakEpilogue, shouldSpeakNarration, type SpokenNarration } from "@/lib/narration/tts";
import { createBgmPlayer, type BgmPlayer } from "@/lib/bgm-player";
import { SFX } from "@/lib/sfx";
import { DialogueBox, LabelChip, Nameplate, Panel, PixelButton, QuestionMedia, SceneBackground, ScoreMeter, Sprite, TurnRibbon } from "@/components/pixel";
import { Qr } from "@/components/qr";
import { Stage } from "@/components/stage";
import { readStored, writeStored } from "@/lib/stored";

const TTS_ENABLED_STORAGE = "screen-tts-enabled";
const BGM_ENABLED_STORAGE = "screen-bgm-enabled";
const bgmSupported = () => "AudioContext" in window;

/** True only in a browser that actually implements the Web Speech API — the toggle button
 * doesn't render at all otherwise (a rendered-but-disabled button implies the feature could
 * work here if only the user did something, which isn't true). */
const ttsSupported = () => "speechSynthesis" in window;


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
          the rest on the right. Characters shrink at 5+ teams and names truncate, so 8 still fit. */}
      <div className="absolute inset-x-0 flex items-end justify-center" style={{ bottom: 120, zIndex: 4, gap: 18 }}>
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
        text={teams.length === 0 ? "篝火燒得正旺，等待第一支隊伍加入……" : `${teams.length} 支隊伍已就位，等主持人宣布開始！`}
      />
    </>
  );
}

/** One side of the campfire: teams[from, to), each running in. `variant` stays the team's overall
 * index so its look matches the rest of the game. */
function TeamGroup({ teams, from, to, align }: { teams: LobbyTeams; from: number; to: number; align: "start" | "end" }) {
  const scale = teams.length > 4 ? 3 : 4;
  return (
    <div className={`flex flex-1 items-end gap-2 ${align === "end" ? "justify-end" : "justify-start"}`}>
      {teams.slice(from, to).map((t, j) => (
        <div key={t.id} className="flex flex-col items-center gap-1" style={{ maxWidth: 96 }}>
          <div className="px-run">
            <Sprite kind="hero" variant={from + j} scale={scale} />
          </div>
          <Nameplate className="text-[14px]" style={{ maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", padding: "3px 8px" }}>
            {t.name}
          </Nameplate>
        </div>
      ))}
    </div>
  );
}

function Playing({ view, question, reveal, eventId, narration }: { view: SpectatorView; question: PublicQuestion | null; reveal: AnswerReveal | null; eventId: number; narration: NarrationState }) {
  const { team: turn, teamIndex: turnIdx, inBoss, monster, theme, bossHits: hits } = describeTurn(view, question);
  const stars = question ? "★".repeat(question.difficulty) + "☆".repeat(Math.max(0, 5 - question.difficulty)) : "";

  return (
    <>
      <SceneBackground theme={theme} />
      <Torches />
      <Sparks />

      <div className="absolute flex items-start gap-3" style={{ left: 18, right: 18, top: 24, zIndex: 6 }}>
        {turn && <TurnRibbon color={look(turnIdx).hat}>{inBoss ? "首領戰　" : ""}輪到：{turn.name}</TurnRibbon>}
        <div className="flex min-w-0 flex-1 justify-end gap-3">
          {view.teams.map((t, i) => {
            const active = t.id === view.currentTurnTeamId;
            return (
              <Panel
                key={t.id}
                tone={active ? "turn" : "cream"}
                className={`flex items-center gap-2 ${t.online ? "" : "opacity-50"}`}
                style={{ flex: "1 1 0", maxWidth: 158, minWidth: 0, height: 62, padding: "6px 8px" }}
              >
                {active && (
                  <span className="px-hop absolute text-[22px]" style={{ left: 18, top: -22, color: "var(--danger)", textShadow: "2px 2px 0 var(--k)" }}>
                    ▼
                  </span>
                )}
                <Sprite kind="hero" variant={i} scale={2} className="flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1 text-[15px]">
                    <span className="truncate">{t.name}</span>
                    <span className="px-num flex-none text-[9px]" style={{ color: "#a8470f" }}>
                      {t.score}/{BOSS_THRESHOLD}
                    </span>
                  </div>
                  <div className="mt-[5px]">
                    <ScoreMeter score={t.score} active={active} />
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      </div>

      <Panel className="absolute text-center" style={{ left: 110, right: 110, top: 96, padding: "32px 24px 12px", fontSize: 30, lineHeight: 1.3, zIndex: 5 }}>
        <div className="absolute flex justify-between text-[14px]" style={{ left: 16, right: 16, top: 6 }}>
          <LabelChip>{reveal ? "正解揭曉" : inBoss ? "首領題" : `難度 ${stars}`}</LabelChip>
          {!reveal && inBoss && <LabelChip>最後的挑戰！</LabelChip>}
        </div>
        {/* The reveal takes the question's own slot until the host presses 下一題 (D7), so the
            next question never shows underneath (or behind) the previous answer. */}
        {reveal ? (
          <div data-testid="answer-reveal" className="flex flex-col items-center gap-2">
            <div>正解：{reveal.answer}</div>
            {reveal.explanation && reveal.explanation.kind === "text" && <div className="text-[20px]">{reveal.explanation.value}</div>}
            {reveal.explanation && reveal.explanation.kind !== "text" && (
              // key tied to questionId: a 404'd explanation image must not stay hidden on later reveals.
              <QuestionMedia key={reveal.questionId} content={reveal.explanation} label="詳解" maxWidth={300} maxHeight={140} />
            )}
          </div>
        ) : question ? (question.content.kind === "text" ? question.content.value : "") : "……"}
        {!reveal && question && question.content.kind !== "text" && (
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
      </Panel>

      <div className="absolute" style={{ left: "50%", bottom: 136, width: inBoss ? 210 : 170, height: 18, transform: "translateX(-50%)", background: "#0007", zIndex: 3, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" }} />
      <div key={`${monster.kind}-${hits}`} className="absolute" style={{ left: "50%", bottom: monster.float ? 150 : 146, transform: "translateX(-50%)", zIndex: 4 }}>
        <div className={hits > 0 && inBoss ? "px-hit" : monster.float ? "px-float" : "px-idle"}>
          <Sprite kind={monster.kind} scale={monster.scale} hue={monster.hue} />
        </div>
      </div>
      <Nameplate className="absolute" style={{ left: "50%", bottom: 112, transform: "translateX(-50%)", zIndex: 5, color: inBoss ? "#b02a3a" : undefined }}>
        <span>{monster.name}</span>
        {inBoss && (
          <span className="ml-[14px] flex gap-[3px]">
            {Array.from({ length: view.bossMaxHp }, (_, i) => (
              <Sprite key={i} kind="heart" variant={i < view.bossHp ? 1 : 0} scale={2} />
            ))}
          </span>
        )}
      </Nameplate>

      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        accent={inBoss ? "var(--danger)" : undefined}
        loading={isPending(eventId, narration)}
        lines={narration ? linesOf(narration) : [turn ? `輪到${turn.name}了，${monster.name}擋在前面……` : "……"]}
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

function Finished({ view, winners, reveal, narration, epilogue }: { view: SpectatorView; winners: string[]; reveal: AnswerReveal | null; narration: NarrationState; epilogue: string | null }) {
  const ranked = view.teams.map((t, i) => ({ ...t, i })).sort((a, b) => b.score - a.score).slice(0, 3);
  const names = winners.map((id) => view.teams.find((t) => t.id === id)?.name ?? id).join("、");
  return (
    <>
      <SceneBackground theme="moss" arch={false} />
      {Array.from({ length: 26 }, (_, i) => (
        <i key={i} className="px-confetti" style={{ left: 20 + ((i * 37) % 920), background: CONFETTI[i % 6], animationDelay: `${-((i * 0.37) % 3.6)}s`, animationDuration: `${2.6 + ((i * 0.13) % 2)}s`, zIndex: 6 }} />
      ))}
      <div className="absolute inset-x-0 text-center" style={{ top: 20, zIndex: 6, fontSize: 54, color: "var(--warn)", textShadow: "4px 4px 0 var(--k), -3px -3px 0 var(--k), 3px -3px 0 var(--k), -3px 3px 0 var(--k), 0 6px 0 var(--k)" }}>
        <small className="mb-1 block text-[16px] text-white" style={{ letterSpacing: "0.4em", textShadow: "2px 2px 0 var(--k)" }}>
          冒　險　結　束
        </small>
        {names}奪得榜首！
      </div>
      {/* The winning answer: the last correct judgment ends the game, so its reveal lands here, not on
          <Playing>. The podium is centered and about 546px wide, which leaves the left margin free
          below the title — a banner up top would sit on the crown. */}
      {reveal && (
        <div data-testid="answer-reveal" className="absolute" style={{ left: 18, top: 160, width: 170, zIndex: 6 }}>
          <Panel tone="turn" className="px-3 py-2 text-[16px] leading-snug">最後一題正解：{reveal.answer}</Panel>
        </div>
      )}
      <div className="absolute inset-x-0 flex items-end justify-center gap-12" style={{ bottom: 130, zIndex: 5 }}>
        {PODIUM.map((p) => {
          const t = ranked[p.place - 1];
          if (!t) return <div key={p.place} style={{ width: 150 }} />;
          return (
            <div key={p.place} className="flex flex-col items-center">
              {p.place === 1 && <Sprite kind="crown" scale={3} style={{ marginBottom: -10, zIndex: 2 }} />}
              <Sprite kind="hero" variant={t.i} scale={p.hero} />
              <div className="flex flex-col items-center pt-2 text-white" style={{ width: 150, height: p.h, background: p.bg, boxShadow: "0 0 0 4px var(--k), inset 0 6px 0 #ffffff55, inset 0 -8px 0 #0003" }}>
                <span className="px-num text-[22px]" style={{ textShadow: "3px 3px 0 var(--k)" }}>{p.place}</span>
                <b className="mt-[6px] truncate text-[18px] font-normal" style={{ maxWidth: 140, textShadow: "2px 2px 0 var(--k)" }}>{t.name}</b>
                <s className="mt-[2px] text-[14px] no-underline" style={{ color: "#fff6c0", textShadow: "2px 2px 0 var(--k)" }}>{t.score} 分</s>
              </div>
            </div>
          );
        })}
      </div>
      {/* Rankings show at once. The kill-shot line is read first, then the story arrives as one typewriter line. */}
      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        loading={!epilogue && !narration}
        lines={epilogue ? [epilogue] : linesOf(narration)}
      />
    </>
  );
}

export default function ScreenPage() {
  const { code } = useParams<{ code: string }>();
  const [lobby, setLobby] = useState<LobbyTeams>([]);
  const [game, setGame] = useState<StateMessage | null>(null);
  /** A network drop (not a rest): shown so a frozen screen doesn't look like a quiet game. */
  const [disconnected, setDisconnected] = useState(false);
  const [narration, setNarration] = useState<NarrationState>(null);
  const [epilogue, setEpilogue] = useState<string | null>(null);

  // --- TTS (docs/designs/dm-voice-narration-tts.md) ---
  const [ttsOn, setTtsOn] = useState(false);
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

  // Read in an effect, not the initial render: ttsSupported() reads `window`, which doesn't
  // exist during SSR — rendering the toggle from the first client render would disagree with
  // the server-rendered HTML and trigger a hydration mismatch (same reasoning as
  // app/bank-editor/page.tsx's useOwnerKey).
  const [showTtsToggle, setShowTtsToggle] = useState(false);
  useEffect(() => {
    // A named function, not the effect body itself: react-hooks/set-state-in-effect.
    function restore() {
      if (ttsSupported()) setShowTtsToggle(true);
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
  const pendingLines = useRef<string[] | null>(null);

  /** Cancels anything in progress, then queues each line as its own utterance —
   * speechSynthesis plays consecutive speak() calls in order automatically. No-ops (does not
   * even cancel) when TTS is off or the API is unsupported; with no voice loaded yet it keeps
   * the lines in pendingLines instead. */
  function speak(lines: string[]) {
    if (!ttsOn || !ttsSupported()) return;
    if (!ttsVoice) {
      pendingLines.current = lines;
      return;
    }
    window.speechSynthesis.cancel();
    for (const line of lines) {
      const utter = new SpeechSynthesisUtterance(line);
      utter.voice = ttsVoice;
      utter.lang = ttsVoice.lang;
      window.speechSynthesis.speak(utter);
    }
  }

  // The voice just loaded: speak whatever arrived while waiting for it (see pendingLines).
  useEffect(() => {
    if (!ttsVoice || !pendingLines.current) return;
    const lines = pendingLines.current;
    pendingLines.current = null;
    speak(lines);
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
      window.speechSynthesis.cancel();
      pendingLines.current = null; // turned off: nothing waiting should play later
    }
    setTtsOn((on) => {
      writeStored(TTS_ENABLED_STORAGE, String(!on));
      return !on;
    });
  }

  // --- Background music (lib/bgm.ts): off by default, like the narration voice ---
  const [bgmOn, setBgmOn] = useState(false);
  const [showBgmToggle, setShowBgmToggle] = useState(false);
  const bgm = useRef<BgmPlayer | null>(null);
  const player = () => (bgm.current ??= createBgmPlayer());

  useEffect(() => {
    // Read in an effect, like the TTS toggle above, so SSR and the first render agree.
    // A named function, not the effect body itself: react-hooks/set-state-in-effect.
    function restore(): boolean {
      if (!bgmSupported()) return false;
      setShowBgmToggle(true);
      const on = readStored(BGM_ENABLED_STORAGE) === "true";
      if (on) setBgmOn(true);
      return on;
    }
    if (!restore()) return;
    // Browsers only let audio start inside a user gesture, so a remembered "on" waits for the
    // first click or key press on the page.
    const unlock = () => void player().start();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Keep the music under the narration voice: lower it while speechSynthesis is talking.
  useEffect(() => {
    if (!bgmOn) return;
    const id = setInterval(() => bgm.current?.duck(ttsSupported() && window.speechSynthesis.speaking), 250);
    return () => clearInterval(id);
  }, [bgmOn]);

  useEffect(() => () => bgm.current?.stop(), []);

  function toggleBgm() {
    const next = !bgmOn;
    // start() runs inside this click, which is what lets the browser play it.
    if (next) void player().start();
    else bgm.current?.stop();
    setBgmOn(next);
    writeStored(BGM_ENABLED_STORAGE, String(next));
  }

  const { reset, rested, reconnect } = useRoomSocket(code, {
    onOpen() {
      setDisconnected(false);
      narrationBaseline.current = null;
      sfxSeen.current = null;
    },
    onClose({ rested, openedBefore }) {
      if (!rested && openedBefore) setDisconnected(true);
    },
    onMessage(msg) {
      switch (msg.type) {
        case "LOBBY":
          setLobby(msg.teams);
          setGame(null);
          setNarration(null);
          setEpilogue(null);
          // A room reset can arrive without a socket reconnect, and the next game's eventIds
          // start over from 0 — re-arm the baseline the same way onOpen does.
          narrationBaseline.current = null;
          sfxSeen.current = null;
          pendingLines.current = null;
          window.speechSynthesis?.cancel();
          break;
        case "STATE":
          setGame(msg);
          if (narrationBaseline.current === null) narrationBaseline.current = msg.eventId;
          // A new event: play its effect once (only while the 🎵 music is on, see playCue).
          if (sfxSeen.current === null) sfxSeen.current = msg.eventId;
          else if (msg.eventId > sfxSeen.current) {
            sfxSeen.current = msg.eventId;
            if (msg.cue) bgm.current?.playCue(SFX[msg.cue]);
          }
          break;
        case "NARRATION":
          setNarration((n) => keepLatest(n, msg));
          if (narrationBaseline.current !== null) {
            const speakIt = shouldSpeakNarration(msg, narrationBaseline.current, lastSpokenNarration.current);
            lastSpokenNarration.current = msg; // always, even when not spoken — see the ref's doc comment
            if (speakIt) speak(linesOf(msg));
          }
          break;
        case "EPILOGUE":
          setEpilogue(msg.text);
          if (shouldSpeakEpilogue(msg)) speak([msg.text]);
          break;
        case "GAME_OVER":
          setGame((g) => (g ? { ...g, phase: "finished", winners: msg.winners } : g));
          break;
      }
    },
  });

  return (
    <>
      <Stage>
        {!game && <Lobby code={code} teams={lobby} />}
        {game?.phase === "playing" && <Playing view={game.view} question={game.question} reveal={game.reveal} eventId={game.eventId} narration={narration} />}
        {game?.phase === "finished" && <Finished view={game.view} winners={game.winners} reveal={game.reveal} narration={narration} epilogue={epilogue} />}
        {/* A normal flow stack, not two independently-positioned banners: whichever show, they never overlap. */}
        <div className="absolute inset-x-0 top-0 flex flex-col" style={{ zIndex: 20 }}>
          {disconnected && !rested && (
            <div role="status" className="text-center text-[20px]" style={{ background: "var(--turn)", color: "var(--ink)", padding: 6 }}>
              {DISCONNECTED_NOTICE}
            </div>
          )}
          {rested && (
            <div role="status" className="flex items-center justify-center gap-4 text-center text-[20px]" style={{ background: "var(--turn)", color: "var(--ink)", padding: 6 }}>
              {restNoticeFor(rested)}
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
