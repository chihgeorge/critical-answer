"use client";

import { useEffect, useState } from "react";
import type { ClientMessage } from "@/lib/protocol";
import { MAX_EDIT_LINE } from "@/lib/protocol";
import { MAX_LINE } from "@/lib/narration/runner";
import { editedLine, narrationSummary, type NarrationState } from "@/lib/narration/client";
import { LabelChip, Panel, PixelButton, Sprite } from "@/components/pixel";

/** A room refusal of HOST_EDIT_NARRATION; `seq` tells two equal refusals apart. */
export type EditRefusal = { detail: string; seq: number };

/** `rev`: the narration's edit revision when the editor opened; another host device's edit makes this one stale (D9). */
type Edit = { eventId: number; rev: number; index: number; draft: string; sent: boolean; refused: string | null };

const rowBase = "flex min-h-[48px] items-center gap-2 px-2 py-1 text-[15px] leading-[1.3]";
const num = "px-num flex h-[22px] w-[22px] flex-none items-center justify-center text-[11px]";
const smallBtn = "!m-0 min-h-[44px] min-w-[52px] !px-3 !py-0 text-[15px]";
const input = "px-input w-full";

/**
 * The host's narration panel above the judge buttons (docs/designs/host-narration-edit.md D2–D18): one summary row,
 * opened into every line the big screen reads for the next team. A line not yet read can be swapped (HOST_EDIT_NARRATION);
 * below the lines, 下一句這樣說 queues a line for the next narration (HOST_NEXT_LINE).
 */
export function NarrationPanel({
  narration,
  pending,
  done,
  nextLine,
  refusal,
  disabled,
  send,
}: {
  narration: NarrationState;
  /** STATE moved on and its narration has not arrived yet. */
  pending: boolean;
  /** Lines the big screen has read of this narration. */
  done: number;
  /** The queued line ("" for none), or null when the room can't queue one. */
  nextLine: string | null;
  refusal: EditRefusal | null;
  disabled: boolean;
  send: (msg: ClientMessage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [nextDraft, setNextDraft] = useState("");
  /** Where focus goes once the editor closes (D17): a line's 改, or -1 for the panel toggle. */
  const [returnTo, setReturnTo] = useState<number | null>(null);

  // D12: a new narration, or our edit landing, closes the panel; an open editor keeps it open.
  const key = narration ? `${narration.eventId}:${narration.rev}` : "";
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    const sameEvent = seenKey.split(":")[0] === String(narration?.eventId ?? "");
    setSeenKey(key);
    // Only our own text landing closes it: another device's edit first means ours comes back stale_narration (D9).
    // Sent, or released by an ERROR before it landed; an editor opened but never sent stays open.
    if (edit && (edit.sent || edit.refused !== null) && sameEvent && narration?.lines[edit.index] === editedLine(edit.draft)) {
      setEdit(null);
      setOpen(false);
      setReturnTo(-1); // the editor's row is gone: focus goes back to the toggle
    } else if (!edit && !sameEvent) setOpen(false);
  }
  // A refused edit stays open with its draft (D10).
  const [seenRefusal, setSeenRefusal] = useState(refusal);
  if (refusal !== seenRefusal) {
    setSeenRefusal(refusal);
    if (refusal && edit?.sent) setEdit({ ...edit, sent: false, refused: refusal.detail });
  }
  // Cleared once the room confirms a queued line, so an ERROR keeps what was typed.
  const [seenNextLine, setSeenNextLine] = useState(nextLine);
  if (nextLine !== seenNextLine) {
    setSeenNextLine(nextLine);
    if (nextLine) setNextDraft("");
  }

  useEffect(() => {
    if (edit || returnTo === null) return;
    document.getElementById(returnTo < 0 ? "narration-toggle" : `narration-edit-${returnTo}`)?.focus();
  }, [edit, returnTo]);

  const lines = narration?.lines ?? [];
  const summary = narrationSummary(narration, pending, done, !!nextLine);
  // With no narration yet, the panel still opens for 下一句這樣說 (D7) — just without lines.
  const canOpen = pending || !!narration || nextLine !== null;
  // While the next narration is on its way, the one being edited is already old.
  const stale =
    !!edit && (pending || edit.eventId !== narration?.eventId || (!edit.sent && edit.rev !== narration.rev) || edit.refused === "stale_narration");
  const locked = !!edit && !stale && (edit.index < done || edit.refused === "line_read");

  function cancel() {
    if (edit) setReturnTo(edit.index);
    setEdit(null);
  }
  function submit() {
    // edit.sent: Enter again while the first one is on its way would edit twice.
    if (!edit || !edit.draft.trim() || disabled || edit.sent) return;
    if (stale || locked) return queueNext(edit.draft);
    send({ type: "HOST_EDIT_NARRATION", eventId: edit.eventId, rev: edit.rev, index: edit.index, line: edit.draft });
    setEdit({ ...edit, sent: true, refused: null });
  }
  function queueNext(line: string) {
    if (line.trim().length > MAX_EDIT_LINE) return;
    send({ type: "HOST_NEXT_LINE", line });
    cancel();
  }

  return (
    <Panel tone="lav" className="px-[10px] pb-[10px] pt-2" data-testid="narration-panel">
      <button
        type="button"
        id="narration-toggle"
        aria-expanded={open}
        aria-controls="narration-lines"
        disabled={!canOpen}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center gap-2 text-left"
      >
        <Sprite kind="owl" scale={1} />
        <LabelChip>地城主旁白</LabelChip>
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-[14px]">
          {summary}
        </span>
        {canOpen && <span className="flex-none text-[14px]">{open ? "收起 ▴" : "展開 ▾"}</span>}
      </button>
      {open && (
        <div id="narration-lines" className="mt-1 flex flex-col gap-2">
          {pending ? (
            <div className={rowBase} style={{ boxShadow: "inset 0 0 0 3px var(--dim-line)" }}>
              旁白生成中…
            </div>
          ) : (
            lines.map((text, i) => {
              const read = i < done;
              const reading = i === done;
              if (edit && edit.index === i && !stale) return editor(i);
              return (
                <div
                  key={i}
                  data-testid="narration-line"
                  className={rowBase}
                  style={
                    read
                      ? { color: "var(--dim-ink)", outline: "3px dashed var(--dim-line)", outlineOffset: -3 }
                      : { background: reading ? "var(--turn)" : "#fff", boxShadow: "inset 0 0 0 3px var(--k)" }
                  }
                >
                  <span className={num} style={{ background: read ? "var(--dim-line)" : "var(--k)", color: read ? "#eee" : "var(--turn2)" }}>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-all">
                    {reading && <span className="mr-1 whitespace-nowrap bg-[var(--k)] px-[6px] text-[12px] text-[var(--turn2)]">▶ 念到這</span>}
                    {text}
                  </span>
                  {read ? (
                    <span className="whitespace-nowrap bg-[var(--dim-line)] px-[6px] text-[12px] text-white">✓ 已念完</span>
                  ) : (
                    <PixelButton
                      id={`narration-edit-${i}`}
                      aria-label={`改第 ${i + 1} 句`}
                      disabled={disabled || (!!edit && !stale)}
                      onClick={() => setEdit({ eventId: narration!.eventId, rev: narration!.rev, index: i, draft: text, sent: false, refused: null })}
                      className={smallBtn}
                    >
                      改
                    </PixelButton>
                  )}
                </div>
              );
            })
          )}
          {stale && edit && editor(edit.index)}
          {nextLine !== null && (
            <section className="mt-1 flex flex-col gap-2">
              <div className="text-[15px]">下一句這樣說（下一次旁白的第二句，最多 {MAX_EDIT_LINE} 字）</div>
              {nextLine && (
                <div className="flex items-center gap-2 border-4 border-dashed border-[var(--k)] bg-[var(--turn)] p-2 text-[15px]">
                  <span className="flex-1 break-all">已排入：{nextLine}</span>
                  <PixelButton disabled={disabled} onClick={() => send({ type: "HOST_NEXT_LINE", line: "" })} className={smallBtn}>
                    取消
                  </PixelButton>
                </div>
              )}
              <input
                value={nextDraft}
                onChange={(e) => setNextDraft(e.target.value)}
                maxLength={MAX_EDIT_LINE}
                aria-label="下一句這樣說"
                placeholder={nextLine ? "再排一句會蓋掉上面這句" : "例如：不怕死的冒險者不知道珍珠是什麼意思？"}
                className={input}
              />
              <PixelButton onClick={() => send({ type: "HOST_NEXT_LINE", line: nextDraft })} disabled={disabled || !nextDraft.trim()} className="!m-0 !px-4 !py-2 text-[16px]">
                排進去
              </PixelButton>
            </section>
          )}
        </div>
      )}
    </Panel>
  );

  function editor(i: number) {
    const e = edit!;
    const blocked = stale || locked;
    const tooLong = blocked && e.draft.trim().length > MAX_EDIT_LINE;
    return (
      <div key={`edit-${i}`} className="flex flex-col gap-2 p-2" style={{ background: "#fff", boxShadow: "inset 0 0 0 3px var(--k)" }}>
        <div className="flex items-center gap-2 text-[15px]">
          <span>改第 {i + 1} 句（最多 {MAX_LINE} 字）</span>
          {locked && <span className="whitespace-nowrap bg-[var(--dim-line)] px-[6px] text-[12px] text-white">✓ 已念完</span>}
        </div>
        <input
          autoFocus
          value={e.draft}
          maxLength={MAX_LINE}
          aria-label={`第 ${i + 1} 句的新內容`}
          onChange={(ev) => setEdit({ ...e, draft: ev.target.value })}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.nativeEvent.isComposing) submit();
            if (ev.key === "Escape") cancel();
          }}
          className={input}
        />
        <div aria-live="polite" className="text-[14px]" style={{ color: "var(--wrong)" }}>
          {stale
            ? "旁白已換新，沒有送出。可以改排進下一句。"
            : locked
              ? "大螢幕剛念完這句，改不了。可以改排進下一句。"
              : e.refused === "empty_edit"
                ? "不能是空白"
                : e.refused
                  ? "沒有送出，請再試一次"
                  : ""}
          {tooLong && <div>超過 {MAX_EDIT_LINE} 字，請刪短</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PixelButton onClick={cancel} className="!m-0 min-h-[44px] !py-1 text-[15px]">
            取消
          </PixelButton>
          <PixelButton variant="primary" onClick={submit} disabled={disabled || !e.draft.trim() || e.sent || tooLong} className="!m-0 min-h-[44px] !py-1 text-[15px]">
            {blocked ? "改排進下一句" : e.sent ? "送出中…" : "換上大螢幕"}
          </PixelButton>
        </div>
      </div>
    );
  }
}
