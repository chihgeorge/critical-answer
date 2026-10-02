"use client";

// Owner-only question-bank editor. Linked from the homepage, but not from anywhere in the game's
// actual play flow — gated by the OWNER_KEY the Worker checks on every /api/bank request. Supports
// two question kinds: text (free-answer) and multipleChoice (options[] + correctIndex), both
// judged by the host reading the answer aloud. Each kind's content — and its optional
// answer-reveal explanation — can independently be text, an uploaded image, or a YouTube video
// (see docs/designs/question-media-content.md's D1: content REPLACES the old fixed prompt text,
// it doesn't decorate it; the standalone `image` kind from image-question-type.md retired).

import { useEffect, useState } from "react";
import { Panel, PixelButton } from "@/components/pixel";
import { MIN_OPTIONS, allQuestions, type Bank, type BankQuestion, type MediaContent } from "@/lib/question-bank";
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

type Location = { kind: "room"; roomIndex: number } | { kind: "boss" };

/** A content or explanation slot that's still mid-upload (image kind, empty value) or otherwise
 * incomplete is an intermediate client-only state the type system can't rule out — the same
 * reasoning multipleChoice's correctIndex sentinel already needed. */
function contentError(label: string, c: MediaContent | undefined): string | null {
  if (!c) return null;
  if (!c.value.trim()) return `${label}還沒填完（${c.kind === "image" ? "還沒上傳圖片" : c.kind === "youtube" ? "還沒貼網址" : "是空的"}）`;
  return null;
}

function validationError(bank: Bank): string | null {
  const all = allQuestions(bank);
  for (const q of all) {
    const label = `題目「${q.content.value || q.id}」`;
    if (q.kind === "multipleChoice") {
      if (q.options.length < MIN_OPTIONS) return `${label}至少要有 ${MIN_OPTIONS} 個選項`;
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

  const load = async (key: string) => {
    if (!key) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(bankApiBase(), { headers: { Authorization: `Bearer ${key}` } });
      if (res.status === 403) {
        setError("Owner key rejected.");
        setBank(null);
        return;
      }
      if (!res.ok) {
        setError(`Load failed: ${res.status}`);
        return;
      }
      const versioned: { bank: Bank; version: number } = await res.json();
      setBank(versioned.bank);
      setVersion(versioned.version);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
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

  const questionsAt = (b: Bank, loc: Location): BankQuestion[] =>
    loc.kind === "boss" ? b.boss.questions : b.rooms[loc.roomIndex].questions;

  const withQuestions = (b: Bank, loc: Location, questions: BankQuestion[]): Bank =>
    loc.kind === "boss"
      ? { ...b, boss: { ...b.boss, questions } }
      : { ...b, rooms: b.rooms.map((r, i) => (i === loc.roomIndex ? { ...r, questions } : r)) };

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
      const id = `${loc.kind === "boss" ? "boss" : `r${loc.roomIndex}`}-${crypto.randomUUID().slice(0, 8)}`;
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
        <PixelButton onClick={() => void load(ownerKey)} disabled={!ownerKey || loading}>
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

      {bank && (
        <div className="flex flex-col gap-4">
          {bank.rooms.map((room, roomIndex) => (
            <RoomEditor
              key={roomIndex}
              testId={`bank-room-${roomIndex}`}
              title={`第 ${roomIndex + 1} 房 · ${room.monster.name}`}
              questions={room.questions}
              onUpdate={(id, updater) => updateQuestion({ kind: "room", roomIndex }, id, updater)}
              onDelete={(id) => deleteQuestion({ kind: "room", roomIndex }, id)}
              onAdd={() => addQuestion({ kind: "room", roomIndex })}
              onUploadImage={uploadImage}
            />
          ))}
          <RoomEditor
            testId="bank-room-boss"
            title={`首領 · ${bank.boss.monster.name}`}
            questions={bank.boss.questions}
            onUpdate={(id, updater) => updateQuestion({ kind: "boss" }, id, updater)}
            onDelete={(id) => deleteQuestion({ kind: "boss" }, id)}
            onAdd={() => addQuestion({ kind: "boss" })}
            onUploadImage={uploadImage}
          />
          <PixelButton variant="primary" onClick={() => void save(bank)} disabled={saving}>
            {saving ? "儲存中…" : "儲存全部變更"}
          </PixelButton>
        </div>
      )}
    </main>
  );
}

function RoomEditor({
  testId,
  title,
  questions,
  onUpdate,
  onDelete,
  onAdd,
  onUploadImage,
}: {
  testId: string;
  title: string;
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
          {(["text", "image", "youtube"] as const).map((kind) => {
            const kindLabel = kind === "text" ? "文字" : kind === "image" ? "圖片" : "YouTube";
            return (
              <button
                key={kind}
                type="button"
                className={`px-btn !px-2 !py-1 text-[12px] ${current.kind === kind ? "!bg-[var(--turn)]" : ""}`}
                aria-pressed={current.kind === kind}
                aria-label={`${label}：${kindLabel}`}
                disabled={uploading}
                onClick={() => switchTo(kind)}
              >
                {kindLabel}
              </button>
            );
          })}
          {allowNone && (
            <button
              type="button"
              className={`px-btn !px-2 !py-1 text-[12px] ${value === undefined ? "!bg-[var(--turn)]" : ""}`}
              aria-pressed={value === undefined}
              aria-label={`${label}：無`}
              disabled={uploading}
              onClick={() => switchTo("none")}
            >
              無
            </button>
          )}
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
          <option value="text">問答</option>
          <option value="multipleChoice">選擇</option>
        </select>
      </div>

      <MediaPicker
        fieldId={`${q.id}-explanation`}
        label="詳解"
        value={q.explanation}
        onChange={(c) => onUpdate((cur) => (c ? { ...cur, explanation: c } : { ...cur, explanation: undefined }))}
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
