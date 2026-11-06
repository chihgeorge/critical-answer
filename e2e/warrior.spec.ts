import { test, expect } from "@playwright/test";
import { restoreRoom0AfterEach, startGame } from "./answer";

restoreRoom0AfterEach();

test("warrior: a team picks 戰士 in the lobby, rolls instead of answering, the big screen shows the die, one use is spent", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("戰士隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  // Every class can be picked (PR 2).
  await expect(team.getByRole("button", { name: /法師/ })).toBeEnabled();
  await team.getByRole("button", { name: /戰士/ }).click();
  await expect(team.getByRole("button", { name: /戰士/ })).toHaveAttribute("aria-pressed", "true");
  await expect(host.getByText("⚔️ 戰士")).toBeVisible();

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await expect(team.getByText("戰士・剩 2 次")).toBeVisible();

  await team.getByRole("button", { name: /擲骰代替答題/ }).click();
  await expect(team.getByText(/擲出 \d+( 大成功)?！看大螢幕/)).toBeVisible(); // a 20 on a multipleChoice question is a crit
  await expect(screen.getByTestId("roll-overlay")).toBeVisible();
  // The host waits the beat out: the room judges the roll (and the use is already spent).
  await expect(host.getByText("戰士隊擲出了骰子…")).toBeVisible();
  await expect(team.getByText("戰士・剩 1 次")).toBeVisible();
  // The die lands on the room's value and the verdict bar reads it.
  await expect(screen.getByTestId("roll-overlay")).toContainText(/(1[2-9]|20) ≥ 12 命中！|20 大成功！命中|\d+，差一點/);

  // After the 2 s beat the room judges the roll and the overlay goes away.
  await expect(screen.getByTestId("roll-overlay")).toHaveCount(0, { timeout: 5000 });
  await expect(host.getByText("戰士隊擲出了骰子…")).toHaveCount(0);
});

// Value: protects=a correct lock rolls the crit die on the big screen before it is judged (dnd design R9, R10, R-E3);
// fails_when=the die is skipped, never lands, or the judgment shows before it; seam=none; no_claim=which value lands (unit tests)
test("crit die: a right lock shows the die on the big screen after 公布答案, then the answer is judged", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("暴擊隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  const answer = (await host.getByTestId("host-answer").textContent())!;
  await team.getByRole("button", { name: new RegExp(`^[A-D]\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click();
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await host.getByRole("button", { name: /公布答案/ }).click();

  // After the reveal's 2 s, the crit die: nothing is judged yet.
  const overlay = screen.getByTestId("roll-overlay");
  await expect(overlay).toHaveAttribute("data-kind", "crit");
  await expect(team.getByText(/答對！暴擊骰擲出 \d+/)).toBeVisible();
  await expect(host.getByText("暴擊隊擲出了骰子…")).toBeVisible();
  await expect(screen.getByTestId("roll-result")).toHaveText(/20 大成功！多拿一半|1 大失敗……還是打中了|\d+，答對！/);

  // The die's 2 s: then the room judges the answer and the overlay goes.
  await expect(overlay).toHaveCount(0, { timeout: 5000 });
  await expect(team.getByText(/^答對了！/)).toBeVisible();
});
