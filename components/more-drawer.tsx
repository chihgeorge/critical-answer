"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getHostToken } from "@/lib/room-code";
import type { ClientMessage, ScreenAudio } from "@/lib/protocol";
import { BOSS_THRESHOLD } from "@/lib/turn-info";
import { CATCH_USES, CLASS_ICONS, FIX_SCORE_STEP, ORACLE_USES, type HostFix, type SpectatorView } from "@/lib/game-state";
import { Panel, PixelButton } from "@/components/pixel";
import { Qr } from "@/components/qr";

/** ⚙ 更多's sound switches: what each one sets on every big screen. 🌧 off silences only the ambience. */
const AUDIO_SWITCHES: { key: keyof ScreenAudio; label: string }[] = [
  { key: "music", label: "🎵 音樂" },
  { key: "voice", label: "🔊 旁白語音" },
  { key: "ambience", label: "🌧 環境音" },
];

/** The host's own link carries the token, so it is shown here and never on /screen or /play. */
export function MoreDrawer({
  origin,
  code,
  onClose,
  send,
  ai,
  bossable,
  playing,
  antiCheat,
  screen,
  screenAudio,
  fixable = [],
  scoreLabel,
}: {
  /** The page's origin ("" before hydration). */
  origin: string;
  code: string;
  onClose: () => void;
  send: (msg: ClientMessage) => void;
  /** The AI key and limit settings, mid-game (in the lobby they sit on the page itself). */
  ai: ReactNode;
  /** Teams in play and not yet in the boss room: the host may send one there (scoring-and-score-pools.md S13). */
  bossable: { id: string; name: string }[];
  /** A game is under way, so 結束冒險 can end it. */
  playing: boolean;
  /** 🚨 抓包與神諭's switch while a game runs (docs/designs/anti-ai-cheating.md); undefined outside a game. */
  antiCheat?: boolean;
  /** The big-screen link and QR, once a game has started (before that they sit on the page itself). */
  screen: ReactNode;
  /** The big screens' sound switches (immersion.md PR3, UC1), in the lobby and in a game. */
  screenAudio: ScreenAudio;
  /** Every team while a game is playing, for 修正 (game-state hostFix); empty otherwise. */
  fixable?: SpectatorView["teams"];
  /** The game's score name (獎勵分 or 飽足感). */
  scoreLabel?: string;
}) {
  // 送王房 cannot be undone, so the first tap only arms it for 3 s.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const token = getHostToken(code);
  const hostUrl = token ? `${origin}/room/${code}/host#k=${token}` : "";
  return (
    <div data-testid="more-drawer" className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <Panel tone="lav" className="max-h-[85vh] w-full overflow-y-auto p-4">
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[20px]">更多</span>
            <PixelButton onClick={onClose} className="!m-0 !px-4 !py-1 text-[16px]">
              關閉
            </PixelButton>
          </div>
          {screen && <section>{screen}</section>}
          <section className="flex flex-col gap-2">
            <div className="text-[15px]">大螢幕聲音（每台大螢幕都跟著這裡）：🎵 關掉時判分音效和環境音也一起關；主持人加料一直都在。</div>
            <div className="flex flex-wrap gap-2">
              {AUDIO_SWITCHES.map(({ key, label }) => (
                <PixelButton
                  key={key}
                  role="switch"
                  aria-checked={screenAudio[key]}
                  variant={screenAudio[key] ? undefined : "flee"}
                  onClick={() => send({ type: "HOST_SCREEN_AUDIO", key, on: !screenAudio[key] })}
                  className="!m-0 min-h-[44px] !px-4 !py-2 text-[16px]"
                >
                  {`${label}：${screenAudio[key] ? "開" : "關"}`}
                </PixelButton>
              ))}
            </div>
          </section>
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
          {fixable.length > 0 && (
            <section data-testid="host-fix" className="flex flex-col gap-2">
              <div className="text-[15px]">修正（判錯時用）：大螢幕不會有動畫或旁白，只會換成新的數字；每一下都記在對局紀錄裡。</div>
              {fixable.map((t) => {
                const fix = (f: HostFix) => send({ type: "HOST_FIX", teamId: t.id, fix: f });
                const small = "!m-0 min-h-[44px] min-w-[44px] !px-2 !py-0 text-[15px]";
                const max = t.abilityCap;
                return (
                  <div key={t.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-full truncate text-[16px] sm:basis-0">{t.name}</span>
                    <span className="text-[14px]">{scoreLabel} <span className="px-num text-[14px]">{t.reward}</span></span>
                    <PixelButton aria-label={`${t.name}扣 ${FIX_SCORE_STEP} 分`} disabled={t.reward <= 0} onClick={() => fix("score-")} className={small}>−{FIX_SCORE_STEP}</PixelButton>
                    <PixelButton aria-label={`${t.name}加 ${FIX_SCORE_STEP} 分`} onClick={() => fix("score+")} className={small}>+{FIX_SCORE_STEP}</PixelButton>
                    {max !== undefined && t.classId && (
                      <>
                        <span className="text-[14px]">{CLASS_ICONS[t.classId]}{t.abilityUses}/{max}</span>
                        <PixelButton aria-label={`${t.name}能力少 1 次`} disabled={t.abilityUses <= 0} onClick={() => fix("ability-")} className={small}>−1</PixelButton>
                        <PixelButton aria-label={`${t.name}能力多 1 次`} disabled={t.abilityUses >= max} onClick={() => fix("ability+")} className={small}>+1</PixelButton>
                      </>
                    )}
                    {t.item && (
                      <PixelButton aria-label={`收回${t.name}的藥水`} onClick={() => fix("potion-")} className={small}>收回🧪</PixelButton>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {antiCheat !== undefined && (
            <section className="flex flex-col gap-2">
              <div className="text-[15px]">發現有人用手機問 AI？打開後每隊可以公開問 {ORACLE_USES} 次神諭（答對減半），也可以抓包別隊 {CATCH_USES} 次，由你裁決。關掉時還沒裁決的抓包取消、退回次數。</div>
              <PixelButton
                data-testid="anti-cheat-switch"
                role="switch"
                aria-checked={antiCheat}
                variant={antiCheat ? "flee" : undefined}
                onClick={() => send({ type: "HOST_ANTI_CHEAT", on: !antiCheat })}
                className="!m-0 min-h-[44px] !px-4 !py-2 text-[16px]"
              >
                {antiCheat ? "🚨 抓包與神諭：開（按一下關掉）" : "🚨 開啟抓包與神諭"}
              </PixelButton>
            </section>
          )}
          {playing && (
            <section className="flex flex-col gap-2">
              <div className="text-[15px]">時間到了？現在就結束，照目前的分數排名，大螢幕出頒獎台和後記。</div>
              <PixelButton
                onClick={() => {
                  // Ending cannot be undone, so the first tap only arms it for 3 s, like 送王房.
                  if (armed !== "end") return setArmed("end");
                  setArmed(null);
                  send({ type: "HOST_END_GAME" });
                  onClose();
                }}
                className="!m-0 min-h-[44px] !px-4 !py-2 text-[16px]"
              >
                {armed === "end" ? "確定結束？" : "結束冒險"}
              </PixelButton>
            </section>
          )}
          {ai && <section>{ai}</section>}
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
