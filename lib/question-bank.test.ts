import { describe, it, expect, vi } from "vitest";
import { parseBank, roomTemplates, poolQuestionIds, shuffledOptionOrders, inShownOrder, allQuestions, DIFFICULTIES, findQuestion, publicQuestion, publicExplanation, publicMediaContent, answerText, imageKeysOf, type MediaContent } from "./question-bank";
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

const phase1 = () => ({ maxHp: 3, questions: [q("b1")] });

describe("boss phases", () => {
  it("reads a bank without phases as one phase with an empty name and rule", () => {
    expect(parseBank(valid()).boss.phases).toEqual([{ name: "", rule: "", maxHp: 3, questions: [q("b1")] }]);
  });

  it("reads phases in order, trims names and rules, and lets phase 1 leave them empty", () => {
    const b = parseBank({ ...valid(), boss: { monster: valid().boss.monster, phases: [phase1(), { name: " 主題曲之謎 ", rule: "聽前奏", maxHp: 2, questions: [q("c1"), q("c2")] }] } });
    expect(b.boss.phases.map((p) => [p.name, p.rule, p.maxHp, p.questions.map((x) => x.id)])).toEqual([
      ["", "", 3, ["b1"]],
      ["主題曲之謎", "聽前奏", 2, ["c1", "c2"]],
    ]);
    expect(allQuestions(b).map((x) => x.id)).toEqual(["a1", "a2", "b1", "c1", "c2"]);
    expect(findQuestion(b, "c2")).toMatchObject({ boss: true, difficulty: 5 });
  });
});

describe("shipped bank", () => {
  const all = allQuestions(BANK);

  it("has 8 rooms of difficulty 1/2/2/3/4/4/5/5 paying 10/20/20/30/40/40/50/50 (scoring-and-score-pools.md S9, S12)", () => {
    expect(BANK.rooms.map((r) => r.difficulty)).toEqual([1, 2, 2, 3, 4, 4, 5, 5]);
    expect(BANK.rooms.map((r) => r.reward)).toEqual([10, 20, 20, 30, 40, 40, 50, 50]);
    expect(new Set(BANK.rooms.map((r) => r.monster.name)).size).toBe(8);
  });

  it("has at least MAX_TEAMS + 4 questions in every pool, so a deal always finds one nobody holds", () => {
    for (const d of DIFFICULTIES) expect(BANK.pools[d].length, `pool ${d}`).toBeGreaterThanOrEqual(MAX_TEAMS + 4);
  });

  it("has unique ids and a boss deck", () => {
    const ids = all.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BANK.boss.phases[0].questions.length).toBeGreaterThanOrEqual(5);
  });

  it("is all four-option multipleChoice questions, with the correct option in varied positions", () => {
    for (const item of all) {
      if (item.kind !== "multipleChoice") throw new Error(`${item.id} is ${item.kind}`);
      expect(new Set(item.options).size).toBe(4);
      expect(item.correctIndex).toBeLessThan(4);
    }
    expect(new Set(all.map((item) => item.kind === "multipleChoice" && item.correctIndex)).size).toBe(4);
  });

  it("no question gives away another one's answer: in its text anywhere in the bank (the big screen is shared), in its options within a pool", () => {
    const placed = [...DIFFICULTIES.map((d) => BANK.pools[d]), ...BANK.boss.phases.map((p) => p.questions)].flatMap((list) => list.map((q) => ({ q, list })));
    for (const { q: item, list } of placed) {
      for (const { q: other, list: otherList } of placed) {
        if (other === item) continue;
        const answer = answerText(other);
        if (item.content.kind === "text" && answer.length > 1) expect(item.content.value, `${item.id} shows ${other.id}'s answer`).not.toContain(answer);
        if (list === otherList && item.kind === "multipleChoice") expect(item.options, `${item.id} offers ${other.id}'s answer`).not.toContain(answer);
      }
    }
  });

  it("no two questions anywhere in the bank share a text or a correct answer (a reveal on the big screen would give the other away)", () => {
    const texts = all.map((q) => (q.content.kind === "text" ? q.content.value : q.id));
    expect(new Set(texts).size).toBe(all.length);
    expect(new Set(all.map(answerText)).size).toBe(all.length);
  });

  it("no question's text content contains its own answer", () => {
    for (const item of all) {
      if (item.content.kind === "text") expect(item.content.value).not.toContain(answerText(item));
    }
  });
});

describe("parseBank", () => {
  it("accepts a valid bank", () => {
    expect(parseBank(valid()).pools[1]).toHaveLength(2);
  });

  const pooled = () => ({
    pools: { "1": [q("a1"), q("a2")], "3": [q("c1")] },
    rooms: [
      { monster: { name: "史萊姆", sprite: "slime", hue: 0 }, difficulty: 1, reward: 10 },
      { monster: { name: "幽靈", sprite: "ghost", hue: 0 }, difficulty: 3, reward: 99 },
    ],
    boss: { monster: { name: "龍", sprite: "dragon", hue: 0 }, maxHp: 3, hitReward: 10, questions: [q("b1")] },
  });

  it("reads the pooled format: questions by difficulty, rooms with difficulty and reward, missing pools empty", () => {
    const b = parseBank(pooled());
    expect(b.pools[1].map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(b.pools[2]).toEqual([]);
    expect(b.pools[3].map((x) => x.id)).toEqual(["c1"]);
    expect(b.rooms.map((r) => [r.difficulty, r.reward])).toEqual([[1, 10], [3, 99]]);
  });

  it("rejects a pooled bank that could silently drop questions: a pool key like 01, or rooms still holding questions", () => {
    const dup = pooled() as Record<string, unknown> & { pools: Record<string, unknown> };
    dup.pools["01"] = [q("a9")];
    expect(() => parseBank(dup)).toThrow(/pool key 01/);
    const mixed = pooled();
    (mixed.rooms[0] as Record<string, unknown>).questions = [q("r1")];
    expect(() => parseBank(mixed)).toThrow(/room 0 has questions/);
  });

  it("converts the older per-room format: each room's questions join the pool of its baseDifficulty", () => {
    const b = parseBank({
      rooms: [
        { monster: { name: "A", sprite: "slime" }, baseDifficulty: 2, questions: [q("x1")] },
        { monster: { name: "B", sprite: "ghost" }, baseDifficulty: 2, questions: [q("x2")] },
      ],
      boss: { monster: { name: "龍", sprite: "dragon" }, maxHp: 3, questions: [q("b1")] },
    });
    expect(b.pools[2].map((x) => x.id)).toEqual(["x1", "x2"]);
    expect(b.rooms.map((r) => [r.difficulty, r.reward])).toEqual([[2, 20], [2, 20]]);
    expect(parseBank(JSON.parse(JSON.stringify(b)))).toEqual(b); // a converted bank saves and loads as itself
  });

  it.each([
    ["a room whose pool is empty", () => ({ ...pooled(), pools: { "1": [q("a1")] } })],
    ["a pool key that is not a difficulty", () => ({ ...pooled(), pools: { ...pooled().pools, "6": [q("z1")] } })],
    ["pools that are not an object", () => ({ ...pooled(), pools: [] })],
    ["a duplicate id across pools", () => ({ ...pooled(), pools: { "1": [q("a1")], "3": [q("a1")] } })],
    // Value: protects=a malformed pool or room is refused, never silently dropped on save; fails_when=the empty-pool skip
    // also skips non-lists, or a pooled room falls back to a default difficulty; why_new=rows above cover empty pools and
    // bad keys only; seam=none; no_claim=none beyond protects. (Generated by /ship test-coverage audit.)
    ["a pool that is not a list", () => ({ ...pooled(), pools: { ...pooled().pools, "2": "q1" } })],
    ["a room with no difficulty", () => ({ ...pooled(), rooms: [{ ...pooled().rooms[0], difficulty: undefined }] })],
  ])("rejects a pooled bank with %s", (_name, make) => {
    expect(() => parseBank(make())).toThrow(/Invalid question bank/);
  });

  it("shuffledOptionOrders gives each multipleChoice question a permutation, identity under a zero rng", () => {
    const b = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1"), mc("m1", ["A", "B", "C", "D"], 2)] }] });
    expect(shuffledOptionOrders(b, () => 0)).toEqual({ m1: [0, 1, 2, 3] });
    const order = shuffledOptionOrders(b, () => 0.99).m1;
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(order).not.toEqual([0, 1, 2, 3]);
  });

  it("inShownOrder moves correctIndex with its option, and leaves text questions and missing orders alone", () => {
    const m = mc("m1", ["A", "B", "C", "D"], 2);
    expect(inShownOrder(m, [2, 0, 3, 1])).toMatchObject({ options: ["C", "A", "D", "B"], correctIndex: 0 });
    expect(inShownOrder(m, undefined)).toBe(m);
    expect(inShownOrder(m, [1, 0])).toBe(m); // an order for a different option count (bank edited mid-game) is ignored
    expect(inShownOrder(m, [0, 0, 1, 7])).toBe(m); // not a permutation (a corrupt save): ignored, not blank options
    expect(inShownOrder(q("a1"), [1, 0])).toEqual(q("a1"));
  });

  it("publicQuestion shows the monster of the team's room and the game's option order", () => {
    const b = parseBank({ ...pooled(), pools: { "1": [mc("m1", ["A", "B", "C"], 0)], "3": [q("c1")] } });
    expect(publicQuestion(b, "m1", 1, "", [2, 1, 0])).toMatchObject({ monster: { name: "幽靈" }, options: ["C", "B", "A"] });
    expect(publicQuestion(b, "b1", 0, "")).toMatchObject({ monster: { name: "龍" }, boss: true });
    expect(publicQuestion(b, "c1", 0, "")?.difficulty).toBe(3); // its own pool, even when dealt to a team at another difficulty
  });

  it("defaults rewards for a bank saved before they existed: difficulty x 10 per room, 10 per boss hit", () => {
    const b = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], baseDifficulty: 3 }] });
    expect(b.rooms[0].reward).toBe(30);
    expect(b.boss.hitReward).toBe(10);
  });

  it("keeps rewards the bank sets, zero included", () => {
    const b = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], reward: 0 }], boss: { ...valid().boss, hitReward: 25 } });
    expect(b.rooms[0].reward).toBe(0);
    expect(b.boss.hitReward).toBe(25);
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
    ["a negative room reward", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], reward: -1 }] })],
    ["a non-integer room reward", () => ({ ...valid(), rooms: [{ ...valid().rooms[0], reward: 1.5 }] })],
    ["a boss hit reward that is not a number", () => ({ ...valid(), boss: { ...valid().boss, hitReward: "10" } })],
    ["boss phases that are not a list", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: {} } })],
    ["no boss phases", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: [] } })],
    ["a phase 2 with no rule", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: [phase1(), { name: "主題曲之謎", rule: "  ", maxHp: 2, questions: [q("c1")] }] } })],
    ["a phase 2 with no name", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: [phase1(), { rule: "聽前奏", maxHp: 2, questions: [q("c1")] }] } })],
    ["a phase 2 without hp", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: [phase1(), { name: "n", rule: "r", maxHp: 0, questions: [q("c1")] }] } })],
    ["a phase 2 with no questions", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: [phase1(), { name: "n", rule: "r", maxHp: 2, questions: [] }] } })],
    ["a duplicate id across boss phases", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: [phase1(), { name: "n", rule: "r", maxHp: 2, questions: [q("b1")] }] } })],
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
    expect(bank.pools[1][0]).toEqual({ kind: "multipleChoice", id: "a1", content: textContent(), options: ["A", "B", "C"], correctIndex: 2 });
  });

  it("accepts a valid image-content question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", imageContent(UUID_B), "松鼠")] }] });
    expect(bank.pools[1][0]).toEqual({ kind: "text", id: "a1", content: imageContent(UUID_B), answer: "松鼠" });
  });

  it("accepts a valid youtube-content question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", youtubeContent(), "答案")] }] });
    expect(bank.pools[1][0]).toEqual({ kind: "text", id: "a1", content: youtubeContent(), answer: "答案" });
  });

  it("accepts an optional explanation, independently text/image/youtube from the content", () => {
    const bank = parseBank({
      ...valid(),
      rooms: [{ ...valid().rooms[0], questions: [{ ...q("a1", imageContent()), explanation: youtubeContent() }] }],
    });
    expect(bank.pools[1][0]).toMatchObject({ content: imageContent(), explanation: youtubeContent() });
  });

  it("has no explanation field at all when none was given (not an empty/undefined value)", () => {
    const bank = parseBank(valid());
    expect(bank.pools[1][0]).not.toHaveProperty("explanation");
  });

  describe("legacy shapes (backward-read conversion, docs/designs/question-media-content.md)", () => {
    it("converts a legacy bare `text: string` field into text content", () => {
      const legacy = { id: "a1", kind: "text", text: "舊格式的題目", answer: "答案" };
      const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] });
      expect(bank.pools[1][0]).toEqual({ kind: "text", id: "a1", content: textContent("舊格式的題目"), answer: "答案" });
    });

    it("converts a legacy multipleChoice question's bare `text` field the same way", () => {
      const legacy = { id: "a1", kind: "multipleChoice", text: "舊格式選擇題", options: ["A", "B"], correctIndex: 0 };
      const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] });
      expect(bank.pools[1][0]).toMatchObject({ content: textContent("舊格式選擇題") });
    });

    it("converts a legacy top-level `image` kind (text + imageKey) into a text question with image content", () => {
      const legacy = { id: "a1", kind: "image", text: "本題有圖", answer: "松鼠", imageKey: UUID_C };
      const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] });
      expect(bank.pools[1][0]).toEqual({ kind: "text", id: "a1", content: imageContent(UUID_C), answer: "松鼠" });
    });

    it("still validates a legacy image kind's imageKey shape", () => {
      const legacy = { id: "a1", kind: "image", text: "x", answer: "y", imageKey: "not-a-uuid" };
      expect(() => parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [legacy] }] })).toThrow(/question bank/i);
    });
  });
});

describe("lookups", () => {
  const bank = parseBank(valid());

  it("roomTemplates keeps the difficulty and reward per room, and poolQuestionIds the ids per difficulty", () => {
    expect(roomTemplates(bank)).toEqual([{ baseDifficulty: 1, reward: 10 }]);
    expect(poolQuestionIds(bank)).toEqual([["a1", "a2"], [], [], [], []]);
  });

  it("findQuestion returns content, answer and its pool difficulty, or undefined", () => {
    expect(findQuestion(bank, "a2")).toMatchObject({ content: textContent(), answer: "答案", difficulty: 1, boss: false });
    expect(findQuestion(bank, "b1")).toMatchObject({ boss: true });
    expect(findQuestion(bank, "nope")).toBeUndefined();
  });

  it("publicQuestion never contains the answer, correctIndex, or explanation, even in the shipped bank", () => {
    for (const item of allQuestions(BANK)) {
      {
        const pub = publicQuestion(BANK, item.id, 0, "");
        // A multipleChoice answer is one of its public options; only which one stays hidden.
        if (item.kind !== "multipleChoice") expect(JSON.stringify(pub)).not.toContain(answerText(item));
        expect(pub).not.toHaveProperty("answer");
        expect(pub).not.toHaveProperty("correctIndex");
        expect(pub).not.toHaveProperty("explanation");
      }
    }
    expect(publicQuestion(BANK, "nope", 0, "")).toBeNull();
  });

  it("answerText reads a text question's answer, and a multipleChoice question's correct option", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("mc1", ["A", "B", "C"], 1)] }] });
    expect(answerText(bank.pools[1][0])).toBe("B");
    expect(answerText(findQuestion(bank, "b1")!)).toBe("答案");
  });

  it("publicQuestion includes options (but never correctIndex) for a multipleChoice question, and no options field for text", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1"), mc("mc1", ["A", "B", "C"], 1)] }] });
    const pub = publicQuestion(bank, "mc1", 0, "")!;
    expect(pub.options).toEqual(["A", "B", "C"]);
    expect(pub).not.toHaveProperty("correctIndex");
    expect(publicQuestion(bank, "a1", 0, "")).not.toHaveProperty("options");
  });

  it("publicQuestion's content is text pass-through for a text-content question", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", textContent("你好"))] }] });
    expect(publicQuestion(bank, "a1", 0, "")!.content).toEqual({ kind: "text", value: "你好" });
  });

  it("publicQuestion prepends imageBaseUrl to an image-content question's stored key, and never leaks the answer", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1"), q("img1", imageContent(UUID_C), "松鼠")] }] });
    const pub = publicQuestion(bank, "img1", 0, "https://pub-example.r2.dev")!;
    expect(pub.content).toEqual({ kind: "image", url: `https://pub-example.r2.dev/${UUID_C}` });
    expect(pub).not.toHaveProperty("answer");
    expect(publicQuestion(bank, "a1", 0, "https://pub-example.r2.dev")!.content.kind).toBe("text");
  });

  it("publicQuestion's content is the videoId for a youtube-content question, never the raw stored value re-wrapped as a URL", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", youtubeContent())] }] });
    expect(publicQuestion(bank, "a1", 0, "")!.content).toEqual({ kind: "youtube", videoId: YT_ID });
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
    const pub = publicQuestion(bank, "img1", 0, base)!;
    expect(pub.content).toEqual({ kind: "image", url: `${base}/${UUID_C}` }); // still builds a URL — the warning doesn't block it
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("image_base_url_missing"));
    spy.mockRestore();
  });

  it("publicQuestion does not log image_base_url_missing for a real, configured base URL", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("img1", imageContent(UUID_C), "松鼠")] }] });
    publicQuestion(bank, "img1", 0, "https://pub-real.r2.dev");
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
