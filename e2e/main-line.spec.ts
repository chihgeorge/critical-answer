import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

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
  // The second phone's socket goes through a route we can cut, to simulate a dropped connection.
  const phone2: { socket: WebSocketRoute | null; opened: number } = { socket: null, opened: 0 };
  for (const name of ["甲隊", "乙隊"]) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const frames = recordFrames(page);
    if (name === "乙隊") {
      await page.routeWebSocket(/:1996\//, (ws) => {
        ws.connectToServer();
        phone2.socket = ws;
        phone2.opened++;
      });
    }
    await page.goto(`/room/${code}/play?name=${encodeURIComponent(name)}`);
    await expect(page.getByText("等待主持人開始遊戲")).toBeVisible();
    players.push({ page, frames });
  }

  // The join QR is right there in the host's lobby, no drawer needed.
  await expect(host.getByRole("img", { name: "掃描加入" })).toBeVisible();

  // While waiting, each phone lists every team that has joined, live.
  for (const { page } of players) {
    await expect(page.getByTestId("roster")).toContainText("甲隊");
    await expect(page.getByTestId("roster")).toContainText("乙隊");
  }
  const late = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await late.goto(`/room/${code}/play?name=${encodeURIComponent("丙隊")}`);
  await expect(players[0].page.getByTestId("roster")).toContainText("丙隊"); // shows up without a refresh
  await late.close();

  // Host claims control, then starts once both teams are in.
  await expect(host.getByText("乙隊")).toBeVisible();
  await expect(host.getByText("AI 旁白")).toBeVisible(); // the switch is there whether or not a key is configured
  // Tests must never call the real API (a .env with a key turns AI on by default): switch it off.
  const ai = host.getByRole("checkbox");
  if ((await ai.isEnabled()) && (await ai.isChecked())) await ai.uncheck();
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

  // The answer reveal (D2/D3/D7, docs/designs/question-media-content.md) reaches everyone — the
  // shared screen and every phone, 甲隊 (who just answered) included, not just the host's own
  // answer channel checked above — and stays up until the host moves on.
  await expect(screen.getByText(`正解：${answer}`)).toBeVisible();
  await expect(players[0].page.getByText(`正解：${answer}`)).toBeVisible();
  await expect(host.getByRole("button", { name: "答對！" })).toHaveCount(0); // judging waits for 下一題
  await host.getByRole("button", { name: "下一題" }).click();
  await expect(screen.getByText(`正解：${answer}`)).toHaveCount(0);

  await expect(host.getByText("輪到：乙隊")).toBeVisible();
  await expect(screen.getByText("輪到：乙隊")).toBeVisible();
  await expect(players[1].page.getByText("輪到我們了！")).toBeVisible();

  // DM branching interlude: 甲隊 just entered room 1, so it sees the choice — and it's
  // non-blocking, so 乙隊 (whose turn it now is) never sees it and can play on regardless.
  await expect(players[0].page.getByText("冒險出現岔路")).toBeVisible();
  await expect(players[1].page.getByText("冒險出現岔路")).toHaveCount(0);
  await players[0].page.getByRole("button", { name: "武力" }).click();
  await expect(players[0].page.getByText("冒險出現岔路")).toHaveCount(0); // answered, panel gone

  // One narration line about 甲隊's answer reaches the big screen and the other phone alike.
  await expect(screen.locator(".px-say")).toContainText("甲隊");
  await expect(players[1].page.locator(".px-say")).toContainText("甲隊");

  // The narrator moves the story on: the result line shows a ▼ (more to come), then the next team is
  // addressed, and the last line has no ▼.
  await expect(screen.locator(".px-say .more")).toBeVisible({ timeout: 6000 });
  await expect(screen.locator(".px-say")).toContainText("乙隊", { timeout: 8000 }); // the follow-up addresses the next team
  await expect(screen.locator(".px-say .more")).toHaveCount(0, { timeout: 6000 });

  // A phone that reloads (or wakes from sleep) comes back as the same team: it is not left "offline" and skipped.
  await players[1].page.reload();
  await expect(players[1].page.getByText("輪到我們了！")).toBeVisible();
  await expect(host.getByText("（離線）")).toHaveCount(0);

  // Same when only the connection drops (phone sleeps, Wi-Fi changes) and comes back, with no reload:
  // the phone says who it is again on its own.
  const opened = phone2.opened;
  await phone2.socket!.close();
  await expect.poll(() => phone2.opened, { timeout: 15000 }).toBeGreaterThan(opened); // partysocket reconnected
  await expect(players[1].page.getByText("輪到我們了！")).toBeVisible({ timeout: 10000 });
  await expect(host.getByText("（離線）")).toHaveCount(0, { timeout: 10000 });

  // Director: the host rewrites the line, and it replaces the line on the big screen and the phone at once.
  await host.getByRole("button", { name: /更多/ }).click();
  // The drawer keeps only the host-device QR (the one that hands over control), not a second join QR.
  await expect(host.getByText("用另一台裝置主持")).toBeVisible();
  await expect(host.getByText("不是逐字台詞")).toBeVisible(); // the notes are style guidance, not a script
  await expect(host.getByText("玩家掃描加入")).toHaveCount(0);
  await expect(host.getByRole("img", { name: "掃描加入" })).toHaveCount(0);
  await expect(host.getByRole("img", { name: "主持人 QR" })).toHaveCount(1);
  await host.locator('input[maxlength="40"]').fill("主持人改寫：全場安靜！");
  await host.getByRole("button", { name: /送出，立刻換上大螢幕/ }).click();
  await expect(screen.locator(".px-say")).toContainText("主持人改寫：全場安靜！");
  await expect(players[1].page.locator(".px-say")).toContainText("主持人改寫：全場安靜！");

  // Nothing host-only (token confirmation, the host-only answer channel) reaches the public
  // surfaces. STATE.reveal legitimately carries an "answer" field now (D2/D3 — a shared-screen
  // party game, broadcast on purpose after a correct answer) — HOST_ANSWER itself, sent only via
  // sendTo to host connections, is the invariant this test actually guards.
  for (const frames of [screenFrames, ...players.map((p) => p.frames)]) {
    expect(frames.length).toBeGreaterThan(0);
    const all = frames.join("\n");
    expect(all).not.toContain("HOST_OK");
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
  const partyUrl = `ws://localhost:1996/parties/main/${code}`;
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
  team.send(JSON.stringify({ type: "JOIN", teamId: "00000000-0000-0000-0000-0000000000aa", teamKey: "epilogue-team-key-0123456789", teamName: "終局隊" }));
  await expect(screen.getByText("終局隊")).toBeVisible();
  host.send(JSON.stringify({ type: "HOST_START", aiNarration: false })); // never the real API in tests
  await expect.poll(() => box.state?.phase).toBe("playing");
  for (let i = 0; i < 200 && cur().phase === "playing"; i++) {
    const t = cur().view.teams[0];
    const qid = t.inBossPhase ? cur().view.bossCurrentQuestionId : t.currentQuestionId;
    const before = cur().eventId;
    host.send(JSON.stringify({ type: "HOST_NEXT" })); // close the previous answer reveal (D7); no-op if none
    host.send(JSON.stringify({ type: "HOST_JUDGE", teamId: t.id, questionId: qid, correct: true }));
    await expect.poll(() => cur().eventId, { timeout: 2000 }).toBeGreaterThan(before);
  }
  expect(cur().phase).toBe("finished");

  // Podium is there immediately; the story follows as a single line.
  await expect(screen.getByText("奪得榜首")).toBeVisible();
  // The boss-kill answer ended the game, so its reveal shows on the podium screen instead (D7).
  await expect(screen.getByTestId("answer-reveal")).toContainText("最後一題正解：");
  await expect(screen.locator(".px-say")).toContainText(/地城重歸寂靜|走出地城|成為傳說/, { timeout: 15_000 });
  // A single last line: no ▼ once the story has finished typing.
  await expect(screen.locator(".px-say")).toContainText(/地城重歸寂靜|走出地城|成為傳說/);
  await expect(screen.locator(".px-say .more")).toHaveCount(0, { timeout: 6000 });
  host.close();
  team.close();
});

test("a spectator cannot knock a team out of the turn order by copying its public id", async () => {
  const partyUrl = "ws://localhost:1996/parties/main/SPYT";
  const open = (u: string) => new Promise<WebSocket>((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });
  const box: { teams: { name: string; online: boolean }[] } = { teams: [] };
  const host = await open(partyUrl);
  host.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.type === "STATE") box.teams = m.view.teams; };
  host.send(JSON.stringify({ type: "HOST_CLAIM", token: "spectator-test-token-0123456789" }));
  const id = "00000000-0000-0000-0000-0000000000cc";
  const team = await open(partyUrl);
  team.send(JSON.stringify({ type: "JOIN", teamId: id, teamKey: "the-teams-own-secret-0123456789", teamName: "被冒用隊" }));
  await new Promise((r) => setTimeout(r, 300));
  host.send(JSON.stringify({ type: "HOST_START", aiNarration: false }));
  await expect.poll(() => box.teams.length).toBe(1);

  const spy = await open(partyUrl);
  let spyError = "";
  spy.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.type === "ERROR") spyError = m.error; };
  spy.send(JSON.stringify({ type: "REJOIN", teamId: id, teamKey: "a-guess-that-is-wrong-0123456789" }));
  await expect.poll(() => spyError).toBe("bad_token");
  spy.close();
  await new Promise((r) => setTimeout(r, 500));
  expect(box.teams[0].online).toBe(true);
  host.close();
  team.close();
});

test("the old PartyKit path is refused, and only the room can be reached", async () => {
  const tryOpen = (u: string) =>
    new Promise<"opened" | "refused">((res) => {
      const w = new WebSocket(u);
      w.onopen = () => { w.close(); res("opened"); };
      w.onerror = () => res("refused");
    });
  expect(await tryOpen("ws://localhost:1996/party/OLDP")).toBe("refused");
  expect(await tryOpen("ws://localhost:1996/parties/bank-store/x")).toBe("refused");
  expect(await tryOpen("ws://localhost:1996/parties/main/NEWP")).toBe("opened");
});
