// Checks the outward-facing docs: every relative link points at a file that exists, and every
// #anchor matches a heading in its target (GitHub's slug rules). Run by CI:
//   node scripts/check-docs.ts
// Prints one line per broken link and exits 1 when there is any.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

export const DOCS = [
  "README.md",
  "SECURITY.md",
  "docs/rules.md",
  "docs/hosting.md",
  "docs/deployment.md",
  "docs/question-bank.md",
  "docs/development.md",
];

/** The lines outside ``` fences, with inline `code` blanked so links inside it are ignored. */
function proseLines(markdown: string): string[] {
  let fenced = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line.replace(/`[^`]*`/g, "``");
  });
}

/** GitHub's heading ids: lowercase, punctuation and emoji dropped, spaces to "-", repeats get -1, -2... */
export function headingSlugs(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*]/g, "");
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "").replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n ? `${base}-${n}` : base);
  }
  return slugs;
}

/** Relative link targets in a doc, as written (path and optional #anchor). */
export function relativeLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const line of proseLines(markdown)) {
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(m[1])) links.push(m[1]);
    }
  }
  return links;
}

/** Broken links in `file`, read through `read` (null when the file does not exist). */
export function brokenLinks(file: string, read: (path: string) => string | null): string[] {
  const text = read(file);
  if (text === null) return [`${file}: file is missing`];
  const problems: string[] = [];
  for (const link of relativeLinks(text)) {
    const [path, anchor] = link.split("#", 2);
    const target = path ? normalize(join(dirname(file), decodeURIComponent(path))) : file;
    const body = read(target);
    if (body === null) problems.push(`${file}: ${link} → ${target} does not exist`);
    else if (anchor !== undefined && target.endsWith(".md") && !headingSlugs(body).has(decodeURIComponent(anchor).toLowerCase()))
      problems.push(`${file}: ${link} → no heading #${anchor} in ${target}`);
  }
  return problems;
}

if (process.argv[1]?.endsWith("check-docs.ts")) {
  // Only .md bodies matter (for anchors); any other existing path (an image, a directory) reads as "".
  const read = (p: string) => (!existsSync(p) ? null : p.endsWith(".md") ? readFileSync(p, "utf8") : "");
  const problems = DOCS.flatMap((f) => brokenLinks(f, read));
  for (const p of problems) console.log(p);
  if (problems.length) process.exit(1);
  console.log(`check-docs: ${DOCS.length} docs, all links resolve`);
}
