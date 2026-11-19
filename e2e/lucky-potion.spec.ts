import { test, expect } from "@playwright/test";
import { restoreRoom0AfterEach, startGame, screenUrl, openTeamTools, closeMore, closeLeftoverContexts } from "./answer";

closeLeftoverContexts();

restoreRoom0AfterEach();

// Value: protects=the 🍀 幸運骰 path end to end (docs/designs/lucky-potion.md): the host gives one, the pawn and the phone show it,
// a team with no class uses it, and its dish die rolls as two dice on the big screen; fails_when=a screen misses the item or
// the roll shows one die; seam=none; no_claim=which values land, or a class's skill die (unit tests)
test("lucky die: host gives it, a no-class team uses it, the dish die rolls two dice and it is gone", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  // Every message the host page sends, to prove 取消 sent no HOST_GIVE_ITEM.
  const sent: string[] = [];
  host.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("幸運隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  // 給…一顆幸運骰？ asks first (#267): 取消 gives nothing, so the button stays and the next press still asks.
  // It is in ⚙ 更多's 隊伍.
  await openTeamTools(host, "幸運隊");
  const asked: string[] = [];
  host.once("dialog", (d) => void (asked.push(d.message()), d.dismiss()));
  await host.getByTestId("give-potion").click();
  await expect.poll(() => asked).toEqual([expect.stringContaining("給幸運隊一顆幸運骰？")]);
  await expect(host.getByTestId("give-potion")).toBeEnabled();
  await expect(host.getByTestId("give-potion")).toHaveText("🍀 給幸運骰");
  await expect(screen.getByTestId("pawn-potion")).toHaveCount(0);
  await expect(team.getByTestId("phone-potion")).toHaveCount(0);
  host.once("dialog", (d) => void (asked.push(d.message()), d.accept()));
  await host.getByTestId("give-potion").click();
  await expect.poll(() => asked.length).toBe(2);
  await expect(host.getByTestId("give-potion")).toBeDisabled();
  await expect(host.getByTestId("give-potion")).toHaveText("🍀 已有");
  await closeMore(host);
  await expect(screen.getByTestId("pawn-potion")).toBeVisible();
  // The room's echo is in, so both presses' frames are logged, in order: only the accepted press gave one.
  expect(sent.filter((m) => m.includes('"HOST_GIVE_ITEM"'))).toHaveLength(1);
  await expect(screen.getByTestId("screen-potion")).toHaveText("🍀 有幸運骰");
  await expect(team.getByTestId("phone-potion")).toHaveText("🍀 有一顆幸運骰");

  await team.getByTestId("drink-potion").click();
  await expect(team.getByTestId("phone-potion")).toHaveText(/準備好了：這題下一顆料理骰擲兩顆取高/);
  await expect(team.getByTestId("drink-potion")).toHaveCount(0);
  await expect(screen.getByTestId("screen-potion")).toHaveText("🍀 幸運骰備好了！");

  const answer = (await host.getByTestId("host-answer").textContent())!;
  await team.getByRole("button", { name: new RegExp(`^[A-D]\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click();
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await host.getByRole("button", { name: /公布答案/ }).click();

  const overlay = screen.getByTestId("roll-overlay");
  await expect(overlay).toHaveAttribute("data-kind", "dish");
  await expect(overlay).toContainText("幸運骰！擲兩次取高");
  await expect(screen.getByTestId("potion-die")).toHaveCount(2);
  await expect(screen.getByTestId("roll-result")).toHaveText(/^取高：\d+/);
  await expect(overlay).toHaveCount(0, { timeout: 5000 });
  await openTeamTools(host, "幸運隊");
  await expect(host.getByTestId("give-potion")).toHaveText("🍀 給幸運骰");
  await expect(screen.getByTestId("pawn-potion")).toHaveCount(0);
});
