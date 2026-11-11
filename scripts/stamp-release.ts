// Folds the changelog.d/ fragments on main into one CHANGELOG section and bumps the version, run by
// .github/workflows/stamp.yml after every merge (changelog.d/README.md):
//   node scripts/stamp-release.ts [YYYY-MM-DD]
// The bump is the highest `bump:` among the fragments (micro < patch < minor < major; a legacy fragment with none
// counts as patch). Exactly that one part of MAJOR.MINOR.PATCH.MICRO goes up by one and the parts after it reset to 0.
// Writes VERSION, CHANGELOG.md and the package.json / package-lock.json versions (VERSION's first three parts), and
// deletes the fragments. Prints `version=<X>`, or nothing when there is no fragment.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BUMPS, fragmentBody, fragmentBump, type Bump } from "./check-fragment.ts";

export type Fragment = { path: string; text: string };

/** `version` raised by `bump`: that part up by one, the parts after it reset to 0. */
export function bumpVersion(version: string, bump: Bump): string {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION "${version}" is not a four-part version like 0.58.0.0`);
  const i = 3 - BUMPS.indexOf(bump);
  return version
    .split(".")
    .map((n, j) => (j < i ? n : j === i ? String(Number(n) + 1) : "0"))
    .join(".");
}

// Keep a Changelog order; any other `### ` heading follows these, in the order it first appears.
const HEADING_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/** The fragment bodies as one body with each `### X` heading once: text under no heading first, then the headings in
 *  HEADING_ORDER, each holding its parts in fragment order. A `### ` line inside a ``` code block is not a heading. */
export function mergeBodies(bodies: string[]): string {
  const groups = new Map<string, string[]>([["", []]]);
  for (const body of bodies) {
    let heading = "";
    let lines: string[] = [];
    let fenced = false;
    const flush = () => {
      const text = lines.join("\n").trim();
      if (text || heading) groups.set(heading, [...(groups.get(heading) ?? []), ...(text ? [text] : [])]);
    };
    for (const line of body.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      const m = !fenced && /^### (.+?)\s*$/.exec(line);
      if (m) {
        flush();
        heading = m[1];
        lines = [];
      } else lines.push(line);
    }
    flush();
  }
  const rank = (h: string) => (h === "" ? -1 : HEADING_ORDER.includes(h) ? HEADING_ORDER.indexOf(h) : HEADING_ORDER.length);
  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b)) // stable: unknown headings keep first-appearance order
    .map((h) => [h && `### ${h}`, groups.get(h)!.join("\n")].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/** The new version and CHANGELOG with the fragments folded, in path order, into one section above the newest one, each `### X` heading once. */
export function stamp(version: string, changelog: string, fragments: Fragment[], date: string): { version: string; changelog: string } {
  const sorted = [...fragments].sort((a, b) => (a.path < b.path ? -1 : 1));
  const bump = sorted.map((f) => fragmentBump(f.text) ?? "patch").reduce((a, b) => (BUMPS.indexOf(b) > BUMPS.indexOf(a) ? b : a), "micro" as Bump);
  const next = bumpVersion(version, bump);
  const section = `## [${next}] - ${date}\n\n${mergeBodies(sorted.map((f) => fragmentBody(f.text)))}\n\n`;
  const at = changelog.search(/^## \[/m);
  return { version: next, changelog: at < 0 ? `${changelog.trimEnd()}\n\n${section}` : changelog.slice(0, at) + section + changelog.slice(at) };
}

/** `json` with `version` (and a lockfile's `packages[""].version`) set to `v`, in the file's 2-space format. */
export function setPackageVersion(json: string, v: string): string {
  const p = JSON.parse(json);
  p.version = v;
  if (p.packages?.[""]) p.packages[""].version = v;
  return JSON.stringify(p, null, 2) + "\n";
}

if (process.argv[1]?.endsWith("stamp-release.ts")) {
  const dir = "changelog.d";
  const paths = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => `${dir}/${f}`);
  if (!paths.length) process.exit(0);
  // sv-SE formats the local date as YYYY-MM-DD; stamp.yml sets TZ.
  const date = process.argv[2] ?? new Date().toLocaleDateString("sv-SE");
  const fragments = paths.map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const { version, changelog } = stamp(readFileSync("VERSION", "utf8").trim(), readFileSync("CHANGELOG.md", "utf8"), fragments, date);
  writeFileSync("VERSION", version + "\n");
  writeFileSync("CHANGELOG.md", changelog);
  const pkg = version.split(".").slice(0, 3).join(".");
  for (const path of ["package.json", "package-lock.json"]) writeFileSync(path, setPackageVersion(readFileSync(path, "utf8"), pkg));
  for (const path of paths) rmSync(path);
  console.log(`version=${version}`);
}
