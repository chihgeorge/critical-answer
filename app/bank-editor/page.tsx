"use client";

// Owner-only question-bank editor. Linked from the homepage, but not from anywhere in the game's
// actual play flow — gated by the OWNER_KEY the Worker checks on every /api/bank request. Supports
// two question kinds: text (fill-in: the team types its answer, the host judges it) and
// multipleChoice (options[] + correctIndex, judged by the room from the team's lock). Each kind's content — and its optional
// answer-reveal explanation — can independently be text, an uploaded image, or a YouTube video
// (see docs/designs/question-media-content.md's D1: content REPLACES the old fixed prompt text,
// it doesn't decorate it; the standalone `image` kind from image-question-type.md retired).

import { useEffect, useRef, useState } from "react";
import { LabelChip, Panel, PixelButton } from "@/components/pixel";
import { DIFFICULTIES, MAX_BOSS_HP, MAX_OPTIONS, MIN_OPTIONS, allQuestions, bossQuestions, type Bank, type BankQuestion, type BossPhase, type MediaContent } from "@/lib/question-bank";
import type { Difficulty } from "@/lib/game-state";
import { partyHttpBase } from "@/lib/party-host";
import { extractYoutubeId } from "@/lib/youtube";
import { readStored, writeStored } from "@/lib/stored";

const OWNER_KEY_STORAGE = "bank-editor-owner-key";
const bankApiBase = () => `${partyHttpBase()}/api/bank`;
const bankImageApiBase = () => `${bankApiBase()}/image`;
// Sentinel for "no correct option marked yet" — happens right after switching a question to
// multipleChoice, or after deleting the option that was marked correct. Never a valid saved
// state: validate() below blocks 儲存全部變更 while any question is stuck at this value.
const UNSET_CORRECT_INDEX = -1;
const TEXT_CONTENT: MediaContent = { kind: "text", value: "" };

/** Reads the owner key from localStorage — a per-browser convenience, not the source of truth (the
 * Worker checks it on every request; a wrong/missing key never gets past the fetch below). Starts
 * empty and reads localStorage only after mount: doing it in the initial render (e.g. useState's
 * lazy initializer) would make the client's first render disagree with the server-rendered HTML
 * (SSR has no localStorage) and trigger a React hydration mismatch. */
function useOwnerKey(onRestored: (key: string) => void) {
  const [key, setKey] = useState("");
  useEffect(() => {
    // A named function, not the effect body itself: react-hooks/set-state-in-effect.
    function restore() {
      const stored = readStored(OWNER_KEY_STORAGE);
      if (stored) {
        setKey(stored);
        onRestored(stored);
      }
    }
    restore();
    // Runs once on mount only — onRestored is the load() callback below, stable enough in practice
    // that re-running this on every render would only risk a duplicate auto-load, not a stale one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = (next: string) => {
    setKey(next);
    writeStored(OWNER_KEY_STORAGE, next);
  };
  return [key, save] as const;
}

type Location = { kind: "pool"; difficulty: Difficulty } | { kind: "boss"; phase: number };
/** Which page of the editor is open (docs/designs/scoring-and-score-pools.md D2=B: one pool per tab). */
type Tab = "rooms" | Difficulty | "boss";

/** Rooms that draw from pool `d`, as "第 2、3 房" (empty when none does). */
function roomsUsing(bank: Bank, d: Difficulty): string {
  const rooms = bank.rooms.flatMap((r, i) => (r.difficulty === d ? [i + 1] : []));
  return rooms.length ? `第 ${rooms.join("、")} 房` : "";
}

/** A reward box's text as a whole, non-negative number (an empty box is 0). */
const toReward = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

/** A content or explanation slot that's still mid-upload (image kind, empty value) or otherwise
 * incomplete is an intermediate client-only state the type system can't rule out — the same
 * reasoning multipleChoice's correctIndex sentinel already needed. */
function contentError(label: string, c: MediaContent | undefined): string | null {
  if (!c) return null;
  if (!c.value.trim()) return `${label}還沒填完（${c.kind === "image" ? "還沒上傳圖片" : c.kind === "youtube" ? "還沒貼網址" : "是空的"}）`;
  return null;
}

function validationError(bank: Bank): string | null {
  for (const [i, r] of bank.rooms.entries()) {
    if (bank.pools[r.difficulty].length === 0) return `第 ${i + 1} 房是難度 ${r.difficulty}，但難度 ${r.difficulty} 題庫沒有題目`;
  }
  // From phase 2 on, players meet a phase through its card, so it needs a name and a rule (boss-phases.md D5, D6).
  for (const [i, p] of bank.boss.phases.entries()) {
    if (i === 0) continue;
    if (!p.name.trim()) return `首領第 ${i + 1} 階段：名稱不能空白`;
    if (!p.rule.trim()) return `首領第 ${i + 1} 階段：規則不能空白`;
  }
  const all = allQuestions(bank);
  for (const q of all) {
    const label = `題目「${q.content.value || q.id}」`;
    if (q.kind === "multipleChoice") {
      if (q.options.length < MIN_OPTIONS) return `${label}至少要有 ${MIN_OPTIONS} 個選項`;
      if (q.options.length > MAX_OPTIONS) return `${label}最多 ${MAX_OPTIONS} 個選項`;
      if (q.options.some((o) => !o.trim())) return `${label}有空白選項`;
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) return `${label}還沒標記正解`;
    }
    const contentErr = contentError(`${label}的內容`, q.content);
    if (contentErr) return contentErr;
    const explanationErr = contentError(`${label}的詳解`, q.explanation);
    if (explanationErr) return explanationErr;
  }
  return null;
}

export default function BankEditorPage() {
  const [bank, setBank] = useState<Bank | null>(null);
  // The version this editor last loaded/saved. Sent back on every PUT so a save that's stale
  // (someone else — another tab, another device — saved first) is rejected with a clear conflict
  // instead of silently overwriting their edits (adversarial review, 2026-09-22).
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The stored bank can't be read by this version: what's shown is the bundled fallback, and nothing may be saved. */
  const [readOnly, setReadOnly] = useState(false);
  // Only the latest load may land: dev StrictMode runs the auto-load effect twice, and a response that
  // arrived late used to overwrite edits made after a newer load (CI on main, 2026-10-25).
  const loadSeq = useRef(0);

  const load = async (key: string) => {
    if (!key) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(bankApiBase(), { headers: { Authorization: `Bearer ${key}` } });
      if (seq !== loadSeq.current) return;
      if (res.status === 403) {
        setError("Owner key rejected.");
        setBank(null);
        return;
      }
      if (!res.ok) {
        setError(`Load failed: ${res.status}`);
        return;
      }
      const versioned: { bank: Bank; version: number; unreadable?: true } = await res.json();
      if (seq !== loadSeq.current) return;
      setBank(versioned.bank);
      setVersion(versioned.version);
      setReadOnly(!!versioned.unreadable);
    } catch {
      if (seq === loadSeq.current) setError("Could not reach the server.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  const [ownerKey, setOwnerKey] = useOwnerKey((restoredKey) => void load(restoredKey));

  const save = async (next: Bank) => {
    if (version === null) return; // no successful load yet — nothing to compare against
    const invalid = validationError(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(bankApiBase(), {
        method: "PUT",
        headers: { Authorization: `Bearer ${ownerKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bank: next, version }),
      });
      if (res.status === 409) {
        const conflict: { error: string; currentVersion: number } = await res.json();
        setError(`${conflict.error} (someone else's save is now current — press 載入題庫 to get it before retrying)`);
        return;
      }
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const versioned: { bank: Bank; version: number } = await res.json();
      setBank(versioned.bank);
      setVersion(versioned.version);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const [tab, setTab] = useState<Tab>(1);

  const questionsAt = (b: Bank, loc: Location): BankQuestion[] => (loc.kind === "boss" ? (b.boss.phases[loc.phase]?.questions ?? []) : b.pools[loc.difficulty]);

  const withQuestions = (b: Bank, loc: Location, questions: BankQuestion[]): Bank =>
    loc.kind === "boss" ? withPhase(b, loc.phase, { questions }) : { ...b, pools: { ...b.pools, [loc.difficulty]: questions } };

  const withPhase = (b: Bank, phase: number, patch: Partial<BossPhase>): Bank => ({
    ...b,
    boss: { ...b.boss, phases: b.boss.phases.map((p, i) => (i === phase ? { ...p, ...patch } : p)) },
  });
  const updatePhase = (phase: number, patch: Partial<BossPhase>) => setBank((prev) => (prev ? withPhase(prev, phase, patch) : prev));
  const addPhase = () => setBank((prev) => (prev ? { ...prev, boss: { ...prev.boss, phases: [...prev.boss.phases, { name: "", rule: "", maxHp: 3, questions: [] }] } } : prev));
  const deletePhase = (phase: number) => {
    const count = bank?.boss.phases[phase]?.questions.length ?? 0;
    // A phase can hold a whole set of prepared questions: one stray tap must not drop them all (D11).
    if (count > 0 && !window.confirm(`刪除第 ${phase + 1} 階段和它的 ${count} 題？`)) return;
    setBank((prev) => (prev ? { ...prev, boss: { ...prev.boss, phases: prev.boss.phases.filter((_, i) => i !== phase) } } : prev));
  };

  const updateRoom = (roomIndex: number, patch: Partial<Bank["rooms"][number]>) => {
    setBank((prev) => (prev ? { ...prev, rooms: prev.rooms.map((r, i) => (i === roomIndex ? { ...r, ...patch } : r)) } : prev));
  };

  // All three use the functional setBank(prev => ...) form, not the closed-over `bank` variable:
  // QuestionRow's image upload (below) awaits a real network call before its own onUpdate fires,
  // so a plain `setBank(withQuestions(bank, ...))` here would rewrite the bank from whatever
  // stale snapshot was in scope when the upload started — silently discarding any edit made
  // elsewhere in the meantime (adversarial review finding: reachable by completely normal use,
  // no attacker needed).
  const updateQuestion = (loc: Location, id: string, updater: (q: BankQuestion) => BankQuestion) => {
    setBank((prev) => {
      if (!prev) return prev;
      const questions = questionsAt(prev, loc).map((q) => (q.id === id ? updater(q) : q));
      return withQuestions(prev, loc, questions);
    });
  };

  const deleteQuestion = (loc: Location, id: string) => {
    setBank((prev) => (prev ? withQuestions(prev, loc, questionsAt(prev, loc).filter((q) => q.id !== id)) : prev));
  };

  const addQuestion = (loc: Location) => {
    setBank((prev) => {
      if (!prev) return prev;
      const id = `${loc.kind === "boss" ? "boss" : `p${loc.difficulty}`}-${crypto.randomUUID().slice(0, 8)}`;
      return withQuestions(prev, loc, [...questionsAt(prev, loc), { kind: "text", id, content: TEXT_CONTENT, answer: "" }]);
    });
  };

  /** Uploads an image file to /api/bank/image and returns its R2 key, or throws with a message
   * suitable for display. Called from MediaPicker; kept here so it can use the same ownerKey the
   * rest of the page already has. */
  const uploadImage = async (file: File): Promise<string> => {
    const res = await fetch(bankImageApiBase(), {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerKey}`, "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) throw new Error(await res.text());
    const { key } = (await res.json()) as { key: string };
    return key;
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      {/* The page sits directly on the dark stage background (no SceneBackground/Panel behind
          it), so this needs explicit light text — body's default --ink color is meant for text
          on cream panels and is nearly invisible here (same convention as screen/page.tsx). */}
      <h1 className="text-[24px] text-white" style={{ textShadow: "2px 2px 0 var(--k)" }}>
        題庫編輯器
      </h1>

      <Panel className="flex flex-col gap-2 p-4">
        <label className="text-[14px]" htmlFor="owner-key">
          Owner key
        </label>
        <input
          id="owner-key"
          type="password"
          className="px-input"
          value={ownerKey}
          onChange={(e) => setOwnerKey(e.target.value)}
        />
        <PixelButton onClick={() => void load(ownerKey)} disabled={!ownerKey || loading || saving}>
          {loading ? "載入中…" : "載入題庫"}
        </PixelButton>
        {error && (
          // Panel doesn't forward arbitrary props (no data-testid passthrough), so the test id sits
          // on this inner span; role="alert" on the Panel itself is the real screen-reader semantics.
          // Red background matches every other error surface in the app (host/page.tsx's connection
          // error) — "turn" is reserved for whose-turn-it-is, not errors.
          <Panel role="alert" className="text-[14px]" style={{ background: "#ffd9d9" }}>
            <span data-testid="bank-editor-error">{error}</span>
          </Panel>
        )}
      </Panel>

      {bank && readOnly && (
        <Panel role="alert" className="p-4 text-[15px]" style={{ background: "#ffd9d9" }}>
          <span data-testid="bank-editor-readonly">
            存著的題庫這個版本讀不懂（可能是回滾到比較舊的版本），下面顯示的是預設題目，不是你的題庫。你的題庫還在，沒有被蓋掉；在讀得懂之前不能儲存或上傳圖片。救援步驟見 README 的「題庫卡住時怎麼救」。
          </span>
        </Panel>
      )}

      {bank && (
        <div className="flex flex-col gap-4">
          <div role="tablist" className="flex flex-wrap gap-2">
            {(["rooms", ...DIFFICULTIES, "boss"] as Tab[]).map((t) => (
              <PixelButton
                key={t}
                role="tab"
                aria-selected={tab === t}
                data-testid={`bank-tab-${t}`}
                onClick={() => setTab(t)}
                className={`!m-0 !px-3 !py-1 text-[15px] ${tab === t ? "" : "opacity-70"}`}
                style={tab === t ? { background: "var(--cream, #fff3d6)" } : undefined}
              >
                {t === "rooms" ? "房間" : t === "boss" ? `首領 ${bossQuestions(bank).length}` : `難度 ${t}・${bank.pools[t].length}`}
              </PixelButton>
            ))}
          </div>
          {tab === "rooms" ? (
            <RoomsEditor bank={bank} onRoom={updateRoom} onHitReward={(hitReward) => setBank((prev) => (prev ? { ...prev, boss: { ...prev.boss, hitReward } } : prev))} />
          ) : tab === "boss" ? (
            <>
              <Panel className="p-4 text-[16px]">
                首領 · {bank.boss.monster.name} · {bank.boss.phases.length} 個階段 · {bossQuestions(bank).length} 題
                <div className="text-[13px]">首領房的隊伍輪流回答目前階段的題目。打空一個階段的血（或它的題目都出完）就換下一階段，大螢幕這時才揭曉它的名稱和規則；玩家不會知道總共有幾個階段。</div>
              </Panel>
              {bank.boss.phases.map((p, i) => {
                const loc: Location = { kind: "boss", phase: i };
                return (
                  <div key={i} className="flex flex-col gap-2">
                    <BossPhaseEditor index={i} phase={p} canDelete={bank.boss.phases.length > 1} onChange={(patch) => updatePhase(i, patch)} onDelete={() => deletePhase(i)} />
                    <RoomEditor
                      testId={i === 0 ? "bank-room-boss" : `bank-room-boss-${i + 1}`}
                      title={`第 ${i + 1} 階段的題目 · ${p.questions.length} 題`}
                      note={i === 0 ? "第 1 階段看起來就是普通的首領。" : `第 ${i} 階段打完後出現。`}
                      questions={p.questions}
                      onUpdate={(id, updater) => updateQuestion(loc, id, updater)}
                      onDelete={(id) => deleteQuestion(loc, id)}
                      onAdd={() => addQuestion(loc)}
                      onUploadImage={uploadImage}
                    />
                  </div>
                );
              })}
              <PixelButton data-testid="bank-add-phase" onClick={addPhase} className="!min-h-[44px]">
                ＋ 新增階段
              </PixelButton>
            </>
          ) : (
            (() => {
              const loc: Location = { kind: "pool", difficulty: tab };
              const used = roomsUsing(bank, tab);
              return (
                <RoomEditor
                  key={tab}
                  testId={`bank-pool-${tab}`}
                  title={`難度 ${tab} 題庫 · ${bank.pools[tab].length} 題`}
                  note={`${used ? `${used}從這裡抽題` : "目前沒有房間是這個難度"}${tab < 5 ? `；難度 ${tab === 4 ? "5" : `${tab + 1}～5`} 的房間逃跑後也會抽到` : ""}`}
                  questions={questionsAt(bank, loc)}
                  onUpdate={(id, updater) => updateQuestion(loc, id, updater)}
                  onDelete={(id) => deleteQuestion(loc, id)}
                  onAdd={() => addQuestion(loc)}
                  onUploadImage={uploadImage}
                />
              );
            })()
          )}
          <PixelButton variant="primary" onClick={() => void save(bank)} disabled={saving || loading || readOnly}>
            {saving ? "儲存中…" : "儲存全部變更"}
          </PixelButton>
        </div>
      )}
    </main>
  );
}

/** Each room's difficulty (which pool it draws from) and reward, and the boss's reward per hit. Monster
 * names and sprites are not editable here. */
function RoomsEditor({
  bank,
  onRoom,
  onHitReward,
}: {
  bank: Bank;
  onRoom: (roomIndex: number, patch: Partial<Bank["rooms"][number]>) => void;
  onHitReward: (hitReward: number) => void;
}) {
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <div data-testid="bank-rooms" className="flex flex-col gap-2">
        <h2 className="text-[18px]">房間（{bank.rooms.length} 間）</h2>
        <div className="text-[13px]">難度決定從哪個題庫抽題、答對拿幾點進度分；獎勵分決定冠軍。</div>
        {bank.rooms.map((r, i) => (
          <div key={i} data-testid={`bank-room-${i}`} className="flex flex-wrap items-center gap-2 text-[15px]">
            <span className="w-[64px]">第 {i + 1} 房</span>
            <span className="min-w-0 flex-1 truncate">{r.monster.name}</span>
            <label className="flex items-center gap-1">
              難度
              <select
                className="px-input !w-auto !py-1"
                value={r.difficulty}
                onChange={(e) => onRoom(i, { difficulty: Number(e.target.value) as Difficulty })}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              獎勵
              <input type="number" min={0} step={1} className="px-input !w-[72px] !py-1" value={r.reward} onChange={(e) => onRoom(i, { reward: toReward(e.target.value) })} />
            </label>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="w-[64px]">首領</span>
          <span className="min-w-0 flex-1 truncate">{bank.boss.monster.name}</span>
          <label className="flex items-center gap-1">
            每打中一下
            <input
              type="number"
              min={0}
              step={1}
              data-testid="bank-boss-hit-reward"
              className="px-input !w-[72px] !py-1"
              value={bank.boss.hitReward}
              onChange={(e) => onHitReward(toReward(e.target.value))}
            />
            分
          </label>
        </div>
        <div className="text-[13px]">最後一擊另外加 4 顆 D20（4～80 分）。</div>
      </div>
    </Panel>
  );
}

/** One boss phase's name, rule and HP (docs/designs/boss-phases.md, approved mockup panel 6). Phase 1's
 * name and rule are never shown to players, so only later phases require them (D5); an empty one is
 * outlined in --danger (D6). */
function BossPhaseEditor({
  index,
  phase,
  canDelete,
  onChange,
  onDelete,
}: {
  index: number;
  phase: BossPhase;
  canDelete: boolean;
  onChange: (patch: Partial<BossPhase>) => void;
  onDelete: () => void;
}) {
  const required = index > 0;
  const missing = (v: string) => (required && !v.trim() ? { boxShadow: "0 0 0 4px var(--danger)" } : undefined);
  return (
    <Panel className="flex flex-col gap-2 p-4" style={{ background: "var(--cream2)" }}>
      <div data-testid={`bank-boss-phase-${index + 1}`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <LabelChip>第 {index + 1} 階段</LabelChip>
          <label className="flex min-w-0 flex-1 items-center gap-1">
            名稱
            <input
              className="px-input !py-1"
              value={phase.name}
              placeholder={required ? "例如：主題曲之謎" : "（第 1 階段可空白）"}
              aria-invalid={!!missing(phase.name)}
              style={missing(phase.name)}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1">
            血量
            <input type="number" min={1} max={MAX_BOSS_HP} step={1} className="px-input !w-[64px] !py-1" value={phase.maxHp} onChange={(e) => onChange({ maxHp: Math.min(MAX_BOSS_HP, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} />
          </label>
          {canDelete && (
            <PixelButton variant="flee" className="!m-0 !min-h-[44px] !px-3 !py-1" onClick={onDelete}>
              刪除階段
            </PixelButton>
          )}
        </div>
        <label className="flex items-center gap-1 text-[15px]">
          規則
          <input
            className="px-input !py-1"
            value={phase.rule}
            placeholder={required ? "例如：聽前奏，說出這首是哪部作品的主題曲" : "（第 1 階段不顯示，可空白）"}
            aria-invalid={!!missing(phase.rule)}
            style={missing(phase.rule)}
            onChange={(e) => onChange({ rule: e.target.value })}
          />
        </label>
      </div>
    </Panel>
  );
}

function RoomEditor({
  testId,
  title,
  note,
  questions,
  onUpdate,
  onDelete,
  onAdd,
  onUploadImage,
}: {
  testId: string;
  title: string;
  note: string;
  questions: BankQuestion[];
  onUpdate: (id: string, updater: (q: BankQuestion) => BankQuestion) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onUploadImage: (file: File) => Promise<string>;
}) {
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <div data-testid={testId} className="flex flex-col gap-2">
        <h2 className="text-[18px]">{title}</h2>
        <div className="text-[13px]">{note}</div>
        {questions.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            onUpdate={(updater) => onUpdate(q.id, updater)}
            onDelete={() => onDelete(q.id)}
            onUploadImage={onUploadImage}
          />
        ))}
        <PixelButton onClick={onAdd}>+ 新增題目</PixelButton>
      </div>
    </Panel>
  );
}

/** A fresh question of the given outer kind, keeping only `id`/`content` — switching kind never
 * carries over the other kind's fields (no auto-conversion; the two kinds' extra fields aren't
 * comparable). The standalone `image` kind retired (D1) — content/explanation media type is
 * chosen independently via MediaPicker, not by the outer kind selector. */
function blankQuestion(q: BankQuestion, kind: BankQuestion["kind"]): BankQuestion {
  // explanation carries over just like content does — dropping it here would silently discard
  // an uploaded image/video with no warning at all, bypassing MediaPicker's own confirm() gate
  // entirely (adversarial review finding, /ship).
  if (kind === "text") return { kind: "text", id: q.id, content: q.content, answer: "", explanation: q.explanation };
  return {
    kind: "multipleChoice",
    id: q.id,
    content: q.content,
    options: ["", ""],
    correctIndex: UNSET_CORRECT_INDEX,
    explanation: q.explanation,
  };
}

/** Picks text / uploaded image / YouTube video for one content slot (a question's `content`, or
 * its optional `explanation`). Switching media type discards the prior value immediately — no
 * draft-preservation across kinds — with a native `confirm()` first if the slot being switched
 * away from is non-empty (docs/designs/question-media-content.md's R1-6 decision; this is new UI
 * pattern work, not reuse — the codebase had no existing confirm() precedent, per the design
 * doc's own Outside Voice correction). `allowNone` renders a fourth "無" tab that clears the slot
 * entirely — only the explanation slot uses it; a question's own content is always required. */
function MediaPicker({
  fieldId,
  label,
  value,
  onChange,
  onUploadImage,
  allowNone,
}: {
  fieldId: string;
  label: string;
  value: MediaContent | undefined;
  onChange: (next: MediaContent | undefined) => void;
  onUploadImage: (file: File) => Promise<string>;
  allowNone?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  /** The upload's or the pasted YouTube link's problem, if any. */
  const [error, setError] = useState("");
  const [youtubeInput, setYoutubeInput] = useState(value?.kind === "youtube" ? value.value : "");

  const current = value ?? TEXT_CONTENT;
  const hasContent = value !== undefined && value.value.trim() !== "";

  const switchTo = (kind: MediaContent["kind"] | "none") => {
    // Re-clicking the already-active tab is a no-op, not a discard — every tab button below
    // calls switchTo(kind) unconditionally on click, so without this guard, clicking a
    // non-empty slot's own active tab popped the confirm() and wiped it on accept (test-coverage
    // audit finding, /ship).
    if (kind !== "none" && value !== undefined && value.kind === kind) return;
    if (hasContent && !window.confirm("換媒材類型會清空目前已填的內容，確定嗎？")) return;
    setError("");
    setYoutubeInput("");
    onChange(kind === "none" ? undefined : { kind, value: "" });
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const key = await onUploadImage(file);
      onChange({ kind: "image", value: key });
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  const handleYoutubeInput = (pasted: string) => {
    setYoutubeInput(pasted);
    if (!pasted.trim()) {
      setError("");
      onChange({ kind: "youtube", value: "" });
      return;
    }
    const id = extractYoutubeId(pasted);
    if (!id) {
      setError("看不出這是 YouTube 網址");
      onChange({ kind: "youtube", value: "" });
      return;
    }
    setError("");
    onChange({ kind: "youtube", value: id });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-black/60">{label}</span>
        <div className="flex gap-1">
          {(["text", "image", "youtube", ...(allowNone ? ["none" as const] : [])] as const).map((kind) => {
            const kindLabel = { text: "文字", image: "圖片", youtube: "YouTube", none: "無" }[kind];
            const pressed = kind === "none" ? value === undefined : current.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                className={`px-btn !px-2 !py-1 text-[12px] ${pressed ? "!bg-[var(--turn)]" : ""}`}
                aria-pressed={pressed}
                aria-label={`${label}：${kindLabel}`}
                disabled={uploading}
                onClick={() => switchTo(kind)}
              >
                {kindLabel}
              </button>
            );
          })}
        </div>
      </div>

      {value === undefined ? null : current.kind === "text" ? (
        <input
          className="px-input"
          aria-label={`${label}文字`}
          value={current.value}
          onChange={(e) => onChange({ kind: "text", value: e.target.value })}
        />
      ) : current.kind === "image" ? (
        <div className="flex items-center gap-2">
          {/* Native file inputs can't be restyled directly — sr-only + a px-btn label is the
              standard pattern, so this matches the page's other pixel-styled controls instead
              of showing the browser's default control (design review finding). */}
          <input
            // fieldId (a question id + slot, not the shared "題目"/"詳解" label text) — two
            // image questions in the same room previously collided on this id, so clicking the
            // second row's label resolved to the FIRST row's <input> (test-coverage audit
            // finding, /ship).
            id={`image-upload-${fieldId}`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label={`上傳${label}圖片`}
            disabled={uploading}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // lets re-selecting the same file re-trigger onChange
              if (file) void handleFile(file);
            }}
          />
          <label htmlFor={`image-upload-${fieldId}`} className={`px-btn${uploading ? " pointer-events-none opacity-55" : ""}`}>
            選擇圖片
          </label>
          {uploading && <span className="text-[13px]">上傳中…</span>}
          {current.value && !uploading && <span className="text-[13px]">已上傳（{current.value.slice(0, 8)}…）</span>}
        </div>
      ) : (
        <input
          className="px-input"
          aria-label={`${label}的 YouTube 網址`}
          placeholder="貼上 YouTube 網址"
          value={youtubeInput}
          onChange={(e) => handleYoutubeInput(e.target.value)}
        />
      )}
      {error && (
        <Panel role="alert" className="text-[13px]" style={{ background: "#ffd9d9" }}>
          {error}
        </Panel>
      )}
    </div>
  );
}

function QuestionRow({
  question: q,
  onUpdate,
  onDelete,
  onUploadImage,
}: {
  question: BankQuestion;
  onUpdate: (updater: (q: BankQuestion) => BankQuestion) => void;
  onDelete: () => void;
  onUploadImage: (file: File) => Promise<string>;
}) {
  return (
    <div data-testid={`question-${q.id}`} className="flex flex-col gap-1 border-t border-black/10 pt-2 first:border-t-0 first:pt-0">
      <div className="flex gap-2">
        <div className="flex-1">
          <MediaPicker fieldId={`${q.id}-content`} label="題目" value={q.content} onChange={(c) => onUpdate((cur) => ({ ...cur, content: c! }))} onUploadImage={onUploadImage} />
        </div>
        <select
          className="px-input"
          // .px-input sets width:100% as unlayered CSS (outside Tailwind's @layer), which always
          // beats a Tailwind width utility here — so the fix has to be an inline style, the one
          // thing with higher priority than any stylesheet rule. Without it this <select> claims
          // the whole flex row (flex-basis resolves from its own width:100%) and squeezes the
          // sibling content picker down (bug found 2026-09-23: multipleChoice questions
          // looked like they had no editable question-text field at all).
          style={{ width: "auto" }}
          aria-label="題型"
          value={q.kind}
          onChange={(e) => onUpdate((cur) => blankQuestion(cur, e.target.value as BankQuestion["kind"]))}
        >
          <option value="text">填空</option>
          <option value="multipleChoice">選擇</option>
        </select>
      </div>

      <MediaPicker
        fieldId={`${q.id}-explanation`}
        label="詳解"
        value={q.explanation}
        onChange={(c) => onUpdate((cur) => ({ ...cur, explanation: c }))}
        onUploadImage={onUploadImage}
        allowNone
      />

      {q.kind === "text" ? (
        <div className="flex gap-2">
          <input
            className="px-input flex-1"
            aria-label="答案"
            value={q.answer}
            onChange={(e) => onUpdate((cur) => (cur.kind === "text" ? { ...cur, answer: e.target.value } : cur))}
          />
          <PixelButton variant="flee" onClick={onDelete}>
            刪除
          </PixelButton>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {q.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                aria-label={`第 ${i + 1} 個選項為正解`}
                name={`correct-${q.id}`}
                checked={q.correctIndex === i}
                onChange={() => onUpdate((cur) => (cur.kind === "multipleChoice" ? { ...cur, correctIndex: i } : cur))}
              />
              <input
                className="px-input flex-1"
                aria-label={`選項 ${i + 1}`}
                value={opt}
                onChange={(e) =>
                  onUpdate((cur) =>
                    cur.kind === "multipleChoice"
                      ? { ...cur, options: cur.options.map((o, j) => (j === i ? e.target.value : o)) }
                      : cur,
                  )
                }
              />
              <PixelButton
                variant="flee"
                disabled={q.options.length <= MIN_OPTIONS}
                onClick={() =>
                  onUpdate((cur) => {
                    if (cur.kind !== "multipleChoice") return cur;
                    const options = cur.options.filter((_, j) => j !== i);
                    // Deleting the option marked correct forces re-marking; deleting one before it
                    // just shifts the index so the same option is still marked.
                    const correctIndex =
                      cur.correctIndex === i ? UNSET_CORRECT_INDEX : cur.correctIndex > i ? cur.correctIndex - 1 : cur.correctIndex;
                    return { ...cur, options, correctIndex };
                  })
                }
              >
                刪
              </PixelButton>
            </div>
          ))}
          <div className="flex gap-2">
            <PixelButton
              disabled={q.options.length >= MAX_OPTIONS}
              onClick={() => onUpdate((cur) => (cur.kind === "multipleChoice" ? { ...cur, options: [...cur.options, ""] } : cur))}
            >
              + 新增選項
            </PixelButton>
            <PixelButton variant="flee" onClick={onDelete}>
              刪除題目
            </PixelButton>
          </div>
        </div>
      )}
    </div>
  );
}
