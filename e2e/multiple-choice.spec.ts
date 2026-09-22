import { test, expect } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

const WORKER = "http://localhost:1996";

/** Seeds room 0 with a single, known multipleChoice question via the bank API directly (not
 * through the editor UI — that flow is covered by e2e/bank-editor.spec.ts). Replacing ALL of
 * room 0's questions with just this one makes deal() deterministic: a team's first question is
 * always this one, no matter what rng the room construction actually used. */
async function seedSingleMcQuestion(request: import("@playwright/test").APIRequestContext) {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get(`${WORKER}/api/bank`, { headers });
  const { bank, version } = await loaded.json();
  bank.rooms[0].questions = [
    { kind: "multipleChoice", id: "r0-mc-e2e", text: "地城之門是什麼顏色？", options: ["紅色", "綠色", "藍色"], correctIndex: 1 },
  ];
  const saved = await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  expect(saved.ok()).toBe(true);
}

test("multipleChoice in play: the team taps an option, the host sees the pick highlighted before judging, and re-tapping changes it", async ({
  browser,
  request,
}) => {
  await seedSingleMcQuestion(request);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("選擇隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  // The seeded question's 3 options render as tappable buttons on the team's phone.
  await expect(team.getByRole("button", { name: "紅色" })).toBeVisible();
  await expect(team.getByRole("button", { name: "綠色" })).toBeVisible();
  await expect(team.getByRole("button", { name: "藍色" })).toBeVisible();

  // Before any tap, the host sees no highlighted pick. Options are seeded in order
  // [紅色, 綠色, 藍色] → host-option-0/1/2.
  await expect(host.getByText("← 隊伍目前選的")).toHaveCount(0);

  await team.getByRole("button", { name: "紅色" }).click();
  await expect(host.getByTestId("host-option-0")).toContainText("← 隊伍目前選的");

  // Re-selectable: tapping a different option before judgment moves the host's highlight, not
  // adds a second one — this is a "change your mind" interaction, not a one-time commit.
  await team.getByRole("button", { name: "藍色" }).click();
  await expect(host.getByTestId("host-option-2")).toContainText("← 隊伍目前選的");
  await expect(host.getByText("← 隊伍目前選的")).toHaveCount(1);
  await expect(host.getByTestId("host-option-0")).not.toContainText("← 隊伍目前選的");

  // The host still judges independently — a wrong pick can still be marked correct by the host,
  // since TEAM_SELECT_OPTION is a UI hint, never a self-score.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到")).toBeVisible();
});
