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
  const i = 3 - BUMPS.indexOf(bump);
  return version
    .split(".")
    .map((n, j) => (j < i ? n : j === i ? String(Number(n) + 1) : "0"))
    .join(".");
}

/** The new version and CHANGELOG with the fragments folded, in path order, into one section above the newest one. */
export function stamp(version: string, changelog: string, fragments: Fragment[], date: string): { version: string; changelog: string } {
  const sorted = [...fragments].sort((a, b) => (a.path < b.path ? -1 : 1));
  const bump = sorted.map((f) => fragmentBump(f.text) ?? "patch").reduce((a, b) => (BUMPS.indexOf(b) > BUMPS.indexOf(a) ? b : a), "micro" as Bump);
  const next = bumpVersion(version, bump);
  const section = `## [${next}] - ${date}\n\n${sorted.map((f) => fragmentBody(f.text)).join("\n\n")}\n\n`;
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
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const fragments = paths.map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const { version, changelog } = stamp(readFileSync("VERSION", "utf8").trim(), readFileSync("CHANGELOG.md", "utf8"), fragments, date);
  writeFileSync("VERSION", version + "\n");
  writeFileSync("CHANGELOG.md", changelog);
  const pkg = version.split(".").slice(0, 3).join(".");
  for (const path of ["package.json", "package-lock.json"]) writeFileSync(path, setPackageVersion(readFileSync(path, "utf8"), pkg));
  for (const path of paths) rmSync(path);
  console.log(`version=${version}`);
}
