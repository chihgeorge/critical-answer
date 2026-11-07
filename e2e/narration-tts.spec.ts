import { test, expect, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { revealMarks } from "../lib/podium";
import type { PodiumReveal } from "../lib/protocol";
import { answerCorrectly, textOnlyBank, startGame, judgeToTheEnd, EPILOGUE_RE, type HostState, nextQuestion } from "./answer";
import { stubSpeechSynthesis, ttsCalls } from "./tts";

// These tests judge by hand (or HOST_JUDGE), which a multipleChoice turn doesn't take.
textOnlyBank();

/** A host page plus two phone teams (甲隊, 乙隊) in a started game, on 甲隊's turn. */
async function twoTeamGame(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  for (const name of ["甲隊", "乙隊"]) {
    const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await team.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(team.getByTestId("roster")).toContainText(name);
  }
  await startGame(host);
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
  return { host, code };
}

const ttsCancelCount = (page: Page) => page.evaluate(() => (window as unknown as { __ttsCancelCount: () => number }).__ttsCancelCount());

/** Same stub, but the voice list starts empty, as it does in browsers that load it asynchronously:
 * getVoices() returns [] until the test calls window.__loadVoices(), which fills it and fires the
 * voiceschanged listeners the page registered. */
async function stubSpeechSynthesisLateVoices(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    const listeners: (() => void)[] = [];
    let voices: SpeechSynthesisVoice[] = [];
    (window as unknown as { __ttsCalls: string[] }).__ttsCalls = calls;
    (window as unknown as { __loadVoices: () => void }).__loadVoices = () => {
      voices = [{ lang: "zh-TW", name: "Test zh-TW Voice", default: true } as SpeechSynthesisVoice];
      for (const l of listeners) l();
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => voices,
        addEventListener: (_: string, l: () => void) => listeners.push(l),
        removeEventListener: () => {},
        speak: (utter: SpeechSynthesisUtterance) => calls.push(utter.text),
        cancel: () => {},
        speaking: false,
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

  await startGame(host);
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();

  // onConnect resends the room's current STATE — no NARRATION exists yet this early, so no
  // replay to worry about. Enable TTS before judging, so the upcoming live narration is heard.
  await screen.getByRole("button", { name: /語音/ }).click();
  expect(await ttsCalls(screen)).toEqual([""]); // just the unlock utterance so far

  await answerCorrectly(host);
  await expect(screen.getByText("🍲 甲隊")).toBeVisible(); // the reveal's ribbon names who eats (cooking I6)

  // The live NARRATION's line and its "then" (next-team) line both get spoken, in order —
  // not just the result line.
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));
  const calls = await ttsCalls(screen);
  expect(calls.length).toBeGreaterThanOrEqual(2); // unlock + at least the result line (+ then, if the scripted line has one)
});

test("screen TTS: turning the toggle off cancels any speech in progress", async ({ browser }) => {
  const { host, code } = await twoTeamGame(browser);

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();

  const toggle = screen.getByRole("button", { name: /語音/ });
  await toggle.click(); // on: 1 cancel-free unlock utterance so far
  await answerCorrectly(host);
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));

  const cancelsBeforeToggleOff = await ttsCancelCount(screen);
  await toggle.click(); // off, mid-utterance
  await expect(toggle).toHaveText("🔇 語音關");
  expect(await ttsCancelCount(screen)).toBeGreaterThan(cancelsBeforeToggleOff);
});

test("screen TTS: LOBBY (room reset) cancels in-progress speech", async ({ browser }) => {
  const { host, code } = await twoTeamGame(browser);

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
  await answerCorrectly(host);
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));

  const cancelsBeforeReset = await ttsCancelCount(screen);
  // Inject a synthetic LOBBY frame (a real server restart/room-reset sends exactly this) — the
  // client-side handling under test doesn't care whether the server or this test sent it.
  await expect.poll(() => sockets.length).toBe(1);
  sockets[0].send(JSON.stringify({ type: "LOBBY", teams: [], roomEpoch: crypto.randomUUID() }));
  await expect.poll(() => ttsCancelCount(screen)).toBeGreaterThan(cancelsBeforeReset);
});

test("screen TTS: a host correction is spoken, both of the line replayed at connect and of a live line", async ({ browser }) => {
  test.setTimeout(60_000); // two scenarios in one test
  const { host, code } = await twoTeamGame(browser);

  // Judge the question with NO /screen watching yet — the narration becomes the room's
  // lastNarration, sitting there for onConnect to replay to whoever connects next.
  await answerCorrectly(host);
  await expect(host.getByText("輪到：乙隊")).toBeVisible();

  // Now open /screen: onConnect replays that narration as this connection's baseline —
  // correctly not spoken (it's a replay, not a live event).
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("🍲 甲隊")).toBeVisible(); // the reveal's ribbon names who eats (cooking I6)
  await screen.getByRole("button", { name: /語音/ }).click();
  expect(await ttsCalls(screen)).toEqual([""]); // only the unlock utterance — the replay was NOT spoken

  // The host now corrects that exact (replayed, unspoken) line. It must still be spoken.
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const editSection = host.locator("section", { hasText: "改寫第一句旁白" });
  const correctedText = "重播後修正的旁白文字";
  await editSection.locator("input").fill(correctedText);
  await editSection.getByRole("button", { name: "送出，立刻換上大螢幕" }).click();
  await expect.poll(() => ttsCalls(screen)).toContainEqual(correctedText);
  await host.getByRole("button", { name: "關閉" }).click();

  // A live line is spoken, and a correction of that spoken line (same eventId, new text) is spoken too.
  await nextQuestion(host); // close the first answer's reveal
  const spokenBefore = (await ttsCalls(screen)).length; // the first correction already re-spoke a 乙隊 line
  await answerCorrectly(host);
  await expect
    .poll(async () => (await ttsCalls(screen)).slice(spokenBefore))
    .toContainEqual(expect.stringContaining("乙隊"));
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const liveCorrection = "測試修正後的旁白文字";
  await editSection.locator("input").fill(liveCorrection);
  await editSection.getByRole("button", { name: "送出，立刻換上大螢幕" }).click();
  await expect.poll(() => ttsCalls(screen)).toContainEqual(liveCorrection);
});

// A live epilogue is read aloud: main-line.spec.ts ("game over: the boss cooks, then the podium, then the epilogue ...").

test("screen TTS: an epilogue replayed at connect is shown but never spoken", async ({ browser }) => {
  test.setTimeout(110_000); // every cooked monster is served and waited out (cooking I2), then the podium reveal
  const code = "EPI3"; // distinct from EPIL/EPI2 — same shared server
  const partyUrl = `ws://localhost:1996/parties/main/${code}`;
  const open = (u: string) => new Promise<WebSocket>((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });

  // Play the whole game with no screen open, and wait for the live EPILOGUE to go out.
  const host = await open(partyUrl);
  const box: { state: HostState | null; epilogue: boolean; revealEnd: number } = { state: null, epilogue: false, revealEnd: Infinity };
  const cur = () => box.state!;
  host.onmessage = (e) => {
    const m = JSON.parse(e.data as string) as HostState & { podium?: PodiumReveal };
    if (m.type === "STATE") box.state = m;
    if (m.type === "STATE" && m.podium?.beats) box.revealEnd = Date.now() - m.podium.elapsedMs + revealMarks(m.podium.beats).at(-1)!;
    if (m.type === "EPILOGUE") box.epilogue = true;
  };
  host.send(JSON.stringify({ type: "HOST_CLAIM", token: "epilogue-replay-token-0123456789" }));
  const team = await open(partyUrl);
  team.send(JSON.stringify({ type: "JOIN", teamId: "00000000-0000-0000-0000-0000000000ef", teamKey: "epilogue-replay-team-key-012345", teamName: "重播終局隊" }));
  host.send(JSON.stringify({ type: "HOST_START", aiNarration: false }));
  await expect.poll(() => box.state?.phase).toBe("playing");
  await judgeToTheEnd(host, cur);
  await expect.poll(() => box.epilogue, { timeout: 15_000 }).toBe(true);
  // A screen opened mid-reveal reads the place calls (podium-reveal D20); this one opens after them.
  await expect.poll(() => Date.now() >= box.revealEnd, { timeout: 25_000 }).toBe(true);

  // Now open the screen with TTS already on (remembered from an earlier visit). onConnect
  // replays the EPILOGUE with `replay: true`: it must show, but must not be read aloud again.
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.addInitScript(() => localStorage.setItem("screen-tts-enabled", "true"));
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByRole("button", { name: /語音開/ })).toBeVisible();
  // setEpilogue and speak run in the same handler, so once the text shows, the speak decision is made.
  await expect(screen.locator(".px-say")).toContainText(EPILOGUE_RE, { timeout: 15_000 });
  expect(await ttsCalls(screen)).toEqual([]);

  // Positive control: the speak path is live on this connection, so the silence above came from
  // the replay flag, not from TTS being off.
  const corrected = "重播測試的修正旁白";
  host.send(JSON.stringify({ type: "HOST_EDIT_NARRATION", line: corrected }));
  await expect.poll(() => ttsCalls(screen)).toContainEqual(corrected);
  host.close();
  team.close();
});

test("screen TTS: narration that arrives before the voice list has loaded is spoken once it loads, not lost", async ({ browser }) => {
  const { host, code } = await twoTeamGame(browser);

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesisLateVoices(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();
  await screen.getByRole("button", { name: /語音/ }).click();

  // A live narration arrives while there is still no voice to speak it with...
  await answerCorrectly(host);
  await expect(screen.getByText("🍲 甲隊")).toBeVisible(); // the reveal's ribbon names who eats (cooking I6)
  await screen.waitForTimeout(500);
  expect(await ttsCalls(screen)).toEqual([""]); // just the unlock utterance: nothing to speak with yet

  // ...then the voices load, and it's spoken.
  await screen.evaluate(() => (window as unknown as { __loadVoices: () => void }).__loadVoices());
  await expect.poll(() => ttsCalls(screen)).toContainEqual(expect.stringContaining("甲隊"));
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

test("host edit drawer: the label tells the host how many segments there are, since the edit box only reaches the first", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");

  await startGame(host);
  await expect(host.getByText("輪到：甲隊")).toBeVisible();

  // The opening NARRATION already exists by the time the drawer opens (it fires right after
  // start), so the label already shows a segment count, not the plain "no count" text.
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  await expect(host.getByText(/改寫第一句旁白（共 \d 句，只能改第一句，最多 40 字）/)).toBeVisible();
});

// Value: protects=with the voice on, each how-to-play page's owl line is spoken once when the page comes up (how-to-play.md D11);
// fails_when=the intro speak call is dropped, or the per-page guard is lost so a page's line repeats on a later STATE;
// why_new=no test spoke the intro; host-controls.spec.ts checks the pages, not the voice; seam=none;
// no_claim=real speech output (speechSynthesis is stubbed); unit tests cover the room's paging
test("screen TTS: the how-to-play intro speaks each page's owl line once", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("甲隊")}`);
  await expect(team.getByTestId("roster")).toContainText("甲隊");

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);
  await screen.getByRole("button", { name: /語音/ }).click();
  expect(await ttsCalls(screen)).toEqual([""]);

  await expect(host.getByRole("checkbox", { name: "開始前播放玩法說明" })).toBeChecked();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  const page1 = "冒險者們，先聽我說規則……主持人會唸題目。";
  const page2 = "說服怪物前先擲骰，過了 DC 就送你答案第一個字。";
  await expect.poll(() => ttsCalls(screen)).toEqual(["", page1]);

  await host.getByRole("button", { name: "下一頁 ▶" }).click();
  await expect(screen.getByTestId("how-to-play")).toContainText("2/4");
  await expect.poll(() => ttsCalls(screen)).toEqual(["", page1, page2]);
});
