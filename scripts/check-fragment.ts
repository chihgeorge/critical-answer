// Checks a pull request against the release flow (.gstack/ship-policy.json, changelog.d/README.md): it leaves
// VERSION, the package.json and package-lock.json version and CHANGELOG.md alone, and adds at least one
// changelog.d/*.md fragment with a body and no `## [x]` version heading. A release PR (head branch release/*)
// skips every rule; a dependabot[bot] PR needs no fragment. Run by CI on pull requests:
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

/** The body of a fragment: its text without the `---` front matter, trimmed. */
export function fragmentBody(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "").trim();
}

export function fragmentProblems(pr: PrInput): string[] {
  if (pr.branch.startsWith("release/")) return [];
  const problems: string[] = [];
  const changed = new Set(pr.changes.map((c) => c.path));
  for (const path of ["VERSION", "CHANGELOG.md"]) {
    if (changed.has(path)) problems.push(`${path}: only a release PR changes it; add a changelog.d/ fragment instead`);
  }
  for (const path of ["package.json", "package-lock.json"]) {
    if (changed.has(path) && version(pr.show("base", path)) !== version(pr.show("head", path))) {
      problems.push(`${path}: the version field changed; only a release PR changes it`);
    }
  }
  const added = pr.changes.filter((c) => c.status === "A" && FRAGMENT.test(c.path) && c.path !== "changelog.d/README.md");
  for (const { path } of added) {
    const body = fragmentBody(pr.show("head", path) ?? "");
    if (!body) problems.push(`${path}: the fragment is empty`);
    if (/^## \[/m.test(body)) problems.push(`${path}: no "## [x]" version heading; the release PR writes it`);
  }
  if (!added.length && pr.author !== "dependabot[bot]") {
    problems.push("changelog.d/: add a <branch-slug>.md fragment for this change (format in changelog.d/README.md)");
  }
  return problems;
}

if (process.argv[1]?.endsWith("check-fragment.ts")) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const base = git("merge-base", `origin/${process.env.BASE_REF || "main"}`, "HEAD").trim();
  const changes = git("diff", "--name-status", "--no-renames", base, "HEAD")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      return { status, path };
    });
  const show = (rev: "base" | "head", path: string) => {
    try {
      return git("show", `${rev === "base" ? base : "HEAD"}:${path}`);
    } catch {
      return null;
    }
  };
  const branch = process.env.HEAD_REF || git("rev-parse", "--abbrev-ref", "HEAD").trim();
  const problems = fragmentProblems({ branch, author: process.env.PR_AUTHOR ?? "", changes, show });
  for (const p of problems) console.log(p);
  if (problems.length) process.exit(1);
  console.log(`check-fragment: ${branch} follows the release flow (${changes.length} files changed)`);
}
