import { describe, it, expect } from "vitest";
import { parseClientMessage, sanitizeText } from "./protocol";

const TOKEN = "host-token-0123456789abcdef";
const ID = "00000000-0000-0000-0000-000000000001";
const KEY = "team-key-0123456789abcdef";

describe("parseClientMessage", () => {
  it("returns null for non-objects and unknown types", () => {
    for (const v of [null, undefined, 5, "JOIN", [], { type: "NOPE" }, {}]) {
      expect(parseClientMessage(v)).toBeNull();
    }
  });

  it("JOIN: accepts a valid message, rejects missing, wrong-type and oversize fields", () => {
    expect(parseClientMessage({ type: "JOIN", teamId: ID, teamKey: KEY, teamName: "A" })).toEqual({
      type: "JOIN",
      teamId: ID,
      teamKey: KEY,
      teamName: "A",
    });
    expect(parseClientMessage({ type: "JOIN", teamId: ID })).toBeNull();
    expect(parseClientMessage({ type: "JOIN", teamId: 1, teamName: "A" })).toBeNull();
    expect(parseClientMessage({ type: "JOIN", teamId: ID, teamKey: KEY, teamName: "x".repeat(101) })).toBeNull();
  });

  it("JOIN and REJOIN need a team key: 16-128 url-safe characters", () => {
    for (const bad of [undefined, 5, "short", "has space in it 1234567", "a".repeat(129)]) {
      expect(parseClientMessage({ type: "JOIN", teamId: ID, teamKey: bad, teamName: "A" })).toBeNull();
      expect(parseClientMessage({ type: "REJOIN", teamId: ID, teamKey: bad })).toBeNull();
    }
    expect(parseClientMessage({ type: "JOIN", teamId: ID, teamName: "A" })).toBeNull();
  });

  it("REJOIN: accepts a valid message, rejects missing, wrong-type and oversize ids", () => {
    expect(parseClientMessage({ type: "REJOIN", teamId: ID, teamKey: KEY })).toEqual({ type: "REJOIN", teamId: ID, teamKey: KEY });
    expect(parseClientMessage({ type: "REJOIN" })).toBeNull();
    expect(parseClientMessage({ type: "REJOIN", teamId: {} })).toBeNull();
    expect(parseClientMessage({ type: "REJOIN", teamId: "x".repeat(65) })).toBeNull();
  });

  it("HOST_CLAIM: needs a 16-128 char url-safe token", () => {
    expect(parseClientMessage({ type: "HOST_CLAIM", token: TOKEN })).toEqual({ type: "HOST_CLAIM", token: TOKEN });
    expect(parseClientMessage({ type: "HOST_CLAIM" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_CLAIM", token: 12345678901234567 })).toBeNull();
    expect(parseClientMessage({ type: "HOST_CLAIM", token: "short" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_CLAIM", token: "a".repeat(129) })).toBeNull();
    expect(parseClientMessage({ type: "HOST_CLAIM", token: "has space in it 123456" })).toBeNull();
  });

  it("HOST_START: needs only the type", () => {
    expect(parseClientMessage({ type: "HOST_START" })).toEqual({ type: "HOST_START" });
  });

  it("HOST_START: aiNarration is optional and must be a boolean", () => {
    expect(parseClientMessage({ type: "HOST_START", aiNarration: false })).toEqual({ type: "HOST_START", aiNarration: false });
    expect(parseClientMessage({ type: "HOST_START", aiNarration: "yes" })).toBeNull();
  });

  it("HOST_SET_NOTES: a string of at most 500 characters", () => {
    expect(parseClientMessage({ type: "HOST_SET_NOTES", notes: "用武俠口吻" })).toEqual({ type: "HOST_SET_NOTES", notes: "用武俠口吻" });
    expect(parseClientMessage({ type: "HOST_SET_NOTES", notes: "" })).toEqual({ type: "HOST_SET_NOTES", notes: "" });
    expect(parseClientMessage({ type: "HOST_SET_NOTES" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_SET_NOTES", notes: 5 })).toBeNull();
    expect(parseClientMessage({ type: "HOST_SET_NOTES", notes: "字".repeat(501) })).toBeNull();
  });

  it("HOST_EDIT_NARRATION: a string of at most 40 characters", () => {
    expect(parseClientMessage({ type: "HOST_EDIT_NARRATION", line: "改過的一句" })).toEqual({ type: "HOST_EDIT_NARRATION", line: "改過的一句" });
    expect(parseClientMessage({ type: "HOST_EDIT_NARRATION" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_EDIT_NARRATION", line: ["x"] })).toBeNull();
    expect(parseClientMessage({ type: "HOST_EDIT_NARRATION", line: "字".repeat(41) })).toBeNull();
  });

  it("HOST_GET_TRANSCRIPT: needs only the type", () => {
    expect(parseClientMessage({ type: "HOST_GET_TRANSCRIPT" })).toEqual({ type: "HOST_GET_TRANSCRIPT" });
  });

  it("HOST_JUDGE: accepts valid, rejects missing, wrong-type, oversize and bad fleeChoice", () => {
    const ok = { type: "HOST_JUDGE", teamId: ID, questionId: "r0-q1", correct: true };
    expect(parseClientMessage(ok)).toMatchObject(ok);
    expect(parseClientMessage({ ...ok, fleeChoice: "flee" })).toMatchObject({ fleeChoice: "flee" });
    expect(parseClientMessage({ ...ok, teamId: undefined })).toBeNull();
    expect(parseClientMessage({ ...ok, correct: "true" })).toBeNull();
    expect(parseClientMessage({ ...ok, questionId: "q".repeat(65) })).toBeNull();
    expect(parseClientMessage({ ...ok, fleeChoice: "run" })).toBeNull();
  });
});

describe("sanitizeText", () => {
  it("strips HTML-special characters, trims and truncates", () => {
    expect(sanitizeText('  <b>"Hi" & \'x\'</b>  ', 50)).toBe("bHi  x/b");
    expect(sanitizeText("abcdef", 3)).toBe("abc");
    expect(sanitizeText("   ", 5)).toBe("");
  });
});
