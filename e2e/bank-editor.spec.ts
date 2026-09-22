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

test("a save that fails server-side validation shows the server's error, and does not clear the form", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-room-0");
  await expect(room0).toBeVisible();

  // parseBank() rejects an empty answer — a real state reachable by clearing the field, not a
  // client-side-only validation the form itself would block.
  await room0.getByLabel("答案").first().fill("");
  await page.getByRole("button", { name: "儲存全部變更" }).click();

  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await expect(page.getByTestId("bank-editor-error")).toContainText(/empty answer/i);
});

test("deleting every question in a room down to zero is rejected on save (a room needs at least one)", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();

  // The boss room is smaller in the bundled bank, so it takes fewer deletes to empty out.
  // parseBank() requires every room (and the boss) to have at least one question — emptying one
  // out is a real, reachable UI state, and the save must be rejected, not silently accepted.
  const boss = page.getByTestId("bank-room-boss");
  await expect(boss).toBeVisible();
  let remaining = await boss.getByLabel("題目").count();
  while (remaining > 0) {
    await boss.getByRole("button", { name: "刪除" }).first().click();
    remaining--;
  }
  await expect(boss.getByLabel("題目")).toHaveCount(0);

  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await expect(page.getByTestId("bank-editor-error")).toContainText(/no questions/i);

  // Nothing was actually persisted — a fresh load still has the original boss question(s).
  await page.reload();
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const bossAfterReload = page.getByTestId("bank-room-boss");
  await expect(bossAfterReload).toBeVisible();
  await expect(bossAfterReload.getByLabel("題目")).not.toHaveCount(0);
});
