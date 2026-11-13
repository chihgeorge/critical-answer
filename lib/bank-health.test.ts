import { describe, it, expect, vi, afterEach } from "vitest";
import { checkMediaBatch, healthReport, mediaBatches, MAX_YOUTUBE_PER_BATCH, type MediaDeps } from "./bank-health";
import { assertSavable, savableProblems, type Bank, type BankQuestion } from "./question-bank";
import { healthSummary } from "@/components/bank-health";

const BASE = "https://pub.example.r2.dev";
const KEY = "11111111-2222-3333-4444-555555555555";
const KEY2 = "66666666-7777-8888-9999-000000000000";
const yt = (n: number) => `vid${String(n).padStart(8, "0")}`;
const text = (id: string, extra: Partial<BankQuestion> = {}): BankQuestion => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案-${id}`, ...extra }) as BankQuestion;
const bank = (pool: BankQuestion[], boss: BankQuestion[] = [text("b1")]): Bank => ({
  pools: { 1: pool, 2: [], 3: [], 4: [], 5: [] },
  rooms: [{ monster: "slime-soft", difficulty: 1, reward: 10 }],
  boss: { monster: "dragon", hitReward: 10, phases: [{ name: "", rule: "", maxHp: 10, questions: boss }] },
});

const res = (status: number) => ({ status, body: { cancel: vi.fn(async () => {}) } }) as unknown as Response;
function deps(statusOf: (url: string) => number | Error, files: Record<string, Uint8Array | null> = {}): MediaDeps & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async (url: RequestInfo | URL) => {
      const s = statusOf(String(url));
      if (s instanceof Error) throw s;
      return res(s);
    }),
    readStart: async (key) => (key in files ? files[key] : new Uint8Array(8)),
  } as MediaDeps & { fetch: ReturnType<typeof vi.fn> };
}

afterEach(() => vi.useRealTimers());

describe("savableProblems", () => {
  it("lists every save-time problem, and assertSavable still throws the first", () => {
    const b = bank([{ kind: "multipleChoice", id: "mc", content: { kind: "text", value: "?" }, options: ["a", "b", "c", "d", "e"], correctIndex: 0 }]);
    b.boss.phases.push({ name: "這個名字真的太長了超過十二個字", rule: "規則", maxHp: 5, questions: [text("b2")] });
    expect(savableProblems(b)).toEqual(["question mc has more than 4 options", "boss phase 2 name is over 12 characters"]);
    expect(() => assertSavable(b)).toThrow("question mc has more than 4 options");
    expect(savableProblems(bank([text("q1")]))).toEqual([]);
  });
});

describe("mediaBatches", () => {
  it("looks up each video and file once, 40 videos a batch, files and the public URL in the first", () => {
    const pool = Array.from({ length: MAX_YOUTUBE_PER_BATCH + 1 }, (_, i) => text(`q${i}`, { content: { kind: "youtube", value: yt(i) } }));
    pool.push(text("dup", { content: { kind: "youtube", value: yt(0) }, explanation: { kind: "video", value: KEY } }));
    pool.push(text("img", { content: { kind: "image", value: KEY }, explanation: { kind: "audio", value: KEY2 } }));
    const batches = mediaBatches(bank(pool), BASE);
    expect(batches.map((b) => b.youtube.length)).toEqual([40, 1]);
    expect(batches[0].files).toEqual([
      { key: KEY, video: true },
      { key: KEY2, video: false },
    ]);
    expect(batches[0].publicBase).toBe(BASE);
    expect(batches[1]).toEqual({ youtube: [yt(40)], files: [] });
  });

  it("has nothing to look up in a text-only bank, and no public URL without a base", () => {
    expect(mediaBatches(bank([text("q1")]), BASE)).toEqual([]);
    expect(mediaBatches(bank([text("q1", { content: { kind: "image", value: KEY } })]), "")[0].publicBase).toBeUndefined();
  });
});

describe("checkMediaBatch", () => {
  it("reads oEmbed: 200 ok, 401 private, 400/404 gone, anything else or a throw unknown", async () => {
    const codes: Record<string, number | Error> = { [yt(1)]: 200, [yt(2)]: 401, [yt(3)]: 404, [yt(4)]: 400, [yt(5)]: 429, [yt(6)]: new Error("net") };
    const d = deps((url) => codes[Object.keys(codes).find((id) => url.includes(id))!]);
    const out = await checkMediaBatch({ youtube: Object.keys(codes), files: [] }, d);
    expect(out.youtube).toEqual({ [yt(1)]: "ok", [yt(2)]: "private", [yt(3)]: "gone", [yt(4)]: "gone", [yt(5)]: "unknown", [yt(6)]: "unknown" });
    expect(d.fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("runs at most six requests at once and never reads a body", async () => {
    let open = 0;
    let most = 0;
    const bodies: { cancel: ReturnType<typeof vi.fn> }[] = [];
    const d: MediaDeps = {
      fetch: (async () => {
        most = Math.max(most, ++open);
        await new Promise((r) => setTimeout(r, 1));
        open--;
        const body = { cancel: vi.fn(async () => {}) };
        bodies.push(body);
        return { status: 200, body } as unknown as Response;
      }) as typeof fetch,
      readStart: async () => null,
    };
    await checkMediaBatch({ youtube: Array.from({ length: 15 }, (_, i) => yt(i)), files: [] }, d);
    expect(most).toBe(6);
    expect(bodies.every((b) => b.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("times a stuck request out as unknown", async () => {
    vi.useFakeTimers();
    const d: MediaDeps = {
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("timeout"))))) as unknown as typeof fetch,
      readStart: async () => null,
    };
    const run = checkMediaBatch({ youtube: [yt(1)], files: [] }, d);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await run).youtube[yt(1)]).toBe("unknown");
  });

  it("finds a missing file, an HEVC video, and whether the bucket is public", async () => {
    const hevc = new TextEncoder().encode("....ftypisom....moov....stsd....hvc1....");
    const d = deps((url) => (url.startsWith(`${BASE}/`) ? 403 : 200), { [KEY]: null, [KEY2]: hevc });
    const out = await checkMediaBatch({ youtube: [], files: [{ key: KEY, video: true }, { key: KEY2, video: true }], publicBase: BASE }, d);
    expect(out.files).toEqual({ [KEY]: "missing", [KEY2]: "hevc" });
    expect(out.publicOk).toBe(false);
    // The public check fetches a file that exists, never the missing one.
    expect(d.fetch.mock.calls.map(([url]) => String(url))).toEqual([`${BASE}/${KEY2}`]);
    // With every file missing there is nothing to fetch: the bucket stays unconfirmed.
    const none = await checkMediaBatch({ youtube: [], files: [{ key: KEY, video: false }], publicBase: BASE }, d);
    expect(none.publicOk).toBeUndefined();
    // The same bytes in an image are not a codec.
    expect((await checkMediaBatch({ youtube: [], files: [{ key: KEY2, video: false }] }, d)).files[KEY2]).toBe("ok");
  });
});

describe("healthReport", () => {
  it("has no rows for a healthy text bank", () => {
    expect(healthReport(bank([text("q1")]), { youtube: {}, files: {} }, BASE)).toEqual({ rows: [], questions: 2, unchecked: 0 });
  });

  it("names each question with a broken medium, red or yellow, without answers, ids or keys", () => {
    const b = bank(
      [
        text("q1", { content: { kind: "youtube", value: yt(1) }, prompt: "這首歌的歌名是什麼呢請大聲說出來" }),
        text("q2", { content: { kind: "youtube", value: yt(1) } }),
        text("q3", { explanation: { kind: "video", value: KEY } }),
        text("q4", { explanation: { kind: "instagram", value: "Cabc123" } }),
      ],
      [{ ...text("b1"), content: { kind: "image", value: KEY2 } } as BankQuestion],
    );
    const { rows, unchecked } = healthReport(b, { youtube: { [yt(1)]: "private" }, files: { [KEY]: "hevc" }, publicOk: true }, BASE);
    expect(rows).toEqual([
      { level: "red", questionId: "q1", where: "難度 1", label: "這首歌的歌名是什麼呢請大聲說出來", problem: expect.stringContaining("不給嵌入") },
      { level: "red", questionId: "q2", where: "難度 1", problem: expect.stringContaining("不給嵌入") },
      { level: "yellow", questionId: "q3", where: "難度 1", label: "題目 q3", problem: expect.stringMatching(/^詳解：.*HEVC/) },
      // A lookup with no result (its batch failed) is never green.
      { level: "yellow", questionId: "b1", where: "首領第 1 階段", problem: expect.stringContaining("沒辦法確認") },
    ]);
    expect(unchecked).toBe(1);
    const all = JSON.stringify(rows);
    for (const secret of ["答案-", yt(1), KEY, KEY2]) expect(all).not.toContain(secret);
  });

  it("reports the bucket for the whole bank: no base URL, not public, or not confirmed", () => {
    const b = bank([text("q1", { content: { kind: "image", value: KEY } })]);
    const ok = { youtube: {}, files: { [KEY]: "ok" as const } };
    expect(healthReport(b, ok, "https://REPLACE-ME.r2.dev").rows).toEqual([{ level: "red", where: "題庫", problem: expect.stringContaining("R2_PUBLIC_BASE_URL") }]);
    expect(healthReport(b, { ...ok, publicOk: false }, BASE).rows[0]).toMatchObject({ level: "red", where: "題庫" });
    expect(healthReport(b, { ...ok, publicOk: null }, BASE).rows[0]).toMatchObject({ level: "yellow", where: "題庫" });
    expect(healthReport(b, { ...ok, publicOk: true }, BASE).rows).toEqual([]);
  });

  it("turns each save-time problem into a red whole-bank row", () => {
    const b = bank([{ kind: "multipleChoice", id: "mc", content: { kind: "text", value: "?" }, options: ["a", "b", "c", "d", "e"], correctIndex: 0 }]);
    expect(healthReport(b, { youtube: {}, files: {} }, BASE).rows).toEqual([{ level: "red", where: "題庫", problem: "存檔檢查沒過：question mc has more than 4 options" }]);
  });
});

describe("healthSummary (host page)", () => {
  it("puts red first and counts a question with two rows once", () => {
    const s = healthSummary({
      questions: 10,
      unchecked: 0,
      reloaded: true,
      rows: [
        { level: "yellow", questionId: "a", where: "難度 1", problem: "y" },
        { level: "red", questionId: "a", where: "難度 1", problem: "r" },
        { level: "red", where: "題庫", problem: "bank" },
      ],
    });
    expect(s.rows.map((r) => r.level)).toEqual(["red", "red", "yellow"]);
    expect(s).toMatchObject({ red: 2, yellow: 1, ok: 9 });
  });
});
