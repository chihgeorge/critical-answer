import { describe, expect, it } from "vitest";
import { CLOSE_EXPIRED, CLOSE_IDLE, restKindOf } from "./close-codes";

// The socket hook stops reconnecting for any non-null kind: e2e checks the no-retry wait for 4001 only.
describe("restKindOf", () => {
  it("names both on-purpose closes, and nothing else", () => {
    expect(restKindOf({ code: CLOSE_IDLE } as CloseEvent)).toBe("idle");
    expect(restKindOf({ code: CLOSE_EXPIRED } as CloseEvent)).toBe("expired");
    for (const code of [1000, 1006, 4000, 4003]) expect(restKindOf({ code } as CloseEvent)).toBeNull();
  });
});
