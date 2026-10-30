import { test, expect, type Page } from "@playwright/test";
import { textOnlyBank } from "./answer";

// These tests judge by hand (or HOST_JUDGE), which a multipleChoice turn doesn't take.
textOnlyBank();

/**
 * The big screen's sound effects (lib/sfx.ts) are synthesized, so there is nothing to listen to in
 * a test: instead this records the waveform of every oscillator the page creates. The music only
 * uses square and triangle waves; the wrong-answer buzz is the one sawtooth, so seeing one proves
 * that effect played.
 */
async function recordOscillatorTypes(page: Page) {
  await page.addInitScript(() => {
    const types: string[] = [];
    (window as unknown as { __oscTypes: string[] }).__oscTypes = types;
    const desc = Object.getOwnPropertyDescriptor(OscillatorNode.prototype, "type")!;
    Object.defineProperty(OscillatorNode.prototype, "type", {
      configurable: true,
      get() {
        return desc.get!.call(this);
      },
      set(v: OscillatorType) {
        types.push(v);
        desc.set!.call(this, v);
      },
    });
  });
}
const oscTypes = (page: Page) => page.evaluate(() => (window as unknown as { __oscTypes: string[] }).__oscTypes);

test("the big screen plays the wrong-answer effect when the host marks an answer wrong (music on)", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  for (const name of ["甲隊", "乙隊"]) {
    const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await team.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(team.getByTestId("roster")).toContainText(name);
  }
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await recordOscillatorTypes(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();
  // Joining mid-game plays nothing for the event already on screen.
  await screen.getByRole("button", { name: /音樂/ }).click();
  await expect.poll(async () => (await oscTypes(screen)).length).toBeGreaterThan(0); // the music is playing
  expect(await oscTypes(screen)).not.toContain("sawtooth");

  await host.getByRole("button", { name: "答錯・重答" }).click();
  await expect.poll(() => oscTypes(screen)).toContain("sawtooth");
});
