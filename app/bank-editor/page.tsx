"use client";

// Owner-only question-bank editor. Not linked from anywhere in the game's normal flow — reached by
// its URL directly, gated by the OWNER_KEY the Worker checks on every /api/bank request. Text
// questions only this round (see docs/designs/question-bank-editor.md's NOT in scope section for
// why multipleChoice/image aren't here).

import { useEffect, useState } from "react";
import { Panel, PixelButton } from "@/components/pixel";
import type { Bank, BankQuestion } from "@/lib/question-bank";
import { partyHttpBase } from "@/lib/party-host";

const OWNER_KEY_STORAGE = "bank-editor-owner-key";
const bankApiBase = () => `${partyHttpBase()}/api/bank`;

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

  const editQuestion = (loc: Location, id: string, field: "text" | "answer", value: string) => {
    if (!bank) return;
    const questions = questionsAt(bank, loc).map((q) => (q.id === id ? { ...q, [field]: value } : q));
    setBank(withQuestions(bank, loc, questions));
  };

  const deleteQuestion = (loc: Location, id: string) => {
    if (!bank) return;
    setBank(withQuestions(bank, loc, questionsAt(bank, loc).filter((q) => q.id !== id)));
  };

  const addQuestion = (loc: Location) => {
    if (!bank) return;
    const id = `${loc.kind === "boss" ? "boss" : `r${loc.roomIndex}`}-${crypto.randomUUID().slice(0, 8)}`;
    setBank(withQuestions(bank, loc, [...questionsAt(bank, loc), { id, text: "", answer: "" }]));
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-[24px]">題庫編輯器</h1>

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
              onEdit={(id, field, value) => editQuestion({ kind: "room", roomIndex }, id, field, value)}
              onDelete={(id) => deleteQuestion({ kind: "room", roomIndex }, id)}
              onAdd={() => addQuestion({ kind: "room", roomIndex })}
            />
          ))}
          <RoomEditor
            testId="bank-room-boss"
            title={`首領 · ${bank.boss.monster.name}`}
            questions={bank.boss.questions}
            onEdit={(id, field, value) => editQuestion({ kind: "boss" }, id, field, value)}
            onDelete={(id) => deleteQuestion({ kind: "boss" }, id)}
            onAdd={() => addQuestion({ kind: "boss" })}
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
  onEdit,
  onDelete,
  onAdd,
}: {
  testId: string;
  title: string;
  questions: BankQuestion[];
  onEdit: (id: string, field: "text" | "answer", value: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <div data-testid={testId} className="flex flex-col gap-2">
        <h2 className="text-[18px]">{title}</h2>
        {questions.map((q) => (
          <div key={q.id} className="flex flex-col gap-1 border-t border-black/10 pt-2 first:border-t-0 first:pt-0">
            <input
              className="px-input"
              aria-label="題目"
              value={q.text}
              onChange={(e) => onEdit(q.id, "text", e.target.value)}
            />
            <div className="flex gap-2">
              <input
                className="px-input flex-1"
                aria-label="答案"
                value={q.answer}
                onChange={(e) => onEdit(q.id, "answer", e.target.value)}
              />
              <PixelButton variant="flee" onClick={() => onDelete(q.id)}>
                刪除
              </PixelButton>
            </div>
          </div>
        ))}
        <PixelButton onClick={onAdd}>+ 新增題目</PixelButton>
      </div>
    </Panel>
  );
}
