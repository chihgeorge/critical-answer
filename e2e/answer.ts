import { test, expect, type Page } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";
import { asTextBank } from "../lib/text-bank";

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };

/** 擲骰說服 on a fill-in question (dnd design R6): the answer box shows once the check's beat ends. The e2e
 * worker fixes every d20 at 10 (playwright.config.ts E2E_DIE), so the check passes a room's DC and never wins outright. */
export async function rollCheck(team: Page) {
  await team.getByTestId("roll-check").click();
  await expect(team.getByRole("textbox", { name: "你們的答案" })).toBeVisible({ timeout: 5000 });
}

/** 開始遊戲 without the how-to-play intro, the way every test but the intro's own starts a game
 * (docs/designs/how-to-play.md eng D6). The intro itself is tested in host-controls.spec.ts. */
export async function startGame(host: Page) {
  const intro = host.getByRole("checkbox", { name: "開始前播放玩法說明" });
  await intro.uncheck();
  await host.getByRole("button", { name: /開始遊戲/ }).click();
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
    return judge.click();
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
    // A right lock is judged after two beats: the reveal (2 s), then the crit die (2 s). Wait them out here, so
    // callers see the judged state with their own default timeouts.
    return expect(host.getByTestId("host-mc-status")).toHaveCount(0, { timeout: 10_000 });
  }
  throw new Error(`no phone in room ${code} is on turn`);
}

/** The host presses 公布答案 on the waiting lock (docs/designs/host-reveal.md): nothing is judged until then. */
export async function revealLock(host: Page) {
  const reveal = host.getByRole("button", { name: /公布答案/ });
  await expect(reveal).toBeEnabled();
  await reveal.click();
}

/** What a raw host socket keeps from the room's STATE messages, enough to judge every turn. */
export type HostState = { type: string; phase: string; eventId: number; view: { bossCurrentQuestionId: string; teams: { id: string; inBossPhase: boolean; currentQuestionId: string }[] } };

/** Over a raw host socket, judges a one-team game correct turn after turn until it finishes (the boss kill, after its dice).
 * `onTurn` runs before each judge, e.g. to check the screen once the boss door opens. */
export async function judgeToTheEnd(host: WebSocket, cur: () => HostState, onTurn?: (team: HostState["view"]["teams"][number]) => Promise<void>) {
  for (let i = 0; i < 200 && cur().phase === "playing"; i++) {
    const t = cur().view.teams[0];
    await onTurn?.(t);
    const qid = t.inBossPhase ? cur().view.bossCurrentQuestionId : t.currentQuestionId;
    const before = cur().eventId;
    host.send(JSON.stringify({ type: "HOST_NEXT", eventId: cur().eventId })); // close the previous answer reveal (D7); no-op if none
    host.send(JSON.stringify({ type: "HOST_JUDGE", teamId: t.id, questionId: qid, correct: true }));
    // The killing blow is judged only after its 4d20 beat (4 s, docs/designs/kill-roll.md).
    await expect.poll(() => cur().eventId, { timeout: 6000 }).toBeGreaterThan(before);
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

/** For specs about the host judging by hand (keys, 答錯・重答, a whole game driven by HOST_JUDGE):
 * every question becomes a text question (the correct option as the answer), since a
 * multipleChoice turn is judged by the phone's lock, not the host, and the bundled bank is all
 * multipleChoice. The whole bank is put back after each test, like restoreRoom0AfterEach.
 * `answer`, when given, replaces every answer (a spec that needs to know it, like the mage's hint). */
export function textOnlyBank(answer?: string) {
  let original: unknown;
  test.beforeEach(async ({ request }) => {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    original = bank;
    const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: asTextBank(bank, answer), version } });
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
