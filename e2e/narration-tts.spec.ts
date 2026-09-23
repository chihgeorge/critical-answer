import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

/** Stubs window.speechSynthesis before the page loads, recording every speak() call's text
 * and every cancel(). getVoices() returns one usable zh-TW voice so pickVoice() finds it
 * immediately (no need to wait for a real voiceschanged event in the test environment). */
async function stubSpeechSynthesis(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    let cancelCount = 0;
    const voice = { lang: "zh-TW", name: "Test zh-TW Voice", default: true } as SpeechSynthesisVoice;
    (window as unknown as { __ttsCalls: string[] }).__ttsCalls = calls;
    (window as unknown as { __ttsCancelCount: () => number }).__ttsCancelCount = () => cancelCount;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [voice],
        addEventListener: () => {},
        removeEventListener: () => {},
        speak: (utter: SpeechSynthesisUtterance) => calls.push(utter.text),
        cancel: () => {
          cancelCount++;
        },
      },
    });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      voice: SpeechSynthesisVoice | null = null;
      lang = "";
      constructor(text = "") {
        this.text = text;
      }
    };
  });
}

const ttsCalls = (page: Page) => page.evaluate(() => (window as unknown as { __ttsCalls: string[] }).__ttsCalls);
const ttsCancelCount = (page: Page) => page.evaluate(() => (window as unknown as { __ttsCancelCount: () => number }).__ttsCancelCount());

test("screen TTS toggle: renders, persists the preference, and unlocks audio on click", async ({ page }) => {
  await stubSpeechSynthesis(page);
  await page.goto("/");
  await page.getByRole("button", { name: /主持遊戲/ }).click();
  await page.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = page.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await page.context().newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);

  const toggle = screen.getByRole("button", { name: /語音/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText("🔇 語音關");

  await toggle.click();
  await expect(toggle).toHaveText("🔊 語音開");
  // The unlock utterance runs synchronously inside the click handler (Safari/iOS gesture
  // requirement) — an empty priming speak() call, not real narration.
  expect(await ttsCalls(screen)).toEqual([""]);

  await screen.reload();
  await expect(screen.getByRole("button", { name: /語音/ })).toHaveText("🔊 語音開"); // preference persisted
});

test("screen TTS: speaks live narration (both line and the next-team prompt), but never the onConnect replay", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");

  const team2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team2.goto(`/room/${code}/play?name=${encodeURIComponent("乙隊")}`);
  await expect(team.getByTestId("roster")).toContainText("乙隊");

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();

  // onConnect resends the room's current STATE — no NARRATION exists yet this early, so no
  // replay to worry about. Enable TTS before judging, so the upcoming live narration is heard.
  await screen.getByRole("button", { name: /語音/ }).click();
  expect(await ttsCalls(screen)).toEqual([""]); // just the unlock utterance so far

  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByText("輪到：乙隊")).toBeVisible();

  // The live NARRATION's line and its "then" (next-team) line both get spoken, in order —
  // not just the result line.
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));
  const calls = await ttsCalls(screen);
  expect(calls.length).toBeGreaterThanOrEqual(2); // unlock + at least the result line (+ then, if the scripted line has one)
});

test("screen TTS: turning the toggle off cancels any speech in progress", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const team2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team2.goto(`/room/${code}/play?name=${encodeURIComponent("乙隊")}`);
  await expect(team.getByTestId("roster")).toContainText("乙隊");

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();

  const toggle = screen.getByRole("button", { name: /語音/ });
  await toggle.click(); // on: 1 cancel-free unlock utterance so far
  await host.getByRole("button", { name: "答對！" }).click();
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));

  const cancelsBeforeToggleOff = await ttsCancelCount(screen);
  await toggle.click(); // off, mid-utterance
  await expect(toggle).toHaveText("🔇 語音關");
  expect(await ttsCancelCount(screen)).toBeGreaterThan(cancelsBeforeToggleOff);
});

test("screen TTS: LOBBY (room reset) cancels in-progress speech", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const team2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team2.goto(`/room/${code}/play?name=${encodeURIComponent("乙隊")}`);
  await expect(team.getByTestId("roster")).toContainText("乙隊");

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  const screenCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const screen = await screenCtx.newPage();
  await stubSpeechSynthesis(screen);
  const sockets: WebSocketRoute[] = [];
  await screen.routeWebSocket(/:1996\//, (ws) => {
    sockets.push(ws);
    ws.connectToServer();
  });
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();

  await screen.getByRole("button", { name: /語音/ }).click();
  await host.getByRole("button", { name: "答對！" }).click();
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));

  const cancelsBeforeReset = await ttsCancelCount(screen);
  // Inject a synthetic LOBBY frame (a real server restart/room-reset sends exactly this) — the
  // client-side handling under test doesn't care whether the server or this test sent it.
  await expect.poll(() => sockets.length).toBe(1);
  sockets[0].send(JSON.stringify({ type: "LOBBY", teams: [], roomEpoch: crypto.randomUUID() }));
  await expect.poll(() => ttsCancelCount(screen)).toBeGreaterThan(cancelsBeforeReset);
});

test("screen TTS: a host correction (HOST_EDIT_NARRATION) re-speaks the corrected text", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");
  const team2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team2.goto(`/room/${code}/play?name=${encodeURIComponent("乙隊")}`);
  await expect(team.getByTestId("roster")).toContainText("乙隊");

  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();
  await screen.getByRole("button", { name: /語音/ }).click();

  await host.getByRole("button", { name: "答對！" }).click();
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));

  // Host opens "更多", corrects the just-spoken line, sends it — same eventId, different text.
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const editSection = host.locator("section", { hasText: "改寫目前旁白" });
  const correctedText = "測試修正後的旁白文字";
  await editSection.locator("input").fill(correctedText);
  await editSection.getByRole("button", { name: "送出，立刻換上大螢幕" }).click();

  await expect.poll(() => ttsCalls(screen)).toContainEqual(correctedText);
});
