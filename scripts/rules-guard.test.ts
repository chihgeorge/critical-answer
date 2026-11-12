import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findViolation, gitIgnored, parseRules, stripQuoted, type Env, type HookInput } from "./rules-guard.mts";

const ROOT = join(__dirname, "..");
const RULES = parseRules(readFileSync(join(ROOT, ".claude/rules.md"), "utf8"));
const notIgnored: Env = { ignored: () => false };
const hit = (input: HookInput, env = notIgnored) => findViolation(RULES, { cwd: ROOT, ...input }, env)?.title.slice(0, 2) ?? null;
const bash = (command: string) => hit({ tool_name: "Bash", tool_input: { command } });
const write = (file: string, content: string, env = notIgnored) =>
  hit({ tool_name: "Write", tool_input: { file_path: join(ROOT, file), content } }, env);
// Built by concatenation so this file itself never holds a string the A4/A5 rules block.
const HOME = "/Us" + "ers/someone/";
const PERMS = '"permis' + 'sions": {}';

describe("parseRules", () => {
  it("reads every A rule from .claude/rules.md, and nothing from B or C", () => {
    expect(RULES.map((r) => r.title.slice(0, 2))).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
    expect(RULES.every((r) => r.why.length > 10 && r.patterns.length > 0)).toBe(true);
  });

  it("skips a bad regex line and an unknown field, keeping the rest", () => {
    const warns: string[] = [];
    const rules = parseRules("## A. x\n### A9. t\nwhy\n```block command\n(\nok\n```\n```block nope\nx\n```\n## B. y\n", (m) => warns.push(m));
    expect(rules).toHaveLength(1);
    expect(rules[0].patterns.map(String)).toEqual(["/ok/m"]);
    expect(warns).toHaveLength(2);
  });
});

describe("A1 e2e", () => {
  it("blocks running e2e", () => {
    expect(bash("npm run e2e")).toBe("A1");
    expect(bash("cd x && npx playwright test e2e/a.spec.ts")).toBe("A1");
    expect(bash("npm  run e2e")).toBe("A1");
    expect(bash("npx playwright install")).toBe("A1");
    expect(bash("pnpm exec playwright test")).toBe("A1");
  });
  it("still sees a command next to quoted text or a heredoc", () => {
    expect(bash(`echo "don't" && npm run e2e && echo 'x'`)).toBe("A1");
    expect(bash("cat <<EOF > f && npm run e2e\nbody\nEOF")).toBe("A1");
    expect(bash("x=$((1<<2))\nnpm run e2e")).toBe("A1");
    expect(bash("cat <<< word\nnpm run e2e")).toBe("A1");
    expect(bash('echo "$(git stash pop)"')).toBe("A2");
    expect(bash('echo "$(git stash)"')).toBe("A2");
    expect(bash("echo \"`npm run e2e`\"")).toBe("A1");
  });
  it("passes text that only mentions it", () => {
    expect(bash('git commit -m "docs: npm run e2e is CI only"')).toBeNull();
    expect(bash("grep -n 'npm run e2e' CLAUDE.md")).toBeNull();
    expect(bash("gh pr create --body-file - <<'EOF'\nnpm run e2e runs on CI\nEOF")).toBeNull();
    expect(bash("git commit -F - <<-EOF\n\tnpm run e2e\n\tEOF")).toBeNull();
    expect(bash('git commit -m "$(cat <<\'EOF\'\nnpm run e2e\nEOF\n)"')).toBeNull();
    expect(bash(`git commit -m "$(cat<<'EOF'\nskip npm run e2e locally\nEOF\n)"`)).toBeNull();
    expect(bash("echo $((a<<b))\nnpm run e2e")).toBe("A1");
    expect(bash("npm run test")).toBeNull();
  });
});

describe("A2 bare git stash", () => {
  it("blocks bare stash and pop", () => {
    expect(bash("git stash")).toBe("A2");
    expect(bash("git stash && git pull")).toBe("A2");
    expect(bash("git stash pop")).toBe("A2");
    expect(bash("git stash -u")).toBe("A2");
    expect(bash("git -C ../x stash push")).toBe("A2");
    expect(bash("git stash apply")).toBe("A2");
    expect(bash("git stash push --include-untracked")).toBe("A2");
  });
  it("passes a tagged push and apply by sha", () => {
    expect(bash('git stash push -u -m "lane-x"')).toBeNull();
    expect(bash("git stash apply abc123")).toBeNull();
    expect(bash("git stash list")).toBeNull();
    expect(bash("git stash push --include-untracked --message tag")).toBeNull();
  });
});

describe("A3 claude-in-chrome", () => {
  it("blocks its tools", () => expect(hit({ tool_name: "mcp__claude-in-chrome__navigate" })).toBe("A3"));
  it("passes other tools", () => expect(hit({ tool_name: "mcp__Claude_Browser__navigate" })).toBeNull());
});

describe("A4 permissions", () => {
  it("blocks writing a permissions key, in or out of the repo", () => {
    expect(write(".claude/settings.json", `{ ${PERMS} }`)).toBe("A4");
    expect(hit({ tool_name: "Edit", tool_input: { file_path: "/tmp/x/settings.json", old_string: "a", new_string: PERMS } })).toBe("A4");
  });
  it("passes other keys and an edit that only removes it", () => {
    expect(write(".claude/settings.json", '{ "hooks": {} }')).toBeNull();
    expect(hit({ tool_name: "Edit", tool_input: { file_path: join(ROOT, "a.json"), old_string: PERMS, new_string: "" } })).toBeNull();
  });
});

describe("A5 personal info in committed files", () => {
  it("blocks a home path, a hostname and a private IP", () => {
    expect(write("docs/a.md", `see ${HOME}repo`)).toBe("A5");
    expect(write("docs/a.md", "ssh me@my-mac" + ".local")).toBe("A5");
    expect(write("docs/a.md", "http://box" + ".local:3000/")).toBe("A5");
    expect(write("docs/a.md", "host 192.168" + ".1.20")).toBe("A5");
    expect(write("docs/a.md", "host 10.0" + ".0.7")).toBe("A5");
    expect(write("docs/a.md", "172.16" + ".0.1 and")).toBe("A5");
    expect(write("docs/a.md", "172.31" + ".0.1 and")).toBe("A5");
    expect(hit({ tool_name: "MultiEdit", tool_input: { file_path: join(ROOT, "a.md"), edits: [{ old_string: "a", new_string: "172.20" + ".1.1" }] } })).toBe("A5");
  });
  it("passes ~ paths, .local file names, versions and localhost", () => {
    expect(write("docs/a.md", "~/.gstack/x and .env.local and settings.local.json, `.env.local`.")).toBeNull();
    expect(write("docs/a.md", "node 10.15.3, v0.58.1.1, 127.0.0.1, 172.32.0.1, localhost:4399")).toBeNull();
  });
  it("passes files outside the repo and git-ignored files", () => {
    expect(hit({ tool_name: "Write", tool_input: { file_path: "/tmp/notes.md", content: HOME } })).toBeNull();
    expect(write("local-banks/a.md", HOME, { ignored: () => true })).toBeNull();
  });
  it("checks a NotebookEdit with a relative path", () => {
    expect(hit({ tool_name: "NotebookEdit", tool_input: { notebook_path: "docs/a.ipynb", new_source: HOME } })).toBe("A5");
  });
  it("asks git whether a file is ignored", () => {
    expect(write("node_modules/x.md", HOME, { ignored: gitIgnored })).toBeNull();
  });
});

describe("A6 version files", () => {
  it("blocks VERSION and CHANGELOG.md at the repo root", () => {
    expect(write("VERSION", "1.0.0.0")).toBe("A6");
    expect(hit({ tool_name: "Edit", tool_input: { file_path: join(ROOT, "CHANGELOG.md"), old_string: "a", new_string: "b" } })).toBe("A6");
  });
  it("passes a changelog fragment and files outside the repo", () => {
    expect(write("changelog.d/rules-hooks.md", "---\nbump: patch\n---\n")).toBeNull();
    expect(hit({ tool_name: "Write", tool_input: { file_path: "/tmp/VERSION", content: "1" } })).toBeNull();
  });
});

describe("stripQuoted", () => {
  it("keeps the command words and drops quoted text", () => {
    expect(stripQuoted(`echo 'a' "b \\" c" d`)).toBe(`echo '' "" d`);
  });
});

describe("hook process", () => {
  const run = (stdin: string) => execFileSync("node", [join(ROOT, "scripts/rules-guard.mts")], { input: stdin, encoding: "utf8" });
  it("prints a deny decision with the rule and why", () => {
    const out = JSON.parse(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git stash" }, cwd: ROOT })));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("A2");
  });
  it("prints nothing for an allowed call, and fails open on bad input", () => {
    expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: ROOT }))).toBe("");
    expect(run("not json")).toBe("");
  });
});
