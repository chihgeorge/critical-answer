import { test, expect, type Browser } from "@playwright/test";
import { screenUrl } from "./answer";

// 擲先攻 (lib/initiative.ts): each phone rolls its d20 and the big screen shows every die. The e2e worker fixes every
// d20 at 10 (playwright.config.ts E2E_DIE), so the teams tie and keep the lobby order; the order holds only
// INITIATIVE_HOLD_MS. Ties, timeouts and offline teams are covered by lib/room/initiative.test.ts.

async function hostRoom(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  return { host, code: host.url().match(/\/room\/([A-Z]{4})\//)![1] };
}

async function phone(browser: Browser, code: string, name: string) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
  await expect(page.getByTestId("roster")).toContainText(name);
  return page;
}

// Value: protects=the phones' 擲骰 reaches the room and the big screen, and the game starts once every phone has rolled;
// fails_when=the phone button, TEAM_ROLL_INITIATIVE, the screen overlay or the hand-off to the first question breaks;
// why_new=擲先攻 is a new opening step; seam=E2E_DIE; no_claim=which team goes first (the fixed die ties every team)
test("every phone rolls 擲先攻, the big screen shows the dice, then the first team plays", async ({ browser }) => {
  const { host, code } = await hostRoom(browser);
  const a = await phone(browser, code, "甲隊");
  const b = await phone(browser, code, "乙隊");
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(await screenUrl(host));

  await host.getByRole("checkbox", { name: "開始前播放玩法說明" }).uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();

  await expect(screen.getByTestId("initiative-result")).toHaveText("還有 2 隊沒擲");
  await expect(host.getByTestId("host-initiative")).toContainText("已擲 0／2 隊");
  await a.getByRole("button", { name: "🎲 擲骰" }).click();
  await expect(a.getByTestId("phone-initiative")).toContainText("你們擲出 10");
  await expect(screen.getByTestId("initiative-result")).toHaveText("還有 1 隊沒擲");
  await expect(b.getByRole("button", { name: "🎲 擲骰" })).toBeVisible();

  await b.getByRole("button", { name: "🎲 擲骰" }).click();
  await expect(a.getByText("輪到我們了！")).toBeVisible();
  await expect(b.getByText("輪到：甲隊")).toBeVisible();
  await expect(screen.getByTestId("initiative")).toHaveCount(0);
});
