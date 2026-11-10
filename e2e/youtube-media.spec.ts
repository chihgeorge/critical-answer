// YouTube questions (docs/designs/youtube-questions.md): the host's ▶ ⏸ ⟲ reach the big screen's player, a music
// question hides its picture until the answer, and phones never embed the video. youtube.com is blocked and a fake
// window.YT records every player call, so nothing here needs the network or a real video.
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startGame, nextQuestion, screenUrl, rollCheck } from "./answer";
import { stubSpeechSynthesis } from "./tts";
import { E2E_OWNER_KEY } from "../playwright.config";

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
const VIDEO = "dQw4w9WgXcQ";

/** A stand-in for YouTube's IFrame API: every call lands in window.__yt, and play/pause report their state back. */
const FAKE_YT = `
window.__yt = [];
window.YT = {
  Player: class {
    constructor(el, opts) {
      this.opts = opts;
      this.t = opts.playerVars.start || 0;
      window.__ytPlayer = this;
      const box = document.createElement("div");
      box.setAttribute("data-testid", "fake-yt");
      box.dataset.videoId = opts.videoId;
      el.replaceWith(box);
      window.__yt.push(["new", opts.videoId, opts.playerVars.start, opts.playerVars.end ?? null]);
      setTimeout(() => opts.events.onReady({ target: this }), 0);
    }
    playVideo() { window.__yt.push(["play"]); this.opts.events.onStateChange({ data: 1, target: this }); }
    pauseVideo() { window.__yt.push(["pause"]); this.opts.events.onStateChange({ data: 2, target: this }); }
    seekTo(s) { window.__yt.push(["seek", s]); this.t = s; }
    getCurrentTime() { return this.t; }
    destroy() { window.__yt.push(["destroy"]); }
  },
};`;

async function fakeYoutube(context: BrowserContext) {
  await context.route(/youtube(-nocookie)?\.com/, (r) => r.abort());
  await context.addInitScript(FAKE_YT);
}

const calls = (screen: Page) => screen.evaluate(() => (window as unknown as { __yt: unknown[][] }).__yt.map((c) => c.join(" ")));

let original: unknown;
test.beforeEach(async ({ request }) => {
  original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank.pools["1"];
});
test.afterEach(async ({ request }) => {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  bank.pools["1"] = original;
  await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
});

/** Seeds room 0 with one question, starts a one-team game, and returns the host, the big screen and the phone. */
async function start(browser: Browser, request: import("@playwright/test").APIRequestContext, question: object) {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  bank.pools["1"] = [question];
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } })).ok()).toBe(true);

  const hostContext = await browser.newContext();
  await fakeYoutube(hostContext);
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screenContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await fakeYoutube(screenContext);
  const screen = await screenContext.newPage();
  await screen.goto(await screenUrl(host));

  const teamContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await fakeYoutube(teamContext);
  const team = await teamContext.newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("聽歌隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  return { host, screen, team };
}

const music = { kind: "text", id: "r0-music-e2e", content: { kind: "youtube", value: VIDEO, audioOnly: true, start: 65, end: 80 }, prompt: "這首歌是什麼的主題曲？", answer: "灌籃高手" };

test("music question: the lobby asks for a tap, the card hides the video, and the host's ▶ ⏸ ⟲ drive the screen's player", async ({ browser, request }) => {
  const { host, screen, team } = await start(browser, request, music);

  // Nobody has tapped the big screen: the lobby says so (D16), until someone does.
  await expect(screen.getByTestId("tap-for-sound")).toBeVisible();
  await screen.mouse.click(5, 5);
  await expect(screen.getByTestId("tap-for-sound")).toHaveCount(0);

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();

  // Check first, question after: until the team rolls, the screen has neither the prompt nor a player, and ▶ waits.
  await expect(screen.getByTestId("screen-check-first")).toBeVisible();
  await expect(screen.getByText("這首歌是什麼的主題曲？")).toHaveCount(0);
  await expect(screen.getByTestId("youtube-player")).toHaveCount(0);
  await expect(host.getByTestId("host-question")).toHaveText("這首歌是什麼的主題曲？");
  await expect(host.getByRole("button", { name: "播放", exact: true })).toBeDisabled();
  await rollCheck(team);

  // The screen: the prompt, the music card over the player, cued at the clip's start (D3, D15).
  await expect(screen.getByText("這首歌是什麼的主題曲？")).toBeVisible();
  await expect(screen.getByTestId("music-card")).toBeVisible();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "paused");
  expect(await calls(screen)).toContain(`new ${VIDEO} 65 80`);

  // The phone: the prompt and where to listen, no embed (D7, D21).
  await expect(team.getByText("這首歌是什麼的主題曲？")).toBeVisible();
  await expect(team.getByTestId("play-media-hint")).toHaveText("🎵 聽大螢幕");
  await expect(team.locator("iframe")).toHaveCount(0);

  // The host: the prompt, the label and three buttons (D19).
  await expect(host.getByTestId("host-question")).toHaveText("這首歌是什麼的主題曲？");
  await expect(host.getByText("🎵 聽歌題（聽大螢幕）")).toBeVisible();
  await expect(host.getByTestId("host-media")).toContainText("大螢幕：已暫停");

  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(host.getByTestId("host-media")).toContainText("大螢幕：播放中");
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "playing");
  await expect(screen.getByTestId("music-card")).toContainText("播放中");
  // A second ▶ does nothing more on the screen.
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(async () => (await calls(screen)).filter((c) => c === "play").length).toBe(1);

  await host.getByRole("button", { name: "暫停" }).click();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "paused");
  await expect.poll(() => calls(screen)).toContain("pause");

  await host.getByRole("button", { name: "從頭播放" }).click();
  await expect.poll(async () => (await calls(screen)).slice(-2)).toEqual(["seek 65", "play"]);

  // The clip reaches its end by itself: the screen says 播完, the host still lights ▶, and ▶ plays it again.
  await screen.evaluate(() => ((window as unknown as { __ytPlayer: { t: number } }).__ytPlayer.t = 80));
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "ended");
  await expect(screen.getByTestId("music-card")).toContainText("播完");
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "playing");
  await expect.poll(async () => (await calls(screen)).slice(-2)).toEqual(["seek 65", "play"]);

  // The answer lifts the card: the same player, paused where it stopped, shows the video (D17).
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByText("正解：灌籃高手")).toBeVisible();
  await expect(screen.getByTestId("music-card")).toHaveCount(0);
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "paused");
  expect((await calls(screen)).filter((c) => c.startsWith("new"))).toHaveLength(1);
  await expect(host.getByTestId("host-media")).toContainText("大螢幕：已暫停");
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "playing");

  // 下一題: the video goes, the player with it.
  await nextQuestion(host);
  await expect(screen.getByTestId("youtube-player")).toHaveCount(0);
  await expect.poll(() => calls(screen)).toContain("destroy");
});

test("a reconnecting big screen picks a playing video up from the clip's start", async ({ browser, request }) => {
  const { host, screen, team } = await start(browser, request, music);
  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await rollCheck(team); // check first, question after: the question and its media show once the check is rolled
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "playing");

  await screen.reload();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "playing");
  expect(await calls(screen)).toEqual([`new ${VIDEO} 65 80`, "seek 65", "play"]);
});

test("a video question shows its picture, a video the API cannot load says so, and ▶ tries again", async ({ browser, request }) => {
  const video = { kind: "text", id: "r0-video-e2e", content: { kind: "youtube", value: VIDEO }, prompt: "這是哪部電影？", answer: "彩蛋" };
  const { host, screen, team } = await start(browser, request, video);
  // This screen has no fake API: the script is blocked, so the player gives up with its error, not a blank box.
  const bare = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await bare.route(/youtube(-nocookie)?\.com/, (r) => r.abort());
  // By the host's link, not screen.url(): the big screen takes the key out of its address bar.
  await bare.goto(await screenUrl(host));

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await rollCheck(team); // check first, question after: the question and its media show once the check is rolled
  await expect(screen.getByTestId("youtube-player")).toBeVisible();
  await expect(screen.getByTestId("music-card")).toHaveCount(0);
  await expect(team.getByTestId("play-media-hint")).toHaveText("▶ 看大螢幕");
  await expect(host.getByText("▶ 影片題（看大螢幕）")).toBeVisible();
  await expect(bare.getByText("影片無法播放")).toBeVisible();

  // The network comes back (the fake API appears): the host's ▶ builds the player again and plays (D26).
  await bare.evaluate(FAKE_YT);
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(bare.getByTestId("youtube-player")).toHaveAttribute("data-status", "playing");
});

// Generated by /ship test-coverage audit (pass 1). Unrun locally: e2e runs on CI only.
// Value: protects=the screen's onVideoPlaying: a playing video mutes the music and cancels speech, a pause brings
// the music back; fails_when=onPlayingChange is not wired to bgm.mute / speechSynthesis.cancel, or mute never lifts;
// why_new=bgm-player.test.ts covers mute() alone, nothing checks the screen calls it; seam=none;
// no_claim=real audio output (speechSynthesis stubbed, YouTube faked, gain read from AudioParam.setTargetAtTime calls)
test("a playing video silences the music and stops the narration on the big screen, and a pause brings the music back", async ({ browser, request }) => {
  const { host, screen, team } = await start(browser, request, music);
  await stubSpeechSynthesis(screen);
  await screen.addInitScript(() => {
    const w = window as unknown as { __gain: number[] };
    w.__gain = [];
    const set = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (v: number, t: number, c: number) {
      w.__gain.push(v);
      return set.call(this, v, t, c);
    };
  });
  await screen.reload();
  const lastGain = () => screen.evaluate(() => (window as unknown as { __gain: number[] }).__gain.at(-1));
  const cancels = () => screen.evaluate(() => (window as unknown as { __ttsCancelCount: () => number }).__ttsCancelCount());

  await screen.getByRole("button", { name: "🎵 音樂關" }).click();
  await expect(screen.getByRole("button", { name: "🎵 音樂開" })).toBeVisible();
  await expect.poll(lastGain).toBeGreaterThan(0);

  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await rollCheck(team); // check first, question after: the question and its media show once the check is rolled
  const before = await cancels();
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "playing");
  await expect.poll(lastGain).toBe(0);
  expect(await cancels()).toBeGreaterThan(before);

  await host.getByRole("button", { name: "暫停" }).click();
  await expect(screen.getByTestId("youtube-player")).toHaveAttribute("data-status", "paused");
  await expect.poll(lastGain).toBeGreaterThan(0);
});
