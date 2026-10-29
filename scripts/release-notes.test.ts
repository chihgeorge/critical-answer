import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changelogSections, compareVersions, releaseNotes } from "./release-notes";

const CHANGELOG = `# Changelog

## [0.3.0.0] - 2026-10-03
### Added
- Three.

## [0.2.1.0] - 2026-10-02
### Fixed
- Two point one.

## [0.2.0.0] - 2026-10-01
### Added
- Two.

## Unreleased notes that are not a version
- ignored
`;

describe("release notes", () => {
  // Value: protects=a release body holding exactly the versions since the last release; fails_when=the range is off by one or a hotfix section is dropped
  it("collects every section after the previous release, newest first", () => {
    const notes = releaseNotes(CHANGELOG, "0.3.0.0", "0.2.0.0");
    expect(notes).toBe("## [0.3.0.0] - 2026-10-03\n### Added\n- Three.\n\n## [0.2.1.0] - 2026-10-02\n### Fixed\n- Two point one.");
  });

  it("with no previous release, takes everything up to the version", () => {
    expect(releaseNotes(CHANGELOG, "0.2.1.0")).toMatch(/^## \[0\.2\.1\.0\][\s\S]*- Two\.$/);
  });

  // Value: protects=the workflow failing loudly instead of publishing an empty release; fails_when=a missing section returns ""
  it("refuses a version the CHANGELOG does not have", () => {
    expect(() => releaseNotes(CHANGELOG, "0.4.0.0")).toThrow("no section for 0.4.0.0");
  });

  // Value: protects=a stray higher tag producing an empty release; fails_when=previous >= version returns ""
  it("refuses a previous release that is not older", () => {
    expect(() => releaseNotes(CHANGELOG, "0.2.1.0", "0.3.0.0")).toThrow("not older than 0.2.1.0");
  });

  it("drops non-version headings", () => {
    expect(changelogSections(CHANGELOG).map((s) => s.version)).toEqual(["0.3.0.0", "0.2.1.0", "0.2.0.0"]);
  });

  // Value: protects=0.10 sorting after 0.9 (string compare gets it wrong); fails_when=versions compare as text
  it("compares versions by number, with or without a v", () => {
    expect(compareVersions("0.10.0.0", "v0.9.14.10")).toBeGreaterThan(0);
    expect(compareVersions("v0.16.1.0", "0.16.1.0")).toBe(0);
  });

  it("reads the real CHANGELOG", () => {
    expect(releaseNotes(readFileSync("CHANGELOG.md", "utf8"), "0.16.0.0", "0.15.0.0")).toMatch(/^## \[0\.16\.0\.0\][\s\S]*## \[0\.15\.1\.0\]/);
  });

  // Value: protects=the command line release.yml runs; fails_when=the CLI entry stops printing or stops failing on bad input
  it("runs as a CLI the way release.yml calls it", () => {
    const out = execFileSync(process.execPath, ["scripts/release-notes.ts", "0.16.0.0", "0.15.0.0"], { encoding: "utf8", stdio: "pipe" });
    expect(out).toMatch(/^## \[0\.16\.0\.0\]/);
    expect(() => execFileSync(process.execPath, ["scripts/release-notes.ts", "9.9.0.0"], { stdio: "pipe" })).toThrow();
  });
});
