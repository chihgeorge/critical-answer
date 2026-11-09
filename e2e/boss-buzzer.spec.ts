import { test, expect, type APIRequestContext } from "@playwright/test";
import { startGame } from "./answer";
import { E2E_OWNER_KEY } from "../playwright.config";

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
const text = (id: string) => ({ kind: "text", id, content: { kind: "text", value: `題目 ${id}` }, answer: `答案 ${id}` });
/** A music question with two answer fields (docs/designs/multi-field.md): it opens on the host's ▶. */
const music = (id: string) => ({
  kind: "text",
  id,
  content: { kind: "youtube", value: "dQw4w9WgXcQ", audioOnly: true },
  prompt: `題目 ${id}`,
  fields: [{ label: "歌名", answer: "晴天" }, { label: "歌手", answer: "周杰倫" }],
});

/** Phase 1 is one question with 1 HP; phase 2 is a buzzer phase (docs/designs/boss-buzzer.md) with 3 HP over two
 * text questions, which open for buzzing as soon as each shows, and a music question with answer fields, which opens on ▶.
 * The bank is put back after the test. */
let original: unknown;
test.beforeEach(async ({ request }) => {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  original = bank;
  const buzzer = {
    ...bank,
    boss: {
      ...bank.boss,
      phases: [
        { name: "", rule: "", maxHp: 1, questions: [text("buzz-p1")] },
        { name: "最終決戰", rule: "聽前奏搶答", maxHp: 3, buzzer: true, questions: [text("buzz-a"), text("buzz-b"), music("buzz-c")] },
      ],
    },
  };
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: buzzer, version } })).ok()).toBe(true);
});
test.afterEach(async ({ request }) => restore(request));

async function restore(request: APIRequestContext) {
  if (!original) return;
  const { version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: original, version } })).ok()).toBe(true);
  original = undefined;
}

// Value: protects=the buzzer phase end to end on all three pages (pull-in, first buzz wins, lockout, a right buzz hits,
// the host's skip); fails_when=a page never shows the buzz button or banner, the host has no judge or 下一題 with nobody
// on turn, or a shut-out phone can still buzz; why_new=room tests cover messages, not the pages; seam=none;
// no_claim=the ▶-gated video path and auto pause/resume (lib/room/boss-buzzer.test.ts)
test("a buzzer phase: everyone in, the first buzz answers, a wrong one is shut out, the host can skip", async ({ browser }) => {
  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const phones = [];
  for (const name of ["甲隊", "乙隊"]) {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(phone.getByTestId("roster")).toContainText(name);
    phones.push(phone);
  }
  const [a, b] = phones;
  await startGame(host);

  // Whoever rolled first, 甲隊 goes to the boss room and clears phase 1 on its turn.
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await host.getByRole("button", { name: "送王房" }).first().click(); // 甲隊 joined first
  await host.getByRole("button", { name: "確定送？" }).click();
  await host.getByRole("button", { name: "關閉" }).click();
  // On 乙隊's room turn, a miss passes the turn to 甲隊's boss question (a press under an older STATE is dropped).
  await expect(async () => {
    if ((await host.getByTestId("host-answer").textContent()) !== "答案 buzz-p1") await host.getByRole("button", { name: "答錯・重答" }).click();
    await expect(host.getByTestId("host-answer")).toHaveText("答案 buzz-p1", { timeout: 2_000 });
  }).toPass();
  await host.getByRole("button", { name: "答對！" }).click();
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByTestId("phase-card")).toContainText("最終決戰");
  await host.getByRole("button", { name: "下一題", exact: true }).click();

  // Both teams, 乙隊 too though it never reached the boss, get the buzz button.
  await expect(screen.getByText("題目 buzz-a")).toBeVisible();
  await expect(screen.getByTestId("screen-buzz")).toContainText("快搶");
  await b.getByRole("button", { name: "搶答！" }).click();
  await expect(screen.getByTestId("screen-buzz")).toContainText("乙隊 搶到了！");
  await expect(a.getByTestId("buzz")).toContainText("乙隊搶到了");
  await expect(b.getByTestId("buzz")).toContainText("你們搶到了！");
  // The team that buzzed may also type its answer for the host (boss-music-buzzer.md M2).
  await b.getByLabel("你們的答案").fill("我猜的");
  await b.getByRole("button", { name: "送出", exact: true }).click();
  await expect(host.getByTestId("host-typed-answer")).toContainText("我猜的");

  await host.getByRole("button", { name: "答錯（這題不能再搶）" }).click();
  await expect(b.getByTestId("buzz")).toContainText("這題答錯了");
  await expect(b.getByTestId("buzz").getByRole("button")).toBeDisabled();
  await a.getByRole("button", { name: "搶答！" }).click();
  await expect(host.getByTestId("host-buzz")).toContainText("甲隊 搶到了");
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByTestId("answer-reveal")).toContainText("答案 buzz-a");
  await host.getByRole("button", { name: "下一題", exact: true }).click();

  await expect(screen.getByText("題目 buzz-b")).toBeVisible();
  await host.getByRole("button", { name: "沒人答對，換下一題" }).click();
  await expect(screen.getByText("題目 buzz-c")).toBeVisible();

  // A music question with fields (multi-field.md): one box each, judged field by field, a partial answer still hits.
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await b.getByRole("button", { name: "搶答！" }).click();
  await b.getByLabel("歌名").fill("晴天");
  await b.getByRole("button", { name: "送出", exact: true }).click();
  await expect(b.getByTestId("typed-answer-sent")).toContainText("已送出");
  // Host only (E4): the other phone never sees the typed text.
  await expect(host.getByTestId("host-field-judge")).toContainText("晴天");
  await expect(a.getByText("晴天")).toHaveCount(0);
  await host.getByRole("button", { name: "歌名 答對" }).click();
  await host.getByRole("button", { name: "歌手 答錯" }).click();
  await host.getByRole("button", { name: "送出判定：對 1/2" }).click();
  await expect(screen.getByTestId("reveal-fields")).toContainText("歌名：晴天");
  await expect(screen.getByTestId("reveal-fields-partial")).toContainText("乙隊 對 1/2：打掉 1 格血");
});
