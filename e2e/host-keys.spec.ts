import { test, expect } from "@playwright/test";
import { textOnlyRoom0 } from "./answer";

// These tests judge by hand (or HOST_JUDGE), which a multipleChoice turn doesn't take.
textOnlyRoom0();

/** The host can judge from a laptop keyboard (lib/host-keys.ts): 1 = 答對 / 下一題, 2 = 重答, 3 = 逃跑. */
test("the host judges with the keyboard: 2 marks a wrong answer, 1 a correct one, 1 again closes the reveal", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  for (const name of ["甲隊", "乙隊"]) {
    const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await team.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(team.getByTestId("roster")).toContainText(name);
  }
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
  await expect(host.getByRole("button", { name: "答對！" })).toBeEnabled();

  await host.keyboard.press("2"); // wrong, retry: the turn moves to 乙隊
  await expect(host.getByText("輪到：乙隊")).toBeVisible();
  await expect(host.getByRole("button", { name: "答對！" })).toBeEnabled();

  await host.keyboard.press("1"); // correct: the answer goes up on the big screen
  await expect(host.getByTestId("host-reveal")).toBeVisible();
  await expect(host.getByRole("button", { name: "下一題" })).toBeEnabled();

  await host.keyboard.press("Control+1"); // a browser shortcut: left alone
  await expect(host.getByTestId("host-reveal")).toBeVisible();

  await host.keyboard.press("1"); // 下一題
  await expect(host.getByTestId("host-reveal")).toHaveCount(0);
});
