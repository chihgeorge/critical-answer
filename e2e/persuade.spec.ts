import { test, expect } from "@playwright/test";
import { textOnlyBank, startGame, screenUrl, closeLeftoverContexts, rollDish } from "./answer";

closeLeftoverContexts();

// The persuasion check (dnd design R6): a fill-in question's check rolls itself as the turn opens (owner 2026-11-19), and
// the question shows on the big screen and the phone only once the die has landed (check first, question after). The e2e worker
// fixes the die at 10 (playwright.config.ts E2E_DIE), which passes a first room's DC 8 and earns the first character.
textOnlyBank("〈萬家福〉");

// Value: protects=the check rolls itself with no button, the big screen shows the DC and then the die, the question stays
// off the TV and the phone until it lands (the host still has it), and a pass shows the answer's first character on the
// phone and the TV (dnd design R6, R-E3); fails_when=the box or the question shows before the die lands, the phone still
// shows a roll button, or the hint never reaches a screen; no_claim=a fail, a 20 or a 1 (unit tests).
test("the check rolls itself, passes the DC, the team sees the first character, then types its answer", async ({ browser }) => {
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
  await expect(screen.getByTestId("screen-check-dc")).toContainText("說服擲骰檢定 8");
  // Check first, question after: only the host has the question while the die rolls; the phone has nothing to press.
  const question = (await host.getByTestId("host-question").textContent())!;
  expect(question.length).toBeGreaterThan(0);
  await expect(host.getByTestId("host-check-first")).toBeVisible();
  // The die's own chip names the check while it rolls, so the panel holds no line under it (QA 2026-11-19, L2).
  await expect(screen.getByTestId("screen-check-first")).toBeVisible();
  await expect(screen.getByText(question)).toHaveCount(0);
  await expect(team.getByText(question)).toHaveCount(0);
  await expect(team.getByTestId("roll-check")).toHaveCount(0);
  await expect(screen.getByTestId("roll-overlay")).toHaveCount(0, { timeout: 8000 });

  await expect(screen.getByTestId("screen-check-first")).toHaveCount(0, { timeout: 8000 });
  await expect(screen.getByText(question)).toBeVisible();
  await expect(team.getByRole("heading", { name: question })).toBeVisible();
  await expect(host.getByTestId("host-check-first")).toHaveCount(0);
  for (const page of [screen, team, host]) await expect(page.getByTestId("answer-clock")).toBeVisible();
  await expect(team.getByTestId("check-result")).toHaveText("🗣️ 過了！看提示");
  await expect(team.getByTestId("check-hint")).toHaveText("🔮 第一個字：萬");
  await expect(screen.getByTestId("screen-check-hint")).toHaveText("🔮 第一個字：萬");

  await box.fill("萬家福");
  await team.getByRole("button", { name: "送出" }).click();
  await expect(host.getByTestId("host-typed-answer")).toHaveText("隊伍答：萬家福");
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByRole("button", { name: "🎲 擲料理骰", exact: true })).toBeEnabled(); // the answer is on show, before the dish die
  await rollDish(host);
  await expect(host.getByRole("button", { name: "🍲 上菜", exact: true })).toBeEnabled(); // then the cooked monster
});
