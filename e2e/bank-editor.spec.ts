import { test, expect, type Page, type Locator, type Request } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

/** Every question row carries `data-testid="question-{id}"` (app/bank-editor/page.tsx) — far more
 * robust than climbing from a labeled field via xpath now that a row's content/explanation
 * MediaPicker adds extra wrapper divs around the actual text input (docs/designs/
 * question-media-content.md). */
const rows = (room: Locator) => room.locator('[data-testid^="question-"]');

/** MediaPicker auto-accepts a native confirm() before discarding a non-empty slot when switching
 * media type (R1-6's decided behavior) — accept it globally so tests that switch an
 * already-populated question's media type don't hang on the dialog. */
function autoAcceptConfirms(page: Page) {
  page.on("dialog", (d) => void d.accept());
}

/** Clicks 儲存全部變更 and waits for the save to finish (the button reads 儲存中… and is disabled while
 * the PUT is in flight). Without this, a following reload or error check races the request and, on a
 * slow CI runner, can cancel it before it lands. */
async function saveAll(page: Page) {
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeEnabled();
}

/** Reloads, then loads the bank and waits for that load to land (the button reads 載入中… while it is in
 * flight). The remembered key also auto-loads on reload, so the click starts a second load; an edit made
 * before it lands is overwritten by it (CI on main, 2026-10-25: a deleted question came back). */
async function reloadAndLoad(page: Page) {
  await page.reload();
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
}

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
  await expect(page.getByTestId("bank-pool-1")).toHaveCount(0);

  // Correct key: the bundled bank loads (seeded into BankStore on first read).
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();
  const startingCount = await rows(room0).count();

  // Add a question (appended last) and edit the first one already there.
  await room0.getByRole("button", { name: "+ 新增題目" }).click();
  await rows(room0).last().getByLabel("題目文字").fill("e2e 測試題目");
  await rows(room0).last().getByLabel("答案").fill("e2e 測試答案");
  await rows(room0).first().getByLabel("題目文字").fill("編輯過的題目");
  await expect(rows(room0)).toHaveCount(startingCount + 1);

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  // Reload with the key and confirm both changes persisted through BankStore, not just local state.
  await reloadAndLoad(page);
  const room0AfterSave = page.getByTestId("bank-pool-1");
  await expect(rows(room0AfterSave).first().getByLabel("題目文字")).toHaveValue("編輯過的題目");
  await expect(rows(room0AfterSave).last().getByLabel("題目文字")).toHaveValue("e2e 測試題目");
  await expect(rows(room0AfterSave)).toHaveCount(startingCount + 1);

  // Delete the question just added (the last one) and save again.
  await rows(room0AfterSave).last().getByRole("button", { name: "刪除" }).click();
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await reloadAndLoad(page);
  await expect(rows(page.getByTestId("bank-pool-1"))).toHaveCount(startingCount);
});

test("a late load response never overwrites edits made after a newer load", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  // Hold the first load after the reload until the manual load and the edit are done. `next dev` runs
  // the auto-load effect twice (StrictMode), so the second auto-load lets the 載入題庫 button come back.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let heldRequest: Request | undefined;
  await page.route("**/api/bank", async (route) => {
    if (route.request().method() === "GET" && !heldRequest) {
      heldRequest = route.request();
      await held;
    }
    await route.continue();
  });
  await reloadAndLoad(page);
  const firstText = rows(page.getByTestId("bank-pool-1")).first().getByLabel("題目文字");
  await firstText.fill("載入後的編輯");

  const late = page.waitForResponse((r) => r.request() === heldRequest);
  release();
  await (await late).finished();
  await page.waitForTimeout(300); // let the late response's json() and render run; a fix regression shows up here
  await expect(firstText).toHaveValue("載入後的編輯");
});

// Generated by /ship test-coverage audit.
// Value: protects=a superseded load that fails at the network shows no "Could not reach the server." error;
// fails_when=the seq guard in load()'s catch is removed; why_new=the late-load test only covers a stale success;
// seam=none; no_claim=a real network drop (simulated with route.abort)
test("a superseded load that fails at the network never shows an error over a newer successful load", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  let fail = () => {};
  const held = new Promise<void>((r) => (fail = r));
  let heldOnce = false;
  await page.route("**/api/bank", async (route) => {
    if (route.request().method() === "GET" && !heldOnce) {
      heldOnce = true;
      await held;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await reloadAndLoad(page);
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  const failed = page.waitForEvent("requestfailed", (r) => r.url().endsWith("/api/bank") && r.method() === "GET");
  fail();
  await failed;
  await page.waitForTimeout(300); // let the stale catch run; a guard regression shows the error here
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
});

test("the current load failing at the network still shows the error", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.route("**/api/bank", (route) => (route.request().method() === "GET" ? route.abort() : route.continue()));
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-editor-error")).toContainText("Could not reach the server.");
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
});

// Generated by /ship test-coverage audit.
// Value: protects=a superseded load answered 403 never wipes the bank or shows "Owner key rejected." over a newer load;
// fails_when=the seq guard right after fetch in load() is removed; why_new=the json() guard drops only a stale success;
// seam=none; no_claim=a real server-side key rotation (403 simulated with route.fulfill)
test("a superseded load answered 403 never wipes the bank shown by a newer successful load", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  let reject = () => {};
  const held = new Promise<void>((r) => (reject = r));
  let heldOnce = false;
  await page.route("**/api/bank", async (route) => {
    if (route.request().method() === "GET" && !heldOnce) {
      heldOnce = true;
      await held;
      await route.fulfill({ status: 403, body: "forbidden" });
      return;
    }
    await route.continue();
  });
  await reloadAndLoad(page);
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  const rejected = page.waitForResponse((r) => r.status() === 403);
  reject();
  await (await rejected).finished();
  await page.waitForTimeout(300); // let the stale 403 branch run; a guard regression wipes the bank here
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
});

// Generated by /ship test-coverage audit.
// Value: protects=載入題庫 stays 載入中… (disabled) until the newest load lands, even when an older load finishes first;
// fails_when=the seq guard in load()'s finally is removed; why_new=no test holds the newest load while an older one ends;
// seam=none; no_claim=production builds (relies on next dev StrictMode issuing two auto-load GETs on reload)
test("an older load finishing never clears the loading state while the newest load is still in flight", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  // On reload StrictMode runs the auto-load twice: let the first (older) GET through, hold the second (newest).
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const gets: Request[] = [];
  await page.route("**/api/bank", async (route) => {
    if (route.request().method() === "GET") {
      gets.push(route.request());
      if (gets.length === 2) await held;
    }
    await route.continue();
  });
  await page.reload();
  await expect.poll(() => gets.length).toBe(2);
  await (await gets[0].response())?.finished();
  await page.waitForTimeout(300); // let the older load's finally run; a guard regression re-enables the button here
  await expect(page.getByRole("button", { name: "載入中…" })).toBeDisabled();

  release();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
});

// Generated by /ship test-coverage audit.
// Value: protects=儲存 is disabled while a load is in flight and 載入題庫 while a save is in flight;
// fails_when=`|| loading` or `|| saving` is dropped from either button's disabled; why_new=no test holds a request
// to observe the in-flight button state; seam=none; no_claim=keyboard or programmatic submits bypassing the button
test("save and load are mutually exclusive: each button is disabled while the other request is in flight", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  let release = () => {};
  let held = new Promise<void>((r) => (release = r));
  let holdMethod = "GET";
  await page.route("**/api/bank", async (route) => {
    if (route.request().method() === holdMethod) await held;
    await route.continue();
  });

  // Load in flight: the bank stays on screen, but its save button is locked.
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByRole("button", { name: "載入中…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeEnabled();

  // Save in flight: the load button is locked.
  held = new Promise<void>((r) => (release = r));
  holdMethod = "PUT";
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByRole("button", { name: "儲存中…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
});

test("a remembered owner key (localStorage) auto-loads the bank on a fresh visit, no typing required", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible(); // save() below isn't reached — this just persists the key

  // A fresh page load (simulating a returning owner) must read the key back and auto-load, per
  // useOwnerKey's onRestored callback — never typing the key again this browser.
  await page.reload();
  await expect(page.getByLabel("Owner key")).toHaveValue(E2E_OWNER_KEY);
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
});

test("a save that fails server-side validation shows the server's error, and does not clear the form", async ({ page, request }) => {
  await resetFirstQuestion(request); // the bundled first question is multipleChoice, with no 答案 field
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  // parseBank() rejects an empty answer — a real state reachable by clearing the field, not a
  // client-side-only validation the form itself would block.
  await rows(room0).first().getByLabel("答案").fill("");
  await saveAll(page);

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
  await page.getByTestId("bank-tab-boss").click();
  const boss = page.getByTestId("bank-room-boss");
  await expect(boss).toBeVisible();
  let remaining = await rows(boss).count();
  while (remaining > 0) {
    await rows(boss).first().getByRole("button", { name: "刪除" }).click();
    remaining--;
  }
  await expect(rows(boss)).toHaveCount(0);

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await expect(page.getByTestId("bank-editor-error")).toContainText(/no questions/i);

  // Nothing was actually persisted — a fresh load still has the original boss question(s).
  await reloadAndLoad(page);
  await page.getByTestId("bank-tab-boss").click();
  const bossAfterReload = page.getByTestId("bank-room-boss");
  await expect(bossAfterReload).toBeVisible();
  await expect(rows(bossAfterReload)).not.toHaveCount(0);
});

test("multipleChoice authoring: switch kind, edit options, mark correct, and deleting the marked-correct option blocks save until re-marked", async ({ page, request }) => {
  await resetFirstQuestion(request); // the bundled first question is already multipleChoice
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  // Switch the first question in room 0 to multipleChoice — the reset above made it a text question.
  const firstRow = rows(room0).first();
  await firstRow.getByLabel("題型").selectOption("multipleChoice");
  // blankQuestion() gives a fresh multipleChoice question: 2 empty options, no answer field.
  // Content carries over from the previous kind (blankQuestion keeps `content`), so no confirm.
  await expect(firstRow.getByLabel("答案")).toHaveCount(0);
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(2);

  await firstRow.getByLabel("選項 1").fill("台北 101");
  await firstRow.getByLabel("選項 2").fill("高雄 85 大樓");
  await firstRow.getByRole("button", { name: "+ 新增選項" }).click();
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(3);
  await firstRow.getByLabel("選項 3").fill("台中歌劇院");

  // Nothing marked correct yet — save must be rejected, not silently accepted with a bogus pick.
  await saveAll(page);
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

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toContainText(/還沒標記正解/);

  // Mark the (now first) remaining option correct and save — this time it goes through.
  await firstRow.getByLabel("第 1 個選項為正解").check();
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  // Reload and confirm it persisted as multipleChoice with the mark intact, not reverted to text.
  await reloadAndLoad(page);
  const reloadedRow = rows(page.getByTestId("bank-pool-1")).first();
  await expect(reloadedRow.getByLabel("題型")).toHaveValue("multipleChoice");
  await expect(reloadedRow.getByLabel("第 1 個選項為正解")).toBeChecked();
});

test("multipleChoice question-text field stays wide and editable, not squeezed by the 題型 select (2026-09-23 regression)", async ({ page }) => {
  // The 題型 <select> reuses the .px-input class, which sets width:100% as unlayered CSS — that
  // beats any Tailwind width utility (Tailwind's utilities live inside a cascade layer, and
  // unlayered rules always win). Without an explicit inline-style override on the select, its
  // flex-basis resolves to the full row width and the sibling content picker gets squeezed to
  // ~20px: technically present and fillable, but invisible to a real user. A plain .fill() +
  // .toHaveValue check wouldn't catch this — it doesn't require real screen space — so this
  // asserts the actual rendered width instead.
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  await firstRow.getByLabel("題型").selectOption("multipleChoice");

  const questionInput = firstRow.getByLabel("題目文字");
  const box = await questionInput.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(200); // was ~20px before the fix

  await questionInput.fill("這題應該可以正常編輯題目文字");
  await expect(questionInput).toHaveValue("這題應該可以正常編輯題目文字");
});

test("switching a question back to text discards its options, and content carries over unchanged (blankQuestion never touches it)", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  const originalContent = await firstRow.getByLabel("題目文字").inputValue();
  await firstRow.getByLabel("題型").selectOption("multipleChoice");
  await firstRow.getByLabel("選項 1").fill("A");
  await firstRow.getByLabel("選項 2").fill("B");
  await firstRow.getByLabel("第 1 個選項為正解").check();

  await firstRow.getByLabel("題型").selectOption("text");
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(0);
  await expect(firstRow.getByLabel("答案")).toHaveValue(""); // blank, not "A" auto-converted
  await expect(firstRow.getByLabel("題目文字")).toHaveValue(originalContent); // content is untouched by an outer-kind switch
});

// A real, minimal 1x1 transparent PNG — the upload endpoint sniffs actual magic bytes, so a fake
// buffer would be correctly rejected. Base64 of the smallest valid PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("image authoring: switch the content's media type to image, upload a real file through the Worker, save, and reload persists the key", async ({ page }) => {
  autoAcceptConfirms(page); // the row's existing text content is non-empty — switching discards it after confirm
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  // "image" is no longer an outer 題型 — it's a media-type tab within the content MediaPicker
  // (docs/designs/question-media-content.md's D1: content replaces the old fixed text prompt).
  await firstRow.getByRole("button", { name: "題目：圖片" }).click();
  await expect(firstRow.getByLabel("上傳題目圖片")).toBeVisible();

  // No image uploaded yet — save must be rejected, not silently accepted with an empty value.
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toContainText(/還沒上傳圖片/);

  // Upload a real file — goes through the actual /api/bank/image Worker endpoint (magic-byte
  // sniffing, owner-key auth, R2 write), not a mock.
  await firstRow.getByLabel("上傳題目圖片").setInputFiles({ name: "squirrel.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(firstRow.getByText(/已上傳/)).toBeVisible();

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  // Reload and confirm it persisted as image content — the uploaded key survived the round trip
  // through BankStore.
  await reloadAndLoad(page);
  const reloadedRow = rows(page.getByTestId("bank-pool-1")).first();
  await expect(reloadedRow.getByRole("button", { name: "題目：圖片" })).toHaveAttribute("aria-pressed", "true");
  await expect(reloadedRow.getByText(/已上傳/)).toBeVisible();
});

test("image authoring: a server-rejected upload (bad file type) shows an inline error and leaves the question unsaved", async ({ page, request }) => {
  // Reset room 0's first question to known text-content state first — an earlier test in this
  // file ("image authoring: switch the content's media type to image...") may have left it
  // already on the image tab with a real uploaded key, and switchTo(kind) is now a no-op when
  // the clicked tab is already active (re-clicking regression fix, /ship), so this test can no
  // longer rely on that click alone to guarantee a fresh, empty image slot.
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get("http://localhost:1996/api/bank", { headers });
  const { bank, version } = await loaded.json();
  bank.pools["1"][0] = { kind: "text", id: bank.pools["1"][0].id, content: { kind: "text", value: "重設用題目" }, answer: "重設用答案" };
  const reset = await request.put("http://localhost:1996/api/bank", { headers, data: { bank, version } });
  expect(reset.ok()).toBe(true);

  autoAcceptConfirms(page);
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  await firstRow.getByRole("button", { name: "題目：圖片" }).click();

  // Not a real image — the server's magic-byte sniffing rejects it regardless of the declared
  // mimeType, and MediaPicker's handleFile catch branch must surface that as an inline error.
  const notAnImage = Buffer.from("this is not a real image file");
  await firstRow.getByLabel("上傳題目圖片").setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: notAnImage });

  await expect(firstRow.getByText(/Unsupported image type/i)).toBeVisible();
  await expect(firstRow.getByText(/已上傳/)).toHaveCount(0); // the value is still empty
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0); // this is a row-local error, not the page-level save error
});

test("YouTube authoring: pasting a full watch URL extracts and stores just the video id", async ({ page }) => {
  autoAcceptConfirms(page);
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  await firstRow.getByRole("button", { name: "題目：YouTube" }).click();
  await firstRow.getByLabel("題目的 YouTube 網址").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s");
  await expect(firstRow.getByLabel("題目的 YouTube 網址")).toHaveValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s");

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await reloadAndLoad(page);
  const reloadedRow = rows(page.getByTestId("bank-pool-1")).first();
  await expect(reloadedRow.getByRole("button", { name: "題目：YouTube" })).toHaveAttribute("aria-pressed", "true");
  // What's actually stored is the extracted id, not the raw pasted URL — the field re-displays
  // whatever the server persisted, so a full watch URL round-tripping down to a bare id is the
  // proof the extraction (not just client display) is what got saved.
  await expect(reloadedRow.getByLabel("題目的 YouTube 網址")).toHaveValue("dQw4w9WgXcQ");
});

test("YouTube authoring: an unparseable paste shows an inline error and blocks save", async ({ page }) => {
  autoAcceptConfirms(page);
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  await firstRow.getByRole("button", { name: "題目：YouTube" }).click();
  await firstRow.getByLabel("題目的 YouTube 網址").fill("this is not a youtube url");
  await expect(firstRow.getByText("看不出這是 YouTube 網址")).toBeVisible();

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toContainText(/還沒填完/);
});

test("explanation: optional, independently text/image/YouTube from the content, and can be cleared back to 無", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  await expect(firstRow.getByRole("button", { name: "詳解：無" })).toHaveAttribute("aria-pressed", "true"); // starts unset

  await firstRow.getByRole("button", { name: "詳解：文字" }).click();
  await firstRow.getByLabel("詳解文字").fill("這是補充說明");

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await reloadAndLoad(page);
  const reloadedRow = rows(page.getByTestId("bank-pool-1")).first();
  await expect(reloadedRow.getByLabel("詳解文字")).toHaveValue("這是補充說明");

  // Clear it back to 無 — no confirm expected here since MediaPicker's own text field is
  // non-empty ("這是補充說明"), so a real dialog fires; accept it inline for this one action.
  page.once("dialog", (d) => void d.accept());
  await reloadedRow.getByRole("button", { name: "詳解：無" }).click();
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await reloadAndLoad(page);
  const finalRow = rows(page.getByTestId("bank-pool-1")).first();
  await expect(finalRow.getByRole("button", { name: "詳解：無" })).toHaveAttribute("aria-pressed", "true");
});

test("re-clicking a media tab that's already active is a no-op, not a discard (regression, test-coverage audit)", async ({ page, request }) => {
  // Reset room 0's first question to known text-content state — an earlier test in this file
  // may have left it on a different content kind, and this test needs a real, non-empty text
  // value to prove clicking its own already-active tab leaves it untouched.
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get("http://localhost:1996/api/bank", { headers });
  const { bank, version } = await loaded.json();
  bank.pools["1"][0] = { kind: "text", id: bank.pools["1"][0].id, content: { kind: "text", value: "重設用題目" }, answer: "重設用答案" };
  const reset = await request.put("http://localhost:1996/api/bank", { headers, data: { bank, version } });
  expect(reset.ok()).toBe(true);

  // Every MediaPicker tab button calls switchTo(kind) unconditionally on click, including its
  // own already-active tab — without the switchTo(kind === current.kind) guard, a redundant
  // click on a non-empty text slot popped the "discard content?" confirm() and wiped it to ""
  // on accept, even though nothing about the media type actually changed.
  autoAcceptConfirms(page); // if the guard regresses, this would silently accept the confirm and hide the bug — the value assertion below is what actually catches it
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  const originalText = await firstRow.getByLabel("題目文字").inputValue();
  expect(originalText.trim()).not.toBe(""); // the bundled bank's first question always has real text

  await firstRow.getByRole("button", { name: "題目：文字" }).click(); // already the active tab
  await expect(firstRow.getByLabel("題目文字")).toHaveValue(originalText); // untouched, not wiped
});

test("two tabs editing at once: the second save is rejected as a conflict, not a silent overwrite", async ({ browser, request }) => {
  // Earlier tests in this file leave room 0's first question in whatever media/outer kind they
  // last saved (a real consequence of D1 — content can leave "text" entirely, so a later test
  // can't assume a 題目文字 input exists at all). Reset it to a known text-content, text-kind
  // state directly through the API before this test, rather than depending on file order.
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get("http://localhost:1996/api/bank", { headers });
  const { bank, version } = await loaded.json();
  bank.pools["1"][0] = { kind: "text", id: bank.pools["1"][0].id, content: { kind: "text", value: "重設用題目" }, answer: "重設用答案" };
  const reset = await request.put("http://localhost:1996/api/bank", { headers, data: { bank, version } });
  expect(reset.ok()).toBe(true);

  const openAndLoad = async (): Promise<Page> => {
    const p = await (await browser.newContext()).newPage();
    await p.goto("/bank-editor");
    await p.getByLabel("Owner key").fill(E2E_OWNER_KEY);
    await p.getByRole("button", { name: "載入題庫" }).click();
    await expect(p.getByTestId("bank-pool-1")).toBeVisible();
    return p;
  };

  const tabA = await openAndLoad();
  const tabB = await openAndLoad();

  // Tab A edits and saves first — this is the edit that must NOT be lost.
  await rows(tabA.getByTestId("bank-pool-1")).first().getByLabel("題目文字").fill("A 先存的版本");
  await saveAll(tabA);
  await expect(tabA.getByTestId("bank-editor-error")).toHaveCount(0);

  // Tab B still holds the version it loaded before A's save — its save must be rejected, not
  // silently accepted (which would erase A's edit with no trace).
  await rows(tabB.getByTestId("bank-pool-1")).first().getByLabel("題目文字").fill("B 後存的版本（應該被拒絕）");
  await saveAll(tabB);
  await expect(tabB.getByTestId("bank-editor-error")).toBeVisible();
  await expect(tabB.getByTestId("bank-editor-error")).toContainText(/changed by someone else/i);

  // A's save is what actually persisted.
  const verify = await openAndLoad();
  await expect(rows(verify.getByTestId("bank-pool-1")).first().getByLabel("題目文字")).toHaveValue("A 先存的版本");
});

/** Resets room 0's first question to a known text-content state via the API, so a test doesn't
 * depend on whatever media kind an earlier test in this file left it on. */
async function resetFirstQuestion(request: import("@playwright/test").APIRequestContext) {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get("http://localhost:1996/api/bank", { headers });
  const { bank, version } = await loaded.json();
  bank.pools["1"][0] = { kind: "text", id: bank.pools["1"][0].id, content: { kind: "text", value: "重設用題目" }, answer: "重設用答案" };
  const reset = await request.put("http://localhost:1996/api/bank", { headers, data: { bank, version } });
  expect(reset.ok()).toBe(true);
}

async function loadEditor(page: Page) {
  await page.goto("/bank-editor");
  await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();
  return rows(room0).first();
}

test("dismissing the discard confirm() keeps the slot's media type and content untouched", async ({ page, request }) => {
  await resetFirstQuestion(request);
  const firstRow = await loadEditor(page);

  page.once("dialog", (d) => void d.dismiss());
  await firstRow.getByRole("button", { name: "題目：YouTube" }).click();

  await expect(firstRow.getByRole("button", { name: "題目：文字" })).toHaveAttribute("aria-pressed", "true");
  await expect(firstRow.getByLabel("題目文字")).toHaveValue("重設用題目");
});

test("an explanation tab picked but left empty blocks save with an explanation-specific error", async ({ page, request }) => {
  await resetFirstQuestion(request);
  const firstRow = await loadEditor(page);

  await firstRow.getByRole("button", { name: "詳解：YouTube" }).click();
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toContainText(/的詳解還沒填完（還沒貼網址）/);
});

test("switching the outer 題型 carries the explanation over, never silently dropping it", async ({ page, request }) => {
  await resetFirstQuestion(request);
  const firstRow = await loadEditor(page);

  await firstRow.getByRole("button", { name: "詳解：文字" }).click();
  await firstRow.getByLabel("詳解文字").fill("要保留的詳解");
  await firstRow.getByLabel("題型").selectOption("multipleChoice");
  await expect(firstRow.getByLabel("詳解文字")).toHaveValue("要保留的詳解");
  await firstRow.getByLabel("題型").selectOption("text");
  await expect(firstRow.getByLabel("詳解文字")).toHaveValue("要保留的詳解");
});

test("two image slots in the same room: the second row's 選擇圖片 uploads into the second row, not the first (fieldId regression)", async ({ page, request }) => {
  await resetFirstQuestion(request);
  autoAcceptConfirms(page);
  const firstRow = await loadEditor(page);
  const secondRow = rows(page.getByTestId("bank-pool-1")).nth(1);

  await firstRow.getByRole("button", { name: "題目：圖片" }).click();
  await secondRow.getByRole("button", { name: "題目：圖片" }).click();

  // Click the visible label (not the sr-only input) — that's the path that resolved to the first
  // row's <input> when both rows shared one id.
  const chooser = page.waitForEvent("filechooser");
  await secondRow.getByText("選擇圖片").click();
  await (await chooser).setFiles({ name: "second.png", mimeType: "image/png", buffer: TINY_PNG });

  await expect(secondRow.getByText(/已上傳/)).toBeVisible();
  await expect(firstRow.getByText(/已上傳/)).toHaveCount(0);
});

test("the 房間 tab edits a room's difficulty and reward and the boss hit reward, and a room whose pool is empty blocks save", async ({ page, request }) => {
  // Value: protects=a room's difficulty picked in the 房間 tab is saved as that number; fails_when=the select stores a
  // string or ignores the change (server rejects or keeps 2); why_new=this test only changed rewards; seam=none;
  // no_claim=games dealing from the new pool (unit-tested in game-state.test.ts). (Generated by /ship test-coverage audit.)
  const WORKER = "http://localhost:1996";
  const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  // Put the shared worker bank back even when an assertion fails, so later specs see the original.
  const original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
  try {
    await page.goto("/bank-editor");
    await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
    await page.getByRole("button", { name: "載入題庫" }).click();
    await page.getByTestId("bank-tab-rooms").click();
    const room1 = page.getByTestId("bank-room-1");
    await room1.getByRole("spinbutton").fill("25");
    await room1.getByRole("combobox").selectOption("3");
    await page.getByTestId("bank-boss-hit-reward").fill("12");
    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
    const saved = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
    expect(saved.rooms[1].reward).toBe(25);
    expect(saved.rooms[1].difficulty).toBe(3);
    expect(saved.boss.hitReward).toBe(12);

    // Pool 5 holds rooms 7 and 8; emptying it must be refused before the save goes out.
    await page.getByTestId("bank-tab-5").click();
    const pool5 = page.getByTestId("bank-pool-5");
    while ((await rows(pool5).count()) > 0) await rows(pool5).first().getByRole("button", { name: "刪除" }).click();
    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toContainText("難度 5 題庫沒有題目");
  } finally {
    const { version } = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()) as { version: number };
    expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: original, version } })).ok()).toBe(true);
  }
});

// Review finding (testing, 2026-10-28): the boss phase editor (docs/designs/boss-phases.md D5, D6, D11) had no test.
// Value: protects=adding, validating, saving and deleting a boss phase in the editor; fails_when=phase 2's empty
// name saves, a saved phase is lost, or one tap deletes a phase full of questions; why_new=bank-editor specs only
// touched phase 1; seam=none; no_claim=playing the phase (e2e/boss-phases.spec.ts)
test("boss phases: add one, an empty name is refused, a filled one saves, and deleting it asks first", async ({ page, request }) => {
  const WORKER = "http://localhost:1996";
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const { bank: original } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
  try {
    await page.goto("/bank-editor");
    await page.getByLabel("Owner key").fill(E2E_OWNER_KEY);
    await page.getByRole("button", { name: "載入題庫" }).click();
    await page.getByTestId("bank-tab-boss").click();
    await page.getByTestId("bank-add-phase").click();
    const phase2 = page.getByTestId("bank-boss-phase-2");
    await expect(phase2).toBeVisible();
    const questions2 = page.getByTestId("bank-room-boss-2");
    await questions2.getByRole("button", { name: "+ 新增題目" }).click();
    await rows(questions2).last().getByLabel("題目文字").fill("e2e 第二階段題目");
    await rows(questions2).last().getByLabel("答案").fill("e2e 第二階段答案");

    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toHaveText("首領第 2 階段：名稱不能空白");

    await phase2.getByLabel("名稱").fill("主題曲之謎");
    await phase2.getByLabel("規則").fill("聽前奏，說出作品名");
    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
    const { bank: saved } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
    expect(saved.boss.phases.map((p: { name: string; rule: string }) => [p.name, p.rule]).at(-1)).toEqual(["主題曲之謎", "聽前奏，說出作品名"]);

    // Dismissing the confirm keeps the phase and its question.
    page.once("dialog", (d) => void d.dismiss());
    await phase2.getByRole("button", { name: "刪除階段" }).click();
    await expect(phase2).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await phase2.getByRole("button", { name: "刪除階段" }).click();
    await expect(page.getByTestId("bank-boss-phase-2")).toHaveCount(0);
  } finally {
    const { version } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
    await request.put(`${WORKER}/api/bank`, { headers, data: { bank: original, version } });
  }
});
