import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// eslint.config.mjs's guard for the #147 bug class: an event read inside a deferred state updater.
const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });
const ruleHits = async (code: string, filePath = "components/probe.tsx") => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax").length;
};

describe("eslint.config.mjs: no event reads inside a deferred updater (#147)", () => {
  it("flags e.target / event.target read inside set*, update* and onUpdate updaters", async () => {
    const code = `
export function f(setV: (u: () => string) => void, p: { onUpdate: (u: () => void) => void }, updateQ: (i: number, u: (q: string) => string) => void) {
  return [
    (e: { target: { value: string } }) => setV(() => e.target.value),
    (e: { currentTarget: { value: string } }) => p.onUpdate(function () { void e.currentTarget.value; }),
    (event: { target: { value: string } }) => updateQ(1, (q) => q + event.target.value),
  ];
}`;
    expect(await ruleHits(code)).toBe(3);
  });

  it("allows the fix (read first), timers, and code outside the client folders", async () => {
    const code = `
export function f(setV: (u: () => string) => void) {
  return [
    (e: { target: { value: string } }) => { const v = e.target.value; setV(() => v); },
    (e: { target: { value: string } }) => setV(() => "x" + String(e === null)),
    (e: { target: HTMLInputElement }) => setTimeout(() => e.target.focus()),
  ];
}`;
    expect(await ruleHits(code)).toBe(0);
    expect(await ruleHits(`export const g = (setV: (u: () => string) => void, e: { target: { value: string } }) => setV(() => e.target.value);`, "worker/probe.ts")).toBe(0);
  });
});
