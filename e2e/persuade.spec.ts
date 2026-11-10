import { test, expect } from "@playwright/test";
import { textOnlyBank, startGame, screenUrl } from "./answer";

// The persuasion check (dnd design R6, R-E1): a fill-in question starts with 擲骰說服 on the phone. The e2e worker
// fixes the die at 10 (playwright.config.ts E2E_DIE), which passes a first room's DC 8 and earns the first character.
textOnlyBank("〈萬家福〉");

// Value: protects=the phone rolls before it answers, the big screen shows the DC and then the die, and a pass shows
// the answer's first character on the phone and the TV (dnd design R6, R-E1, R-E3); fails_when=the box shows before the
// roll, the DC chip or overlay is missing, or the hint never reaches a screen; no_claim=a fail, a 20 or a 1 (unit tests).
test("a team rolls 擲骰說服, passes the DC, sees the first character, then types its answer", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("說服隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  const box = team.getByRole("textbox", { name: "你們的答案" });
  await expect(box).toHaveCount(0);
  await expect(screen.getByTestId("screen-check-dc")).toContainText(/說服 DC 8.*說服隊：按手機上的「擲骰說服」/);

  await team.getByTestId("roll-check").click();
  await expect(screen.getByTestId("roll-overlay")).toBeVisible();
  await expect(screen.getByTestId("roll-overlay")).toHaveCount(0, { timeout: 5000 });

  await expect(team.getByTestId("check-result")).toHaveText("🗣️ 過了！看提示");
  await expect(team.getByTestId("check-hint")).toHaveText("🔮 第一個字：萬");
  await expect(screen.getByTestId("screen-check-hint")).toHaveText("🔮 第一個字：萬");
  await expect(team.getByTestId("roll-check")).toHaveCount(0);

  await box.fill("萬家福");
  await team.getByRole("button", { name: "送出" }).click();
  await expect(host.getByTestId("host-typed-answer")).toHaveText("隊伍答：萬家福");
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByRole("button", { name: "🍲 上菜", exact: true })).toBeEnabled(); // the answer is on show (cooked monster)
});
