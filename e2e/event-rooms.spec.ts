import { test, expect } from "@playwright/test";
import { answerCorrectly, nextQuestion, startGame, textOnlyBank } from "./answer";

// Event rooms (docs/designs/event-rooms.md). The e2e worker runs with E2E_EVENT_TEAM=EventTeam (playwright.config.ts):
// the team named EventTeam draws an event on every eligible room entry, and no other team ever does.
textOnlyBank();

// Value: protects=an event turn end to end (draw → phone press → TV and phone outcome → 下一題 → a monster again);
// fails_when=the event stays hidden, the press never lands, the result never clears, or the team is stuck in the
// room; why_new=no spec covered event rooms; seam=worker E2E_EVENT_TEAM; no_claim=which event is drawn (random)
test("a team walks into an event room, opens it from its phone, everyone sees the outcome, and its next turn is a monster", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];

  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
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

  // EventTeam answers right and walks into room 2, which holds an event; Plain plays its turn as usual.
  await expect(host.getByText("輪到：EventTeam")).toBeVisible();
  await answerCorrectly(host);
  await nextQuestion(host);
  await expect(host.getByText("輪到：Plain")).toBeVisible();
  await answerCorrectly(host);
  await nextQuestion(host);

  // EventTeam's turn is the event: the scene on the TV, one button on its phone, a pointer to the TV on the other.
  await expect(screen.getByText("❓ 事件房")).toBeVisible();
  await expect(screen.getByTestId("event-line")).toBeVisible();
  await expect(screen.getByTestId("event-stage")).toBeVisible();
  await expect(host.getByTestId("host-event")).toBeVisible();
  await expect(host.getByRole("button", { name: "答對！" })).toHaveCount(0);
  await expect(plain.getByTestId("phone-event-watch")).toContainText("EventTeam走進了事件房");
  await eventTeam.getByTestId("phone-event-open").click();

  // The outcome shows on the TV and the phone and holds the room until 下一題.
  await expect(screen.getByTestId("event-result")).toBeVisible();
  await expect(eventTeam.getByTestId("phone-event-result")).toBeVisible();
  await expect(host.getByTestId("host-reveal")).toContainText("大螢幕正在揭曉");
  await nextQuestion(host);
  await expect(screen.getByTestId("event-result")).toHaveCount(0);

  // Plain plays; then EventTeam, one room on, faces a monster again.
  await expect(host.getByText("輪到：Plain")).toBeVisible();
  await answerCorrectly(host);
  await nextQuestion(host);
  await expect(host.getByText("輪到：EventTeam")).toBeVisible();
  await expect(host.getByRole("button", { name: "答對！" })).toBeVisible();
  await expect(screen.getByTestId("event-line")).toHaveCount(0);
});
