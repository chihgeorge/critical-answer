import { describe, expect, it } from "vitest";
import { DEFAULT_AI_LIMIT, MAX_AI_LIMIT } from "@/lib/protocol";
import { limitToSendWithKey } from "@/components/host-ai";

// Value: protects=a restored room keeps its own limit when the host pastes a key before the first status;
// fails_when=the untouched default limit is sent with the key; seam=none; no_claim=the panel's rendering (e2e/ai-key.spec.ts)
describe("limitToSendWithKey", () => {
  it("sends nothing for the untouched default before the room's first status", () => {
    expect(limitToSendWithKey(String(DEFAULT_AI_LIMIT), null)).toBeNull();
  });
  it("sends a limit typed before the first status", () => {
    expect(limitToSendWithKey("7", null)).toBe(7);
  });
  it("sends only a limit that differs from the room's", () => {
    expect(limitToSendWithKey("7", { limit: 7 })).toBeNull();
    expect(limitToSendWithKey(String(DEFAULT_AI_LIMIT), { limit: 7 })).toBe(DEFAULT_AI_LIMIT);
  });
  it("sends nothing for a limit out of range or not a whole number", () => {
    for (const bad of ["0", String(MAX_AI_LIMIT + 1), "2.5", "abc", ""]) expect(limitToSendWithKey(bad, null)).toBeNull();
  });
});
