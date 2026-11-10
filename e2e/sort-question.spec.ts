import { test, expect, type Page } from "@playwright/test";
import { restoreRoom0AfterEach, revealLock, startGame, screenUrl } from "./answer";
import { E2E_OWNER_KEY } from "../playwright.config";

restoreRoom0AfterEach();

const WORKER = "http://localhost:1996";
const RIGHT = ["甲", "乙", "丙", "丁"];

/** Room 0's pool holds only this sort question, so the team's first question is always it. */
async function seedSortQuestion(request: import("@playwright/test").APIRequestContext) {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
  bank.pools["1"] = [{ kind: "sort", id: "r0-sort-e2e", content: { kind: "text", value: "依天干排" }, items: RIGHT }];
  const saved = await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  expect(saved.ok()).toBe(true);
}

const rowTexts = async (team: Page) => (await team.locator('[data-testid^="sort-item-"] > span').allTextContents()).map((t) => t.trim());

/** Moves the phone's rows into `want` with the ☰ handles' arrow keys (a bubble sort, one place per key). */
async function sortWithKeys(team: Page, want: string[]) {
  for (let pass = 0; pass < want.length; pass++) {
    for (let i = 0; i < want.length - 1; i++) {
      const rows = await rowTexts(team);
      if (want.indexOf(rows[i]) > want.indexOf(rows[i + 1])) {
        await team.getByTestId(`sort-item-${i}`).getByRole("button").press("ArrowDown");
        await expect.poll(() => rowTexts(team)).not.toEqual(rows);
      }
    }
  }
  expect(await rowTexts(team)).toEqual(want);
}

// Value: protects=the sort question end to end: the phone's ☰ drags rows by pointer, a wrong lock marks each place
// on the phone and the TV without the answer, 重答 keeps the order, and the right order scores and reveals it;
// fails_when=the handle does not drag, the answer leaks on a wrong lock, or the right order is judged wrong;
// seam=none; no_claim=a real touch screen (Playwright's mouse sends the same pointer events)
test("sort question: drag to order, a wrong lock marks the places, the right order scores", async ({ browser, request }) => {
  await seedSortQuestion(request);
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(await screenUrl(host));
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("排序隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await startGame(host);

  await expect(team.getByTestId("sort-item-3")).toBeVisible();
  const shown = await rowTexts(team);
  // Never dealt in the answer's order.
  expect(shown).not.toEqual(RIGHT);
  await expect(host.getByTestId("host-answer")).toContainText("甲 → 乙 → 丙 → 丁");

  // A drag on the last row's ☰ to the top moves it there.
  const handle = team.getByTestId("sort-item-3").getByRole("button");
  const top = await team.getByTestId("sort-item-0").boundingBox();
  const from = await handle.boundingBox();
  await team.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await team.mouse.down();
  await team.mouse.move(from!.x + from!.width / 2, top!.y + 4, { steps: 8 });
  await team.mouse.up();
  expect(await rowTexts(team)).toEqual([shown[3], shown[0], shown[1], shown[2]]);

  // Wrong: first two right, last two swapped.
  await sortWithKeys(team, ["甲", "乙", "丁", "丙"]);
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await expect(host.getByTestId("host-mc-status")).toContainText("排序隊鎖定了 甲 → 乙 → 丁 → 丙");
  await revealLock(host);
  await expect(team.getByText("答錯了！要怎麼辦？")).toBeVisible();
  await expect(team.getByTestId("sort-item-0")).toContainText("✓");
  await expect(team.getByTestId("sort-item-2")).toContainText("✕");
  await expect(screen.getByTestId("wall-sort-1")).toHaveAttribute("data-look", "ok");
  await expect(screen.getByTestId("wall-sort-3")).toHaveAttribute("data-look", "bad");
  await expect(screen.getByText("甲 → 乙 → 丙 → 丁")).toHaveCount(0);

  // 重答 (the only team, so it is up again) keeps the order: fix the last two.
  await team.getByRole("button", { name: /下輪再答/ }).click();
  await expect(team.getByRole("button", { name: "這個順序答錯過了，換一下" })).toBeDisabled();
  await sortWithKeys(team, RIGHT);
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await revealLock(host);
  await expect(team.getByText(/答對了！＋1[05] 分/)).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByTestId("answer-reveal")).toContainText("正解：甲 → 乙 → 丙 → 丁");
  await expect(screen.getByTestId("wall-sort-0")).toHaveAttribute("data-look", "ok");
});
