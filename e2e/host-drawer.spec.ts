import { test, expect } from "@playwright/test";
import { answerCorrectly } from "./answer";
import { readFile } from "node:fs/promises";

/** The host's ⚙ 更多 drawer: director notes are saved into the room, and the narration transcript
 * downloads as a JSON file that includes both the notes and a real narration line. */
test("the host saves director notes and downloads a transcript that contains them", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");

  await host.getByRole("button", { name: /開始遊戲/ }).click();
  // One judged answer, so the transcript has a narration line as well as the notes.
  await answerCorrectly(host);
  await expect(host.getByTestId("host-reveal")).toBeVisible();

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const notes = "用武俠口吻，甲隊是一群恐龍";
  await host.getByPlaceholder(/用武俠口吻/).fill(notes);
  await host.getByRole("button", { name: "儲存導演筆記" }).click();

  const [download] = await Promise.all([
    host.waitForEvent("download"),
    host.getByRole("button", { name: /下載旁白紀錄/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`critical-answer-${code}-transcript.json`);

  const entries = JSON.parse(await readFile((await download.path())!, "utf8")) as { kind?: string; text?: string; lines?: string[] }[];
  expect(entries.some((e) => e.kind === "notes" && e.text === notes)).toBe(true);
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

  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("0 飽足感")).toBeVisible();
  await expect(team.getByText(/\/ 15/)).toHaveCount(0);

  await answerCorrectly(host); // room 1 pays 10 reward and 1 progress
  await expect(team.getByText("10 飽足感")).toBeVisible();
  await expect(host.getByText("1/15")).toBeVisible();

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByRole("button", { name: "送王房" }).click(); // first tap only arms it
  await host.getByRole("button", { name: "確定送？" }).click();
  await expect(host.getByRole("button", { name: /送王房|確定送/ })).toHaveCount(0);
  await expect(host.getByText(/首領血量/)).toBeVisible();
});

test("the big-screen URL in the host drawer opens the screen in a new tab, leaving the host page in place", async ({ browser }) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  await host.getByRole("button", { name: /開始遊戲/ }).click();

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const [screen] = await Promise.all([context.waitForEvent("page"), host.getByRole("link", { name: new RegExp(`/room/${code}/screen$`) }).click()]);
  await expect(screen).toHaveURL(new RegExp(`/room/${code}/screen$`));
  await expect(host).toHaveURL(/\/host/);
});

/** 下一句這樣說 (docs/designs/host-next-line.md): the host queues a line, the next narration's second segment
 * says it on the big screen, and the drawer's 已排入 goes away once it is used. Scripted narration (no AI key). */
test("the host queues the next line, the big screen says it, and the queue empties", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  await host.getByRole("button", { name: /開始遊戲/ }).click();

  const queued = "不怕死的冒險者問珍珠能吃嗎";
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByPlaceholder(/不怕死的冒險者/).fill(queued);
  await host.getByRole("button", { name: "排進下一句" }).click();
  await expect(host.getByText(`已排入：${queued}`)).toBeVisible();
  await host.getByRole("button", { name: "關閉" }).click();

  await answerCorrectly(host);
  await expect(screen.locator(".px-say")).toContainText(queued, { timeout: 8000 });

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await expect(host.getByText("下一句這樣說（最多 40 字）")).toBeVisible();
  await expect(host.getByText(/已排入：/)).toHaveCount(0);

  // 取消 empties the queue, so the next narration does not say the cancelled line.
  const cancelled = "這句被取消了不該出現";
  await host.getByPlaceholder(/不怕死的冒險者/).fill(cancelled);
  await host.getByRole("button", { name: "排進下一句" }).click();
  const queuedRow = host.getByText(`已排入：${cancelled}`);
  await expect(queuedRow).toBeVisible();
  await queuedRow.locator("..").getByRole("button", { name: "取消" }).click();
  await expect(host.getByText(/已排入：/)).toHaveCount(0);
  await host.getByRole("button", { name: "關閉" }).click();

  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await answerCorrectly(host);
  await expect(screen.locator(".px-say")).not.toContainText(queued, { timeout: 8000 });
  await expect(screen.locator(".px-say")).not.toContainText(cancelled);
});
