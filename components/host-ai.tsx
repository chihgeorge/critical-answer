"use client";

// The host page's AI narration settings: who pays, the key, and the call budget (designs/ai-key-20261030).

import { useState } from "react";
import { DEFAULT_AI_LIMIT, MAX_AI_LIMIT, type AiKeyError, type ClientMessage, type ServerMessage } from "@/lib/protocol";
import { readStored } from "@/lib/stored";
import { Panel, PixelButton } from "@/components/pixel";

export type AiStatus = Extract<ServerMessage, { type: "HOST_AI_STATUS" }>;

/**
 * The limit field's value to send with a new key, or null: a new limit typed before the key goes with it. Before the
 * room's first status the field still holds the default, so nothing is sent: that would reset a restored room's own limit.
 */
export function limitToSendWithKey(limit: string, status: Pick<AiStatus, "limit"> | null): number | null {
  const n = Number(limit);
  const ok = Number.isInteger(n) && n >= 1 && n <= MAX_AI_LIMIT;
  return ok && n !== (status?.limit ?? DEFAULT_AI_LIMIT) ? n : null;
}
/** What the host typed, kept in this page (and, with 記住這台電腦, in localStorage) to resend after a room restart. */
export type AiCredential = { source: "own"; key: string } | { source: "owner"; ownerKey: string };

/** Whether this status shows the key sent with `keyId` in use. Nothing else in a status tells: with the owner key in
 * use a wrong OWNER_KEY still reads source "owner", and an own key can share the hint of the key in use. */
export const aiKeyApplied = (keyId: string, msg: AiStatus): boolean => !msg.error && msg.appliedKeyId === keyId;
/** Unique across page loads too: the room keeps the last applied id, so a reloaded page must not reuse it. */
export const newKeyId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const AI_STORE = { own: "ai-key:own", owner: "ai-key:owner" } as const;
export const AI_ERRORS: Record<AiKeyError, string> = {
  invalid_key: "這把 key 無效（格式不對，或 Anthropic 拒絕了它）",
  wrong_owner_key: "站長金鑰不符",
  owner_unavailable: "這個伺服器沒有開放站長金鑰",
  check_failed: "暫時無法驗證這把 key，請再試一次",
  ai_stopped: "AI 旁白已暫停：連續失敗。檢查 Anthropic Console 的餘額後，重新貼一次 key",
};
export const aiKeyMessage = (c: AiCredential, keyId?: string): ClientMessage =>
  c.source === "own"
    ? { type: "HOST_AI_KEY", source: "own", provider: "anthropic", key: c.key, ...(keyId ? { keyId } : {}) }
    : { type: "HOST_AI_KEY", source: "owner", ownerKey: c.ownerKey, ...(keyId ? { keyId } : {}) };

export function readSavedAiKey(): AiCredential | null {
  const key = readStored(AI_STORE.own);
  if (key) return { source: "own", key };
  const ownerKey = readStored(AI_STORE.owner);
  return ownerKey ? { source: "owner", ownerKey } : null;
}

/** Who pays for AI narration: none, the host's own Anthropic key, or the owner's key (layout A, designs/ai-key-20261030). */
export function AiPanel({
  status,
  remembered,
  onUse,
  onForget,
  send,
}: {
  status: AiStatus | null;
  /** A key from localStorage was found when the page opened. */
  remembered: boolean;
  onUse: (c: AiCredential, remember: boolean) => void;
  onForget: () => void;
  send: (msg: ClientMessage) => void;
}) {
  const [choice, setChoice] = useState<"none" | "own" | "owner">("none");
  const [key, setKey] = useState("");
  const [ownerKey, setOwnerKey] = useState("");
  const [remember, setRemember] = useState(remembered);
  const [limit, setLimit] = useState(String(DEFAULT_AI_LIMIT));
  const source = status?.source ?? "none";
  const serverLimit = status?.limit;
  // Follow the room (after a restart, or on a second host device) and the stored key, when either changes.
  const [seen, setSeen] = useState({ source, remembered, serverLimit });
  if (seen.source !== source || seen.remembered !== remembered || seen.serverLimit !== serverLimit) {
    setSeen({ source, remembered, serverLimit });
    if (source !== seen.source && source !== "none") setChoice(source);
    if (remembered !== seen.remembered) setRemember(remembered);
    if (serverLimit !== seen.serverLimit && serverLimit !== undefined) setLimit(String(serverLimit));
  }
  const limitN = Number(limit);
  const limitOk = Number.isInteger(limitN) && limitN >= 1 && limitN <= MAX_AI_LIMIT;
  const active = status && status.source === choice && choice !== "none";
  const radio = (value: typeof choice, label: string) => (
    <label className="flex items-center gap-3 text-[16px]">
      <input
        type="radio"
        name="ai-source"
        className="h-5 w-5"
        checked={choice === value}
        onChange={() => {
          setChoice(value);
          if (value === "none" && source !== "none") onForget();
        }}
      />
      {label}
    </label>
  );
  const limitRow = (
    <div className="flex items-center gap-2 text-[13px]">
      上限
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_AI_LIMIT}
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        className="w-[90px] border-4 border-[var(--k)] bg-white px-2 py-1 text-[16px]"
      />
      次（1–{MAX_AI_LIMIT}）
      {active && limitOk && limitN !== status.limit && (
        <PixelButton onClick={() => send({ type: "HOST_AI_LIMIT", limit: limitN })} className="!m-0 !px-3 !py-1 text-[14px]">
          設定
        </PixelButton>
      )}
    </div>
  );
  const rememberRow = (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="h-5 w-5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
      記住這台電腦（存在這個瀏覽器）
    </label>
  );
  const after = (c: AiCredential) => {
    // The limit goes before the key, so the key's status (with any error) is the last one the panel gets.
    const withKey = limitToSendWithKey(limit, status);
    if (withKey !== null) send({ type: "HOST_AI_LIMIT", limit: withKey });
    onUse(c, remember);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[16px]">AI 旁白</div>
      {radio("none", "不用 AI（腳本旁白，免費）")}
      {radio("own", "用我自己的 Anthropic API key")}
      {choice === "own" && (
        <div className="ml-8 flex flex-col gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value.trim())}
            autoComplete="off"
            placeholder={active && status.keyHint ? `已設定 ${status.keyHint}，要換再貼一把` : "sk-ant-…"}
            aria-label="Anthropic API key"
            className="min-w-0 border-4 border-[var(--k)] bg-white px-2 py-1 text-[16px]"
          />
          {rememberRow}
          {limitRow}
          <div className="flex items-center gap-2">
            <PixelButton disabled={!key} onClick={() => after({ source: "own", key })} className="!m-0 !px-4 !py-2 text-[16px]">
              驗證並使用
            </PixelButton>
            {active && (
              <PixelButton
                onClick={() => {
                  setKey("");
                  onForget();
                }}
                className="!m-0 !px-3 !py-2 text-[14px]"
                style={{ background: "var(--cream)" }}
              >
                忘掉 key
              </PixelButton>
            )}
          </div>
        </div>
      )}
      {radio("owner", "站長金鑰")}
      {choice === "owner" && (
        <div className="ml-8 flex flex-col gap-2">
          <input
            type="password"
            value={ownerKey}
            onChange={(e) => setOwnerKey(e.target.value.trim())}
            autoComplete="off"
            placeholder={active ? "已使用站長金鑰" : "OWNER_KEY"}
            aria-label="站長金鑰（OWNER_KEY）"
            className="min-w-0 border-4 border-[var(--k)] bg-white px-2 py-1 text-[16px]"
          />
          {rememberRow}
          {limitRow}
          <PixelButton disabled={!ownerKey} onClick={() => after({ source: "owner", ownerKey })} className="!m-0 !px-4 !py-2 text-[16px]">
            使用站長金鑰
          </PixelButton>
        </div>
      )}
      {status && status.source !== "none" && (
        <div className="text-[13px]" style={{ color: status.keyMissing ? "#b23a3a" : "#2f6a2c" }} role="status">
          {status.keyMissing
            ? "房間重新啟動過，請再貼一次 key"
            : `✓ ${status.source === "own" ? `Anthropic ${status.keyHint ?? ""}` : "站長金鑰"}・已用 ${status.used} / ${status.limit}`}
        </div>
      )}
      {status?.error && (
        <div className="text-[13px]" style={{ color: "#b23a3a" }} role="alert">
          ✕ {AI_ERRORS[status.error]}
        </div>
      )}
      <div className="border-2 border-dashed border-[var(--lav2)] bg-white/50 px-2 py-1 text-[13px]">
        建議到 Anthropic Console 開一把這個遊戲專用的 key，並設好每月花費上限。key 只放在房間的記憶體裡，不會存檔，也不會傳回任何畫面。
      </div>
    </div>
  );
}

/** In-game, host only: the budget ran out. Players and the TV see nothing (their lines just turn scripted). */
export function AiExhausted({ status, send, onDismiss }: { status: AiStatus; send: (msg: ClientMessage) => void; onDismiss: () => void }) {
  const [limit, setLimit] = useState(String(Math.min(status.limit * 2, MAX_AI_LIMIT)));
  const n = Number(limit);
  const ok = Number.isInteger(n) && n > status.used && n <= MAX_AI_LIMIT;
  return (
    <Panel tone="turn" role="status" className="flex flex-col gap-2 px-3 py-2">
      <div className="text-[18px]">{`AI 旁白額度用完（已用 ${status.used} / ${status.limit}）`}</div>
      <div className="text-[13px]">接下來改用腳本旁白，遊戲照常進行。要繼續用 AI，設一個新上限：</div>
      <div className="flex items-center gap-2 text-[13px]">
        新上限
        <input
          type="number"
          inputMode="numeric"
          min={status.used + 1}
          max={MAX_AI_LIMIT}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-[100px] border-4 border-[var(--k)] bg-white px-2 py-1 text-[16px]"
        />
        次
      </div>
      <div className="flex items-center gap-2">
        <PixelButton disabled={!ok} onClick={() => send({ type: "HOST_AI_LIMIT", limit: n })} className="!m-0 !px-4 !py-2 text-[16px]">
          繼續用 AI
        </PixelButton>
        <PixelButton onClick={onDismiss} className="!m-0 !px-4 !py-2 text-[16px]" style={{ background: "var(--cream)" }}>
          不用了
        </PixelButton>
      </div>
    </Panel>
  );
}
