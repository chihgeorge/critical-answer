import { describe, it, expect } from "vitest";
import { tokensEqual } from "./tokens";

describe("tokensEqual", () => {
  it("is true only for identical strings", () => {
    expect(tokensEqual("host-token-0123456789abcdef", "host-token-0123456789abcdef")).toBe(true);
    expect(tokensEqual("host-token-0123456789abcdef", "host-token-0123456789abcdeg")).toBe(false);
  });

  it("tells strings of different length apart, including a prefix", () => {
    expect(tokensEqual("abc", "abcd")).toBe(false);
    expect(tokensEqual("abcd", "abc")).toBe(false);
    expect(tokensEqual("", "a")).toBe(false);
    expect(tokensEqual("", "")).toBe(true);
  });

  it("does not confuse a missing character with a NUL character", () => {
    expect(tokensEqual("ab", "ab" + String.fromCharCode(0))).toBe(false);
  });
});
