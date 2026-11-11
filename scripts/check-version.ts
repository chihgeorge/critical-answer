// Checks that a pull request bumps its own version (docs/development.md「版本與 Release」): VERSION goes up by one in
// exactly one part from the merge base, with every part after it reset to 0 (MAJOR.MINOR.PATCH.MICRO), CHANGELOG.md
// opens with that version's section, and the package.json and package-lock.json
// version is VERSION's first three parts. A dependabot[bot] PR needs none of it. Run by CI on pull requests:
//   BASE_REF=main PR_AUTHOR=<login> node scripts/check-version.ts
// Compares HEAD with its merge base on origin/$BASE_REF. Prints one line per problem and exits 1 when there is any.
import { execFileSync } from "node:child_process";

export type PrInput = {
  author: string;
  /** A file's text at the merge base or at HEAD, or null when it does not exist there. */
  show: (rev: "base" | "head", path: string) => string | null;
};

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;
// Not imported from release-notes.ts: node runs these scripts as plain .ts, where a relative import needs the
// extension that tsc refuses. Same heading rule as its "## [x.y.z.w]".
const HEADING = /^## \[(\d+\.\d+\.\d+\.\d+)\]/m;
/** The four versions one bump above `v`: MAJOR, MINOR, PATCH or MICRO up by one, the parts after it reset to 0. */
export const nextVersions = (v: string): string[] => {
  const n = v.split(".").map(Number);
  return n.map((_, i) => n.map((x, j) => (j < i ? x : j === i ? x + 1 : 0)).join("."));
};

const packageVersion = (json: string | null): unknown => (json === null ? undefined : JSON.parse(json).version);

export function versionProblems(pr: PrInput): string[] {
  if (pr.author === "dependabot[bot]") return [];
  const base = (pr.show("base", "VERSION") ?? "").trim();
  const head = (pr.show("head", "VERSION") ?? "").trim();
  if (!VERSION_RE.test(head)) return [`VERSION: "${head}" is not a four-part version like 0.58.0.0`];
  const problems: string[] = [];
  // A base without a readable VERSION (first PR) only needs a well-formed head.
  if (VERSION_RE.test(base) && !nextVersions(base).includes(head)) {
    problems.push(`VERSION: ${head} is not one bump above ${base}; use one of ${nextVersions(base).join(", ")} (/ship Step 12)`);
  }
  const top = HEADING.exec(pr.show("head", "CHANGELOG.md") ?? "")?.[1];
  if (top !== head) problems.push(`CHANGELOG.md: the first section must be ## [${head}], found ${top ? `## [${top}]` : "none"}`);
  const pkg = head.split(".").slice(0, 3).join(".");
  for (const path of ["package.json", "package-lock.json"]) {
    const v = packageVersion(pr.show("head", path));
    if (v !== pkg) problems.push(`${path}: the version must be ${pkg} (VERSION's first three parts), found ${String(v)}`);
  }
  return problems;
}

if (process.argv[1]?.endsWith("check-version.ts")) {
  // maxBuffer: package-lock.json can outgrow the 1 MiB default.
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  const base = git("merge-base", `origin/${process.env.BASE_REF || "main"}`, "HEAD").trim();
  const show = (rev: "base" | "head", path: string) => {
    try {
      return git("show", `${rev === "base" ? base : "HEAD"}:${path}`);
    } catch (e) {
      // Only "not at this revision" means absent; any other git failure must not pass as "no version".
      if (/does not exist in|exists on disk, but not in/.test(String((e as { stderr?: unknown }).stderr))) return null;
      throw e;
    }
  };
  const problems = versionProblems({ author: process.env.PR_AUTHOR ?? "", show });
  for (const p of problems) console.log(p);
  if (problems.length) process.exit(1);
  console.log(`check-version: VERSION ${(show("head", "VERSION") ?? "").trim()} is bumped and matches CHANGELOG.md and package.json`);
}
