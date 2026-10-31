import { test, expect, type Browser } from "@playwright/test";
import { textOnlyBank } from "./answer";

async function mageRoom(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("法師隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await expect(team.getByText("選擇題刪 2 個錯的選項；填空題看答案第一個字")).toBeVisible();
  await team.getByRole("button", { name: /法師/ }).click();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  return { host, screen, team };
}

test.describe("a fill-in answer with a first character", () => {
  // Every answer is known, so the hint is too (#106).
  textOnlyBank("〈萬家福〉");

  // Value: protects=a mage on a fill-in question shows the answer's first character on the phone, the host
  // page and the TV, and spends one use (AC1); fails_when=the button is missing on fill-in, or a screen
  // lacks the hint; no_claim=hint_shown refusals (unit tests).
  test("mage: a fill-in cast shows the first character on the phone, the host page and the TV", async ({ browser }) => {
    const { host, screen, team } = await mageRoom(browser);
    await team.getByRole("button", { name: /看答案第一個字/ }).click();
    await expect(team.getByTestId("mage-hint")).toHaveText("🔮 第一個字：萬");
    await expect(host.getByTestId("host-mage-hint")).toHaveText("🔮 第一個字：萬");
    await expect(screen.getByTestId("screen-mage-hint")).toHaveText("🔮 第一個字：萬");
    await expect(team.getByText("法師・剩 1 次")).toBeVisible();
    // One hint per question: the button is gone.
    await expect(team.getByRole("button", { name: /看答案第一個字/ })).toHaveCount(0);
  });
});

test.describe("a 1-character fill-in answer", () => {
  textOnlyBank("馬");

  // Value: protects=a refused cast (no_hint) tells the team why instead of a button that does nothing, and
  // spends nothing (/review); fails_when=the phone drops the ERROR and keeps the dead button; no_claim=hint_shown.
  test("mage: a cast on a 1-character answer is refused with a note, and no use is spent", async ({ browser }) => {
    const { host, team } = await mageRoom(browser);
    await team.getByRole("button", { name: /看答案第一個字/ }).click();
    await expect(team.getByText("🔮 這題答案太短，不能看第一個字・剩 2 次")).toBeVisible();
    await expect(team.getByRole("button", { name: /看答案第一個字/ })).toHaveCount(0);
    await expect(host.getByTestId("host-mage-hint")).toHaveCount(0);
  });
});
