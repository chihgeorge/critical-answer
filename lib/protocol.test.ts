import { describe, it, expect } from "vitest";
import { cleanTypedAnswer, MAX_RAW_TEXT, parseClientMessage, sanitizeText } from "./protocol";
import { MAX_LINE } from "./narration/runner";

const TOKEN = "host-token-0123456789abcdef";
const ID = "00000000-0000-0000-0000-000000000001";
const KEY = "team-key-0123456789abcdef";

describe("parseClientMessage", () => {
  it("HOST_UNDO_WRONG needs a team, a question and the eventId it was pressed under", () => {
    expect(parseClientMessage({ type: "HOST_UNDO_WRONG", teamId: ID, questionId: "q1", eventId: 3 })).toEqual({ type: "HOST_UNDO_WRONG", teamId: ID, questionId: "q1", eventId: 3 });
    expect(parseClientMessage({ type: "HOST_UNDO_WRONG", teamId: ID, questionId: "q1" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_UNDO_WRONG", teamId: ID, questionId: "q1", eventId: -1 })).toBeNull();
    expect(parseClientMessage({ type: "HOST_UNDO_WRONG", questionId: "q1", eventId: 3 })).toBeNull();
  });

  it("TEAM_BUZZ and HOST_BUZZ_SKIP need the question they were pressed for", () => {
    expect(parseClientMessage({ type: "TEAM_BUZZ", questionId: "q1", extra: 1 })).toEqual({ type: "TEAM_BUZZ", questionId: "q1" });
    expect(parseClientMessage({ type: "HOST_BUZZ_SKIP", questionId: "q1" })).toEqual({ type: "HOST_BUZZ_SKIP", questionId: "q1" });
    expect(parseClientMessage({ type: "TEAM_BUZZ" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_BUZZ_SKIP", questionId: 5 })).toBeNull();
  });

  it("HOST_BUZZ_OPEN, SCREEN_CLIP_ERROR and TEAM_PICK_CATEGORY (boss-music-buzzer.md)", () => {
    expect(parseClientMessage({ type: "HOST_BUZZ_OPEN", questionId: "q1" })).toEqual({ type: "HOST_BUZZ_OPEN", questionId: "q1" });
    expect(parseClientMessage({ type: "SCREEN_CLIP_ERROR", questionId: "q1" })).toEqual({ type: "SCREEN_CLIP_ERROR", questionId: "q1" });
    expect(parseClientMessage({ type: "SCREEN_CLIP_ERROR" })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_PICK_CATEGORY", category: "動漫" })).toEqual({ type: "TEAM_PICK_CATEGORY", category: "動漫" });
    expect(parseClientMessage({ type: "TEAM_PICK_CATEGORY", category: "" })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_PICK_CATEGORY", category: "x".repeat(65) })).toBeNull();
  });

  it("HOST_JUDGE and TEAM_SUBMIT_TEXT carry a music question's fields (multi-field.md)", () => {
    const judge = { type: "HOST_JUDGE", teamId: "t", questionId: "q1", correct: true };
    expect(parseClientMessage({ ...judge, fields: [true, false] })).toEqual({ ...judge, fleeChoice: undefined, fields: [true, false] });
    expect(parseClientMessage({ ...judge, correct: false, fields: [false, false] })).toMatchObject({ correct: false, fields: [false, false] });
    // `correct` must say whether any field is right.
    expect(parseClientMessage({ ...judge, fields: [false, false] })).toBeNull();
    expect(parseClientMessage({ ...judge, correct: false, fields: [true, false] })).toBeNull();
    expect(parseClientMessage({ ...judge, fields: [] })).toBeNull();
    expect(parseClientMessage({ ...judge, fields: [true, true, true, true] })).toBeNull();
    expect(parseClientMessage({ ...judge, fields: ["yes", true] })).toBeNull();
    const submit = { type: "TEAM_SUBMIT_TEXT", questionId: "q1", text: "" };
    expect(parseClientMessage({ ...submit, fields: ["晴天", ""] })).toEqual({ ...submit, fields: ["晴天", ""] });
    expect(parseClientMessage({ ...submit, fields: ["a", "b", "c", "d"] })).toBeNull();
    expect(parseClientMessage({ ...submit, fields: ["a", 1] })).toBeNull();
    expect(parseClientMessage({ ...submit, fields: ["x".repeat(201)] })).toBeNull();
  });

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
    // A colon team id parses: the room refuses it as not a UUID (invalid_team_id), so the phone says why.
    expect(parseClientMessage({ type: "JOIN", teamId: "x:T", teamKey: KEY, teamName: "A" })).toMatchObject({ teamId: "x:T" });
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

  it("HOST_AI_KEY: own needs a known provider and a key; owner needs an owner key; none needs nothing", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
    expect(parseClientMessage({ type: "HOST_AI_KEY", source: "own", provider: "anthropic", key })).toEqual({ type: "HOST_AI_KEY", source: "own", provider: "anthropic", key });
    expect(parseClientMessage({ type: "HOST_AI_KEY", source: "owner", ownerKey: "x" })).toEqual({ type: "HOST_AI_KEY", source: "owner", ownerKey: "x" });
    expect(parseClientMessage({ type: "HOST_AI_KEY", source: "none", key })).toEqual({ type: "HOST_AI_KEY", source: "none" });
    expect(parseClientMessage({ type: "HOST_AI_KEY", source: "owner", ownerKey: "x", keyId: "k1" })).toEqual({ type: "HOST_AI_KEY", source: "owner", ownerKey: "x", keyId: "k1" });
    // A key in the wrong format still parses: the room answers it with invalid_key, not bad_message.
    expect(parseClientMessage({ type: "HOST_AI_KEY", source: "own", provider: "anthropic", key: "oops" })).not.toBeNull();
    for (const bad of [
      { source: "own", provider: "openai", key },
      { source: "own", provider: "anthropic" },
      { source: "own", provider: "anthropic", key: "" },
      { source: "own", provider: "anthropic", key: "k".repeat(257) },
      { source: "owner", ownerKey: "" },
      { source: "owner", ownerKey: "x", keyId: 1 },
      { source: "owner", ownerKey: "x", keyId: "" },
      { source: "own", provider: "anthropic", key, keyId: "i".repeat(65) },
      { source: "everyone" },
    ]) expect(parseClientMessage({ type: "HOST_AI_KEY", ...bad })).toBeNull();
  });

  it("HOST_AI_LIMIT: a whole number from 1 to 5000", () => {
    expect(parseClientMessage({ type: "HOST_AI_LIMIT", limit: 1 })).toEqual({ type: "HOST_AI_LIMIT", limit: 1 });
    expect(parseClientMessage({ type: "HOST_AI_LIMIT", limit: 5000 })).toEqual({ type: "HOST_AI_LIMIT", limit: 5000 });
    for (const limit of [0, 5001, 1.5, "300", null]) expect(parseClientMessage({ type: "HOST_AI_LIMIT", limit })).toBeNull();
  });

  it("HOST_START: aiNarration is optional and must be a boolean", () => {
    expect(parseClientMessage({ type: "HOST_START", aiNarration: false })).toEqual({ type: "HOST_START", aiNarration: false });
    expect(parseClientMessage({ type: "HOST_START", aiNarration: "yes" })).toBeNull();
  });

  it("HOST_START: initiative is optional and must be a boolean; false is the same as missing", () => {
    expect(parseClientMessage({ type: "HOST_START", initiative: true })).toEqual({ type: "HOST_START", initiative: true });
    expect(parseClientMessage({ type: "HOST_START", initiative: false })).toEqual({ type: "HOST_START" });
    expect(parseClientMessage({ type: "HOST_START", initiative: 1 })).toBeNull();
  });

  it("TEAM_ROLL_INITIATIVE and HOST_ROLL_INITIATIVE carry nothing else", () => {
    expect(parseClientMessage({ type: "TEAM_ROLL_INITIATIVE", value: 20 })).toEqual({ type: "TEAM_ROLL_INITIATIVE" });
    expect(parseClientMessage({ type: "HOST_ROLL_INITIATIVE" })).toEqual({ type: "HOST_ROLL_INITIATIVE" });
  });

  it("HOST_PACING takes auto or manual; HOST_STEP needs both ids as non-negative integers (manual-pacing.md)", () => {
    expect(parseClientMessage({ type: "HOST_PACING", mode: "manual", extra: 1 })).toEqual({ type: "HOST_PACING", mode: "manual" });
    expect(parseClientMessage({ type: "HOST_PACING", mode: "auto" })).toEqual({ type: "HOST_PACING", mode: "auto" });
    expect(parseClientMessage({ type: "HOST_PACING", mode: "fast" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_STEP", eventId: 3, step: 7 })).toEqual({ type: "HOST_STEP", eventId: 3, step: 7 });
    for (const bad of [{ eventId: 3 }, { step: 7 }, { eventId: -1, step: 7 }, { eventId: 3, step: 1.5 }, { eventId: "3", step: 7 }]) expect(parseClientMessage({ type: "HOST_STEP", ...bad })).toBeNull();
  });

  it("HOST_START: intro is optional and must be a boolean; false is the same as missing", () => {
    expect(parseClientMessage({ type: "HOST_START", intro: true })).toEqual({ type: "HOST_START", intro: true });
    expect(parseClientMessage({ type: "HOST_START", intro: false })).toEqual({ type: "HOST_START" });
    expect(parseClientMessage({ type: "HOST_START", intro: "yes" })).toBeNull();
  });

  it("HOST_INTRO: a whole page from 1 to 5 (5 ends the intro)", () => {
    expect(parseClientMessage({ type: "HOST_INTRO", page: 1 })).toEqual({ type: "HOST_INTRO", page: 1 });
    expect(parseClientMessage({ type: "HOST_INTRO", page: 5 })).toEqual({ type: "HOST_INTRO", page: 5 });
    for (const page of [0, 6, 2.5, "2", undefined]) expect(parseClientMessage({ type: "HOST_INTRO", page }), String(page)).toBeNull();
  });

  it("HOST_EPILOGUE_PAGE: a whole page from 0", () => {
    expect(parseClientMessage({ type: "HOST_EPILOGUE_PAGE", page: 0 })).toEqual({ type: "HOST_EPILOGUE_PAGE", page: 0 });
    for (const page of [-1, 1.5, "1", undefined]) expect(parseClientMessage({ type: "HOST_EPILOGUE_PAGE", page }), String(page)).toBeNull();
  });

  // Guards the removal of the director notes (host-narration-edit.md): fails if HOST_SET_NOTES parses again.
  it("HOST_SET_NOTES is gone", () => {
    expect(parseClientMessage({ type: "HOST_SET_NOTES", notes: "用武俠口吻" })).toBeNull();
  });

  // Guards the edit message's shape (D9, D18): fails if the eventId, rev or line index stops being required, if a
  // negative or fractional one gets through, or if a prefilled line over MAX_LINE stops parsing (the room cuts it).
  it("HOST_EDIT_NARRATION: an eventId, a rev, a line index and a line of at most MAX_LINE characters", () => {
    const ok = { type: "HOST_EDIT_NARRATION", eventId: 4, rev: 1, index: 2, line: "改過的一句" };
    expect(parseClientMessage(ok)).toEqual(ok);
    expect(parseClientMessage({ ...ok, line: "字".repeat(MAX_LINE) })).toEqual({ ...ok, line: "字".repeat(MAX_LINE) });
    // A scripted line can run past MAX_LINE; its prefilled edit must parse, and the room cuts it (red-team).
    expect(parseClientMessage({ ...ok, line: "字".repeat(MAX_LINE + 1) })).toEqual({ ...ok, line: "字".repeat(MAX_LINE + 1) });
    expect(parseClientMessage({ ...ok, line: "字".repeat(MAX_RAW_TEXT + 1) })).toBeNull();
    expect(parseClientMessage({ type: "HOST_EDIT_NARRATION", line: "改過的一句" })).toBeNull(); // the old shape
    for (const bad of [{ eventId: -1 }, { eventId: 1.5 }, { eventId: "4" }, { index: -1 }, { index: undefined }, { rev: undefined }, { rev: -1 }, { line: ["x"] }]) {
      expect(parseClientMessage({ ...ok, ...bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  // Guards the big screen's progress report (D3, D14): fails if any of its three counts may be missing, negative or fractional.
  it("SCREEN_HELLO: carries at most the screen key, extra fields are dropped", () => {
    expect(parseClientMessage({ type: "SCREEN_HELLO" })).toEqual({ type: "SCREEN_HELLO" });
    expect(parseClientMessage({ type: "SCREEN_HELLO", teamId: "x" })).toEqual({ type: "SCREEN_HELLO" });
  });

  // Guards the screen key's size (screen-video-key.md): fails if a key of any length or type reaches the room's compare.
  it("SCREEN_HELLO: keeps a string key of at most 64 characters, drops any other", () => {
    expect(parseClientMessage({ type: "SCREEN_HELLO", key: "k".repeat(64) })).toEqual({ type: "SCREEN_HELLO", key: "k".repeat(64) });
    expect(parseClientMessage({ type: "SCREEN_HELLO", key: "" })).toEqual({ type: "SCREEN_HELLO", key: "" });
    for (const key of ["k".repeat(65), 7, null, { length: 1 }, ["a"]]) expect(parseClientMessage({ type: "SCREEN_HELLO", key })).toEqual({ type: "SCREEN_HELLO" });
  });

  it("SCREEN_NARRATION_PROGRESS: whole, non-negative eventId, rev and done", () => {
    const ok = { type: "SCREEN_NARRATION_PROGRESS", eventId: 3, rev: 0, done: 2 };
    expect(parseClientMessage(ok)).toEqual(ok);
    for (const key of ["eventId", "rev", "done"]) {
      for (const v of [undefined, -1, 0.5, "1"]) expect(parseClientMessage({ ...ok, [key]: v }), `${key}=${v}`).toBeNull();
    }
  });

  it("HOST_SERVE: needs a non-negative integer eventId, like HOST_NEXT", () => {
    expect(parseClientMessage({ type: "HOST_SERVE", eventId: 3 })).toEqual({ type: "HOST_SERVE", eventId: 3 });
    expect(parseClientMessage({ type: "HOST_SERVE" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_SERVE", eventId: "3" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_SERVE", eventId: -1 })).toBeNull();
  });

  it("HOST_NEXT_LINE: a string of at most 40 characters, \"\" to cancel", () => {
    expect(parseClientMessage({ type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" })).toEqual({ type: "HOST_NEXT_LINE", line: "珍珠能吃嗎" });
    expect(parseClientMessage({ type: "HOST_NEXT_LINE", line: "" })).toEqual({ type: "HOST_NEXT_LINE", line: "" });
    expect(parseClientMessage({ type: "HOST_NEXT_LINE" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_NEXT_LINE", line: "字".repeat(41) })).toBeNull();
    expect(parseClientMessage({ type: "HOST_NEXT_LINE", line: "", eventId: 7 })).toEqual({ type: "HOST_NEXT_LINE", line: "", eventId: 7 });
    expect(parseClientMessage({ type: "HOST_NEXT_LINE", line: "", eventId: -1 })).toBeNull();
  });

  it("HOST_QUEUE_QUESTION: a target and a question id, or null to clear", () => {
    expect(parseClientMessage({ type: "HOST_QUEUE_QUESTION", target: "t1", questionId: "q1" })).toEqual({ type: "HOST_QUEUE_QUESTION", target: "t1", questionId: "q1" });
    expect(parseClientMessage({ type: "HOST_QUEUE_QUESTION", target: "boss", questionId: null })).toEqual({ type: "HOST_QUEUE_QUESTION", target: "boss", questionId: null });
    expect(parseClientMessage({ type: "HOST_QUEUE_QUESTION", target: "t1" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_QUEUE_QUESTION", target: "t1", questionId: 3 })).toBeNull();
    expect(parseClientMessage({ type: "HOST_QUEUE_QUESTION", questionId: "q1" })).toBeNull();
  });

  it("HOST_SEND_TO_BOSS: needs a team id", () => {
    expect(parseClientMessage({ type: "HOST_SEND_TO_BOSS", teamId: "t1" })).toEqual({ type: "HOST_SEND_TO_BOSS", teamId: "t1" });
    expect(parseClientMessage({ type: "HOST_SEND_TO_BOSS" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_SEND_TO_BOSS", teamId: 3 })).toBeNull();
  });

  it("HOST_JUDGE: eventId is optional, but must be a non-negative integer when sent", () => {
    const base = { type: "HOST_JUDGE", teamId: "t", questionId: "q", correct: true };
    expect(parseClientMessage({ ...base, eventId: 4 })).toMatchObject({ eventId: 4 });
    expect(parseClientMessage(base)).not.toHaveProperty("eventId");
    for (const eventId of [-1, 1.5, "4", null]) expect(parseClientMessage({ ...base, eventId })).toBeNull();
  });

  it("HOST_NEXT: needs a non-negative integer eventId", () => {
    expect(parseClientMessage({ type: "HOST_NEXT", eventId: 3, extra: "ignored" })).toEqual({ type: "HOST_NEXT", eventId: 3 });
    expect(parseClientMessage({ type: "HOST_NEXT" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_NEXT", eventId: "3" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_NEXT", eventId: -1 })).toBeNull();
  });

  it("HOST_EXTEND_ROOM: needs only the type, and carries nothing else into the room", () => {
    expect(parseClientMessage({ type: "HOST_EXTEND_ROOM", ms: 99 * 3600_000 })).toEqual({ type: "HOST_EXTEND_ROOM" });
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
    // #106: a cleric's fill-in wait and the host's 祈禱, only on a wrong judgment.
    expect(parseClientMessage({ ...ok, correct: false, fleeChoice: "team" })).toMatchObject({ fleeChoice: "team" });
    expect(parseClientMessage({ ...ok, correct: false, fleeChoice: "pray" })).toMatchObject({ fleeChoice: "pray" });
    expect(parseClientMessage({ ...ok, fleeChoice: "team" })).toBeNull();
    expect(parseClientMessage({ ...ok, fleeChoice: "pray" })).toBeNull();
  });

  it("TEAM_BRANCH_CHOICE is no longer a message (the branch choice was removed, TODOS.md)", () => {
    expect(parseClientMessage({ type: "TEAM_BRANCH_CHOICE", roomIndex: 1, choice: "fight" })).toBeNull();
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
    // Deliberately no teamId/teamKey field — the sender's team comes from the connection's connTeam binding.
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

  // Value: protects=the room only sees a 4-digit claim code; fails_when=the parser lets other shapes through; why_new=new message; seam=none
  it("TEAM_CLAIM takes exactly 4 digits; HOST_HANDOFF takes a team id (team-handoff.md)", () => {
    expect(parseClientMessage({ type: "TEAM_CLAIM", code: "0427" })).toEqual({ type: "TEAM_CLAIM", code: "0427" });
    for (const code of ["427", "04270", "04a7", 427, undefined]) expect(parseClientMessage({ type: "TEAM_CLAIM", code })).toBeNull();
    expect(parseClientMessage({ type: "HOST_HANDOFF", teamId: "t1" })).toEqual({ type: "HOST_HANDOFF", teamId: "t1" });
    expect(parseClientMessage({ type: "HOST_HANDOFF" })).toBeNull();
  });

  it("HOST_LATE_TEAM takes a team id and a boolean admit (late-join.md)", () => {
    expect(parseClientMessage({ type: "HOST_LATE_TEAM", teamId: "t1", admit: false })).toEqual({ type: "HOST_LATE_TEAM", teamId: "t1", admit: false });
    expect(parseClientMessage({ type: "HOST_LATE_TEAM", teamId: "t1", admit: "false" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_LATE_TEAM", admit: true })).toBeNull();
  });

  // Value: protects=the room only sees a reveal naming a team and a question; fails_when=the parser lets a reveal without either through; why_new=new message; seam=none
  it("HOST_REVEAL takes a team id and a question id (host-reveal.md)", () => {
    expect(parseClientMessage({ type: "HOST_REVEAL", teamId: "t1", questionId: "q1" })).toEqual({ type: "HOST_REVEAL", teamId: "t1", questionId: "q1" });
    expect(parseClientMessage({ type: "HOST_REVEAL", teamId: "t1" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_REVEAL", questionId: "q1" })).toBeNull();
  });

  it("HOST_MEDIA takes a question id and play, pause or restart (youtube-questions.md)", () => {
    for (const action of ["play", "pause", "restart"]) {
      expect(parseClientMessage({ type: "HOST_MEDIA", questionId: "q1", action })).toEqual({ type: "HOST_MEDIA", questionId: "q1", action });
    }
    expect(parseClientMessage({ type: "HOST_MEDIA", questionId: "q1", action: "stop" })).toBeNull();
    expect(parseClientMessage({ type: "HOST_MEDIA", action: "play" })).toBeNull();
  });

  it("TEAM_PICK_CLASS accepts a known class id or null, nothing else (class-abilities.md)", () => {
    expect(parseClientMessage({ type: "TEAM_PICK_CLASS", classId: "warrior" })).toEqual({ type: "TEAM_PICK_CLASS", classId: "warrior" });
    expect(parseClientMessage({ type: "TEAM_PICK_CLASS", classId: null })).toEqual({ type: "TEAM_PICK_CLASS", classId: null });
    expect(parseClientMessage({ type: "TEAM_PICK_CLASS", classId: "bard" })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_PICK_CLASS" })).toBeNull();
  });

  it("TEAM_CHOOSE_FORK takes only a side (the doors are unmarked) and a non-negative integer eventId; timeout is the room's, and the old event messages are gone", () => {
    expect(parseClientMessage({ type: "TEAM_CHOOSE_FORK", side: "right", eventId: 3 })).toEqual({ type: "TEAM_CHOOSE_FORK", side: "right", eventId: 3 });
    expect(parseClientMessage({ type: "TEAM_CHOOSE_FORK", side: "left", eventId: 0, teamId: "x" })).toEqual({ type: "TEAM_CHOOSE_FORK", side: "left", eventId: 0 });
    for (const side of ["timeout", "monster", "mystery", "", undefined, 1]) expect(parseClientMessage({ type: "TEAM_CHOOSE_FORK", side, eventId: 1 })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_CHOOSE_FORK", door: "monster", eventId: 1 })).toBeNull();
    for (const eventId of [undefined, -1, 1.5, "3"]) expect(parseClientMessage({ type: "TEAM_CHOOSE_FORK", side: "left", eventId })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_OPEN_EVENT", eventId: 1 })).toBeNull();
    expect(parseClientMessage({ type: "HOST_OPEN_EVENT", teamId: "t", eventId: 1 })).toBeNull();
  });

  it("HOST_GIVE_ITEM needs a team id; TEAM_DRINK_POTION a question id and a non-negative integer eventId", () => {
    expect(parseClientMessage({ type: "HOST_GIVE_ITEM", teamId: "t1", item: "x" })).toEqual({ type: "HOST_GIVE_ITEM", teamId: "t1" });
    expect(parseClientMessage({ type: "HOST_GIVE_ITEM" })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_DRINK_POTION", questionId: "q1", eventId: 2 })).toEqual({ type: "TEAM_DRINK_POTION", questionId: "q1", eventId: 2 });
    for (const eventId of [undefined, -1, 1.5, "3"]) expect(parseClientMessage({ type: "TEAM_DRINK_POTION", questionId: "q1", eventId })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_DRINK_POTION", eventId: 0 })).toBeNull();
  });

  it("TEAM_ROLL_CHECK carries the question id and a non-negative integer eventId only", () => {
    expect(parseClientMessage({ type: "TEAM_ROLL_CHECK", questionId: "r0-q1", eventId: 3, value: 20 })).toEqual({ type: "TEAM_ROLL_CHECK", questionId: "r0-q1", eventId: 3 });
    for (const eventId of [undefined, -1, 1.5, "3"]) expect(parseClientMessage({ type: "TEAM_ROLL_CHECK", questionId: "r0-q1", eventId })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_ROLL_CHECK", eventId: 0 })).toBeNull();
  });

  it("TEAM_USE_ABILITY carries only the question id", () => {
    expect(parseClientMessage({ type: "TEAM_USE_ABILITY", questionId: "r0-q1", value: 20 })).toEqual({ type: "TEAM_USE_ABILITY", questionId: "r0-q1" });
    expect(parseClientMessage({ type: "TEAM_USE_ABILITY" })).toBeNull();
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

describe("TEAM_SUBMIT_TEXT (fill-in, #104)", () => {
  // Value: protects=only a string answer under the raw cap parses; fails_when=a number, missing text or a
  // huge payload reaches the room; no_claim=what the room keeps (cleanTypedAnswer below).
  it("parses a string answer and rejects the rest", () => {
    expect(parseClientMessage({ type: "TEAM_SUBMIT_TEXT", questionId: "r0-q1", text: "貓" })).toEqual({ type: "TEAM_SUBMIT_TEXT", questionId: "r0-q1", text: "貓" });
    for (const text of [5, undefined, null, "x".repeat(201)]) expect(parseClientMessage({ type: "TEAM_SUBMIT_TEXT", questionId: "r0-q1", text })).toBeNull();
    expect(parseClientMessage({ type: "TEAM_SUBMIT_TEXT", questionId: "r0-q1", text: "貓", eventId: 3 })).toEqual({ type: "TEAM_SUBMIT_TEXT", questionId: "r0-q1", text: "貓", eventId: 3 });
    for (const eventId of [-1, 1.5, "3"]) expect(parseClientMessage({ type: "TEAM_SUBMIT_TEXT", questionId: "r0-q1", text: "貓", eventId })).toBeNull();
  });

  // Value: protects=a typed answer shows as typed: quotes kept, 40 characters counted per code point (eng review R2);
  // fails_when=apostrophes are stripped, an emoji counts as 2, or control characters survive;
  // no_claim=how React renders it.
  it("cleanTypedAnswer keeps quotes, drops control characters and keeps 40 code points", () => {
    expect(cleanTypedAnswer("  Don't \"Stop\"\n ")).toBe(`Don't "Stop"`);
    expect(cleanTypedAnswer("a\u0000b")).toBe("ab");
    expect(Array.from(cleanTypedAnswer("🎵".repeat(41)))).toHaveLength(40);
    expect(cleanTypedAnswer(" \t ")).toBe("");
  });

  // Value: protects=an answer of only invisible characters is refused and bidi overrides cannot flip the TV text
  // (/review D4); fails_when=zero-width spaces pass as an answer or U+202E survives; no_claim=emoji joiners (kept).
  it("cleanTypedAnswer drops bidi controls and empties an answer with nothing visible", () => {
    expect(cleanTypedAnswer("\u202Eabc\u2066")).toBe("abc");
    expect(cleanTypedAnswer("\u200B\u200B \u200D")).toBe("");
    expect(cleanTypedAnswer("👩\u200D💻")).toBe("👩\u200D💻");
  });
});
