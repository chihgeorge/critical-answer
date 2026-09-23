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

/** Same stub, but getVoices() never returns a zh-TW/Hant candidate — pickVoice() finds
 * nothing, ttsVoice stays undefined forever, so speak() keeps no-oping for anything except
 * the toggle's own unlock utterance (which bypasses speak() and calls speechSynthesis.speak
 * directly — see toggleTts's comment in the page). Exercises the "voice unavailable" fallback. */
async function stubSpeechSynthesisNoMatchingVoice(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    let cancelCount = 0;
    (window as unknown as { __ttsCalls: string[] }).__ttsCalls = calls;
    (window as unknown as { __ttsCancelCount: () => number }).__ttsCancelCount = () => cancelCount;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ lang: "en-US", name: "Test en-US Voice", default: true } as SpeechSynthesisVoice],
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

/** Removes window.speechSynthesis entirely, as in a browser without the Web Speech API. */
async function stubNoSpeechSynthesisApi(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });
}

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

test("screen TTS: a correction to the exact narration replayed at connect is still spoken (adversarial review finding)", async ({ browser }) => {
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

  // Judge the question with NO /screen watching yet — the narration becomes the room's
  // lastNarration, sitting there for onConnect to replay to whoever connects next.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到：乙隊")).toBeVisible();

  // Now open /screen: onConnect replays that narration as this connection's baseline —
  // correctly not spoken (it's a replay, not a live event).
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：乙隊")).toBeVisible();
  await screen.getByRole("button", { name: /語音/ }).click();
  expect(await ttsCalls(screen)).toEqual([""]); // only the unlock utterance — the replay was NOT spoken

  // The host now corrects that exact (replayed, unspoken) line. It must still be spoken.
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const editSection = host.locator("section", { hasText: "改寫目前旁白" });
  const correctedText = "重播後修正的旁白文字";
  await editSection.locator("input").fill(correctedText);
  await editSection.getByRole("button", { name: "送出，立刻換上大螢幕" }).click();

  await expect.poll(() => ttsCalls(screen)).toContainEqual(correctedText);
});

test("screen TTS: a live GAME_OVER followed by the epilogue speaks the epilogue text (not just the podium narration)", async ({ browser }) => {
  test.setTimeout(60_000);
  const code = "EPI2"; // distinct from main-line.spec.ts's "EPIL" — same shared server
  const partyUrl = `ws://localhost:1996/parties/main/${code}`;
  const open = (u: string) => new Promise<WebSocket>((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);

  const host = await open(partyUrl);
  type Msg = { type: string; phase: string; eventId: number; view: { bossCurrentQuestionId: string; teams: { id: string; inBossPhase: boolean; currentQuestionId: string }[] } };
  const box: { state: Msg | null } = { state: null };
  const cur = () => box.state!;
  host.onmessage = (e) => { const m = JSON.parse(e.data as string) as Msg; if (m.type === "STATE") box.state = m; };
  host.send(JSON.stringify({ type: "HOST_CLAIM", token: "epilogue-tts-token-0123456789" }));
  const team = await open(partyUrl);
  team.send(JSON.stringify({ type: "JOIN", teamId: "00000000-0000-0000-0000-0000000000ee", teamKey: "epilogue-tts-team-key-0123456789", teamName: "語音終局隊" }));
  await expect(screen.getByText("語音終局隊")).toBeVisible();

  // Turn TTS on before anything is live, so the unlock utterance is the only call so far.
  await screen.getByRole("button", { name: /語音/ }).click();
  expect(await ttsCalls(screen)).toEqual([""]);

  host.send(JSON.stringify({ type: "HOST_START", aiNarration: false }));
  await expect.poll(() => box.state?.phase).toBe("playing");
  for (let i = 0; i < 200 && cur().phase === "playing"; i++) {
    const t = cur().view.teams[0];
    const qid = t.inBossPhase ? cur().view.bossCurrentQuestionId : t.currentQuestionId;
    const before = cur().eventId;
    host.send(JSON.stringify({ type: "HOST_JUDGE", teamId: t.id, questionId: qid, correct: true }));
    await expect.poll(() => cur().eventId, { timeout: 2000 }).toBeGreaterThan(before);
  }
  expect(cur().phase).toBe("finished");

  // The epilogue text arrives ~EPILOGUE_DELAY_MS (4s) after the kill shot, over the live socket
  // this connection has open the whole time — shouldSpeakEpilogue's true branch (a live
  // GAME_OVER really was observed on this connection first).
  await expect(screen.locator(".px-say")).toContainText(/地城重歸寂靜|走出地城|成為傳說/, { timeout: 15_000 });
  await expect.poll(() => ttsCalls(screen)).toEqual(
    expect.arrayContaining([expect.stringMatching(/地城重歸寂靜|走出地城|成為傳說/)]),
  );
  host.close();
  team.close();
});

test("screen TTS: no matching Traditional Chinese voice loaded — toggle still works, but live narration is silently never spoken (voice-unavailable fallback)", async ({ browser }) => {
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
  await stubSpeechSynthesisNoMatchingVoice(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();

  const toggle = screen.getByRole("button", { name: /語音/ });
  await expect(toggle).toBeVisible(); // the toggle itself doesn't depend on a voice existing
  await toggle.click();
  expect(await ttsCalls(screen)).toEqual([""]); // unlock utterance bypasses ttsVoice entirely

  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByText("輪到：乙隊")).toBeVisible();
  await expect(screen.locator(".px-say")).toContainText("甲隊"); // narration DID render on screen...
  await new Promise((r) => setTimeout(r, 500)); // ...but nothing further was ever spoken
  expect(await ttsCalls(screen)).toEqual([""]);
});

test("screen TTS: a browser with no Web Speech API renders no toggle at all", async ({ page }) => {
  await stubNoSpeechSynthesisApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /主持遊戲/ }).click();
  await page.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = page.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await page.context().newPage();
  await stubNoSpeechSynthesisApi(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText(code)).toBeVisible(); // page rendered fine otherwise
  await expect(screen.getByRole("button", { name: /語音/ })).toHaveCount(0);
});

test("screen TTS: blocked localStorage (private browsing) doesn't break the toggle, it just doesn't persist", async ({ page }) => {
  await stubSpeechSynthesis(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /主持遊戲/ }).click();
  await page.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = page.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await page.context().newPage();
  await stubSpeechSynthesis(screen);
  await screen.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await screen.goto(`/room/${code}/screen`);

  const toggle = screen.getByRole("button", { name: /語音/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText("🔇 語音關"); // reading the stored pref failed silently, default stands
  await toggle.click();
  await expect(toggle).toHaveText("🔊 語音開"); // still works this page load even though nothing can be saved
  expect(await ttsCalls(screen)).toEqual([""]);
});
