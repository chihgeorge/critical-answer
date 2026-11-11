import { describe, expect, it } from "vitest";
import { nextVersions, versionProblems } from "./check-version";

const pkg = (version: string) => JSON.stringify({ name: "x", version });
const changelog = (...versions: string[]) => "# Changelog\n\n" + versions.map((v) => `## [${v}] - 2026-11-11\n\n### Fixed\n- A thing.\n`).join("\n");
const files = (version: string, top = version, pkgVersion = version.split(".").slice(0, 3).join(".")) => ({
  VERSION: `${version}\n`,
  "CHANGELOG.md": changelog(top, "0.58.0.0"),
  "package.json": pkg(pkgVersion),
  "package-lock.json": pkg(pkgVersion),
});
const BASE = files("0.58.0.0");
const check = (head: Record<string, string>, author = "chihgeorge", base: Record<string, string> = BASE) =>
  versionProblems({ author, show: (rev, path) => (rev === "base" ? base : head)[path] ?? null });

describe("versionProblems", () => {
  it("passes a PR that bumps VERSION, opens the CHANGELOG with it and matches the package versions", () => {
    expect(check(files("0.58.1.0"))).toEqual([]);
    expect(check(files("0.58.0.1"))).toEqual([]);
    expect(check(files("1.0.0.0"))).toEqual([]);
  });

  it("accepts only one part up by one, with the parts after it reset to 0", () => {
    expect(nextVersions("0.58.3.2")).toEqual(["1.0.0.0", "0.59.0.0", "0.58.4.0", "0.58.3.3"]);
    const refused = "VERSION: %s is not one bump above 0.58.0.0; use one of 1.0.0.0, 0.59.0.0, 0.58.1.0, 0.58.0.1 (/ship Step 12)";
    // Kept, lowered, skipped a number, or bumped two parts at once.
    for (const v of ["0.58.0.0", "0.57.9.0", "0.60.0.0", "0.58.2.0", "0.59.0.1", "0.58.1.1"]) expect(check(files(v))).toEqual([refused.replace("%s", v)]);
  });

  it("refuses a CHANGELOG whose first section is not the new version", () => {
    expect(check(files("0.58.1.0", "0.58.0.0"))).toEqual(["CHANGELOG.md: the first section must be ## [0.58.1.0], found ## [0.58.0.0]"]);
    expect(check({ ...files("0.58.1.0"), "CHANGELOG.md": "# Changelog\n" })).toEqual(["CHANGELOG.md: the first section must be ## [0.58.1.0], found none"]);
  });

  it("refuses package versions that are not VERSION's first three parts", () => {
    expect(check(files("0.58.1.0", "0.58.1.0", "0.58.0"))).toEqual([
      "package.json: the version must be 0.58.1 (VERSION's first three parts), found 0.58.0",
      "package-lock.json: the version must be 0.58.1 (VERSION's first three parts), found 0.58.0",
    ]);
  });

  it("refuses a malformed VERSION, and lets dependabot through untouched", () => {
    expect(check({ ...files("0.58.1.0"), VERSION: "0.58.1\n" })).toEqual(['VERSION: "0.58.1" is not a four-part version like 0.58.0.0']);
    expect(check(BASE, "dependabot[bot]")).toEqual([]);
  });
});
