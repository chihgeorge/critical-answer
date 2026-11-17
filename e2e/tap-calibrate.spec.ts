import { test, expect } from "@playwright/test";
import { textOnlyBank, screenUrl, closeLeftoverContexts } from "./answer";

closeLeftoverContexts();

textOnlyBank();

// docs/designs/tap-calibrate.md: 🎯 校正喇叭 in the lobby's ⚙ 更多. The big screen must have sound first; then it beeps
// (a still card, no pulse), the joined phone taps along, and only 套用 writes the suggested latency.
test("🎯 校正喇叭: needs the screen's sound, phones tap along, and 套用 writes the suggested latency", async ({ browser }) => {
  test.setTimeout(60_000);
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(await screenUrl(host));
  await expect(screen.getByRole("button", { name: "開啟音效與氣氛" })).toBeVisible();

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(phone.getByTestId("roster")).toContainText("甲隊");

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const panel = host.getByTestId("tap-calibrate");
  await expect(panel).toContainText("現在 0 ms");
  // No sound on the big screen yet: the room refuses and the host is told where to tap.
  await panel.getByRole("button", { name: "🎯 校正喇叭" }).click();
  await expect(panel).toContainText("點一下開啟音效與氣氛");
  await expect(phone.getByTestId("calibrate-tap")).toHaveCount(0);

  await screen.getByRole("button", { name: "開啟音效與氣氛" }).click();
  await expect(screen.getByRole("button", { name: "開啟音效與氣氛" })).toHaveCount(0);
  const pressed = Date.now();
  await panel.getByRole("button", { name: "🎯 校正喇叭" }).click();
  await expect(panel.getByRole("button", { name: /校正中/ })).toBeDisabled();
  await expect(screen.getByRole("status").filter({ hasText: "聽嗶聲，用手機跟著按" })).toBeVisible();
  const beep = phone.getByTestId("calibrate-tap").getByRole("button", { name: "嗶！" });
  await expect(beep).toBeEnabled();

  // The first beep is 3 s after the press; tap 150 ms after each beat, on an absolute schedule so click time does not drift.
  for (let k = 0; k < 8; k++) {
    await phone.waitForTimeout(Math.max(0, pressed + 3150 + k * 1000 - Date.now()));
    await beep.click();
  }
  await expect(phone.getByTestId("calibrate-tap")).toContainText("按了 8 下");

  const result = panel.getByRole("status");
  await expect(result).toContainText(/建議延遲 \d+ ms/, { timeout: 10_000 });
  const ms = Number((await result.textContent())!.match(/建議延遲 (\d+) ms/)![1]);
  await expect(result).toContainText("1 支手機");
  // The test is over: the phone's button and the screen's card go.
  await expect(phone.getByTestId("calibrate-tap")).toHaveCount(0);
  await expect(screen.getByText("聽嗶聲，用手機跟著按")).toHaveCount(0);

  await result.getByRole("button", { name: "套用" }).click();
  await expect(panel).toContainText(`現在 ${ms} ms`);
});
