import { describe, it, expect } from "vitest";
import { BANK, parseBank, roomTemplates, findQuestion, publicQuestion } from "./question-bank";
import { MAX_TEAMS } from "./protocol";

const q = (id: string, text = "題目", answer = "答案") => ({ id, text, answer });
const valid = () => ({
  rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, questions: [q("a1"), q("a2")] }],
  boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, lore: "…", maxHp: 3, questions: [q("b1")] },
});

describe("shipped bank", () => {
  it("has enough questions per room that a full room of teams never shares one", () => {
    for (const r of BANK.rooms) expect(r.questions.length).toBeGreaterThanOrEqual(MAX_TEAMS);
  });

  it("has unique ids and a boss deck", () => {
    const ids = [...BANK.rooms.flatMap((r) => r.questions), ...BANK.boss.questions].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BANK.boss.questions.length).toBeGreaterThanOrEqual(5);
  });

  it("no question text contains its own answer", () => {
    const all = [...BANK.rooms.flatMap((r) => r.questions), ...BANK.boss.questions];
    for (const item of all) expect(item.text).not.toContain(item.answer);
  });

  it("every question is worth at least one point, so the 15-point gate is reachable", () => {
    for (const r of BANK.rooms) expect(r.baseDifficulty).toBeGreaterThanOrEqual(1);
  });
});

describe("parseBank", () => {
  it("accepts a valid bank", () => {
    expect(parseBank(valid()).rooms[0].questions).toHaveLength(2);
  });

  it.each([
    ["not an object", () => "x"],
    ["no rooms", () => ({ ...valid(), rooms: [] })],
    ["a room with no questions", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [] }] })],
    ["a duplicate id", () => ({ ...valid(), boss: { ...valid().boss, questions: [q("a1")] } })],
    ["an empty text", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", "  ")] }] })],
    ["an empty answer", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", "t", "")] }] })],
    ["a difficulty of 0", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], baseDifficulty: 0 }] })],
    ["a difficulty of 6", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], baseDifficulty: 6 }] })],
    ["an unknown sprite", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], monster: { name: "x", sprite: "cat" } }] })],
    ["no boss questions", () => ({ ...valid(), boss: { ...valid().boss, questions: [] } })],
    ["a boss without hp", () => ({ ...valid(), boss: { ...valid().boss, maxHp: 0 } })],
  ])("fails loudly on %s", (_name, make) => {
    expect(() => parseBank(make())).toThrow(/question bank/i);
  });
});

describe("lookups", () => {
  const bank = parseBank(valid());

  it("roomTemplates keeps the ids and difficulty per room", () => {
    expect(roomTemplates(bank)).toEqual([{ baseDifficulty: 1, questionIds: ["a1", "a2"] }]);
  });

  it("findQuestion returns text, answer and where it lives, or undefined", () => {
    expect(findQuestion(bank, "a2")).toMatchObject({ text: "題目", answer: "答案", roomIndex: 0, boss: false });
    expect(findQuestion(bank, "b1")).toMatchObject({ boss: true });
    expect(findQuestion(bank, "nope")).toBeUndefined();
  });

  it("publicQuestion never contains the answer, even in the shipped bank", () => {
    for (const r of BANK.rooms) {
      for (const item of r.questions) {
        const pub = publicQuestion(BANK, item.id, 2);
        expect(JSON.stringify(pub)).not.toContain(item.answer);
        expect(pub).not.toHaveProperty("answer");
      }
    }
    expect(publicQuestion(BANK, "nope", 1)).toBeNull();
  });
});
