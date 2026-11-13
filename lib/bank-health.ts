// The pre-game bank health check (docs/designs/bank-health-check.md): which questions will break live, and which look
// suspicious. Server-only in practice (the room and BankStoreDO call it), but it holds no bank data of its own: the
// host page imports only the HealthRow type, from lib/protocol.ts. Never import the parsed BANK here (CLAUDE.md).

import { DIFFICULTIES, savableProblems, type Bank, type BankQuestion, type MediaContent } from "./question-bank";
import type { HealthRow } from "./protocol";

/** One BankStoreDO RPC: at most this many YouTube lookups plus one public HEAD stays under the free plan's 50
 * external subrequests per invocation (D4). */
export const MAX_YOUTUBE_PER_BATCH = 40;
/** Workers keep at most six outgoing connections open at once; more would queue and time out while waiting. */
const PARALLEL = 6;
const TIMEOUT_MS = 5000;
/** Enough of an MP4's start to find its codec when `moov` comes first (D3 shortcut). */
export const HEAD_BYTES = 65536;

export interface MediaBatch {
  youtube: string[];
  files: { key: string; video: boolean }[];
  /** The bucket's public base: one file that exists is fetched through it, so can the big screen read the bucket at all? */
  publicBase?: string;
}
export type MediaStatus = "ok" | "private" | "gone" | "missing" | "hevc" | "unknown";
export interface MediaResults {
  youtube: Record<string, MediaStatus>;
  files: Record<string, MediaStatus>;
  /** null: the HEAD failed (timeout, network); absent: not checked. */
  publicOk?: boolean | null;
}
export interface MediaDeps {
  fetch: typeof fetch;
  /** The first `HEAD_BYTES` of an uploaded file, or null when there is no such object. */
  readStart(key: string): Promise<Uint8Array | null>;
}

const isFile = (c: MediaContent | undefined): c is MediaContent => c?.kind === "image" || c?.kind === "video" || c?.kind === "audio";
const baseUrlMissing = (base: string) => !base || base.includes("REPLACE-ME");

/** Every unique video id and file key in the bank, cut into RPC-sized batches; the first carries the files (an R2
 * binding read is not an external subrequest) and the public URL check. */
export function mediaBatches(bank: Bank, baseUrl: string): MediaBatch[] {
  const youtube = new Set<string>();
  const files = new Map<string, boolean>();
  for (const q of allQuestionsOf(bank)) {
    for (const c of [q.content, q.explanation]) {
      if (c?.kind === "youtube") youtube.add(c.value);
      else if (isFile(c)) files.set(c.value, (files.get(c.value) ?? false) || c.kind === "video");
    }
  }
  const ids = [...youtube];
  const batches: MediaBatch[] = [];
  for (let i = 0; i === 0 || i < ids.length; i += MAX_YOUTUBE_PER_BATCH) batches.push({ youtube: ids.slice(i, i + MAX_YOUTUBE_PER_BATCH), files: [] });
  const first = batches[0];
  first.files = [...files].map(([key, video]) => ({ key, video }));
  if (first.files.length > 0 && !baseUrlMissing(baseUrl)) first.publicBase = baseUrl;
  return batches.filter((b) => b.youtube.length > 0 || b.files.length > 0);
}

/** Runs `run` over `items`, at most `n` at a time. */
async function pool<T>(items: T[], n: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

/** A HEAD-like request: the body is never read (a ranged GET r2.dev ignores could be a whole video). */
async function status(deps: MediaDeps, url: string, method: "GET" | "HEAD"): Promise<number | null> {
  // The timeout starts here, when the pool actually sends it; redirects are not followed (each hop is a subrequest).
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { method, redirect: "manual", signal: ctl.signal });
    void res.body?.cancel().catch(() => {});
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const hasAscii = (bytes: Uint8Array, word: string) => {
  const w = Array.from(word, (ch) => ch.charCodeAt(0));
  outer: for (let i = 0; i + w.length <= bytes.length; i++) {
    for (let j = 0; j < w.length; j++) if (bytes[i + j] !== w[j]) continue outer;
    return true;
  }
  return false;
};

/** One batch's lookups, run in BankStoreDO so each batch gets a fresh subrequest budget (D4). */
export async function checkMediaBatch(batch: MediaBatch, deps: MediaDeps): Promise<MediaResults> {
  const out: MediaResults = { youtube: {}, files: {} };
  type Job = () => Promise<void>;
  const jobs: Job[] = [
    ...batch.youtube.map((id): Job => async () => {
      const s = await status(deps, `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, "GET");
      // 401: private or embedding off, so the big screen's iframe cannot play it either. 400/404: no such video.
      out.youtube[id] = s === 200 ? "ok" : s === 401 ? "private" : s === 400 || s === 404 ? "gone" : "unknown";
    }),
    ...batch.files.map(({ key, video }): Job => async () => {
      try {
        const bytes = await deps.readStart(key);
        // shortcut: only the first HEAD_BYTES are searched, so an MP4 with `moov` at the end reads as fine; read its tail too if that matters.
        out.files[key] = !bytes ? "missing" : video && (hasAscii(bytes, "hvc1") || hasAscii(bytes, "hev1")) ? "hevc" : "ok";
      } catch {
        out.files[key] = "unknown";
      }
    }),
  ];
  await pool(jobs, PARALLEL, (job) => job());
  // A file the binding just found, so a deleted one cannot make the whole bucket look private.
  const present = batch.files.find((f) => out.files[f.key] === "ok" || out.files[f.key] === "hevc");
  if (batch.publicBase && present) {
    const s = await status(deps, `${batch.publicBase}/${encodeURIComponent(present.key)}`, "HEAD");
    out.publicOk = s === null ? null : s >= 200 && s < 300;
  }
  return out;
}

interface Placed {
  q: BankQuestion;
  where: string;
}
function placedQuestions(bank: Bank): Placed[] {
  return [
    ...DIFFICULTIES.flatMap((d) => bank.pools[d].map((q) => ({ q, where: `難度 ${d}` }))),
    ...bank.boss.phases.flatMap((p, i) => p.questions.map((q) => ({ q, where: `首領第 ${i + 1} 階段` }))),
  ];
}
const allQuestionsOf = (bank: Bank) => placedQuestions(bank).map((p) => p.q);

const LABEL_CHARS = 16;
/** The question's first few characters: its text, or the line above its media. Never the answer. */
function labelOf(q: BankQuestion): string | undefined {
  const text = q.content.kind === "text" ? q.content.value : q.prompt;
  const chars = text ? Array.from(text.trim()) : [];
  return chars.length ? chars.slice(0, LABEL_CHARS).join("") + (chars.length > LABEL_CHARS ? "…" : "") : undefined;
}

const FILE_NAME = { image: "圖片", video: "影片", audio: "聲音" } as Record<string, string>;
function mediaProblem(c: MediaContent, s: MediaStatus | undefined): { level: HealthRow["level"]; problem: string } | null {
  if (c.kind === "youtube") {
    if (s === "ok") return null;
    if (s === "private") return { level: "red", problem: "YouTube 不給嵌入（私人影片或關掉嵌入），大螢幕放不出來" };
    if (s === "gone") return { level: "red", problem: "YouTube 找不到這支影片（刪掉了或網址錯）" };
    return { level: "yellow", problem: "YouTube 影片沒辦法確認（連不上或被擋），到場請實播一次" };
  }
  if (!isFile(c) || s === "ok") return null;
  if (s === "missing") return { level: "red", problem: `上傳的${FILE_NAME[c.kind]}不見了（R2 找不到檔案）` };
  if (s === "hevc") return { level: "yellow", problem: "影片是 HEVC 編碼，很多瀏覽器放不出來，請轉成 H.264 再上傳" };
  return { level: "yellow", problem: `上傳的${FILE_NAME[c.kind]}沒辦法確認，到場請實播一次` };
}

/** The rows the host sees. A lookup missing from `results` (its batch failed) reads as unknown: yellow, never green. */
export function healthReport(bank: Bank, results: MediaResults, baseUrl: string): { rows: HealthRow[]; questions: number; unchecked: number } {
  const rows: HealthRow[] = savableProblems(bank).map((p) => ({ level: "red", where: "題庫", problem: `存檔檢查沒過：${p}` }));
  const placed = placedQuestions(bank);
  const anyFile = placed.some(({ q }) => isFile(q.content) || isFile(q.explanation));
  if (anyFile && baseUrlMissing(baseUrl)) rows.push({ level: "red", where: "題庫", problem: "大螢幕讀不到上傳的檔案：伺服器沒設 R2_PUBLIC_BASE_URL" });
  else if (results.publicOk === false) rows.push({ level: "red", where: "題庫", problem: "大螢幕讀不到上傳的檔案：R2 公開網址連不上（檢查 bucket 的公開存取）" });
  else if (anyFile && results.publicOk !== true) rows.push({ level: "yellow", where: "題庫", problem: "R2 公開網址沒辦法確認，到場請實播一次上傳的檔案" });
  let unchecked = 0;
  for (const { q, where } of placed) {
    if (q.explanation?.kind === "instagram") unchecked++;
    for (const [c, slot] of [[q.content, ""], [q.explanation, "詳解："]] as const) {
      if (!c) continue;
      const found = mediaProblem(c, c.kind === "youtube" ? results.youtube[c.value] : results.files[c.value]);
      if (found) rows.push({ level: found.level, questionId: q.id, where, ...(labelOf(q) ? { label: labelOf(q) } : {}), problem: slot + found.problem });
    }
  }
  return { rows, questions: placed.length, unchecked };
}
