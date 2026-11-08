import { describe, expect, it } from "vitest";
import { aiKeyApplied, newKeyId, type AiStatus } from "@/components/host-ai";

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
  it("ids do not repeat", () => {
    expect(new Set(Array.from({ length: 100 }, newKeyId)).size).toBe(100);
  });
});
