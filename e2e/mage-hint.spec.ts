import { test, expect, type Browser } from "@playwright/test";
import { textOnlyBank, startGame, rollCheck, screenUrl } from "./answer";

async function mageRoom(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("法師隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await expect(team.getByText("選擇題刪 2 個錯的選項；填空題看答案第一個字")).toBeVisible();
  await team.getByRole("button", { name: /法師/ }).click();
  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  return { host, screen, team };
}

test.describe("a fill-in answer with a first character", () => {
  // Every answer is known, so the hint is too (#106).
  textOnlyBank("〈萬家福〉");

  // Value: protects=check first, question after: the mage's 看答案第一個字 is not offered before the persuasion check, and
  // not after a check that already gave the character, so no use is spent; fails_when=the button shows during the check
  // or next to the check's own hint; no_claim=the cast itself after a failed check (lib/room/dungeon-room.test.ts: the
  // e2e die is fixed at 10, which a mage's +4 always passes here).
  test("mage: no first-character button before the check, nor after a check that gave it", async ({ browser }) => {
    const { screen, team } = await mageRoom(browser);
    await expect(team.getByTestId("roll-check")).toBeVisible();
    await expect(team.getByRole("button", { name: /看答案第一個字/ })).toHaveCount(0);
    await rollCheck(team);
    await expect(team.getByTestId("check-hint")).toHaveText("🔮 第一個字：萬");
    await expect(screen.getByTestId("screen-check-hint")).toHaveText("🔮 第一個字：萬");
    await expect(team.getByRole("button", { name: /看答案第一個字/ })).toHaveCount(0);
    await expect(team.getByText("法師・剩 4 次")).toBeVisible();
  });
});

test.describe("a 1-character fill-in answer", () => {
  textOnlyBank("馬");

  // Value: protects=a refused cast (no_hint) tells the team why instead of a button that does nothing, and
  // spends nothing (/review); fails_when=the phone drops the ERROR and keeps the dead button; no_claim=hint_shown.
  test("mage: a cast on a 1-character answer is refused with a note, and no use is spent", async ({ browser }) => {
    const { host, team } = await mageRoom(browser);
    // The check passes but a 1-character answer has no hint to give, so the mage's button is offered after it.
    await rollCheck(team);
    await team.getByRole("button", { name: /看答案第一個字/ }).click();
    await expect(team.getByText("🔮 這題答案太短，不能看第一個字・剩 4 次")).toBeVisible();
    await expect(team.getByRole("button", { name: /看答案第一個字/ })).toHaveCount(0);
    await expect(host.getByTestId("host-mage-hint")).toHaveCount(0);
  });
});
