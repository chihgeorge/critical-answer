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
  bank.pools["1"] = [
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

  // Before any tap, the host sees no highlighted pick. Each game shuffles the options, so a host
  // row is found by its text, not its index.
  const hostOption = (text: string) => host.locator('[data-testid^="host-option-"]', { hasText: text });
  await expect(host.getByText("← 隊伍目前選的")).toHaveCount(0);

  await team.getByRole("button", { name: "紅色" }).click();
  await expect(hostOption("紅色")).toContainText("← 隊伍目前選的");

  // Re-selectable: tapping a different option before judgment moves the host's highlight, not
  // adds a second one — this is a "change your mind" interaction, not a one-time commit.
  await team.getByRole("button", { name: "藍色" }).click();
  await expect(hostOption("藍色")).toContainText("← 隊伍目前選的");
  await expect(host.getByText("← 隊伍目前選的")).toHaveCount(1);
  await expect(hostOption("紅色")).not.toContainText("← 隊伍目前選的");

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
  // Each game shuffles the options: read where 藍色 and 綠色 landed on the TV.
  await expect(screen.getByTestId("wall-option-2")).toBeVisible();
  const shown = await screen.locator('[data-testid^="wall-option-"]').allTextContents();
  const at = (text: string) => shown.findIndex((t) => t.includes(text));
  const blue = at("藍色"), green = at("綠色");
  const wall = (i: number) => screen.getByTestId(`wall-option-${i}`);
  await team.getByRole("button", { name: "藍色" }).click();
  await lockButton.click();
  // The beat: everyone sees the lock, nobody sees the result yet.
  // (The beat lasts 2 s, so these run back to back.)
  await expect(team.getByText("已鎖定！看大螢幕揭曉")).toBeVisible();
  await expect(host.getByTestId("host-mc-status")).toContainText(`選擇隊鎖定了 ${"ABC"[blue]}`);
  await expect(wall(blue)).toHaveAttribute("data-look", "lock");
  await expect(screen.getByText(`選擇隊鎖定了 ${"ABC"[blue]}……`)).toBeVisible();

  // Wrong: only the pick turns red on the TV; the answer stays hidden.
  await expect(wall(blue)).toHaveAttribute("data-look", "bad");
  await expect(wall(green)).toHaveAttribute("data-look", "plain");
  await expect(team.getByText("答錯了！要怎麼辦？")).toBeVisible();
  // D2: the options and the 重答/逃跑 row fit 375x667 without scrolling (the cards below may run under the fold).
  // Measured from the top of the page, since the earlier 鎖定答案 click may have scrolled it.
  const fleeBottom = await team.getByRole("button", { name: /逃跑/ }).evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
  expect(fleeBottom).toBeLessThanOrEqual(667);
  await team.getByRole("button", { name: /重答/ }).click();

  // Retry turn (the only team, so it is up again): 藍色 is greyed and cannot be picked.
  await expect(team.getByRole("button", { name: /藍色/ })).toBeDisabled();
  await expect(wall(blue)).toHaveAttribute("data-look", "dim");
  await team.getByRole("button", { name: "綠色" }).click();
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await expect(wall(green)).toHaveAttribute("data-look", "ok");
  await expect(team.getByText(/答對了！＋10 分/)).toBeVisible();
  await expect(host.getByTestId("host-reveal")).toContainText("綠色");
});

// Value: protects=after 15 s with no lock the host gets 替…選・逃跑 and it moves the stuck team on; fails_when=the stuck timer, its key or the rescue button breaks, leaving the host no way past an MC turn; why_new=no spec waits out STUCK_MS; seam=none; no_claim=重答 rescue and keys 2/3 (host clock faked; server timers real)
test("phone answering: a team that never locks gets the host's stuck row after 15 s, and 逃跑 moves it on", async ({ browser, request }) => {
  await seedSingleMcQuestion(request);

  const host = await (await browser.newContext()).newPage();
  await host.clock.install();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("選擇隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByTestId("host-mc-status")).toContainText("等選擇隊鎖定答案");

  const stuckRow = host.getByText("選擇隊好像卡住了");
  await host.clock.fastForward(14_000);
  await expect(stuckRow).toHaveCount(0);
  await host.clock.fastForward(1_500);
  await expect(stuckRow).toBeVisible();
  await host.getByRole("button", { name: /替選擇隊選・逃跑/ }).click();
  // The flee is a judgment (new eventId), so the row resets and waits another 15 s.
  await expect(stuckRow).toHaveCount(0);
  await expect(host.getByTestId("host-mc-status")).toContainText("等選擇隊鎖定答案");
  await expect(team.getByText("輪到我們了！")).toBeVisible();
});

/** Starts a game with one team on a 375x667 phone; returns the pages. */
async function startOneTeam(browser: import("@playwright/test").Browser, beforeJoin?: (team: import("@playwright/test").Page) => Promise<void>) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const team = await (await browser.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  await beforeJoin?.(team);
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("選擇隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  return { host, team };
}

// Value: protects=the phone's 逃跑 after a wrong lock sends flee and the team gets the other question; fails_when=the button sends retry or nothing; why_new=the other journey only presses 重答; seam=none; no_claim=which question is dealt first
test("phone answering: 逃跑 after a wrong lock moves the team to the other question", async ({ browser, request }) => {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
  bank.pools["1"] = [
    { kind: "multipleChoice", id: "r0-mc-e2e-a", text: "門是什麼顏色？", options: ["紅門", "綠門"], correctIndex: 1 },
    { kind: "multipleChoice", id: "r0-mc-e2e-b", text: "鑰匙是什麼形狀？", options: ["圓鑰", "方鑰"], correctIndex: 1 },
  ];
  expect((await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } })).ok()).toBe(true);

  const { team } = await startOneTeam(browser);
  const onDoor = await team.getByRole("button", { name: "紅門" }).isVisible();
  await team.getByRole("button", { name: onDoor ? "紅門" : "圓鑰" }).click(); // the wrong option of whichever was dealt
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await expect(team.getByText("答錯了！要怎麼辦？")).toBeVisible();
  await team.getByRole("button", { name: /逃跑/ }).click();
  await expect(team.getByText("答錯了！要怎麼辦？")).toHaveCount(0);
  await expect(team.getByRole("button", { name: onDoor ? "圓鑰" : "紅門" })).toBeVisible();
});

// Value: protects=a lock the room never confirms un-freezes the phone after 3 s with 沒送出，再按一次; fails_when=inFlight never clears and the team is stuck on 鎖定中…; why_new=no test drops the lock message; seam=routeWebSocket drops TEAM_LOCK_OPTION; no_claim=real network loss
test("phone answering: a lock the room never answers shows 沒送出，再按一次 after 3 s", async ({ browser, request }) => {
  await seedSingleMcQuestion(request);
  const { team } = await startOneTeam(browser, (page) =>
    page.routeWebSocket(/localhost:1996/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        if (typeof m === "string" && m.includes('"TEAM_LOCK_OPTION"')) return; // lost on the way
        server.send(m);
      });
    }),
  );
  await team.getByRole("button", { name: "藍色" }).click();
  await team.getByRole("button", { name: "鎖定答案" }).click();
  await expect(team.getByText("鎖定中…")).toBeVisible();
  await expect(team.getByText("沒送出，再按一次")).toBeVisible({ timeout: 5_000 });
  await expect(team.getByRole("button", { name: "鎖定答案" })).toBeEnabled();
});

// Value: protects=a wrong boss lock shows no 重答/逃跑 and rotates the shared question on its own (boss rules D1/D2);
// fails_when=the boss-miss timer, the phone/host/TV boss wording or the rotation breaks; why_new=no spec covers a boss lock;
// seam=room timer (real); no_claim=restart mid-beat (lib/room/lifecycle.test.ts)
test("boss room: a wrong lock shows no choice, then the boss brings a new question", async ({ browser, request }) => {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers })).json();
  bank.boss.questions = [
    { kind: "multipleChoice", id: "boss-e2e-1", text: "深淵小黑龍最怕什麼？", options: ["火焰", "冰霜", "雷電", "陽光"], correctIndex: 1 },
    { kind: "multipleChoice", id: "boss-e2e-2", text: "首領房在地城的第幾層？", options: ["第一層", "第三層", "第五層", "第八層"], correctIndex: 3 },
  ];
  expect((await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } })).ok()).toBe(true);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const team = await (await browser.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("紅隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  await host.getByRole("button", { name: /更多/ }).click();
  await host.getByRole("button", { name: "送王房" }).click();
  await host.getByRole("button", { name: "確定送？" }).click();
  await host.getByRole("button", { name: "關閉" }).click();

  // Which boss question comes first depends on the room's rng: lock a wrong option of whichever is up.
  await expect(team.getByRole("button", { name: /火焰|第一層/ })).toBeVisible();
  const first = (await team.getByRole("button", { name: "火焰" }).count()) ? { wrong: "火焰", next: "第一層" } : { wrong: "第一層", next: "火焰" };
  await team.getByRole("button", { name: first.wrong }).click();
  await team.getByRole("button", { name: "鎖定答案" }).click();

  // The beat after the reveal: the red tile shows, nothing to pick.
  await expect(screen.locator('[data-look="bad"]')).toBeVisible();
  await expect(team.getByText("首領要換題了")).toBeVisible();
  await expect(team.getByRole("button", { name: /逃跑/ })).toHaveCount(0);
  await expect(host.getByTestId("host-mc-status")).toContainText("答錯！首領換一題");
  await expect(screen.getByText("紅隊答錯了！首領換一題……")).toBeVisible();

  // Then the room rotates on its own: the other boss question, with no greyed option.
  await expect(team.getByRole("button", { name: first.next })).toBeEnabled();
  await expect(team.getByRole("button", { name: first.wrong })).toHaveCount(0);
});
