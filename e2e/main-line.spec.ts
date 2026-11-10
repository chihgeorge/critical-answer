import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { answerCorrectly, NEXT_WAIT_MS, textOnlyBank, startGame, judgeToTheEnd, EPILOGUE_RE, type HostState, screenUrl } from "./answer";
import { stubSpeechSynthesis, ttsCalls } from "./tts";
import { MONSTERS } from "../lib/monster-catalog";

// These tests judge by hand (or HOST_JUDGE), which a multipleChoice turn doesn't take.
textOnlyBank();

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
  await screen.goto(await screenUrl(host));
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
  // AI narration is off until a host pastes a key, so tests never call the real API.
  await expect(host.getByText("AI 旁白", { exact: true })).toBeVisible();
  await startGame(host);
  await expect(host.getByText("輪到：甲隊")).toBeVisible();
  await expect(screen.getByText("輪到：甲隊")).toBeVisible();
  await expect(screen.getByTestId("map-strip")).toBeVisible();
  await expect(players[0].page.getByText("輪到我們了！")).toBeVisible();

  // The host sees the question and its answer; the big screen shows the question only.
  const question = (await host.getByTestId("host-question").textContent())!;
  const answer = (await host.getByTestId("host-answer").textContent())!;
  expect(answer.length).toBeGreaterThan(0);
  await expect(screen.getByText(question)).toBeVisible();

  // A correct judgment scores and passes the turn.
  await answerCorrectly(host);

  // The answer reveal (D2/D3/D7, docs/designs/question-media-content.md) reaches everyone — the
  // shared screen and every phone, 甲隊 (who just answered) included, not just the host's own
  // answer channel checked above — and stays up until the host moves on.
  await expect(screen.getByText(`正解：${answer}`)).toBeVisible();
  await expect(players[0].page.getByText(`正解：${answer}`)).toBeVisible();
  // Before 上菜 (which shows 「上菜！」 on the screen): one narration line about 甲隊's answer reaches the big screen and the other phone alike.
  await expect(screen.locator(".px-say")).toContainText("甲隊");
  await expect(players[1].page.locator(".px-say")).toContainText("甲隊");

  // The narrator moves the story on: the result line shows a ▼ (more to come), then the next team is
  // addressed, and the last line has no ▼.
  await expect(screen.locator(".px-say .more")).toBeVisible({ timeout: 6000 });
  await expect(screen.locator(".px-say")).toContainText("乙隊", { timeout: 8000 }); // the follow-up addresses the next team
  await expect(screen.locator(".px-say .more")).toHaveCount(0, { timeout: 6000 });

  // The bundled bank cooks every monster (docs/designs/monster-cuisine.md): the dish waits for the host's 🍲 上菜, then the
  // screen cooks the monster and serves it (cooking R4/R5), and scores are 飽足感.
  await expect(screen.getByTestId("dish-card")).toHaveCount(0);
  await expect(screen.getByText("🍲 甲隊")).toBeVisible(); // the ribbon names who eats (cooking I6)
  await expect(host.getByRole("button", { name: "答對！" })).toHaveCount(0); // judging waits for 下一題
  await host.getByRole("button", { name: /上菜/ }).click();
  await expect(screen.getByTestId("dish-card")).toContainText("今晚的菜");
  await expect(screen.getByTestId("dish-card")).toContainText("飽足感");
  await expect(players[0].page.getByTestId("phone-dish")).toContainText("今晚的菜");
  await expect(host.getByRole("button", { name: "下一題", exact: true })).toBeEnabled({ timeout: NEXT_WAIT_MS }); // once the dish is cooked and eaten (cooking I2, eat-dish.md)
  await host.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(screen.getByText(`正解：${answer}`)).toHaveCount(0);

  await expect(host.getByText("輪到：乙隊")).toBeVisible();
  await expect(screen.getByText("輪到：乙隊")).toBeVisible();
  await expect(players[1].page.getByText("輪到我們了！")).toBeVisible();

  // The branch choice is off the phones for now (TODOS.md), even right after 甲隊 entered a new room.
  await expect(players[0].page.getByText("冒險出現岔路")).toHaveCount(0);

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

  // The host's drawer. (Editing a narration line: narration-tts.spec.ts's host narration panel test.)
  await host.getByRole("button", { name: /更多/ }).click();
  // The drawer keeps only the host-device QR (the one that hands over control), not a second join QR.
  await expect(host.getByText("用另一台裝置主持")).toBeVisible();
  await expect(host.getByText("玩家掃描加入")).toHaveCount(0);
  await expect(host.getByRole("img", { name: "掃描加入" })).toHaveCount(0);
  await expect(host.getByRole("img", { name: "主持人 QR" })).toHaveCount(1);

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

test("game over: the boss cooks, then the podium, then the epilogue arrives on the big screen", async ({ browser }) => {
  test.setTimeout(110_000); // every cooked monster is served and waited out (cooking I2), then the podium reveal
  const code = "EPLG";
  const partyUrl = `ws://localhost:1996/parties/main/${code}`;
  const open = (u: string) => new Promise<WebSocket>((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await stubSpeechSynthesis(screen);
  await screen.goto(`/room/${code}/screen`);

  // Drive a one-team game to the boss kill over a raw socket, judging whatever question is current.
  const host = await open(partyUrl);
  const box: { state: HostState | null } = { state: null };
  const cur = () => box.state!;
  host.onmessage = (e) => { const m = JSON.parse(e.data as string) as HostState; if (m.type === "STATE") box.state = m; };
  host.send(JSON.stringify({ type: "HOST_CLAIM", token: "epilogue-token-0123456789" }));
  const team = await open(partyUrl);
  team.send(JSON.stringify({ type: "JOIN", teamId: "00000000-0000-0000-0000-0000000000aa", teamKey: "epilogue-team-key-0123456789", teamName: "終局隊" }));
  await expect(screen.getByText("終局隊")).toBeVisible();
  // The team's phone, as the same team (its id and key), watches the end with the screen (podium-reveal eng D22).
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.addInitScript(() => {
    localStorage.setItem("critical_answer_team_id", "00000000-0000-0000-0000-0000000000aa");
    localStorage.setItem("critical_answer_team_key", "epilogue-team-key-0123456789");
  });
  await phone.goto(`/room/${code}/play?name=${encodeURIComponent("終局隊")}`);
  await expect(phone.getByTestId("roster")).toContainText("終局隊");
  // Read aloud too: the unlock utterance is the only speech before the game starts.
  await screen.getByRole("button", { name: /語音/ }).click();
  expect(await ttsCalls(screen)).toEqual([""]);
  host.send(JSON.stringify({ type: "HOST_START", aiNarration: false })); // never the real API in tests
  await expect.poll(() => box.state?.phase).toBe("playing");
  // The boss stands on the cooking stage before the pot (cooking R8). Its frame lasts COOK_POT_MS, so watch every frame from now.
  // The bundled bank draws its boss per game (gameMonsters), so any boss counts.
  const bosses = MONSTERS.filter((m) => m.boss).map((m) => m.name);
  const bossOnStage = screen.waitForFunction(
    (names) => document.body.innerText.includes("冒　險　結　束") && [...document.querySelectorAll("div")].some((e) => names.includes(e.textContent ?? "")),
    bosses,
    { polling: "raf", timeout: 80_000 },
  );
  let sawBossRoom = false;
  let sawDefeated = false;
  await judgeToTheEnd(host, cur, async (t) => {
    // One team, so the next room's monster differs: the stage shows the monster just defeated, not the next one (cooking R1).
    const dish = cur().reveal?.dish;
    if (dish && dish.room !== null && !cur().reveal?.served && !sawDefeated) {
      await expect(screen.getByText(dish.monster.name, { exact: true })).toBeVisible();
      await expect(screen.getByText("🍲 終局隊")).toBeVisible();
      sawDefeated = true;
    }
    if (t.inBossPhase && !sawBossRoom) {
      await expect(screen.getByTestId("boss-room")).toBeVisible(); // the map's door has opened
      sawBossRoom = true;
    }
  });
  expect(sawBossRoom).toBe(true);
  expect(sawDefeated).toBe(true);
  await bossOnStage;

  // The boss kill was seen live, so the boss cooks first and the winner waits (cooking R8): the big dish, then the podium.
  await expect(screen.getByTestId("dish-card")).toContainText("今晚的大菜");
  await expect(screen.getByText("奪得榜首")).toHaveCount(0);
  // The phone keeps quiet while the screen calls the places, and shows the result only after the screen does (eng D22, D23).
  await expect(phone.getByText("冒險結束！看大螢幕 📺")).toBeVisible();
  const shownAt = (page: typeof screen, text: string) =>
    page.waitForFunction((t) => document.body.innerText.includes(t) && Date.now(), text, { polling: "raf", timeout: 45_000 }).then(async (h) => Number(await h.jsonValue()));
  const [screenAt, phoneAt] = await Promise.all([shownAt(screen, "奪得榜首"), shownAt(phone, "你們獲勝了")]);
  expect(phoneAt).toBeGreaterThanOrEqual(screenAt);
  // The boss-kill answer ended the game, so its reveal shows on the podium screen instead (D7).
  await expect(screen.getByTestId("answer-reveal")).toContainText("最後一題正解：");
  await expect(screen.locator(".px-say")).toContainText(EPILOGUE_RE, { timeout: 25_000 });
  // A single last line: no ▼ once the story has finished typing.
  await expect(screen.locator(".px-say .more")).toHaveCount(0, { timeout: 6000 });
  // The live epilogue (no replay flag) is read aloud, not just the podium narration.
  await expect.poll(() => ttsCalls(screen)).toEqual(expect.arrayContaining([expect.stringMatching(EPILOGUE_RE)]));
  host.close();
  team.close();
});

// A spectator copying a team's public id with a wrong key changes nothing: lib/room/dungeon-room.test.ts
// ("impersonating a team with REJOIN and a wrong key does nothing").

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
