// The host's tools for a day that goes wrong: 🩺 檢查題庫, the room's closing warning with 延長 1 小時, and ⚙ 更多's
// 修正・改判 with the scoreboard they change (docs/hosting.md).
import { test, expect, type WebSocketRoute } from "@playwright/test";
import { startGame, rollCheck, openMore, serveDish, closeLeftoverContexts, textOnlyBank } from "./answer";

closeLeftoverContexts();
textOnlyBank();

// Value: protects=the closing warning and 延長 1 小時 on the host page, and that the room really extends: the room's
// own reply clears the warning; fails_when=the panel does not show, the button does not send HOST_EXTEND_ROOM, the
// room ignores it, or a capped room still offers it; why_new=nothing reached room-closing (the room warns only 15
// minutes before a 6 hour end); seam=the warning is injected into the host's socket (page.routeWebSocket), the rest is
// the real room; no_claim=the room's alarm timing (dungeon-room unit tests)
test("room closing: the warning shows, 延長 1 小時 extends the room and the warning goes, and a capped room cannot extend", async ({ browser }) => {
  const context = await browser.newContext();
  const sockets: WebSocketRoute[] = [];
  // Passes every frame through both ways; the test only adds the room's warning.
  await context.routeWebSocket(/:1996\//, (ws) => {
    ws.connectToServer();
    sockets.push(ws);
    // A closed socket (the home page's, a reconnect's) must not get the warning.
    ws.onClose(() => void sockets.splice(sockets.indexOf(ws), 1));
  });
  const host = await context.newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("延長隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await startGame(host); // the room's life counts from the first start: only then can it extend
  await expect(host.getByTestId("host-scoreboard")).toContainText("延長隊");

  const warn = (canExtend: boolean) => {
    for (const ws of sockets) ws.send(JSON.stringify({ type: "HOST_ROOM_CLOSING", minutesLeft: 5, canExtend }));
  };
  warn(true);
  // Panel drops a data-testid (components/pixel.tsx), so the warning is found by its text.
  const closing = host.getByRole("status").filter({ hasText: /房間再 \d+ 分鐘關閉/ });
  await expect(closing).toContainText("房間再 5 分鐘關閉");
  await expect(host.getByTestId("room-extend")).toHaveText("延長 1 小時");
  await host.getByTestId("room-extend").click();
  // The room extends and answers every host page that it is no longer closing.
  await expect(closing).toHaveCount(0);

  warn(false);
  await expect(closing).toContainText("房間再 5 分鐘關閉");
  await expect(host.getByTestId("room-extend")).toHaveText("已達上限");
  await expect(host.getByTestId("room-extend")).toBeDisabled();
});

// Value: protects=🩺 檢查題庫's round trip in the lobby, and 修正 (+5, 設定分數) and 改判 after a judged answer, with the
// scoreboard following; fails_when=the check never answers, a fix does not reach the room or the scoreboard, or 改判
// does not flip the row; why_new=more-drawer's 修正・改判 had no e2e; seam=a text-only bank (no media to look up);
// no_claim=ability and potion fixes, a die-paid 改判 (lib/room tests)
test("host fixes: 🩺 檢查題庫 answers in the lobby, then 修正 and 改判 change the score the scoreboard shows", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("修正隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  await openMore(host);
  const health = host.getByTestId("host-bank-health");
  await health.getByRole("button", { name: "🩺 檢查題庫" }).click();
  await expect(health.getByRole("status").first()).toContainText("沒發現問題", { timeout: 30_000 });
  await host.getByTestId("more-drawer").getByRole("button", { name: "關閉" }).first().click();

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await rollCheck(team);
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByTestId("host-reveal")).toBeVisible({ timeout: 10_000 });
  // A cooked monster's points count once its dish is served (docs/designs/monster-cuisine.md).
  await serveDish(host);

  const reward = host.getByTestId("host-scoreboard").locator("span.px-num").last();
  await expect(reward).not.toHaveText("0", { timeout: 15_000 });
  await openMore(host);
  const fix = host.getByTestId("host-fix");
  await expect(fix).toContainText("修正隊");
  const shown = fix.locator("span.px-num").first();
  const before = Number(await shown.textContent());
  await fix.getByRole("button", { name: "修正隊加 5 分" }).click();
  await expect(shown).toHaveText(String(before + 5));
  await fix.getByLabel("修正隊的分數", { exact: true }).fill("42");
  await fix.getByRole("button", { name: "設定修正隊的分數" }).click();
  await expect(shown).toHaveText("42");
  await expect(reward).toHaveText("42");

  // 改判: the one judged row flips from 答對 to 答錯, and its button now offers the way back.
  const rejudge = host.getByTestId("host-rejudge");
  await expect(rejudge).toContainText("第 1 題");
  await expect(rejudge).toContainText("修正隊 · 答對 +");
  await rejudge.getByRole("button", { name: /^第 1 題 修正隊 改成答錯（−\d+）$/ }).click();
  await expect(rejudge).toContainText("已改判（原本答對）");
  await expect(rejudge.getByRole("button", { name: /^第 1 題 修正隊 改成答對（/ })).toBeVisible();
  await expect(shown).not.toHaveText("42");
  await expect(reward).toHaveText((await shown.textContent())!);
});
