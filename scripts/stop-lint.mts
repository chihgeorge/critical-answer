// Stop hook: lints Claude's last reply against section B of .claude/rules/owner.md, with fixed rules instead of a
// model, so it never blocks on a vague "not enough evidence". Run by .claude/settings.json as
// `node scripts/stop-lint.mts` with the hook input JSON on stdin. Any error fails open (exit 0, message on stderr).
import { readFileSync } from "node:fs";

export type StopInput = { stop_hook_active?: boolean; last_assistant_message?: string };

/** Characters that only Simplified Chinese uses (each has a different Traditional form). */
const SIMPLIFIED = /[这们说时会对发为么还没进过让门问题关见车东开无实现]/g;

/** The reply's own prose: code, inline code, links, URLs, paths and quoted text removed. */
export function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(^|\s)[~.]?\/[\w./@-]+/g, " ")
    .replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"/g, " ");
}

/** The first section B rule the reply breaks, as a reason in Traditional Chinese, or null. */
export function lintReply(text: string): string | null {
  const p = prose(text);
  const cjk = (p.match(/[一-鿿]/g) ?? []).length;
  const latin = (p.match(/[A-Za-z]/g) ?? []).length;
  if (latin > 40 && latin > cjk * 2) return "B1：回覆主要是英文，請改用繁體中文（台灣用語）重寫給站長的文字。";
  if (new Set(p.match(SIMPLIFIED) ?? []).size >= 3) return "B1：回覆用了簡體字，請改用繁體中文（台灣用語）。";
  if (/[？?](\s|$)/.test(p)) return "B2：回覆文字裡有問句；要站長回答或決定的事請用 AskUserQuestion 問，一次只問一件。";
  return null;
}

/** The hook's stdout for this input: a block decision, or "" to let Claude stop. A second stop always passes. */
export function stopOutput(input: StopInput): string {
  if (input.stop_hook_active || !input.last_assistant_message) return "";
  const reason = lintReply(input.last_assistant_message);
  return reason ? JSON.stringify({ decision: "block", reason }) : "";
}

if (process.argv[1]?.endsWith("stop-lint.mts")) {
  try {
    const out = stopOutput(JSON.parse(readFileSync(0, "utf8")) as StopInput);
    if (out) process.stdout.write(out + "\n");
  } catch (e) {
    process.stderr.write(`stop-lint: failing open: ${(e as Error).message}\n`);
  }
}
