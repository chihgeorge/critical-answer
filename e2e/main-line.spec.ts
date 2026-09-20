import { test, expect, type Page } from "@playwright/test";

/** Every WebSocket text frame a page receives, so we can assert on what /screen and /play were sent. */
function recordFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  return frames;
}

test("create room, join two teams, start, judge; screen and play never see host-only data", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const screenFrames = recordFrames(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText(code)).toBeVisible();

  const players: { page: Page; frames: string[] }[] = [];
  for (const name of ["甲隊", "乙隊"]) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const frames = recordFrames(page);
    await page.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(page.getByText("等待主持人開始遊戲")).toBeVisible();
    players.push({ page, frames });
  }

  // Host claims control, then starts once both teams are in.
  await expect(host.getByText("乙隊")).toBeVisible();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();
  await expect(players[0].page.getByText("輪到我們了！")).toBeVisible();

  // A correct judgment scores and passes the turn.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到：乙隊")).toBeVisible();
  await expect(screen.getByText("輪到：乙隊")).toBeVisible();
  await expect(players[1].page.getByText("輪到我們了！")).toBeVisible();

  // Nothing host-only (token confirmation, answers) reaches the public surfaces.
  for (const frames of [screenFrames, ...players.map((p) => p.frames)]) {
    expect(frames.length).toBeGreaterThan(0);
    const all = frames.join("\n");
    expect(all).not.toContain("HOST_OK");
    expect(all).not.toContain('"answer"');
  }
  await expect(screen.locator("body")).not.toContainText("答案");
  await expect(players[0].page.locator("body")).not.toContainText("答案");
});

test("a browser with no host token cannot start a game", async ({ page }) => {
  await page.goto("/room/ZZZZ/host");
  await expect(page.getByText("這個瀏覽器沒有主持人金鑰")).toBeVisible();
  await expect(page.getByRole("button", { name: /開始遊戲/ })).toBeDisabled();
});
