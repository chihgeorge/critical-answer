import { test, expect, type Browser } from "@playwright/test";
import { textOnlyBank } from "./answer";

// Fill-in (#104): on a text question the team types its answer, the host and the TV show it, the host judges.
textOnlyBank();

async function oneTeamRoom(browser: Browser) {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`/room/${code}/screen`);
  const team = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await team.goto(`/room/${code}/play?name=${encodeURIComponent("填空隊")}`);
  await expect(team.getByText("等待主持人開始遊戲")).toBeVisible();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  return { host, screen, team };
}

// Value: protects=a typed answer reaches the host page and the TV, and the host judges it (AC1);
// fails_when=the box, the send, or either display is missing; no_claim=text cleaning (unit tests).
test("the team types an answer, the host and the TV show it, the host judges it correct", async ({ browser }) => {
  const { host, screen, team } = await oneTeamRoom(browser);
  await expect(host.getByTestId("host-typed-answer")).toHaveText("（還沒送出）");
  await team.getByRole("textbox", { name: "你們的答案" }).fill("Don't Stop");
  await team.getByRole("button", { name: "送出" }).click();
  await expect(team.getByTestId("typed-answer-sent")).toHaveText("已送出：Don't Stop・等主持人判");
  await expect(host.getByTestId("host-typed-answer")).toHaveText("隊伍答：Don't Stop");
  await expect(screen.getByTestId("screen-typed-answer")).toHaveText("⚔️ 填空隊：Don't Stop");
  await host.getByRole("button", { name: "答對！" }).click();
  await expect(host.getByRole("button", { name: "下一題", exact: true })).toBeEnabled();
  await expect(screen.getByTestId("screen-typed-answer")).toHaveCount(0);
});

// Value: protects=the host can judge with nothing sent, and a retry turn starts with an empty box (AC4);
// fails_when=judging needs a sent answer, or the old text stays in the box; no_claim=flee.
test("the host judges wrong before anything is sent; the retry turn starts empty", async ({ browser }) => {
  const { host, team } = await oneTeamRoom(browser);
  const box = team.getByRole("textbox", { name: "你們的答案" });
  await box.fill("還沒按送出");
  await host.getByRole("button", { name: "答錯・重答" }).click();
  // The only team: the turn comes straight back to it, on the same question.
  await expect(team.getByText("輪到我們了！")).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(host.getByTestId("host-typed-answer")).toHaveText("（還沒送出）");
});

// Value: protects=a send the room never confirms gives the box back with the text after 3 s (AC7b);
// fails_when=the phone stays on 送出中… forever or loses the text; no_claim=a real network drop (the send is dropped in the page).
test("a send that is never confirmed gives the box back with the text", async ({ browser }) => {
  const { team } = await oneTeamRoom(browser);
  await team.evaluate(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.includes("TEAM_SUBMIT_TEXT")) return;
      return send.call(this, data);
    };
  });
  const box = team.getByRole("textbox", { name: "你們的答案" });
  await box.fill("掉了");
  await team.getByRole("button", { name: "送出" }).click();
  await expect(team.getByRole("button", { name: "送出中…" })).toBeDisabled();
  await expect(team.getByText("沒送出，再按一次，或直接唸給主持人聽")).toBeVisible({ timeout: 5000 });
  await expect(box).toHaveValue("掉了");
  await expect(team.getByRole("button", { name: "送出" })).toBeEnabled();
});
