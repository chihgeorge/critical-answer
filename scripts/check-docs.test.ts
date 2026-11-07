import { describe, expect, it } from "vitest";
import { brokenLinks, headingSlugs, relativeLinks } from "./check-docs";

const files = (map: Record<string, string>) => (p: string) => (p in map ? map[p] : null);

describe("headingSlugs", () => {
  it("follows GitHub: lowercase, punctuation and emoji dropped, spaces to -, repeats numbered", () => {
    const md = ["# Critical Answer（致命答題）", "## 題庫卡住時怎麼救", "### `npm run dev` 與 Worker", "## 🎲 說服檢定！", "## FAQ", "## FAQ"].join("\n");
    expect([...headingSlugs(md)]).toEqual(["critical-answer致命答題", "題庫卡住時怎麼救", "npm-run-dev-與-worker", "-說服檢定", "faq", "faq-1"]);
  });

  it("ignores # lines inside code fences", () => {
    expect([...headingSlugs("```bash\n# not a heading\n```\n## Real")]).toEqual(["real"]);
  });

  it("uses a link's text, not its URL", () => {
    expect([...headingSlugs("## 見 [規則](rules.md)")]).toEqual(["見-規則"]);
  });
});

describe("relativeLinks", () => {
  it("keeps relative links, skips URLs, code spans and fences", () => {
    const md = "[a](docs/rules.md) [b](https://x.y) [c](#top) `[d](nope.md)`\n```\n[e](nope.md)\n```\n[f](mailto:a@b.c)";
    expect(relativeLinks(md)).toEqual(["docs/rules.md", "#top"]);
  });
});

describe("brokenLinks", () => {
  it("passes when files and anchors exist, resolving paths from the doc's folder", () => {
    const read = files({
      "README.md": "[規則](docs/rules.md#說服檢定) [圖](docs/images/a.png) [上](#top)\n# Top",
      "docs/rules.md": "## 說服檢定\n[回](../README.md) [設計](designs/x.md)",
      "docs/images/a.png": "",
      "docs/designs/x.md": "",
    });
    expect(brokenLinks("README.md", read)).toEqual([]);
    expect(brokenLinks("docs/rules.md", read)).toEqual([]);
  });

  it("reports a missing file and a missing anchor", () => {
    const read = files({ "docs/a.md": "[x](b.md) [y](../README.md#nope)", "README.md": "# Yes" });
    expect(brokenLinks("docs/a.md", read)).toEqual([
      "docs/a.md: b.md → docs/b.md does not exist",
      "docs/a.md: ../README.md#nope → no heading #nope in README.md",
    ]);
  });

  it("reports a listed doc that is missing", () => {
    expect(brokenLinks("docs/gone.md", files({}))).toEqual(["docs/gone.md: file is missing"]);
  });
});
