// The buzzer phase's next-question pick (#370, docs/designs/boss-music-buzzer.md M5) and a timing question
// (docs/designs/timing-tap.md) on all three pages. YouTube is blocked everywhere: no real video loads, and the big
// screen's player fails the way a blocked network does.
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startGame, screenUrl, closeLeftoverContexts, openMore } from "./answer";
import { E2E_OWNER_KEY } from "../playwright.config";

closeLeftoverContexts();

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
const VIDEO = "dQw4w9WgXcQ";
const text = (id: string, category?: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}`, ...(category ? { category } : {}) });

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

/** Phase 1 is one question with 1 HP; phase 2 is a buzzer phase with `questions` (boss-buzzer.spec.ts's shape). */
async function seedBuzzer(request: APIRequestContext, questions: object[]) {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  bank.boss = {
    ...bank.boss,
    phases: [
      { name: "", rule: "", maxHp: 1, questions: [text("pick-p1")] },
      { name: "最終決戰", rule: "聽前奏搶答", maxHp: 9, buzzer: true, questions },
    ],
  };
  const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  expect(saved.ok(), await saved.text()).toBe(true);
}

async function noYoutube(context: BrowserContext) {
  await context.route(/youtube(-nocookie)?\.com|ytimg\.com/, (r) => r.abort());
}

/** A host, a big screen and 甲隊/乙隊, with 甲隊 sent to the boss and phase 1 cleared: the buzzer phase's card is
 * up, and the returned pages wait for its 下一題 (boss-buzzer.spec.ts walks the same way in). */
async function intoBuzzerPhase(browser: Browser) {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await noYoutube(hostContext);
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screenContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await noYoutube(screenContext);
  const screen = await screenContext.newPage();
  await screen.goto(await screenUrl(host));
  const phones: Page[] = [];
  for (const name of ["甲隊", "乙隊"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await noYoutube(context);
    const phone = await context.newPage();
    await phone.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(phone.getByTestId("roster")).toContainText(name);
    phones.push(phone);
  }
  await startGame(host);
  await openMore(host, "other");
  await host.getByRole("button", { name: "送王房" }).first().click(); // 甲隊 joined first
  await host.getByRole("button", { name: "確定送？" }).click();
  await host.getByRole("button", { name: "關閉" }).click();
  await expect(async () => {
    if ((await host.getByTestId("host-answer").textContent()) !== "答案 pick-p1") await host.getByRole("button", { name: "答錯・下輪再答" }).click();
    await expect(host.getByTestId("host-answer")).toHaveText("答案 pick-p1", { timeout: 2_000 });
  }).toPass();
  await host.getByRole("button", { name: "答對！" }).click();
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByTestId("phase-card")).toContainText("最終決戰");
  return { host, screen, a: phones[0], b: phones[1] };
}

// Value: protects=#370's pick on every page: the winner's phone gets the categories, the screen names the pick, a
// video question shows the chip until ▶, the host's type button overrides, a text question waits hidden for the pick
// and the host's 下一步 serves it; fails_when=pick-category never shows or shows on the loser, the chips or the hold
// line are missing, or the host's buttons do not move the question; why_new=game-state tests cover the rules, nothing
// drove the pages; seam=none; no_claim=a dropped picker (dungeon-room unit tests)
test("buzzer pick (#370): the winner picks a category, the host overrides by type, and 下一步 ends a hold", async ({ browser, request }) => {
  await seedBuzzer(request, [
    text("pick-a", "動漫"),
    { kind: "text", id: "pick-b", content: { kind: "youtube", value: VIDEO, audioOnly: true }, prompt: "題目 pick-b", answer: "答案 pick-b", category: "電影" },
    text("pick-c", "動漫"),
    text("pick-d", "電影"),
  ]);
  const { host, screen, a, b } = await intoBuzzerPhase(browser);
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByText("題目 pick-a")).toBeVisible();
  // Nobody has won yet: no pick anywhere.
  await expect(a.getByTestId("pick-category")).toHaveCount(0);

  await a.getByRole("button", { name: "搶答！" }).click();
  await expect(host.getByTestId("host-buzz")).toContainText("甲隊 搶到了");
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByTestId("answer-reveal")).toContainText("答案 pick-a");

  // Under the reveal the winner, and only the winner, picks from the categories still unplayed, in bank order.
  const pick = a.getByTestId("pick-category");
  await expect(pick).toContainText("答對了！選下一題的類別");
  await expect(pick.getByRole("button")).toHaveText(["電影", "動漫"]);
  await expect(b.getByTestId("pick-category")).toHaveCount(0);
  await pick.getByRole("button", { name: "電影" }).click();
  await expect(pick.getByRole("button", { name: "電影" })).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByTestId("screen-next-category")).toHaveText("下一題：電影");

  // The picked video question waits for ▶: the screen names the category, the winner may still change it.
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByText("題目 pick-b")).toBeVisible();
  await expect(screen.getByTestId("screen-buzz-category")).toHaveText("下一題：電影");
  await expect(a.getByTestId("pick-category")).toContainText("已選：電影・主持人按 ▶ 前都能改");

  // The host's type button overrides the winner: 填空 deals the next fill-in, and the phone's pick is gone.
  const typePick = host.getByTestId("host-buzz-type");
  await expect(typePick).toContainText("甲隊 選的類別：電影");
  await typePick.getByRole("button", { name: "填空", exact: true }).click();
  await expect(screen.getByText("題目 pick-c")).toBeVisible();
  await expect(a.getByTestId("pick-category")).toHaveCount(0);

  // 乙隊 wins the next: after the reveal the next question stays hidden until it picks, or the host's 下一步.
  await b.getByRole("button", { name: "搶答！" }).click();
  await expect(host.getByTestId("host-buzz")).toContainText("乙隊 搶到了");
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByTestId("answer-reveal")).toContainText("答案 pick-c");
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByTestId("screen-pick-hold")).toHaveText("乙隊 正在選下一題的類別……");
  await expect(b.getByTestId("pick-category").getByRole("button")).toHaveText(["電影"]);
  await expect(host.getByTestId("host-buzz-type")).toContainText("乙隊 正在手機上選下一題的類別…");
  await expect(host.getByTestId("host-buzz")).toContainText("大螢幕還沒出這題");
  await host.getByTestId("host-buzz-next").click();
  await expect(screen.getByTestId("screen-pick-hold")).toHaveCount(0);
  await expect(screen.getByText(/題目 pick-[bd]/)).toBeVisible();
  await expect(b.getByTestId("pick-category")).toHaveCount(0);
});

// Value: protects=a timing question's round on the three pages before ▶, and the host's way out when the screen cannot
// play it; fails_when=the screen panel, the host's 卡點題 line or the phones' tap button are missing, the clip error
// never reaches the host, or 沒人答對 leaves the round up; why_new=no e2e dealt a timing question; seam=YouTube blocked;
// no_claim=taps and scoring with a running clock (lib/room timing unit tests)
test("timing question: the round waits for ▶ on every page, a clip the screen cannot play tells the host, and the host skips it", async ({ browser, request }) => {
  await seedBuzzer(request, [
    { kind: "timing", id: "tap-1", content: { kind: "youtube", value: VIDEO }, prompt: "卡點 tap-1", target: 5, label: "蹬" },
    text("tap-after"),
  ]);
  const { host, screen, a, b } = await intoBuzzerPhase(browser);
  await host.getByRole("button", { name: "下一題", exact: true }).click();

  const panel = screen.getByTestId("screen-timing");
  await expect(panel).toContainText("卡點 tap-1");
  await expect(panel).toContainText("等主持人按 ▶");
  await expect(panel).toContainText("每隊只能按一次");
  const hostTiming = host.getByTestId("host-timing");
  await expect(hostTiming).toContainText("卡點題・已按");
  await expect(hostTiming).toContainText("（按在「蹬」）");
  await expect(hostTiming).toContainText("按 ▶ 放歌就開始");
  for (const phone of [a, b]) {
    await expect(phone.getByTestId("tap")).toContainText("等音樂開始…");
    await expect(phone.getByTestId("tap").getByRole("button")).toBeDisabled();
    await expect(phone.getByRole("button", { name: "搶答！" })).toHaveCount(0);
  }
  // The blocked player reports its error: the host is told the round cannot be timed without the screen's song.
  await expect(host.getByTestId("host-clip-error")).toContainText("卡點題要大螢幕放歌才量得到時間");

  await host.getByRole("button", { name: "沒人答對，換下一題" }).click();
  await expect(panel).toHaveCount(0);
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByText("題目 tap-after")).toBeVisible();
});
