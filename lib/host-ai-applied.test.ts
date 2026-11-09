import { describe, expect, it } from "vitest";
import { aiKeyApplied, aiKeyMessage, aiKeyRefused, aiResendMessage, aiSavedKeyDead, newKeyId, type AiStatus } from "@/components/host-ai";

// Value: protects=a refused key (a wrong OWNER_KEY, a refused own key) is never saved to localStorage and resent on
// every HOST_OK; fails_when=the host page reads a status sent for something else (a narration, a reconnect's resend of
// the saved key) as this key applied; seam=none; no_claim=the page's storage calls (app/room/[code]/host/page.tsx)
const status = (s: Partial<AiStatus>): AiStatus => ({
  type: "HOST_AI_STATUS", source: "owner", provider: "anthropic", keyHint: null, keyMissing: false, used: 0, limit: 300, exhausted: false, ...s,
});

describe("aiKeyApplied", () => {
  it("only the status naming this key's id says it is applied", () => {
    expect(aiKeyApplied("b", status({ appliedKeyId: "b" }))).toBe(true);
    // The owner key in use under another id (or none: the saved key resent on reconnect) is not this key.
    expect(aiKeyApplied("b", status({ appliedKeyId: "a" }))).toBe(false);
    expect(aiKeyApplied("b", status({}))).toBe(false);
  });
  it("the id decides, not an error that came later", () => {
    expect(aiKeyApplied("b", status({ appliedKeyId: "b", error: "ai_stopped" }))).toBe(true);
    expect(aiKeyApplied("b", status({ appliedKeyId: "a", error: "wrong_owner_key" }))).toBe(false);
  });
  it("both key messages carry the page's id, and none is invented without one", () => {
    expect(aiKeyMessage({ source: "own", key: "k" }, "id1")).toMatchObject({ source: "own", keyId: "id1" });
    expect(aiKeyMessage({ source: "owner", ownerKey: "o" }, "id2")).toMatchObject({ source: "owner", keyId: "id2" });
    expect(aiKeyMessage({ source: "owner", ownerKey: "o" })).not.toHaveProperty("keyId");
  });
  it("ids do not repeat", () => {
    expect(new Set(Array.from({ length: 100 }, newKeyId)).size).toBe(100);
  });
});

// Value: protects=a reconnect resends the key still pending (not the saved one, which would swap the room back), a refused
// pending key is dropped, and a refused paste never deletes the saved key (TODOS: 重連時主持人頁重送舊 key); fails_when=HOST_OK
// resends the saved key over a pending one, or the page forgets its saved key over a paste's refusal; seam=none;
// no_claim=the page's refs and storage calls (app/room/[code]/host/page.tsx)
describe("reconnect resend", () => {
  const saved = { source: "own" as const, key: "sk-a" };
  const pending = { credential: { source: "own" as const, key: "sk-b" }, keyId: "b" };
  it("resends the pending key with its id, else the saved key without one", () => {
    expect(aiResendMessage(pending, saved)).toMatchObject({ key: "sk-b", keyId: "b" });
    expect(aiResendMessage(null, saved)).toEqual(aiKeyMessage(saved));
    expect(aiResendMessage(null, null)).toBeNull();
  });
  it("only the status naming the pending key's id refuses it", () => {
    expect(aiKeyRefused("b", status({ error: "invalid_key", refusedKeyId: "b" }))).toBe(true);
    expect(aiKeyRefused("b", status({ error: "invalid_key", refusedKeyId: "a" }))).toBe(false);
    expect(aiKeyRefused("b", status({ error: "invalid_key" }))).toBe(false);
  });
  it("the saved key is dead only when the room dropped its own key, not when a paste is refused", () => {
    const dropped = status({ source: "own", keyMissing: true, error: "invalid_key" });
    expect(aiSavedKeyDead(dropped)).toBe(true);
    expect(aiSavedKeyDead({ ...dropped, refusedKeyId: "b" })).toBe(false);
    expect(aiSavedKeyDead({ ...dropped, source: "owner" })).toBe(false);
    expect(aiSavedKeyDead({ ...dropped, keyMissing: false })).toBe(false);
  });
});
