import { test, expect } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

test("owner key gate, load, add/edit/delete a question, save, and reload persists it", async ({ page }) => {
  await page.goto("/bank-editor");

  // Wrong key: a clear rejection, no question list.
  await page.getByLabel("Owner key").fill("wrong-key");
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await expect(page.getByTestId("bank-room-0")).toHaveCount(0);

  // Correct key: the bundled bank loads (seeded into BankStore on first read).
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-room-0");
  await expect(room0).toBeVisible();
  const startingCount = await room0.getByLabel("題目").count();

  // Add a question (appended last) and edit the first one already there.
  await room0.getByRole("button", { name: "+ 新增題目" }).click();
  await room0.getByLabel("題目").last().fill("e2e 測試題目");
  await room0.getByLabel("答案").last().fill("e2e 測試答案");
  await room0.getByLabel("題目").first().fill("編輯過的題目");
  await expect(room0.getByLabel("題目")).toHaveCount(startingCount + 1);

  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  // Reload with the key and confirm both changes persisted through BankStore, not just local state.
  await page.reload();
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0AfterSave = page.getByTestId("bank-room-0");
  await expect(room0AfterSave.getByLabel("題目").first()).toHaveValue("編輯過的題目");
  await expect(room0AfterSave.getByLabel("題目").last()).toHaveValue("e2e 測試題目");
  await expect(room0AfterSave.getByLabel("題目")).toHaveCount(startingCount + 1);

  // Delete the question just added (the last one) and save again.
  const lastRow = room0AfterSave.getByLabel("題目").last().locator("xpath=..");
  await lastRow.getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await page.reload();
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-room-0").getByLabel("題目")).toHaveCount(startingCount);
});
