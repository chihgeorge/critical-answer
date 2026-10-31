import { test, expect, type Browser, type Page } from "@playwright/test";

const UNREACHABLE = "連不上伺服器：請檢查網路，或稍後再試。";

/** Refuses every room socket until `open()`: the first connect never succeeds. */
async function refuseSockets(page: Page) {
  let refuse = true;
  await page.routeWebSocket(/:1996\//, (ws) => {
    if (refuse) return void ws.close({ code: 1006, reason: "unreachable" });
    ws.connectToServer();
  });
  return { open: () => void (refuse = false) };
}

async function hostRoom(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  return { host, code: host.url().match(/\/room\/([A-Z]{4})\//)![1] };
}

const phone = async (browser: Browser) => (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

// Value: protects=a phone whose first connect never opens says so and can retry (TODOS: 第一次連線就失敗);
// fails_when=the first-connect timer is missing, never fires before an open, or 重試 doesn't reconnect;
// no_claim=the timeout's exact length.
test("a phone that never connects says it can't reach the server, and 重試 gets it in", async ({ browser }) => {
  const { code } = await hostRoom(browser);
  const page = await phone(browser);
  const net = await refuseSockets(page);
  await page.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(page.getByText("連線中…")).toBeVisible();
  await expect(page.getByText(UNREACHABLE)).toBeVisible({ timeout: 15_000 });
  net.open();
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByText("等待主持人開始遊戲")).toBeVisible();
  await expect(page.getByText(UNREACHABLE)).toHaveCount(0);
});

// Value: protects=the big screen shows the same notice when it never connects, and says so again when a 重試
// fails too; fails_when=/screen ignores `unreachable`, or reconnect() stops re-arming the first-connect timer
// (the page sits on no notice forever); no_claim=the phone (test above).
test("a big screen that never connects says it can't reach the server", async ({ browser }) => {
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const net = await refuseSockets(screen);
  await screen.goto("/room/UNRC/screen");
  await expect(screen.getByText(UNREACHABLE)).toBeVisible({ timeout: 15_000 });
  // A retry while the server is still unreachable clears the notice, then brings it back.
  await screen.getByRole("button", { name: "重試" }).click();
  await expect(screen.getByText(UNREACHABLE)).toHaveCount(0);
  await expect(screen.getByText(UNREACHABLE)).toBeVisible({ timeout: 15_000 });
  net.open();
  await screen.getByRole("button", { name: "重試" }).click();
  await expect(screen.getByText(UNREACHABLE)).toHaveCount(0);
});

// Value: protects=a phone that joins after the start is told why and sees none of the running game (eng review
// D1); fails_when=game_already_started is ignored, or the STATE broadcast still renders the game for it;
// no_claim=room_full (lib/join-rejection.test.ts).
test("a phone that joins after the game started is told why, and sees no game", async ({ browser }) => {
  const { host, code } = await hostRoom(browser);
  const first = await phone(browser);
  await first.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(first.getByText("等待主持人開始遊戲")).toBeVisible();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(first.getByText("輪到我們了！")).toBeVisible();
  const late = await phone(browser);
  await late.goto(`/room/${code}/play?name=${encodeURIComponent("遲到隊")}`);
  await expect(late.getByText("遊戲已經開始了，新隊伍不能再加入")).toBeVisible();
  await expect(late.getByRole("link", { name: "回首頁" })).toBeVisible();
  await expect(late.getByText(/輪到/)).toHaveCount(0);
});

// Value: protects=a name the room refuses is explained instead of a silent lobby; fails_when=invalid_name is
// ignored; no_claim=which names sanitizeText strips (lib/protocol.test.ts).
test("a phone whose team name the room refuses is told to pick another", async ({ browser }) => {
  const { code } = await hostRoom(browser);
  const page = await phone(browser);
  await page.goto(`/room/${code}/play?name=`);
  await expect(page.getByText("隊伍名稱不能用，請換一個名字")).toBeVisible();
  await expect(page.getByText("等待主持人開始遊戲")).toHaveCount(0);
});
