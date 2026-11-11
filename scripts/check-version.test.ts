import { describe, expect, it } from "vitest";
import { versionProblems } from "./check-version";

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

  it("refuses a PR that keeps or lowers VERSION", () => {
    expect(check(BASE)).toEqual(["VERSION: 0.58.0.0 must be higher than 0.58.0.0 on the base branch; bump it (/ship Step 12)"]);
    expect(check(files("0.57.9.0"))[0]).toMatch(/must be higher than 0.58.0.0/);
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
