// 記憶題 (docs/designs/memory-questions.md) on the host, the big screen and the phone, and the bank editor's fields for
// memory and timing questions (docs/designs/timing-tap.md). YouTube is blocked and the R2 bucket is a page route, so
// nothing loads from outside.
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startGame, screenUrl, closeLeftoverContexts } from "./answer";
import { E2E_OWNER_KEY } from "../playwright.config";

closeLeftoverContexts();

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
const VIDEO = "dQw4w9WgXcQ";
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

let original: unknown;
test.beforeEach(async ({ request }) => {
  original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
});
test.afterEach(async ({ request }) => {
  if (!original) return;
  const { version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: original, version } })).ok()).toBe(true);
  original = undefined;
});

async function seed(request: APIRequestContext, change: (bank: { pools: Record<string, unknown[]>; boss: { phases: unknown[] } }) => void) {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  change(bank);
  const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  expect(saved.ok(), await saved.text()).toBe(true);
}

async function offline(context: BrowserContext) {
  await context.route(/youtube(-nocookie)?\.com|ytimg\.com/, (r) => r.abort());
  await context.route(/\.r2\.dev\//, (r) => r.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG }));
}

async function room(browser: Browser) {
  const hostContext = await browser.newContext();
  await offline(hostContext);
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screenContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await offline(screenContext);
  const screen = await screenContext.newPage();
  await screen.goto(await screenUrl(host));
  const teamContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await offline(teamContext);
  const team = await teamContext.newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("記憶隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  // A fill-in's check rolls itself first; the memorizing comes after it, with no answer box yet.
  await expect(team.getByTestId("play-memorize")).toBeVisible({ timeout: 8000 });
  return { host, screen, team };
}

/** While the media is up nobody sees the question, nor can answer. */
async function expectMemorizing(screen: Page, team: Page, prompt: string) {
  await expect(team.getByTestId("play-memorize")).toContainText("👀 看大螢幕，記住內容");
  await expect(team.getByTestId("play-memorize")).toContainText("題目等一下才出來，還不能作答");
  await expect(team.getByRole("textbox", { name: "你們的答案" })).toHaveCount(0);
  await expect(screen.getByText(prompt)).toHaveCount(0);
  await expect(team.getByText(prompt)).toHaveCount(0);
}

// Value: protects=a YouTube 記憶題 the big screen cannot play: every page hides the question, the host is told and
// ⏭ 直接出題 brings the question to all pages; fails_when=the prompt leaks while memorizing, host-memory-clip-error never
// shows, or ⏭ does not deal the question; why_new=no e2e dealt a memory question; seam=YouTube blocked;
// no_claim=a clip that plays to its end by itself
test("memory question (YouTube): hidden while it plays, a screen that cannot play it tells the host, ⏭ deals the question", async ({ browser, request }) => {
  const prompt = "剛剛影片裡有幾隻貓？";
  await seed(request, (bank) => {
    bank.pools["1"] = [{ kind: "text", id: "mem-yt", content: { kind: "youtube", value: VIDEO, end: 20 }, prompt, answer: "3", memory: true }];
  });
  const { host, screen, team } = await room(browser);

  await expect(screen.getByTestId("screen-memorize")).toContainText("記憶隊的記憶題：等主持人播放…");
  await expectMemorizing(screen, team, prompt);
  const panel = host.getByTestId("host-memorize");
  await expect(panel).toContainText("🧠 記憶題：大螢幕播完才出題（隊伍現在看不到題目）");
  await expect(host.getByTestId("host-memory-clip-error")).toContainText("大螢幕放不出來：現場放一次或講一下內容");

  await panel.getByRole("button", { name: "⏭ 直接出題" }).click();
  await expect(host.getByTestId("host-memorize")).toHaveCount(0);
  await expect(screen.getByTestId("screen-memorize")).toHaveCount(0);
  await expect(screen.getByText(prompt)).toBeVisible();
  await expect(team.getByText(prompt)).toBeVisible();
  await expect(team.getByRole("textbox", { name: "你們的答案" })).toBeVisible();
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByText("正解：3")).toBeVisible({ timeout: 10_000 });
});

// Value: protects=an image 記憶題 ends by itself after memorySeconds and the question then shows everywhere;
// fails_when=the image's timer never ends the memorizing or the prompt shows early; why_new=no e2e dealt a memory
// question; seam=routed bucket; no_claim=the countdown chip's exact seconds
test("memory question (image): shown for its seconds, then the question appears on every page by itself", async ({ browser, request }) => {
  const uploaded = await request.post(`${WORKER}/api/bank/image`, { headers: { ...HEADERS, "Content-Type": "image/png" }, data: TINY_PNG });
  expect(uploaded.ok()).toBe(true);
  const { key } = await uploaded.json();
  const prompt = "圖裡有幾隻松鼠？";
  await seed(request, (bank) => {
    bank.pools["1"] = [{ kind: "text", id: "mem-img", content: { kind: "image", value: key }, prompt, answer: "1", memory: true, memorySeconds: 12 }];
  });
  const { host, screen, team } = await room(browser);

  await expect(screen.getByTestId("screen-memorize")).toContainText("記住這張圖！");
  await expect(host.getByTestId("host-memorize")).toContainText("圖片時間到才出題");
  await expectMemorizing(screen, team, prompt);

  await expect(screen.getByText(prompt)).toBeVisible({ timeout: 20_000 });
  await expect(team.getByRole("textbox", { name: "你們的答案" })).toBeVisible();
  await expect(host.getByTestId("host-memorize")).toHaveCount(0);
  await expect(screen.getByTestId("screen-memorize")).toHaveCount(0);
});

// Value: protects=the bank editor's 記憶題 checkbox and a timing question's 目標秒數 / ±0.05 / label fields load from and
// save to the bank; fails_when=a field shows the wrong value, an edit is not saved, or unticking 記憶題 keeps memory;
// why_new=bank-editor.spec.ts never loads a memory or timing question; seam=none; no_claim=▶ 試聽 / 跟著按 (need YouTube)
test("bank editor: a memory question's checkbox and a timing question's target and label load and save", async ({ page, request }) => {
  await seed(request, (bank) => {
    bank.pools["1"] = [{ kind: "text", id: "mem-ed", content: { kind: "youtube", value: VIDEO, end: 20 }, prompt: "剛剛出現幾隻貓？", answer: "3", memory: true }, ...bank.pools["1"]];
    bank.boss.phases = [
      ...bank.boss.phases,
      { name: "卡點決戰", rule: "按在拍子上", maxHp: 3, buzzer: true, questions: [{ kind: "timing", id: "tap-ed", content: { kind: "youtube", value: VIDEO }, prompt: "卡點題", target: 12.5, label: "蹬" }] },
    ];
  });
  await page.route(/youtube(-nocookie)?\.com|ytimg\.com/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem("bank-editor-open-all", "1"));
  await page.goto("/bank-editor");
  await page.getByLabel("站長金鑰").fill(E2E_OWNER_KEY);
  await page.getByRole("button", { name: "載入題庫" }).click();

  const memory = page.getByTestId("memory-mem-ed");
  await expect(memory.getByRole("checkbox", { name: "🧠 記憶題（先看再出題）" })).toBeChecked();
  await expect(memory).toContainText("看的時候隱藏題幹和選項；播完，影片收起來才出題。");
  await memory.getByRole("checkbox", { name: "🧠 記憶題（先看再出題）" }).uncheck();

  await page.getByTestId("bank-tab-boss").click();
  const timing = page.getByTestId("timing-tap-ed");
  await expect(timing.getByLabel("目標秒數")).toHaveValue("12.5");
  await expect(timing.getByTestId("timing-target-text")).toHaveText("0:12.50");
  await expect(timing.getByLabel("卡點題 label")).toHaveValue("蹬");
  await timing.getByRole("button", { name: "+0.05" }).click();
  await expect(timing.getByLabel("目標秒數")).toHaveValue("12.55");
  await expect(timing.getByTestId("timing-target-text")).toHaveText("0:12.55");
  await timing.getByLabel("卡點題 label").fill("嘿");

  await page.getByRole("button", { name: "儲存全部變更" }).click();
  await expect(page.getByRole("button", { name: "儲存全部變更" })).toBeEnabled();
  await expect(page.getByTestId("bank-editor-error")).toHaveCount(0);
  // Polled: the button can read enabled before the save's request has started.
  const savedBank = async () => (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank;
  await expect.poll(async () => (await savedBank()).boss.phases.at(-1).questions[0]).toMatchObject({ kind: "timing", target: 12.55, label: "嘿" });
  expect((await savedBank()).pools["1"].find((q: { id: string }) => q.id === "mem-ed").memory).toBeUndefined();
});
