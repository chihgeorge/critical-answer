import { test, expect, type APIRequestContext, type Dialog, type Page } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";
import { asTextBank } from "../lib/text-bank";
import type { Difficulty } from "../lib/game-state";
import { SERVE_HOLD_MS } from "../lib/protocol";

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };
/** How long a judgment may take to land: the killing blow shows the defeated boss (2 s, #364), then its 4 s 4d20 beat
 * (docs/designs/kill-roll.md). */
const JUDGE_LANDS_MS = 9000;

/** 擲骰說服 on a fill-in question (dnd design R6): the answer box shows once the check's beat ends. The e2e
 * worker fixes every d20 at 10 (playwright.config.ts E2E_DIE), so the check passes a room's DC and never wins outright. */
export async function rollCheck(team: Page) {
  await team.getByTestId("roll-check").click();
  await expect(team.getByRole("textbox", { name: "你們的答案" })).toBeVisible({ timeout: 5000 });
}

/** The big screen link on the host page. It carries the room's screen key: only a screen opened by it is sent the
 * question videos and has its reports taken by the room (docs/designs/screen-video-key.md). The key comes with the room's HOST_OK, so wait for it. */
export async function screenUrl(host: Page): Promise<string> {
  const link = host.getByTestId("screen-link");
  // Once the game has started the link lives in ⚙ 更多 (the lobby's 開始遊戲 is gone by then).
  const inDrawer = (await link.count()) === 0 && !(await host.getByRole("button", { name: /開始遊戲/ }).isVisible());
  if (inDrawer) await openMore(host, "screen");
  await expect(link).toHaveAttribute("href", /\/screen#s=./);
  const href = (await link.getAttribute("href"))!;
  if (inDrawer) await host.getByTestId("more-drawer").getByRole("button", { name: "關閉" }).first().click();
  return href;
}

/** Opens the host's ⚙ 更多 drawer, where the rarer controls live (a no-op when it is open), and unfolds `section`
 * (teams, rejudge, setup, screen, other: one at a time; the drawer opens on 隊伍 in a game, 開局準備 in the lobby). */
export async function openMore(host: Page, section?: "teams" | "rejudge" | "setup" | "screen" | "other") {
  if ((await host.getByTestId("more-drawer").count()) === 0) await host.getByRole("button", { name: "⚙ 更多" }).click();
  await expect(host.getByTestId("more-drawer")).toBeVisible();
  if (!section) return;
  const head = host.getByTestId(`more-section-${section}`);
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
}

/** Unfolds a team's ⋯ in ⚙ 更多's 隊伍: 指定下一題, 🧪 給藥水, 交給新手機, 設定分數 and the ability fixes. */
export async function openTeamTools(host: Page, team: string) {
  await openMore(host, "teams");
  const more = host.getByRole("button", { name: `${team}的更多工具` });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
}

/** Closes the host's ⚙ 更多 drawer. */
export async function closeMore(host: Page) {
  await host.getByTestId("more-drawer").getByRole("button", { name: "關閉" }).first().click();
  await expect(host.getByTestId("more-drawer")).toHaveCount(0);
}

/** Opens the lobby's game settings (修改 ▾): the intro, the answer countdown, 進王門檻 and the bank. */
export async function openSettings(host: Page) {
  const toggle = host.getByTestId("host-settings-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** 開始遊戲 without the how-to-play intro, the way every test but the intro's own starts a game
 * (docs/designs/how-to-play.md eng D6). The intro itself is tested in host-controls.spec.ts. */
export async function startGame(host: Page) {
  await openSettings(host);
  const intro = host.getByRole("checkbox", { name: "開始前播放玩法說明" });
  await intro.uncheck();
  await clickStart(host);
  await skipInitiative(host);
}

/** 開始遊戲, accepting its 確定要開始？ (a team without a class, or a small bank, asks first). Any other dialog is dismissed. */
export async function clickStart(host: Page) {
  const onDialog = (d: Dialog) => void (d.message().includes("確定要開始") ? d.accept() : d.dismiss());
  host.on("dialog", onDialog);
  try {
    await host.getByRole("button", { name: /開始遊戲/ }).click();
  } finally {
    host.off("dialog", onDialog);
  }
}

/** 全部代擲: the host rolls 擲先攻 for every team. E2E_DIE ties them all, so the lobby order stands, and the worker's
 * INITIATIVE_HOLD_MS (playwright.config.ts) holds it only a moment. The phones' own rolls are in initiative.spec.ts. */
export async function skipInitiative(host: Page) {
  await host.getByRole("button", { name: "🎲 全部代擲" }).click();
  await expect(host.getByTestId("host-initiative")).toHaveCount(0);
}

/** Answers the current turn correctly, whatever kind of question was dealt: the host presses 答對！
 * on a text question; on a multipleChoice one the host can't judge (docs/designs/phone-answering.md),
 * so the team on turn taps the right option on its phone and locks it, and the host presses 公布答案. The phone is found among
 * this browser's open /play pages for the host's room, so callers don't have to pass it in. */
export async function answerCorrectly(host: Page) {
  const judge = host.getByRole("button", { name: "答對！" });
  const mcStatus = host.getByTestId("host-mc-status");
  await expect(judge.or(mcStatus)).toBeVisible();
  if (await judge.isVisible()) {
    await expect(judge).toBeEnabled();
    await judge.click();
    return rollDish(host);
  }
  const answer = (await host.getByTestId("host-answer").textContent())!;
  const code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  const phones = host
    .context()
    .browser()!
    .contexts()
    .flatMap((c) => c.pages())
    .filter((p) => p.url().includes(`/room/${code}/play`));
  for (const phone of phones) {
    if (!(await phone.getByText("輪到我們了！").isVisible())) continue;
    // The option's name is its letter then its text; anchor both ends, since "2 月 28 日" is inside "12 月 28 日".
    const name = new RegExp(`^[A-D]\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    await phone.getByRole("button", { name }).click();
    await phone.getByRole("button", { name: "鎖定答案" }).click();
    await revealLock(host);
    // A right lock shows its answer after the lock's beat (2 s); 🎲 擲料理骰 then rolls the dish die (2 s), and only then is
    // it judged. Wait them out here, so callers see the judged state with their own default timeouts.
    await expect(host.getByTestId("host-mc-status")).toHaveCount(0, { timeout: 10_000 });
    return rollDish(host);
  }
  throw new Error(`no phone in room ${code} is on turn`);
}

/** 🎲 擲料理骰: a correct answer's reveal shows the answer and its explanation first and waits for the host, then the dish
 * die rolls (2 s) and the answer is scored. A no-op when no such reveal comes up (a wrong answer, a persuasion 20, the
 * finishing blow, a buzz): it waits `ms` for the button. */
export async function rollDish(host: Page, ms = 3000) {
  const roll = host.getByRole("button", { name: /^🎲 擲料理骰/ });
  try {
    await roll.waitFor({ state: "visible", timeout: ms });
  } catch {
    return;
  }
  if (await roll.isEnabled()) await roll.click();
  else await roll.click({ timeout: 5000 }).catch(() => {}); // a 擲料理骰中… that is already rolling
  await expect(roll).toHaveCount(0, { timeout: 10_000 });
}

/** The host presses 公布答案 on the waiting lock (docs/designs/host-reveal.md): nothing is judged until then. */
export async function revealLock(host: Page) {
  const reveal = host.getByRole("button", { name: /公布答案/ });
  await expect(reveal).toBeEnabled();
  await reveal.click();
}

/** 下一題 on the host page. A cooked monster's reveal takes 🍲 上菜 first (docs/designs/monster-cuisine.md, cooking R5), and
 * 下一題 then waits out the cooking (I2); click() waits for it to enable. */
/** How long a test waits for 下一題 to enable after 🍲 上菜: the server's hold (cooking and eating, eat-dish.md) plus margin. */
export const NEXT_WAIT_MS = SERVE_HOLD_MS + 5_000;

/** 🍲 上菜 when the reveal has a dish: 飽足感 shows only once the dish is served (#364). */
export async function serveDish(host: Page) {
  const serve = host.getByRole("button", { name: "🍲 上菜", exact: true });
  const next = host.getByRole("button", { name: "下一題", exact: true });
  const roll = host.getByRole("button", { name: /^🎲 擲料理骰/ });
  await expect(serve.or(next).or(roll)).toBeVisible();
  if (await roll.isVisible()) await rollDish(host);
  await expect(serve.or(next)).toBeVisible();
  if (await serve.isVisible()) await serve.click();
}

export async function nextQuestion(host: Page) {
  const serve = host.getByRole("button", { name: "🍲 上菜", exact: true });
  const next = host.getByRole("button", { name: "下一題", exact: true });
  const roll = host.getByRole("button", { name: /^🎲 擲料理骰/ });
  await expect(serve.or(next).or(roll)).toBeVisible();
  if (await roll.isVisible()) await rollDish(host);
  await expect(serve.or(next)).toBeVisible();
  if (await serve.isVisible()) await serve.click();
  await next.click({ timeout: NEXT_WAIT_MS });
}

/** What a raw host socket keeps from the room's STATE messages, enough to judge every turn. */
export type HostState = { type: string; phase: string; hold?: { id: number }; podium?: { step?: number; beats: unknown[] | null }; eventId: number; pendingRoll?: unknown; reveal?: { dish?: { room: number | null; monster: { name: string } }; served?: true; dishNext?: true } | null; view: { bossCurrentQuestionId: string; teams: { id: string; inBossPhase: boolean; currentQuestionId: string }[] } };

/** Over a raw host socket, judges a one-team game correct turn after turn until it finishes (the boss kill, after its dice).
 * `onTurn` runs before each judge, e.g. to check the screen once the boss door opens. */
export async function judgeToTheEnd(host: WebSocket, cur: () => HostState, onTurn?: (team: HostState["view"]["teams"][number]) => Promise<void>) {
  for (let i = 0; i < 200 && cur().phase === "playing"; i++) {
    await onTurn?.(cur().view.teams[0]);
    const before = cur().eventId;
    // A correct answer's reveal waits for 🎲 擲料理骰 (HOST_NEXT): its die lands, then the scored reveal replaces it.
    if (cur().reveal?.dishNext) {
      host.send(JSON.stringify({ type: "HOST_NEXT", eventId: cur().eventId }));
      await expect.poll(() => !!cur().reveal?.dishNext, { timeout: JUDGE_LANDS_MS }).toBe(false);
    }
    // Close the previous answer reveal (D7); no-op if none. A cooked monster is served first, and 下一題 waits out its cooking.
    if (cur().reveal?.dish && !cur().reveal?.served) {
      host.send(JSON.stringify({ type: "HOST_SERVE", eventId: cur().eventId }));
      await new Promise((r) => setTimeout(r, SERVE_HOLD_MS + 300));
    }
    host.send(JSON.stringify({ type: "HOST_NEXT", eventId: cur().eventId }));
    // A team walks into the boss room only once 下一題 closes its dish (#364), so read its question after the reveal closes.
    await expect.poll(() => cur().reveal ?? null, { timeout: JUDGE_LANDS_MS }).toBeNull();
    const t = cur().view.teams[0];
    const qid = t.inBossPhase ? cur().view.bossCurrentQuestionId : t.currentQuestionId;
    host.send(JSON.stringify({ type: "HOST_JUDGE", teamId: t.id, questionId: qid, correct: true }));
    await expect.poll(() => cur().eventId, { timeout: JUDGE_LANDS_MS }).toBeGreaterThan(before);
  }
  expect(cur().phase).toBe("finished");
}

/** The scripted epilogue's closing words (lib/narration/scripted.ts), for tests that wait for it. */
export const EPILOGUE_RE = /地城重歸寂靜|走出地城|成為傳說/;

/** Puts room 0 (pool 1) and the boss phases back after each test in the calling file. The dev server's bank is shared by every
 * spec file, so a test that seeds or filters room 0 would otherwise change what later files deal. */
export function restoreRoom0AfterEach() {
  let original: { pool: unknown; boss: unknown };
  test.beforeEach(async ({ request }) => {
    const { bank } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    original = { pool: bank.pools["1"], boss: bank.boss.phases };
  });
  test.afterEach(async ({ request }) => {
    if (!original) return; // beforeEach failed: writing undefined would break every later spec file
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    bank.pools["1"] = original.pool;
    bank.boss.phases = original.boss;
    await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  });
}

/** Gives room 3 room 0's monster for one test and puts the bank back after it: the bundled bank has eight different
 * room monsters (docs/designs/monster-catalog.md PR2), so one team walking it never meets a monster twice. */
export async function withRoom0MonsterAgainAt3(request: APIRequestContext, run: () => Promise<void>) {
  const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
  const original = structuredClone(bank);
  bank.rooms[3].monster = bank.rooms[0].monster;
  delete bank.randomMonsters; // the bank's own picks, not a fresh draw per game
  expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } })).ok()).toBe(true);
  try {
    await run();
  } finally {
    const { version: now } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    expect((await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: original, version: now } })).ok()).toBe(true);
  }
}

/** Playwright closes only its own `context` fixture: every context a test opens with browser.newContext() lives on
 * until the worker's browser closes. A shard then piles up every earlier test's host, phones and big screens, still
 * connected, animating and getting broadcasts from rooms whose games run on, until a 5 s wait in a later test times
 * out (narration-tts.spec.ts's second phone missing from its own roster). Each test starts with those closed. */
export function closeLeftoverContexts() {
  test.beforeEach(async ({ browser, context }) => {
    await Promise.all(browser.contexts().filter((c) => c !== context).map((c) => c.close()));
  });
}

/** For specs about the host judging by hand (keys, 答錯・下輪再答, a whole game driven by HOST_JUDGE):
 * every question becomes a text question (the correct option as the answer), since a
 * multipleChoice turn is judged by the phone's lock, not the host, and the bundled bank is all
 * multipleChoice. The whole bank is put back after each test, like restoreRoom0AfterEach.
 * `answer`, when given, replaces every answer (a spec that needs to know it, like the mage's hint). */
/** `bossDifficulty` marks every boss question with it (an unmarked one is 3, DC 12). */
export function textOnlyBank(answer?: string, bossDifficulty?: Difficulty) {
  let original: unknown;
  test.beforeEach(async ({ request }) => {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    original = bank;
    const text = asTextBank(bank, answer);
    if (bossDifficulty) text.boss.phases = text.boss.phases.map((p) => ({ ...p, questions: p.questions.map((q) => ({ ...q, difficulty: bossDifficulty })) }));
    const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: text, version } });
    expect(saved.ok()).toBe(true);
  });
  test.afterEach(async ({ request }) => {
    if (!original) return; // beforeEach failed before reading the bank: nothing to put back
    const { version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    const restored = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: original, version } });
    expect(restored.ok()).toBe(true);
    original = undefined;
  });
}

/** Advances every award with host actions; timers alone must never finish the podium. */
export async function advanceAwards(host: Page) {
  const step = host.getByTestId("host-step");
  await expect(step).toBeVisible();
  await expect(async () => {
    if (await step.isVisible() && await step.isEnabled()) await step.click();
    await expect(step).toHaveCount(0, { timeout: 100 });
  }).toPass({ timeout: 45000, intervals: [600] });
}

export async function advanceSocketAwards(host: WebSocket, cur: () => HostState) {
  await expect.poll(() => cur().podium?.beats).toBeTruthy();
  await expect.poll(() => {
    const state = cur();
    if (state.hold) host.send(JSON.stringify({ type: "HOST_STEP", eventId: state.eventId, step: state.hold.id }));
    return !state.hold;
  }, { timeout: 45000, intervals: [600] }).toBe(true);
}
