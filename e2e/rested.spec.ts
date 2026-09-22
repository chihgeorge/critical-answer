import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * When a room is idle for hours it closes every connection with code 4001 on purpose. The pages must then
 * stop reconnecting by themselves (or an unused room would be woken up again at once), say what happened,
 * and reconnect on a click. The server side is tested in lifecycle.spec.ts; here the close is simulated.
 */
async function watchSockets(page: Page) {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/:1996\//, (ws) => {
    sockets.push(ws);
    ws.connectToServer();
  });
  return sockets;
}

const NOTICE = "房間休息中";

async function restAndReconnect(page: Page, sockets: WebSocketRoute[]) {
  await expect.poll(() => sockets.length).toBe(1);
  sockets[0].close({ code: 4001, reason: "idle" });
  await expect(page.getByText(NOTICE)).toBeVisible();
  // partysocket would try again after about a second: it must not.
  await page.waitForTimeout(3500);
  expect(sockets.length).toBe(1);
  await page.getByRole("button", { name: "重新連線" }).click();
  await expect.poll(() => sockets.length).toBe(2);
  await expect(page.getByText(NOTICE)).toHaveCount(0);
}

test("the host page rests on the idle close and reconnects on a click", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const sockets = await watchSockets(page);
  await page.goto("/");
  await page.getByRole("button", { name: /主持遊戲/ }).click();
  await page.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  await expect(page.getByText("等待隊伍加入")).toBeVisible();
  await restAndReconnect(page, sockets);
  await expect(page.getByText("等待隊伍加入")).toBeVisible(); // claimed again, back in the lobby
});

test("the big screen rests on the idle close and reconnects on a click", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const sockets = await watchSockets(page);
  await page.goto("/room/RSTS/screen");
  await expect(page.getByText("RSTS")).toBeVisible();
  await restAndReconnect(page, sockets);
});

test("a phone rests on the idle close and reconnects on a tap", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const sockets = await watchSockets(page);
  await page.goto("/room/RSTP/play?name=%E7%94%B2%E9%9A%8A");
  await expect(page.getByText("等待主持人開始遊戲")).toBeVisible();
  await restAndReconnect(page, sockets);
  await expect(page.getByText("等待主持人開始遊戲")).toBeVisible(); // joined again as the same team
});

test("any other close still reconnects by itself", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const sockets = await watchSockets(page);
  await page.goto("/room/RSTQ/play?name=%E7%94%B2%E9%9A%8A");
  await expect.poll(() => sockets.length).toBe(1);
  sockets[0].close({ code: 1006, reason: "network" });
  await expect.poll(() => sockets.length, { timeout: 15_000 }).toBe(2); // came back with no click
  await expect(page.getByText(NOTICE)).toHaveCount(0);
});
