import { test, expect, type Browser } from "@playwright/test";

// 手動停頓 (docs/designs/manual-pacing.md): the host's switch, the hold panel and ▶ 下一步, through 擲先攻. The e2e worker
// holds the order only INITIATIVE_HOLD_MS (300 ms), so an order still up a second later is the manual hold. Every other
// pause, both switches and a restart are covered by lib/room/manual-pacing.test.ts.

async function hostRoom(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  return { host, code: host.url().match(/\/room\/([A-Z]{4})\//)![1] };
}

// Value: protects=the host page's switch reaches the room, a held pause shows its panel and stays, and ▶ 下一步 (button
// and key 1) moves on; fails_when=HOST_PACING or HOST_STEP is not sent, the hold is not in STATE, or the order's timer
// still runs in manual; why_new=manual pacing is new; seam=INITIATIVE_HOLD_MS; no_claim=the other pauses (unit tests)
test("manual pacing: 擲先攻 waits for 下一步, twice, and the switch goes back to auto", async ({ browser }) => {
  const { host, code } = await hostRoom(browser);
  const a = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await a.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(a.getByTestId("roster")).toContainText("甲隊");

  const pacing = host.getByTestId("host-pacing");
  await expect(pacing.getByRole("button", { name: "自動" })).toHaveAttribute("aria-pressed", "true");
  await pacing.getByRole("button", { name: "⏸ 手動" }).click();
  await expect(pacing.getByRole("button", { name: "⏸ 手動" })).toHaveAttribute("aria-pressed", "true");

  await host.getByRole("checkbox", { name: "開始前播放玩法說明" }).uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();

  // Waiting for rolls: no 全部代擲, the step rolls for the team.
  await expect(host.getByTestId("host-hold")).toContainText("代擲");
  await host.getByTestId("host-step").click();
  // The order is up and stays up.
  await expect(host.getByTestId("host-hold")).toContainText("第一題");
  await host.waitForTimeout(1000);
  await expect(host.getByTestId("host-hold")).toContainText("第一題");
  await expect(a.getByTestId("phone-initiative")).toBeVisible();

  await host.keyboard.press("1");
  await expect(a.getByText("輪到我們了！")).toBeVisible();
  await expect(host.getByTestId("host-hold")).toHaveCount(0);

  await pacing.getByRole("button", { name: "自動" }).click();
  await expect(pacing.getByRole("button", { name: "自動" })).toHaveAttribute("aria-pressed", "true");
});
