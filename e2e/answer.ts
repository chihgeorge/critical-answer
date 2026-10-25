import { test, expect, type Page } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";

const WORKER = "http://localhost:1996";
const HEADERS = { Authorization: `Bearer ${E2E_OWNER_KEY}` };

/** Answers the current turn correctly, whatever kind of question was dealt: the host presses 答對！
 * on a text question; on a multipleChoice one the host can't judge (docs/designs/phone-answering.md),
 * so the team on turn taps the right option on its phone and locks it. The phone is found among
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
    await phone.getByRole("button", { name: answer }).click();
    return phone.getByRole("button", { name: "鎖定答案" }).click();
  }
  throw new Error(`no phone in room ${code} is on turn`);
}

/** Puts room 0 back after each test in the calling file. The dev server's bank is shared by every
 * spec file, so a test that seeds or filters room 0 would otherwise change what later files deal. */
export function restoreRoom0AfterEach() {
  let original: unknown;
  test.beforeEach(async ({ request }) => {
    original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank.rooms[0].questions;
  });
  test.afterEach(async ({ request }) => {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    bank.rooms[0].questions = original;
    await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  });
}

/** For specs about the host judging by hand (keys, 答錯・重答): room 0 keeps only its text
 * questions, since a multipleChoice turn is judged by the phone's lock, not the host. */
export function textOnlyRoom0() {
  restoreRoom0AfterEach();
  test.beforeEach(async ({ request }) => {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    bank.rooms[0].questions = bank.rooms[0].questions.filter((q: { kind: string }) => q.kind !== "multipleChoice");
    const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
    expect(saved.ok()).toBe(true);
  });
}
