import { test, expect, type Locator } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const box = async (l: Locator) => (await l.boundingBox())!;

/** The big-screen lobby at 4 teams (one row per side) and at the maximum 8 (two rows): every nameplate shows,
 * and none sits under the room-code panel, the dialogue box's 地城主 tag, or another nameplate (2026-10-28). */
test("the big-screen lobby fits 4 and 8 teams without covering any nameplate", async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);

  // The 20-character name (the server cap) is cut with an ellipsis, never spilling onto a neighbour.
  const names = ["紅龍騎士團", "藍色閃電", "第三隊", "綠", "黃金獵人", "紫羅蘭", "資工系第一屆勇者小隊永遠不會輸的那一隊", "白夜"];
  async function checkPlates(count: number) {
    await expect(screen.getByText(`${count} 支隊伍已就位`)).toBeVisible();
    await screen.waitForTimeout(1500); // the run-in animation settles
    const panel = await box(screen.getByText("房間代碼", { exact: true }).locator(".."));
    const tag = await box(screen.getByText("地城主", { exact: true }));
    const plates: Box[] = [];
    for (const n of names.slice(0, count)) {
      const plate = screen.getByText(n, { exact: true });
      await expect(plate).toBeVisible();
      const b = await box(plate);
      expect(overlaps(b, tag), `${count} teams: ${n} under the 地城主 tag`).toBe(false);
      expect(b.y, `${count} teams: ${n} under the room-code panel`).toBeGreaterThan(panel.y + panel.height);
      for (const other of plates) expect(overlaps(b, other), `${count} teams: ${n} overlaps another nameplate`).toBe(false);
      plates.push(b);
    }
  }
  for (const [i, n] of names.entries()) {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto(`/room/${code}/play?name=${encodeURIComponent(n)}`);
    await expect(phone.getByTestId("roster")).toContainText(n);
    if (i === 3) await checkPlates(4);
  }
  await checkPlates(8);
});
