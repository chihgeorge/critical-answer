"use client";

import { MAX_TAP_LATENCY_MS } from "@/lib/tap-clock";
import { useEffect, useState, type ReactNode } from "react";
import { pressCooldown } from "@/lib/press-cooldown";
import { getHostToken } from "@/lib/room-code";
import type { ClientMessage, JudgedEntry, ScreenAudio } from "@/lib/protocol";
import { BOSS_THRESHOLD } from "@/lib/turn-info";
import { CATCH_USES, CLASS_ICONS, FIX_SCORE_MAX, FIX_SCORE_STEP, ORACLE_USES, type HostFix, type SpectatorView } from "@/lib/game-state";
import { laterCorrect, questionOrdinals, rejudgeButton } from "@/lib/host-rejudge";
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
  judged = [],
  undoWrong,
  questionLabel = () => "",
  error,
  tapLatency,
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
  /** Every applied judgment, oldest first (HOST_PICKS `judged`), for 改判. */
  judged?: JudgedEntry[];
  /** STATE's undoWrong (fields: a music question with fields): its newest 答錯 row's 改成答對 runs that full undo. */
  undoWrong?: { teamId: string; questionId: string; fields: boolean };
  /** A question's label from HOST_PICKS ("" when unknown). */
  questionLabel?: (questionId: string) => string;
  /** The page's last refusal, shown again in 修正: the drawer covers the page's own error line. */
  error?: string | null;
  /** The speaker latency for timing questions (timing-tap.md 8) while a game plays; undefined hides the field. */
  tapLatency?: number;
}) {
  // 送王房 cannot be undone, so the first tap only arms it for 3 s.
  const [armed, setArmed] = useState<string | null>(null);
  // 修正 acts on every press: a double tap before the next STATE would apply twice (FIX_COOLDOWN_MS per button).
  const [fixAllowed] = useState(() => pressCooldown());
  // 設定's typed scores per team, never overwritten by a STATE. One shows empty once the team's score shows what was
  // sent, so a refused 設定 keeps what the host typed.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, number>>({});
  const typedFor = (id: string, reward: number) => (sent[id] === reward ? "" : (typed[id] ?? ""));
  const settable = (id: string, reward: number) => {
    const v = typedFor(id, reward);
    return /^\d{1,4}$/.test(v) && Number(v) <= FIX_SCORE_MAX && Number(v) !== reward;
  };
  const teamName = (id: string) => fixable.find((t) => t.id === id)?.name ?? "";
  const rewardOf = (id: string) => fixable.find((t) => t.id === id)?.reward ?? 0;
  const ordinals = questionOrdinals(judged);
  const [latencyText, setLatencyText] = useState("");
  const latencyOk = /^\d{1,4}$/.test(latencyText) && Number(latencyText) <= MAX_TAP_LATENCY_MS && Number(latencyText) !== tapLatency;
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
          {tapLatency !== undefined && (
            <section className="flex flex-col gap-2" data-testid="tap-latency">
              <label className="flex flex-wrap items-center gap-2 text-[16px]">
                喇叭延遲（毫秒，卡點題用）
                <input
                  className="px-input"
                  style={{ width: 100 }}
                  inputMode="numeric"
                  aria-label="喇叭延遲（毫秒）"
                  placeholder={String(tapLatency)}
                  value={latencyText}
                  onChange={(e) => setLatencyText(e.target.value.trim())}
                />
                <PixelButton
                  disabled={!latencyOk}
                  onClick={() => {
                    send({ type: "HOST_TAP_LATENCY", ms: Number(latencyText) });
                    setLatencyText("");
                  }}
                  className="!m-0 min-h-[44px] !px-3 !py-1 text-[15px]"
                >
                  設定
                </PixelButton>
                <span className="text-[14px]">現在 {tapLatency} ms</span>
              </label>
              <div className="text-[14px]">彩排放一題測試卡點題，揭曉後按「把延遲改成…」；再放一題，中位數接近 0 就對了（0–{MAX_TAP_LATENCY_MS}）</div>
            </section>
          )}
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
              {error && <div role="alert" className="px-2 py-1 text-[14px]" style={{ background: "#ffd9d9" }}>{error}</div>}
              {fixable.map((t) => {
                const fix = (f: HostFix) => fixAllowed(`${t.id}:${f}`) && send({ type: "HOST_FIX", teamId: t.id, fix: f });
                const small = "!m-0 min-h-[44px] min-w-[44px] !px-2 !py-0 text-[15px]";
                const max = t.abilityCap;
                return (
                  <div key={t.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-full truncate text-[16px] sm:basis-0">{t.name}</span>
                    <span className="text-[14px]">{scoreLabel} <span className="px-num text-[14px]">{t.reward}</span></span>
                    <PixelButton aria-label={`${t.name}扣 ${FIX_SCORE_STEP} 分`} disabled={t.reward <= 0} onClick={() => fix("score-")} className={small}>−{FIX_SCORE_STEP}</PixelButton>
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!settable(t.id, t.reward) || !fixAllowed(`${t.id}:set`)) return;
                        const score = Number(typedFor(t.id, t.reward));
                        setSent((s) => ({ ...s, [t.id]: score }));
                        send({ type: "HOST_SET_SCORE", teamId: t.id, score });
                      }}
                    >
                      <input
                        aria-label={`${t.name}的分數`}
                        inputMode="numeric"
                        maxLength={4}
                        placeholder={String(t.reward)}
                        value={typedFor(t.id, t.reward)}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          setTyped((s) => ({ ...s, [t.id]: v }));
                          setSent((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== t.id)));
                        }}
                        className="min-h-[44px] w-[4.5em] border-2 border-black bg-white px-2 text-[16px]"
                      />
                      <PixelButton type="submit" aria-label={`設定${t.name}的分數`} disabled={!settable(t.id, t.reward)} className={small}>設定</PixelButton>
                    </form>
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
              <div data-testid="host-rejudge" className="mt-2 flex flex-col gap-2">
                <div className="text-[15px]">改判（已判過的題目）</div>
                <div className="text-[13px]">{`只改${scoreLabel ?? "獎勵分"}，不改答對數和進度。`}</div>
                {judged.length === 0 ? (
                  <div className="text-[14px]">還沒有判過的題目</div>
                ) : (
                  <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
                    {[...judged].reverse().map((j) => {
                      const label = questionLabel(j.questionId);
                      const was = j.flipped ? (j.correct ? "答錯" : "答對") : null;
                      const button = rejudgeButton(judged, j, rewardOf(j.teamId), undoWrong);
                      return (
                        <div key={j.index} className="flex flex-wrap items-center gap-2 text-[14px]">
                          <span className="min-w-0 flex-1 basis-full truncate sm:basis-0">
                            {`第 ${ordinals.get(j.questionId)} 題`}
                            {label && ` · ${label}`}
                            {` · ${teamName(j.teamId)} · `}
                            {j.correct ? `答對 +${j.points}` : "答錯"}
                          </span>
                          {was && <span className="text-[13px]">{`已改判（原本${was}）`}</span>}
                          {laterCorrect(judged, j) && <span className="text-[13px]">這題後來答對了</span>}
                          <PixelButton
                            aria-label={`第 ${ordinals.get(j.questionId)} 題 ${teamName(j.teamId)} ${button}`}
                            onClick={() => fixAllowed(`rejudge:${j.index}`) && send({ type: "HOST_REJUDGE", index: j.index, teamId: j.teamId, questionId: j.questionId, correct: !j.correct })}
                            className="!m-0 min-h-[44px] !px-2 !py-0 text-[14px]"
                          >
                            {button}
                          </PixelButton>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
