import { test, expect } from "@playwright/test";
import { textOnlyBank, skipInitiative, rollCheck, screenUrl } from "./answer";

// 每題作答倒數 (docs/designs/answer-countdown.md): the host picks the seconds in the lobby, the big screen, the turn's
// phone and the host page count down, and sending the answer stops it. Expiry and the rules are in lib/room/answer-clock.test.ts.
textOnlyBank();

// Value: protects=the lobby choice reaches the room and all three pages show the room's count (D2, D5);
// fails_when=the select is not sent, a page misses the clock, or an answer does not stop it; no_claim=what happens at 0 (unit tests).
test("the host's 30 秒 shows on the TV, the phone and the host page, and sending the answer stops it", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("倒數隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  await expect(host.getByTestId("answer-seconds")).toHaveValue("60");
  await host.getByTestId("answer-seconds").selectOption("30");
  await host.getByRole("checkbox", { name: "開始前播放玩法說明" }).uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await skipInitiative(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  // A fill-in counts only once its persuasion check is rolled and the question is up.
  await expect(host.getByTestId("host-check-first")).toBeVisible();
  for (const page of [screen, team, host]) await expect(page.getByTestId("answer-clock")).toHaveCount(0);
  await rollCheck(team);

  for (const page of [screen, team, host]) {
    const clock = page.getByTestId("answer-clock");
    await expect(clock).toBeVisible();
    const left = Number(await clock.getAttribute("data-left"));
    expect(left).toBeGreaterThan(20);
    expect(left).toBeLessThanOrEqual(30);
  }

  await team.getByRole("textbox", { name: "你們的答案" }).fill("玉山");
  await team.getByRole("button", { name: "送出" }).click();
  await expect(screen.getByTestId("screen-typed-answer")).toBeVisible();
  for (const page of [screen, team, host]) await expect(page.getByTestId("answer-clock")).toHaveCount(0);
});
