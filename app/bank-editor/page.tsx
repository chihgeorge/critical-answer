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
import { UNSET_CORRECT_INDEX, blankQuestion, canBeMemory, lostOnKindChange, timingFieldError, withCategory, withContent, withField, withMemory } from "@/lib/bank-editor-question";
import { SEARCH_LIMIT, allGroups, copyQuestion, groupName, moveQuestion, moveRefusal, newQuestionId, questionSummary, questionsAt, removeQuestion, restoreToSaved, sameGroup, searchBank, shiftQuestion, tabOf, withQuestions, type Location, type Removed } from "@/lib/bank-editor-list";
import { formatSongTime } from "@/lib/tap-clock";
import { BANK_LOAD_TIMEOUT_MS, IMAGE_UPLOAD_TIMEOUT_MS, MEDIA_UPLOAD_TIMEOUT_MS, editorBusy } from "@/lib/bank-editor-locks";
import { MAX_IMAGE_BYTES, MAX_MEDIA_BYTES } from "@/lib/bank-image-api";
import { DIFFICULTIES, MAX_MEMORY_SECONDS, MIN_MEMORY_SECONDS, MAX_BOSS_HP, MAX_CATEGORY, MAX_FIELD_LABEL, MAX_FIELDS, MAX_OPTIONS, MAX_PHASE_NAME, MAX_PHASE_RULE, MAX_TAP_LABEL, MIN_FIELDS, MIN_OPTIONS, bossQuestions, isMusicQuestion, textQuestionGaps, type Bank, type BankQuestion, type BossPhase, type MediaContent } from "@/lib/question-bank";
import { MONSTERS, monsterById } from "@/lib/monster-catalog";
import { DISH_SPRITE } from "@/lib/sprite-kind";
import { DEFAULT_BANK_ENTRY, MAX_TEAMS, scoreName } from "@/lib/protocol";
import { bankSize, bankSizeWarning, bankSizeWarningText } from "@/lib/bank-size";
import { DEFAULT_BOSS_DIFFICULTY, type Difficulty } from "@/lib/game-state";
import { partyHttpBase } from "@/lib/party-host";
import { extractYoutubeId, formatClipTime, parseClipTime, youtubeWatchUrl } from "@/lib/youtube";
import { pageOf, questionPage } from "@/lib/bank-editor-pages";
import { YoutubePlayer } from "@/components/youtube-player";
import { InstagramPlayer } from "@/components/instagram-player";
import { extractInstagramShortcode } from "@/lib/instagram";
import { forgetStored, readStored, writeStored } from "@/lib/stored";
import { BANK_GONE, bankProblems, serverProblem, type BankProblem, type EditorTab } from "@/lib/bank-editor-problems";
import { draftKey, draftToOffer, encodeDraft, type BankDraft } from "@/lib/bank-editor-draft";

const OWNER_KEY_STORAGE = "bank-editor-owner-key";
const bankApiBase = () => `${partyHttpBase()}/api/bank`;
const bankImageApiBase = () => `${bankApiBase()}/image`;
/** One bank's load/save URL: the default bank keeps the plain URL every Worker understands (multi-bank.md). */
const bankUrl = (id: string) => (id === DEFAULT_BANK_ENTRY.id ? bankApiBase() : `${bankApiBase()}?id=${encodeURIComponent(id)}`);
const banksApiBase = () => `${partyHttpBase()}/api/banks`;
type BankEntry = { id: string; name: string };
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

/** One place a question may move to, as its ⋯ menu lists it. */
type MoveTarget = { loc: Location; name: string; count: number; current: boolean; refusal: string | null };
/** What a group's rows may do besides editing themselves: open and close, and the ⋯ menu (editor-ux #2, #3). */
type ListActions = {
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
  onShift: (id: string, delta: -1 | 1) => void;
  onCopy: (id: string) => void;
  onMove: (id: string, to: Location) => void;
  targets: (q: BankQuestion) => MoveTarget[];
};
const OPEN_ALL_STORAGE = "bank-editor-open-all";
/** Which page of the editor is open. */
type Tab = EditorTab;
/** A request to show a question (or a tab's top): each new `seq` is one jump. */
type Jump = { id?: string; phase?: number; tab: Tab; seq: number };
const UNREACHABLE = "連不到伺服器，請檢查網路再試一次。";
const KEY_REJECTED = "站長金鑰不對。";

/** Rooms that draw from pool `d`, as "第 2、3 房" (empty when none does). */
function roomsUsing(bank: Bank, d: Difficulty): string {
  const rooms = bank.rooms.flatMap((r, i) => (r.difficulty === d ? [i + 1] : []));
  return rooms.length ? `第 ${rooms.join("、")} 房` : "";
}

/** A reward box's text as a whole, non-negative number (an empty box is 0). */
const toReward = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

export default function BankEditorPage() {
  const [bank, setBank] = useState<Bank | null>(null);
  // The bank as last loaded or saved: every edit makes a new object, so `bank !== saved` means unsaved edits.
  const [saved, setSaved] = useState<Bank | null>(null);
  // The version this editor last loaded/saved. Sent back on every PUT so a save that's stale
  // (someone else — another tab, another device — saved first) is rejected with a clear conflict
  // instead of silently overwriting their edits (adversarial review, 2026-09-22).
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Image uploads in flight: they lock the editor like a load or save (editorBusy). */
  const [uploads, setUploads] = useState(0);
  /** A create, rename or delete of a bank in flight: it locks the editor like a save. */
  const [managing, setManaging] = useState(false);
  const busy = editorBusy({ loading, saving: saving || managing, uploads });
  /** The bank shown and saved (multi-bank.md): set only by a load that landed, so a save always goes to the bank it
   * loaded, with that bank's own version. */
  const [bankId, setBankId] = useState<string>(DEFAULT_BANK_ENTRY.id);
  const [banks, setBanks] = useState<BankEntry[]>([DEFAULT_BANK_ENTRY]);
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
  /** A save the editor's own check refused: from then on its problems follow the edits, so a fixed one goes away. */
  const [checked, setChecked] = useState(false);
  /** A save the server refused (its 4xx text, in Chinese, placed on a question when it names one), with the bank it
   * refused: once that bank is edited the refusal may no longer apply, so it is no longer shown. */
  const [serverIssue, setServerIssue] = useState<{ problem: BankProblem; bank: Bank } | null>(null);
  /** Which of the problems the save bar shows. */
  const [cursor, setCursor] = useState(0);
  const [jump, setJump] = useState<Jump | null>(null);
  /** A draft from this browser that differs from the bank just loaded, until 還原草稿 or 捨棄. */
  const [draftOffer, setDraftOffer] = useState<{ draft: BankDraft; stale: boolean } | null>(null);
  /** Every question open, remembered in this browser (read when a bank loads, never in render: SSR has no localStorage). */
  const [openAll, setOpenAll] = useState(false);
  /** The questions toggled away from that setting: open ones in the summary list, closed ones under 全部展開 (editor-ux #2). */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (id: string) => openAll !== toggled.has(id);
  /** Opens a question whichever way the list is set. */
  const ensureOpen = (id: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (openAll) next.delete(id);
      else next.add(id);
      return next;
    });
  const [query, setQuery] = useState("");
  /** The last delete, move or copy, said in the save bar; a delete carries what 復原 puts back. */
  const [toast, setToast] = useState<{ message: string; undo?: Removed } | null>(null);
  /** A question whose summary row takes focus after the row before it went away (a new object each time, so the same
   * id twice still moves focus). */
  const [focusTo, setFocusTo] = useState<{ id: string } | null>(null);
  /** Bumped when a load or 還原草稿 replaces the whole bank: the rows remount, so a box that keeps its own typed text (a
   * clip's times, a YouTube link) shows the new bank, not the one before it with the same question ids. */
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (focusTo) document.querySelector<HTMLElement>(`[data-summary="${CSS.escape(focusTo.id)}"]`)?.focus();
  }, [focusTo]);

  /** True when this load's bank is the one shown now. */
  const load = async (key: string, id = bankId): Promise<boolean> => {
    if (!key) return false;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const headers = { Authorization: `Bearer ${key}` };
      const [res, listRes] = await Promise.all([
        fetch(bankUrl(id), { headers, signal: AbortSignal.timeout(BANK_LOAD_TIMEOUT_MS) }),
        // A Worker from before multi-bank has no list: the default bank alone, as before.
        fetch(banksApiBase(), { headers, signal: AbortSignal.timeout(BANK_LOAD_TIMEOUT_MS) }).catch(() => null),
      ]);
      if (seq !== loadSeq.current) return false;
      if (listRes?.ok) {
        const list: unknown = await listRes.json();
        if (seq !== loadSeq.current) return false;
        if (Array.isArray(list)) setBanks(list as BankEntry[]);
      }
      if (res.status === 404 && id !== DEFAULT_BANK_ENTRY.id) {
        setLoading(false);
        if (await load(key, DEFAULT_BANK_ENTRY.id)) setError("那份題庫已經被刪掉了，改載入預設題庫。");
        return false;
      }
      if (res.status === 403) {
        setError(KEY_REJECTED);
        setBank(null);
        setSaved(null);
        setDraftOffer(null);
        return false;
      }
      if (!res.ok) {
        setError(`載入失敗（錯誤 ${res.status}），請再試一次。`);
        return false;
      }
      const versioned: { bank: Bank; version: number; unreadable?: true; outdated?: number } = await res.json();
      if (seq !== loadSeq.current) return false;
      const stale = [...versioned.bank.rooms.map((r) => r.monster), versioned.bank.boss.monster].some((m) => typeof m !== "string");
      setBank(versioned.bank);
      setSaved(versioned.bank);
      setGeneration((g) => g + 1);
      setJump(null); // the remounted pagers must not reopen a spent jump's page
      setVersion(versioned.version);
      setBankId(id);
      setLastSaved(null);
      setReadOnly(!!versioned.unreadable || stale);
      setStaleServer(stale);
      setOutdated(versioned.outdated ?? null);
      setChecked(false);
      setServerIssue(null);
      setToggled(new Set());
      setOpenAll(readStored(OPEN_ALL_STORAGE) === "1");
      setToast(null);
      // A shown fallback bank (unreadable, or a server mid-deploy) is not the stored one: no draft is offered over it.
      setDraftOffer(versioned.unreadable || stale ? null : draftToOffer(readStored(draftKey(id)), versioned.bank, versioned.version));
      return true;
    } catch {
      if (seq === loadSeq.current) setError(UNREACHABLE);
      return false;
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  // Reload, tab close or the back button would drop unsaved edits too, so the browser asks first.
  useEffect(() => {
    if (bank === saved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [bank, saved]);

  // Every unsaved edit is also kept in this browser (lib/bank-editor-draft.ts), but not while an older draft waits
  // for 還原草稿 or 捨棄: the first keystroke must not overwrite it.
  useEffect(() => {
    if (!bank || bank === saved || version === null || readOnly || draftOffer) return;
    writeStored(draftKey(bankId), encodeDraft({ version, savedAt: Date.now(), bank }));
  }, [bank, saved, version, readOnly, draftOffer, bankId]);

  // A jump lands after the render that opened its tab and page: then the question is in the page to scroll to.
  useEffect(() => {
    if (!jump) return;
    const testId = jump.id ? `question-${CSS.escape(jump.id)}` : jump.phase !== undefined ? `bank-boss-phase-${jump.phase + 1}` : jump.tab === "rooms" ? "bank-rooms" : jump.tab === "boss" ? "bank-room-boss" : `bank-pool-${jump.tab}`;
    const target = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    // The sticky save bar covers the bottom of the screen: scrolling centres in the part above it.
    document.documentElement.style.scrollPaddingBottom = `${document.querySelector<HTMLElement>('[data-testid="bank-save-bar"]')?.offsetHeight ?? 0}px`;
    // A question with a problem can be taller than the screen: its first blank box (the usual problem) is what to see.
    const blank = target?.getAttribute("aria-invalid") ? [...target.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text], input[type=url]")].find((el) => !el.value.trim() && el.offsetParent) : undefined;
    (blank ?? target)?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [jump]);

  useEffect(() => () => void (document.documentElement.style.scrollPaddingBottom = ""), []);

  const [ownerKey, setOwnerKey] = useOwnerKey((restoredKey) => void load(restoredKey));

  /** Loading another bank replaces the one shown, so unsaved edits would go without a word. */
  const discardOk = () => bank === saved || window.confirm("還沒儲存的修改會不見，確定要換？");

  /** A create, rename or delete (/api/banks), then `then` with its answer. The editor stays locked meanwhile. */
  const manage = async (method: string, query: string, body: object | undefined, then: (res: Response) => Promise<void>) => {
    setManaging(true);
    setError("");
    try {
      const res = await fetch(`${banksApiBase()}${query}`, {
        method,
        headers: { Authorization: `Bearer ${ownerKey}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) return setError(res.status === 403 ? KEY_REJECTED : await res.text());
      setManaging(false);
      await then(res);
    } catch {
      setError(UNREACHABLE);
    } finally {
      setManaging(false);
    }
  };

  const createBank = (copy: boolean) => {
    if (!discardOk()) return;
    const name = window.prompt(copy ? "新題庫的名稱（內容複製預設題庫）" : "新題庫的名稱（從一題範例開始）");
    if (!name?.trim()) return;
    void manage("POST", "", { name, ...(copy ? { copyFrom: DEFAULT_BANK_ENTRY.id } : {}) }, async (res) => {
      const made: BankEntry = await res.json();
      await load(ownerKey, made.id);
    });
  };

  /** The bank shown was deleted elsewhere: its edits go into a new bank (version 1), and its draft stays until they do. */
  const saveAsNew = () => {
    const name = window.prompt("新題庫的名稱（存進畫面上的題目）");
    if (!name?.trim() || !bank) return;
    void manage("POST", "", { name }, async (res) => {
      const made: BankEntry = await res.json();
      setBanks((list) => [...list, made]);
      await save(bank, { id: made.id, version: 1 });
    });
  };

  const renameBank = () => {
    const current = banks.find((b) => b.id === bankId);
    const name = window.prompt("題庫的新名稱", current?.name ?? "");
    if (!name?.trim() || name.trim() === current?.name) return;
    void manage("PATCH", `?id=${encodeURIComponent(bankId)}`, { name }, async (res) => {
      const renamed: BankEntry = await res.json();
      setBanks((list) => list.map((b) => (b.id === renamed.id ? renamed : b)));
    });
  };

  const deleteBank = () => {
    const name = banks.find((b) => b.id === bankId)?.name ?? "";
    if (!window.confirm(`確定刪除「${name}」？刪了不能復原。`)) return;
    void manage("DELETE", `?id=${encodeURIComponent(bankId)}`, undefined, async () => {
      setSaved(bank); // gone with the bank: nothing left to warn about
      forgetStored(draftKey(bankId));
      await load(ownerKey, DEFAULT_BANK_ENTRY.id);
    });
  };

  /** Every finished game's record as a JSON file (lib/game-log.ts): for tuning boss HP and the entry score. */
  const downloadGameLogs = async () => {
    setError("");
    try {
      const res = await fetch(`${partyHttpBase()}/api/game-logs`, { headers: { Authorization: `Bearer ${ownerKey}` } });
      if (!res.ok) {
        setError(res.status === 403 ? KEY_REJECTED : `下載失敗（錯誤 ${res.status}），請再試一次。`);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `game-logs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); // revoking at once makes some browsers drop the download
    } catch {
      setError(UNREACHABLE);
    }
  };

  /** Saves into `to` (the bank shown, unless 另存成新題庫 made a new one); a save that lands makes `to` the bank shown. */
  const save = async (next: Bank, to = { id: bankId, version }) => {
    if (to.version === null) return; // no successful load yet — nothing to compare against
    setLastSaved(null); // a save that fails must not leave the last one's 已儲存 up
    setServerIssue(null);
    setError("");
    const found = bankProblems(next);
    if (found.length > 0) {
      setChecked(true);
      setCursor(0);
      goTo(found[0]);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(bankUrl(to.id), {
        method: "PUT",
        headers: { Authorization: `Bearer ${ownerKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bank: next, version: to.version }),
      });
      if (res.status === 409) {
        setError("題庫在你載入後被別人存過了：先按「載入題庫」拿最新版，再改一次存檔。");
        return;
      }
      if (!res.ok) {
        const issue = serverProblem(next, res.status, await res.text());
        setServerIssue({ problem: issue, bank: next });
        setCursor(0);
        goTo(issue);
        return;
      }
      const versioned: { bank: Bank; version: number } = await res.json();
      setBank(versioned.bank);
      setSaved(versioned.bank);
      setLastSaved(versioned.bank);
      setVersion(versioned.version);
      setBankId(to.id);
      setOutdated(null);
      setChecked(false);
      setDraftOffer(null);
      setToast(null);
      forgetStored(draftKey(bankId)); // the shown bank's draft, also when it was deleted and the edits went to a new one
    } catch {
      setError(UNREACHABLE);
    } finally {
      setSaving(false);
    }
  };

  const [tab, setTab] = useState<Tab>(1);

  /** Opens the problem's tab and the page holding its question, then scrolls it into view (the effect above). */
  const goTo = (p: BankProblem | undefined) => {
    const t = p?.tab;
    if (t === undefined) return;
    setTab(t);
    const id = p?.questionId;
    if (id) ensureOpen(id);
    setJump((j) => ({ id, phase: p?.phase, tab: t, seq: (j?.seq ?? 0) + 1 }));
  };

  // After a refused save the problems follow the edits; once none is left, a new blank question is not an error yet.
  const live = bank && checked ? bankProblems(bank) : [];
  if (checked && bank && live.length === 0) setChecked(false);
  const problems = live.length > 0 ? live : serverIssue && serverIssue.bank === bank ? [serverIssue.problem] : [];
  const shownAt = Math.min(cursor, problems.length - 1);
  const shown = problems[shownAt];
  const problemOf = new Map(problems.flatMap((p) => (p.questionId ? [[p.questionId, p.message] as const] : [])));
  const dirty = bank !== saved;
  /** Tabs with edits since the last load or save (each edit replaces only what it touched). */
  const tabDirty = (t: Tab) =>
    !!bank && !!saved && (t === "rooms" ? bank.rooms !== saved.rooms || bank.randomMonsters !== saved.randomMonsters || bank.boss.monster !== saved.boss.monster || bank.boss.hitReward !== saved.boss.hitReward : t === "boss" ? bank.boss.phases !== saved.boss.phases : bank.pools[t] !== saved.pools[t]);

  const withPhase = (b: Bank, phase: number, patch: Partial<BossPhase>): Bank => ({
    ...b,
    boss: { ...b.boss, phases: b.boss.phases.map((p, i) => (i === phase ? { ...p, ...patch } : p)) },
  });
  const updatePhase = (phase: number, patch: Partial<BossPhase>) => {
    // A deleted question may no longer fit a phase that just became (or stopped being) a buzzer phase.
    if ("buzzer" in patch) setToast((t) => (t?.undo ? null : t));
    setBank((prev) => (prev ? withPhase(prev, phase, patch) : prev));
  };
  // A phase count change remounts every pager (keyed by it): a spent jump must not reopen its old page then.
  // Phases have no ids: once their count changes, a 復原 could land in the wrong one, so it goes.
  const addPhase = () => {
    setJump(null);
    setToast(null);
    setBank((prev) => (prev ? { ...prev, boss: { ...prev.boss, phases: [...prev.boss.phases, { name: "", rule: "", maxHp: 3, questions: [] }] } } : prev));
  };
  const deletePhase = (phase: number) => {
    const count = bank?.boss.phases[phase]?.questions.length ?? 0;
    // A phase can hold a whole set of prepared questions: one stray tap must not drop them all (D11).
    if (count > 0 && !window.confirm(`刪除第 ${phase + 1} 階段和它的 ${count} 題？`)) return;
    setJump(null);
    setToast(null);
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
    setToast((t) => (t?.undo ? t : null)); // a move or copy note is stale once editing goes on; an undo stays
    setBank((prev) => {
      if (!prev) return prev;
      const questions = questionsAt(prev, loc).map((q) => (q.id === id ? updater(q) : q));
      return withQuestions(prev, loc, questions);
    });
  };

  /** After a row leaves its group, focus goes to the row now in its place (or the one before). */
  const focusNeighbor = (loc: Location, id: string) => {
    const list = bank ? questionsAt(bank, loc) : [];
    const i = list.findIndex((q) => q.id === id);
    const next = list[i + 1]?.id ?? list[i - 1]?.id;
    setFocusTo(next ? { id: next } : null);
  };

  // The toast and focus read the bank shown now; the edit itself still goes through setBank(prev => ...).
  const deleteQuestion = (loc: Location, id: string) => {
    const r = bank && removeQuestion(bank, loc, id);
    if (!r) return;
    focusNeighbor(loc, id);
    setBank((prev) => (prev ? (removeQuestion(prev, loc, id)?.bank ?? prev) : prev));
    setToast({ message: `已刪除${groupName(loc)} 第 ${r.removed.index + 1} 題`, undo: r.removed });
  };

  const undoDelete = (r: Removed) => {
    // Back to the saved bank: no draft is kept of it (the draft effect skips a bank that equals saved). An older draft
    // still waiting for 還原草稿 or 捨棄 stays.
    if (bank && !draftOffer && restoreToSaved(bank, r, saved) === saved) forgetStored(draftKey(bankId));
    setBank((prev) => (prev ? restoreToSaved(prev, r, saved) : prev));
    setToast(null);
    goTo({ message: "", tab: tabOf(r.loc), questionId: r.question.id });
  };

  const moveTo = (from: Location, id: string, to: Location) => {
    if (!bank) return;
    focusNeighbor(from, id);
    setBank((prev) => (prev ? moveQuestion(prev, from, id, to) : prev));
    setToast({ message: `已移到${groupName(to)}（第 ${questionsAt(bank, to).length + 1} 題）` });
  };

  /** 上移／下移: the row's page follows it (a jump), so it stays in view across a page edge. */
  const shift = (loc: Location, id: string, delta: -1 | 1) => {
    setBank((prev) => (prev ? shiftQuestion(prev, loc, id, delta) : prev));
    setJump((j) => ({ id, tab: tabOf(loc), seq: (j?.seq ?? 0) + 1 })); // not goTo: a closed row stays closed
  };

  const copy = (loc: Location, id: string) => {
    if (!bank) return;
    const newId = newQuestionId(bank, loc);
    setBank((prev) => (prev ? copyQuestion(prev, loc, id, newId) : prev));
    setToast({ message: `已複製成第 ${questionsAt(bank, loc).findIndex((q) => q.id === id) + 2} 題` });
    goTo({ message: "", tab: tabOf(loc), questionId: newId });
  };

  const moveTargets = (from: Location, q: BankQuestion): MoveTarget[] =>
    bank ? allGroups(bank).map((loc) => ({ loc, name: groupName(loc), count: questionsAt(bank, loc).length, current: sameGroup(loc, from), refusal: moveRefusal(bank, q, loc) })) : [];

  const addQuestion = (loc: Location) => {
    if (!bank) return;
    const id = newQuestionId(bank, loc);
    ensureOpen(id);
    setBank((prev) => (prev ? withQuestions(prev, loc, [...questionsAt(prev, loc), { kind: "text", id, content: TEXT_CONTENT, answer: "" }]) : prev));
  };

  const toggleOpen = (id: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const listActions = (loc: Location): ListActions => ({
    isOpen,
    onToggle: toggleOpen,
    onShift: (id, delta) => shift(loc, id, delta),
    onCopy: (id) => copy(loc, id),
    onMove: (id, to) => moveTo(loc, id, to),
    targets: (q) => moveTargets(loc, q),
  });

  /** Uploads an image, video or audio file to /api/bank/image and returns its R2 key and the type the server found,
   * or throws with a message suitable for display. XHR, not fetch: fetch reports no upload progress. Called from
   * MediaPicker; kept here so it can use the same ownerKey the rest of the page already has. */
  const uploadImage: UploadFn = (file, onProgress, signal) => {
    // The count drops just before MediaPicker's onChange writes the key: both land in the same render, before any click.
    setUploads((n) => n + 1);
    return new Promise<Uploaded>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", bankImageApiBase());
      xhr.setRequestHeader("Authorization", `Bearer ${ownerKey}`);
      if (file.type) xhr.setRequestHeader("Content-Type", file.type);
      xhr.timeout = file.type.startsWith("image/") ? IMAGE_UPLOAD_TIMEOUT_MS : MEDIA_UPLOAD_TIMEOUT_MS;
      xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(xhr.responseText || `上傳失敗（${xhr.status}）`));
        try {
          resolve(JSON.parse(xhr.responseText) as Uploaded);
        } catch {
          reject(new Error("上傳失敗，請再試一次"));
        }
      };
      xhr.onerror = () => reject(new Error("上傳失敗，請檢查網路再試一次"));
      xhr.ontimeout = () => reject(new Error("上傳逾時，請再試一次"));
      xhr.onabort = () => reject(new Error("已取消上傳"));
      signal.addEventListener("abort", () => xhr.abort());
      xhr.send(file);
    }).finally(() => setUploads((n) => n - 1));
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
            if (bank !== saved && !window.confirm("還沒儲存的修改會不見，確定回首頁？")) e.preventDefault();
          }}
          className="text-[15px] text-white underline underline-offset-2"
          style={{ textShadow: "1px 1px 0 var(--k)" }}
        >
          ← 回首頁
        </Link>
      </div>

      {/* Once a bank is shown the key panel shrinks to one wrapping row (two lines on a phone): it stays editable
          because a reload auto-loads the remembered key and the key may still be changed right after. */}
      <Panel className={bank ? "flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2" : "flex flex-col gap-2 p-4"}>
        <label className="whitespace-nowrap text-[14px]" htmlFor="owner-key">
          站長金鑰
        </label>
        <input
          id="owner-key"
          type="password"
          className="px-input"
          style={bank ? { width: "auto", flex: "1 1 8em", minWidth: 0 } : undefined}
          value={ownerKey}
          onChange={(e) => setOwnerKey(e.target.value)}
        />
        <PixelButton
          className={bank ? "!m-0 !px-3 !py-1 text-[14px]" : undefined}
          onClick={() => {
            // Loading replaces the bank shown here, so unsaved edits would go without a word.
            if (bank !== saved && !window.confirm("還沒儲存的修改會不見，確定重新載入？")) return;
            void load(ownerKey);
          }}
          disabled={!ownerKey || busy}
        >
          {loading ? "載入中…" : uploads > 0 ? "上傳中…" : "載入題庫"}
        </PixelButton>
        <button
          type="button"
          className="self-start text-[14px] underline underline-offset-2 disabled:opacity-55"
          onClick={() => void downloadGameLogs()}
          disabled={!ownerKey}
        >
          ⬇ 下載對局紀錄（JSON）
        </button>
        {error && !bank && (
          // Panel doesn't forward arbitrary props (no data-testid passthrough), so the test id sits
          // on this inner span; role="alert" on the Panel itself is the real screen-reader semantics.
          // Red background matches every other error surface in the app (host/page.tsx's connection
          // error) — "turn" is reserved for whose-turn-it-is, not errors.
          <Panel role="alert" className="text-[14px]" style={{ background: "#ffd9d9" }}>
            <span data-testid="bank-editor-error">{error}</span>
          </Panel>
        )}
      </Panel>

      {bank && version !== null && (
        <Panel className="flex flex-col gap-2 p-4">
          <label className="flex items-center gap-2 text-[14px]">
            題庫
            <select
              data-testid="bank-editor-bank"
              className="px-input min-w-0 flex-1"
              value={bankId}
              disabled={busy}
              onChange={(e) => {
                if (discardOk()) void load(ownerKey, e.target.value);
              }}
            >
              {/* The bank being edited stays listed even when the list is missing it (an older Worker, deleted in another tab). */}
              {(banks.some((b) => b.id === bankId) ? banks : [...banks, { id: bankId, name: "（目前編輯的題庫）" }]).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 text-[14px]">
            <PixelButton className="!m-0 !px-3 !py-1 text-[14px]" disabled={busy} onClick={() => createBank(false)}>
              ＋ 空白題庫
            </PixelButton>
            <PixelButton className="!m-0 !px-3 !py-1 text-[14px]" disabled={busy} onClick={() => createBank(true)}>
              ＋ 複製預設題庫
            </PixelButton>
            {bankId !== DEFAULT_BANK_ENTRY.id && (
              <>
                <PixelButton className="!m-0 !px-3 !py-1 text-[14px]" disabled={busy} onClick={renameBank}>
                  改名
                </PixelButton>
                <PixelButton className="!m-0 !px-3 !py-1 text-[14px]" disabled={busy} onClick={deleteBank}>
                  刪除
                </PixelButton>
              </>
            )}
          </div>
          <p className="text-[13px]">主持人在開房大廳選題庫；自訂題庫要先輸入站長金鑰才選得到。</p>
        </Panel>
      )}

      {bank && draftOffer && (
        <Panel role="status" className="flex flex-col gap-2 p-4 text-[15px]" style={{ background: "var(--warn)", color: "var(--ink)" }}>
          <span data-testid="bank-draft">
            這台裝置上有一份還沒儲存的草稿（最後修改 {new Date(draftOffer.draft.savedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}），要接著改嗎？
            {draftOffer.stale && <strong> 草稿之後，題庫又在別的地方存過：還原後再存，會蓋掉那次存的內容。</strong>}
            {" "}草稿裡新上傳的圖片和影音要盡快存檔，放太久會被清掉。
          </span>
          <div className="flex flex-wrap gap-2">
            <PixelButton className="!m-0 !px-3 !py-1 text-[15px]" disabled={busy} onClick={() => {
                if (bank !== saved && !window.confirm("還原草稿會換掉剛才的修改，確定？")) return;
                setBank(draftOffer.draft.bank);
                setGeneration((g) => g + 1);
                setJump(null);
                setDraftOffer(null);
                setToast(null);
              }}>
              {draftOffer.stale ? "還原草稿（蓋掉較新的版本）" : "還原草稿"}
            </PixelButton>
            <PixelButton variant="flee" className="!m-0 !px-3 !py-1 text-[15px]" disabled={busy} onClick={() => { forgetStored(draftKey(bankId)); setDraftOffer(null); }}>
              捨棄
            </PixelButton>
          </div>
        </Panel>
      )}

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
        <fieldset key={generation} disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          {/* editor-ux #2: one search over every pool and phase; a hit opens its tab, page and question. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="search"
                className="px-input min-w-0 flex-1"
                aria-label="搜尋題目或答案"
                placeholder="🔍 搜尋題目、答案、選項（全部難度和首領）"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <PixelButton
                className="!m-0 shrink-0 !px-3 !py-1 text-[14px]"
                aria-pressed={openAll}
                onClick={() => {
                  writeStored(OPEN_ALL_STORAGE, openAll ? "0" : "1");
                  setOpenAll(!openAll);
                  setToggled(new Set());
                }}
              >
                {openAll ? "收成清單" : "全部展開"}
              </PixelButton>
            </div>
            {query.trim() && (() => {
              const hits = searchBank(bank, query);
              return (
                <Panel className="p-2 text-[15px]">
                  <div data-testid="bank-search-results" className="flex flex-col">
                  {hits.length === 0 ? (
                    <div className="p-1">找不到「{query.trim()}」</div>
                  ) : (
                    hits.slice(0, SEARCH_LIMIT).map((h) => (
                      <button key={h.questionId} type="button" className="min-h-[44px] border-b border-black/10 px-1 text-left last:border-b-0" onClick={() => goTo({ message: "", tab: h.tab, questionId: h.questionId })}>
                        {h.where}「{h.name}」
                      </button>
                    ))
                  )}
                  {hits.length > SEARCH_LIMIT && <div className="p-1 text-[13px]">只列前 {SEARCH_LIMIT} 筆，打多一點字縮小範圍。</div>}
                  </div>
                </Panel>
              );
            })()}
          </div>
          <div role="tablist" className="flex flex-wrap gap-2">
            {(["rooms", ...DIFFICULTIES, "boss"] as Tab[]).map((t) => (
              <PixelButton
                key={t}
                role="tab"
                aria-selected={tab === t}
                data-testid={`bank-tab-${t}`}
                onClick={() => {
                  setTab(t);
                  setJump(null);
                }}
                className={`!m-0 !px-3 !py-1 text-[15px] ${tab === t ? "" : "opacity-70"}`}
                style={tab === t ? { background: "var(--cream, #fff3d6)" } : undefined}
              >
                {t === "rooms" ? "房間" : t === "boss" ? `首領 ${bossQuestions(bank).length}` : `難度 ${t}・${bank.pools[t].length}`}
                {tabDirty(t) && <span aria-label="（有還沒儲存的修改）"> ●</span>}
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
                    {/* Phases are keyed by position: a phase count change resets every pager, so a phase never opens on a deleted neighbor's page. */}
                    <RoomEditor
                      key={bank.boss.phases.length}
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
                      jump={jump}
                      problems={problemOf}
                      actions={listActions(loc)}
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
                  jump={jump}
                  problems={problemOf}
                  actions={listActions(loc)}
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
          {/* Stays at the bottom of the screen: a save's result and every problem show next to the button pressed. */}
          <div data-testid="bank-save-bar" className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t-4 px-4 pt-2" style={{ background: "var(--stage)", borderColor: "var(--k)", paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
            {(shown || error) && (
              <Panel role="alert" className="flex flex-col gap-1 p-2 text-[14px]" style={{ background: "#ffd9d9" }}>
                <div className="flex items-start gap-2">
                  <span data-testid="bank-editor-error" className="line-clamp-3 min-w-0 flex-1">{shown?.message ?? error}</span>
                  {shown?.tab !== undefined && (
                    <PixelButton
                      className="!m-0 !min-h-[44px] shrink-0 !px-3 !py-2 text-[15px]"
                      onClick={() => {
                        const next = problems.length > 1 ? (shownAt + 1) % problems.length : shownAt;
                        setCursor(next);
                        goTo(problems[next]);
                      }}
                    >
                      {problems.length > 1 ? "下一個 ▸" : "跳過去"}
                    </PixelButton>
                  )}
                  {shown?.message === BANK_GONE && (
                    <PixelButton data-testid="bank-save-as-new" className="!m-0 !min-h-[44px] shrink-0 !px-3 !py-2 text-[15px]" disabled={busy} onClick={saveAsNew}>
                      另存成新題庫
                    </PixelButton>
                  )}
                </div>
                {/* A failed 另存成新題庫 (a taken name, the bank limit) under the refusal it answers. */}
                {shown && error && <div data-testid="bank-editor-error-extra">{error}</div>}
                {problems.length > 1 && <div className="text-[12px]">共 {problems.length} 處要修正，這是第 {shownAt + 1} 處</div>}
              </Panel>
            )}
            <div className="flex items-center gap-3">
              <div role="status" className="min-w-0 flex-1 text-[15px] text-white" style={{ textShadow: "1px 1px 0 var(--k)" }}>
                {toast ? (
                  <span data-testid="bank-toast" className="flex flex-wrap items-center gap-x-2">
                    {dirty && (
                      <span>
                        <span aria-hidden>●</span>
                        <span className="sr-only">有還沒儲存的修改</span>
                      </span>
                    )}
                    {toast.message}
                    {/* Locked while a save runs: the saved bank landing after it would drop the question again. */}
                    {toast.undo && (
                      <>
                        <span aria-hidden>·</span>
                        <button type="button" className="min-h-[44px] underline underline-offset-2 disabled:opacity-55" style={{ color: "var(--cream, #fff3d6)" }} disabled={busy} onClick={() => undoDelete(toast.undo!)}>
                          復原
                        </button>
                      </>
                    )}
                  </span>
                ) : lastSaved !== null && lastSaved === bank ? (
                  <span data-testid="bank-saved" style={{ color: "var(--ok)" }}>✓ 已儲存</span>
                ) : dirty ? (
                  "● 有還沒儲存的修改"
                ) : (
                  "沒有修改"
                )}
              </div>
              <PixelButton variant="primary" className="!m-0 shrink-0" onClick={() => void save(bank)} disabled={busy || readOnly}>
                {saving ? "儲存中…" : uploads > 0 ? "上傳中…" : "儲存全部變更"}
              </PixelButton>
            </div>
          </div>
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
  jump,
  problems,
  actions,
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
  onUploadImage: UploadFn;
  /** The latest jump: when its question is in this group, its page opens (once per jump, so paging away still works). */
  jump: Jump | null;
  /** Each question's save problem, by question id. */
  problems: Map<string, string>;
  actions: ListActions;
}) {
  const hintId = useId();
  const difficultyHintId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const jumpPage = (j: Jump | null) => {
    const i = j?.id ? questions.findIndex((q) => q.id === j.id) : -1;
    return i < 0 ? null : pageOf(i);
  };
  const [pageWanted, setPage] = useState(() => jumpPage(jump) ?? 0);
  // Adjusting state while rendering (react.dev "storing information from previous renders"): no extra render pass.
  const [seenJump, setSeenJump] = useState(jump?.seq);
  if (jump?.seq !== seenJump) {
    setSeenJump(jump?.seq);
    const p = jumpPage(jump);
    if (p !== null) setPage(p);
  }
  const { page, pages, start, end } = questionPage(questions.length, pageWanted);
  // Two copies, above and below the list; the one below brings the group's top back into view.
  const pager = (scroll: boolean) =>
    pages > 1 && (
      <nav aria-label={scroll ? "下方分頁" : "分頁"} className="flex flex-wrap items-center gap-1 text-[14px]">
        <span className="mr-1">
          第 {start + 1 === end ? end : `${start + 1}–${end}`} 題，共 {questions.length} 題
        </span>
        {[
          { to: page - 1, text: "上一頁", label: "上一頁" },
          ...Array.from({ length: pages }, (_, i) => ({ to: i, text: String(i + 1), label: `第 ${i + 1} 頁` })),
          { to: page + 1, text: "下一頁", label: "下一頁" },
        ].map(({ to, text, label }) => (
          <PixelButton
            key={label}
            aria-label={label}
            aria-current={to === page ? "page" : undefined}
            disabled={to < 0 || to >= pages}
            onClick={() => {
              setPage(to);
              if (scroll) headingRef.current?.scrollIntoView({ block: "start" });
            }}
            className={`!m-0 !px-2 !py-1 text-[14px] ${to === page ? "" : "opacity-70"}`}
            style={to === page ? { background: "var(--cream, #fff3d6)" } : undefined}
          >
            {text}
          </PixelButton>
        ))}
      </nav>
    );
  return (
    <Panel className="flex flex-col gap-2 p-4">
      <div data-testid={testId} className="flex flex-col gap-2">
        <h2 ref={headingRef} className="text-[18px]">{title}</h2>
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
        {pager(false)}
        {questions.slice(start, end).map((q, i) => (
          <QuestionRow
            key={q.id}
            number={start + i + 1}
            question={q}
            onUpdate={(updater) => onUpdate(q.id, updater)}
            onDelete={() => onDelete(q.id)}
            onUploadImage={onUploadImage}
            problem={problems.get(q.id)}
            open={actions.isOpen(q.id)}
            last={start + i === questions.length - 1}
            actions={actions}
            category={categories}
            difficultyHintId={difficulty ? difficultyHintId : undefined}
            answerHintId={categories ? undefined : hintId}
          />
        ))}
        {pager(true)}
        <PixelButton
          onClick={() => {
            onAdd();
            setPage(pageOf(questions.length)); // the new question's page
          }}
        >
          + 新增題目
        </PixelButton>
      </div>
    </Panel>
  );
}

interface Uploaded {
  key: string;
  contentType: string;
}
type UploadFn = (file: File, onProgress: (loaded: number) => void, signal: AbortSignal) => Promise<Uploaded>;
type UploadKind = "image" | "video" | "audio";
const UPLOAD: Record<UploadKind, { name: string; accept: string }> = {
  image: { name: "圖片", accept: "image/png,image/jpeg,image/webp" },
  video: { name: "影片", accept: "video/mp4" },
  audio: { name: "聲音", accept: "audio/mp4,audio/x-m4a,audio/mpeg,.m4a,.mp3" },
};
// An older Worker answers { key } alone: that was always an image (review).
const kindOfType = (contentType = "image/"): UploadKind => (contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "image");
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
/** Longer than this, a clip drags on stage: a hint, not a limit. */
const LONG_CLIP_SECONDS = 90;

/** Picks text / uploaded image / YouTube video / uploaded video or audio for one content slot (a question's `content`, or
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
  onUploadImage: UploadFn;
  allowNone?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  /** Bytes sent and the file's size while uploading. */
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** The file just uploaded, played from this browser to check it (not from R2). */
  const [local, setLocal] = useState<{ url: string; name: string; size: number; kind: UploadKind } | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local.url);
  }, [local]);
  /** The upload's or the pasted YouTube link's problem, if any. */
  const [error, setError] = useState("");
  const [youtubeInput, setYoutubeInput] = useState(value?.kind === "youtube" && value.value ? youtubeWatchUrl(value.value) : "");

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
    setNote("");
    setLocal(null);
    setYoutubeInput("");
    onChange(kind === "none" ? undefined : { kind, value: "" });
  };

  const handleFile = async (file: File, tab: UploadKind) => {
    setError("");
    setNote("");
    // The server checks again; this saves a 25 MB upload only to hear it is too big.
    const max = file.type.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
    if (file.size > max) return setError(max === MAX_IMAGE_BYTES ? "圖片超過 5 MB，請先縮小" : "影片或聲音超過 25 MB，請先剪短或壓縮");
    setUploading(true);
    setProgress({ sent: 0, total: file.size });
    abort.current = new AbortController();
    try {
      const { key, contentType } = await onUploadImage(file, (sent) => setProgress({ sent, total: file.size }), abort.current.signal);
      const kind = kindOfType(contentType);
      // The server's sniffing decides the kind: a video picked under 聲音 lands under 影片.
      if (kind !== tab) setNote(`這是${UPLOAD[kind].name}檔，已放到「${UPLOAD[kind].name}」`);
      setLocal(kind === "image" ? null : { url: URL.createObjectURL(file), name: file.name, size: file.size, kind });
      onChange({ kind, value: key });
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗");
    } finally {
      setUploading(false);
      setProgress(null);
      abort.current = null;
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
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 whitespace-nowrap text-[13px] text-black/60">{label}</span>
        <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
          {/* Instagram only as an explanation: the host cannot play it (docs/designs/instagram-explanations.md). */}
          {(["text", "image", "youtube", "video", "audio", ...(allowNone ? (["instagram", "none"] as const) : [])] as const).map((kind) => {
            const kindLabel = { text: "文字", image: "圖片", youtube: "YouTube", video: "影片", audio: "聲音", instagram: "Instagram", none: "無" }[kind];
            const pressed = kind === "none" ? value === undefined : current.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                className={`px-btn shrink-0 whitespace-nowrap !px-2 !py-1 text-[13px] ${pressed ? "!bg-[var(--turn)]" : ""}`}
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
        // Wraps and grows with the text (a long 詳解 used to scroll sideways in a one-line input).
        <textarea
          className="px-input resize-y [field-sizing:content]"
          rows={2}
          aria-label={`${label}文字`}
          value={current.value}
          // No line breaks, as in the old one-line input: the stage shows the text as one paragraph.
          onChange={(e) => onChange({ kind: "text", value: e.target.value.replace(/\r?\n/g, " ") })}
        />
      ) : current.kind === "image" || current.kind === "video" || current.kind === "audio" ? (
        <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
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
            accept={UPLOAD[current.kind].accept}
            aria-label={`上傳${label}${UPLOAD[current.kind].name}`}
            disabled={uploading}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // lets re-selecting the same file re-trigger onChange
              if (file) void handleFile(file, current.kind as UploadKind);
            }}
          />
          <label htmlFor={`image-upload-${fieldId}`} className={`px-btn${uploading ? " pointer-events-none opacity-55" : ""}`}>
            選擇{UPLOAD[current.kind].name}
          </label>
          {uploading && progress && (
            <>
              <span className="text-[13px]" aria-live="polite">
                上傳中 {progress.total ? Math.floor((progress.sent / progress.total) * 100) : 0}%（{mb(progress.sent)}／{mb(progress.total)} MB）
              </span>
              <button type="button" className="px-btn !px-2 !py-1 text-[12px]" onClick={() => abort.current?.abort()}>
                取消
              </button>
            </>
          )}
          {current.value && !uploading && <span className="text-[13px]">已上傳（{current.value.slice(0, 8)}…）</span>}
        </div>
        {uploading && progress && (
          // Pixel bar: a 4px outline and a stepped fill, no smooth animation (DESIGN.md).
          <div aria-hidden className="h-[12px] w-full max-w-[320px] bg-white" style={{ boxShadow: "0 0 0 4px var(--k)" }}>
            <div className="h-full bg-[var(--ok)]" style={{ width: `${progress.total ? Math.floor((progress.sent / progress.total) * 20) * 5 : 0}%` }} />
          </div>
        )}
        {current.kind !== "image" && !uploading && !current.value && (
          <span className="text-[12px] text-black/60">影片用 MP4（H.264／AAC），聲音用 M4A 或 MP3，每個檔案 25 MB 以內。</span>
        )}
        {local && local.kind === current.kind && current.value && !uploading && <LocalPreview {...local} />}
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
      {note && <span className="text-[13px]">{note}</span>}
      {error && (
        <Panel role="alert" className="text-[13px]" style={{ background: "#ffd9d9" }}>
          {error}
        </Panel>
      )}
    </div>
  );
}

/** A timing question's target and label (timing-tap.md 畫面), with a YouTube clip's preview to set the target by ear. */
function TimingFields({ q, onUpdate, onDelete }: { q: Extract<BankQuestion, { kind: "timing" }>; onUpdate: (updater: (q: BankQuestion) => BankQuestion) => void; onDelete: () => void }) {
  const [text, setText] = useState(String(q.target));
  const [preview, setPreview] = useState<{ seq: number; start: number } | null>(null);
  const time = useRef<(() => number | null) | null>(null);
  const setTarget = (target: number) => {
    const t = Math.max(0, Math.round(target * 100) / 100);
    setText(String(t));
    onUpdate((cur) => (cur.kind === "timing" ? { ...cur, target: t } : cur));
  };
  const err = timingFieldError(q);
  const c = q.content;
  const youtube = c.kind === "youtube" && !!c.value;
  return (
    <div className="flex flex-col gap-1" data-testid={`timing-${q.id}`}>
      <small className="text-[14px]">卡點題：大螢幕放歌，每隊按一次，按得最接近目標秒數的隊伍命中。內容要選 YouTube 或上傳的影音。</small>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          目標秒數
          <input
            className="px-input"
            style={{ width: 110 }}
            type="number"
            step={0.01}
            min={0}
            aria-label="目標秒數"
            value={text}
            onChange={(e) => {
              // Read now, as the other fields do: the updater may run after the input is put back.
              const value = e.target.value;
              setText(value);
              const t = Number(value);
              if (value.trim() && Number.isFinite(t)) onUpdate((cur) => (cur.kind === "timing" ? { ...cur, target: t } : cur));
            }}
          />
        </label>
        <span data-testid="timing-target-text">{Number.isFinite(q.target) ? formatSongTime(q.target * 1000) : ""}</span>
        <button type="button" className="px-btn !px-2 !py-1 text-[13px]" onClick={() => setTarget(q.target - 0.05)}>
          −0.05
        </button>
        <button type="button" className="px-btn !px-2 !py-1 text-[13px]" onClick={() => setTarget(q.target + 0.05)}>
          +0.05
        </button>
      </div>
      <label className="flex items-center gap-1">
        label
        <input
          className="px-input flex-1"
          aria-label="卡點題 label"
          placeholder={`選填，最多 ${MAX_TAP_LABEL} 字，例如：蹬（手機顯示「按在『蹬』那一下」）`}
          maxLength={MAX_TAP_LABEL}
          value={q.label ?? ""}
          onChange={(e) => {
            const label = e.target.value;
            onUpdate((cur) => {
              if (cur.kind !== "timing") return cur;
              const next: BankQuestion = { ...cur, label };
              if (!label.trim()) delete (next as { label?: string }).label;
              return next;
            });
          }}
        />
      </label>
      {youtube && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="px-btn !px-2 !py-1 text-[13px]" onClick={() => setPreview((p) => ({ seq: (p?.seq ?? 0) + 1, start: c.start ?? 0 }))}>
            ▶ 試聽片段
          </button>
          <button type="button" className="px-btn !px-2 !py-1 text-[13px]" onClick={() => setPreview((p) => ({ seq: (p?.seq ?? 0) + 1, start: Math.max(c.start ?? 0, Math.floor(q.target - 3)) }))}>
            從目標前 3 秒試聽
          </button>
          <button
            type="button"
            className="px-btn !px-2 !py-1 text-[13px]"
            disabled={!preview}
            onPointerDown={() => {
              const t = time.current?.();
              if (t !== null && t !== undefined) setTarget(t);
            }}
            onKeyDown={(e) => {
              if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
              e.preventDefault();
              const t = time.current?.();
              if (t !== null && t !== undefined) setTarget(t);
            }}
          >
            跟著按
          </button>
        </div>
      )}
      {youtube && <small className="text-[13px] text-black/60">跟著按會帶到自己的反應時間，通常晚 0.1–0.2 秒：按完用 −0.05 微調，再從目標前 3 秒試聽核對。</small>}
      {preview && youtube && <YoutubePlayer videoId={c.value} start={preview.start} end={c.end} command={{ state: "playing", seq: preview.seq }} width={320} height={180} controls title="卡點題試聽" timeRef={time} />}
      {err && (
        <span role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>
          {err}
        </span>
      )}
      <PixelButton variant="flee" onClick={onDelete}>
        刪除題目
      </PixelButton>
    </div>
  );
}

/** The file just uploaded, played from this browser: its name, length and size, and whether a browser can play it. */
function LocalPreview({ url, name, size, kind }: { url: string; name: string; size: number; kind: UploadKind }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const onMeta = (e: React.SyntheticEvent<HTMLMediaElement>) => {
    const el = e.currentTarget;
    setSeconds(el.duration);
    // An HEVC or other codec this browser can't decode: no picture, though the container passed the server.
    if (el instanceof HTMLVideoElement && el.videoWidth === 0) setBroken(true);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] [overflow-wrap:anywhere]">
        {name}・{seconds === null ? "…" : formatClipTime(Math.round(seconds))}・{mb(size)} MB
      </span>
      {seconds !== null && seconds > LONG_CLIP_SECONDS && <span className="text-[12px]">超過 {LONG_CLIP_SECONDS} 秒，台上可能太長</span>}
      {broken && (
        <span role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>
          {kind === "video" ? "這支影片瀏覽器放不出來，請轉成 H.264／AAC 再上傳" : "這個聲音檔瀏覽器放不出來，請轉成 M4A（AAC）或 MP3 再上傳"}
        </span>
      )}
      {kind === "video" ? (
        <video src={url} controls playsInline className="max-w-[320px]" onLoadedMetadata={onMeta} onError={() => setBroken(true)} />
      ) : (
        <audio src={url} controls onLoadedMetadata={onMeta} onError={() => setBroken(true)} />
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
  number,
  question: q,
  onUpdate,
  onDelete,
  onUploadImage,
  category = false,
  difficultyHintId,
  answerHintId,
  problem,
  open,
  last,
  actions,
}: {
  /** 1-based within its group, across pages. */
  number: number;
  /** Shows the whole editor; closed, the row is its one-line summary. */
  open: boolean;
  /** The group's last question (下移 is off). */
  last: boolean;
  actions: ListActions;
  /** Why a save is blocked on this question, if it is. */
  problem?: string;
  category?: boolean;
  /** Shows a 難度 menu (a boss question's own difficulty), described by the section's line with this id. */
  difficultyHintId?: string;
  /** The section's mage-hint note, read out with a fill-in answer box. */
  answerHintId?: string;
  question: BankQuestion;
  onUpdate: (updater: (q: BankQuestion) => BankQuestion) => void;
  onDelete: () => void;
  onUploadImage: UploadFn;
}) {
  return (
    <div
      data-testid={`question-${q.id}`}
      tabIndex={-1}
      aria-invalid={problem ? true : undefined}
      className="flex flex-col gap-1 border-t border-black/10 pt-2 outline-none first:border-t-0 first:pt-0"
      style={problem ? { boxShadow: "0 0 0 4px var(--danger)", padding: 8 } : undefined}
    >
      <QuestionHeader number={number} question={q} problem={!!problem} open={open} last={last} actions={actions} onDelete={onDelete} />
      {open && (
      <>
      {problem && (
        <div data-testid={`problem-${q.id}`} className="text-[14px]" style={{ color: "#b3261e" }}>
          ⚠ {problem}
        </div>
      )}
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <MediaPicker
            fieldId={`${q.id}-content`}
            label="題目"
            value={q.content}
            // A text question is its own line: the bank refuses a prompt (and a memory setup) on it.
            onChange={(c) => onUpdate((cur) => withContent(cur, c!))}
            onUploadImage={onUploadImage}
          />
          {q.content.kind !== "text" && (
            <textarea
              className="px-input mt-1 resize-y [field-sizing:content]"
              rows={2}
              aria-label="題幹"
              placeholder="題幹（顯示在圖片或影片上方，例如：這首歌是什麼的主題曲？）"
              value={q.prompt ?? ""}
              onChange={(e) => {
                // Read the value now: React may run or rerun the updater later, after the input
                // was put back to its old value, and the prompt would be dropped (a CI flake).
                const prompt = e.target.value.replace(/\r?\n/g, " "); // one line, like the text box above
                onUpdate((cur) => {
                  const next = { ...cur };
                  if (prompt.trim()) next.prompt = prompt;
                  else delete next.prompt;
                  return next;
                });
              }}
            />
          )}
          {/* 記憶題 (docs/designs/memory-questions.md): watch first, then the question. */}
          {canBeMemory(q) && (
            <div data-testid={`memory-${q.id}`} className="mt-1 flex flex-col gap-1 text-[15px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!q.memory} onChange={(e) => { const on = e.target.checked; onUpdate((cur) => withMemory(cur, on)); }} />
                🧠 記憶題（先看再出題）
              </label>
              {q.memory && q.content.kind === "image" && (
                <label className="flex items-center gap-2">
                  顯示幾秒
                  <input
                    type="number"
                    className="px-input !py-1"
                    style={{ width: 80 }}
                    min={MIN_MEMORY_SECONDS}
                    max={MAX_MEMORY_SECONDS}
                    step={1}
                    aria-label="記憶題圖片顯示幾秒"
                    value={Number.isFinite(q.memorySeconds) ? q.memorySeconds : ""}
                    onChange={(e) => {
                      // NaN for an empty box: the pre-save check refuses it rather than keeping the last good value.
                      const seconds = e.target.value === "" ? NaN : Number(e.target.value);
                      onUpdate((cur) => ({ ...cur, memorySeconds: seconds }));
                    }}
                  />
                  秒（{MIN_MEMORY_SECONDS}–{MAX_MEMORY_SECONDS}）
                </label>
              )}
              {q.memory && (
                <div className="text-[13px]" style={{ color: "#6b4a2a" }}>
                  看的時候隱藏題幹和選項；{q.content.kind === "image" ? "時間到" : "播完"}，{q.content.kind === "image" ? "圖片" : q.content.kind === "audio" ? "聲音" : "影片"}收起來才出題。
                  {(q.content.kind === "video" || q.content.kind === "audio") && "上傳的影片／聲音會整段播完才出題。"}
                  {q.content.kind === "youtube" && q.content.end === undefined && <span role="alert"> 這支 YouTube 沒設結束秒數：整支播完才出題，建議設結束。</span>}
                </div>
              )}
            </div>
          )}
        </div>
        <select
          // self-start: keep its own height, not the row's (a tall question stretched it).
          className="px-input self-start"
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
            // The answer carries over where it can (editor-ux #6); ask only when something typed would go.
            if (lostOnKindChange(q, kind) && !window.confirm("換題型會丟掉一部分答案、選項或排序項目，確定要換？")) return;
            onUpdate((cur) => blankQuestion(cur, kind));
          }}
        >
          <option value="text">填空</option>
          <option value="multipleChoice">選擇</option>
          <option value="sort">排序</option>
          {/* A buzzer phase's question only (timing-tap.md); a misplaced one still shows its kind so it can be changed. */}
          {(category || q.kind === "timing") && <option value="timing">卡點題</option>}
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
            <div key={i} className="flex flex-wrap items-center gap-2">
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
                style={{ minWidth: "10em" }}
                aria-label={`欄位 ${i + 1} 答案`}
                value={f.answer}
                onChange={(e) => {
                  const answer = e.target.value;
                  onUpdate((cur) => withField(cur, i, { answer }));
                }}
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {q.fields.length < MAX_FIELDS && (
              <PixelButton className="!m-0 !px-3 !py-1 text-[15px]" onClick={() => onUpdate((cur) => (cur.kind === "text" && cur.fields ? { ...cur, fields: [...cur.fields, { label: "", answer: "" }] } : cur))}>+ 再加一欄</PixelButton>
            )}
            <PixelButton
              className="!m-0 !px-3 !py-1 text-[15px]"
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
            <PixelButton variant="flee" className="!m-0 !px-3 !py-1 text-[15px]" onClick={onDelete}>
              刪除
            </PixelButton>
          </div>
        </div>
      ) : q.kind === "text" ? (
        <div className="flex flex-wrap gap-2">
          <input
            className="px-input flex-1"
            style={{ minWidth: "10em" }}
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
      ) : q.kind === "timing" ? (
        <TimingFields q={q} onUpdate={onUpdate} onDelete={onDelete} />
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
          <small className="text-[14px]">
            {q.correctIndex >= 0 && q.correctIndex < q.options.length ? `正解：第 ${q.correctIndex + 1} 個（綠框）` : "⚠ 還沒標正解：點選項左邊的圓圈"}
          </small>
          {q.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                className="h-7 w-7 shrink-0"
                style={{ accentColor: "var(--ok2)" }}
                aria-label={`第 ${i + 1} 個選項為正解`}
                name={`correct-${q.id}`}
                checked={q.correctIndex === i}
                onChange={() => onUpdate((cur) => (cur.kind === "multipleChoice" ? { ...cur, correctIndex: i } : cur))}
              />
              <input
                className="px-input min-w-0 flex-1"
                style={q.correctIndex === i ? { boxShadow: "0 0 0 4px var(--ok2)", background: "#e8f8e6" } : undefined}
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
      </>
      )}
    </div>
  );
}

/** A question's summary row (editor-ux #2): tap to open or close its editor. Its ⋯ menu (#3) moves, copies or
 * deletes it; 移到… lists every pool and phase, the ones a save would refuse disabled with the reason. */
function QuestionHeader({ number, question: q, problem, open, last, actions, onDelete }: { number: number; question: BankQuestion; problem: boolean; open: boolean; last: boolean; actions: ListActions; onDelete: () => void }) {
  const [menu, setMenu] = useState<"closed" | "actions" | "move">("closed");
  const s = questionSummary(q);
  const act = (f: () => void) => () => {
    setMenu("closed");
    f();
  };
  const targets = menu === "move" ? actions.targets(q) : [];
  const fromCount = targets.find((t) => t.current)?.count;
  const item = "!m-0 !min-h-[44px] !px-3 !py-1 text-[15px]";
  return (
    <div className="flex flex-col gap-2" onKeyDown={(e) => e.key === "Escape" && menu !== "closed" && setMenu("closed")}>
      <div className="flex items-stretch gap-2">
        <button type="button" data-summary={q.id} aria-expanded={open} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left" onClick={() => actions.onToggle(q.id)}>
          {/* Smaller than the LabelChip it replaces: on a phone the question's own words need the room. */}
          <span className="shrink-0 whitespace-nowrap px-2 py-0.5 text-[13px]" style={{ background: "var(--k)", color: "var(--cream, #fff3d6)", borderRadius: 999 }}>
            第 {number} 題
          </span>
          <span className="shrink-0 border border-black/30 px-1 text-[12px]">{s.kind}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px]">
              {s.media && <span aria-hidden>{s.media} </span>}
              {s.name}
            </span>
            {s.answer && (
              <span className="block truncate text-[13px]" style={{ color: s.answer === "沒標正解" ? "#b3261e" : "#2e6b2a" }}>
                {s.answer}
              </span>
            )}
          </span>
          {problem && (
            <span className="shrink-0" style={{ color: "#b3261e" }} aria-label="有問題要修正">
              ⚠
            </span>
          )}
          <span className="shrink-0" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        </button>
        <PixelButton className="!m-0 shrink-0 !px-3 !py-1" aria-label={`第 ${number} 題的更多動作`} aria-expanded={menu !== "closed"} onClick={() => setMenu(menu === "closed" ? "actions" : "closed")}>
          ⋯
        </PixelButton>
      </div>
      {menu === "actions" && (
        <div role="group" aria-label={`第 ${number} 題的動作`} className="flex flex-wrap gap-2">
          <PixelButton className={item} disabled={number === 1} onClick={act(() => actions.onShift(q.id, -1))}>↑ 上移</PixelButton>
          <PixelButton className={item} disabled={last} onClick={act(() => actions.onShift(q.id, 1))}>↓ 下移</PixelButton>
          <PixelButton className={item} onClick={() => setMenu("move")}>⇄ 移到…</PixelButton>
          <PixelButton className={item} onClick={act(() => actions.onCopy(q.id))}>⧉ 複製</PixelButton>
          <PixelButton variant="flee" className={item} onClick={act(onDelete)}>刪除這題</PixelButton>
        </div>
      )}
      {menu === "move" && (
        <div role="group" aria-label="移到哪裡？" className="flex flex-col gap-1 text-[15px]">
          <div>移到哪裡？（放到那一組的最後）</div>
          {targets.map((t) => (
            <div key={t.name} className="flex flex-col">
              <PixelButton className="!m-0 !min-h-[44px] !whitespace-normal !px-3 !py-1 text-[15px]" disabled={t.current || !!t.refusal} onClick={act(() => actions.onMove(q.id, t.loc))}>
                {t.name}
                {t.current ? "（現在在這裡）" : ""} · {t.count} 題
              </PixelButton>
              {/* The reason sits outside the dimmed button so it stays readable. */}
              {!t.current && t.refusal && <div className="px-1 text-[13px]" style={{ color: "#b3261e" }}>不能移：{t.refusal}</div>}
            </div>
          ))}
          {fromCount === 1 && <div className="text-[13px]">這是這一組唯一的一題，搬走後這組會是空的。</div>}
          <PixelButton className={item} onClick={() => setMenu("closed")}>取消</PixelButton>
        </div>
      )}
    </div>
  );
}
