import { test, expect } from "@playwright/test";
import { answerCorrectly, startGame, nextQuestion, screenUrl } from "./answer";
import { readFile } from "node:fs/promises";

/** The host's ⚙ 更多 drawer: the narration transcript downloads as a JSON file with a real narration line. */
test("the host downloads a transcript with the narration lines", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");

  await startGame(host);
  // One judged answer, so the transcript has a narration line.
  await answerCorrectly(host);
  await expect(host.getByTestId("host-reveal")).toBeVisible();

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  // 導演筆記 and the narration edits left the drawer for the narration panel (host-narration-edit.md).
  await expect(host.getByText("導演筆記")).toHaveCount(0);

  const [download] = await Promise.all([
    host.waitForEvent("download"),
    host.getByRole("button", { name: /下載旁白紀錄/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`critical-answer-${code}-transcript.json`);

  const entries = JSON.parse(await readFile((await download.path())!, "utf8")) as { lines?: string[] }[];
  expect(entries.some((e) => Array.isArray(e.lines) && e.lines.length > 0)).toBe(true);
});

/** Reward points on the phone, progress on the host, and the host's 送王房 override (docs/designs/scoring-and-score-pools.md). */
// The bundled bank cooks its monsters, so the score reads 飽足感 (docs/designs/monster-cuisine.md).
test("the phone shows reward points and the host sends a team to the boss from the drawer", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");

  await startGame(host);
  await expect(team.getByText("0 飽足感")).toBeVisible();
  await expect(team.getByText(/\/ 15/)).toHaveCount(0);

  await answerCorrectly(host); // room 1 pays 10 reward (15 on a natural 20) and 1 progress
  await expect(team.getByText(/(^|\D)1[05] 飽足感/)).toBeVisible();
  await expect(host.getByText("1/15")).toBeVisible();

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByRole("button", { name: "送王房" }).click(); // first tap only arms it
  await host.getByRole("button", { name: "確定送？" }).click();
  await expect(host.getByRole("button", { name: /送王房|確定送/ })).toHaveCount(0);
  await expect(host.getByText(/首領血量/)).toBeVisible();
});

test("the big-screen URL at the top of the host page opens the screen in a new tab, leaving the host page in place", async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  await startGame(host);
  // The full URL with the origin, so the host can type it into a TV (the origin is "" only in the server HTML).
  // The link carries the room's screen key (docs/designs/screen-video-key.md); the text shown does not: players can see the host's phone.
  const link = host.getByTestId("screen-link");
  await expect(link).toHaveText(`${baseURL}/room/${code}/screen`);
  await expect(link).toHaveAttribute("href", new RegExp(`^/room/${code}/screen#s=[0-9a-f-]+$`));
  // The same link as a QR, for a TV that cannot type the key. Closed until asked for: it holds the key.
  await expect(host.getByTestId("screen-qr")).toHaveCount(0);
  await host.getByRole("button", { name: "顯示大螢幕 QR" }).click();
  await expect(host.getByRole("img", { name: "大螢幕 QR" })).toBeVisible();
  await host.getByRole("button", { name: "收起大螢幕 QR" }).click();
  await expect(host.getByTestId("screen-qr")).toHaveCount(0);

  const [screen] = await Promise.all([context.waitForEvent("page"), link.click()]);
  // The big screen keeps the key and takes it out of its address bar, which the whole room can see.
  await expect(screen).toHaveURL(new RegExp(`/room/${code}/screen$`));
  await expect(host).toHaveURL(/\/host/);
});

/** 下一句這樣說 (docs/designs/host-next-line.md): the host queues a line, the next narration's second segment
 * says it on the big screen, and the narration panel's 已排入 goes away once it is used. Scripted narration (no AI key). */
test("the host queues the next line, the big screen says it, and the queue empties", async ({ browser }) => {
  test.setTimeout(60_000); // three pages and two narrated answers
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(await screenUrl(host));
  await startGame(host);

  const queued = "不怕死的冒險者問珍珠能吃嗎";
  const toggle = host.getByTestId("narration-panel").getByRole("button", { name: /地城主旁白/ });
  await expect(toggle).toContainText(/\d 句・/); // the opening narration is in, so it won't close the panel on arrival (D12)
  await toggle.click();
  await host.getByPlaceholder(/不怕死的冒險者/).fill(queued);
  await host.getByRole("button", { name: "排進去" }).click();
  await expect(host.getByText(`已排入：${queued}`)).toBeVisible();
  await expect(toggle).toContainText("・已排下一句");

  await answerCorrectly(host);
  await expect(screen.locator(".px-say")).toContainText(queued, { timeout: 8000 });

  // The new narration closed the panel (D12); open it again.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(host.getByText(/下一句這樣說（下一次旁白的第二句/)).toBeVisible();
  await expect(host.getByText(/已排入：/)).toHaveCount(0);

  // 取消 empties the queue, so the next narration does not say the cancelled line.
  const cancelled = "這句被取消了不該出現";
  await host.getByPlaceholder(/不怕死的冒險者/).fill(cancelled);
  await host.getByRole("button", { name: "排進去" }).click();
  const queuedRow = host.getByText(`已排入：${cancelled}`);
  await expect(queuedRow).toBeVisible();
  await queuedRow.locator("..").getByRole("button", { name: "取消" }).click();
  await expect(host.getByText(/已排入：/)).toHaveCount(0);

  await nextQuestion(host);
  await answerCorrectly(host);
  await expect(screen.locator(".px-say")).not.toContainText(queued, { timeout: 8000 });
  await expect(screen.locator(".px-say")).not.toContainText(cancelled);
});
