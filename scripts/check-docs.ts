// Checks README.md, SECURITY.md and every docs/*.md: every relative link points at a file that exists, and every
// #anchor matches a heading in its target (GitHub's slug rules). Each Chinese doc X.md (except MONOLINGUAL) also has
// an English twin X.en.md: both open with the language switch line and have the same headings, level by level. Every
// X.en.md needs such a Chinese X.md.
// Run by CI:
//   node scripts/check-docs.ts
// Prints one line per problem and exits 1 when there is any.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

/** Docs that stay Chinese only (eng review R6): no English twin is required. */
export const MONOLINGUAL = ["docs/going-public.md"];

// shortcut: a line scanner, not a Markdown parser. Not handled: reference-style links, "(" inside a
// link path, setext (underlined) headings, _emphasis_ in headings. None is used in the checked docs; switch to a
// Markdown parser if one ever is.

/** Each line, or null when it is inside (or opens/closes) a ``` or ~~~ fence. A fence closes only on
 * the same character, at least as long, as CommonMark says. `open` is true when the last fence never closes. */
function unfenced(markdown: string): { lines: (string | null)[]; open: boolean } {
  let fence: string | null = null;
  const lines = markdown.split("\n").map((line) => {
    // Any indent: a fence nested in a list item is still a fence.
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m && (!fence || (m[1][0] === fence[0] && m[1].length >= fence.length && !/\S/.test(line.slice(m[0].length))))) {
      fence = fence ? null : m[1];
      return null;
    }
    return fence ? null : line;
  });
  return { lines, open: fence !== null };
}

/** The lines outside fences, with inline `code` blanked so links inside it are ignored. */
function proseLines(markdown: string): string[] {
  return unfenced(markdown).lines.map((line) => (line === null ? "" : line.replace(/`[^`]*`/g, "``")));
}

/** GitHub's heading ids: lowercase, punctuation and emoji dropped, spaces to "-", repeats get -1, -2...
 * skipping any id already taken (so "A", "A", "A-1" give a, a-1, a-1-1). */
export function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const { title } of headings(markdown)) {
    let text = title.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    // Strip HTML tags until none is left (a fixed point, so no tag survives one pass). The text is
    // only compared with anchors, never rendered.
    for (let prev = ""; prev !== text; ) {
      prev = text;
      text = text.replace(/<[^>]*>/g, "");
    }
    text = text.replace(/[`*]/g, "");
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "").replace(/ /g, "-");
    let slug = base;
    for (let n = 1; slugs.has(slug); n++) slug = `${base}-${n}`;
    slugs.add(slug);
  }
  return slugs;
}

/** The ATX headings outside fences: level (1-6) and raw title. */
function headings(markdown: string): { level: number; title: string }[] {
  const found: { level: number; title: string }[] = [];
  for (const line of unfenced(markdown).lines) {
    const m = line === null ? null : /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) found.push({ level: m[1].length, title: m[2] });
  }
  return found;
}

/** The switch line a doc opens with: the Chinese X.md links to X.en.md, the English X.en.md back to X.md. */
export function switchLine(file: string): string {
  const name = basename(file);
  return name.endsWith(".en.md")
    ? `[繁體中文](${name.replace(/\.en\.md$/, ".md")}) | English`
    : `繁體中文 | [English](${name.replace(/\.md$/, ".en.md")})`;
}

/** Problems with the Chinese doc `zh` and its English twin: missing twin, wrong first line, or headings whose levels
 * differ in order (the twin is a translation, so it keeps the same structure). Translation freshness is not checked. */
export function twinProblems(zh: string, read: (path: string) => string | null): string[] {
  const en = zh.replace(/\.md$/, ".en.md");
  const zhText = read(zh), enText = read(en);
  if (zhText === null) return [];
  if (enText === null) return [`${zh}: no English twin ${en}`];
  const problems: string[] = [];
  for (const [file, text] of [[zh, zhText], [en, enText]]) {
    if (text.split("\n", 1)[0].trim() !== switchLine(file)) problems.push(`${file}: first line must be "${switchLine(file)}"`);
  }
  const a = headings(zhText).map((h) => h.level), b = headings(enText).map((h) => h.level);
  const at = a.findIndex((level, i) => level !== b[i]);
  if (at !== -1 || a.length !== b.length) {
    const i = at === -1 ? Math.min(a.length, b.length) : at;
    problems.push(`${en}: headings differ from ${zh} at heading ${i + 1} (${a.length} vs ${b.length} headings)`);
  }
  return problems;
}

/** An English doc X.en.md whose Chinese X.md is missing or stays Chinese only (MONOLINGUAL): nothing pairs it. */
export function orphanTwin(en: string, read: (path: string) => string | null): string[] {
  const zh = en.replace(/\.en\.md$/, ".md");
  return MONOLINGUAL.includes(zh) || read(zh) === null ? [`${en}: no Chinese doc ${zh} to pair with`] : [];
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
  // An unclosed fence would hide every link after it.
  const problems: string[] = unfenced(text).open ? [`${file}: a code fence never closes`] : [];
  for (const link of relativeLinks(text)) {
    const [path, anchor] = link.split("#", 2);
    // GitHub reads a leading "/" from the repository root.
    const target = !path ? file : path.startsWith("/") ? normalize(decode(path.slice(1))) : normalize(join(dirname(file), decode(path)));
    if (target === ".." || target.startsWith("../")) {
      problems.push(`${file}: ${link} → leaves the repository`);
      continue;
    }
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
  const docs = ["README.md", "README.en.md", "SECURITY.md", "SECURITY.en.md", ...readdirSync("docs").filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
  const zh = docs.filter((f) => !f.endsWith(".en.md") && !MONOLINGUAL.includes(f));
  const problems = [
    ...docs.flatMap((f) => brokenLinks(f, read)),
    ...zh.flatMap((f) => twinProblems(f, read)),
    ...docs.filter((f) => f.endsWith(".en.md")).flatMap((f) => orphanTwin(f, read)),
  ];
  for (const p of problems) console.log(p);
  if (problems.length) process.exit(1);
  console.log(`check-docs: ${docs.length} docs, all links resolve, ${zh.length} twins match`);
}
