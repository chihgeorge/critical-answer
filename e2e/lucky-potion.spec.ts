import { test, expect } from "@playwright/test";
import { restoreRoom0AfterEach, startGame, screenUrl } from "./answer";

restoreRoom0AfterEach();

// Value: protects=the 🧪 幸運藥水 path end to end (docs/designs/lucky-potion.md): the host gives one, the pawn and the phone show it,
// the team drinks it, and its crit die rolls as two dice on the big screen; fails_when=a screen misses the item or the roll
// shows one die; seam=none; no_claim=which values land (unit tests)
test("lucky potion: host gives it, the team drinks it, the crit rolls two dice and the potion is gone", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("藥水隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  await host.getByTestId("give-potion").click();
  await expect(host.getByTestId("give-potion")).toBeDisabled();
  await expect(host.getByTestId("give-potion")).toHaveText("🧪 已有");
  await expect(screen.getByTestId("pawn-potion")).toBeVisible();
  await expect(screen.getByTestId("screen-potion")).toHaveText("🧪 有幸運藥水");
  await expect(team.getByTestId("phone-potion")).toHaveText("🧪 有一瓶幸運藥水");

  await team.getByTestId("drink-potion").click();
  await expect(team.getByTestId("phone-potion")).toHaveText(/已喝下/);
  await expect(team.getByTestId("drink-potion")).toHaveCount(0);
  await expect(screen.getByTestId("screen-potion")).toHaveText("🧪 已喝下！");

  const answer = (await host.getByTestId("host-answer").textContent())!;
  await team.getByRole("button", { name: new RegExp(`^[A-D]\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click();
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await host.getByRole("button", { name: /公布答案/ }).click();

  const overlay = screen.getByTestId("roll-overlay");
  await expect(overlay).toHaveAttribute("data-kind", "crit");
  await expect(overlay).toContainText("幸運藥水！擲兩次取高");
  await expect(screen.getByTestId("potion-die")).toHaveCount(2);
  await expect(screen.getByTestId("roll-result")).toHaveText(/^取高：\d+/);
  await expect(overlay).toHaveCount(0, { timeout: 5000 });
  await expect(host.getByTestId("give-potion")).toHaveText("🧪 給藥水");
  await expect(screen.getByTestId("pawn-potion")).toHaveCount(0);
});
