import { test, expect, type Browser } from "@playwright/test";
import { answerCorrectly, nextQuestion, startGame, textOnlyBank, screenUrl } from "./answer";

// 叉路 (docs/designs/branch-fork.md). The e2e worker runs with E2E_EVENT_TEAM=EventTeam (playwright.config.ts): the team
// named EventTeam comes to a fork on every eligible room entry, and no other team ever does; E2E_MONSTER_SIDE=left hides
// ⚔️ behind the left door, so 右門 opens ❓.
textOnlyBank();

/** A game where EventTeam (first in turn order) answers right, Plain plays its turn, and EventTeam stands at a fork. */
async function toTheFork(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(await screenUrl(host));
  await expect(screen.getByText(code)).toBeVisible();

  // One after the other: 擲先攻 ties every team under E2E_DIE and keeps the lobby order, so EventTeam must join first.
  const join = async (name: string) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(`/room/${code}/play?name=${name}`);
    await expect(page.getByText("等待主持人開始遊戲")).toBeVisible();
    await expect(host.getByText(name)).toBeVisible();
    return page;
  };
  const eventTeam = await join("EventTeam");
  const plain = await join("Plain");
  await startGame(host);

  await expect(host.getByText("輪到：EventTeam")).toBeVisible();
  await answerCorrectly(host);
  await nextQuestion(host);
  await expect(host.getByText("輪到：Plain")).toBeVisible();
  await answerCorrectly(host);
  await nextQuestion(host);

  // EventTeam's turn is the fork: two unmarked doors on the TV (左門, 右門), two buttons on its phone kept in view, the
  // host only watching, a pointer to the TV on the other phone. No screen names a room before a door opens.
  await expect(screen.getByTestId("fork-doors")).toBeVisible();
  await expect(screen.getByTestId("fork-doors")).toContainText("左門");
  await expect(screen.getByTestId("fork-doors")).toContainText("右門");
  await expect(screen.getByTestId("fork-doors")).not.toContainText(/怪物房|神秘房/);
  await expect(screen.getByText("🔀 叉路！")).toBeVisible();
  await expect(host.getByTestId("host-fork")).toContainText("EventTeam在叉路口");
  await expect(host.getByRole("button", { name: "答對！" })).toHaveCount(0);
  await expect(plain.getByTestId("phone-fork-watch")).toContainText("EventTeam在叉路口猶豫中");
  await expect(eventTeam.getByTestId("phone-fork-left")).toHaveText("左門");
  await expect(eventTeam.getByTestId("phone-fork-right")).toHaveText("右門");
  await expect(eventTeam.getByTestId("phone-fork-left")).toBeInViewport();
  await expect(eventTeam.getByTestId("phone-fork-right")).toBeInViewport();
  return { host, screen, eventTeam, plain };
}

// Value: protects=a ❓ fork end to end (fork → phone press → door beat → TV and phone outcome → 下一題 → a monster
// again); fails_when=the doors stay hidden, the press never lands, the outcome shows before the door opens, the result
// never clears, or the team is stuck; why_new=the fork replaced the event-room button; seam=worker E2E_EVENT_TEAM;
// no_claim=which event is drawn (random)
test("a team at a fork opens ❓ from its phone, the door opens, everyone sees the outcome, and its next turn is a monster", async ({ browser }) => {
  test.setTimeout(60_000); // the fortune teller's ~3 s intro, pick and card push this walk past 30 s (CI timed out at it)
  const { host, screen, eventTeam } = await toTheFork(browser);
  await eventTeam.getByTestId("phone-fork-right").click();

  // The door opens first and names what was behind it; the outcome waits for the end of the beat (branch-fork.md d1b).
  await expect(screen.getByTestId("fork-door-open")).toHaveAttribute("data-door", "mystery");
  await expect(screen.getByTestId("fork-door-open")).toHaveAttribute("data-side", "right");
  // ❓ draws the chest, the statue or the fortune teller (fortune-teller.md); the fortune teller shows her own screen.
  const fortune = screen.getByTestId("fortune-screen");
  await expect(screen.getByTestId("event-result").or(fortune)).toBeVisible({ timeout: 5000 });
  if (await fortune.isVisible()) {
    // The effect buttons wait out her ~3 s intro. ✨ blessing, not 💫 stun, which would skip Plain's turn below.
    await eventTeam.getByTestId("phone-fortune-blessing").click();
    await expect(fortune).toHaveAttribute("data-step", "card");
    await nextQuestion(host);
    await expect(fortune).toHaveCount(0);
  } else {
    await expect(screen.getByText("❓ 神秘房")).toBeVisible();
    await expect(eventTeam.getByTestId("phone-event-result")).toBeVisible();
    await expect(host.getByTestId("host-reveal")).toContainText("大螢幕正在揭曉");
    await nextQuestion(host);
    await expect(screen.getByTestId("event-result")).toHaveCount(0);
  }

  // Plain plays; then EventTeam, one room on, faces a monster.
  await expect(host.getByText("輪到：Plain")).toBeVisible();
  await answerCorrectly(host);
  await nextQuestion(host);
  await expect(host.getByText("輪到：EventTeam")).toBeVisible();
  await expect(host.getByRole("button", { name: "答對！" })).toBeVisible();
  await expect(screen.getByTestId("fork-doors")).toHaveCount(0);
});

// Value: protects=a ⚔️ fork (press → door beat → the room's monster and question); fails_when=⚔️ never leaves the
// fork or skips the room's question; why_new=the fork is new; seam=worker E2E_EVENT_TEAM; no_claim=the narration line
test("a team at a fork takes ⚔️ and then faces the room's monster", async ({ browser }) => {
  const { host, screen, eventTeam } = await toTheFork(browser);
  // Regression: ISSUE-001 — the host page showed the ⚔️ question's answer under the fork card while the door opened.
  // Found by /qa on 2026-11-09. Watched in the page, every frame from the opening line's first to its last: the answer
  // comes in its own message after STATE, and the 1.5 s beat must not end between two checks made from here.
  const answerUpDuringOpening = host.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        let opening = false;
        let answer = false;
        const frame = () => {
          if (document.querySelector('[data-testid="host-fork-beat"]')) {
            opening = true;
            answer ||= !!document.querySelector('[data-testid="host-answer"]');
          } else if (opening) return resolve(answer);
          requestAnimationFrame(frame);
        };
        frame();
      }),
  );
  await eventTeam.getByTestId("phone-fork-left").click();

  await expect(screen.getByTestId("fork-door-open")).toHaveAttribute("data-door", "monster");
  await expect(screen.getByTestId("fork-door-open")).toContainText("⚔️ 怪物房");
  expect(await answerUpDuringOpening).toBe(false); // resolves when the opening ends
  await expect(host.getByRole("button", { name: "答對！" })).toBeVisible({ timeout: 5000 });
  await expect(screen.getByTestId("fork-doors")).toHaveCount(0);
  await expect(host.getByText("輪到：EventTeam")).toBeVisible();
});
