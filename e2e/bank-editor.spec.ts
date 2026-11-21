import { test, expect, type Page, type Locator, type Request } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";
import { QUESTIONS_PER_PAGE } from "../lib/bank-editor-pages";
import { closeLeftoverContexts } from "./answer";

closeLeftoverContexts();

/** Every question row carries `data-testid="question-{id}"` (app/bank-editor/page.tsx) — far more
 * robust than climbing from a labeled field via xpath now that a row's content/explanation
 * MediaPicker adds extra wrapper divs around the actual text input (docs/designs/
 * question-media-content.md). */
const rows = (room: Locator) => room.locator('[data-testid^="question-"]');

// The editor lists questions as one-line summaries (editor-ux #2); these tests edit fields, so they start with every
// question open (the 全部展開 setting). A test of the summary list turns it off again with a later init script.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bank-editor-open-all", "1"));
});

/** A group's whole question count, from its heading (「難度 1 題庫 · 12 題」): rows() sees only the page shown. */
async function poolCount(room: Locator): Promise<number> {
  const heading = room.getByRole("heading");
  await expect(heading).toHaveText(/· \d+ 題$/);
  return Number((await heading.textContent())!.match(/(\d+) 題$/)![1]);
}

/** Opens the group's last page (a no-op with 10 or fewer questions, which have no pager). */
async function lastPage(room: Locator, total: number) {
  const pages = Math.ceil(total / QUESTIONS_PER_PAGE);
  if (pages > 1) await room.getByRole("button", { name: `第 ${pages} 頁` }).first().click();
}

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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
}

test("homepage links to the bank editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /題庫編輯器/ }).click();
  await expect(page).toHaveURL(/\/bank-editor$/);
  await expect(page.getByLabel("站長金鑰")).toBeVisible();
});

test("回首頁 goes home at once with nothing unsaved, and asks first when there are unsaved edits", async ({ page }) => {
  const dialogs: string[] = [];
  let accept = false;
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void (accept ? d.accept() : d.dismiss());
  });
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
  await page.getByRole("link", { name: "← 回首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(dialogs).toHaveLength(0);

  await page.goto("/bank-editor"); // the remembered key auto-loads
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  await rows(room0).first().getByLabel("題目文字").fill("還沒儲存的題目");
  await page.getByRole("link", { name: "← 回首頁" }).click();
  expect(dialogs).toEqual(["還沒儲存的修改會不見，確定回首頁？"]);
  await expect(page).toHaveURL(/\/bank-editor$/);
  // 載入題庫 would replace the edits too, so it asks the same way; dismissed, the edit stays.
  await page.getByRole("button", { name: "載入題庫" }).click();
  expect(dialogs).toEqual(["還沒儲存的修改會不見，確定回首頁？", "還沒儲存的修改會不見，確定重新載入？"]);
  await expect(rows(room0).first().getByLabel("題目文字")).toHaveValue("還沒儲存的題目");
  accept = true;
  await page.getByRole("link", { name: "← 回首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
});

// Value: protects=after a save, or after a rejected key, 回首頁 goes home without asking; fails_when=save() or the 403 branch
// stops resetting saved (setSaved); why_new=only an implicit reload reached the save path, nothing reached the 403 path; seam=none;
// no_claim=beforeunload after save
test("回首頁 does not ask after a save, nor after the owner key is rejected", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  // An edit put back to the original text: a new object, so unsaved, but the saved bank is unchanged.
  const text = rows(room0).first().getByLabel("題目文字");
  const original = await text.inputValue();
  await text.fill("暫時改掉");
  await text.fill(original);
  // Regression: ISSUE-003 — a save that worked said nothing. Found by /qa on 2026-11-09.
  await expect(page.getByTestId("bank-saved")).toHaveCount(0);
  await saveAll(page);
  await expect(page.getByTestId("bank-saved")).toHaveText("✓ 已儲存");
  await text.fill("又改了"); // an unsaved edit takes the line away
  await expect(page.getByTestId("bank-saved")).toHaveCount(0);
  await text.fill(original);
  await saveAll(page);
  await page.getByRole("link", { name: "← 回首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(dialogs).toHaveLength(0);

  await page.goto("/bank-editor"); // the remembered key auto-loads
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  await page.getByLabel("站長金鑰").fill("wrong-key");
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await page.getByRole("link", { name: "← 回首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(dialogs).toHaveLength(0);
});

test("closing or reloading the tab with unsaved edits asks first", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  await rows(room0).first().getByLabel("題目文字").fill("還沒儲存的題目");
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  expect(page.isClosed()).toBe(false); // dismissed, so the edits are still there
});

test("owner key gate, load, add/edit/delete a question, save, and reload persists it", async ({ page }) => {
  await page.goto("/bank-editor");

  // Wrong key: a clear rejection, no question list.
  await page.getByLabel("站長金鑰").fill("wrong-key");
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await expect(page.getByTestId("bank-pool-1")).toHaveCount(0);

  // Correct key: the bundled bank loads (seeded into BankStore on first read).
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();
  const startingCount = await poolCount(room0);

  // Edit the first question (page 1), then add one: it is appended last and its page opens.
  // The text box wraps but keeps one line, as the old input did: a pasted line break becomes a space.
  await rows(room0).first().getByLabel("題目文字").fill("編輯過\n的題目");
  await expect(rows(room0).first().getByLabel("題目文字")).toHaveValue("編輯過 的題目");
  await rows(room0).first().getByLabel("題目文字").fill("編輯過的題目");
  await room0.getByRole("button", { name: "+ 新增題目" }).click();
  await expect(room0.getByRole("heading")).toHaveText(new RegExp(`· ${startingCount + 1} 題$`));
  await expect(rows(room0).last().getByText(`第 ${startingCount + 1} 題`)).toBeVisible();
  await rows(room0).last().getByLabel("題目文字").fill("e2e 測試題目");
  await rows(room0).last().getByLabel("答案").fill("e2e 測試答案");

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  // Reload with the key and confirm both changes persisted through BankStore, not just local state.
  await reloadAndLoad(page);
  const room0AfterSave = page.getByTestId("bank-pool-1");
  await expect(rows(room0AfterSave).first().getByLabel("題目文字")).toHaveValue("編輯過的題目");
  expect(await poolCount(room0AfterSave)).toBe(startingCount + 1);
  await lastPage(room0AfterSave, startingCount + 1);
  await expect(rows(room0AfterSave).last().getByLabel("題目文字")).toHaveValue("e2e 測試題目");

  // Delete the question just added (the last one) and save again.
  await rows(room0AfterSave).last().getByRole("button", { name: "刪除" }).click();
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await reloadAndLoad(page);
  expect(await poolCount(page.getByTestId("bank-pool-1"))).toBe(startingCount);
});

test("a late load response never overwrites edits made after a newer load", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
// Value: protects=a superseded load that fails at the network shows no 「連不到伺服器」 error;
// fails_when=the seq guard in load()'s catch is removed; why_new=the late-load test only covers a stale success;
// seam=none; no_claim=a real network drop (simulated with route.abort)
test("a superseded load that fails at the network never shows an error over a newer successful load", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-editor-error")).toContainText("連不到伺服器");
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
});

// Generated by /ship test-coverage audit.
// Value: protects=a superseded load answered 403 never wipes the bank or shows 「站長金鑰不對。」 over a newer load;
// fails_when=the seq guard right after fetch in load() is removed; why_new=the json() guard drops only a stale success;
// seam=none; no_claim=a real server-side key rotation (403 simulated with route.fulfill)
test("a superseded load answered 403 never wipes the bank shown by a newer successful load", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
test("save and load are mutually exclusive, and the questions are locked while either request is in flight", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();

  let release = () => {};
  let held = new Promise<void>((r) => (release = r));
  let holdMethod = "GET";
  await page.route("**/api/bank", async (route) => {
    if (route.request().method() === holdMethod) await held;
    await route.continue();
  });

  // Load in flight: the bank stays on screen, but it is locked, save button and fields alike, so no edit
  // can be made that the landing load would drop.
  const kind = rows(page.getByTestId("bank-pool-1")).first().getByLabel("題型");
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByRole("button", { name: "載入中…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeDisabled();
  await expect(kind).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeEnabled();
  await expect(kind).toBeEnabled();

  // Save in flight: the load button is locked.
  held = new Promise<void>((r) => (release = r));
  holdMethod = "PUT";
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByRole("button", { name: "儲存中…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeDisabled();
  await expect(kind).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
});

test("a remembered owner key (localStorage) auto-loads the bank on a fresh visit, no typing required", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  await expect(page.getByTestId("bank-pool-1")).toBeVisible(); // save() below isn't reached — this just persists the key

  // A fresh page load (simulating a returning owner) must read the key back and auto-load, per
  // useOwnerKey's onRestored callback — never typing the key again this browser.
  await page.reload();
  await expect(page.getByLabel("站長金鑰")).toHaveValue(E2E_OWNER_KEY);
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
});

test("a save with an empty fill-in answer is refused in Chinese at the save bar and the question, and does not clear the form", async ({ page, request }) => {
  await resetFirstQuestion(request); // the bundled first question is multipleChoice, with no 答案 field
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  // parseBank() rejects an empty answer; the editor now checks it first (lib/bank-editor-problems.ts), in Chinese.
  await rows(room0).first().getByLabel("答案").fill("");
  await saveAll(page);

  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await expect(page.getByTestId("bank-editor-error")).toContainText(/難度 1 第 1 題「.*」的答案是空白/);
  await expect(rows(room0).first()).toHaveAttribute("aria-invalid", "true");
  await expect(rows(room0).first().getByLabel("題目文字")).toHaveValue("重設用題目");
  // Fixed, the problem goes away without another save.
  await rows(room0).first().getByLabel("答案").fill("重設用答案");
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
});

// Value: protects=a save the Worker refuses (400) shows in Chinese with the question's place, never its id;
// fails_when=save() shows the raw response text again; seam=route.fulfill stands in for a parseBank refusal the
// editor's own check does not catch; no_claim=which refusals the real Worker sends
test("a save the server refuses names the question's place in Chinese, never its id", async ({ page, request }) => {
  await resetFirstQuestion(request);
  const firstRow = await loadEditor(page);
  const id = (await firstRow.getAttribute("data-testid"))!.replace(/^question-/, "");
  await page.route("**/api/bank", (route) =>
    route.request().method() === "PUT" ? route.fulfill({ status: 400, body: `Invalid question bank: question ${id} has an empty answer` }) : route.continue(),
  );
  await saveAll(page);
  const error = page.getByTestId("bank-editor-error");
  await expect(error).toHaveText("伺服器不接受：難度 1 第 1 題「重設用題目」的答案是空白");
  await expect(error).not.toContainText(id);
});

// Value: protects=a refused save opens the tab and page holding the problem and outlines it; fails_when=goTo or
// RoomEditor's jump page stops working; seam=none; no_claim=scroll position
test("a refused save jumps to the problem's tab and page, and 下一個 walks through every problem", async ({ page, request }) => {
  await resetFirstQuestion(request);
  await loadEditor(page);
  const pool1 = page.getByTestId("bank-pool-1");
  // A new (blank) question lands on the last page; the bundled pool has more than one page.
  const total = (await poolCount(pool1)) + 1;
  expect(total).toBeGreaterThan(QUESTIONS_PER_PAGE);
  await pool1.getByRole("button", { name: "+ 新增題目" }).click();
  await expect(pool1.getByRole("heading")).toHaveText(new RegExp(`· ${total} 題$`));
  await page.getByRole("button", { name: "第 1 頁" }).first().click();
  await rows(pool1).first().getByLabel("答案").fill("");
  await page.getByTestId("bank-tab-3").click();
  await saveAll(page);

  // Back on 難度 1, at its first problem (page 1), outlined; then 下一個 opens the last page.
  await expect(page.getByTestId("bank-tab-1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("bank-editor-error")).toContainText(/^難度 1 第 1 題/);
  await expect(rows(pool1).first()).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "下一個 ▸" }).click();
  await expect(page.getByTestId("bank-editor-error")).toContainText(`難度 1 第 ${total} 題「（空白題）」`);
  await expect(rows(pool1).last()).toHaveAttribute("aria-invalid", "true");
});

// Value: protects=unsaved edits survive a reload as a draft, restore on request and are gone after a save;
// fails_when=the draft effect, the load-time offer or the save-time clear breaks; seam=none; no_claim=a tab the OS killed
test("unsaved edits come back after a reload as a draft: 還原草稿 restores them, a save clears the draft", async ({ page, request }) => {
  await resetFirstQuestion(request);
  autoAcceptConfirms(page);
  const firstRow = await loadEditor(page);
  await firstRow.getByLabel("題目文字").fill("草稿裡的題目");
  await reloadAndLoad(page);
  await expect(page.getByTestId("bank-draft")).toBeVisible();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(rows(room0).first().getByLabel("題目文字")).toHaveValue("重設用題目");
  await page.getByRole("button", { name: "還原草稿" }).click();
  await expect(page.getByTestId("bank-draft")).toHaveCount(0);
  await expect(rows(room0).first().getByLabel("題目文字")).toHaveValue("草稿裡的題目");
  await saveAll(page);
  await expect(page.getByTestId("bank-saved")).toHaveText("✓ 已儲存");
  await reloadAndLoad(page);
  await expect(rows(page.getByTestId("bank-pool-1")).first().getByLabel("題目文字")).toHaveValue("草稿裡的題目");
  await expect(page.getByTestId("bank-draft")).toHaveCount(0);
});

test("捨棄 drops the draft for good", async ({ page, request }) => {
  await resetFirstQuestion(request);
  autoAcceptConfirms(page);
  const firstRow = await loadEditor(page);
  await firstRow.getByLabel("題目文字").fill("不要的草稿");
  await reloadAndLoad(page);
  await page.getByRole("button", { name: "捨棄" }).click();
  await expect(page.getByTestId("bank-draft")).toHaveCount(0);
  await reloadAndLoad(page);
  await expect(page.getByTestId("bank-draft")).toHaveCount(0);
  await expect(rows(page.getByTestId("bank-pool-1")).first().getByLabel("題目文字")).toHaveValue("重設用題目");
});

// Regression: an open row kept the clip times it showed before 還原草稿 (or a switch to a copied bank), not the ones it saves (/qa 2026-11-14)
test("還原草稿 shows the draft's clip times in an open row, not the loaded ones", async ({ page, request }) => {
  const WORKER = "http://localhost:1996";
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const original = (await (await request.get(`${WORKER}/api/bank`, { headers })).json()).bank.pools["1"];
  try {
    await resetFirstQuestion(request);
    autoAcceptConfirms(page);
    const firstRow = await loadEditor(page);
    await firstRow.getByRole("button", { name: "題目：YouTube" }).click();
    await firstRow.getByLabel("題目的 YouTube 網址").fill("https://youtu.be/dQw4w9WgXcQ");
    await firstRow.getByLabel("題幹").fill("草稿片段題");
    await firstRow.getByLabel("題目的開始時間").fill("0:10");
    await saveAll(page);
    await expect(page.getByTestId("bank-saved")).toHaveText("✓ 已儲存");
    await firstRow.getByLabel("題目的開始時間").fill("0:20");
    await reloadAndLoad(page);
    const reloadedRow = rows(page.getByTestId("bank-pool-1")).first();
    await expect(reloadedRow.getByLabel("題目的開始時間")).toHaveValue("0:10");
    await page.getByRole("button", { name: "還原草稿" }).click();
    await expect(reloadedRow.getByLabel("題目的開始時間")).toHaveValue("0:20");
  } finally {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
    bank.pools["1"] = original;
    await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  }
});

test("deleting every question in a room down to zero is rejected on save (a room needs at least one)", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();

  // The boss room is smaller in the bundled bank, so it takes fewer deletes to empty out.
  // parseBank() requires every room (and the boss) to have at least one question — emptying one
  // out is a real, reachable UI state, and the save must be rejected, not silently accepted.
  await page.getByTestId("bank-tab-boss").click();
  const boss = page.getByTestId("bank-room-boss");
  await expect(boss).toBeVisible();
  // rows() sees one page at a time; the next page's questions move up as these go.
  for (let remaining = await poolCount(boss); remaining > 0; remaining--) {
    await rows(boss).first().getByRole("button", { name: "刪除" }).click();
  }
  await expect(rows(boss)).toHaveCount(0);

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toBeVisible();
  await expect(page.getByTestId("bank-editor-error")).toContainText("首領第 1 階段還沒有題目");

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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  // Switch the first question in room 0 to multipleChoice — the reset above made it a text question.
  const firstRow = rows(room0).first();
  await firstRow.getByLabel("題型").selectOption("multipleChoice");
  // The fill-in answer carries over (editor-ux #6): it is option 1, marked correct, next to one empty option. Nothing
  // typed is lost, so no confirm.
  await expect(firstRow.getByLabel("答案")).toHaveCount(0);
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(2);
  await expect(firstRow.getByLabel("選項 1")).toHaveValue("重設用答案");
  await expect(firstRow.getByLabel("第 1 個選項為正解")).toBeChecked();

  await firstRow.getByLabel("選項 1").fill("台北 101");
  await firstRow.getByLabel("選項 2").fill("高雄 85 大樓");
  await firstRow.getByRole("button", { name: "+ 新增選項" }).click();
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(3);
  await firstRow.getByLabel("選項 3").fill("台中歌劇院");

  // Delete the option marked correct: the mark must not silently move to whatever now sits at index 0; it goes back
  // to "unmarked" and save is refused, not accepted with a bogus pick. The message names where the question is.
  await firstRow.getByLabel("選項 1").locator("xpath=..").getByRole("button", { name: "刪" }).click();
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(2);

  // At the MIN_OPTIONS floor, the delete button on every remaining option is disabled — a
  // multipleChoice question can never drop below 2 options via the UI.
  await expect(firstRow.getByLabel("選項 1").locator("xpath=..").getByRole("button", { name: "刪" })).toBeDisabled();
  await expect(firstRow.getByLabel("選項 2").locator("xpath=..").getByRole("button", { name: "刪" })).toBeDisabled();

  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toContainText(/^難度 1 第 1 題「.*還沒標記正解/);

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

// Value: protects=authoring a sort question: 排序 gives four empty places, a blank or repeated item blocks save, and the
// order saves and reloads; fails_when=the editor lets through a sort the server refuses, or drops or reorders items;
// seam=none; no_claim=playing it (e2e/sort-question.spec.ts)
test("sort authoring: four places in order, blank and repeated items block save, and the order persists", async ({ page, request }) => {
  await resetFirstQuestion(request);
  const firstRow = await loadEditor(page);
  await firstRow.getByLabel("題型").selectOption("sort");
  await expect(firstRow.getByLabel(/^排序第 /)).toHaveCount(4);
  await expect(firstRow.getByLabel("答案")).toHaveCount(0);
  for (const [i, item] of ["甲", "乙", "丙", "甲"].entries()) await firstRow.getByLabel(`排序第 ${i + 1} 個`).fill(item);
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toContainText(/重複的排序項目/);
  await firstRow.getByLabel("排序第 4 個").fill("");
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toContainText(/空白的排序項目/);
  await firstRow.getByLabel("排序第 4 個").fill("丁");
  await saveAll(page);
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);

  await reloadAndLoad(page);
  const reloadedRow = rows(page.getByTestId("bank-pool-1")).first();
  await expect(reloadedRow.getByLabel("題型")).toHaveValue("sort");
  for (const [i, item] of ["甲", "乙", "丙", "丁"].entries()) await expect(reloadedRow.getByLabel(`排序第 ${i + 1} 個`)).toHaveValue(item);
  await resetFirstQuestion(request); // later tests expect a text question here
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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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

// Value: protects=finding and rearranging questions in the summary list (editor-ux #2, #3); fails_when=a search hit does
// not open its question, a move lands nowhere, or 復原 does not put a deleted question back; seam=none; no_claim=saving.
test("summary list: search opens the hit, ⋯ moves a question to another pool, and a delete can be undone", async ({ page, request }) => {
  await resetFirstQuestion(request);
  await page.addInitScript(() => localStorage.setItem("bank-editor-open-all", "0"));
  const firstRow = await loadEditor(page);
  const id = (await firstRow.getAttribute("data-testid"))!.replace(/^question-/, "");

  // Closed rows are one line: the number, kind, question and answer, no fields.
  await expect(firstRow.getByRole("button", { name: /第 1 題.*重設用題目.*重設用答案/ })).toHaveAttribute("aria-expanded", "false");
  await expect(firstRow.getByLabel("題型")).toHaveCount(0);

  // A search hit opens its question.
  await page.getByLabel("搜尋題目或答案").fill("重設用答案");
  await page.getByTestId("bank-search-results").getByRole("button", { name: /難度 1 第 1 題/ }).click();
  await expect(firstRow.getByLabel("題型")).toBeVisible();
  await page.getByLabel("搜尋題目或答案").fill("");

  // Delete, then 復原: the same question is back at number 1.
  await firstRow.getByRole("button", { name: "第 1 題的更多動作" }).click();
  await firstRow.getByRole("button", { name: "刪除這題" }).click();
  await expect(page.getByTestId("bank-toast")).toContainText("已刪除難度 1 第 1 題");
  await expect(page.getByTestId(`question-${id}`)).toHaveCount(0);
  await page.getByTestId("bank-toast").getByRole("button", { name: "復原" }).click();
  const pool1 = page.getByTestId("bank-pool-1");
  await expect(rows(pool1).first()).toHaveAttribute("data-testid", `question-${id}`);
  // The bank is the saved one again, so nothing shows as unsaved.
  await expect(page.getByTestId("bank-save-bar").getByRole("status")).toHaveText("沒有修改");

  // 下移 swaps it with question 2, 上移 brings it back; both keep the id.
  const own = page.getByTestId(`question-${id}`);
  await own.getByRole("button", { name: "第 1 題的更多動作" }).click();
  await own.getByRole("button", { name: "↓ 下移" }).click();
  await expect(rows(pool1).nth(1)).toHaveAttribute("data-testid", `question-${id}`);
  await own.getByRole("button", { name: "第 2 題的更多動作" }).click();
  await own.getByRole("button", { name: "↑ 上移" }).click();
  await expect(rows(pool1).first()).toHaveAttribute("data-testid", `question-${id}`);

  // 複製 puts an open copy with a new id right after it.
  await own.getByRole("button", { name: "第 1 題的更多動作" }).click();
  await own.getByRole("button", { name: "⧉ 複製" }).click();
  await expect(page.getByTestId("bank-toast")).toContainText("已複製成第 2 題");
  const copy = rows(pool1).nth(1);
  await expect(copy).not.toHaveAttribute("data-testid", `question-${id}`);
  await expect(copy.getByLabel("題目文字")).toHaveValue("重設用題目");

  // 移到… 難度 2: it leaves pool 1 and is the last question of pool 2.
  await firstRow.getByRole("button", { name: "第 1 題的更多動作" }).click();
  await firstRow.getByRole("button", { name: "⇄ 移到…" }).click();
  await firstRow.getByRole("button", { name: /^難度 2 ·/ }).click();
  await expect(page.getByTestId("bank-toast")).toContainText("已移到難度 2");
  await expect(page.getByTestId(`question-${id}`)).toHaveCount(0);
  await page.getByTestId("bank-tab-2").click();
  const pool2 = page.getByTestId("bank-pool-2");
  await lastPage(pool2, await poolCount(pool2));
  await expect(rows(pool2).last()).toHaveAttribute("data-testid", `question-${id}`);
  // Nothing was saved: the next test starts from the stored bank.
});

test("switching a question back to text keeps the correct option as the answer, asks before dropping the others, and leaves content untouched", async ({ page }) => {
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  const originalContent = await firstRow.getByLabel("題目文字").inputValue();
  await firstRow.getByLabel("題型").selectOption("multipleChoice");
  await firstRow.getByLabel("選項 1").fill("A");
  await firstRow.getByLabel("選項 2").fill("B");
  await firstRow.getByLabel("第 1 個選項為正解").check();

  // Option B would be dropped (editor-ux #6): dismissing the confirm keeps the question as it was.
  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await firstRow.getByLabel("題型").selectOption("text");
  await expect.poll(() => asked).toEqual(["換題型會丟掉一部分答案、選項或排序項目，確定要換？"]);
  await expect(firstRow.getByLabel("題型")).toHaveValue("multipleChoice");
  await expect(firstRow.getByLabel("選項 2")).toHaveValue("B");

  page.once("dialog", (d) => void d.accept());
  await firstRow.getByLabel("題型").selectOption("text");
  await expect(firstRow.getByLabel(/^選項 /)).toHaveCount(0);
  await expect(firstRow.getByLabel("答案")).toHaveValue("A"); // the option marked correct
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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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

  // The saved upload previews through GET /api/bank/image?key= (a redirect to the public bucket, which e2e has not got:
  // the route stands in for it), and a file the bucket no longer has shows an error line, not a broken image.
  const preview = (url: URL) => url.pathname.endsWith("/api/bank/image") && url.searchParams.has("key");
  await page.route(preview, (route) => route.fulfill({ contentType: "image/png", body: TINY_PNG }));
  await reloadAndLoad(page);
  await expect(rows(page.getByTestId("bank-pool-1")).first().getByAltText("圖片預覽")).toBeVisible();
  await page.unroute(preview);
  await page.route(preview, (route) => route.fulfill({ status: 404, body: "" }));
  await reloadAndLoad(page);
  await expect(rows(page.getByTestId("bank-pool-1")).first().getByRole("alert")).toContainText("讀不到這個圖片檔");
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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();

  const firstRow = rows(room0).first();
  await firstRow.getByRole("button", { name: "題目：圖片" }).click();

  // Not a real image — the server's magic-byte sniffing rejects it regardless of the declared
  // mimeType, and MediaPicker's handleFile catch branch must surface that as an inline error.
  const notAnImage = Buffer.from("this is not a real image file");
  await firstRow.getByLabel("上傳題目圖片").setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: notAnImage });

  await expect(firstRow.getByText(/不支援這種檔案/)).toBeVisible();
  await expect(firstRow.getByText(/已上傳/)).toHaveCount(0); // the value is still empty
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0); // this is a row-local error, not the page-level save error
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeEnabled(); // a failed upload never leaves save locked
});

// Value: protects=an upload landing after a load or during a save can't write into the wrong bank or lose its image;
// lock=載入題庫, 儲存全部變更 and every field stay disabled until the upload lands.
test("an image upload in flight locks load and save until it lands", async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get("http://localhost:1996/api/bank", { headers });
  const { bank, version } = await loaded.json();
  bank.pools["1"][0] = { kind: "text", id: bank.pools["1"][0].id, content: { kind: "text", value: "重設用題目" }, answer: "重設用答案" };
  expect((await request.put("http://localhost:1996/api/bank", { headers, data: { bank, version } })).ok()).toBe(true);

  autoAcceptConfirms(page);
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();
  const room0 = page.getByTestId("bank-pool-1");
  await expect(room0).toBeVisible();
  const firstRow = rows(room0).first();
  await firstRow.getByRole("button", { name: "題目：圖片" }).click();

  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/bank/image", async (route) => {
    await held;
    await route.continue();
  });
  await firstRow.getByLabel("上傳題目圖片").setInputFiles({ name: "held.png", mimeType: "image/png", buffer: TINY_PNG });
  const locked = page.getByRole("button", { name: "上傳中…" });
  await expect(locked).toHaveCount(2);
  await expect(locked.first()).toBeDisabled();
  await expect(locked.last()).toBeDisabled();
  await expect(rows(room0).nth(1).getByLabel("題型")).toBeDisabled();

  release();
  await expect(firstRow.getByText(/已上傳/)).toBeVisible();
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "載入題庫" })).toBeEnabled();
  await expect(rows(room0).nth(1).getByLabel("題型")).toBeEnabled();
});

test("YouTube authoring: pasting a full watch URL extracts and stores just the video id", async ({ page }) => {
  autoAcceptConfirms(page);
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
  // the persisted id as a plain watch link, so the pasted &t=30s being gone is the proof the
  // extraction (not just client display) is what got saved.
  await expect(reloadedRow.getByLabel("題目的 YouTube 網址")).toHaveValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("YouTube authoring: a prompt, 只放聲音 and a 1:05–1:20 clip save as seconds and come back after a reload (youtube-questions.md D22)", async ({ page, request }) => {
  const WORKER = "http://localhost:1996";
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const original = (await (await request.get(`${WORKER}/api/bank`, { headers })).json()).bank.pools["1"];
  try {
    autoAcceptConfirms(page);
    await page.goto("/bank-editor");
    await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
    await page.getByRole("button", { name: "載入題庫" }).click();
    const firstRow = rows(page.getByTestId("bank-pool-1")).first();
    await firstRow.getByRole("button", { name: "題目：YouTube" }).click();
    await firstRow.getByLabel("題目的 YouTube 網址").fill("https://youtu.be/dQw4w9WgXcQ");
    await firstRow.getByLabel("題幹").fill("這首歌是什麼的主題曲？");
    await firstRow.getByLabel("只放聲音（聽歌題）").check();
    await firstRow.getByLabel("題目的開始時間").fill("1:05");
    await firstRow.getByLabel("題目的結束時間").fill("80");
    await expect(firstRow.getByText("片段 15 秒")).toBeVisible();
    // A time the editor cannot read says so where it was typed.
    await firstRow.getByLabel("題目的結束時間").fill("1:75");
    await expect(firstRow.getByText(/結束時間看不懂/)).toBeVisible();
    await firstRow.getByLabel("題目的結束時間").fill("1:20");

    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
    const saved = (await (await request.get(`${WORKER}/api/bank`, { headers })).json()).bank.pools["1"][0];
    expect(saved).toMatchObject({ content: { kind: "youtube", value: "dQw4w9WgXcQ", audioOnly: true, start: 65, end: 80 }, prompt: "這首歌是什麼的主題曲？" });

    await reloadAndLoad(page);
    const reloadedRow = rows(page.getByTestId("bank-pool-1")).first();
    await expect(reloadedRow.getByLabel("題幹")).toHaveValue("這首歌是什麼的主題曲？");
    await expect(reloadedRow.getByLabel("只放聲音（聽歌題）")).toBeChecked();
    await expect(reloadedRow.getByLabel("題目的開始時間")).toHaveValue("1:05");
    await expect(reloadedRow.getByLabel("題目的結束時間")).toHaveValue("1:20");

    // Back to text: a text question is its own line, so the prompt goes with the video.
    await reloadedRow.getByRole("button", { name: "題目：文字" }).click();
    await expect(reloadedRow.getByLabel("題幹")).toHaveCount(0);
  } finally {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
    bank.pools["1"] = original;
    await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  }
});

test("YouTube authoring: an unparseable paste shows an inline error and blocks save", async ({ page }) => {
  autoAcceptConfirms(page);
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
    // A new context skips beforeEach's init script: open every question here too, so 題目文字 is on the page.
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem("bank-editor-open-all", "1"));
    const p = await context.newPage();
    await p.goto("/bank-editor");
    await p.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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
  await expect(tabB.getByTestId("bank-editor-error")).toContainText("被別人存過了");

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
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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

test("the 房間 tab edits a room's difficulty and reward, and a room whose pool is empty blocks save", async ({ page, request }) => {
  // Value: protects=a room's difficulty picked in the 房間 tab is saved as that number; fails_when=the select stores a
  // string or ignores the change (server rejects or keeps 2); why_new=this test only changed rewards; seam=none;
  // no_claim=games dealing from the new pool (unit-tested in game-state.test.ts). (Generated by /ship test-coverage audit.)
  const WORKER = "http://localhost:1996";
  const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  // Put the shared worker bank back even when an assertion fails, so later specs see the original.
  const original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
  try {
    await page.goto("/bank-editor");
    await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
    await page.getByRole("button", { name: "載入題庫" }).click();
    await page.getByTestId("bank-tab-rooms").click();
    const room1 = page.getByTestId("bank-room-1");
    await room1.getByRole("spinbutton").fill("25");
    await room1.getByLabel("難度").selectOption("3");
    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
    const saved = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
    expect(saved.rooms[1].reward).toBe(25);
    expect(saved.rooms[1].difficulty).toBe(3);

    // Pool 4 holds room 6; emptying it must be refused before the save goes out.
    await page.getByTestId("bank-tab-4").click();
    const pool4 = page.getByTestId("bank-pool-4");
    while ((await rows(pool4).count()) > 0) await rows(pool4).first().getByRole("button", { name: "刪除" }).click();
    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toContainText("難度 4 題庫沒有題目");
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
    await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
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

// docs/designs/monster-catalog.md §4: a room's monster comes from the catalog; its dish comes with it, never typed.
// Value: protects=picking a room monster saves its catalog id and survives a reload, the boss picker offers only bosses, and no dish field is left; fails_when=the picker saves a name or an object, lists bosses for a room, or the dish boxes come back; why_new=replaces the dish-fields test; seam=none; no_claim=the sprites in the picker look right
test("a room's monster: picked from the catalog, saved as its id, and kept after a reload", async ({ page, request }) => {
  const WORKER = "http://localhost:1996";
  const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
  try {
    await page.goto("/bank-editor");
    await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
    await page.getByRole("button", { name: "載入題庫" }).click();
    await page.getByTestId("bank-tab-rooms").click();
    await expect(page.getByTestId("bank-rooms").getByRole("textbox")).toHaveCount(0);
    await expect(page.getByLabel("首領").locator("option")).toHaveText(["🎲 每場隨機", "深淵小黑龍", "深海大王烏賊", "不死火鳥"]);
    // The boss follows the draw until picked, and stays pickable while the rooms are drawn (#367).
    await expect(page.getByLabel("首領")).toHaveValue("");
    await page.getByLabel("首領").selectOption("kraken");
    const room0 = page.getByLabel("第 1 房的怪物");
    await expect(room0.locator("option", { hasText: "深淵小黑龍" })).toHaveCount(0);
    // The default bank draws its monsters each game, so the pickers are greyed out until the draw is off.
    const random = page.getByTestId("bank-random-monsters");
    await expect(random).toBeChecked();
    await expect(room0).toBeDisabled();
    await random.uncheck();
    await expect(room0).toBeEnabled();
    await room0.selectOption("ghost-cry");
    await expect(page.getByTestId("bank-room-0-monster")).toContainText("淚鹽烤飯糰");
    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
    const saved = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
    expect(saved.rooms[0].monster).toBe("ghost-cry");
    expect(saved.randomMonsters).toBeUndefined();
    expect(saved.boss.monster).toBe("kraken");
    expect(saved.randomBoss).toBe(false);

    await page.reload();
    await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
    await page.getByRole("button", { name: "載入題庫" }).click();
    await page.getByTestId("bank-tab-rooms").click();
    await expect(page.getByLabel("第 1 房的怪物")).toHaveValue("ghost-cry");
    await expect(page.getByLabel("首領")).toHaveValue("kraken");
  } finally {
    const { version } = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()) as { version: number };
    expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: original, version } })).ok()).toBe(true);
  }
});

// Value: protects=edits on a bank deleted elsewhere (TODOS /qa 2026-11-14 #3); fails_when=the save that hits the deleted
// bank offers no 另存成新題庫, or the new bank does not get the edits; seam=none; no_claim=drafts.
test("a bank deleted in another tab: 另存成新題庫 saves the edits into a new bank", async ({ page, request }) => {
  const WORKER = "http://localhost:1996";
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const stamp = Date.now();
  const [gone, rescued] = [`刪掉測試-${stamp}`, `另存測試-${stamp}`];
  await resetFirstQuestion(request);
  const made = await request.post(`${WORKER}/api/banks`, { headers, data: { name: gone, copyFrom: "default" } });
  expect(made.ok()).toBe(true);
  const goneId: string = (await made.json()).id;
  try {
    const firstRow = await loadEditor(page);
    await page.getByTestId("bank-editor-bank").selectOption({ label: gone });
    await expect(page.getByTestId("bank-editor-bank")).toHaveValue(goneId); // set only once that load lands
    await expect(firstRow.getByLabel("題目文字")).toHaveValue("重設用題目");
    await firstRow.getByLabel("題目文字").fill("另存後還在的題目");

    expect((await request.delete(`${WORKER}/api/banks?id=${goneId}`, { headers })).ok()).toBe(true);
    await saveAll(page);
    await expect(page.getByTestId("bank-editor-error")).toContainText("被刪掉了");

    // A taken name is refused, said under the refusal; the button stays for another try.
    page.once("dialog", (d) => void d.accept("預設題庫"));
    await page.getByTestId("bank-save-as-new").click();
    await expect(page.getByTestId("bank-editor-error-extra")).toContainText("已經有叫");
    await expect(page.getByTestId("bank-editor-error")).toContainText("被刪掉了");

    page.once("dialog", (d) => void d.accept(rescued));
    await page.getByTestId("bank-save-as-new").click();
    await expect(page.getByTestId("bank-saved")).toBeVisible();
    await expect(page.getByTestId("bank-editor-bank").locator("option:checked")).toHaveText(rescued);
    await expect(page.getByTestId("bank-editor-bank").locator("option", { hasText: gone })).toHaveCount(0); // the deleted bank left the menu
    const list: { id: string; name: string }[] = await (await request.get(`${WORKER}/api/banks`, { headers })).json();
    const entry = list.find((b) => b.name === rescued);
    expect(entry).toBeTruthy();
    const stored = await (await request.get(`${WORKER}/api/bank?id=${entry!.id}`, { headers })).json();
    expect(stored.bank.pools["1"][0].content.value).toBe("另存後還在的題目");
  } finally {
    await request.delete(`${WORKER}/api/banks?id=${goneId}`, { headers });
    const list: { id: string; name: string }[] = await (await request.get(`${WORKER}/api/banks`, { headers })).json();
    for (const b of list.filter((x) => x.name === rescued)) await request.delete(`${WORKER}/api/banks?id=${b.id}`, { headers });
  }
});

// Value: protects=no stale 還原草稿 after a 復原 that undoes the only change; fails_when=undoDelete stops forgetting the
// draft or its restoreToSaved comparison breaks; why_new=the summary test checks only the status text; seam=none; no_claim=readOnly banks.
test("delete then 復原 back to the saved bank leaves no draft to offer after a reload", async ({ page, request }) => {
  await resetFirstQuestion(request);
  const firstRow = await loadEditor(page);
  await firstRow.getByRole("button", { name: "第 1 題的更多動作" }).click();
  await firstRow.getByRole("button", { name: "刪除這題" }).click();
  await expect(page.getByTestId("bank-toast")).toContainText("已刪除難度 1 第 1 題");
  await page.getByTestId("bank-toast").getByRole("button", { name: "復原" }).click();
  await expect(page.getByTestId("bank-save-bar").getByRole("status")).toHaveText("沒有修改");
  await reloadAndLoad(page);
  await expect(page.getByTestId("bank-pool-1")).toBeVisible();
  await expect(page.getByTestId("bank-draft")).toHaveCount(0);
});

// Value: protects=a save error's blank answer box shows above the sticky save bar on a phone; fails_when=the jump stops
// scrolling to the blank box or stops leaving room for the bar; why_new=no test checks scroll position; seam=none; no_claim=exact centring.
test("on a phone, a save error on a long question scrolls its blank answer box above the save bar", async ({ page, request }) => {
  await resetFirstQuestion(request);
  await page.setViewportSize({ width: 375, height: 812 });
  const firstRow = await loadEditor(page);
  await firstRow.getByRole("button", { name: "詳解：文字" }).click();
  await firstRow.getByLabel("詳解文字").fill("這是一段很長的解說文字，用來測試編輯器在窄螢幕上的捲動。".repeat(10));
  await firstRow.getByLabel("答案").fill("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByTestId("bank-editor-error")).toContainText("的答案是空白");
  const answer = firstRow.getByLabel("答案");
  await expect(answer).toBeInViewport();
  // Polls: the jump scrolls in an effect after the error renders.
  await expect.poll(async () => {
    const box = (await answer.boundingBox())!;
    const bar = (await page.getByTestId("bank-save-bar").boundingBox())!;
    return box.y + box.height <= bar.y;
  }).toBe(true);
});

// docs/designs/boss-bank-categories.md: a buzzer phase narrowed by category and difficulty.
// Value: protects=the chip rows, the fixed shown list, ↑/↓ off under a filter, and a search jump resetting the filter;
// fails_when=a chip shows the wrong rows or count, a filtered row can still move, or a hidden search hit stays hidden;
// why_new=lib/bank-editor-categories.test.ts covers the rules, nothing drove the page; seam=none; no_claim=a 70-song bank
test("boss bank filter: category and difficulty chips narrow a buzzer phase; a search jump resets them", async ({ page, request }) => {
  const WORKER = "http://localhost:1996";
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const { bank: original, version } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
  const song = (id: string, category: string, difficulty?: number) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}`, category, ...(difficulty ? { difficulty } : {}) });
  const bank = structuredClone(original);
  bank.boss.phases = [
    bank.boss.phases[0],
    { name: "篩選關", rule: "聽前奏搶答", maxHp: 9, buzzer: true, questions: [song("f-a1", "動漫", 4), song("f-m1", "電影"), song("f-a2", "動漫", 1), song("f-m2", "電影", 1), song("f-a3", "動漫")] },
  ];
  expect((await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } })).ok()).toBe(true);
  try {
    await page.goto("/bank-editor");
    await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
    await page.getByRole("button", { name: "載入題庫" }).click();
    await page.getByTestId("bank-tab-boss").click();
    const phase = page.getByTestId("bank-room-boss-2");
    // Play order: difficulty 1 first (bank order within it), unset counts as 3.
    await expect(rows(phase)).toHaveCount(5);
    await expect(rows(phase).first()).toHaveAttribute("data-testid", "question-f-a2");
    await expect(rows(phase).last()).toHaveAttribute("data-testid", "question-f-a1");

    const categories = phase.getByTestId("bank-filter-category");
    await categories.getByRole("button", { name: /^動漫 · 3$/ }).click();
    await expect(categories.getByRole("button", { name: /動漫 · 3/ })).toHaveAttribute("aria-pressed", "true");
    await expect(rows(phase)).toHaveCount(3);
    await phase.getByTestId("bank-filter-difficulty").getByRole("button", { name: /^難度 1 · 1$/ }).click();
    await expect(rows(phase)).toHaveCount(1);
    const only = page.getByTestId("question-f-a2");
    await only.getByRole("button", { name: /的更多動作$/ }).click();
    await expect(only.getByRole("button", { name: "↑ 上移" })).toBeDisabled();
    await expect(only.getByRole("button", { name: "↓ 下移" })).toBeDisabled();

    // A search hit on a question the filter hides: both rows go back to 全部, and a line says why.
    await page.getByLabel("搜尋題目或答案").fill("答案 f-m1");
    await page.getByTestId("bank-search-results").getByRole("button", { name: /首領第 2 階段/ }).click();
    await expect(phase.getByTestId("bank-filter-note")).toContainText("已回到「全部」");
    await expect(page.getByTestId("question-f-m1")).toBeVisible();
    await expect(rows(phase)).toHaveCount(5);
  } finally {
    const { version: now } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
    await request.put(`${WORKER}/api/bank`, { headers, data: { bank: original, version: now } });
  }
});
