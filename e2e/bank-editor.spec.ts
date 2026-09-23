import { test, expect, type Page } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

test("homepage links to the bank editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /題庫編輯器/ }).click();
  await expect(page).toHaveURL(/\/bank-editor$/);
  await expect(page.getByLabel("Owner key")).toBeVisible();
});

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
  const lastRow = room0AfterSave.getByLabel("題目").last().locator("xpath=../..");
  await lastRow.getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await page.reload();
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-room-0").getByLabel("題目")).toHaveCount(startingCount);
});

test("a remembered owner key (localStorage) auto-loads the bank on a fresh visit, no typing required", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-room-0")).toBeVisible(); // save() below isn't reached — this just persists the key

  // A fresh page load (simulating a returning owner) must read the key back and auto-load, per
  // useOwnerKey's onRestored callback — never typing the key again this browser.
  await page.reload();
  await expect(page.getByLabel("Owner key")).toHaveValue(E2E_OWNER_KEY);
  await expect(page.getByTestId("bank-room-0")).toBeVisible();
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

test("multipleChoice authoring: switch kind, edit options, mark correct, and deleting the marked-correct option blocks save until re-marked", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-room-0");
  await expect(room0).toBeVisible();

  // Switch the first question in room 0 to multipleChoice — it starts as a text question.
  const firstRow = room0.getByLabel("題目").first().locator("xpath=../..");
  await firstRow.getByLabel("題型").selectOption("multipleChoice");
  // blankQuestion() gives a fresh multipleChoice question: 2 empty options, no answer field.
  await expect(firstRow.getByLabel("答案")).toHaveCount(0);
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(2);

  await firstRow.getByLabel("選項 1").fill("台北 101");
  await firstRow.getByLabel("選項 2").fill("高雄 85 大樓");
  await firstRow.getByRole("button", { name: "+ 新增選項" }).click();
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(3);
  await firstRow.getByLabel("選項 3").fill("台中歌劇院");

  // Nothing marked correct yet — save must be rejected, not silently accepted with a bogus pick.
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toContainText(/還沒標記正解/);

  // Mark option 1 correct, then delete it — the mark must not silently move to whatever now
  // sits at index 0; it has to go back to "unmarked" and block save again.
  await firstRow.getByLabel("第 1 個選項為正解").check();
  await firstRow.getByLabel("選項 1").locator("xpath=..").getByRole("button", { name: "刪" }).click();
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(2);

  // At the MIN_OPTIONS floor, the delete button on every remaining option is disabled — a
  // multipleChoice question can never drop below 2 options via the UI.
  await expect(firstRow.getByLabel("選項 1").locator("xpath=..").getByRole("button", { name: "刪" })).toBeDisabled();
  await expect(firstRow.getByLabel("選項 2").locator("xpath=..").getByRole("button", { name: "刪" })).toBeDisabled();

  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toContainText(/還沒標記正解/);

  // Mark the (now first) remaining option correct and save — this time it goes through.
  await firstRow.getByLabel("第 1 個選項為正解").check();
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  // Reload and confirm it persisted as multipleChoice with the mark intact, not reverted to text.
  await page.reload();
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const reloadedRow = page.getByTestId("bank-room-0").getByLabel("題目").first().locator("xpath=../..");
  await expect(reloadedRow.getByLabel("題型")).toHaveValue("multipleChoice");
  await expect(reloadedRow.getByLabel("第 1 個選項為正解")).toBeChecked();
});

test("multipleChoice question-text field stays wide and editable, not squeezed by the 題型 select (2026-09-23 regression)", async ({ page }) => {
  // The 題型 <select> reuses the .px-input class, which sets width:100% as unlayered CSS — that
  // beats any Tailwind width utility (Tailwind's utilities live inside a cascade layer, and
  // unlayered rules always win). Without an explicit inline-style override on the select, its
  // flex-basis resolves to the full row width and the sibling 題目 input gets squeezed to ~20px:
  // technically present and fillable, but invisible to a real user. A plain .fill() + .toHaveValue
  // check wouldn't catch this — it doesn't require real screen space — so this asserts the actual
  // rendered width instead.
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-room-0");
  await expect(room0).toBeVisible();

  const firstRow = room0.getByLabel("題目").first().locator("xpath=../..");
  await firstRow.getByLabel("題型").selectOption("multipleChoice");

  const questionInput = firstRow.getByLabel("題目");
  const box = await questionInput.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(200); // was ~20px before the fix

  await questionInput.fill("這題應該可以正常編輯題目文字");
  await expect(questionInput).toHaveValue("這題應該可以正常編輯題目文字");
});

test("switching a question back to text discards its options and starts with a blank answer, not a converted value", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-room-0");
  await expect(room0).toBeVisible();

  const firstRow = room0.getByLabel("題目").first().locator("xpath=../..");
  await firstRow.getByLabel("題型").selectOption("multipleChoice");
  await firstRow.getByLabel("選項 1").fill("A");
  await firstRow.getByLabel("選項 2").fill("B");
  await firstRow.getByLabel("第 1 個選項為正解").check();

  await firstRow.getByLabel("題型").selectOption("text");
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(0);
  await expect(firstRow.getByLabel("答案")).toHaveValue(""); // blank, not "A" auto-converted
});

// A real, minimal 1x1 transparent PNG — the upload endpoint sniffs actual magic bytes, so a fake
// buffer would be correctly rejected. Base64 of the smallest valid PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("image authoring: switch kind, upload a real file through the Worker, save, and reload persists the key", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-room-0");
  await expect(room0).toBeVisible();

  const firstRow = room0.getByLabel("題目").first().locator("xpath=../..");
  await firstRow.getByLabel("題型").selectOption("image");
  // blankQuestion() gives a fresh image question: an upload input, no options, an empty answer.
  await expect(firstRow.getByLabel("上傳圖片")).toBeVisible();
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(0);

  // No image uploaded yet — save must be rejected, not silently accepted with an empty imageKey.
  await firstRow.getByLabel("答案").fill("松鼠");
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toContainText(/還沒上傳圖片/);

  // Upload a real file — goes through the actual /api/bank/image Worker endpoint (magic-byte
  // sniffing, owner-key auth, R2 write), not a mock.
  await firstRow.getByLabel("上傳圖片").setInputFiles({ name: "squirrel.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(firstRow.getByText(/已上傳/)).toBeVisible();

  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  // Reload and confirm it persisted as an image question with an answer — the uploaded key
  // survived the round trip through BankStore.
  await page.reload();
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const reloadedRow = page.getByTestId("bank-room-0").getByLabel("題目").first().locator("xpath=../..");
  await expect(reloadedRow.getByLabel("題型")).toHaveValue("image");
  await expect(reloadedRow.getByLabel("答案")).toHaveValue("松鼠");
  await expect(reloadedRow.getByText(/已上傳/)).toBeVisible();
});

test("image authoring: a server-rejected upload (bad file type) shows an inline error and leaves the question unsaved", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-room-0");
  await expect(room0).toBeVisible();

  const firstRow = room0.getByLabel("題目").first().locator("xpath=../..");
  await firstRow.getByLabel("題型").selectOption("image");

  // Not a real image — the server's magic-byte sniffing rejects it regardless of the declared
  // mimeType, and handleFile's catch branch must surface that as an inline error.
  const notAnImage = Buffer.from("this is not a real image file");
  await firstRow.getByLabel("上傳圖片").setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: notAnImage });

  await expect(firstRow.getByText(/Unsupported image type/i)).toBeVisible();
  await expect(firstRow.getByText(/已上傳/)).toHaveCount(0); // imageKey is still empty
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0); // this is a row-local error, not the page-level save error
});

test("two tabs editing at once: the second save is rejected as a conflict, not a silent overwrite", async ({ browser }) => {
  const openAndLoad = async (): Promise<Page> => {
    const p = await (await browser.newContext()).newPage();
    await p.goto("/bank-editor");
    await p.getByLabel("Owner key").fill(E2E_OWNER_KEY);
    await p.getByRole("button", { name: "載入題庫" }).click();
    await expect(p.getByTestId("bank-room-0")).toBeVisible();
    return p;
  };

  const tabA = await openAndLoad();
  const tabB = await openAndLoad();

  // Tab A edits and saves first — this is the edit that must NOT be lost.
  await tabA.getByTestId("bank-room-0").getByLabel("題目").first().fill("A 先存的版本");
  await tabA.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(tabA.getByTestId("bank-editor-error")).toHaveCount(0);

  // Tab B still holds the version it loaded before A's save — its save must be rejected, not
  // silently accepted (which would erase A's edit with no trace).
  await tabB.getByTestId("bank-room-0").getByLabel("題目").first().fill("B 後存的版本（應該被拒絕）");
  await tabB.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(tabB.getByTestId("bank-editor-error")).toBeVisible();
  await expect(tabB.getByTestId("bank-editor-error")).toContainText(/changed by someone else/i);

  // A's save is what actually persisted.
  const verify = await openAndLoad();
  await expect(verify.getByTestId("bank-room-0").getByLabel("題目").first()).toHaveValue("A 先存的版本");
});
