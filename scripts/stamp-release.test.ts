import { describe, expect, it } from "vitest";
import { bumpVersion, setPackageVersion, stamp } from "./stamp-release";

const CHANGELOG = "# Changelog\n\nAll notable changes.\n\n## [0.57.0.0] - 2026-11-09\n\n### Added\n- Old.\n";
const frag = (path: string, bump: string | null, body: string) => ({ path, text: (bump ? `---\nbump: ${bump}\n---\n` : "") + body });

describe("bumpVersion", () => {
  // Value: protects=the per-part version rule; fails_when=a bump skips a number or keeps a later part
  it("raises exactly one part by one and resets the parts after it", () => {
    expect(bumpVersion("0.58.3.2", "major")).toBe("1.0.0.0");
    expect(bumpVersion("0.58.3.2", "minor")).toBe("0.59.0.0");
    expect(bumpVersion("0.58.3.2", "patch")).toBe("0.58.4.0");
    expect(bumpVersion("0.58.3.2", "micro")).toBe("0.58.3.3");
  });
});

describe("stamp", () => {
  it("takes the highest bump, folds the fragments in path order above the newest section", () => {
    const out = stamp("0.57.0.0", CHANGELOG, [frag("changelog.d/b.md", "micro", "### Fixed\n- B.\n"), frag("changelog.d/a.md", "minor", "### Added\n- A.\n")], "2026-11-11");
    expect(out.version).toBe("0.58.0.0");
    expect(out.changelog).toBe(
      "# Changelog\n\nAll notable changes.\n\n## [0.58.0.0] - 2026-11-11\n\n### Added\n- A.\n\n### Fixed\n- B.\n\n## [0.57.0.0] - 2026-11-09\n\n### Added\n- Old.\n",
    );
  });

  it("counts a legacy fragment with no bump as patch", () => {
    expect(stamp("0.57.0.0", CHANGELOG, [frag("changelog.d/a.md", null, "- A.")], "2026-11-11").version).toBe("0.57.1.0");
    expect(stamp("0.57.0.0", CHANGELOG, [frag("changelog.d/a.md", "micro", "- A.")], "2026-11-11").version).toBe("0.57.0.1");
  });

  it("appends the section when the CHANGELOG has none yet", () => {
    expect(stamp("0.1.0.0", "# Changelog\n", [frag("changelog.d/a.md", "patch", "- A.")], "2026-11-11").changelog).toBe("# Changelog\n\n## [0.1.1.0] - 2026-11-11\n\n- A.\n\n");
  });
});

describe("setPackageVersion", () => {
  it("sets the version and a lockfile's root package version", () => {
    expect(JSON.parse(setPackageVersion(JSON.stringify({ name: "x", version: "0.57.0" }), "0.58.0"))).toEqual({ name: "x", version: "0.58.0" });
    const lock = JSON.parse(setPackageVersion(JSON.stringify({ version: "0.57.0", packages: { "": { version: "0.57.0" }, "node_modules/a": { version: "1.0.0" } } }), "0.58.0"));
    expect(lock).toEqual({ version: "0.58.0", packages: { "": { version: "0.58.0" }, "node_modules/a": { version: "1.0.0" } } });
  });
});
