import { describe, it, expect } from "vitest";
import { parseSnapshot, SCHEMA_VERSION, type RoomSnapshot } from "./snapshot";
import { BANK } from "../question-bank";

const valid = (): RoomSnapshot => ({
  schemaVersion: SCHEMA_VERSION,
  roomEpoch: "epoch-1",
  game: null,
  pendingTeams: [{ id: "00000000-0000-0000-0000-000000000001", name: "甲隊" }],
  hostToken: "host-token-0123456789abcdef",
  teamKeys: [["00000000-0000-0000-0000-000000000001", "team-key-0123456789abcdef"]],
  eventSeq: 3,
  lastNarration: { eventId: 3, line: "一句旁白", then: "下一隊" },
  epilogue: null,
  epilogueRequested: false,
  notes: "",
  editedLines: [],
  aiNarration: false,
  bank: BANK,
});

describe("parseSnapshot", () => {
  it("accepts what a room writes, unchanged", () => {
    const s = parseSnapshot(structuredClone(valid()));
    expect(s).toEqual(valid());
  });

  it("refuses anything that is not an object, and an unknown schema version", () => {
    for (const bad of [null, undefined, "room", 42, [], { schemaVersion: 999 }, { ...valid(), schemaVersion: 0 }]) {
      expect(parseSnapshot(bad)).toBeNull();
    }
  });

  it("refuses a snapshot with a missing or mistyped field", () => {
    const fields: [string, unknown][] = [
      ["roomEpoch", 5],
      ["hostToken", null],
      ["pendingTeams", [{ id: 1, name: "x" }]],
      ["teamKeys", [["only-one"]]],
      ["eventSeq", -1],
      ["eventSeq", 1.5],
      ["lastNarration", { eventId: "3", line: "x" }],
      ["epilogue", 7],
      ["epilogueRequested", "no"],
      ["aiNarration", 0],
      ["notes", null],
      ["editedLines", [1]],
      ["game", { phase: "playing" }],
    ];
    for (const [field, value] of fields) {
      expect(parseSnapshot({ ...valid(), [field]: value }), `${field}=${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("refuses a snapshot whose bank would not load today", () => {
    const broken = structuredClone(BANK);
    broken.rooms[0].questions[0].answer = "";
    expect(parseSnapshot({ ...valid(), bank: broken })).toBeNull();
    expect(parseSnapshot({ ...valid(), bank: { rooms: [] } })).toBeNull();
  });

  it("does not throw on hostile input", () => {
    expect(() => parseSnapshot({ ...valid(), bank: "not a bank" })).not.toThrow();
    expect(() => parseSnapshot({ ...valid(), teamKeys: "x" })).not.toThrow();
  });
});
