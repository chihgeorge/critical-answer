"use client";

// Owner-only question-bank editor. Linked from the homepage, but not from anywhere in the game's
// actual play flow — gated by the OWNER_KEY the Worker checks on every /api/bank request. Supports
// all three question kinds: text (free-answer), multipleChoice (options[] + correctIndex), and
// image (an uploaded picture + free-answer, see docs/designs/image-question-type.md) — all judged
// by the host reading the answer aloud.

import { useEffect, useState } from "react";
import { Panel, PixelButton } from "@/components/pixel";
import { MIN_OPTIONS, allQuestions, type Bank, type BankQuestion } from "@/lib/question-bank";
import { partyHttpBase } from "@/lib/party-host";

const OWNER_KEY_STORAGE = "bank-editor-owner-key";
const bankApiBase = () => `${partyHttpBase()}/api/bank`;
const bankImageApiBase = () => `${partyHttpBase()}/api/bank/image`;
// Sentinel for "no correct option marked yet" — happens right after switching a question to
// multipleChoice, or after deleting the option that was marked correct. Never a valid saved
// state: validate() below blocks 儲存全部變更 while any question is stuck at this value.
const UNSET_CORRECT_INDEX = -1;

/** Reads the owner key from localStorage — a per-browser convenience, not the source of truth (the
 * Worker checks it on every request; a wrong/missing key never gets past the fetch below). Starts
 * empty and reads localStorage only after mount: doing it in the initial render (e.g. useState's
 * lazy initializer) would make the client's first render disagree with the server-rendered HTML
 * (SSR has no localStorage) and trigger a React hydration mismatch. */
function useOwnerKey(onRestored: (key: string) => void) {
  const [key, setKey] = useState("");
  useEffect(() => {
    function readStoredKey() {
      try {
        const stored = localStorage.getItem(OWNER_KEY_STORAGE);
        if (stored) {
          setKey(stored);
          onRestored(stored);
        }
      } catch {
        // Private browsing / blocked storage: the key box just starts empty.
      }
    }
    readStoredKey();
    // Runs once on mount only — onRestored is the load() callback below, stable enough in practice
    // that re-running this on every render would only risk a duplicate auto-load, not a stale one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = (next: string) => {
    setKey(next);
    try {
      localStorage.setItem(OWNER_KEY_STORAGE, next);
    } catch {
      // Nothing to do — the key still works for this page load, just won't be remembered.
    }
  };
  return [key, save] as const;
}

type Location = { kind: "room"; roomIndex: number } | { kind: "boss" };

/** multipleChoice questions need a client-side pre-save check that text questions don't: a
 * freshly-added or just-edited option list can sit at UNSET_CORRECT_INDEX (no radio picked
 * yet) or under MIN_OPTIONS, states the type system itself can't rule out client-side. Text
 * questions have no such intermediate state — an empty answer is still a valid string, so
 * that check is left to the server's parseBank() round trip, same as before this feature. */
function validationError(bank: Bank): string | null {
  const all = allQuestions(bank);
  for (const q of all) {
    if (q.kind === "multipleChoice") {
      if (q.options.length < MIN_OPTIONS) return `題目「${q.text || q.id}」至少要有 ${MIN_OPTIONS} 個選項`;
      if (q.options.some((o) => !o.trim())) return `題目「${q.text || q.id}」有空白選項`;
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) return `題目「${q.text || q.id}」還沒標記正解`;
    }
    // Like MC's correctIndex, an empty imageKey is an intermediate client-only state (upload not
    // finished yet) the type system can't rule out — same reasoning as the comment above.
    if (q.kind === "image" && !q.imageKey) return `題目「${q.text || q.id}」還沒上傳圖片`;
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
      return withQuestions(prev, loc, [...questionsAt(prev, loc), { kind: "text", id, text: "", answer: "" }]);
    });
  };

  /** Uploads an image file to /api/bank/image and returns its R2 key, or throws with a message
   * suitable for display. Called from QuestionRow; kept here so it can use the same ownerKey the
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

/** A fresh question of the given kind, keeping only `id`/`text` — switching kind never carries
 * over the other kind's fields (no auto-conversion; the two kinds' content isn't comparable). */
function blankQuestion(q: BankQuestion, kind: BankQuestion["kind"]): BankQuestion {
  if (kind === "text") return { kind: "text", id: q.id, text: q.text, answer: "" };
  if (kind === "image") return { kind: "image", id: q.id, text: q.text, answer: "", imageKey: "" };
  return { kind: "multipleChoice", id: q.id, text: q.text, options: ["", ""], correctIndex: UNSET_CORRECT_INDEX };
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError("");
    try {
      const key = await onUploadImage(file);
      onUpdate((cur) => (cur.kind === "image" ? { ...cur, imageKey: key } : cur));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 border-t border-black/10 pt-2 first:border-t-0 first:pt-0">
      <div className="flex gap-2">
        <input
          className="px-input flex-1"
          aria-label="題目"
          value={q.text}
          onChange={(e) => onUpdate((cur) => ({ ...cur, text: e.target.value }))}
        />
        <select
          className="px-input"
          // .px-input sets width:100% as unlayered CSS (outside Tailwind's @layer), which always
          // beats a Tailwind width utility here — so the fix has to be an inline style, the one
          // thing with higher priority than any stylesheet rule. Without it this <select> claims
          // the whole flex row (flex-basis resolves from its own width:100%) and squeezes the
          // sibling 題目 input down to ~20px (bug found 2026-09-23: multipleChoice questions
          // looked like they had no editable question-text field at all).
          style={{ width: "auto" }}
          aria-label="題型"
          value={q.kind}
          onChange={(e) => onUpdate((cur) => blankQuestion(cur, e.target.value as BankQuestion["kind"]))}
        >
          <option value="text">問答</option>
          <option value="multipleChoice">選擇</option>
          <option value="image">圖片</option>
        </select>
      </div>

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
      ) : q.kind === "image" ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {/* Native file inputs can't be restyled directly — sr-only + a px-btn label is the
                standard pattern, so this matches the page's other pixel-styled controls instead
                of showing the browser's default control (design review finding). */}
            <input
              id={`image-upload-${q.id}`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="上傳圖片"
              disabled={uploading}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // lets re-selecting the same file re-trigger onChange
                if (file) void handleFile(file);
              }}
            />
            <label htmlFor={`image-upload-${q.id}`} className={`px-btn${uploading ? " pointer-events-none opacity-55" : ""}`}>
              選擇圖片
            </label>
            {uploading && <span className="text-[13px]">上傳中…</span>}
            {q.imageKey && !uploading && <span className="text-[13px]">已上傳（{q.imageKey.slice(0, 8)}…）</span>}
          </div>
          {uploadError && (
            // Tinted background, not colored text on cream — matches the top-level error Panel's
            // pattern (line ~217); plain --danger text here fails contrast (design review finding).
            <Panel role="alert" className="text-[13px]" style={{ background: "#ffd9d9" }}>
              {uploadError}
            </Panel>
          )}
          <div className="flex gap-2">
            <input
              className="px-input flex-1"
              aria-label="答案"
              value={q.answer}
              onChange={(e) => onUpdate((cur) => (cur.kind === "image" ? { ...cur, answer: e.target.value } : cur))}
            />
            <PixelButton variant="flee" onClick={onDelete}>
              刪除
            </PixelButton>
          </div>
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
