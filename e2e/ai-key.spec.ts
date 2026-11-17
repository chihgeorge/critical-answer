import { test, expect } from "@playwright/test";
import { startGame, closeLeftoverContexts } from "./answer";
import { E2E_OWNER_KEY } from "../playwright.config";

closeLeftoverContexts();

// The e2e server has no ANTHROPIC_API_KEY and no way to reach a fake Anthropic (the key check runs in the
// Worker, not the browser), so these cover the paths that need no network: a refused key never reaches
// localStorage, and owner mode says the server has no key. A key that passes is covered in lib/room/ai-key.test.ts.

test("a malformed key is refused and never remembered, even with 記住這台電腦 ticked", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /主持遊戲/ }).click();
  await page.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);

  await expect(page.getByRole("radio", { name: /不用 AI/ })).toBeChecked();
  await page.getByRole("radio", { name: /用我自己的 Anthropic API key/ }).check();
  await page.getByRole("textbox", { name: "Anthropic API key" }).fill("sk-not-a-real-key");
  await page.getByRole("checkbox", { name: /記住這台電腦/ }).check();
  await page.getByRole("button", { name: "驗證並使用" }).click();
  await expect(page.getByText("這把 key 無效")).toBeVisible();

  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ai-key:")));
  expect(stored).toEqual([]);
  await page.reload();
  await expect(page.getByRole("radio", { name: /不用 AI/ })).toBeChecked();
});

test("owner mode on a server without its own key says so, and the game still starts with scripted lines", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  // The key's status waits for HOST_OK. Early in a CI shard the first connect can miss and wait out partysocket's
  // backoff, which once ate the whole 5 s wait for the status (run 44000555668: still 連線中…). Wait for the room first.
  await expect(host.getByTestId("screen-link")).toHaveAttribute("href", /\/screen#s=./, { timeout: 15_000 });

  await host.getByRole("radio", { name: "站長金鑰" }).check();
  await host.getByRole("textbox", { name: /OWNER_KEY/ }).fill(E2E_OWNER_KEY);
  await host.getByRole("button", { name: "使用站長金鑰" }).click();
  await expect(host.getByText("這個伺服器沒有開放站長金鑰")).toBeVisible();

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(phone.getByText("等待主持人開始遊戲")).toBeVisible();
  await startGame(host);
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
});
