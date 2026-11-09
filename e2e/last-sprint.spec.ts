import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

// ⚔️ 最後衝刺 on the big screen (docs/designs/last-sprint.md), driven by a fake room like live-map.spec.ts: the socket
// never reaches the server, so each test sets exactly the state it needs.

const team = (i: number, extra: { inBossPhase?: boolean; boon?: "blessing" | "curse" } = {}) => ({
  id: `t${i}`,
  name: ["紅隊", "藍隊", "綠隊"][i],
  score: 0,
  roomIndex: 1,
  inBossPhase: extra.inBossPhase ?? false,
  online: true,
  currentQuestionId: "q",
  currentSelection: null,
  ...(extra.boon ? { boon: extra.boon } : {}),
});
type Team = ReturnType<typeof team>;

const state = (teams: Team[], eventId: number, sprint?: string[]) =>
  JSON.stringify({
    type: "STATE",
    phase: "playing",
    winners: [],
    roomEpoch: "e",
    reveal: null,
    eventId,
    question: { id: "q", difficulty: 2, content: { kind: "text", value: "題目" }, monster: { name: "史萊姆", sprite: "slime", hue: 0 } },
    view: { currentTurnTeamId: "t1", teams, bossHp: 5, bossMaxHp: 5, bossPhase: 1, bossCurrentQuestionId: "b", ...(sprint ? { sprint: { teamIds: sprint } } : {}) },
  });

/** Every connection gets the latest state on open; `push` sends a new one to the open connection. */
async function fakeRoom(page: Page, first: string) {
  let latest = first;
  let sock: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/parties\//, (ws) => {
    sock = ws;
    ws.send(latest);
  });
  return {
    push(s: string) {
      latest = s;
      sock!.send(s);
    },
  };
}

// Value: protects=the door-opening banner plays live, names the blessed team, and a reload never replays it;
// fails_when=nextTransition drops the sprint kind or its live-only rule, or the pawn loses its ✨; why_new=no spec
// covered the sprint; seam=none; no_claim=the phone card or the fanfare (fake room, no server)
test("the sprint banner names the blessed team once, live; its pawn shows ✨", async ({ page }) => {
  const room = await fakeRoom(page, state([team(0), team(1), team(2)], 1));
  await page.goto("/room/LSPR/screen");
  const map = page.getByTestId("map-strip");
  await expect(map.getByRole("img", { name: "藍隊（輪到）" })).toBeVisible();

  room.push(state([team(0, { inBossPhase: true }), team(1), team(2, { boon: "blessing" })], 2, ["t2"]));
  const banner = page.getByTestId("transition-sprint");
  await expect(banner).toContainText("⚔️ 魔王門開了！");
  await expect(banner).toContainText("綠隊 獲得 ✨祝福");
  await expect(map.getByTestId("pawn-boon")).toHaveText(["✨"]);

  await page.reload();
  await expect(map.getByRole("img", { name: "藍隊（輪到）" })).toBeVisible();
  await expect(map.getByTestId("pawn-boon")).toHaveText(["✨"]);
  await expect(page.getByTestId("transition-sprint")).toHaveCount(0);
});
