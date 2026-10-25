import { test, expect } from "@playwright/test";
import { restoreRoom0AfterEach } from "./answer";
import { E2E_OWNER_KEY } from "../playwright.config";

restoreRoom0AfterEach();

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

  // Phone answering (docs/designs/phone-answering.md): the host no longer judges an MC turn.
  await expect(host.getByRole("button", { name: "答對！" })).toHaveCount(0);
  await expect(host.getByTestId("host-mc-status")).toContainText("等選擇隊鎖定答案");
});

test("phone answering: a wrong lock is marked without the answer, 重答 greys it out, a right lock lights up everywhere", async ({ browser, request }) => {
  await seedSingleMcQuestion(request);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const team = await (await browser.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("選擇隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();

  const lockButton = team.getByRole("button", { name: "鎖定答案" });
  await expect(lockButton).toBeDisabled();
  await team.getByRole("button", { name: "藍色" }).click();
  await lockButton.click();
  // The beat: everyone sees the lock, nobody sees the result yet.
  // (The beat lasts 2 s, so these run back to back.)
  await expect(team.getByText("已鎖定！看大螢幕揭曉")).toBeVisible();
  await expect(host.getByTestId("host-mc-status")).toContainText("選擇隊鎖定了 C");
  await expect(screen.getByTestId("wall-option-2")).toHaveAttribute("data-look", "lock");
  await expect(screen.getByText("選擇隊鎖定了 C……")).toBeVisible();

  // Wrong: only the pick turns red on the TV; the answer stays hidden.
  await expect(screen.getByTestId("wall-option-2")).toHaveAttribute("data-look", "bad");
  await expect(screen.getByTestId("wall-option-1")).toHaveAttribute("data-look", "plain");
  await expect(team.getByText("答錯了！要怎麼辦？")).toBeVisible();
  await team.getByRole("button", { name: /重答/ }).click();

  // Retry turn (the only team, so it is up again): 藍色 is greyed and cannot be picked.
  await expect(team.getByRole("button", { name: /藍色/ })).toBeDisabled();
  await expect(screen.getByTestId("wall-option-2")).toHaveAttribute("data-look", "dim");
  await team.getByRole("button", { name: "綠色" }).click();
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await expect(screen.getByTestId("wall-option-1")).toHaveAttribute("data-look", "ok");
  await expect(team.getByText(/答對了！＋1 分/)).toBeVisible();
  await expect(host.getByTestId("host-reveal")).toContainText("綠色");
});
