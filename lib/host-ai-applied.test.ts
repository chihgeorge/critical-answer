import { describe, expect, it } from "vitest";
import { aiKeyApplied, type AiStatus } from "@/components/host-ai";

// Value: protects=a refused OWNER_KEY is never saved to localStorage and resent on every HOST_OK; fails_when=the host
// page reads source "owner" with no key missing as applied, ignoring the status's error; seam=none; no_claim=the page's
// storage calls (app/room/[code]/host/page.tsx)
const status = (s: Partial<AiStatus>): AiStatus => ({
  type: "HOST_AI_STATUS", source: "none", provider: null, keyHint: null, keyMissing: false, used: 0, limit: 300, exhausted: false, ...s,
});

describe("aiKeyApplied", () => {
  it("an owner key is applied when the room uses the owner key with no error", () => {
    expect(aiKeyApplied({ source: "owner", ownerKey: "k" }, status({ source: "owner", provider: "anthropic" }))).toBe(true);
  });
  it("a wrong owner key is not applied, even with the owner key already in use", () => {
    expect(aiKeyApplied({ source: "owner", ownerKey: "guess" }, status({ source: "owner", provider: "anthropic", error: "wrong_owner_key" }))).toBe(false);
  });
  it("an own key is applied by its hint, and not with an error", () => {
    const c = { source: "own", key: "sk-ant-test-WXYZ" } as const;
    expect(aiKeyApplied(c, status({ source: "own", keyHint: "…WXYZ" }))).toBe(true);
    expect(aiKeyApplied(c, status({ source: "own", keyHint: "…WXYZ", error: "invalid_key" }))).toBe(false);
    expect(aiKeyApplied(c, status({ source: "own", keyHint: "…QRST" }))).toBe(false);
  });
});
