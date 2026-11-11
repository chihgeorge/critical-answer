// Checks a pull request against the release flow (changelog.d/README.md): it leaves VERSION, the package.json and
// package-lock.json version and CHANGELOG.md alone, and adds at least one changelog.d/*.md fragment that opens with
// `bump: micro|patch|minor|major` front matter, has a body and no `## [x]` version heading. After the merge,
// .github/workflows/stamp.yml folds the fragments and bumps the version (scripts/stamp-release.ts). A dependabot[bot]
// PR needs no fragment. Run by CI on pull requests:
//   BASE_REF=main HEAD_REF=<branch> PR_AUTHOR=<login> node scripts/check-fragment.ts
// Compares HEAD with its merge base on origin/$BASE_REF. Prints one line per problem and exits 1 when there is any.
import { execFileSync } from "node:child_process";

export type Change = { status: string; path: string };
export type PrInput = {
  branch: string;
  author: string;
  /** `git diff --name-status --no-renames` against the merge base: status letter and path. */
  changes: Change[];
  /** A file's text at the merge base or at HEAD, or null when it does not exist there. */
  show: (rev: "base" | "head", path: string) => string | null;
};

const FRAGMENT = /^changelog\.d\/[^/]+\.md$/;

const version = (json: string | null): unknown => (json === null ? undefined : JSON.parse(json).version);

/** Parses `git diff -z --name-status --no-renames`: NUL-separated status and path pairs, never C-quoted. */
export function parseNameStatus(z: string): Change[] {
  const parts = z.split("\0");
  const changes: Change[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: parts[i], path: parts[i + 1] });
  return changes;
}

/** The body of a fragment: its text without the `---` front matter, trimmed. */
export function fragmentBody(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "").trim();
}

export const BUMPS = ["micro", "patch", "minor", "major"] as const;
export type Bump = (typeof BUMPS)[number];
/** The `bump:` a fragment's front matter names, or null when it names none (or an unknown one). */
export function fragmentBump(text: string): Bump | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text)?.[1] ?? "";
  const bump = /^bump:\s*(\S+)\s*$/m.exec(front)?.[1];
  return (BUMPS as readonly string[]).includes(bump ?? "") ? (bump as Bump) : null;
}

export function fragmentProblems(pr: PrInput): string[] {
  const problems: string[] = [];
  const changed = new Set(pr.changes.map((c) => c.path));
  for (const path of ["VERSION", "CHANGELOG.md"]) {
    if (changed.has(path)) problems.push(`${path}: the stamp workflow changes it after the merge; add a changelog.d/ fragment instead`);
  }
  for (const path of ["package.json", "package-lock.json"]) {
    if (changed.has(path) && version(pr.show("base", path)) !== version(pr.show("head", path))) {
      problems.push(`${path}: the version field changed; the stamp workflow changes it after the merge`);
    }
  }
  const added = pr.changes.filter((c) => c.status === "A" && FRAGMENT.test(c.path) && c.path !== "changelog.d/README.md");
  for (const { path } of added) {
    const body = fragmentBody(pr.show("head", path) ?? "");
    if (!body) problems.push(`${path}: the fragment is empty`);
    if (/^## \[/m.test(body)) problems.push(`${path}: no "## [x]" version heading; the stamp workflow writes it`);
    if (!fragmentBump(pr.show("head", path) ?? "")) problems.push(`${path}: open with front matter "---\\nbump: micro|patch|minor|major\\n---" (changelog.d/README.md)`);
  }
  if (!added.length && pr.author !== "dependabot[bot]") {
    problems.push("changelog.d/: add a <branch-slug>.md fragment for this change (format in changelog.d/README.md)");
  }
  return problems;
}

if (process.argv[1]?.endsWith("check-fragment.ts")) {
  // maxBuffer: package-lock.json can outgrow the 1 MiB default.
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  const base = git("merge-base", `origin/${process.env.BASE_REF || "main"}`, "HEAD").trim();
  const changes = parseNameStatus(git("diff", "-z", "--name-status", "--no-renames", base, "HEAD"));
  const show = (rev: "base" | "head", path: string) => {
    try {
      return git("show", `${rev === "base" ? base : "HEAD"}:${path}`);
    } catch (e) {
      // Only "not at this revision" means absent; any other git failure must not pass as "no version".
      if (/does not exist in|exists on disk, but not in/.test(String((e as { stderr?: unknown }).stderr))) return null;
      throw e;
    }
  };
  const branch = process.env.HEAD_REF || git("rev-parse", "--abbrev-ref", "HEAD").trim();
  const problems = fragmentProblems({ branch, author: process.env.PR_AUTHOR ?? "", changes, show });
  for (const p of problems) console.log(p);
  if (problems.length) process.exit(1);
  console.log(`check-fragment: ${branch} follows the release flow (${changes.length} files changed)`);
}
