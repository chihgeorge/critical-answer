import { test, expect, type Browser } from "@playwright/test";
import { startGame } from "./answer";

const phone = async (browser: Browser, code: string, name: string) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
  return page;
};

// Value: protects=a team that arrives after the start can still play (docs/designs/late-join.md): its phone waits, the
// host's 收這隊 puts it in the game and 不收 tells it so; fails_when=the waiting phone shows the running game, the host
// page has no row for it, or the buttons do nothing; no_claim=score, turn order, the boss cut-off and restarts
// (lib/room/late-join.test.ts).
test("a team that joins after the start waits; the host lets one in and turns another away", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const first = await phone(browser, code, "甲隊");
  await expect(first.getByText("等待主持人開始遊戲")).toBeVisible();
  await startGame(host);
  await expect(first.getByText("輪到我們了！")).toBeVisible();

  const late = await phone(browser, code, "遲到隊");
  await expect(late.getByTestId("late-wait")).toContainText("等主持人讓你們加入");
  await expect(late.getByText(/輪到/)).toHaveCount(0);
  const rows = host.getByTestId("late-teams");
  await expect(rows).toContainText("遲到隊");
  await rows.getByRole("button", { name: "收這隊" }).click();
  await expect(rows).toHaveCount(0);
  await expect(late.getByTestId("late-wait")).toHaveCount(0);
  await expect(late.getByText("遲到隊")).toBeVisible();
  // Still 甲隊's turn: the new team is last.
  await expect(first.getByText("輪到我們了！")).toBeVisible();

  const refused = await phone(browser, code, "更晚隊");
  await expect(refused.getByTestId("late-wait")).toBeVisible();
  await rows.getByRole("button", { name: "不收" }).click();
  await expect(refused.getByText("主持人這場沒有收你們的隊伍")).toBeVisible();
  await expect(refused.getByRole("link", { name: "回首頁" })).toBeVisible();
});
