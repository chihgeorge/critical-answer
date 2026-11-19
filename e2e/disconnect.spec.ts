import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { hostCheckSettled, textOnlyBank, startGame, screenUrl, closeLeftoverContexts } from "./answer";

closeLeftoverContexts();

// These tests judge by hand (or HOST_JUDGE), which a multipleChoice turn doesn't take.
textOnlyBank();

/**
 * A phone whose connection drops (not a rest) says so, and once it's back tells its team whether its
 * turn was skipped meanwhile (lib/offline-notice.ts). The drop is simulated: the first socket is
 * closed, and every reconnect attempt is refused until the test lets it through.
 */
async function flakySockets(page: Page) {
  const links: { page: WebSocketRoute; server: WebSocketRoute; heard: boolean }[] = [];
  const state = {
    block: false,
    count: () => links.length,
    /** Whether the latest connection has had a message from the room: proof it's really open (the
     * big screen never sends anything, so the page side alone can't tell us). */
    heard: () => links.at(-1)?.heard ?? false,
    /** Drop the latest connection on both ends, so the room sees the team go offline too. */
    drop() {
      const last = links.at(-1)!;
      last.server.close();
      last.page.close({ code: 1006, reason: "network" });
    },
  };
  await page.routeWebSocket(/:1996\//, (ws) => {
    if (state.block) {
      ws.close({ code: 1006, reason: "still offline" });
      return;
    }
    const server = ws.connectToServer();
    const link = { page: ws, server, heard: false };
    links.push(link);
    server.onMessage((m) => {
      link.heard = true;
      ws.send(m);
    });
  });
  return state;
}

test("a phone that drops on its own turn shows it's offline, then that its turn was skipped", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const net = await flakySockets(phone);
  await phone.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(phone.getByTestId("roster")).toContainText("甲隊");
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await other.goto(`/room/${code}/play?name=${encodeURIComponent("乙隊")}`);
  await expect(other.getByTestId("roster")).toContainText("乙隊");

  await startGame(host);
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
  await expect(phone.getByText("斷線")).toHaveCount(0);

  // 甲隊's phone drops on its own turn and can't get back in.
  net.block = true;
  net.drop();
  await expect(phone.getByText("連線中斷，重新連線中…")).toBeVisible();

  // The turn stays with the offline team until the host explicitly skips it.
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
  await hostCheckSettled(host); // 跳過 is refused while 甲隊's fill-in check rolls itself (an offline team's too)
  await host.getByRole("button", { name: /跳過這隊的回合/ }).click();
  await expect(host.getByText("輪到：乙隊")).toBeVisible();
  await hostCheckSettled(host); // 乙隊's fill-in check rolls itself first
  await host.getByRole("button", { name: "答錯・下輪再答" }).click();

  // Back online: the notice goes, and the team learns its turn was skipped.
  net.block = false;
  await expect(phone.getByText("斷線時剛好輪到你們，這一回合被跳過了。")).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText("連線中斷，重新連線中…")).toHaveCount(0);
});

test("the big screen shows it's offline while its connection is down", async ({ browser }) => {
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const net = await flakySockets(screen);
  await screen.goto("/room/DSCN/screen");
  await expect(screen.getByText("DSCN")).toBeVisible();
  await expect.poll(() => net.count()).toBe(1);
  // Dropping a socket that never opened would rightly show nothing: the screen was never connected.
  await expect.poll(() => net.heard()).toBe(true);
  net.block = true;
  net.drop();
  await expect(screen.getByText("連線中斷，重新連線中…")).toBeVisible();
  net.block = false;
  await expect(screen.getByText("連線中斷，重新連線中…")).toHaveCount(0, { timeout: 30_000 });
});

// Value: protects=the host-away banner wiring (#262) on the big screen and a phone, and its clearing when the host page
// comes back; fails_when=STATE.hostAway stops rendering on either page or stays after HOST_CLAIM; no_claim=the 8 s grace
// timer's edges (lib/room/host-away.test.ts).
test("the big screen and a phone say the host is reconnecting while the host page is gone, until it is back", async ({ browser }) => {
  test.setTimeout(45_000); // the room waits HOST_AWAY_GRACE_MS (8 s) before it says so
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(phone.getByTestId("roster")).toContainText("甲隊");
  await startGame(host);
  await expect(phone.getByText("輪到我們了！")).toBeVisible();

  const hostUrl = host.url().replace(/&new=\d+/, ""); // the host token (#k=), never a fresh-room link
  await host.close();
  await expect(screen.getByTestId("host-away")).toContainText("主持人重新連線中", { timeout: 15_000 });
  await expect(phone.getByText(/主持人重新連線中/)).toBeVisible();

  const back = await host.context().newPage();
  await back.goto(hostUrl);
  await expect(screen.getByTestId("host-away")).toHaveCount(0);
  await expect(phone.getByText(/主持人重新連線中/)).toHaveCount(0);
});
