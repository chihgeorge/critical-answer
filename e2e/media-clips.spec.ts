// The big screen's media before and during a game: 📺 大螢幕試播影音 (docs/designs/screen-media-test.md), an uploaded
// video that fails and then plays (docs/designs/uploaded-media.md), and an Instagram explanation
// (docs/designs/instagram-explanations.md). Nothing leaves the machine: YouTube is a fake or blocked, the R2 bucket
// and Instagram are answered by page routes.
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Route } from "@playwright/test";
import { startGame, rollCheck, screenUrl, openMore, closeLeftoverContexts } from "./answer";
import { tapScreen } from "./tts";
import { E2E_OWNER_KEY } from "../playwright.config";

closeLeftoverContexts();

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
const FILE_KEY = "0b7e2f6a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const EXPLAIN_KEY = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
/** The R2 bucket's public URL (wrangler.jsonc R2_PUBLIC_BASE_URL): uploaded files load from there. */
const R2 = /\.r2\.dev\//;

/** Five seconds of 8 kHz silence: a file every Chromium build decodes, played by the screen's <video>. */
function silentWav(seconds = 5): Buffer {
  const n = 8000 * seconds;
  const b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(n, 40);
  return b;
}

/** A YouTube IFrame API stand-in for the screen test's probes: "BlockedVid1" fails with 150 (embedding off), any
 * other id reaches playing. */
const FAKE_YT = `
window.YT = {
  Player: class {
    constructor(el, opts) {
      this.opts = opts;
      setTimeout(() => opts.videoId === "BlockedVid1" ? opts.events.onError({ data: 150, target: this }) : opts.events.onReady({ target: this }), 0);
    }
    mute() {}
    playVideo() { this.opts.events.onStateChange({ data: 1, target: this }); }
    pauseVideo() {}
    seekTo() {}
    getCurrentTime() { return 0; }
    getDuration() { return 0; }
    destroy() {}
  },
};`;

let original: unknown;
test.beforeEach(async ({ request }) => {
  original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank.pools["1"];
});
test.afterEach(async ({ request }) => {
  if (!original) return;
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  bank.pools["1"] = original;
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } })).ok()).toBe(true);
  original = undefined;
});

async function seedRoom0(request: APIRequestContext, questions: object[]) {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  bank.pools["1"] = questions;
  const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  expect(saved.ok(), await saved.text()).toBe(true);
}

/** No real media host: YouTube aborted, the bucket answers 404 unless a test routes it itself. */
async function offline(context: BrowserContext) {
  await context.route(/youtube(-nocookie)?\.com|ytimg\.com/, (r) => r.abort());
  await context.route(R2, (r) => r.fulfill({ status: 404, body: "" }));
  await context.route(/instagram\.com/, (r) => r.abort());
}

/** A host, its keyed big screen (whose context `screenSetup` may route first) and one team in the lobby. */
async function room(browser: Browser, screenSetup?: (c: BrowserContext) => Promise<unknown>) {
  const hostContext = await browser.newContext();
  await offline(hostContext);
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screenContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await offline(screenContext);
  await screenSetup?.(screenContext);
  const screen = await screenContext.newPage();
  await screen.goto(await screenUrl(host));
  const teamContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await offline(teamContext);
  const team = await teamContext.newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("影音隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  return { host, screen, team };
}

// Value: protects=the lobby's 📺 大螢幕試播影音 round trip: the keyed screen probes each clip once, out of sight, and the
// host gets progress, then the red rows by cause; fails_when=the screen never mounts the probe, a result is lost, or a
// failure shows the wrong cause or none; why_new=bank-health tests cover the rows, nothing ran the screen's probes;
// seam=fake YouTube API, routed bucket; no_claim=the 20 s timeout row and a screen leaving mid-run
test("📺 大螢幕試播影音: the big screen probes every clip and the host sees which ones cannot play", async ({ browser, request }) => {
  await seedRoom0(request, [
    { kind: "text", id: "pre-ok", content: { kind: "youtube", value: "dQw4w9WgXcQ" }, prompt: "可以播的影片", answer: "甲" },
    { kind: "text", id: "pre-blocked", content: { kind: "youtube", value: "BlockedVid1" }, prompt: "不給嵌入的影片", answer: "乙" },
    { kind: "text", id: "pre-file", content: { kind: "video", value: FILE_KEY }, prompt: "上傳的影片", answer: "丙" },
  ]);
  // The bucket's answer waits until the test has seen the run in progress.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const { host, screen } = await room(browser, async (c) => {
    await c.addInitScript(FAKE_YT);
    await c.route(R2, async (r: Route) => {
      await held;
      await r.fulfill({ status: 404, body: "" });
    });
  });

  // The keyed screen is in (its lobby is up): the room refuses a test with no screen.
  await expect(screen.getByRole("button", { name: /開啟音效與氣氛/ }).first()).toBeVisible();
  await openMore(host);
  const panel = host.getByTestId("host-bank-health");
  await panel.getByTestId("host-screen-test").click();
  const result = panel.getByTestId("host-screen-test-result");
  await expect(result).toContainText(/📺 大螢幕試播中… \d／3/);
  await expect(screen.getByTestId("screen-media-test")).toBeAttached();
  release();

  await expect(result).toContainText("📺 3 支試播完：🔴 2 放不出來 · 🟡 0 太久沒載入");
  await expect(result.getByRole("listitem")).toHaveCount(2);
  await expect(result).toContainText("YouTube 不給嵌入，大螢幕放不出來");
  await expect(result).toContainText("大螢幕載入出錯，放不出來");
  await expect(result).toContainText("#pre-blocked");
  await expect(result).toContainText("#pre-file");
  await expect(result).not.toContainText("#pre-ok");
  await expect(panel.getByTestId("host-screen-test")).toHaveText("📺 重新試播");
  await expect(screen.getByTestId("screen-media-test")).toHaveCount(0);
});

// Value: protects=an uploaded video on the big screen: a file that will not load says so on the screen and tells the
// host, the host's ▶ loads it again and plays it, and a failing uploaded explanation reaches the host at the reveal;
// fails_when=FilePlayer's error is not reported, ▶ does not retry, or host-reveal-clip-error never shows;
// why_new=no e2e dealt kind video; seam=routed bucket (404, then a WAV); no_claim=real MP4 decoding
test("uploaded video: a file that fails tells the host, ▶ loads it again, and a failing explanation shows at the reveal", async ({ browser, request }) => {
  await seedRoom0(request, [
    { kind: "text", id: "file-q", content: { kind: "video", value: FILE_KEY }, prompt: "這段影片在哪裡拍的？", answer: "淡水", explanation: { kind: "video", value: EXPLAIN_KEY } },
  ]);
  let serveFile = false;
  const wav = silentWav();
  const { host, screen, team } = await room(browser, (c) =>
    c.route(R2, (r: Route) =>
      serveFile && r.request().url().includes(FILE_KEY) ? r.fulfill({ status: 200, contentType: "audio/wav", body: wav }) : r.fulfill({ status: 404, body: "" }),
    ),
  );
  await tapScreen(screen); // lets the screen play sound once a clip loads
  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await rollCheck(team);

  await expect(screen.getByText("這段影片在哪裡拍的？")).toBeVisible();
  await expect(screen.getByTestId("file-player")).toHaveAttribute("data-status", "error");
  await expect(screen.getByTestId("file-player")).toContainText("影片無法播放");
  await expect(team.getByTestId("play-media-hint")).toHaveText("▶ 看大螢幕");
  await expect(team.locator("video")).toHaveCount(0);
  const clipError = host.getByTestId("host-clip-error");
  await expect(clipError).toContainText("大螢幕：這支影片放不出來");
  await expect(clipError).toContainText("用你的手機或喇叭放歌。");

  // The network comes back: ▶ mounts the file again, it plays, and the host's warning clears.
  serveFile = true;
  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(screen.getByTestId("file-player")).toHaveAttribute("data-status", /playing|ended/);
  await expect(clipError).toHaveCount(0);

  // The explanation is another upload, still missing: the reveal's player fails and the host is told.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(screen.getByText("正解：淡水")).toBeVisible({ timeout: 10_000 });
  await expect(team.getByTestId("play-instagram-hint")).toHaveText("▶ 詳解請看大螢幕");
  await expect(screen.getByTestId("file-player")).toHaveAttribute("data-status", "error");
  await expect(host.getByTestId("host-reveal-clip-error")).toContainText("大螢幕：這支影片放不出來，按 ▶ 再試一次");
});

// Value: protects=an Instagram explanation: the reveal embeds the post on the big screen only, ▶ asks someone at the
// screen to click it, the click is noticed, and ⏸ reloads the embed; fails_when=the iframe is missing or points
// elsewhere, the click hint never shows or never clears, or the phone embeds it; why_new=no e2e used instagram;
// seam=routed instagram.com (a stub page), the click is a focus move as InstagramPlayer detects it; no_claim=the real
// embed's MEASURE height
test("Instagram explanation: the reveal embeds it on the big screen, ▶ asks for a click, and ⏸ stops it", async ({ browser, request }) => {
  const SHORTCODE = "Cabc123XYZ_";
  await seedRoom0(request, [{ kind: "text", id: "ig-q", content: { kind: "text", value: "這隻貓叫什麼名字？" }, answer: "麻糬", explanation: { kind: "instagram", value: SHORTCODE, end: 30 } }]);
  const { host, screen, team } = await room(browser, (c) =>
    c.route(/instagram\.com/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>ig</title><p>embed</p>" })),
  );
  await startGame(host);
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await rollCheck(team);
  await host.getByRole("button", { name: "答對！" }).click();

  const player = screen.getByTestId("instagram-player");
  await expect(player).toBeVisible({ timeout: 10_000 });
  await expect(player.locator("iframe")).toHaveAttribute("src", `https://www.instagram.com/p/${SHORTCODE}/embed/`);
  await expect(team.getByTestId("play-instagram-hint")).toHaveText("▶ 詳解請看大螢幕");
  await expect(team.locator("iframe")).toHaveCount(0);
  await expect(host.getByText("大螢幕（IG 詳解）：已停止")).toBeVisible();

  await host.getByRole("button", { name: "播放", exact: true }).click();
  await expect(host.getByText("大螢幕（IG 詳解）：請旁邊的人點影片")).toBeVisible();
  await expect(screen.getByTestId("instagram-click-hint")).toHaveText("👆 點影片開始播放");
  // A click inside the cross-origin embed is seen only as focus moving into the iframe.
  await player.locator("iframe").focus();
  await expect(player).toHaveAttribute("data-clicked", "true");
  await expect(screen.getByTestId("instagram-click-hint")).toHaveCount(0);

  await host.getByRole("button", { name: "暫停" }).click();
  await expect(player).not.toHaveAttribute("data-clicked", "true");
  await expect(host.getByText("大螢幕（IG 詳解）：已停止")).toBeVisible();
});
