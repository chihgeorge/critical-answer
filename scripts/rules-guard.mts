// PreToolUse hook: blocks a tool call that matches a rule in section A of .claude/rules.md.
// Run by .claude/settings.json as `node scripts/rules-guard.mts` with the hook input JSON on stdin.
// Any error fails open (exit 0, message on stderr) so a broken hook never stalls a session.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Field = "command" | "tool" | "content" | "committed-content" | "path";
export type Rule = { title: string; why: string; field: Field; patterns: RegExp[] };
export type HookInput = { tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string };

const FIELDS: Field[] = ["command", "tool", "content", "committed-content", "path"];

/** Section A rules: one per `block <field>` fence, titled by the `###` heading above it. */
export function parseRules(md: string, warn: (msg: string) => void = () => {}): Rule[] {
  const section = md.split(/^## /m).find((s) => s.startsWith("A."));
  if (!section) return [];
  const rules: Rule[] = [];
  for (const part of section.split(/^### /m).slice(1)) {
    const title = part.slice(0, part.indexOf("\n")).trim();
    const why = part.slice(part.indexOf("\n") + 1).split(/^```/m)[0].trim();
    for (const m of part.matchAll(/^```block[ \t]+(\S+)[ \t]*\n([\s\S]*?)^```/gm)) {
      const field = m[1] as Field;
      if (!FIELDS.includes(field)) { warn(`rules-guard: ${title}: unknown field "${field}"`); continue; }
      const patterns: RegExp[] = [];
      for (const line of m[2].split("\n").filter((l) => l.trim())) {
        try { patterns.push(new RegExp(line, "m")); } catch (e) { warn(`rules-guard: ${title}: bad regex ${line}: ${(e as Error).message}`); }
      }
      rules.push({ title, why, field, patterns });
    }
  }
  return rules;
}

/** A shell command with quoted strings and heredoc bodies removed, so text that only mentions a rule passes. */
export function stripQuoted(cmd: string): string {
  return cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?^\s*\2\s*$/gm, "<<heredoc")
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** The new text a file tool is about to write (old_string is not new, so it is not checked). */
function newContent(input: Record<string, unknown>): string {
  const edits = Array.isArray(input.edits) ? input.edits.map((e) => (e as { new_string?: unknown }).new_string) : [];
  return [input.content, input.new_string, input.new_source, ...edits].filter((v) => typeof v === "string").join("\n");
}

/** Nearest ancestor of `dir` holding `.git` (a directory, or a file in a worktree). */
export function gitRoot(dir: string): string | null {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return null;
  }
}

export function gitIgnored(root: string, rel: string): boolean {
  try { execFileSync("git", ["-C", root, "check-ignore", "-q", "--", rel], { stdio: "ignore" }); return true; } catch { return false; }
}

export type Env = { ignored: (root: string, rel: string) => boolean };

/** The first rule the call breaks, or null. */
export function findViolation(rules: Rule[], input: HookInput, env: Env = { ignored: gitIgnored }): Rule | null {
  const tool = input.tool_name ?? "";
  const ti = input.tool_input ?? {};
  const cwd = input.cwd ?? process.cwd();
  const rawPath = [ti.file_path, ti.notebook_path].find((v) => typeof v === "string") as string | undefined;
  // Only files under the repo the session works in count as committed: memory, skills and scratch files elsewhere pass.
  const root = gitRoot(cwd);
  const abs = rawPath === undefined ? undefined : isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  const rel = abs && root ? relative(root, abs) : undefined;
  const inRepo = rel !== undefined && rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  const content = rawPath === undefined ? "" : newContent(ti);
  let committed: boolean | undefined;
  const text = (field: Field): string | null => {
    switch (field) {
      case "command": return tool === "Bash" && typeof ti.command === "string" ? stripQuoted(ti.command) : null;
      case "tool": return tool;
      case "content": return content || null;
      case "path": return inRepo ? rel!.split(sep).join("/") : null;
      case "committed-content":
        if (!content || !inRepo) return null;
        committed ??= !env.ignored(root!, rel!);
        return committed ? content : null;
    }
  };
  for (const rule of rules) {
    const t = text(rule.field);
    if (t !== null && rule.patterns.some((p) => p.test(t))) return rule;
  }
  return null;
}

export function denyOutput(rule: Rule): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `違反站長規則 ${rule.title}（.claude/rules.md）。為什麼：${rule.why}`,
    },
  });
}

if (process.argv[1]?.endsWith("rules-guard.mts")) {
  try {
    const rulesPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "rules.md");
    const rules = parseRules(readFileSync(rulesPath, "utf8"), (m) => process.stderr.write(m + "\n"));
    const hit = findViolation(rules, JSON.parse(readFileSync(0, "utf8")) as HookInput);
    if (hit) process.stdout.write(denyOutput(hit) + "\n");
  } catch (e) {
    process.stderr.write(`rules-guard: failing open: ${(e as Error).message}\n`);
  }
}
