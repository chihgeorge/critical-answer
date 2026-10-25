import { describe, it, expect, vi } from "vitest";
import { parseBank, roomTemplates, findQuestion, publicQuestion, publicExplanation, publicMediaContent, answerText, imageKeysOf, type MediaContent } from "./question-bank";
import { BANK } from "./question-bank-data";
import { MAX_TEAMS } from "./protocol";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const UUID_C = "33333333-3333-3333-3333-333333333333";
const YT_ID = "dQw4w9WgXcQ";

const textContent = (value = "題目"): MediaContent => ({ kind: "text", value });
const imageContent = (value = UUID_A): MediaContent => ({ kind: "image", value });
const youtubeContent = (value = YT_ID): MediaContent => ({ kind: "youtube", value });

const q = (id: string, content: MediaContent = textContent(), answer = "答案") => ({ kind: "text" as const, id, content, answer });
const mc = (id: string, options = ["A", "B"], correctIndex = 0, content: MediaContent = textContent()) => ({
  kind: "multipleChoice" as const,
  id,
  content,
  options,
  correctIndex,
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

  it("is 48 four-option multipleChoice questions, with the correct option in varied positions", () => {
    const all = [...BANK.rooms.flatMap((r) => r.questions), ...BANK.boss.questions];
    expect(all).toHaveLength(48);
    for (const item of all) {
      if (item.kind !== "multipleChoice") throw new Error(`${item.id} is ${item.kind}`);
      expect(new Set(item.options).size).toBe(4);
      expect(item.correctIndex).toBeLessThan(4);
    }
    expect(new Set(all.map((item) => item.kind === "multipleChoice" && item.correctIndex)).size).toBe(4);
  });

  it("no question in a room gives away another one's answer in its text or options", () => {
    for (const r of [...BANK.rooms, BANK.boss]) {
      for (const item of r.questions) {
        for (const other of r.questions) {
          if (other === item) continue;
          const answer = answerText(other);
          if (item.content.kind === "text" && answer.length > 1) expect(item.content.value, `${item.id} shows ${other.id}'s answer`).not.toContain(answer);
          if (item.kind === "multipleChoice") expect(item.options, `${item.id} offers ${other.id}'s answer`).not.toContain(answer);
        }
      }
    }
  });

  it("no question's text content contains its own answer", () => {
    const all = [...BANK.rooms.flatMap((r) => r.questions), ...BANK.boss.questions];
    for (const item of all) {
      if (item.content.kind === "text") expect(item.content.value).not.toContain(answerText(item));
    }
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
    ["an empty content value", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", textContent("  "))] }] })],
    ["an empty answer", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", textContent(), "")] }] })],
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
    ["a question with an invalid image key", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", { kind: "image", value: "not-a-uuid" })] }] })],
    ["a question with an empty image key", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", { kind: "image", value: "" })] }] })],
    ["a question with an invalid YouTube id", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", { kind: "youtube", value: "too-short" })] }] })],
    ["a question with an unknown content kind", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", { kind: "audio", value: "x" } as unknown as MediaContent)] }] })],
    ["a question with an invalid explanation", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [{ ...q("a1"), explanation: { kind: "image", value: "not-a-uuid" } }] }] })],
    ["a question with no content, no legacy text, and no legacy imageKey", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [{ id: "a1", kind: "text", answer: "答案" }] }] })],
    ["a question whose content is null", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [{ ...q("a1"), content: null }] }] })],
    ["a question whose explanation is null (only an absent explanation means none)", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [{ ...q("a1"), explanation: null }] }] })],
    ["a question with an empty explanation value", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [{ ...q("a1"), explanation: textContent("  ") }] }] })],
  ])("fails loudly on %s", (_name, make) => {
    expect(() => parseBank(make())).toThrow(/question bank|content/i);
  });

  it("accepts a valid multipleChoice question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1", ["A", "B", "C"], 2)] }] });
    expect(bank.rooms[0].questions[0]).toEqual({ kind: "multipleChoice", id: "a1", content: textContent(), options: ["A", "B", "C"], correctIndex: 2 });
  });

  it("accepts a valid image-content question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", imageContent(UUID_B), "松鼠")] }] });
    expect(bank.rooms[0].questions[0]).toEqual({ kind: "text", id: "a1", content: imageContent(UUID_B), answer: "松鼠" });
  });

  it("accepts a valid youtube-content question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", youtubeContent(), "答案")] }] });
    expect(bank.rooms[0].questions[0]).toEqual({ kind: "text", id: "a1", content: youtubeContent(), answer: "答案" });
  });

  it("accepts an optional explanation, independently text/image/youtube from the content", () => {
    const bank = parseBank({
      ...valid(),
      rooms: [{ ...valid().rooms[0], questions: [{ ...q("a1", imageContent()), explanation: youtubeContent() }] }],
    });
    expect(bank.rooms[0].questions[0]).toMatchObject({ content: imageContent(), explanation: youtubeContent() });
  });

  it("has no explanation field at all when none was given (not an empty/undefined value)", () => {
    const bank = parseBank(valid());
    expect(bank.rooms[0].questions[0]).not.toHaveProperty("explanation");
  });

  describe("legacy shapes (backward-read conversion, docs/designs/question-media-content.md)", () => {
    it("converts a legacy bare `text: string` field into text content", () => {
      const legacy = { id: "a1", kind: "text", text: "舊格式的題目", answer: "答案" };
      const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] });
      expect(bank.rooms[0].questions[0]).toEqual({ kind: "text", id: "a1", content: textContent("舊格式的題目"), answer: "答案" });
    });

    it("converts a legacy multipleChoice question's bare `text` field the same way", () => {
      const legacy = { id: "a1", kind: "multipleChoice", text: "舊格式選擇題", options: ["A", "B"], correctIndex: 0 };
      const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] });
      expect(bank.rooms[0].questions[0]).toMatchObject({ content: textContent("舊格式選擇題") });
    });

    it("converts a legacy top-level `image` kind (text + imageKey) into a text question with image content", () => {
      const legacy = { id: "a1", kind: "image", text: "本題有圖", answer: "松鼠", imageKey: UUID_C };
      const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] });
      expect(bank.rooms[0].questions[0]).toEqual({ kind: "text", id: "a1", content: imageContent(UUID_C), answer: "松鼠" });
    });

    it("still validates a legacy image kind's imageKey shape", () => {
      const legacy = { id: "a1", kind: "image", text: "x", answer: "y", imageKey: "not-a-uuid" };
      expect(() => parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] })).toThrow(/question bank/i);
    });
  });
});

describe("lookups", () => {
  const bank = parseBank(valid());

  it("roomTemplates keeps the ids and difficulty per room", () => {
    expect(roomTemplates(bank)).toEqual([{ baseDifficulty: 1, questionIds: ["a1", "a2"] }]);
  });

  it("findQuestion returns content, answer and where it lives, or undefined", () => {
    expect(findQuestion(bank, "a2")).toMatchObject({ content: textContent(), answer: "答案", roomIndex: 0, boss: false });
    expect(findQuestion(bank, "b1")).toMatchObject({ boss: true });
    expect(findQuestion(bank, "nope")).toBeUndefined();
  });

  it("publicQuestion never contains the answer, correctIndex, or explanation, even in the shipped bank", () => {
    for (const r of BANK.rooms) {
      for (const item of r.questions) {
        const pub = publicQuestion(BANK, item.id, 2, "");
        // A multipleChoice answer is one of its public options; only which one stays hidden.
        if (item.kind !== "multipleChoice") expect(JSON.stringify(pub)).not.toContain(answerText(item));
        expect(pub).not.toHaveProperty("answer");
        expect(pub).not.toHaveProperty("correctIndex");
        expect(pub).not.toHaveProperty("explanation");
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

  it("publicQuestion's content is text pass-through for a text-content question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", textContent("你好"))] }] });
    expect(publicQuestion(bank, "a1", 1, "")!.content).toEqual({ kind: "text", value: "你好" });
  });

  it("publicQuestion prepends imageBaseUrl to an image-content question's stored key, and never leaks the answer", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1"), q("img1", imageContent(UUID_C), "松鼠")] }] });
    const pub = publicQuestion(bank, "img1", 1, "https://pub-example.r2.dev")!;
    expect(pub.content).toEqual({ kind: "image", url: `https://pub-example.r2.dev/${UUID_C}` });
    expect(pub).not.toHaveProperty("answer");
    expect(publicQuestion(bank, "a1", 1, "https://pub-example.r2.dev")!.content.kind).toBe("text");
  });

  it("publicQuestion's content is the videoId for a youtube-content question, never the raw stored value re-wrapped as a URL", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", youtubeContent())] }] });
    expect(publicQuestion(bank, "a1", 1, "")!.content).toEqual({ kind: "youtube", videoId: YT_ID });
  });

  it("answerText reads an image-content question's answer, same as text", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("img1", imageContent(UUID_C), "松鼠")] }] });
    expect(answerText(findQuestion(bank, "img1")!)).toBe("松鼠");
  });

  it.each([
    ["an empty imageBaseUrl", ""],
    ["the unconfigured wrangler.jsonc placeholder", "https://REPLACE-ME.r2.dev"],
  ])("publicQuestion logs image_base_url_missing (not just a silently broken image) for %s", (_name, base) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("img1", imageContent(UUID_C), "松鼠")] }] });
    const pub = publicQuestion(bank, "img1", 1, base)!;
    expect(pub.content).toEqual({ kind: "image", url: `${base}/${UUID_C}` }); // still builds a URL — the warning doesn't block it
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("image_base_url_missing"));
    spy.mockRestore();
  });

  it("publicQuestion does not log image_base_url_missing for a real, configured base URL", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("img1", imageContent(UUID_C), "松鼠")] }] });
    publicQuestion(bank, "img1", 1, "https://pub-real.r2.dev");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("publicExplanation returns the wire-safe explanation of a question that was just answered, or undefined when it has none", () => {
    const bank = parseBank({
      ...valid(),
      rooms: [{ ...valid().rooms[0], questions: [{ ...q("a1"), explanation: youtubeContent() }, q("a2")] }],
    });
    expect(publicExplanation(bank, "a1", "")).toEqual({ kind: "youtube", videoId: YT_ID });
    expect(publicExplanation(bank, "a2", "")).toBeUndefined();
    expect(publicExplanation(bank, "nope", "")).toBeUndefined();
  });

  it("publicMediaContent converts each kind independently of the others", () => {
    expect(publicMediaContent(textContent("hi"), "", "q1")).toEqual({ kind: "text", value: "hi" });
    expect(publicMediaContent(imageContent(UUID_A), "https://base", "q1")).toEqual({ kind: "image", url: `https://base/${UUID_A}` });
    expect(publicMediaContent(youtubeContent(), "", "q1")).toEqual({ kind: "youtube", videoId: YT_ID });
  });

  it("imageKeysOf collects every image key in a bank — content OR explanation, on either surviving kind", () => {
    const bank = parseBank({
      rooms: [
        {
          monster: { name: "史萊姆", sprite: "slime", hue: 0 },
          baseDifficulty: 1,
          questions: [
            q("a1"), // text content, no image
            q("a2", imageContent("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")), // image content
            mc("a3", ["X", "Y"]), // multipleChoice, text content
            { ...q("a4"), explanation: imageContent("cccccccc-cccc-cccc-cccc-cccccccccccc") }, // image explanation only
          ],
        },
      ],
      boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, questions: [q("b1", imageContent("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"))] },
    });
    expect(imageKeysOf(bank)).toEqual(
      new Set(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "cccccccc-cccc-cccc-cccc-cccccccccccc"]),
    );
  });
});
