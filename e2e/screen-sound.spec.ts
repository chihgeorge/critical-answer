import { test, expect } from "@playwright/test";
import { textOnlyBank, startGame, screenUrl } from "./answer";

textOnlyBank();

// docs/designs/immersion.md PR0: the big screen reports whether it can be heard, and the host page says so.
test("the host page warns until the big screen's sound is on, then says it is ready", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(await screenUrl(host));
  // The lobby's big button, named so it never matches the 🎵 / 語音 toggles' lookups.
  await expect(screen.getByRole("button", { name: "開啟音效與氣氛" })).toBeVisible();

  for (const name of ["甲隊", "乙隊"]) {
    const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await team.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(team.getByTestId("roster")).toContainText(name);
  }
  await startGame(host);
  await expect(host.getByTestId("screen-sound")).toContainText("大螢幕還沒開聲音");

  await screen.getByRole("button", { name: "👆 開聲音" }).click();
  await expect(host.getByTestId("screen-sound")).toContainText("🔊 大螢幕聲音已就緒");
  await expect(screen.getByRole("button", { name: /音樂開/ })).toBeVisible();
});
