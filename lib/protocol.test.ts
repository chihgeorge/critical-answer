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
    // An over-long password is cut, not a reason to drop the JOIN (a known team needs none to rejoin).
    expect(parseClientMessage({ type: "JOIN", teamId: ID, teamKey: KEY, teamName: "A", password: "p".repeat(500) })).toMatchObject({ password: "p".repeat(32) });
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

  it("HOST_SEND_TO_BOSS: needs a team id", () => {
    expect(parseClientMessage({ type: "HOST_SEND_TO_BOSS", teamId: "t1" })).toEqual({ type: "HOST_SEND_TO_BOSS", teamId: "t1" });
    expect(parseClientMessage({ type: "HOST_SEND_TO_BOSS" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_SEND_TO_BOSS", teamId: 3 })).toBeNull();
  });

  it("HOST_NEXT: needs a non-negative integer eventId", () => {
    expect(parseClientMessage({ type: "HOST_NEXT", eventId: 3, extra: "ignored" })).toEqual({ type: "HOST_NEXT", eventId: 3 });
    expect(parseClientMessage({ type: "HOST_NEXT" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_NEXT", eventId: "3" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_NEXT", eventId: -1 })).toBeNull();
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

  it("TEAM_BRANCH_CHOICE: accepts valid, rejects non-integer roomIndex and unknown choice ids", () => {
    const ok = { type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight" };
    expect(parseClientMessage(ok)).toEqual(ok);
    expect(parseClientMessage({ ...ok, choice: "negotiate" })).toEqual({ ...ok, choice: "negotiate" });
    expect(parseClientMessage({ ...ok, roomIndex: 1.5 })).toBeNull();
    expect(parseClientMessage({ ...ok, roomIndex: "1" })).toBeNull();
    expect(parseClientMessage({ ...ok, choice: "flee" })).toBeNull();
    expect(parseClientMessage({ ...ok, choice: undefined })).toBeNull();
    // Deliberately no teamId/teamKey field: the sender's team is derived from
    // the connection's own connTeam binding, never from client-supplied data.
    expect(parseClientMessage({ type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight", teamId: ID })).toEqual(ok);
  });

  it("TEAM_SELECT_OPTION: accepts valid, rejects non-integer/negative optionIndex and bad questionId", () => {
    const ok = { type: "TEAM_SELECT_OPTION", questionId: "r0-q1", optionIndex: 1 };
    expect(parseClientMessage(ok)).toEqual(ok);
    expect(parseClientMessage({ ...ok, optionIndex: 0 })).toEqual({ ...ok, optionIndex: 0 });
    expect(parseClientMessage({ ...ok, optionIndex: -1 })).toBeNull();
    expect(parseClientMessage({ ...ok, optionIndex: 1.5 })).toBeNull();
    expect(parseClientMessage({ ...ok, optionIndex: "1" })).toBeNull();
    expect(parseClientMessage({ ...ok, questionId: undefined })).toBeNull();
    expect(parseClientMessage({ ...ok, questionId: "q".repeat(65) })).toBeNull();
    // Deliberately no teamId/teamKey field — same connTeam-derived trust as TEAM_BRANCH_CHOICE.
    expect(parseClientMessage({ type: "TEAM_SELECT_OPTION", questionId: "r0-q1", optionIndex: 1, teamId: ID })).toEqual(ok);
  });

  it("TEAM_LOCK_OPTION carries the question id and, optionally, the index the phone showed (phone-answering.md E11)", () => {
    expect(parseClientMessage({ type: "TEAM_LOCK_OPTION", questionId: "r0-q1", optionIndex: 3 })).toEqual({ type: "TEAM_LOCK_OPTION", questionId: "r0-q1", optionIndex: 3 });
    expect(parseClientMessage({ type: "TEAM_LOCK_OPTION", questionId: "r0-q1" })).toEqual({ type: "TEAM_LOCK_OPTION", questionId: "r0-q1" });
    expect(parseClientMessage({ type: "TEAM_LOCK_OPTION", questionId: "r0-q1", optionIndex: -1 })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_LOCK_OPTION" })).toBeNull();
  });

  it("TEAM_WRONG_CHOICE accepts only retry or flee", () => {
    const ok = { type: "TEAM_WRONG_CHOICE", questionId: "r0-q1", choice: "flee" };
    expect(parseClientMessage(ok)).toEqual(ok);
    expect(parseClientMessage({ ...ok, choice: "retry" })).toEqual({ ...ok, choice: "retry" });
    expect(parseClientMessage({ ...ok, choice: "correct" })).toBeNull();
    expect(parseClientMessage({ ...ok, questionId: 1 })).toBeNull();
  });
});

describe("sanitizeText", () => {
  it("strips HTML-special characters, trims and truncates", () => {
    expect(sanitizeText('  <b>"Hi" & \'x\'</b>  ', 50)).toBe("bHi  x/b");
    expect(sanitizeText("abcdef", 3)).toBe("abc");
    expect(sanitizeText("   ", 5)).toBe("");
  });
});

describe("parseClientMessage: resume flag on re-identification", () => {
  it("keeps resume: true on HOST_CLAIM, JOIN and REJOIN, and drops anything that isn't literally true", () => {
    const token = "host-token-0123456789abcdef";
    const teamKey = "team-key-0123456789abcdef";
    expect(parseClientMessage({ type: "HOST_CLAIM", token, resume: true })).toEqual({ type: "HOST_CLAIM", token, resume: true });
    expect(parseClientMessage({ type: "HOST_CLAIM", token, resume: "yes" })).toEqual({ type: "HOST_CLAIM", token });
    expect(parseClientMessage({ type: "JOIN", teamId: "t1", teamKey, teamName: "甲", resume: true })).toMatchObject({ resume: true });
    expect(parseClientMessage({ type: "REJOIN", teamId: "t1", teamKey, resume: true })).toMatchObject({ resume: true });
    expect(parseClientMessage({ type: "JOIN", teamId: "t1", teamKey, teamName: "甲" })).not.toHaveProperty("resume");
  });
});
