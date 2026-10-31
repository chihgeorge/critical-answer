import { test, expect, type Page } from "@playwright/test";
import { ERROR_TITLE } from "../components/error-screen";

/** A fake navigator.wakeLock that counts requests, since headless Chromium cannot hold a real one. */
async function countWakeLocks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __wakeLocks: number };
    w.__wakeLocks = 0;
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: async () => (w.__wakeLocks++, { release: async () => {} }) },
    });
  });
}
const wakeLocks = (page: Page) => page.evaluate(() => (window as unknown as { __wakeLocks: number }).__wakeLocks);
const comeBack = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

/** The TV and the host's phone keep the screen on (TODOS: 電視和主持人的螢幕會自動休眠). */
test("the host page and the big screen keep the screen awake, and ask again when they come back", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await countWakeLocks(host);
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  await expect.poll(() => wakeLocks(host)).toBeGreaterThanOrEqual(1);
  const before = await wakeLocks(host);
  await comeBack(host);
  await expect.poll(() => wakeLocks(host)).toBe(before + 1);

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await countWakeLocks(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect.poll(() => wakeLocks(screen)).toBeGreaterThanOrEqual(1);
});

/** components/error-screen.tsx reports a crash here; the Worker logs it and answers 204. */
test("the Worker takes a crash report", async ({ request }) => {
  const res = await request.post("http://localhost:1996/api/client-error", {
    data: JSON.stringify({ message: "e2e crash report", path: "/room/TEST/screen" }),
    headers: { Origin: "http://localhost:3101", "Content-Type": "text/plain" },
  });
  expect(res.status()).toBe(204);
});

/** A refused lock (low battery) or a browser without wakeLock (older iOS) must leave the host page working. */
for (const [name, script] of [
  ["refuses the lock", () => Object.defineProperty(navigator, "wakeLock", { value: { request: () => Promise.reject(new Error("NotAllowedError")) } })],
  ["has no wakeLock at all", () => Reflect.deleteProperty(Navigator.prototype, "wakeLock")],
] as const) {
  test(`the host page still works when the browser ${name}`, async ({ browser }) => {
    const host = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    host.on("pageerror", (e) => errors.push(e.message));
    await host.addInitScript(script);
    await host.goto("/");
    await host.getByRole("button", { name: /主持遊戲/ }).click();
    await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
    await expect(host.getByText(ERROR_TITLE)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
