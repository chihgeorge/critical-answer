import { describe, expect, it } from "vitest";
import { brokenLinks, headingSlugs, orphanTwin, relativeLinks, switchLine, twinProblems } from "./check-docs";

const files = (map: Record<string, string>) => (p: string) => (p in map ? map[p] : null);

describe("headingSlugs", () => {
  it("follows GitHub: lowercase, punctuation and emoji dropped, spaces to -, repeats numbered", () => {
    const md = ["# Critical Answer（致命答題）", "## 題庫卡住時怎麼救", "### `npm run dev` 與 Worker", "## 🎲 說服檢定！", "## FAQ", "## FAQ"].join("\n");
    expect([...headingSlugs(md)]).toEqual(["critical-answer致命答題", "題庫卡住時怎麼救", "npm-run-dev-與-worker", "-說服檢定", "faq", "faq-1"]);
  });

  it("ignores # lines inside code fences", () => {
    expect([...headingSlugs("```bash\n# not a heading\n```\n## Real")]).toEqual(["real"]);
  });

  it("skips ids already taken when numbering repeats", () => {
    expect([...headingSlugs("# A\n# A\n# A-1")]).toEqual(["a", "a-1", "a-1-1"]);
  });

  it("handles ~~~ fences and a longer fence holding ``` lines", () => {
    expect([...headingSlugs("~~~\n# no\n~~~\n````md\n```\n# no\n```\n````\n# Yes")]).toEqual(["yes"]);
  });

  it("drops HTML tags but keeps their text", () => {
    expect([...headingSlugs("## <kbd>Esc</kbd> 鍵")]).toEqual(["esc-鍵"]);
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

  it("ignores links in ~~~ fences and reports a malformed %-escape as a missing file instead of crashing", () => {
    const read = files({ "a.md": "~~~\n[x](gone.md)\n~~~\n[y](bad%zz.md)" });
    expect(brokenLinks("a.md", read)).toEqual(["a.md: bad%zz.md → bad%zz.md does not exist"]);
  });

  it("ignores links in a fence indented under a list item", () => {
    expect(relativeLinks("1. Run:\n\n    ```sh\n    [x](gone.md)\n    ```\n[y](a.md)")).toEqual(["a.md"]);
  });

  it("reports an unclosed fence, which would hide every later link", () => {
    expect(brokenLinks("a.md", files({ "a.md": "```\n[x](gone.md)" }))).toEqual(["a.md: a code fence never closes"]);
  });

  it("reads a leading / from the repository root and rejects a link that leaves the repository", () => {
    const read = files({ "docs/a.md": "[r](/README.md) [out](../../x.md)", "README.md": "" });
    expect(brokenLinks("docs/a.md", read)).toEqual(["docs/a.md: ../../x.md → leaves the repository"]);
  });

  it("reports a listed doc that is missing", () => {
    expect(brokenLinks("docs/gone.md", files({}))).toEqual(["docs/gone.md: file is missing"]);
  });
});

describe("twinProblems", () => {
  const zh = "繁體中文 | [English](rules.en.md)\n# 規則\n## 判定\n### 細節";
  const en = "[繁體中文](rules.md) | English\n# Rules\n## Judging\n### Details";

  it("passes when the twin exists, both open with the switch line and the heading levels match", () => {
    expect(twinProblems("docs/rules.md", files({ "docs/rules.md": zh, "docs/rules.en.md": en }))).toEqual([]);
  });

  it("reports a missing twin", () => {
    expect(twinProblems("docs/rules.md", files({ "docs/rules.md": zh }))).toEqual(["docs/rules.md: no English twin docs/rules.en.md"]);
  });

  it("reports a missing or wrong switch line on either side", () => {
    const read = files({ "docs/rules.md": zh.split("\n").slice(1).join("\n"), "docs/rules.en.md": en.replace("rules.md", "README.md") });
    expect(twinProblems("docs/rules.md", read)).toEqual([
      'docs/rules.md: first line must be "繁體中文 | [English](rules.en.md)"',
      'docs/rules.en.md: first line must be "[繁體中文](rules.md) | English"',
    ]);
  });

  it("reports headings that differ in level or count", () => {
    expect(twinProblems("a.md", files({ "a.md": switchLine("a.md") + "\n# A\n## B", "a.en.md": switchLine("a.en.md") + "\n# A\n### B" }))).toEqual([
      "a.en.md: headings differ from a.md at heading 2 (2 vs 2 headings)",
    ]);
    expect(twinProblems("a.md", files({ "a.md": switchLine("a.md") + "\n# A\n## B", "a.en.md": switchLine("a.en.md") + "\n# A" }))).toEqual([
      "a.en.md: headings differ from a.md at heading 2 (2 vs 1 headings)",
    ]);
  });
});

describe("orphanTwin", () => {
  it("passes an English doc whose Chinese doc exists", () => {
    expect(orphanTwin("docs/rules.en.md", files({ "docs/rules.md": "" }))).toEqual([]);
  });

  it("reports an English doc with no Chinese doc, or one paired with a Chinese-only doc", () => {
    expect(orphanTwin("docs/foo.en.md", files({}))).toEqual(["docs/foo.en.md: no Chinese doc docs/foo.md to pair with"]);
    expect(orphanTwin("docs/going-public.en.md", files({ "docs/going-public.md": "" }))).toEqual([
      "docs/going-public.en.md: no Chinese doc docs/going-public.md to pair with",
    ]);
  });
});
