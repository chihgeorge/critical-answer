import { describe, it, expect } from "vitest";
import { originAllowed } from "./origin";

describe("originAllowed", () => {
  it("lets a request without an Origin header through: it is not a browser page", () => {
    expect(originAllowed(null, "https://app.example.com")).toBe(true);
    expect(originAllowed(null, "")).toBe(true);
  });

  it("accepts an exact origin and rejects a different one", () => {
    expect(originAllowed("https://app.example.com", "https://app.example.com")).toBe(true);
    expect(originAllowed("https://evil.example", "https://app.example.com")).toBe(false);
  });

  it("does not treat the allowed origin as a prefix", () => {
    expect(originAllowed("https://app.example.com.evil.example", "https://app.example.com")).toBe(false);
    expect(originAllowed("https://app.example.com/", "https://app.example.com")).toBe(false);
  });

  it("rejects every browser origin when nothing is allowed", () => {
    expect(originAllowed("https://app.example.com", "")).toBe(false);
  });

  it("'*' allows any origin (local development)", () => {
    expect(originAllowed("http://10.0.0.61:3100", "*")).toBe(true);
  });

  it("accepts any of several comma-separated rules", () => {
    const rules = "https://a.example, https://b.example";
    expect(originAllowed("https://b.example", rules)).toBe(true);
    expect(originAllowed("https://c.example", rules)).toBe(false);
  });

  describe("wildcard for one hostname label", () => {
    const rule = "https://critical-answer-*.vercel.app";
    it("matches this project's preview URLs", () => {
      expect(originAllowed("https://critical-answer-git-fix-team.vercel.app", rule)).toBe(true);
    });
    it("does not match another project on the same host, another scheme, or extra labels", () => {
      expect(originAllowed("https://evil.vercel.app", rule)).toBe(false);
      expect(originAllowed("http://critical-answer-abc.vercel.app", rule)).toBe(false);
      expect(originAllowed("https://critical-answer-abc.evil.example/.vercel.app", rule)).toBe(false);
      expect(originAllowed("https://critical-answer-a.b.vercel.app", rule)).toBe(false);
    });
  });
});
