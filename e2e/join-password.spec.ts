import { test, expect } from "@playwright/test";

test("a join password keeps strangers out of the lobby and lets the right password in through the home form", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  await expect(host.getByText("目前沒有密碼")).toBeVisible();
  await host.getByPlaceholder("不設就留空").fill("dragon");
  await host.getByRole("button", { name: "設定" }).click();
  await expect(host.getByText("目前密碼：dragon")).toBeVisible();

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`/room/${code}/play?name=${encodeURIComponent("路人")}`);
  await expect(phone.getByText("這個房間要密碼才能加入")).toBeVisible();
  await phone.getByRole("link", { name: "回首頁輸入密碼" }).click();
  // Retried: under load the dev server can reload a freshly opened page, wiping what was typed into it.
  await expect(async () => {
    await phone.getByPlaceholder("隊伍名稱").fill("甲隊");
    await phone.getByPlaceholder(/房間密碼/).fill("dragon");
    await phone.getByRole("button", { name: /加入/ }).click();
    await expect(phone).toHaveURL(/\/play/, { timeout: 2000 });
  }).toPass();
  await expect(phone.getByText("等待主持人開始遊戲")).toBeVisible();
  expect(phone.url()).not.toContain("dragon"); // handed over in sessionStorage, never in the URL
  await expect(host.getByText("甲隊")).toBeVisible();
  await expect(host.getByText("路人")).toHaveCount(0);
});
