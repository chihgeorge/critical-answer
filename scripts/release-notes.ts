// Builds GitHub Release notes from CHANGELOG.md. Run by .github/workflows/release.yml:
//   node scripts/release-notes.ts <version> [previous-release-version]
// Prints every CHANGELOG section after the previous release up to <version>, newest first.
import { readFileSync } from "node:fs";

export type Section = { version: string; text: string };

const HEADING = /^## \[(\d+\.\d+\.\d+\.\d+)\]/;

export function compareVersions(a: string, b: string): number {
  const x = a.replace(/^v/, "").split(".").map(Number);
  const y = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function changelogSections(changelog: string): Section[] {
  const sections: Section[] = [];
  for (const line of changelog.split("\n")) {
    const m = HEADING.exec(line);
    if (m) sections.push({ version: m[1], text: line });
    else if (line.startsWith("## ")) sections.push({ version: "", text: line });
    else if (sections.length) sections[sections.length - 1].text += "\n" + line;
  }
  return sections.filter((s) => s.version);
}

export function releaseNotes(changelog: string, version: string, previous?: string): string {
  const all = changelogSections(changelog);
  if (!all.some((s) => s.version === version)) throw new Error(`CHANGELOG.md has no section for ${version}`);
  if (previous && !/^v?\d+(\.\d+){3}$/.test(previous)) throw new Error(`previous release ${previous} is not a four-part version`);
  if (previous && compareVersions(previous, version) >= 0) throw new Error(`previous release ${previous} is not older than ${version}`);
  return all
    .filter((s) => compareVersions(s.version, version) <= 0 && (!previous || compareVersions(s.version, previous) > 0))
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((s) => s.text.trim())
    .join("\n\n");
}

if (process.argv[1]?.endsWith("release-notes.ts")) {
  const [version, previous] = process.argv.slice(2);
  console.log(releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version, previous));
}
