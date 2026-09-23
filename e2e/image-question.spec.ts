import { test, expect } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

const WORKER = "http://localhost:1996";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/** Uploads a real image through the actual /api/bank/image endpoint, then seeds room 0 with a
 * single, known image question referencing it — same "replace all of room 0" determinism trick
 * as e2e/multiple-choice.spec.ts's seedSingleMcQuestion. */
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
  bank.rooms[0].questions = [{ kind: "image", id: "r0-img-e2e", text: "這是誰？", answer: "松鼠", imageKey: key }];
  const saved = await request.put(`${WORKER}/api/bank`, { headers, data: { bank, version } });
  expect(saved.ok()).toBe(true);
  return key as string;
}

test("image question: renders on both /play and /screen, and the host can still judge", async ({ browser, request }) => {
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

  // The <img> renders on both surfaces with the URL the server built (base + key). /screen
  // carries the question text and image; /play never shows question text at all (only the
  // host reads it aloud), so /play is checked for the image only. Whether that URL is actually
  // reachable depends on the R2 bucket's public-access setting, a deploy-time step this test
  // environment doesn't have (wrangler.jsonc's R2_PUBLIC_BASE_URL is a placeholder locally) —
  // that reachability is out of scope here; this only proves the app builds and renders the
  // right URL and doesn't crash regardless of whether the image loads.
  await expect(host.getByTestId("host-question")).toContainText("這是誰？");
  const teamImg = team.getByAltText("題目圖片");
  await expect(teamImg).toHaveAttribute("src", new RegExp(`/${key}$`));
  const screenImg = screen.getByAltText("題目圖片");
  await expect(screen.getByText("這是誰？")).toBeVisible();
  await expect(screenImg).toHaveAttribute("src", new RegExp(`/${key}$`));

  // The host still judges independently of the image — nothing about it blocks HOST_JUDGE.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到")).toBeVisible();
});

test("image question: a broken image URL hides itself, but the question text and judging still work", async ({ browser, request }) => {
  const headers = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
  const loaded = await request.get(`${WORKER}/api/bank`, { headers });
  const { bank, version } = await loaded.json();
  // A key that was never uploaded — the R2 object genuinely doesn't exist, a real 404. Still
  // UUID-shaped so parseBank's imageKey format check (adversarial review finding) accepts it.
  bank.rooms[0].questions = [
    { kind: "image", id: "r0-img-broken", text: "壞掉的圖片題", answer: "無所謂", imageKey: "66666666-6666-6666-6666-666666666666" },
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

  // The question text still renders on both the host and the big screen even though its
  // image 404s — the broken-image fallback hides only the image, never the question.
  await expect(host.getByTestId("host-question")).toContainText("壞掉的圖片題");
  await expect(screen.getByText("壞掉的圖片題")).toBeVisible();
  await expect(screen.getByAltText("題目圖片")).toBeHidden();
  await expect(team.getByAltText("題目圖片")).toBeHidden();

  // Judging is entirely unaffected by the broken image.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到")).toBeVisible();
});
