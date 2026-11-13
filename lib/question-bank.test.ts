import { describe, it, expect, vi } from "vitest";
import { memoryProblem, memoryView, parseBank, isClip, isMusicQuestion, hiddenVideo, roomTemplates, poolQuestionIds, shuffledOptionOrders, inShownOrder, allQuestions, DIFFICULTIES, findQuestion, publicQuestion, publicExplanation, publicMediaContent, answerText, imageKeysOf, textQuestionGaps, bossPhaseStates, bossDifficulties, type MediaContent } from "./question-bank";
import { BANK } from "./question-bank-data";
import { MONSTERS, catalogMonster, variantOf } from "./monster-catalog";
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
  rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [q("a1"), q("a2")] }],
  boss: { monster: "dragon", maxHp: 3, questions: [q("b1")] },
});

const phase1 = () => ({ maxHp: 3, questions: [q("b1")] });

describe("boss phases", () => {
  it("a buzzer phase (boss-buzzer.md) is kept, never the first phase, and holds only fill-in questions", () => {
    const later = (extra: object) => ({ ...valid(), boss: { monster: "dragon", phases: [phase1(), { name: "搶答", rule: "聽前奏搶答", maxHp: 2, questions: [q("c1")], ...extra }] } });
    expect(parseBank(later({ buzzer: true })).boss.phases[1].buzzer).toBe(true);
    expect(parseBank(later({ buzzer: false })).boss.phases[1]).not.toHaveProperty("buzzer");
    expect(() => parseBank(later({ buzzer: "yes" }))).toThrow(/buzzer/);
    expect(() => parseBank(later({ buzzer: true, questions: [mc("c1")] }))).toThrow(/fill-in/);
    expect(() => parseBank({ ...valid(), boss: { monster: "dragon", phases: [{ ...phase1(), buzzer: true }] } })).toThrow(/first boss phase/);
  });

  describe("timing questions (timing-tap.md)", () => {
    const clip = { kind: "youtube", value: YT_ID, audioOnly: true, start: 170, end: 200 };
    const tq = (extra: object = {}) => ({ kind: "timing", id: "b-tap-1", content: clip, target: 190.35, label: "蹬", ...extra });
    const at = (question: object, buzzer = true) => parseBank({ ...valid(), boss: { monster: "dragon", phases: [phase1(), { name: "卡點", rule: "聽到就按", maxHp: 2, ...(buzzer ? { buzzer: true } : {}), questions: [question] }] } });
    const err = (question: object, buzzer = true) => () => at(question, buzzer);

    it("keeps a buzzer phase's timing question, with a public label and a m:ss.cc answer, and no target on the wire", () => {
      const bank = at(tq());
      expect(bank.boss.phases[1].questions[0]).toEqual({ kind: "timing", id: "b-tap-1", content: clip, target: 190.35, label: "蹬" });
      expect(answerText(bank.boss.phases[1].questions[0])).toBe("3:10.35「蹬」");
      expect(answerText(at(tq({ label: undefined })).boss.phases[1].questions[0])).toBe("3:10.35");
      const pub = publicQuestion(bank, "b-tap-1", 0, "");
      expect(pub).toMatchObject({ timing: { label: "蹬" }, content: { kind: "youtube", audioOnly: true } });
      expect(JSON.stringify(pub)).not.toMatch(/190|target/);
      // An uploaded clip has no start: a target from 0 on.
      expect(at(tq({ content: { kind: "audio", value: UUID_A }, target: 0.5 })).boss.phases[1].questions).toHaveLength(1);
      expect(shuffledOptionOrders(bank, () => 0)).not.toHaveProperty("b-tap-1");
    });

    it("refuses a bad target, a long label, a clip that is not one, and anywhere but a buzzer phase, with the numbers in the message", () => {
      expect(err(tq({ target: 169.5 }))).toThrow("question b-tap-1: target 169.5 is before the clip start 170");
      expect(err(tq({ target: 199 }))).toThrow("question b-tap-1: target 199 + 2 s grace is past the clip end 200");
      expect(err(tq({ target: 190.3501 }))).toThrow("question b-tap-1: target has more than 3 decimals");
      expect(err(tq({ memory: true, prompt: "聽" }))).toThrow("question b-tap-1: a timing question cannot be a memory question");
      expect(err(tq({ target: "190" }))).toThrow(/target is not a number/);
      expect(err(tq({ label: "一二三四五六七八九十一" }))).toThrow("question b-tap-1: label is longer than 10 characters");
      expect(err(tq({ content: { kind: "image", value: UUID_A } }))).toThrow("question b-tap-1: a timing question needs a YouTube or uploaded video/audio clip");
      expect(err(tq(), false)).toThrow("question b-tap-1 is a timing question, so it must be in a buzzer phase");
      expect(() => parseBank({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [tq()] }] })).toThrow(/must be in a buzzer phase/);
      // The buzzer-phase contract still refuses every other kind (multiple choice here).
      expect(err(mc("c1"))).toThrow("is a buzzer phase, so every question in it must be a fill-in or a timing question");
    });

    // Value: protects=the copy-paste example in docs/question-bank.md and its English twin parses (timing-tap.md DX); fails_when=docs and parseBank drift; seam=reads the docs files
    it.each(["docs/question-bank.md", "docs/question-bank.en.md"])("the example in %s parses as is", async (file) => {
      const { readFileSync } = await import("node:fs");
      const block = readFileSync(file, "utf8").match(/```json\n(\{\n\s+"name"[\s\S]*?"kind": "timing"[\s\S]*?)\n```/);
      expect(block).not.toBeNull();
      const phase = JSON.parse(block![1]);
      expect(parseBank({ ...valid(), boss: { monster: "dragon", phases: [phase1(), phase] } }).boss.phases[1].questions[0].kind).toBe("timing");
    });
  });

  it("keeps a question's category trimmed, drops a blank one, refuses one that is not text or too long (boss-music-buzzer.md)", () => {
    const withCat = (category: unknown) => parseBank({ ...valid(), boss: { monster: "dragon", phases: [{ maxHp: 3, questions: [{ ...q("b1"), category }] }] } }).boss.phases[0].questions[0];
    expect(withCat(" 動漫 ").category).toBe("動漫");
    expect(withCat("  ")).not.toHaveProperty("category");
    expect(parseBank(valid()).boss.phases[0].questions[0]).not.toHaveProperty("category");
    expect(() => withCat(3)).toThrow(/category/);
    expect(() => withCat("字".repeat(21))).toThrow(/category/);
    expect(parseBank({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [{ ...mc("a1"), category: "遊戲" }] }] }).pools[1][0].category).toBe("遊戲");
  });

  it("a buzzer phase's music question may have 2–3 fields; its answer is theirs joined; anywhere else they are refused (multi-field.md F1)", () => {
    const music = (extra: object) => ({ kind: "text", id: "m1", content: { kind: "youtube", value: YT_ID, audioOnly: true }, answer: "舊", ...extra });
    const two = [{ label: " 歌名 ", answer: " 晴天 " }, { label: "歌手", answer: "周杰倫" }];
    const at = (question: object, buzzer = true) => parseBank({ ...valid(), boss: { monster: "dragon", phases: [phase1(), { name: "搶答", rule: "聽", maxHp: 2, ...(buzzer ? { buzzer: true } : {}), questions: [question] }] } });
    expect(at(music({ fields: two })).boss.phases[1].questions[0]).toMatchObject({ answer: "晴天／周杰倫", fields: [{ label: "歌名", answer: "晴天" }, { label: "歌手", answer: "周杰倫" }] });
    expect(at(music({ answer: undefined, fields: two })).boss.phases[1].questions[0]).toMatchObject({ answer: "晴天／周杰倫" });
    expect(at(music({})).boss.phases[1].questions[0]).not.toHaveProperty("fields");
    expect(() => at(music({ fields: [two[0]] }))).toThrow(/2 to 3 fields/);
    expect(() => at(music({ fields: [...two, ...two] }))).toThrow(/2 to 3 fields/);
    expect(() => at(music({ fields: [two[0], { label: "", answer: "x" }] }))).toThrow(/label/);
    expect(() => at(music({ fields: [two[0], { label: "歌手", answer: " " }] }))).toThrow(/answer/);
    expect(() => at(music({ fields: [two[0], { label: "字".repeat(11), answer: "x" }] }))).toThrow(/label/);
    // Not a buzzer phase, not sound only, or not in the boss at all.
    expect(() => at(music({ fields: two }), false)).toThrow(/fields/);
    expect(() => at({ ...music({ fields: two }), content: { kind: "youtube", value: YT_ID } })).toThrow(/fields/);
    expect(() => at({ ...q("m1"), fields: two })).toThrow(/fields/);
    expect(() => parseBank({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [music({ fields: two })] }] })).toThrow(/fields/);
    expect(() => at({ ...mc("m1"), fields: two })).toThrow(/fields/);
  });

  it("publicQuestion carries a music question's field labels, never their answers", () => {
    const bank = parseBank({ ...valid(), boss: { monster: "dragon", phases: [phase1(), { name: "搶答", rule: "聽", maxHp: 2, buzzer: true, questions: [{ kind: "text", id: "m1", content: { kind: "youtube", value: YT_ID, audioOnly: true }, fields: [{ label: "歌名", answer: "晴天" }, { label: "歌手", answer: "周杰倫" }] }] }] } });
    const pub = publicQuestion(bank, "m1", 0, "");
    expect(pub?.fields).toEqual(["歌名", "歌手"]);
    expect(JSON.stringify(pub)).not.toMatch(/晴天|周杰倫/);
    expect(publicQuestion(bank, "b1", 0, "")).not.toHaveProperty("fields");
  });

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

  it("a boss question may carry its own difficulty: kept, listed below 5, never on a pool question", () => {
    const b = parseBank({ ...valid(), boss: { monster: "dragon", phases: [{ maxHp: 3, questions: [q("b1"), { ...q("b2"), difficulty: 2 }, { ...q("b3"), difficulty: 5 }, { ...q("b4"), difficulty: 2 }] }] } });
    expect(findQuestion(b, "b2")).toMatchObject({ boss: true, difficulty: 2 });
    expect(findQuestion(b, "b1")).toMatchObject({ difficulty: 5 });
    // An explicit 5 is the default: stored as no difficulty, so the bank keeps its older format.
    expect(b.boss.phases[0].questions.find((x) => x.id === "b3")).not.toHaveProperty("difficulty");
    expect(bossPhaseStates(b)[0].questionIds).toEqual(["b1", "b2", "b3", "b4"]);
    expect(bossDifficulties(b)).toEqual({ b2: 2, b4: 2 });
    expect(() => parseBank({ ...valid(), boss: { monster: "dragon", phases: [{ maxHp: 3, questions: [{ ...q("b1"), difficulty: 6 }] }] } })).toThrow(/difficulty 6/);
    const pooled = { pools: { 1: [{ ...q("x1"), difficulty: 1 }] }, rooms: [{ monster: "slime-soft", difficulty: 1 }], boss: valid().boss };
    expect(() => parseBank(pooled)).toThrow(/only a boss question/);
  });
});

describe("shipped bank", () => {
  const all = allQuestions(BANK);

  it("has 8 rooms of difficulty 1/2/2/3/4/4/5/5 paying 10/20/20/30/40/40/50/50 (scoring-and-score-pools.md S9, S12)", () => { // pregate-literal: MAX_BOSS_HP=20 not the HP cap
    expect(BANK.rooms.map((r) => r.difficulty)).toEqual([1, 2, 2, 3, 4, 4, 5, 5]);
    expect(BANK.rooms.map((r) => r.reward)).toEqual([10, 20, 20, 30, 40, 40, 50, 50]); // pregate-literal: MAX_BOSS_HP=20 not the HP cap
    // Eight different room monsters (monster-catalog.md PR2 item 5).
    expect(new Set(BANK.rooms.map((r) => r.monster)).size).toBe(8);
    expect(BANK.boss.monster).toBe("dragon");
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

  it("keeps randomMonsters only when it is true, and refuses a value that is not true or false", () => {
    expect(parseBank({ ...valid(), randomMonsters: true }).randomMonsters).toBe(true);
    expect(parseBank({ ...valid(), randomMonsters: false })).not.toHaveProperty("randomMonsters");
    expect(() => parseBank({ ...valid(), randomMonsters: "yes" })).toThrow(/randomMonsters/);
    expect(parseBank(valid())).not.toHaveProperty("randomMonsters");
  });

  const pooled = () => ({
    pools: { "1": [q("a1"), q("a2")], "3": [q("c1")] },
    rooms: [
      { monster: "slime-soft", difficulty: 1, reward: 10 },
      { monster: "ghost-shy", difficulty: 3, reward: 99 },
    ],
    boss: { monster: "dragon", maxHp: 3, hitReward: 10, questions: [q("b1")] },
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
        { monster: "slime-soft", baseDifficulty: 2, questions: [q("x1")] },
        { monster: "ghost-shy", baseDifficulty: 2, questions: [q("x2")] },
      ],
      boss: { monster: "dragon", maxHp: 3, questions: [q("b1")] },
    });
    expect(b.pools[2].map((x) => x.id)).toEqual(["x1", "x2"]);
    expect(b.rooms.map((r) => [r.difficulty, r.reward])).toEqual([[2, 20], [2, 20]]); // pregate-literal: MAX_BOSS_HP=20 not the HP cap
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
    expect(publicQuestion(b, "m1", 1, "", [2, 1, 0])).toMatchObject({ monster: { id: "ghost-shy", name: "害羞幽靈" }, options: ["C", "B", "A"] });
    expect(publicQuestion(b, "b1", 0, "")).toMatchObject({ monster: { id: "dragon", name: "深淵小黑龍" }, boss: true });
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
    // Value: protects=a non-text phase name fails as an invalid bank, not a TypeError; fails_when=the type guard
    // before trim() is dropped; why_new=rows only had missing or blank names; seam=none; no_claim=none beyond protects
    ["a boss phase name that is not text", () => ({ ...valid(), boss: { monster: valid().boss.monster, phases: [{ ...phase1(), name: 5 }] } })],
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

  describe("Instagram explanations (docs/designs/instagram-explanations.md)", () => {
    const one = (question: Record<string, unknown>) => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [question] }] });
    const insta = (extra: Record<string, unknown> = {}) => ({ kind: "instagram", value: "DPPHHjlkTgr", ...extra }) as unknown as MediaContent;

    it("keeps an Instagram explanation with its optional length, and STATE's form hides the shortcode", () => {
      const bank = parseBank(one({ ...q("a1"), explanation: insta({ end: 35 }) }));
      expect(bank.pools[1][0].explanation).toEqual({ kind: "instagram", value: "DPPHHjlkTgr", end: 35 });
      expect(publicExplanation(bank, "a1", "")).toEqual({ kind: "instagram" });
      expect(parseBank(one({ ...q("a1"), explanation: insta() })).pools[1][0].explanation).toEqual({ kind: "instagram", value: "DPPHHjlkTgr" });
    });

    it.each([
      ["Instagram as a question's content", () => one(q("a1", insta()))],
      ["an invalid shortcode", () => one({ ...q("a1"), explanation: insta({ value: "bad code!" }) })],
      ["a start on an Instagram video", () => one({ ...q("a1"), explanation: insta({ start: 5 }) })],
      ["audioOnly on an Instagram video", () => one({ ...q("a1"), explanation: insta({ audioOnly: true }) })],
      ["a zero length", () => one({ ...q("a1"), explanation: insta({ end: 0 }) })],
    ])("fails loudly on %s", (_name, make) => {
      expect(() => parseBank(make())).toThrow(/question bank/i);
    });
  });

  describe("uploaded video and audio (docs/designs/uploaded-media.md)", () => {
    const one = (question: Record<string, unknown>) => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [question] }] });
    const video: MediaContent = { kind: "video", value: UUID_A };
    const audio: MediaContent = { kind: "audio", value: UUID_B };

    it("keeps an uploaded video or audio in the question and in its explanation", () => {
      const bank = parseBank(one({ ...q("a1", video), explanation: audio }));
      expect(bank.pools[1][0].content).toEqual(video);
      expect(bank.pools[1][0].explanation).toEqual(audio);
      expect(parseBank(one({ ...q("a1", audio), explanation: video })).pools[1][0].content).toEqual(audio);
    });

    it("rejects a key that is not a UUID, and clip fields only YouTube has", () => {
      expect(() => parseBank(one(q("a1", { kind: "video", value: "not-a-key" })))).toThrow(/invalid video key/);
      expect(() => parseBank(one(q("a1", { kind: "audio", value: "x" })))).toThrow(/invalid audio key/);
      expect(() => parseBank(one(q("a1", { ...video, start: 3 })))).toThrow(/only a YouTube video/);
      expect(() => parseBank(one(q("a1", { ...audio, audioOnly: true })))).toThrow(/only a YouTube video/);
    });

    it("never puts the key or a URL in the public question or explanation", () => {
      const bank = parseBank(one({ ...q("a1", audio), explanation: video }));
      const pub = publicQuestion(bank, "a1", 0, "https://img.example.com");
      expect(pub?.content).toEqual({ kind: "youtube", audioOnly: true });
      expect(publicExplanation(bank, "a1", "https://img.example.com")).toEqual({ kind: "file" });
      expect(JSON.stringify(pub)).not.toContain(UUID_B);
      const withVideo = parseBank(one({ ...q("a1", video), explanation: audio }));
      expect(publicQuestion(withVideo, "a1", 0, "")?.content).toEqual({ kind: "youtube" });
      expect(publicExplanation(withVideo, "a1", "")).toEqual({ kind: "file", audioOnly: true });
      expect(() => publicMediaContent(video, "", "a1")).toThrow(/no public form/);
    });

    it("counts audio as music, both kinds as clips, and their keys as stored files", () => {
      expect(isMusicQuestion({ kind: "text", id: "a1", content: audio, answer: "x" })).toBe(true);
      expect(isMusicQuestion({ kind: "text", id: "a1", content: video, answer: "x" })).toBe(false);
      expect([video, audio, youtubeContent(), imageContent()].map((c) => isClip(c))).toEqual([true, true, true, false]);
      expect(hiddenVideo(audio)).toEqual({ kind: "youtube", audioOnly: true });
      expect([...imageKeysOf(parseBank(one({ ...q("a1", video), explanation: audio })))].sort()).toEqual([UUID_A, UUID_B]);
    });
  });

  describe("YouTube clips and prompts (docs/designs/youtube-questions.md)", () => {
    const one = (question: Record<string, unknown>) => ({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [question] }] });
    const clip = (extra: Record<string, unknown>) => ({ kind: "youtube", value: YT_ID, ...extra }) as unknown as MediaContent;

    it.each([
      ["audioOnly on an image", () => one(q("a1", { ...imageContent(), audioOnly: true }))],
      ["start on a text content", () => one(q("a1", { ...textContent(), start: 1 }))],
      ["audioOnly that is not a boolean", () => one(q("a1", clip({ audioOnly: "yes" })))],
      ["a negative start", () => one(q("a1", clip({ start: -1 })))],
      ["a fractional end", () => one(q("a1", clip({ end: 1.5 })))],
      ["a string start", () => one(q("a1", clip({ start: "10" })))],
      ["end equal to start", () => one(q("a1", clip({ start: 10, end: 10 })))],
      ["end before start", () => one(q("a1", clip({ start: 10, end: 5 })))],
      ["end 0 with no start", () => one(q("a1", clip({ end: 0 })))],
      ["an audioOnly explanation", () => one({ ...q("a1"), explanation: clip({ audioOnly: true }) })],
      ["a prompt on a text question", () => one({ ...q("a1"), prompt: "題幹" })],
      ["an empty prompt", () => one({ ...q("a1", youtubeContent()), prompt: "  " })],
      ["a prompt that is not a string", () => one({ ...q("a1", youtubeContent()), prompt: 3 })],
      ["a prompt over 200 characters", () => one({ ...q("a1", youtubeContent()), prompt: "字".repeat(201) })],
    ])("fails loudly on %s", (_name, make) => {
      expect(() => parseBank(make())).toThrow(/question bank/i);
    });

    it("keeps a music clip and a prompt, on both kinds", () => {
      const music = clip({ audioOnly: true, start: 65, end: 80 });
      const bank = parseBank(one({ ...q("a1", music), prompt: "這首歌是什麼的主題曲？" }));
      expect(bank.pools[1][0]).toEqual({ kind: "text", id: "a1", content: { kind: "youtube", value: YT_ID, audioOnly: true, start: 65, end: 80 }, prompt: "這首歌是什麼的主題曲？", answer: "答案" });
      const mcBank = parseBank(one({ ...mc("a1", ["A", "B"], 0, imageContent()), prompt: "這是哪裡？" }));
      expect(mcBank.pools[1][0]).toMatchObject({ prompt: "這是哪裡？" });
    });

    it("accepts a 200-character prompt, a start with no end, and an explanation clip that is not audioOnly", () => {
      expect(() => parseBank(one({ ...q("a1", clip({ start: 0 })), prompt: "字".repeat(200) }))).not.toThrow();
      expect(() => parseBank(one({ ...q("a1"), explanation: clip({ start: 5, end: 30 }) }))).not.toThrow();
    });

    it("drops audioOnly: false instead of storing it", () => {
      const bank = parseBank(one(q("a1", clip({ audioOnly: false, end: 20 })))); // pregate-literal: MAX_BOSS_HP=20 not the HP cap
      expect(bank.pools[1][0].content).toEqual({ kind: "youtube", value: YT_ID, end: 20 }); // pregate-literal: MAX_BOSS_HP=20 not the HP cap
    });

    it("publicQuestion carries the prompt and that it is a video, never the answer or the video id (screen-video-key.md)", () => {
      const bank = parseBank(one({ ...q("a1", clip({ audioOnly: true, start: 65, end: 80 })), prompt: "題幹" }));
      const pub = publicQuestion(bank, "a1", 0, "")!;
      expect(pub.content).toEqual({ kind: "youtube", audioOnly: true });
      expect(JSON.stringify(pub)).not.toContain(YT_ID);
      expect(pub.prompt).toBe("題幹");
      expect(JSON.stringify(pub)).not.toContain("答案");
    });
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
    expect(roomTemplates(bank)).toEqual([{ baseDifficulty: 1, reward: 10, monsterId: "slime-soft", dish: "史萊姆寒天涼拌" }]);
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

  it("publicQuestion's content says only that a youtube-content question is a video: its id would give the answer away", () => {
    const bank = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [q("a1", youtubeContent())] }] });
    expect(publicQuestion(bank, "a1", 0, "")!.content).toEqual({ kind: "youtube" });
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
          monster: "slime-soft",
          baseDifficulty: 1,
          questions: [
            q("a1"), // text content, no image
            q("a2", imageContent("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")), // image content
            mc("a3", ["X", "Y"]), // multipleChoice, text content
            { ...q("a4"), explanation: imageContent("cccccccc-cccc-cccc-cccc-cccccccccccc") }, // image explanation only
          ],
        },
      ],
      boss: { monster: "dragon", maxHp: 3, questions: [q("b1", imageContent("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"))] },
    });
    expect(imageKeysOf(bank)).toEqual(
      new Set(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "cccccccc-cccc-cccc-cccc-cccccccccccc"]),
    );
  });
});

describe("catalog monsters (docs/designs/monster-catalog.md §2)", () => {
  const room0 = (monster: unknown) => ({ ...valid(), rooms: [{ ...valid().rooms[0], monster }] });

  // Value: protects=a bank from before the catalog is refused with the message the editor shows; fails_when=an object monster is accepted or the message loses 題庫格式太舊; why_new=new format (D6); seam=none; no_claim=how the editor shows it
  it("refuses a whole monster object as the format before the catalog", () => {
    expect(() => parseBank(room0({ name: "史萊姆", sprite: "slime", hue: 0 }))).toThrow(/^題庫格式太舊：rooms\[0\]\.monster/);
    expect(() => parseBank({ ...valid(), boss: { ...valid().boss, monster: { name: "龍", sprite: "dragon" } } })).toThrow(/^題庫格式太舊：boss\.monster/);
  });

  // Value: protects=only catalog ids, room monsters in rooms and bosses on the boss; fails_when=an unknown id or the wrong kind passes; why_new=new format; seam=none; no_claim=the editor's own pickers
  it.each([
    ["an unknown id", () => room0("cat"), /rooms\[0\]\.monster 不是圖鑑裡的怪物：cat/],
    ["a missing monster", () => room0(undefined), /不是圖鑑裡的怪物/],
    ["a boss in a room", () => room0("dragon"), /rooms\[0\]\.monster dragon 只能當首領/],
    ["a room monster as the boss", () => ({ ...valid(), boss: { ...valid().boss, monster: "slime-soft" } }), /boss\.monster slime-soft 只能當小怪/],
  ])("refuses %s", (_, bank, why) => {
    expect(() => parseBank(bank())).toThrow(why);
  });

  // Value: protects=a room template carries its catalog id (the defeats key) and the catalog's dish name; fails_when=roomTemplates drops monsterId or reads a dish from the bank; why_new=catalog; seam=none; no_claim=the dish is served
  it("keeps the id and takes the dish from the catalog for the room template", () => {
    const bank = parseBank(valid());
    expect(bank.rooms[0].monster).toBe("slime-soft");
    expect(roomTemplates(bank)[0]).toMatchObject({ monsterId: "slime-soft", dish: "史萊姆寒天涼拌" });
  });

  // Value: protects=a repeat appearance carries the title, the recolor and the accessory into STATE, and the first stays plain; fails_when=publicQuestion ignores defeats or the hue misses the mod; why_new=new rule (D4/D5); seam=none; no_claim=rendering
  it("publicQuestion dresses a room monster by its defeats, and never the boss", () => {
    const b = parseBank(valid());
    const slime = catalogMonster("slime-soft");
    expect(publicQuestion(b, "a1", 0, "", undefined, { seed: 7, defeats: {} })?.monster).toEqual({ id: "slime-soft", name: slime.name, sprite: "slime", hue: 0 });
    const v = variantOf(7, slime, 1)!;
    expect(publicQuestion(b, "a1", 0, "", undefined, { seed: 7, defeats: { "slime-soft": 1 } })?.monster).toEqual({ id: "slime-soft", name: v.title + slime.name, sprite: "slime", hue: v.hueShift % 360, accessory: v.accessory });
    expect(publicQuestion(b, "b1", 0, "", undefined, { seed: 7, defeats: { dragon: 5 } })?.monster).toEqual({ id: "dragon", name: "深淵小黑龍", sprite: "dragon", hue: 0 });
  });

  it("no catalog dish in the shipped bank holds a 3+ character answer (the AI line would be thrown away)", () => {
    // With randomMonsters any catalog monster can come up, and its name is spoken too.
    const monsters = BANK.randomMonsters ? [...MONSTERS] : [...BANK.rooms.map((r) => r.monster), BANK.boss.monster].map(catalogMonster);
    const answers = allQuestions(BANK).map(answerText).filter((a) => a.length >= 3);
    for (const m of monsters) for (const v of [m.name, ...Object.values(m.dish)]) expect(answers.filter((a) => v.includes(a)), `${m.name}: ${v}`).toEqual([]);
  });
});

// Value: protects=the bank editor names every pool and the boss where no persuasion check can come up (dnd design
// R-E2); fails_when=an all-multiple-choice pool or boss is missed, or an empty pool or a mixed one is flagged; seam=none;
// no_claim=the editor's rendering
describe("textQuestionGaps", () => {
  it("flags only pools and a boss that have questions but no fill-in one", () => {
    expect(textQuestionGaps(parseBank(valid()))).toEqual({ difficulties: [], boss: false });
    const mcOnly = parseBank({
      ...valid(),
      rooms: [{ ...valid().rooms[0], questions: [mc("a1"), mc("a2")] }],
      boss: { ...valid().boss, questions: [mc("b1")] },
    });
    expect(textQuestionGaps(mcOnly)).toEqual({ difficulties: [1], boss: true });
    const mixed = parseBank({ ...valid(), rooms: [{ ...valid().rooms[0], questions: [mc("a1"), q("a2")] }] });
    expect(textQuestionGaps(mixed)).toEqual({ difficulties: [], boss: false });
  });
});

// Value: protects=the sort kind's bank rules and its public shape: exactly four distinct items, never shown in the
// answer's order (even without a game order), answer text for the host; fails_when=a 3-item or duplicate sort parses,
// the correct order reaches publicQuestion, or the shuffle can return the bank order; seam=none; no_claim=room judging
describe("sort questions", () => {
  const sortQ = (items: unknown) => ({ kind: "sort", id: "s1", content: { kind: "text", value: "依年齡排" }, items });
  const bankWith = (q: unknown) => ({
    pools: { 1: [q] },
    rooms: [{ monster: "slime-soft", difficulty: 1, reward: 10 }],
    boss: { monster: "dragon", phases: [{ maxHp: 1, questions: [{ kind: "text", id: "b", content: { kind: "text", value: "?" }, answer: "x" }] }] },
  });

  it("parses four distinct items and refuses anything else", () => {
    const bank = parseBank(bankWith(sortQ(["A", "B", "C", "D"])));
    expect(bank.pools[1][0]).toMatchObject({ kind: "sort", items: ["A", "B", "C", "D"] });
    expect(answerText(bank.pools[1][0])).toBe("A → B → C → D");
    expect(() => parseBank(bankWith(sortQ(["A", "B", "C"])))).toThrow(/exactly 4 items/);
    expect(() => parseBank(bankWith(sortQ(["A", "B", "C", " "])))).toThrow(/empty item/);
    expect(() => parseBank(bankWith(sortQ(["A", "B", "C", "A "])))).toThrow(/same item twice/);
  });

  it("is never shown in the answer's order", () => {
    const bank = parseBank(bankWith(sortQ(["A", "B", "C", "D"])));
    const order = shuffledOptionOrders(bank, () => 0)["s1"];
    expect(order).toEqual([3, 2, 1, 0]);
    expect(publicQuestion(bank, "s1", 0, "", order)?.items).toEqual(["D", "C", "B", "A"]);
    // No order (added after the game started): still not the bank order.
    expect(publicQuestion(bank, "s1", 0, "")?.items).toEqual(["D", "C", "B", "A"]);
    for (let i = 0; i < 50; i++) expect(shuffledOptionOrders(bank, Math.random)["s1"]).not.toEqual([0, 1, 2, 3]);
  });
});

describe("記憶題 (memory-questions.md)", () => {
  const withQ = (extra: object) => ({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [{ ...mc("m1", ["A", "B"], 0, imageContent()), prompt: "幾隻貓？", ...extra }, q("a2")] }] });
  const parsed = (extra: object) => parseBank(withQ(extra)).pools[1][0];

  it("keeps a valid image memory question and a clip one; a non-memory question keeps neither field", () => {
    expect(parsed({ memory: true, memorySeconds: 8 })).toMatchObject({ memory: true, memorySeconds: 8 });
    const clip = parseBank({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [{ ...q("v1", youtubeContent()), prompt: "誰唱的？", memory: true }, q("a2")] }] }).pools[1][0];
    expect(clip).toMatchObject({ memory: true });
    expect(clip.memorySeconds).toBeUndefined();
    expect(parsed({})).not.toHaveProperty("memory");
  });

  // Value: protects=a broken memory setup never reaches a live room, and each refusal says how to fix it.
  it("refuses each broken setup with a message that names the fix", () => {
    expect(() => parsed({ memory: false })).toThrow(/memory 只能是 true/);
    expect(() => parsed({ memory: true })).toThrow(/顯示秒數是 undefined，要是 3–60/);
    expect(() => parsed({ memory: true, memorySeconds: 2 })).toThrow(/要是 3–60 的整數/);
    expect(() => parsed({ memory: true, memorySeconds: 61 })).toThrow(/要是 3–60 的整數/);
    expect(() => parsed({ memory: true, memorySeconds: 4.5 })).toThrow(/要是 3–60 的整數/);
    expect(() => parsed({ memorySeconds: 5 })).toThrow(/只有記憶題能有 memorySeconds/);
    expect(() => parseBank({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [{ ...q("t1"), memory: true }, q("a2")] }] })).toThrow(/內容要是圖片、YouTube、影片或聲音/);
    expect(() => parseBank({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [{ ...q("v1", youtubeContent()), memory: true }, q("a2")] }] })).toThrow(/要寫題幹/);
    expect(() => parseBank({ ...valid(), rooms: [{ monster: "slime-soft", baseDifficulty: 1, questions: [{ ...q("v1", youtubeContent()), prompt: "誰？", memory: true, memorySeconds: 5 }, q("a2")] }] })).toThrow(/只有圖片記憶題能有 memorySeconds/);
    expect(memoryProblem({ memory: true, memorySeconds: 10, content: { kind: "image" }, prompt: "幾隻？" })).toBeNull();
  });

  it("memoryView: while watching only the media goes out; after, the prompt is the text and the media is gone", () => {
    const pub = { id: "m1", content: { kind: "image" as const, url: "u" }, prompt: "幾隻貓？", difficulty: 1, boss: false, monster: { name: "史萊姆", sprite: "slime" as never, hue: 0 }, options: ["1", "2"] };
    expect(memoryView(pub, false, 4000)).toEqual({ id: "m1", content: pub.content, difficulty: 1, boss: false, monster: pub.monster, memorize: true, memoryLeft: 4000 });
    expect(memoryView(pub, true)).toEqual({ id: "m1", content: { kind: "text", value: "幾隻貓？" }, difficulty: 1, boss: false, monster: pub.monster, options: ["1", "2"] });
  });
});
