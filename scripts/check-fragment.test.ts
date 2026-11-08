import { describe, expect, it } from "vitest";
import { fragmentBody, fragmentProblems, type PrInput } from "./check-fragment";

const FRAGMENT = "### Fixed\n- A thing.\n";
const pkg = (version: string, extra = "") => JSON.stringify({ name: "x", version, extra });

/** A PR on branch `feat/x` whose head files are `head`; base files are `base`. Every head file counts as added. */
function pr(head: Record<string, string>, opts: Partial<PrInput> & { base?: Record<string, string>; modified?: string[] } = {}): PrInput {
  const base = opts.base ?? {};
  const changes = [
    ...Object.keys(head).map((path) => ({ status: path in base ? "M" : "A", path })),
    ...(opts.modified ?? []).map((path) => ({ status: "M", path })),
  ];
  const files = { base, head };
  return {
    branch: opts.branch ?? "feat/x",
    author: opts.author ?? "chihgeorge",
    changes: opts.changes ?? changes,
    show: (rev, path) => files[rev][path] ?? null,
  };
}

describe("fragmentProblems", () => {
  it("passes a PR that adds one fragment and touches no version", () => {
    expect(fragmentProblems(pr({ "changelog.d/feat-x.md": FRAGMENT, "lib/a.ts": "x" }))).toEqual([]);
  });

  // Value: protects=a PR silently dropping its CHANGELOG entry; fails_when=a PR with no fragment passes
  it("requires a fragment, and README.md does not count", () => {
    expect(fragmentProblems(pr({ "lib/a.ts": "x" }))).toEqual([expect.stringContaining("add a <branch-slug>.md fragment")]);
    expect(fragmentProblems(pr({ "changelog.d/README.md": "x" }))).toHaveLength(1);
    // Only a file directly in changelog.d/, and only one this PR adds.
    expect(fragmentProblems(pr({ "changelog.d/sub/x.md": FRAGMENT }))).toHaveLength(1);
    expect(fragmentProblems(pr({}, { modified: ["changelog.d/old.md"] }))).toHaveLength(1);
  });

  // Value: protects=the release fold getting a blank or double-headed section; fails_when=an empty or headed fragment passes
  it("rejects an empty fragment, front matter alone, and a ## [x] version heading", () => {
    expect(fragmentProblems(pr({ "changelog.d/a.md": "  \n" }))).toEqual(["changelog.d/a.md: the fragment is empty"]);
    expect(fragmentProblems(pr({ "changelog.d/a.md": "---\nbump: minor\n---\n" }))).toEqual(["changelog.d/a.md: the fragment is empty"]);
    expect(fragmentProblems(pr({ "changelog.d/a.md": "## [0.1.0.0] - 2026-11-08\n" + FRAGMENT }))).toEqual([
      expect.stringContaining('no "## [x]" version heading'),
    ]);
    expect(fragmentProblems(pr({ "changelog.d/a.md": "---\nbump: minor\n---\n### Added\n- New.\n" }))).toEqual([]);
  });

  // Value: protects=two open PRs conflicting on the version; fails_when=a PR edits VERSION/CHANGELOG/version fields and passes
  it("rejects VERSION, CHANGELOG.md and a changed package version", () => {
    const base = { VERSION: "0.1.0.0", "CHANGELOG.md": "# Changelog", "package.json": pkg("0.1.0.0"), "package-lock.json": pkg("0.1.0.0") };
    const head = { "changelog.d/a.md": FRAGMENT, VERSION: "0.2.0.0", "CHANGELOG.md": "# Changelog\n## [0.2.0.0]", "package.json": pkg("0.2.0.0"), "package-lock.json": pkg("0.2.0.0") };
    expect(fragmentProblems(pr(head, { base }))).toEqual([
      expect.stringMatching(/^VERSION: /),
      expect.stringMatching(/^CHANGELOG\.md: /),
      expect.stringMatching(/^package\.json: the version/),
      expect.stringMatching(/^package-lock\.json: the version/),
    ]);
  });

  it("allows package.json and package-lock.json changes that keep the version", () => {
    const base = { "package.json": pkg("0.1.0.0"), "package-lock.json": pkg("0.1.0.0") };
    const head = { "changelog.d/a.md": FRAGMENT, "package.json": pkg("0.1.0.0", "dep"), "package-lock.json": pkg("0.1.0.0", "dep") };
    expect(fragmentProblems(pr(head, { base }))).toEqual([]);
  });

  it("skips everything on a release/* branch", () => {
    expect(fragmentProblems(pr({ VERSION: "0.2.0.0" }, { branch: "release/0.2.0.0", base: { VERSION: "0.1.0.0" } }))).toEqual([]);
  });

  it("lets dependabot skip the fragment but not the version rules", () => {
    expect(fragmentProblems(pr({ "package-lock.json": pkg("0.1.0.0", "dep") }, { author: "dependabot[bot]", base: { "package-lock.json": pkg("0.1.0.0") } }))).toEqual([]);
    expect(fragmentProblems(pr({ VERSION: "0.2.0.0" }, { author: "dependabot[bot]", base: { VERSION: "0.1.0.0" } }))).toHaveLength(1);
  });
});

describe("fragmentBody", () => {
  it("drops front matter only at the top", () => {
    expect(fragmentBody("---\nbump: minor\n---\n### Added\n- x\n")).toBe("### Added\n- x");
    expect(fragmentBody("### Added\n---\n- x")).toBe("### Added\n---\n- x");
  });
});
