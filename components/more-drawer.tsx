"use client";

import { MAX_TAP_LATENCY_MS } from "@/lib/tap-clock";
import { useEffect, useState, type ReactNode } from "react";
import { pressCooldown } from "@/lib/press-cooldown";
import { getHostToken } from "@/lib/room-code";
import type { ClientMessage, JudgedEntry, ScreenAudio } from "@/lib/protocol";
import { BOSS_THRESHOLD } from "@/lib/turn-info";
import { CATCH_USES, CLASS_ICONS, FIX_SCORE_MAX, FIX_SCORE_STEP, ORACLE_USES, type HostFix, type SpectatorView } from "@/lib/game-state";
import { laterCorrect, questionOrdinals, rejudgeButton, rejudgeRows } from "@/lib/host-rejudge";
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
  teamTools,
  teamSprite,
  bossPick,
  bossable,
  bossThreshold = BOSS_THRESHOLD,
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
  calibrate,
  pacing,
  narration,
  lobby,
}: {
  /** The page's origin ("" before hydration). */
  origin: string;
  code: string;
  onClose: () => void;
  send: (msg: ClientMessage) => void;
  /** The AI key and limit settings. */
  ai: ReactNode;
  /** A team's rarer tools (指定下一題 / 🧪 給藥水 / 交給新手機), under its ⋯ in 隊伍, while a game plays. */
  teamTools?: (teamId: string) => ReactNode;
  /** A team's character, at the start of its row in 隊伍. */
  teamSprite?: (teamId: string) => ReactNode;
  /** 首領房下一題's line and its pick, under the team rows. */
  bossPick?: ReactNode;
  /** 手動停頓's switch (manual-pacing.md). */
  pacing?: ReactNode;
  /** The narration panel (下一句這樣說, edits), while a game plays. */
  narration?: ReactNode;
  /** The lobby's setup: the join password and the bank checks. */
  lobby?: ReactNode;
  /** Teams in play and not yet in the boss room: the host may send one there (scoring-and-score-pools.md S13). */
  bossable: { id: string; name: string }[];
  /** The game's 進王門檻 (view.bossThreshold), for the 送王房 line. */
  bossThreshold?: number;
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
  /** The page's last refusal, shown again above the groups: the drawer covers the page's own error line. */
  error?: string | null;
  /** The speaker latency for timing questions (timing-tap.md 8) while a game plays; undefined hides the field. */
  tapLatency?: number;
  /** 🎯 校正喇叭 (tap-calibrate.md), in the lobby only: shown under 開局準備. */
  calibrate?: ReactNode;
}) {
  // One section open at a time (ui-simplify H1): the teams in a game, the setup in the lobby.
  // `undefined` = the phase's default, so a game starting (or ending) with the drawer open lands on a group that exists.
  const [chosen, setOpen] = useState<string | null | undefined>(undefined);
  const fallback = fixable.length > 0 ? "teams" : lobby || calibrate ? "setup" : null;
  const shown = new Set([fixable.length > 0 && "teams", fixable.length > 0 && "rejudge", (lobby || calibrate) && "setup", screen && "screen", "other"]);
  const open = chosen === undefined || (chosen !== null && !shown.has(chosen)) ? fallback : chosen;
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  const section = (key: string, title: string, status: ReactNode, body: ReactNode) => (
    <Section key={key} id={key} title={title} status={status} open={open === key} onToggle={() => setOpen(open === key ? null : key)}>
      {body}
    </Section>
  );
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
          {/* Always in view (ui-simplify H1): the big screens' sound and the pacing, one row each. */}
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {AUDIO_SWITCHES.map(({ key, label }) => (
                <PixelButton
                  key={key}
                  role="switch"
                  aria-checked={screenAudio[key]}
                  variant={screenAudio[key] ? undefined : "flee"}
                  onClick={() => send({ type: "HOST_SCREEN_AUDIO", key, on: !screenAudio[key] })}
                  className="!m-0 min-h-[44px] !px-3 !py-2 text-[15px]"
                >
                  {`${label}：${screenAudio[key] ? "開" : "關"}`}
                </PixelButton>
              ))}
            </div>
            <div className="text-[13px]">每台大螢幕都跟著這裡；🎵 關掉時判分音效和環境音也一起關，主持人加料一直都在。</div>
            {pacing && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px]">節奏</span>
                {pacing}
                <span className="text-[13px]">手動：每一步都停下來，等你按「▶ 下一步」</span>
              </div>
            )}
          </section>
          {/* A refused fix, 改判 or 送王房 says why here, whichever group is open (the drawer covers the page's own line). */}
          {error && <div role="alert" className="px-2 py-1 text-[14px]" style={{ background: "#ffd9d9" }}>{error}</div>}
          {fixable.length > 0 &&
            section(
              "teams",
              "隊伍",
              `${fixable.length} 隊`,
              <div data-testid="host-fix" className="flex flex-col gap-2">
                {fixable.map((t) => {
                  const fix = (f: HostFix) => fixAllowed(`${t.id}:${f}`) && send({ type: "HOST_FIX", teamId: t.id, fix: f });
                  const small = "!m-0 min-h-[44px] min-w-[44px] !px-2 !py-0 text-[15px]";
                  const max = t.abilityCap;
                  const more = toolsFor === t.id;
                  return (
                    <div key={t.id} className="flex flex-col gap-2 border-b border-[var(--k)]/20 pb-2">
                      <div className="flex items-center gap-2">
                        {teamSprite?.(t.id)}
                        {/* Name over its numbers: on a phone the buttons leave the name too little width beside them. */}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[16px]">
                            {t.name}
                            {t.online ? "" : "（離線）"}
                          </span>
                          <span className="truncate text-[14px]">
                            {scoreLabel} <span className="px-num text-[14px]">{t.reward}</span>
                            {max !== undefined && t.classId && <>{"・"}{CLASS_ICONS[t.classId]}{t.abilityUses}/{max}</>}
                          </span>
                        </span>
                        <PixelButton aria-label={`${t.name}扣 ${FIX_SCORE_STEP} 分`} disabled={t.reward <= 0} onClick={() => fix("score-")} className={small}>−{FIX_SCORE_STEP}</PixelButton>
                        <PixelButton aria-label={`${t.name}加 ${FIX_SCORE_STEP} 分`} onClick={() => fix("score+")} className={small}>+{FIX_SCORE_STEP}</PixelButton>
                        <PixelButton aria-label={`${t.name}的更多工具`} aria-expanded={more} onClick={() => setToolsFor(more ? null : t.id)} className={small} style={{ background: more ? "var(--k)" : "#fff", color: more ? "#fff" : undefined }}>
                          ⋯
                        </PixelButton>
                      </div>
                      {more && (
                        <div className="flex flex-wrap items-center gap-2 pl-2">
                          {teamTools?.(t.id)}
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
                            <span aria-hidden className="text-[14px]">分數</span>
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
                          {max !== undefined && t.classId && (
                            <>
                              <span aria-hidden className="text-[14px]">技能 {CLASS_ICONS[t.classId]}</span>
                              <PixelButton aria-label={`${t.name}能力少 1 次`} disabled={t.abilityUses <= 0} onClick={() => fix("ability-")} className={small}>−1</PixelButton>
                              <PixelButton aria-label={`${t.name}能力多 1 次`} disabled={t.abilityUses >= max} onClick={() => fix("ability+")} className={small}>+1</PixelButton>
                            </>
                          )}
                          {t.item && (
                            <PixelButton aria-label={`收回${t.name}的藥水`} onClick={() => fix("potion-")} className={small}>收回🧪</PixelButton>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {bossPick}
                <div className="text-[13px]">−5／+5、設定分數（⋯ 裡）是判錯時用的修正：大螢幕不會有動畫或旁白，只會換成新的數字；每一下都記在對局紀錄裡。⋯ 裡還有指定下一題、給藥水、交給新手機、技能次數。</div>
              </div>,
            )}
          {fixable.length > 0 &&
            section(
              "rejudge",
              "改判已判過的題目",
              `${judged.length} 題`,
              <div data-testid="host-rejudge" className="flex flex-col gap-2">
                <div className="text-[13px]">{`只改${scoreLabel ?? "獎勵分"}，不改答對數和進度。`}</div>
                {judged.length === 0 ? (
                  <div className="text-[14px]">還沒有判過的題目</div>
                ) : (
                  <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
                    {rejudgeRows(judged).map((j) => {
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
                          {/* A warrior's roll is its own die's: 改判 never moves it (owner, 2026-11-17). */}
                          {j.warrior ? <span className="text-[13px]">戰士擲骰，只看骰子，不能改判</span> : (
                          <PixelButton
                            aria-label={`第 ${ordinals.get(j.questionId)} 題 ${teamName(j.teamId)} ${button}`}
                            onClick={() => fixAllowed(`rejudge:${j.index}`) && send({ type: "HOST_REJUDGE", index: j.index, teamId: j.teamId, questionId: j.questionId, correct: !j.correct })}
                            className="!m-0 min-h-[44px] !px-2 !py-0 text-[14px]"
                          >
                            {button}
                          </PixelButton>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>,
            )}
          {(lobby || calibrate) &&
            section(
              "setup",
              "開局準備",
              "",
              <div className="flex flex-col gap-4">
                {lobby}
                {calibrate}
              </div>,
            )}
          {/* The narration panel folds itself (its own 地城主旁白 toggle with a status line). */}
          {narration && <section>{narration}</section>}
          {screen && section("screen", "大螢幕連結", "", screen)}
          {section(
            "other",
            "其他",
            antiCheat ? "抓包與神諭 開" : "",
            <div className="flex flex-col gap-4">
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
          {bossable.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="text-[15px]">{`送隊伍進王房（不用等到 ${bossThreshold} 分，送了不能退回）`}</div>
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
              <div className="text-[14px]">開場前先放一題測試卡點題，揭曉後按「把延遲改成…」；再放一題，中位數接近 0 就對了（0–{MAX_TAP_LATENCY_MS}）</div>
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
            </div>,
          )}
        </div>
      </Panel>
    </div>
  );
}

/** One folding drawer group (ui-simplify H1): a title row that says the group's state, its body only while open. */
function Section({ id, title, status, open, onToggle, children }: { id: string; title: string; status: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        data-testid={`more-section-${id}`}
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-[44px] items-center gap-2 border-b-2 border-[var(--k)] pb-[2px] text-left text-[17px]"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span className="flex-1">{title}</span>
        {status && <span className="text-[14px]">{status}</span>}
      </button>
      {open && children}
    </section>
  );
}
