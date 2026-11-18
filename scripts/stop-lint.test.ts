import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { lintReply, stopOutput } from "./stop-lint.mts";

describe("stop-lint", () => {
  it("passes a Traditional Chinese report", () => {
    expect(lintReply("第 34 點已記下，清單共 34 點。現在沒有 lane 在跑。")).toBeNull();
  });
  it("blocks a mostly English reply", () => {
    expect(lintReply("The hook confirmed that my last reply asked you nothing, so there is nothing to change.")).toMatch(/^B1/);
  });
  it("ignores English inside code, links and paths", () => {
    expect(lintReply("已開 [#364](https://github.com/x/y/issues/364)，見 `npm run test -- --reporter verbose` 和 ~/Repository/critical-answer/scripts/stop-lint.mts。")).toBeNull();
  });
  it("blocks Simplified Chinese", () => {
    expect(lintReply("这个问题我们现在还没进行处理。")).toMatch(/^B1/);
  });
  it("blocks a question in the prose", () => {
    expect(lintReply("清單已存好。要先做哪一條？")).toMatch(/^B2/);
    expect(lintReply("Done. Which one first? 好")).toMatch(/^B2/);
    expect(lintReply("清單已存好。**要先做哪一條？**")).toMatch(/^B2/);
    expect(lintReply("要合併嗎？請按上面的按鈕。")).toMatch(/^B2/);
    expect(lintReply("見 https://example.com/x？")).toMatch(/^B2/);
  });
  it("passes a self-answered question mid-sentence", () => {
    expect(lintReply("為什麼會壞？因為規則沒排除首領房。")).toBeNull();
  });
  it("passes a Chinese report full of identifiers and relative paths", () => {
    expect(lintReply("PR #216 已合併。CI 的 static、e2e shard 1/2/3、check:bundle、tsc、eslint、vitest 全綠，Cloudflare Workers Builds 自動部署完成，canary 檢查 production URL 正常。")).toBeNull();
    expect(lintReply("改了 scripts/stop-lint.mts 和 lib/room/dungeon-room.ts，跑過 npm run test。")).toBeNull();
  });
  it("blocks Simplified Chinese outside the most common characters", () => {
    expect(lintReply("修复完成，已经测试通过，代码已提交。")).toMatch(/^B1/);
  });
  it("passes a question quoted from the owner", () => {
    expect(lintReply("你問「為什麼會出現說服骰？」原因是規則沒排除首領房。")).toBeNull();
  });
  it("always lets the second stop through", () => {
    expect(stopOutput({ stop_hook_active: true, last_assistant_message: "要先做哪一條？" })).toBe("");
    expect(stopOutput({ last_assistant_message: "" })).toBe("");
    expect(JSON.parse(stopOutput({ last_assistant_message: "要先做哪一條？" }))).toMatchObject({ decision: "block" });
  });
  it("fails open on bad stdin and blocks through the real entry point", () => {
    const run = (input: string) => spawnSync(process.execPath, ["--no-warnings", "scripts/stop-lint.mts"], { input, encoding: "utf8" });
    const bad = run("{bad");
    expect(bad.status).toBe(0);
    expect(bad.stdout).toBe("");
    const ask = run(JSON.stringify({ last_assistant_message: "要先做哪一條？" }));
    expect(ask.status).toBe(0);
    expect(JSON.parse(ask.stdout)).toMatchObject({ decision: "block" });
  });
});
