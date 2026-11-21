// What blocks a bank editor save, and where it is (app/bank-editor/page.tsx). Every problem names the group and the
// question number (「難度 2 第 12 題」), never an internal id, and carries the question id so the editor can jump to it.
// Client-safe: types and pure helpers only, never the parsed bank (CLAUDE.md, check:bundle).
import { BANK_NOT_FOUND } from "./bank-api";
import { timingFieldError } from "./bank-editor-question";
import { DIFFICULTIES, MAX_CATEGORY, MAX_FIELD_LABEL, MAX_FIELDS, MAX_OPTIONS, MAX_PHASE_NAME, MAX_PHASE_RULE, MAX_PROMPT, MIN_FIELDS, MIN_OPTIONS, bossDifficulty, isMusicQuestion, memoryProblem, type Bank, type BankQuestion, type MediaContent } from "./question-bank";
import { byDifficulty, type Difficulty } from "./game-state";

/** A page of the editor (docs/designs/scoring-and-score-pools.md D2=B: one pool per tab). */
export type EditorTab = "rooms" | Difficulty | "boss";

export interface BankProblem {
  message: string;
  /** The tab that fixes it (none for a server refusal the editor cannot place). */
  tab?: EditorTab;
  /** The boss phase (0-based) it is about, when it is about a phase itself. */
  phase?: number;
  /** The question to jump to, when it is about one. */
  questionId?: string;
}

/** Where a question sits now: its tab and 0-based index in its group, or null once it is gone. */
export function locateQuestion(bank: Bank, id: string): { tab: EditorTab; index: number; where: string; question: BankQuestion } | null {
  for (const d of DIFFICULTIES) {
    const index = bank.pools[d].findIndex((q) => q.id === id);
    if (index >= 0) return { tab: d, index, where: `難度 ${d} 第 ${index + 1} 題`, question: bank.pools[d][index] };
  }
  for (const [n, p] of bank.boss.phases.entries()) {
    const index = p.questions.findIndex((q) => q.id === id);
    // The editor lists a boss phase easiest first (lib/bank-editor-list.ts listNumber): name it by that number.
    if (index >= 0) return { tab: "boss", index, where: `首領第 ${n + 1} 階段第 ${byDifficulty(p.questions, bossDifficulty).indexOf(p.questions[index]) + 1} 題`, question: p.questions[index] };
  }
  return null;
}

const MEDIA_NAME: Record<MediaContent["kind"], string> = { text: "文字", image: "圖片", youtube: "YouTube ", video: "影片", audio: "聲音", instagram: "Instagram " };
const NAME_CHARS = 20;

/** A question as people know it: its text (or 題幹), cut to 20 characters; never its id or an upload's key. */
export function questionName(q: BankQuestion): string {
  const text = Array.from((q.content.kind === "text" ? q.content.value : (q.prompt ?? "")).trim());
  if (text.length) return text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS).join("")}…` : text.join("");
  return q.content.kind === "text" ? "（空白題）" : `（${MEDIA_NAME[q.content.kind]}題）`;
}

/** A content or explanation slot that's still mid-upload (image kind, empty value) or otherwise
 * incomplete is an intermediate client-only state the type system can't rule out — the same
 * reasoning multipleChoice's correctIndex sentinel already needed. */
function contentError(label: string, c: MediaContent | undefined): string | null {
  if (!c) return null;
  if (!c.value.trim()) return `${label}還沒填完（${c.kind === "image" ? "還沒上傳圖片" : c.kind === "video" || c.kind === "audio" ? "還沒上傳" : c.kind === "youtube" || c.kind === "instagram" ? "還沒貼網址" : "是空的"}）`;
  // ClipFields stores NaN for a time it can't read, so 儲存 refuses it instead of keeping the last good one.
  if (Number.isNaN(c.start) || Number.isNaN(c.end)) return `${label}的時間看不懂（請打 1:05 或 65）`;
  if (c.end !== undefined && c.end <= (c.start ?? 0)) return `${label}的結束時間要在開始時間之後`;
  return null;
}

/** Answer fields only on a buzzer phase's music questions (multi-field.md F1, E3). */
const fieldsAllowed = (q: BankQuestion, buzzer: boolean) => buzzer && isMusicQuestion(q);

/** Why `q` cannot sit in a group (a pool or plain phase, or a buzzer phase), or null: the placement rules
 * bankProblems and parseBank apply, for the editor's 移到… (editor-ux #3). */
export function placementError(q: BankQuestion, buzzer: boolean): string | null {
  if (q.kind === "timing" && !buzzer) return "卡點題只能放在搶答階段";
  if (q.kind === "text" && q.fields && !fieldsAllowed(q, buzzer)) return "有答案欄位的題目只能放在搶答階段的聽歌題";
  if (buzzer && q.kind !== "text" && q.kind !== "timing") return "搶答階段只能放填空題或卡點題";
  return null;
}

/** The first thing wrong with one question, as a sentence after its label. */
function questionError(label: string, q: BankQuestion, buzzer: boolean): string | null {
  if (q.kind === "timing") {
    if (!buzzer) return `${label}：卡點題只能放在搶答階段`;
    const err = timingFieldError(q);
    if (err) return `${label}：${err}`;
  }
  if (q.kind === "text" && q.fields) {
    if (!fieldsAllowed(q, buzzer)) return `${label}有答案欄位，但只有搶答階段裡「只放聲音」的 YouTube 題能有：改回聽歌題，或按「移除欄位」`;
    if (q.fields.length < MIN_FIELDS || q.fields.length > MAX_FIELDS) return `${label}的答案欄位要 ${MIN_FIELDS}–${MAX_FIELDS} 欄`;
    if (q.fields.some((f) => !f.label.trim() || !f.answer.trim())) return `${label}有答案欄位的名稱或答案是空白`;
    if (q.fields.some((f) => Array.from(f.label.trim()).length > MAX_FIELD_LABEL)) return `${label}的欄位名稱最多 ${MAX_FIELD_LABEL} 個字`;
  } else if (q.kind === "text" && !q.answer.trim()) return `${label}的答案是空白`;
  if (q.kind === "multipleChoice") {
    if (q.options.length < MIN_OPTIONS) return `${label}至少要有 ${MIN_OPTIONS} 個選項`;
    if (q.options.length > MAX_OPTIONS) return `${label}最多 ${MAX_OPTIONS} 個選項`;
    if (q.options.some((o) => !o.trim())) return `${label}有空白選項`;
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) return `${label}還沒標記正解`;
  }
  if (q.kind === "sort") {
    if (q.items.some((o) => !o.trim())) return `${label}有空白的排序項目`;
    if (new Set(q.items.map((o) => o.trim())).size !== q.items.length) return `${label}有重複的排序項目`;
  }
  const contentErr = contentError(`${label}的內容`, q.content);
  if (contentErr) return contentErr;
  if (q.prompt !== undefined && Array.from(q.prompt).length > MAX_PROMPT) return `${label}的題幹最多 ${MAX_PROMPT} 個字`;
  // The same rule parseBank applies (memory-questions.md), so a save never fails on it.
  const memoryErr = memoryProblem(q);
  if (memoryErr) return `${label}：${memoryErr}`;
  if (q.category !== undefined && Array.from(q.category.trim()).length > MAX_CATEGORY) return `${label}的類別最多 ${MAX_CATEGORY} 個字`;
  if (q.difficulty !== undefined && !(DIFFICULTIES as readonly number[]).includes(q.difficulty)) return `${label}的難度要是 1～5`;
  return contentError(`${label}的詳解`, q.explanation);
}

/** Everything that blocks a save, in tab order: each structural problem, and each question's first problem. The
 * same rules parseBank applies, so a save the editor lets through is not refused by the server. */
export function bankProblems(bank: Bank): BankProblem[] {
  const out: BankProblem[] = [];
  for (const [i, r] of bank.rooms.entries()) {
    if (bank.pools[r.difficulty].length === 0) out.push({ tab: r.difficulty, message: `第 ${i + 1} 房是難度 ${r.difficulty}，但難度 ${r.difficulty} 題庫沒有題目` });
  }
  const label = (q: BankQuestion, where: string) => `${where}「${questionName(q)}」`;
  for (const d of DIFFICULTIES) {
    bank.pools[d].forEach((q, i) => {
      const message = questionError(label(q, `難度 ${d} 第 ${i + 1} 題`), q, false);
      if (message) out.push({ tab: d, questionId: q.id, message });
    });
  }
  for (const [n, p] of bank.boss.phases.entries()) {
    const phase = `首領第 ${n + 1} 階段`;
    const problem = (message: string) => out.push({ tab: "boss", phase: n, message });
    // 搶答 (boss-buzzer.md D1, D3): from phase 2 on, fill-ins or timing questions only; parseBank refuses the rest too.
    if (p.buzzer && n === 0) problem("首領第 1 階段不能是搶答階段");
    if (p.buzzer && p.questions.some((q) => q.kind !== "text" && q.kind !== "timing")) problem(`${phase}是搶答階段：只能放填空題或卡點題`);
    if (Array.from(p.name.trim()).length > MAX_PHASE_NAME) problem(`${phase}：名稱最多 ${MAX_PHASE_NAME} 個字`);
    if (Array.from(p.rule.trim()).length > MAX_PHASE_RULE) problem(`${phase}：規則最多 ${MAX_PHASE_RULE} 個字`);
    // From phase 2 on, players meet a phase through its card, so it needs a name and a rule (boss-phases.md D5, D6).
    if (n > 0 && !p.name.trim()) problem(`${phase}：名稱不能空白`);
    if (n > 0 && !p.rule.trim()) problem(`${phase}：規則不能空白`);
    if (p.questions.length === 0) problem(`${phase}還沒有題目`);
    const order = byDifficulty(p.questions, bossDifficulty); // numbered as the editor lists the phase (locateQuestion)
    p.questions.forEach((q) => {
      // Answer fields only on a buzzer phase's music questions (multi-field.md F1, E3); timing questions need every
      // team at once (timing-tap.md): a buzzer phase only. parseBank refuses the rest too.
      const message = questionError(label(q, `${phase}第 ${order.indexOf(q) + 1} 題`), q, !!p.buzzer);
      if (message) out.push({ tab: "boss", questionId: q.id, message });
    });
  }
  return out;
}

/** A save into a bank deleted elsewhere: the editor then offers 另存成新題庫. */
export const BANK_GONE = "這份題庫已經在別的分頁或裝置被刪掉了，存不進去。";

// The server's (parseBank's) most common reasons, in Chinese. Anything else is shown as it came, after a Chinese lead.
const REASONS: [RegExp, string][] = [
  [/has an empty answer/, "的答案是空白"],
  [/has no questions/, "沒有題目"],
  [/has an empty option/, "有空白選項"],
  [/needs at least \d+ options/, "的選項不夠"],
  [/correctIndex out of range/, "還沒標記正解"],
  [/has an empty item/, "有空白的排序項目"],
  [/has the same item twice/, "有重複的排序項目"],
  [/content has no value|has no content/, "的內容是空的"],
  [/has an empty prompt/, "的題幹是空白"],
  [/has a field without (a label|an answer)/, "有答案欄位的名稱或答案是空白"],
];

/** A save the server refused, in Chinese: the HTTP status first, then a known parseBank reason, with the question's
 * place instead of its id (and the id kept for the jump). */
export function serverProblem(bank: Bank, status: number, text: string): BankProblem {
  if (status === 401 || status === 403) return { message: "站長金鑰不對，存不了：請重新輸入金鑰再存。" };
  if (status === 413) return { message: "題庫太大，伺服器不收：請刪掉一些題目再存。" };
  // The store's not-found, not the Worker's catch-all 404 (an old Worker without /api/bank).
  if (status === 404 && text.startsWith(BANK_NOT_FOUND)) return { message: BANK_GONE };
  const raw = text.replace(/^Invalid question bank:\s*/, "").trim();
  const id = raw.match(/question ([^\s:]+)/)?.[1];
  const at = id ? locateQuestion(bank, id) : null;
  const label = at ? `${at.where}「${questionName(at.question)}」` : "";
  const reason = REASONS.find(([re]) => re.test(raw))?.[1];
  const message = label && reason ? `伺服器不接受：${label}${reason}` : `伺服器不接受這份題庫${label ? `：${label}` : ""}（${reason ? reason.replace(/^的/, "") : raw || `錯誤 ${status}`}）`;
  return at && id ? { message, tab: at.tab, questionId: id } : { message };
}
