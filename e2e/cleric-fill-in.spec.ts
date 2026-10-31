import { test, expect, type Browser, type Page } from "@playwright/test";
import { textOnlyBank } from "./answer";

// A cleric on a fill-in question (#106): the host's one 答錯 waits for 祈禱 / 重答 / 逃跑.
textOnlyBank();

async function clericRoom(browser: Browser, beforeWrong?: (host: Page) => Promise<void>) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("牧師隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await expect(team.getByText("答錯後，這回合再答一次")).toBeVisible();
  await team.getByRole("button", { name: /牧師/ }).click();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  const box = team.getByRole("textbox", { name: "你們的答案" });
  await box.fill("猜錯了");
  await team.getByRole("button", { name: "送出" }).click();
  await expect(host.getByTestId("host-typed-answer")).toHaveText("隊伍答：猜錯了");
  await beforeWrong?.(host);
  await host.getByRole("button", { name: "答錯", exact: true }).click();
  return { host, team, box };
}

/** Records whether 祈禱 / 重答 were disabled the moment they first render in the host's wait. */
function recordWaitButtons(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { waitFirstDisabled?: boolean[] };
    delete w.waitFirstDisabled;
    new MutationObserver((_, obs) => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => /^(祈禱|重答)/.test(b.textContent ?? ""));
      if (buttons.length < 2) return;
      w.waitFirstDisabled = buttons.map((b) => b.disabled);
      obs.disconnect();
    }).observe(document.body, { subtree: true, childList: true });
  });
}

const waitFirstDisabled = (page: Page) => page.evaluate(() => (window as unknown as { waitFirstDisabled?: boolean[] }).waitFirstDisabled);

// Value: protects=a cleric's fill-in 答錯 waits with 祈禱 on the phone and the host page, and 祈禱 gives the
// same team a fresh try for one use (AC: cleric on fill-in); fails_when=the host's 答錯 passes the turn at once,
// or 祈禱 is missing on fill-in; no_claim=refusals and the boss room (unit tests).
test("cleric: the phone prays after the host's 答錯 and the team answers again", async ({ browser }) => {
  const { host, team, box } = await clericRoom(browser);
  await expect(team.getByText("答錯了！要怎麼辦？")).toBeVisible();
  await expect(host.getByRole("button", { name: "祈禱", exact: true })).toBeVisible();
  await expect(host.getByRole("button", { name: "重答", exact: true })).toBeVisible();
  await expect(host.getByRole("button", { name: "逃跑", exact: true })).toBeVisible();
  await team.getByRole("button", { name: /^祈禱/ }).click();
  await expect(box).toHaveValue("");
  await expect(team.getByRole("button", { name: "送出" })).toBeVisible();
  await expect(team.getByText("牧師・剩 1 次")).toBeVisible();
  // The prayed turn has no second prayer: 答錯 goes back to 答錯・重答 / 答錯・逃跑.
  await expect(host.getByRole("button", { name: "答錯・重答" })).toBeVisible();
});

// Value: protects=the host can choose for the team, and 重答 spends no use; fails_when=the host's
// wait buttons are missing or do nothing; no_claim=逃跑 (unit tests).
test("cleric: the host presses 重答 in the wait and no use is spent", async ({ browser }) => {
  const { host, team, box } = await clericRoom(browser);
  await host.getByRole("button", { name: "重答", exact: true }).click();
  // The only team: the turn comes straight back to it, on the same question, with an empty box.
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(team.getByText("答錯了！要怎麼辦？")).toHaveCount(0);
  await expect(team.getByText("牧師・剩 2 次")).toBeVisible();
});

// Value: protects=a host's double-tap of 2 (答錯) never turns into 祈禱 and spends the team's use (/review);
// fails_when=the second 2 lands on the wait's 祈禱 key; no_claim=mouse clicks (the start-disabled test below).
test("cleric: a double-tap of 2 marks the answer wrong once and spends nothing", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("牧師隊")}`);
  await team.getByRole("button", { name: /牧師/ }).click();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByRole("button", { name: "答錯", exact: true })).toBeEnabled();
  await host.keyboard.press("2");
  await expect(host.getByRole("button", { name: "祈禱", exact: true })).toBeVisible();
  await host.keyboard.press("2");
  await host.waitForTimeout(300);
  await expect(team.getByText("答錯了！要怎麼辦？")).toBeVisible();
  await expect(team.getByText("牧師・剩 2 次")).toBeVisible();
  // Past the delay, the wait's keys work: 3 is 重答. Press until it lands, so the test does not depend on the delay's length.
  await expect(async () => {
    await host.keyboard.press("3");
    await expect(team.getByText("答錯了！要怎麼辦？")).toHaveCount(0, { timeout: 300 });
  }).toPass();
  await expect(team.getByText("牧師・剩 2 次")).toBeVisible();
});

// Value (ship adversarial review): protects=a double-click on the host's 答錯 never lands on the wait's 祈禱 / 重答,
// which take its place; fails_when=the wait's buttons are enabled the moment they appear; no_claim=the delay's exact length.
test("cleric: the host's wait buttons start disabled, so a double-click on 答錯 spends nothing", async ({ browser }) => {
  // Record the buttons the moment they render: polling could look only after the delay on a slow runner.
  const { host, team } = await clericRoom(browser, recordWaitButtons);
  await expect.poll(() => waitFirstDisabled(host)).toEqual([true, true]);
  await expect(host.getByRole("button", { name: "重答", exact: true })).toBeEnabled();
  await expect(host.getByRole("button", { name: "祈禱", exact: true })).toBeEnabled();
  await expect(team.getByText("牧師・剩 2 次")).toBeVisible();
});

// Value (ship fix-check): protects=the second wait on the same team and question (after a 重答) holds too, though the
// 答錯 keeps the eventId the held "before" screen had; fails_when=the hold is keyed without the stage; no_claim=the delay's length.
test("cleric: a second wait on the same question, after 重答, also starts disabled", async ({ browser }) => {
  const { host, team, box } = await clericRoom(browser);
  await host.getByRole("button", { name: "重答", exact: true }).click();
  await expect(team.getByText("答錯了！要怎麼辦？")).toHaveCount(0);
  await box.fill("又猜錯了");
  await team.getByRole("button", { name: "送出" }).click();
  await expect(host.getByTestId("host-typed-answer")).toHaveText("隊伍答：又猜錯了");
  await host.waitForTimeout(600); // past the hold on this "before" screen, as a host would be
  await recordWaitButtons(host);
  await host.getByRole("button", { name: "答錯", exact: true }).click();
  await expect.poll(() => waitFirstDisabled(host)).toEqual([true, true]);
  await expect(team.getByText("牧師・剩 2 次")).toBeVisible();
});

// Value (ship adversarial review): protects=a double-tap of 2 on 祈禱 never judges the prayed attempt (答錯・重答 is 2
// there); fails_when=the prayed attempt's judge keys work the moment it appears; no_claim=the delay's exact length.
test("cleric: a double-tap of 2 on the host's 祈禱 never judges the new attempt", async ({ browser }) => {
  const { host, team, box } = await clericRoom(browser);
  await expect(host.getByRole("button", { name: "祈禱", exact: true })).toBeEnabled();
  await host.keyboard.press("2");
  // The prayed attempt is on screen: a second 2 now would be 答錯・重答 without the hold.
  await expect(host.getByRole("button", { name: "答錯・重答" })).toBeVisible();
  await host.keyboard.press("2");
  await host.waitForTimeout(300);
  await expect(team.getByText("牧師・剩 1 次")).toBeVisible();
  await expect(box).toHaveValue("");
  // Still the prayed attempt (a 重答 would bring the only team back to one 答錯 that waits).
  await expect(host.getByRole("button", { name: "答錯・重答" })).toBeEnabled();
});

// Value (ship audit): protects=the phone's 逃跑 in the wait deals a new question and spends no use; fails_when=the phone's
// 逃跑 sends 重答 (same question) or 祈禱, or leaves the wait up; why_new=the tests above press 祈禱 / host 重答 only;
// seam=none; no_claim=the boss room's rotation (unit tests).
test("cleric: the phone's 逃跑 in the wait deals a new question and spends nothing", async ({ browser }) => {
  const { team, box } = await clericRoom(browser);
  const question = team.getByRole("heading", { level: 2 });
  const before = await question.textContent();
  await team.getByRole("button", { name: /^逃跑/ }).click();
  await expect(team.getByText("答錯了！要怎麼辦？")).toHaveCount(0);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await expect(question).not.toHaveText(before!);
  await expect(box).toHaveValue("");
  await expect(team.getByText("牧師・剩 2 次")).toBeVisible();
});
