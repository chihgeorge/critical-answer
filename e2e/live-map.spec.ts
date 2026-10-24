import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

// The big screen's live map (docs/designs/live-map.md), driven by a fake room: the socket never reaches
// the server, so each test sets exactly the teams it needs.

const team = (i: number, roomIndex: number, extra: { inBossPhase?: boolean; online?: boolean } = {}) => ({
  id: `t${i}`,
  name: ["紅隊", "藍隊", "綠隊"][i],
  score: 0,
  roomIndex,
  inBossPhase: extra.inBossPhase ?? false,
  online: extra.online ?? true,
  currentQuestionId: "q",
  currentSelection: null,
  branchChoices: {},
});
type Team = ReturnType<typeof team>;

const state = (teams: Team[], eventId: number) =>
  JSON.stringify({
    type: "STATE",
    phase: "playing",
    winners: [],
    roomEpoch: "e",
    reveal: null,
    eventId,
    question: { id: "q", difficulty: 2, content: { kind: "text", value: "題目" }, monster: { name: "史萊姆", sprite: "slime", hue: 0 } },
    view: { currentTurnTeamId: "t0", teams, bossHp: 5, bossMaxHp: 5, bossCurrentQuestionId: "b" },
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

// Value: protects=the map marks the team on turn and offline teams; fails_when=turn is compared to the
// wrong id or the offline branch is dropped; why_new=main-line only checks the strip is visible;
// seam=none; no_claim=how the ▼ and zz sprites look (fake room, no server)
test("a pawn says whose turn it is and who is offline", async ({ page }) => {
  await fakeRoom(page, state([team(0, 0), team(1, 1, { online: false })], 1));
  await page.goto("/room/LMAP/screen");
  const map = page.getByTestId("map-strip");
  await expect(map.getByRole("img", { name: "紅隊（輪到）" })).toBeVisible();
  await expect(map.getByRole("img", { name: "藍隊（離線）" })).toBeVisible();
});

// Value: protects=only a pawn that moved animates, and a reload replays nothing; fails_when=the mounted
// place set is dropped or the animation keys on layout instead of place; why_new=no test covered the
// arrival (D13); seam=none; no_claim=animation timing or reduced motion (fake room, no server)
test("a pawn that moves plays its arrival once; a reload does not replay it", async ({ page }) => {
  const room = await fakeRoom(page, state([team(0, 0), team(1, 2), team(2, 1)], 1));
  await page.goto("/room/LMAP/screen");
  const map = page.getByTestId("map-strip");
  await expect(map.getByRole("img", { name: "紅隊（輪到）" })).toBeVisible();
  // The places teams already held when the strip mounted do not animate.
  await expect(map.locator(".px-hop-in, .px-charge, .px-room-flash")).toHaveCount(0);

  room.push(state([team(0, 1), team(1, 2, { inBossPhase: true }), team(2, 1)], 2));
  await expect(map.locator(".px-hop-in")).toHaveCount(1); // 紅 walks into room 2
  await expect(map.locator(".px-charge")).toHaveCount(1); // 藍 charges into the boss room
  await expect(map.locator(".px-room-flash")).toHaveCount(2); // each room a pawn landed in flashes once
  await expect(map.getByTestId("boss-room")).toBeVisible();

  await page.reload();
  await expect(map.getByRole("img", { name: "紅隊（輪到）" })).toBeVisible();
  await expect(map.locator(".px-hop-in, .px-charge, .px-room-flash")).toHaveCount(0);
});
