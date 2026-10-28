import { test, expect } from "@playwright/test";
import { textOnlyBank } from "./answer";

// Judged by hand with 答對！, which a multipleChoice turn doesn't take.
textOnlyBank();

/** The host queues a team's next question from the bank (TODOS.md 主持人可以指定每一題要出題庫裡的哪一題):
 * the pick waits on the team's row, and the team's next correct answer brings it up. */
test("the host picks a team's next question and it comes up after the team's correct answer", async ({ browser }) => {
  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  await host.getByRole("button", { name: "指定下一題" }).click();
  await expect(host.getByText("替甲隊指定下一題")).toBeVisible();
  // The last question in the list: never the one 甲隊 holds now (the deal takes the pool's first free one).
  const choice = host.getByRole("button").filter({ hasText: "答案：" }).and(host.locator(":enabled")).last();
  const label = (await choice.locator("span > span").first().textContent())!;
  await choice.click();
  await expect(host.getByTestId("queued-pick")).toHaveText(`下一題：${label}`);

  await host.getByRole("button", { name: "答對！" }).click();
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(host.getByText(label, { exact: true })).toBeVisible();
  await expect(host.getByTestId("queued-pick")).toHaveCount(0);
});
