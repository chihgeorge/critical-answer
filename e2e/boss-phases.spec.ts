import { test, expect, type APIRequestContext } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });

/** A two-phase boss (docs/designs/boss-phases.md): phase 1 has 1 HP over two questions, phase 2 has 1 HP. Text
 * questions, so the host judges by hand. The bank is put back after each test. */
let original: unknown;
test.beforeEach(async ({ request }) => {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  original = bank;
  const phased = {
    ...bank,
    boss: {
      ...bank.boss,
      phases: [
        { name: "", rule: "", maxHp: 1, questions: [text("phase1-a"), text("phase1-b")] },
        { name: "主題曲之謎", rule: "聽前奏，說出這首是哪部作品的主題曲", maxHp: 1, questions: [text("phase2-a")] },
      ],
    },
  };
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: phased, version } })).ok()).toBe(true);
});
test.afterEach(async ({ request }) => restore(request));

async function restore(request: APIRequestContext) {
  if (!original) return;
  const { version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: original, version } })).ok()).toBe(true);
  original = undefined;
}

// Value: protects=the surprise phase flow end to end on all three pages (reveal at 0 HP, card, phase 2, last-phase kill);
// fails_when=the card never opens or closes, a page shows phase 2 early, or phase 1's emptied bar ends the game;
// why_new=room tests cover messages, not the pages; seam=none; no_claim=multiple-choice auto-advance (lib/room/boss-phases.test.ts)
test("a two-phase boss: the answer at 0 HP, the surprise card, phase 2, then the kill", async ({ browser }) => {
  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();

  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByRole("button", { name: "送王房" }).click();
  await host.getByRole("button", { name: "確定送？" }).click();
  await host.getByRole("button", { name: "關閉" }).click();

  // Phase 1 looks like any boss; only the host sees there is more.
  await expect(screen.getByText("題目 phase1-a")).toBeVisible();
  await expect(screen.getByText("最後的挑戰！")).toBeVisible();
  await expect(host.getByTestId("host-boss-hp")).toContainText("第 1/2 階段・下一階段：主題曲之謎");
  await expect(team.getByText("主題曲之謎")).toHaveCount(0);

  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByTestId("answer-reveal")).toContainText("答案 phase1-a");
  await expect(screen.getByText(/奪得榜首/)).toHaveCount(0);
  await expect(screen.getByText("主題曲之謎")).toHaveCount(0);

  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByTestId("phase-card")).toContainText("第二階段：主題曲之謎");
  await expect(screen.getByTestId("phase-card")).toContainText("聽前奏，說出這首是哪部作品的主題曲");
  await expect(screen.getByText("還沒結束！")).toBeVisible();
  await expect(team.getByTestId("phone-phase-card")).toContainText("第二階段：主題曲之謎");
  await expect(host.getByTestId("host-reveal")).toHaveText("大螢幕正在揭曉：第二階段－主題曲之謎");
  await expect(screen.getByText("題目 phase2-a")).toHaveCount(0); // held back until 下一題

  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByText("題目 phase2-a")).toBeVisible();
  await expect(screen.getByTestId("phase-card")).toHaveCount(0);
  await expect(screen.getByText("主題曲之謎")).toBeVisible(); // the chip names the phase from now on
  await expect(team.getByTestId("phone-phase-rule")).toContainText("聽前奏");
  await expect(host.getByTestId("host-boss-hp")).toContainText("第 2/2 階段・最後階段");

  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByText(/奪得榜首/)).toBeVisible();
});

// Value: protects=a phase that runs out of questions moves on by itself and never repeats a phase-1 question in phase 2;
// fails_when=exhaustion stalls the fight or deals phase 1 again; why_new=the flow above clears phase 1 by HP; seam=none;
// no_claim=the multiple-choice miss path (lib/room/boss-phases.test.ts)
test("a phase that runs out of questions moves on to the next one", async ({ browser, request }) => {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  bank.boss.phases[0].maxHp = 5; // two questions can't empty it
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } })).ok()).toBe(true);

  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByRole("button", { name: "送王房" }).click();
  await host.getByRole("button", { name: "確定送？" }).click();
  await host.getByRole("button", { name: "關閉" }).click();

  for (const id of ["phase1-a", "phase1-b"]) {
    await expect(host.getByTestId("host-answer")).toHaveText(`答案 ${id}`);
    await host.getByRole("button", { name: "答對！" }).click();
    await host.getByRole("button", { name: "下一題", exact: true }).click();
  }
  await expect(team.getByTestId("phone-phase-card")).toContainText("主題曲之謎");
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(host.getByTestId("host-answer")).toHaveText("答案 phase2-a");
});
