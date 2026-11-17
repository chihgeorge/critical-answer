import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "check-bundle.sh");
const mc = (id: string, options: string[]) => ({ kind: "multipleChoice", id, text: `題目 ${id} 的完整句子？`, options, correctIndex: 0 });
const bank = { pools: { "1": [mc("short", ["6 個", "7 個"]), mc("long", ["魔王的尾巴", "魔王的角"])] }, boss: { questions: [] } };

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/** Runs the check over a fake built bundle holding `js`; returns its exit code. */
function check(js: string): number {
  dir = mkdtempSync(join(tmpdir(), "check-bundle-"));
  mkdirSync(join(dir, ".next/static"), { recursive: true });
  writeFileSync(join(dir, ".next/static/page.js"), js);
  writeFileSync(join(dir, "bank.json"), JSON.stringify(bank));
  try {
    execFileSync("sh", [SCRIPT], { cwd: dir, env: { ...process.env, BANK: "bank.json" }, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

// Value: protects=a short choice in unrelated UI text is not a leak, while a real one still is; fails_when=short
// choices go back to raw substring matching, or the quoted form stops counting; why_new=TODO 手機答題的剩餘小風險 item 5
describe("check-bundle.sh", () => {
  it("passes a bundle where a short answer only shows up inside other text", () => {
    expect(check('const hint="最多 6 個人一隊";')).toBe(0);
  });

  it("fails a short answer as a whole string literal, and a long answer anywhere", () => {
    expect(check('const o=["6 個","7 個"];')).toBe(1);
    expect(check("const o=['6 個'];")).toBe(1);
    expect(check("const o=`6 個`;")).toBe(1);
    expect(check('const t="這是魔王的尾巴喔";')).toBe(1);
  });
});
