import { test, expect } from "@playwright/test";

/**
 * Room codes are 4 letters and rooms now outlive their connections (they are saved), so a newly created room
 * can land on a code that is already someone else's. The link the home page opens (new=1) picks another code;
 * a link to an existing room never does.
 */
const OWNER_TOKEN = "collision-owner-token-0123456789";
const NEWCOMER_TOKEN = "collision-newcomer-token-012345678";

async function takeCode(code: string) {
  const ws = await new Promise<WebSocket>((res, rej) => {
    const w = new WebSocket(`ws://localhost:1996/parties/main/${code}`);
    w.onopen = () => res(w);
    w.onerror = () => rej(new Error("socket error"));
  });
  const ok = new Promise<void>((res) => {
    ws.onmessage = (e) => { if (JSON.parse(e.data as string).type === "HOST_OK") res(); };
  });
  ws.send(JSON.stringify({ type: "HOST_CLAIM", token: OWNER_TOKEN }));
  await ok;
  return ws;
}

test("a new room whose code is already taken moves to another code by itself", async ({ page }) => {
  const owner = await takeCode("COLA");
  await page.goto(`/room/COLA/host#k=${NEWCOMER_TOKEN}&new=1`);
  await page.waitForURL((u) => /\/room\/[A-Z]{4}\/host/.test(u.pathname) && !u.pathname.includes("/COLA/"));
  await expect(page.getByText("等待隊伍加入")).toBeVisible(); // it claimed the new room
  // Once the room is ours the link no longer carries new=1, so a refresh can never swap it again.
  await expect.poll(() => new URL(page.url()).hash).toBe(`#k=${NEWCOMER_TOKEN}`);
  expect(page.url()).not.toContain("new=1");
  owner.close();
});

test("five taken codes in a row give up and show the error, instead of retrying forever", async ({ page }) => {
  test.setTimeout(30_000);
  const roomsTried = new Set<string>();
  // Every connection this page opens, to any code, is rejected as if that code always belonged to someone else.
  await page.routeWebSocket(/:1996\/parties\/main\/([A-Z]{4})/, (ws) => {
    const code = new URL(ws.url()).pathname.split("/").pop()!;
    roomsTried.add(code);
    ws.onMessage((raw) => {
      const msg = JSON.parse(raw as string);
      if (msg.type === "HOST_CLAIM") ws.send(JSON.stringify({ type: "ERROR", error: "bad_token" }));
    });
  });
  await page.goto(`/room/COLZ/host#k=${NEWCOMER_TOKEN}&new=1`);
  await expect(page.getByText("主持人金鑰不符")).toBeVisible({ timeout: 15_000 });
  // Exactly MAX_FRESH_ATTEMPTS distinct codes: the loop stopped instead of running forever.
  expect(roomsTried.size).toBe(5);
});

test("a link to an existing room never jumps to another one", async ({ page }) => {
  const owner = await takeCode("COLB");
  await page.goto(`/room/COLB/host#k=${NEWCOMER_TOKEN}`);
  await expect(page.getByText("主持人金鑰不符")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(new URL(page.url()).pathname).toBe("/room/COLB/host");
  owner.close();
});
