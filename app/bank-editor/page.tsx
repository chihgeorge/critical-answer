"use client";

// Owner-only question-bank editor. Linked from the homepage, but not from anywhere in the game's
// actual play flow — gated by the OWNER_KEY the Worker checks on every /api/bank request. Supports
// three question kinds: text (fill-in: the team types its answer, the host judges it),
// multipleChoice (options[] + correctIndex, judged by the room from the team's lock) and sort (four
// items in the correct order, the question states the rule; judged from the lock too). Each kind's content — and its optional
// answer-reveal explanation — can independently be text, an uploaded image, or a YouTube video
// (see docs/designs/question-media-content.md's D1: content REPLACES the old fixed prompt text,
// it doesn't decorate it; the standalone `image` kind from image-question-type.md retired).

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { LabelChip, Panel, PixelButton, Sprite } from "@/components/pixel";
import { UNSET_CORRECT_INDEX, blankQuestion, withCategory, withField } from "@/lib/bank-editor-question";
import { BANK_LOAD_TIMEOUT_MS, IMAGE_UPLOAD_TIMEOUT_MS, editorBusy } from "@/lib/bank-editor-locks";
import { DIFFICULTIES, MAX_BOSS_HP, MAX_CATEGORY, MAX_FIELD_LABEL, MAX_FIELDS, MAX_PROMPT, MAX_OPTIONS, MAX_PHASE_NAME, MAX_PHASE_RULE, MIN_FIELDS, MIN_OPTIONS, allQuestions, bossQuestions, isMusicQuestion, textQuestionGaps, type Bank, type BankQuestion, type BossPhase, type MediaContent } from "@/lib/question-bank";
import { MONSTERS, monsterById } from "@/lib/monster-catalog";
import { DISH_SPRITE } from "@/lib/sprite-kind";
import { MAX_TEAMS, scoreName } from "@/lib/protocol";
import { bankSize, bankSizeWarning, bankSizeWarningText } from "@/lib/bank-size";
import { DEFAULT_BOSS_DIFFICULTY, type Difficulty } from "@/lib/game-state";
import { partyHttpBase } from "@/lib/party-host";
import { extractYoutubeId, formatClipTime, parseClipTime } from "@/lib/youtube";
import { YoutubePlayer } from "@/components/youtube-player";
import { InstagramPlayer } from "@/components/instagram-player";
import { extractInstagramShortcode } from "@/lib/instagram";
import { readStored, writeStored } from "@/lib/stored";

const OWNER_KEY_STORAGE = "bank-editor-owner-key";
const bankApiBase = () => `${partyHttpBase()}/api/bank`;
const bankImageApiBase = () => `${bankApiBase()}/image`;
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
  if (!c.value.trim()) return `${label}還沒填完（${c.kind === "image" ? "還沒上傳圖片" : c.kind === "youtube" || c.kind === "instagram" ? "還沒貼網址" : "是空的"}）`;
  // ClipFields stores NaN for a time it can't read, so 儲存 refuses it instead of keeping the last good one.
  if (Number.isNaN(c.start) || Number.isNaN(c.end)) return `${label}的時間看不懂（請打 1:05 或 65）`;
  if (c.end !== undefined && c.end <= (c.start ?? 0)) return `${label}的結束時間要在開始時間之後`;
  return null;
}

function validationError(bank: Bank): string | null {
  for (const [i, r] of bank.rooms.entries()) {
    if (bank.pools[r.difficulty].length === 0) return `第 ${i + 1} 房是難度 ${r.difficulty}，但難度 ${r.difficulty} 題庫沒有題目`;
  }
  // From phase 2 on, players meet a phase through its card, so it needs a name and a rule (boss-phases.md D5, D6).
  for (const [i, p] of bank.boss.phases.entries()) {
    // 搶答 (boss-buzzer.md D1, D3): from phase 2 on, fill-ins only; parseBank refuses the rest too.
    if (p.buzzer && i === 0) return "首領第 1 階段不能是搶答階段";
    if (p.buzzer && p.questions.some((q) => q.kind !== "text")) return `首領第 ${i + 1} 階段是搶答階段：只能放填空題`;
    if (Array.from(p.name.trim()).length > MAX_PHASE_NAME) return `首領第 ${i + 1} 階段：名稱最多 ${MAX_PHASE_NAME} 個字`;
    if (Array.from(p.rule.trim()).length > MAX_PHASE_RULE) return `首領第 ${i + 1} 階段：規則最多 ${MAX_PHASE_RULE} 個字`;
    if (i === 0) continue;
    if (!p.name.trim()) return `首領第 ${i + 1} 階段：名稱不能空白`;
    if (!p.rule.trim()) return `首領第 ${i + 1} 階段：規則不能空白`;
  }
  const all = allQuestions(bank);
  // Answer fields only on a buzzer phase's music questions (multi-field.md F1, E3): parseBank refuses the rest too.
  const fieldsOk = new Set(bank.boss.phases.flatMap((p) => (p.buzzer ? p.questions.filter(isMusicQuestion).map((q) => q.id) : [])));
  for (const q of all) {
    const label = `題目「${q.content.value || q.id}」`;
    if (q.kind === "text" && q.fields) {
      if (!fieldsOk.has(q.id)) return `${label}有答案欄位，但只有搶答階段裡「只放聲音」的 YouTube 題能有：改回聽歌題，或按「移除欄位」`;
      if (q.fields.length < MIN_FIELDS || q.fields.length > MAX_FIELDS) return `${label}的答案欄位要 ${MIN_FIELDS}–${MAX_FIELDS} 欄`;
      if (q.fields.some((f) => !f.label.trim() || !f.answer.trim())) return `${label}有答案欄位的名稱或答案是空白`;
      if (q.fields.some((f) => Array.from(f.label.trim()).length > MAX_FIELD_LABEL)) return `${label}的欄位名稱最多 ${MAX_FIELD_LABEL} 個字`;
    }
    if (q.kind === "multipleChoice") {
      if (q.options.length < MIN_OPTIONS) return `${label}至少要有 ${MIN_OPTIONS} 個選項`;
      if (q.options.length > MAX_OPTIONS) return `${label}最多 ${MAX_OPTIONS} 個選項`;
      if (q.options.some((o) => !o.trim())) return `${label}有空白選項`;
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) return `${label}還沒標記正解`;
    }
    if (q.kind === "sort") {
      if (q.items.some((o) => !o.trim())) return `${label}有空白的排序項目`;
      if (new Set(q.items.map((o) => o.trim())).size !== q.items.length) return `${label}有重複的排序項目`;
    }
    const contentErr = contentError(`${label}的內容`, q.content);
    if (contentErr) return contentErr;
    if (q.prompt !== undefined && Array.from(q.prompt).length > MAX_PROMPT) return `${label}的題幹最多 ${MAX_PROMPT} 個字`;
    if (q.category !== undefined && Array.from(q.category.trim()).length > MAX_CATEGORY) return `${label}的類別最多 ${MAX_CATEGORY} 個字`;
    const explanationErr = contentError(`${label}的詳解`, q.explanation);
    if (explanationErr) return explanationErr;
  }
  return null;
}

export default function BankEditorPage() {
  const [bank, setBank] = useState<Bank | null>(null);
  // The bank as last loaded or saved: every edit makes a new object, so `bank !== savedBank.current` means unsaved edits.
  const savedBank = useRef<Bank | null>(null);
  // The version this editor last loaded/saved. Sent back on every PUT so a save that's stale
  // (someone else — another tab, another device — saved first) is rejected with a clear conflict
  // instead of silently overwriting their edits (adversarial review, 2026-09-22).
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Image uploads in flight: they lock the editor like a load or save (editorBusy). */
  const [uploads, setUploads] = useState(0);
  const busy = editorBusy({ loading, saving, uploads });
  /** The bank the last save returned: while it is still the one shown, the page says 已儲存. An edit or a load makes a new object. */
  const [lastSaved, setLastSaved] = useState<Bank | null>(null);
  /** The stored bank can't be read by this version: what's shown is the bundled fallback, and nothing may be saved. */
  const [readOnly, setReadOnly] = useState(false);
  /** The stored bank is an older format (docs/designs/monster-catalog.md §5): shown is the default bank, and a save replaces the old one. */
  const [outdated, setOutdated] = useState<number | null>(null);
  /** The server answered with whole monster objects: a Worker from before the catalog, mid-deploy (R3). */
  const [staleServer, setStaleServer] = useState(false);
  // Only the latest load may land: dev StrictMode runs the auto-load effect twice, and a response that
  // arrived late used to overwrite edits made after a newer load (CI on main, 2026-10-25).
  const loadSeq = useRef(0);

  const load = async (key: string) => {
    if (!key) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(bankApiBase(), { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(BANK_LOAD_TIMEOUT_MS) });
      if (seq !== loadSeq.current) return;
      if (res.status === 403) {
        setError("Owner key rejected.");
        setBank(null);
        savedBank.current = null;
        return;
      }
      if (!res.ok) {
        setError(`Load failed: ${res.status}`);
        return;
      }
      const versioned: { bank: Bank; version: number; unreadable?: true; outdated?: number } = await res.json();
      if (seq !== loadSeq.current) return;
      const stale = [...versioned.bank.rooms.map((r) => r.monster), versioned.bank.boss.monster].some((m) => typeof m !== "string");
      setBank(versioned.bank);
      savedBank.current = versioned.bank;
      setVersion(versioned.version);
      setReadOnly(!!versioned.unreadable || stale);
      setStaleServer(stale);
      setOutdated(versioned.outdated ?? null);
    } catch {
      if (seq === loadSeq.current) setError("Could not reach the server.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  // Reload, tab close or the back button would drop unsaved edits too, so the browser asks first.
  useEffect(() => {
    if (bank === savedBank.current) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [bank]);

  const [ownerKey, setOwnerKey] = useOwnerKey((restoredKey) => void load(restoredKey));

  /** Every finished game's record as a JSON file (lib/game-log.ts): for tuning boss HP and the entry score. */
  const downloadGameLogs = async () => {
    setError("");
    try {
      const res = await fetch(`${partyHttpBase()}/api/game-logs`, { headers: { Authorization: `Bearer ${ownerKey}` } });
      if (!res.ok) {
        setError(res.status === 403 ? "Owner key rejected." : `Download failed: ${res.status}`);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `game-logs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); // revoking at once makes some browsers drop the download
    } catch {
      setError("Could not reach the server.");
    }
  };

  const save = async (next: Bank) => {
    if (version === null) return; // no successful load yet — nothing to compare against
    setLastSaved(null); // a save that fails must not leave the last one's 已儲存 up
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
        setError("題庫在你載入後被別人存過了：先按「載入題庫」拿最新版，再改一次存檔。");
        return;
      }
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const versioned: { bank: Bank; version: number } = await res.json();
      setBank(versioned.bank);
      savedBank.current = versioned.bank;
      setLastSaved(versioned.bank);
      setVersion(versioned.version);
      setOutdated(null);
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
    // The count drops just before MediaPicker's onChange writes the key: both land in the same render, before any click.
    setUploads((n) => n + 1);
    try {
      const res = await fetch(bankImageApiBase(), {
        method: "POST",
        headers: { Authorization: `Bearer ${ownerKey}`, "Content-Type": file.type },
        body: file,
        signal: AbortSignal.timeout(IMAGE_UPLOAD_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(await res.text());
      const { key } = (await res.json()) as { key: string };
      return key;
    } catch (err) {
      // A timed-out fetch rejects with the browser's own English text.
      throw err instanceof DOMException && err.name === "TimeoutError" ? new Error("上傳逾時，請再試一次") : err;
    } finally {
      setUploads((n) => n - 1);
    }
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      {/* The page sits directly on the dark stage background (no SceneBackground/Panel behind
          it), so this needs explicit light text — body's default --ink color is meant for text
          on cream panels and is nearly invisible here (same convention as screen/page.tsx). */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] text-white" style={{ textShadow: "2px 2px 0 var(--k)" }}>
          題庫編輯器
        </h1>
        <Link
          href="/"
          onClick={(e) => {
            if (bank !== savedBank.current && !window.confirm("還沒儲存的修改會不見，確定回首頁？")) e.preventDefault();
          }}
          className="text-[15px] text-white underline underline-offset-2"
          style={{ textShadow: "1px 1px 0 var(--k)" }}
        >
          ← 回首頁
        </Link>
      </div>

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
        <PixelButton
          onClick={() => {
            // Loading replaces the bank shown here, so unsaved edits would go without a word.
            if (bank !== savedBank.current && !window.confirm("還沒儲存的修改會不見，確定重新載入？")) return;
            void load(ownerKey);
          }}
          disabled={!ownerKey || busy}
        >
          {loading ? "載入中…" : uploads > 0 ? "圖片上傳中…" : "載入題庫"}
        </PixelButton>
        <button
          type="button"
          className="self-start text-[14px] underline underline-offset-2 disabled:opacity-55"
          onClick={() => void downloadGameLogs()}
          disabled={!ownerKey}
        >
          ⬇ 下載對局紀錄（JSON）
        </button>
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

      {bank && staleServer && (
        <Panel role="alert" className="p-4 text-[15px]" style={{ background: "#ffd9d9" }}>
          <span data-testid="bank-editor-stale-server">伺服器還是舊版，等部署完成再重新載入。</span>
        </Panel>
      )}

      {bank && outdated !== null && !readOnly && (
        <Panel role="status" className="p-4 text-[15px]" style={{ background: "var(--warn)", color: "var(--ink)" }}>
          <span data-testid="bank-editor-outdated">
            正式站題庫是舊格式（格式 {outdated}），這版讀不懂。畫面上是預設題庫；按「儲存」會把舊題庫蓋掉。要留舊題庫，先照題庫指南備份。
          </span>
        </Panel>
      )}

      {bank && readOnly && !staleServer && (
        <Panel role="alert" className="p-4 text-[15px]" style={{ background: "#ffd9d9" }}>
          <span data-testid="bank-editor-readonly">
            存著的題庫這個版本讀不懂（可能是回滾到比較舊的版本），下面顯示的是預設題目，不是你的題庫。你的題庫還在，沒有被蓋掉；在讀得懂之前不能儲存或上傳圖片。救援步驟見 docs/question-bank.md 的「題庫卡住時怎麼救」。
          </span>
        </Panel>
      )}

      {bank && (
        <>
        {/* Locked while a load, save or image upload is in flight (editorBusy): an auto-load landing before the clicked load
            once dropped an edit (CI on main #150). The save button stays outside, so it keeps focus while it saves. */}
        <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
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
            <RoomsEditor
              bank={bank}
              onRoom={updateRoom}
              onHitReward={(hitReward) => setBank((prev) => (prev ? { ...prev, boss: { ...prev.boss, hitReward } } : prev))}
              onBossMonster={(monster) => setBank((prev) => (prev ? { ...prev, boss: { ...prev.boss, monster } } : prev))}
              onRandomMonsters={(randomMonsters) => setBank((prev) => (prev ? { ...prev, randomMonsters } : prev))}
            />
          ) : tab === "boss" ? (
            <>
              <Panel className="p-4 text-[16px]">
                首領 · {monsterById(bank.boss.monster)?.name ?? ""} · {bank.boss.phases.length} 個階段 · {bossQuestions(bank).length} 題
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
                      categories={!!p.buzzer}
                      difficulty
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
          {(() => {
            const gaps = textQuestionGaps(bank);
            const lines = [...gaps.difficulties.map((d) => `難度 ${d} 沒有填空題，這一房只會出選擇題`), ...(gaps.boss ? ["首領沒有填空題，首領戰只會出選擇題"] : [])];
            return lines.length > 0 && (
              <div data-testid="bank-text-gaps" role="status" className="text-[15px]" style={{ color: "var(--warn)" }}>
                {lines.map((l) => <div key={l}>⚠ {l}（不會擲說服檢定）</div>)}
              </div>
            );
          })()}
        </fieldset>
          {(() => {
            // Sized for a full room; a warning, not a block: a small themed bank may still be what the host wants.
            const w = bankSizeWarning(bankSize(bank), MAX_TEAMS);
            return w && (
              <div data-testid="bank-size-warning" role="status" className="text-[15px]" style={{ color: "var(--warn)" }}>
                ⚠ {bankSizeWarningText(w, MAX_TEAMS)}
              </div>
            );
          })()}
          <PixelButton variant="primary" onClick={() => void save(bank)} disabled={busy || readOnly}>
            {saving ? "儲存中…" : uploads > 0 ? "圖片上傳中…" : "儲存全部變更"}
          </PixelButton>
          {lastSaved !== null && lastSaved === bank && <div data-testid="bank-saved" role="status" className="text-[15px]" style={{ color: "var(--ok)" }}>✓ 已儲存</div>}
        </>
      )}
    </main>
  );
}

/** Each room's monster, difficulty (which pool it draws from) and reward, and the boss and its reward per hit.
 * Monsters come from the catalog only, each with its own dish (docs/designs/monster-catalog.md §4). */
function RoomsEditor({
  bank,
  onRoom,
  onHitReward,
  onBossMonster,
  onRandomMonsters,
}: {
  bank: Bank;
  onRoom: (roomIndex: number, patch: Partial<Bank["rooms"][number]>) => void;
  onHitReward: (hitReward: number) => void;
  onBossMonster: (monster: string) => void;
  onRandomMonsters: (on: boolean) => void;
}) {
  const score = scoreName(true);
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <div data-testid="bank-rooms" className="flex flex-col gap-2">
        <h2 className="text-[18px]">房間（{bank.rooms.length} 間）</h2>
        <div className="text-[13px]">難度決定從哪個題庫抽題、答對拿幾點進度分；{score}決定冠軍。打倒怪物會端上牠的菜。同一隻怪物可以放在好幾房，再次登場時會換顏色、戴配件。</div>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" data-testid="bank-random-monsters" checked={!!bank.randomMonsters} onChange={(e) => onRandomMonsters(e.target.checked)} />
          每場隨機抽怪（每間房換一隻不重複的小怪、首領也隨機；下面選的怪物這時不用）
        </label>
        {bank.rooms.map((r, i) => (
          <div key={i} data-testid={`bank-room-${i}`} className="flex flex-wrap items-center gap-2 text-[15px]">
            <span className="w-[64px]">第 {i + 1} 房</span>
            <MonsterPicker testId={`bank-room-${i}-monster`} label={`第 ${i + 1} 房的怪物`} value={r.monster} boss={false} disabled={bank.randomMonsters} onChange={(monster) => onRoom(i, { monster })} />
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
              {score}
              <input type="number" min={0} step={1} className="px-input !w-[72px] !py-1" value={r.reward} onChange={(e) => onRoom(i, { reward: toReward(e.target.value) })} />
            </label>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="w-[64px]">首領</span>
          <MonsterPicker testId="bank-boss-monster" label="首領" value={bank.boss.monster} boss disabled={bank.randomMonsters} onChange={onBossMonster} />
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

/** A catalog monster picker: room monsters for a room, bosses for the boss, with the monster, its dish and the dish's name. */
function MonsterPicker({ testId, label, value, boss, onChange, disabled }: { testId: string; label: string; value: string; boss: boolean; onChange: (id: string) => void; disabled?: boolean }) {
  const m = monsterById(value);
  return (
    <span data-testid={testId} className={`flex min-w-0 flex-1 flex-wrap items-center gap-2${disabled ? " opacity-50" : ""}`}>
      <select aria-label={label} className="px-input !w-auto !py-1" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {MONSTERS.filter((x) => x.boss === boss).map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      {m && (
        <>
          <Sprite kind={m.sprite} hue={m.hue} scale={1} />
          <Sprite kind={DISH_SPRITE[m.sprite]} hue={m.hue} scale={1} />
          <span className="text-[13px]">🍲 {m.dish.name}</span>
        </>
      )}
    </span>
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
          <label className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
            名稱
            <input
              className="px-input !py-1"
              value={phase.name}
              maxLength={MAX_PHASE_NAME}
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
        <label className="flex items-center gap-1 whitespace-nowrap text-[15px]">
          規則
          <input
            className="px-input !py-1"
            value={phase.rule}
            maxLength={MAX_PHASE_RULE}
            placeholder={required ? "例如：聽前奏，說出這首是哪部作品的主題曲" : "（第 1 階段不顯示，可空白）"}
            aria-invalid={!!missing(phase.rule)}
            style={missing(phase.rule)}
            onChange={(e) => onChange({ rule: e.target.value })}
          />
        </label>
        {/* docs/designs/boss-buzzer.md: every team buzzes in, answers aloud, the host judges. Never phase 1: a buzzer phase
            deleted up into phase 1 keeps its box so the save error can be cleared. */}
        {(required || phase.buzzer) && (
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" data-testid={`bank-boss-phase-${index + 1}-buzzer`} checked={!!phase.buzzer} onChange={(e) => onChange({ buzzer: e.target.checked ? true : undefined })} />
            搶答階段：所有隊伍一起搶，搶到的隊伍口頭或打字作答（只能放填空題）
          </label>
        )}
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
  categories = false,
  difficulty = false,
}: {
  testId: string;
  title: string;
  note: string;
  questions: BankQuestion[];
  /** A 類別 field per question: a buzzer phase's winner picks the next song's (boss-music-buzzer.md M5). */
  categories?: boolean;
  /** A 難度 menu per question: a boss question's own (a pool question's is its pool). */
  difficulty?: boolean;
  onUpdate: (id: string, updater: (q: BankQuestion) => BankQuestion) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onUploadImage: (file: File) => Promise<string>;
}) {
  const hintId = useId();
  const difficultyHintId = useId();
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <div data-testid={testId} className="flex flex-col gap-2">
        <h2 className="text-[18px]">{title}</h2>
        <div className="text-[13px]">{note}</div>
        {/* A buzzer phase has no persuasion check, so there the difficulty only orders the questions. */}
        {difficulty && (
          <div id={difficultyHintId} className="text-[13px]">
            難度 1 最易、5 最難（沒改就是 5）：同一階段由易到難出題
            {categories ? "。" : (
              <>
                ，也決定說服檢定的 <span className="whitespace-nowrap">DC（8～16）</span>。
              </>
            )}
          </div>
        )}
        {/* Mirrors firstMeaningfulChar (lib/game-state.ts), shown by the mage and a passed check; a buzzer phase has neither. */}
        {!categories && (
          <div id={hintId} className="text-[13px]">
            法師和說服檢定成功時，大家會看到填空題答案的第一個字或數字（中文字、英文字母都算；跳過空白、標點和符號，負號也跳過；少於兩個時不給）。「約」「（皆可）」這類註記請放答案後面，別放開頭。
          </div>
        )}
        {questions.map((q) => (
          <QuestionRow
            key={q.id}
            question={q}
            onUpdate={(updater) => onUpdate(q.id, updater)}
            onDelete={() => onDelete(q.id)}
            onUploadImage={onUploadImage}
            category={categories}
            difficultyHintId={difficulty ? difficultyHintId : undefined}
            answerHintId={categories ? undefined : hintId}
          />
        ))}
        <PixelButton onClick={onAdd}>+ 新增題目</PixelButton>
      </div>
    </Panel>
  );
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
      // Keep the clip and 只放聲音: the fields below still show them, and the next paste saves them.
      onChange({ ...current, kind: "youtube", value: "" });
      return;
    }
    const id = extractYoutubeId(pasted);
    if (!id) {
      setError("看不出這是 YouTube 網址");
      onChange({ ...current, kind: "youtube", value: "" });
      return;
    }
    setError("");
    onChange({ ...current, kind: "youtube", value: id });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-black/60">{label}</span>
        <div className="flex gap-1">
          {/* Instagram only as an explanation: the host cannot play it (docs/designs/instagram-explanations.md). */}
          {(["text", "image", "youtube", ...(allowNone ? (["instagram", "none"] as const) : [])] as const).map((kind) => {
            const kindLabel = { text: "文字", image: "圖片", youtube: "YouTube", instagram: "Instagram", none: "無" }[kind];
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
      ) : current.kind === "instagram" ? (
        <InstagramFields label={label} value={current} onChange={onChange} />
      ) : (
        <>
          <input
            className="px-input"
            aria-label={`${label}的 YouTube 網址`}
            placeholder="貼上 YouTube 網址"
            value={youtubeInput}
            onChange={(e) => handleYoutubeInput(e.target.value)}
          />
          <ClipFields label={label} value={current} onChange={onChange} audioOnly={!allowNone} />
        </>
      )}
      {error && (
        <Panel role="alert" className="text-[13px]" style={{ background: "#ffd9d9" }}>
          {error}
        </Panel>
      )}
    </div>
  );
}

/** An Instagram explanation (docs/designs/instagram-explanations.md): the link, its optional length (the big screen
 * brings the music back that long after someone clicks the video), and the embed itself to check it plays. */
function InstagramFields({ label, value, onChange }: { label: string; value: MediaContent; onChange: (next: MediaContent) => void }) {
  const [link, setLink] = useState(value.value);
  const [lengthText, setLengthText] = useState(value.end === undefined ? "" : formatClipTime(value.end));
  const unreadable = !!link.trim() && !value.value;
  return (
    <div className="flex flex-col gap-1">
      <input
        className="px-input"
        aria-label={`${label}的 Instagram 網址`}
        placeholder="貼上 Instagram 貼文或 Reels 網址"
        value={link}
        onChange={(e) => {
          setLink(e.target.value);
          onChange({ ...value, value: extractInstagramShortcode(e.target.value) ?? "" });
        }}
      />
      <label className="flex flex-col text-[13px]">
        影片長度（選填）
        <input
          className="px-input"
          style={{ width: 90 }}
          aria-label={`${label}的影片長度`}
          placeholder="0:30"
          value={lengthText}
          onChange={(e) => {
            setLengthText(e.target.value);
            const seconds = e.target.value.trim() ? parseClipTime(e.target.value) : undefined;
            const next = { ...value };
            if (seconds === undefined) delete next.end;
            else next.end = seconds ?? NaN;
            onChange(next);
          }}
        />
      </label>
      <div className="text-[12px] text-black/60">大螢幕要有人點影片才會播。影片上方會顯示發文帳號：帳號名稱別洩答案。私人帳號、限制級、用了版權音樂的 Reels 可能放不出來，先在下面點播看看。</div>
      {unreadable && (
        <Panel role="alert" className="text-[13px]" style={{ background: "#ffd9d9" }}>
          看不出這是 Instagram 網址
        </Panel>
      )}
      {value.value && <InstagramPlayer key={value.value} shortcode={value.value} maxWidth={260} maxHeight={420} title={`${label}預覽`} />}
    </div>
  );
}

/** A YouTube slot's clip (docs/designs/youtube-questions.md D22): start and end typed as 1:05 or 65, 只放聲音 on a
 * question's own video (an explanation plays outside the host's controls), and 試聽片段 to hear it here. */
function ClipFields({ label, value, onChange, audioOnly }: { label: string; value: MediaContent; onChange: (next: MediaContent) => void; audioOnly: boolean }) {
  const [startText, setStartText] = useState(value.start === undefined ? "" : formatClipTime(value.start));
  const [endText, setEndText] = useState(value.end === undefined ? "" : formatClipTime(value.end));
  // The clip as it was when ▶ 試聽片段 was pressed: typing a time must not reload and replay the preview per key.
  const [preview, setPreview] = useState<{ seq: number; start?: number; end?: number } | null>(null);

  // From the stored values (NaN = unreadable), so a fix to one field can't hide the other's error.
  const bad = Number.isNaN(value.start) ? "start" : Number.isNaN(value.end) ? "end" : null;
  const setTime = (which: "start" | "end", text: string) => {
    (which === "start" ? setStartText : setEndText)(text);
    const seconds = text.trim() ? parseClipTime(text) : undefined;
    const next = { ...value };
    if (seconds === undefined) delete next[which];
    else next[which] = seconds ?? NaN;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-2">
        {audioOnly && (
          <label className="flex items-center gap-1 text-[13px]">
            <input
              type="checkbox"
              checked={!!value.audioOnly}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.checked) next.audioOnly = true;
                else delete next.audioOnly;
                onChange(next);
              }}
            />
            只放聲音（聽歌題）
          </label>
        )}
        <label className="flex flex-col text-[13px]">
          開始
          <input className="px-input" style={{ width: 90 }} aria-label={`${label}的開始時間`} placeholder="0:00" value={startText} onChange={(e) => setTime("start", e.target.value)} />
        </label>
        <label className="flex flex-col text-[13px]">
          結束
          <input className="px-input" style={{ width: 90 }} aria-label={`${label}的結束時間`} placeholder="（播到完）" value={endText} onChange={(e) => setTime("end", e.target.value)} />
        </label>
        <button type="button" className="px-btn !px-2 !py-1 text-[13px]" disabled={!value.value || bad !== null} onClick={() => setPreview((p) => ({ seq: (p?.seq ?? 0) + 1, start: value.start, end: value.end }))}>
          ▶ 試聽片段
        </button>
      </div>
      <div className="text-[12px] text-black/60">
        {bad ? `${bad === "start" ? "開始" : "結束"}時間看不懂：請打 1:05 或 65` : value.end !== undefined ? `片段 ${value.end - (value.start ?? 0)} 秒` : "可以打 1:05 或 65；結束留空就播到完"}
      </div>
      {preview && value.value && (
        // The picture shows here even for a music question, to check where the clip starts and stops.
        <YoutubePlayer videoId={value.value} start={preview.start} end={preview.end} command={{ state: "playing", seq: preview.seq }} width={320} height={180} controls title={`${label}試聽`} />
      )}
    </div>
  );
}

function QuestionRow({
  question: q,
  onUpdate,
  onDelete,
  onUploadImage,
  category = false,
  difficultyHintId,
  answerHintId,
}: {
  category?: boolean;
  /** Shows a 難度 menu (a boss question's own difficulty), described by the section's line with this id. */
  difficultyHintId?: string;
  /** The section's mage-hint note, read out with a fill-in answer box. */
  answerHintId?: string;
  question: BankQuestion;
  onUpdate: (updater: (q: BankQuestion) => BankQuestion) => void;
  onDelete: () => void;
  onUploadImage: (file: File) => Promise<string>;
}) {
  return (
    <div data-testid={`question-${q.id}`} className="flex flex-col gap-1 border-t border-black/10 pt-2 first:border-t-0 first:pt-0">
      <div className="flex gap-2">
        <div className="flex-1">
          <MediaPicker
            fieldId={`${q.id}-content`}
            label="題目"
            value={q.content}
            onChange={(c) =>
              onUpdate((cur) => {
                // A text question is its own line: the bank refuses a prompt on it.
                if (c!.kind !== "text") return { ...cur, content: c! };
                const next = { ...cur, content: c! };
                delete next.prompt;
                return next;
              })
            }
            onUploadImage={onUploadImage}
          />
          {q.content.kind !== "text" && (
            <input
              className="px-input mt-1"
              aria-label="題幹"
              placeholder="題幹（顯示在圖片或影片上方，例如：這首歌是什麼的主題曲？）"
              value={q.prompt ?? ""}
              onChange={(e) => {
                // Read the value now: React may run or rerun the updater later, after the input
                // was put back to its old value, and the prompt would be dropped (a CI flake).
                const prompt = e.target.value;
                onUpdate((cur) => {
                  const next = { ...cur };
                  if (prompt.trim()) next.prompt = prompt;
                  else delete next.prompt;
                  return next;
                });
              }}
            />
          )}
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
          onChange={(e) => {
            const kind = e.target.value as BankQuestion["kind"];
            onUpdate((cur) => blankQuestion(cur, kind));
          }}
        >
          <option value="text">填空</option>
          <option value="multipleChoice">選擇</option>
          <option value="sort">排序</option>
        </select>
      </div>

      {difficultyHintId && (
        <label className="flex items-center gap-1 whitespace-nowrap text-[15px]">
          難度
          <select
            className="px-input !py-1"
            // .px-input's width:100% beats a Tailwind width utility (see the 題型 select).
            style={{ width: "auto" }}
            aria-label="難度"
            aria-describedby={difficultyHintId}
            value={q.difficulty ?? DEFAULT_BOSS_DIFFICULTY}
            onChange={(e) => {
              const d = Number(e.target.value) as Difficulty;
              // The default is stored as no difficulty, so picking it back keeps the bank at its older format.
              onUpdate((cur) => {
                const next: BankQuestion = { ...cur, difficulty: d };
                if (d === DEFAULT_BOSS_DIFFICULTY) delete next.difficulty;
                return next;
              });
            }}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}

      {category && (
        <label className="flex items-center gap-1 whitespace-nowrap text-[15px]">
          類別
          <input
            className="px-input !py-1"
            aria-label="類別"
            placeholder="例如：動漫、遊戲音樂（答對的隊伍可選下一首的類別，可空白）"
            maxLength={MAX_CATEGORY}
            value={q.category ?? ""}
            onChange={(e) => {
              // Read now, as the 題幹 field does: the updater may run after the input is put back.
              const category = e.target.value;
              onUpdate((cur) => withCategory(cur, category));
            }}
          />
        </label>
      )}

      <MediaPicker
        fieldId={`${q.id}-explanation`}
        label="詳解"
        value={q.explanation}
        onChange={(c) => onUpdate((cur) => ({ ...cur, explanation: c }))}
        onUploadImage={onUploadImage}
        allowNone
      />

      {q.kind === "text" && q.fields ? (
        // A music question's answer fields (docs/designs/multi-field.md F3); `answer` is kept as theirs joined. Shown
        // even once the question is no longer a music one, so the save error that says so can be cleared (E3).
        <div className="flex flex-col gap-1" data-testid={`fields-${q.id}`}>
          <small className="text-[14px]">答案欄位（{MIN_FIELDS}–{MAX_FIELDS} 欄）：主持人一欄一欄判，答對幾欄打幾格血。</small>
          {q.fields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-[4em] shrink-0">欄位 {i + 1}</span>
              <input
                className="px-input"
                style={{ width: "8em" }}
                aria-label={`欄位 ${i + 1} 名稱`}
                placeholder="例如：歌名"
                maxLength={MAX_FIELD_LABEL}
                value={f.label}
                onChange={(e) => {
                  const label = e.target.value;
                  onUpdate((cur) => withField(cur, i, { label }));
                }}
              />
              <input
                className="px-input flex-1"
                aria-label={`欄位 ${i + 1} 答案`}
                value={f.answer}
                onChange={(e) => {
                  const answer = e.target.value;
                  onUpdate((cur) => withField(cur, i, { answer }));
                }}
              />
            </div>
          ))}
          <div className="flex gap-2">
            {q.fields.length < MAX_FIELDS && (
              <PixelButton onClick={() => onUpdate((cur) => (cur.kind === "text" && cur.fields ? { ...cur, fields: [...cur.fields, { label: "", answer: "" }] } : cur))}>+ 再加一欄</PixelButton>
            )}
            <PixelButton
              onClick={() =>
                onUpdate((cur) => {
                  if (cur.kind !== "text") return cur;
                  const { fields, ...rest } = cur;
                  return { ...rest, answer: fields?.[0]?.answer ?? cur.answer };
                })
              }
            >
              移除欄位（改回單一答案）
            </PixelButton>
            <PixelButton variant="flee" onClick={onDelete}>
              刪除
            </PixelButton>
          </div>
        </div>
      ) : q.kind === "text" ? (
        <div className="flex gap-2">
          <input
            className="px-input flex-1"
            aria-label="答案"
            aria-describedby={answerHintId}
            value={q.answer}
            onChange={(e) => {
              const answer = e.target.value;
              onUpdate((cur) => (cur.kind === "text" ? { ...cur, answer } : cur));
            }}
          />
          {/* Only a buzzer phase's music question may have fields (multi-field.md F3). */}
          {category && isMusicQuestion(q) && (
            <PixelButton
              onClick={() =>
                onUpdate((cur) =>
                  cur.kind === "text"
                    ? { ...cur, fields: [{ label: "", answer: cur.answer }, { label: "", answer: "" }] }
                    : cur,
                )
              }
            >
              + 加答案欄位
            </PixelButton>
          )}
          <PixelButton variant="flee" onClick={onDelete}>
            刪除
          </PixelButton>
        </div>
      ) : q.kind === "sort" ? (
        <div className="flex flex-col gap-1">
          <small className="text-[14px]">題目寫排序規則（例如：依年齡由大到小排），下面照正確順序填，遊戲裡會打亂。</small>
          {q.items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-[4.5em] shrink-0">第 {i + 1} 個</span>
              <input
                className="px-input flex-1"
                aria-label={`排序第 ${i + 1} 個`}
                value={item}
                onChange={(e) => {
                  // Read the value now, not in the deferred updater (the #147 flake).
                  const value = e.target.value;
                  onUpdate((cur) => (cur.kind === "sort" ? { ...cur, items: cur.items.map((o, j) => (j === i ? value : o)) } : cur));
                }}
              />
            </div>
          ))}
          <PixelButton variant="flee" onClick={onDelete}>
            刪除題目
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
                onChange={(e) => {
                  const value = e.target.value;
                  onUpdate((cur) =>
                    cur.kind === "multipleChoice" ? { ...cur, options: cur.options.map((o, j) => (j === i ? value : o)) } : cur,
                  );
                }}
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
