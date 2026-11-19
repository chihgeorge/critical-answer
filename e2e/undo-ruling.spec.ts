import { test, expect, type Page } from "@playwright/test";
import { restoreRoom0AfterEach, startGame, screenUrl, closeLeftoverContexts, openMore } from "./answer";

closeLeftoverContexts();

restoreRoom0AfterEach();

// Value: protects=撤回裁決 end to end (docs/designs/anti-ai-cheating.md): after 冤枉 the ruling card leaves one ↩ 撤回裁決
// button, pressing it brings the card back, the big screen shows its notice and the potion is gone; fails_when=the host
// never sees the button, the card does not come back, or the screen misses the notice; seam=none; no_claim=成立's
// rollback and the window closing (room unit tests in lib/room/anti-cheat.test.ts)
test("undo ruling: 冤枉 then 撤回裁決 brings the ruling card back and the big screen says so", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const phones: Page[] = [];
  for (const name of ["甲隊", "乙隊"]) {
    const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await team.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
    phones.push(team);
  }
  await startGame(host);

  // ⚙ 更多 → 🚨 開啟抓包與神諭.
  await openMore(host, "other");
  await host.getByTestId("anti-cheat-switch").click();
  await expect(host.getByTestId("anti-cheat-switch")).toHaveAttribute("aria-checked", "true");
  await host.getByTestId("more-drawer").getByRole("button", { name: "關閉" }).first().click();

  // The team not on turn files the catch (the bundled bank is multipleChoice, so the question is up at once).
  // Two pages: a locator cannot `.or()` across them, so wait until one phone shows the button.
  let waiting = -1;
  await expect.poll(async () => {
    for (const [i, p] of phones.entries()) if (await p.getByTestId("file-catch").isVisible()) waiting = i;
    return waiting;
  }).toBeGreaterThanOrEqual(0);
  await phones[waiting].getByTestId("file-catch").click();
  await expect(host.getByTestId("host-ruling")).toBeVisible();

  await host.getByTestId("host-ruling-dismiss").click();
  await expect(host.getByTestId("host-ruling")).toHaveCount(0);
  const undo = host.getByTestId("host-undo-ruling");
  await expect(undo).toContainText("撤回裁決");
  await expect(undo).toContainText("剛才判了冤枉");
  await expect(screen.getByTestId("pawn-potion")).toBeVisible();

  await undo.click();
  await expect(host.getByTestId("host-ruling")).toBeVisible();
  await expect(host.getByTestId("host-undo-ruling")).toHaveCount(0);
  await expect(screen.getByTestId("transition-undo")).toContainText("主持人收回了剛才的裁決");
  await expect(screen.getByTestId("pawn-potion")).toHaveCount(0);
});
