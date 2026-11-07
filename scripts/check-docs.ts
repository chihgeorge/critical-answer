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

// shortcut: a line scanner, not a Markdown parser. Not handled: reference-style links, "(" inside a
// link path, setext (underlined) headings, _emphasis_ in headings. None is used in DOCS; switch to a
// Markdown parser if one ever is.

/** Each line, or null when it is inside (or opens/closes) a ``` or ~~~ fence. A fence closes only on
 * the same character, at least as long, as CommonMark says. */
function unfenced(markdown: string): (string | null)[] {
  let fence: string | null = null;
  return markdown.split("\n").map((line) => {
    // Any indent: a fence nested in a list item is still a fence.
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m && (!fence || (m[1][0] === fence[0] && m[1].length >= fence.length && !/\S/.test(line.slice(m[0].length))))) {
      fence = fence ? null : m[1];
      return null;
    }
    return fence ? null : line;
  });
}

/** The lines outside fences, with inline `code` blanked so links inside it are ignored. */
function proseLines(markdown: string): string[] {
  return unfenced(markdown).map((line) => (line === null ? "" : line.replace(/`[^`]*`/g, "``")));
}

/** GitHub's heading ids: lowercase, punctuation and emoji dropped, spaces to "-", repeats get -1, -2...
 * skipping any id already taken (so "A", "A", "A-1" give a, a-1, a-1-1). */
export function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of unfenced(markdown)) {
    const m = line === null ? null : /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*]/g, "");
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "").replace(/ /g, "-");
    let slug = base;
    for (let n = 1; slugs.has(slug); n++) slug = `${base}-${n}`;
    slugs.add(slug);
  }
  return slugs;
}

/** decodeURIComponent, or the text unchanged when it holds a malformed %-escape. */
function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
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
    const target = path ? normalize(join(dirname(file), decode(path))) : file;
    const body = read(target);
    if (body === null) problems.push(`${file}: ${link} → ${target} does not exist`);
    else if (anchor !== undefined && target.endsWith(".md") && !headingSlugs(body).has(decode(anchor).toLowerCase()))
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
