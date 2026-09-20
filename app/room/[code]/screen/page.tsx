"use client";

// The shared big screen. Public: it only ever receives the spectator view and
// never a host-only message, so it can be cast to a TV without leaking answers.

import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import usePartySocket from "partysocket/react";
import type { ServerMessage } from "@/lib/protocol";
import type { GamePhase, SpectatorView } from "@/lib/game-state";
import { TEAM_LOOKS } from "@/lib/pixel-art";
import { BOSS_THRESHOLD, describeTurn } from "@/lib/turn-info";
import { DialogueBox, LabelChip, Nameplate, Panel, SceneBackground, ScoreMeter, Sprite, TurnRibbon } from "@/components/pixel";
import { Qr } from "@/components/qr";
import { Stage } from "@/components/stage";

type Lobby = { id: string; name: string }[];
type Play = { view: SpectatorView; phase: GamePhase; winners: string[] };

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

function Lobby({ code, teams }: { code: string; teams: Lobby }) {
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
      <div className="absolute inset-x-0 flex items-end justify-center gap-6" style={{ bottom: 120, zIndex: 4 }}>
        {teams.map((t, i) => (
          <div key={t.id} className="flex flex-col items-center gap-1">
            <div className="px-run">
              <Sprite kind="hero" variant={i} scale={4} />
            </div>
            <Nameplate className="text-[16px]">{t.name}</Nameplate>
          </div>
        ))}
      </div>
      <DialogueBox
        className="absolute"
        style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }}
        text={teams.length === 0 ? "篝火燒得正旺，等待第一支隊伍加入……" : `${teams.length} 支隊伍已就位，等主持人宣布開始！`}
      />
    </>
  );
}

function Playing({ view }: { view: SpectatorView }) {
  const { team: turn, teamIndex: turnIdx, inBoss, room, monster, theme, questionId, bossHits: hits } = describeTurn(view);

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
                    <span className="px-num flex-none text-[9px]" style={{ color: "#c2571f" }}>
                      {t.score}/{BOSS_THRESHOLD}
                    </span>
                  </div>
                  <div className="mt-[5px]">
                    <ScoreMeter score={Math.min(t.score, BOSS_THRESHOLD)} max={BOSS_THRESHOLD} active={active} />
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      </div>

      <Panel className="absolute text-center" style={{ left: 110, right: 110, top: 100, padding: "34px 24px 16px", fontSize: 34, lineHeight: 1.3, zIndex: 5 }}>
        <div className="absolute flex justify-between text-[14px]" style={{ left: 16, right: 16, top: 6 }}>
          <LabelChip>{inBoss ? "首領題" : `第 ${room + 1} 房`}</LabelChip>
          {inBoss && <LabelChip>最後的挑戰！</LabelChip>}
        </div>
        題目 {questionId}
      </Panel>

      <div className="absolute" style={{ left: "50%", bottom: 136, width: inBoss ? 210 : 170, height: 18, transform: "translateX(-50%)", background: "#0007", zIndex: 3, clipPath: "polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)" }} />
      <div key={`${monster.kind}-${hits}`} className="absolute" style={{ left: "50%", bottom: monster.float ? 150 : 146, transform: "translateX(-50%)", zIndex: 4 }}>
        <div className={hits > 0 && inBoss ? "px-hit" : monster.float ? "px-float" : "px-idle"}>
          <Sprite kind={monster.kind} scale={monster.scale} />
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
        text={turn ? `輪到${turn.name}了，${monster.name}擋在前面……` : "……"}
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

function Finished({ view, winners }: { view: SpectatorView; winners: string[] }) {
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
      {/* Rankings show at once; the epilogue arrives later as one typewriter line. */}
      <DialogueBox className="absolute" style={{ left: 18, right: 18, bottom: 12, zIndex: 7 }} loading />
    </>
  );
}

export default function ScreenPage() {
  const { code } = useParams<{ code: string }>();
  const [lobby, setLobby] = useState<Lobby>([]);
  const [game, setGame] = useState<Play | null>(null);
  const [reset, setReset] = useState(false);
  const epoch = useRef<string | null>(null);

  usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999",
    room: code,
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
        case "LOBBY":
          setLobby(msg.teams);
          setGame(null);
          break;
        case "STATE":
          setGame({ view: msg.view, phase: msg.phase, winners: msg.winners });
          break;
        case "GAME_OVER":
          setGame((g) => (g ? { ...g, phase: "finished", winners: msg.winners } : g));
          break;
      }
    },
  });

  return (
    <Stage>
      {!game && <Lobby code={code} teams={lobby} />}
      {game?.phase === "playing" && <Playing view={game.view} />}
      {game?.phase === "finished" && <Finished view={game.view} winners={game.winners} />}
      {reset && (
        <div className="absolute inset-x-0 top-0 text-center text-[20px] text-white" style={{ zIndex: 20, background: "var(--danger)", padding: 6 }}>
          伺服器重新啟動，遊戲已重置
        </div>
      )}
    </Stage>
  );
}
