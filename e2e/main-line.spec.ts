import { test, expect, type Page } from "@playwright/test";

/** Every WebSocket text frame a page receives, so we can assert on what /screen and /play were sent. */
function recordFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  return frames;
}

test("create room, join two teams, start, judge; screen and play never see host-only data", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const screenFrames = recordFrames(screen);
  await screen.goto(`/room/${code}/screen`);
  await expect(screen.getByText(code)).toBeVisible();

  const players: { page: Page; frames: string[] }[] = [];
  for (const name of ["甲隊", "乙隊"]) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const frames = recordFrames(page);
    await page.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(page.getByText("等待主持人開始遊戲")).toBeVisible();
    players.push({ page, frames });
  }

  // Host claims control, then starts once both teams are in.
  await expect(host.getByText("乙隊")).toBeVisible();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();
  await expect(players[0].page.getByText("輪到我們了！")).toBeVisible();

  // The host sees the question and its answer; the big screen shows the question only.
  const question = (await host.getByTestId("host-question").textContent())!;
  const answer = (await host.getByTestId("host-answer").textContent())!;
  expect(answer.length).toBeGreaterThan(0);
  await expect(screen.getByText(question)).toBeVisible();

  // A correct judgment scores and passes the turn.
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByText("輪到：乙隊")).toBeVisible();
  await expect(screen.getByText("輪到：乙隊")).toBeVisible();
  await expect(players[1].page.getByText("輪到我們了！")).toBeVisible();

  // One narration line about 甲隊's answer reaches the big screen and the other phone alike.
  await expect(screen.locator(".px-say")).toContainText("甲隊");
  await expect(players[1].page.locator(".px-say")).toContainText("甲隊");

  // Nothing host-only (token confirmation, answers) reaches the public surfaces.
  for (const frames of [screenFrames, ...players.map((p) => p.frames)]) {
    expect(frames.length).toBeGreaterThan(0);
    const all = frames.join("\n");
    expect(all).not.toContain("HOST_OK");
    expect(all).not.toContain('"answer"');
    expect(all).not.toContain("HOST_ANSWER");
  }
  await expect(screen.locator("body")).not.toContainText("答案（只有你看得到）");
  await expect(players[0].page.locator("body")).not.toContainText("答案（只有你看得到）");
  await expect(players[0].page.locator("body")).not.toContainText(question);
});

test("a browser with no host token cannot start a game", async ({ page }) => {
  await page.goto("/room/ZZZZ/host");
  await expect(page.getByText("這個瀏覽器沒有主持人金鑰")).toBeVisible();
  await expect(page.getByRole("button", { name: /開始遊戲/ })).toBeDisabled();
});

test("game over: podium at once, then the epilogue arrives on the big screen", async ({ browser }) => {
  test.setTimeout(60_000);
  const code = "EPIL";
  const partyUrl = `ws://localhost:1996/party/${code}`;
  const open = (u: string) => new Promise<WebSocket>((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);

  // Drive a one-team game to the boss kill over a raw socket, judging whatever question is current.
  const host = await open(partyUrl);
  type Msg = { type: string; phase: string; eventId: number; view: { bossCurrentQuestionId: string; teams: { id: string; inBossPhase: boolean; currentQuestionId: string }[] } };
  const box: { state: Msg | null } = { state: null };
  const cur = () => box.state!;
  host.onmessage = (e) => { const m = JSON.parse(e.data as string) as Msg; if (m.type === "STATE") box.state = m; };
  host.send(JSON.stringify({ type: "HOST_CLAIM", token: "epilogue-token-0123456789" }));
  const team = await open(partyUrl);
  team.send(JSON.stringify({ type: "JOIN", teamId: "00000000-0000-0000-0000-0000000000aa", teamName: "終局隊" }));
  await expect(screen.getByText("終局隊")).toBeVisible();
  host.send(JSON.stringify({ type: "HOST_START" }));
  await expect.poll(() => box.state?.phase).toBe("playing");
  for (let i = 0; i < 200 && cur().phase === "playing"; i++) {
    const t = cur().view.teams[0];
    const qid = t.inBossPhase ? cur().view.bossCurrentQuestionId : t.currentQuestionId;
    const before = cur().eventId;
    host.send(JSON.stringify({ type: "HOST_JUDGE", teamId: t.id, questionId: qid, correct: true }));
    await expect.poll(() => cur().eventId, { timeout: 2000 }).toBeGreaterThan(before);
  }
  expect(cur().phase).toBe("finished");

  // Podium is there immediately; the story follows as a single line.
  await expect(screen.getByText("奪得榜首")).toBeVisible();
  await expect(screen.locator(".px-say")).toContainText(/地城重歸寂靜|走出地城|成為傳說/, { timeout: 15_000 });
  host.close();
  team.close();
});
