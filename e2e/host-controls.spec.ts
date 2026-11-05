import { test, expect, type Browser } from "@playwright/test";
import { answerCorrectly } from "./answer";

async function hostRoom(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  return { host, code };
}

async function phone(browser: Browser, code: string, name: string) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
  await expect(page.getByTestId("roster")).toContainText(name);
  return page;
}

/** The lobby's 改名 and 移除: a removed phone says why and does not join back by itself. */
test("the host renames and removes lobby teams", async ({ browser }) => {
  const { host, code } = await hostRoom(browser);
  const keep = await phone(browser, code, "甲隊");
  const wrong = await phone(browser, code, "亂取的");

  host.once("dialog", (d) => d.accept("紅龍隊"));
  await host.locator("li, div").filter({ hasText: /^.*甲隊.*改名.*移除$/ }).last().getByRole("button", { name: "改名" }).click();
  await expect(keep.getByTestId("roster")).toContainText("紅龍隊");
  await expect(host.getByText("紅龍隊")).toBeVisible();

  await host.screenshot({ path: ".gstack/tmp/host-lobby-controls.png" });

  host.once("dialog", (d) => d.accept());
  await host.locator("li, div").filter({ hasText: /^.*亂取的.*改名.*移除$/ }).last().getByRole("button", { name: "移除" }).click();
  await expect(wrong.getByText("主持人把你們的隊伍移除了")).toBeVisible();
  await expect(host.getByText("亂取的")).toHaveCount(0);
  // Opening the page again is joining again, which is allowed (the host can remove it once more).
  await wrong.reload();
  await expect(host.getByText("亂取的")).toBeVisible();
});

/** 結束冒險: the host ends the game before the boss falls; the TV shows the podium without a final blow. */
test("the host ends the game early from the drawer", async ({ browser }) => {
  const { host, code } = await hostRoom(browser);
  await phone(browser, code, "甲隊");
  const screen = await (await browser.newContext()).newPage();
  await screen.goto(`/room/${code}/screen`);

  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await answerCorrectly(host);
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByRole("button", { name: "結束冒險" }).click(); // first tap only arms it
  await host.getByRole("button", { name: "確定結束？" }).click();

  await expect(screen.getByText("甲隊奪得榜首！")).toBeVisible();
  await expect(screen.getByTestId("final-blow")).toHaveCount(0);
});

/** 回到大廳: after the game, the same teams are back in the lobby without joining again, and a new game starts. */
test("the host takes everyone back to the lobby and starts another game", async ({ browser }) => {
  const { host, code } = await hostRoom(browser);
  const team = await phone(browser, code, "甲隊");
  const screen = await (await browser.newContext()).newPage();
  await screen.goto(`/room/${code}/screen`);

  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await answerCorrectly(host);
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByRole("button", { name: "結束冒險" }).click();
  await host.getByRole("button", { name: "確定結束？" }).click();
  await expect(screen.getByText("甲隊奪得榜首！")).toBeVisible();

  await host.screenshot({ path: ".gstack/tmp/host-back-to-lobby.png" });
  await host.getByRole("button", { name: "回到大廳，再玩一場" }).click();
  await expect(host.getByText("等待隊伍加入…")).toBeVisible();
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  await expect(screen.getByText("甲隊奪得榜首！")).toHaveCount(0);

  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("0 飽足感")).toBeVisible();
});
