import { test, expect } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// The shared bank lives on the dev server across every e2e spec file, not just this one's tests
// — main-line.spec.ts (and others) deal real questions from room 0 assuming it's the bundled
// bank's original content. Capture it once and restore it after each test in this file, so an
// image-content fixture doesn't permanently overwrite room 0 for every later spec (this
// wasn't visible under the old schema, where a bare `text` field always existed regardless of
// kind — it becomes a real cross-file pollution risk once content can leave "text" entirely).
let originalRoom0Questions: unknown;
test.beforeEach(async ({ request }) => {
  const loaded = await request.get(`${WORKER}/api/bank`, { headers: HEADERS });
  originalRoom0Questions = (await loaded.json()).bank.pools["1"];
});
test.afterEach(async ({ request }) => {
  const loaded = await request.get(`${WORKER}/api/bank`, { headers: HEADERS });
  const { bank, version } = await loaded.json();
  bank.pools["1"] = originalRoom0Questions;
  await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
});

/** Uploads a real image through the actual /api/bank/image endpoint, then seeds room 0 with a
 * single, known image-content question referencing it — same "replace all of room 0" determinism
 * trick as e2e/multiple-choice.spec.ts's seedSingleMcQuestion. Under D1 (content REPLACES the old
 * fixed text prompt, docs/designs/question-media-content.md), an image-content question has no
 * separate question text — the image itself is the question. */
async function seedSingleImageQuestion(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const uploaded = await request.post(`${WORKER}/api/bank/image`, {
    headers: { ...headers, "Content-Type": "image/png" },
    data: TINY_PNG,
  });
  expect(uploaded.ok()).toBe(true);
  const { key } = await uploaded.json();

  const loaded = await request.get(`${WORKER}/api/bank`, { headers });
  const { bank, version } = await loaded.json();
  bank.pools["1"] = [{ kind: "text", id: "r0-img-e2e", content: { kind: "image", value: key }, answer: "松鼠" }];
  const saved = await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  expect(saved.ok()).toBe(true);
  return key as string;
}

test("image-content question: renders on /play, /screen, and the host's own preview, and the host can still judge", async ({ browser, request }) => {
  const key = await seedSingleImageQuestion(request);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("圖片隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  // The <img> renders on all three surfaces with the URL the server built (base + key) —
  // /play, /screen, and now the host's own small preview (added so judging an image question
  // doesn't mean squinting at the big screen from across the room, /plan-eng-review complexity
  // gate). Whether that URL is actually reachable depends on the R2 bucket's public-access
  // setting, a deploy-time step this test environment doesn't have (wrangler.jsonc's
  // R2_PUBLIC_BASE_URL is a placeholder locally) — that reachability is out of scope here; this
  // only proves the app builds and renders the right URL and doesn't crash regardless of
  // whether the image loads.
  const hostImg = host.getByAltText("題目圖片");
  await expect(hostImg).toHaveAttribute("src", new RegExp(`/${key}$`));
  const teamImg = team.getByAltText("題目圖片");
  await expect(teamImg).toHaveAttribute("src", new RegExp(`/${key}$`));
  const screenImg = screen.getByAltText("題目圖片");
  await expect(screenImg).toHaveAttribute("src", new RegExp(`/${key}$`));

  // The host still judges independently of the image — nothing about it blocks HOST_JUDGE.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到")).toBeVisible();
});

test("image-content question: a broken image URL hides itself on every surface, but judging still works", async ({ browser, request }) => {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get(`${WORKER}/api/bank`, { headers });
  const { bank, version } = await loaded.json();
  // A key that was never uploaded — the R2 object genuinely doesn't exist, a real 404. Still
  // UUID-shaped so parseBank's content-validation format check (adversarial review finding,
  // carried forward from the retired `image` kind) accepts it.
  bank.pools["1"] = [
    { kind: "text", id: "r0-img-broken", content: { kind: "image", value: "66666666-6666-6666-6666-666666666666" }, answer: "無所謂" },
  ];
  const saved = await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  expect(saved.ok()).toBe(true);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("壞圖隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  // The broken-image fallback hides only the image, on every surface that renders it (host's
  // own preview included) — never a blank or crashed question.
  await expect(host.getByAltText("題目圖片")).toBeHidden();
  await expect(screen.getByAltText("題目圖片")).toBeHidden();
  await expect(team.getByAltText("題目圖片")).toBeHidden();

  // Judging is entirely unaffected by the broken image.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到")).toBeVisible();
});

test("youtube-content question: renders an iframe with the embed URL on /play, /screen, and the host's own preview", async ({ browser, request }) => {
  // A real, well-known 11-char video id — no network fetch of the actual video happens in this
  // test, only the iframe's src attribute is checked (test-coverage audit finding, /ship: the
  // youtube content.kind branch had zero test coverage anywhere in the diff).
  const videoId = "dQw4w9WgXcQ";
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get(`${WORKER}/api/bank`, { headers });
  const { bank, version } = await loaded.json();
  bank.pools["1"] = [{ kind: "text", id: "r0-yt-e2e", content: { kind: "youtube", value: videoId }, answer: "彩蛋" }];
  const saved = await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  expect(saved.ok()).toBe(true);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("影片隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  const embedSrc = new RegExp(`youtube-nocookie\\.com/embed/${videoId}$`);
  // The host gets a label, not a too-small embed (YouTube's player needs ~200px).
  await expect(host.getByText("影片題（看大螢幕）")).toBeVisible();
  await expect(host.getByTitle("題目影片")).toHaveCount(0);
  await expect(team.getByTitle("題目影片")).toHaveAttribute("src", embedSrc);
  await expect(screen.getByTitle("題目影片")).toHaveAttribute("src", embedSrc);

  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到")).toBeVisible();
});

/** Seeds room 0 with one text question carrying the given explanation, starts a 1-team game,
 * and returns the three surfaces with the team's turn already up. */
async function startWithExplanation(browser: import("@playwright/test").Browser, request: import("@playwright/test").APIRequestContext, explanation: unknown) {
  const loaded = await request.get(`${WORKER}/api/bank`, { headers: HEADERS });
  const { bank, version } = await loaded.json();
  bank.pools["1"] = [{ kind: "text", id: "r0-reveal-e2e", content: { kind: "text", value: "揭曉測試題" }, answer: "揭曉答案", explanation }];
  const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  expect(saved.ok()).toBe(true);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("揭曉隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  return { host, screen, team };
}

test("answer reveal: a correct answer shows the answer and its text explanation on /play and /screen in place of the question, until the host presses 下一題", async ({ browser, request }) => {
  const { host, screen, team } = await startWithExplanation(browser, request, { kind: "text", value: "因為這是補充說明" });

  // Nothing is revealed before the answer is judged.
  await expect(screen.getByText("正解：揭曉答案")).toHaveCount(0);
  await expect(screen.getByText("因為這是補充說明")).toHaveCount(0);

  await host.getByRole("button", { name: "答對！" }).click();
  for (const page of [screen, team]) {
    await expect(page.getByText("正解：揭曉答案")).toBeVisible();
    await expect(page.getByText("因為這是補充說明")).toBeVisible();
  }

  // The reveal takes the question's place (D7): the next question stays hidden and the host can't
  // judge until they press 下一題.
  await expect(screen.getByText("揭曉測試題")).toHaveCount(0);
  await expect(host.getByRole("button", { name: "答對！" })).toHaveCount(0);

  // A reconnecting phone still sees it — the reveal rides on STATE, not a one-off message.
  await team.reload();
  await expect(team.getByText("正解：揭曉答案")).toBeVisible();

  await host.getByRole("button", { name: "下一題", exact: true }).click();
  for (const page of [screen, team]) {
    await expect(page.getByText("正解：揭曉答案")).toHaveCount(0);
    await expect(page.getByText("因為這是補充說明")).toHaveCount(0);
  }
  // The next question is dealt: room 1 of the bundled bank is multipleChoice, so the host sees the lock status.
  await expect(host.getByTestId("host-mc-status")).toBeVisible();
});

test("answer reveal: a YouTube explanation renders as an embed on /play and /screen, only after a correct answer", async ({ browser, request }) => {
  const { host, screen, team } = await startWithExplanation(browser, request, { kind: "youtube", value: "dQw4w9WgXcQ" });

  // A wrong answer (retry) never reveals it (D5).
  await host.getByRole("button", { name: "答錯・重答" }).click();
  await expect(screen.getByTitle("詳解影片")).toHaveCount(0);
  await expect(team.getByTitle("詳解影片")).toHaveCount(0);

  await host.getByRole("button", { name: "答對！" }).click();
  const embedSrc = /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ$/;
  await expect(screen.getByTitle("詳解影片")).toHaveAttribute("src", embedSrc);
  await expect(team.getByTitle("詳解影片")).toHaveAttribute("src", embedSrc);
});

/** Seeds room 0 with host-judged questions, starts a 2-team game, and returns the host and both
 * phones: 甲隊 joins first, so it is up first. Pass one question per team: deal() never hands a
 * team a question another team holds. */
async function startTwoTeams(browser: import("@playwright/test").Browser, request: import("@playwright/test").APIRequestContext, questions: unknown[]) {
  const loaded = await request.get(`${WORKER}/api/bank`, { headers: HEADERS });
  const { bank, version } = await loaded.json();
  bank.pools["1"] = questions;
  const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  expect(saved.ok()).toBe(true);

  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const phones = [];
  for (const name of ["甲隊", "乙隊"]) {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(phone.getByText("等待主持人開始遊戲")).toBeVisible();
    phones.push(phone);
  }
  await expect(host.getByText("乙隊")).toBeVisible();
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(phones[0].getByText("輪到我們了！")).toBeVisible();
  return { host, a: phones[0], b: phones[1] };
}

// Value: protects=on our own turn the picture sits right under the ribbon, before our team card; fails_when=the media slot or the cards stop swapping sides with the turn; why_new=no spec compares media and card positions; seam=none; no_claim=node reuse (each turn shows another question id, so QuestionMedia's key remounts it anyway)
test("media question: on our own turn the picture comes before our team card, and after it while waiting", async ({ browser, request }) => {
  const uploaded = await request.post(`${WORKER}/api/bank/image`, { headers: { ...HEADERS, "Content-Type": "image/png" }, data: TINY_PNG });
  const { key } = await uploaded.json();
  const image = (id: string) => ({ kind: "text", id, content: { kind: "image", value: key }, answer: "松鼠" });
  const { host, a, b } = await startTwoTeams(browser, request, [image("r0-img-slot-1"), image("r0-img-slot-2")]);

  // NaN (fails every compare, so the poll retries) while the node has no layout box, e.g. detached mid-remount.
  const top = (loc: import("@playwright/test").Locator) => loc.evaluate((el) => (el.getClientRects().length ? el.getBoundingClientRect().top : NaN));
  const img = (page: import("@playwright/test").Page) => page.getByAltText("題目圖片");
  const card = (page: import("@playwright/test").Page, name: string) => page.getByText(name, { exact: true });
  // Polled: the turn change remounts the picture, and a measure taken mid-swap reads top 0 (main CI, 2026-10-29).
  const gap = (page: import("@playwright/test").Page, name: string) => async () => (await top(img(page))) - (await top(card(page, name)));
  await expect(img(a)).toBeAttached();
  await expect(img(b)).toBeAttached();
  await expect(a.getByRole("heading")).toHaveCount(0); // a picture question has no text strip
  await expect.poll(gap(a, "甲隊")).toBeLessThan(0);
  await expect.poll(gap(b, "乙隊")).toBeGreaterThan(0);

  await host.getByRole("button", { name: "答錯・重答" }).click();
  await expect(b.getByText("輪到我們了！")).toBeVisible();
  await expect(a.getByText("輪到：乙隊")).toBeVisible();
  await expect.poll(gap(a, "甲隊")).toBeGreaterThan(0);
  await expect.poll(gap(b, "乙隊")).toBeLessThan(0);
});

// Value: protects=a host-judged text turn shows the question only on the answering phone, and only before the reveal (eng review R2); fails_when=the strip shows on a waiting phone or stays on the reveal; why_new=host-judged turns had no question on the phone; seam=none; no_claim=multiple choice (multiple-choice.spec.ts)
test("host-judged text question: only the answering phone shows it, and it moves with the turn", async ({ browser, request }) => {
  const spoken = (n: number) => ({ kind: "text", id: `r0-host-text-${n}`, content: { kind: "text", value: `口答測試題${n}` }, answer: "口答答案" });
  const { host, a, b } = await startTwoTeams(browser, request, [spoken(1), spoken(2)]);

  const question = (page: import("@playwright/test").Page) => page.getByRole("heading", { name: /口答測試題/ });
  await expect(question(a)).toBeVisible();
  await expect(question(b)).toHaveCount(0);

  await host.getByRole("button", { name: "答錯・重答" }).click();
  await expect(question(b)).toBeVisible();
  await expect(question(a)).toHaveCount(0);

  await host.getByRole("button", { name: "答對！" }).click();
  await expect(b.getByText("正解：口答答案")).toBeVisible();
  await expect(question(b)).toHaveCount(0);
});

// Value: protects=a picture multipleChoice turn shows no text strip and still names its option group 選項; fails_when=the strip renders the image key or the group loses its name; why_new=no spec seeds a picture multipleChoice; seam=none; no_claim=YouTube content
test("picture multipleChoice: no question strip, and the options sit in a group named 選項", async ({ browser, request }) => {
  const uploaded = await request.post(`${WORKER}/api/bank/image`, { headers: { ...HEADERS, "Content-Type": "image/png" }, data: TINY_PNG });
  const { key } = await uploaded.json();
  const mc = (id: string) => ({ kind: "multipleChoice", id, content: { kind: "image", value: key }, options: ["松鼠", "刺蝟"], correctIndex: 0 });
  const { a } = await startTwoTeams(browser, request, [mc("r0-img-mc-1"), mc("r0-img-mc-2")]);

  await expect(a.getByAltText("題目圖片")).toBeAttached();
  await expect(a.getByRole("heading")).toHaveCount(0);
  const group = a.getByRole("group", { name: "選項" });
  await expect(group.getByRole("button", { name: /松鼠/ })).toBeVisible();
  await expect(group.getByRole("button", { name: /刺蝟/ })).toBeVisible();
});
