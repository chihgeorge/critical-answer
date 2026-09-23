import { describe, it, expect, vi } from "vitest";
import { parseBank, roomTemplates, findQuestion, publicQuestion, answerText, imageKeysOf } from "./question-bank";
import { BANK } from "./question-bank-data";
import { MAX_TEAMS } from "./protocol";

const q = (id: string, text = "題目", answer = "答案") => ({ kind: "text" as const, id, text, answer });
const mc = (id: string, options = ["A", "B"], correctIndex = 0) => ({ kind: "multipleChoice" as const, id, text: "題目", options, correctIndex });
const img = (id: string, imageKey = "11111111-1111-1111-1111-111111111111", answer = "答案") => ({
  kind: "image" as const,
  id,
  text: "題目",
  answer,
  imageKey,
});
const valid = () => ({
  rooms: [{ monster: { name: "史萊姆", sprite: "slime", hue: 0 }, baseDifficulty: 1, questions: [q("a1"), q("a2")] }],
  boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, questions: [q("b1")] },
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
    for (const item of all) expect(item.text).not.toContain(answerText(item));
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
    ["an unknown kind", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [{ id: "a1", text: "t", kind: "essay" }] }] })],
    ["a multipleChoice question with only 1 option", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1", ["A"])] }] })],
    [
      "a multipleChoice question with a blank option",
      () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1", ["A", "  "])] }] }),
    ],
    [
      "a multipleChoice question with correctIndex out of range",
      () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1", ["A", "B"], 2)] }] }),
    ],
    [
      "a multipleChoice question with a negative correctIndex",
      () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1", ["A", "B"], -1)] }] }),
    ],
    [
      "a multipleChoice question with a non-integer correctIndex",
      () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1", ["A", "B"], 0.5)] }] }),
    ],
    ["an image question with an empty answer", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [img("a1", "11111111-1111-1111-1111-111111111111", "")] }] })],
    ["an image question with no imageKey", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [img("a1", "")] }] })],
  ])("fails loudly on %s", (_name, make) => {
    expect(() => parseBank(make())).toThrow(/question bank/i);
  });

  it("accepts a valid multipleChoice question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1", ["A", "B", "C"], 2)] }] });
    expect(bank.rooms[0].questions[0]).toEqual({ kind: "multipleChoice", id: "a1", text: "題目", options: ["A", "B", "C"], correctIndex: 2 });
  });

  it("accepts a valid image question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [img("a1", "22222222-2222-2222-2222-222222222222", "松鼠")] }] });
    expect(bank.rooms[0].questions[0]).toEqual({ kind: "image", id: "a1", text: "題目", answer: "松鼠", imageKey: "22222222-2222-2222-2222-222222222222" });
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

  it("publicQuestion never contains the answer or correctIndex, even in the shipped bank", () => {
    for (const r of BANK.rooms) {
      for (const item of r.questions) {
        const pub = publicQuestion(BANK, item.id, 2, "");
        expect(JSON.stringify(pub)).not.toContain(answerText(item));
        expect(pub).not.toHaveProperty("answer");
        expect(pub).not.toHaveProperty("correctIndex");
      }
    }
    expect(publicQuestion(BANK, "nope", 1, "")).toBeNull();
  });

  it("answerText reads a text question's answer, and a multipleChoice question's correct option", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("mc1", ["A", "B", "C"], 1)] }] });
    expect(answerText(bank.rooms[0].questions[0])).toBe("B");
    expect(answerText(findQuestion(bank, "b1")!)).toBe("答案");
  });

  it("publicQuestion includes options (but never correctIndex) for a multipleChoice question, and no options field for text", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1"), mc("mc1", ["A", "B", "C"], 1)] }] });
    const pub = publicQuestion(bank, "mc1", 1, "")!;
    expect(pub.options).toEqual(["A", "B", "C"]);
    expect(pub).not.toHaveProperty("correctIndex");
    expect(publicQuestion(bank, "a1", 1, "")).not.toHaveProperty("options");
  });

  it("publicQuestion prepends imageBaseUrl to an image question's stored key, and never leaks the answer", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1"), img("img1", "33333333-3333-3333-3333-333333333333", "松鼠")] }] });
    const pub = publicQuestion(bank, "img1", 1, "https://pub-example.r2.dev")!;
    expect(pub.imageUrl).toBe("https://pub-example.r2.dev/33333333-3333-3333-3333-333333333333");
    expect(pub).not.toHaveProperty("answer");
    expect(publicQuestion(bank, "a1", 1, "https://pub-example.r2.dev")).not.toHaveProperty("imageUrl");
  });

  it("answerText reads an image question's answer, same as text", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [img("img1", "33333333-3333-3333-3333-333333333333", "松鼠")] }] });
    expect(answerText(findQuestion(bank, "img1")!)).toBe("松鼠");
  });

  it.each([
    ["an empty imageBaseUrl", ""],
    ["the unconfigured wrangler.jsonc placeholder", "https://REPLACE-ME.r2.dev"],
  ])("publicQuestion logs image_base_url_missing (not just a silently broken image) for %s", (_name, base) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [img("img1", "33333333-3333-3333-3333-333333333333", "松鼠")] }] });
    const pub = publicQuestion(bank, "img1", 1, base)!;
    expect(pub.imageUrl).toBe(`${base}/33333333-3333-3333-3333-333333333333`); // still builds a URL — the warning doesn't block it
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("image_base_url_missing"));
    spy.mockRestore();
  });

  it("publicQuestion does not log image_base_url_missing for a real, configured base URL", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [img("img1", "33333333-3333-3333-3333-333333333333", "松鼠")] }] });
    publicQuestion(bank, "img1", 1, "https://pub-real.r2.dev");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("imageKeysOf collects every image key in a bank, ignoring text and multipleChoice questions", () => {
    const bank = parseBank({
      rooms: [
        {
          monster: { name: "史萊姆", sprite: "slime", hue: 0 },
          baseDifficulty: 1,
          questions: [q("a1"), img("a2", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), mc("a3", ["X", "Y"])],
        },
      ],
      boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, questions: [img("b1", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")] },
    });
    expect(imageKeysOf(bank)).toEqual(new Set(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]));
  });
});
