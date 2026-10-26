import { test, expect, type Page } from "@playwright/test";
import { E2E_OWNER_KEY } from "../playwright.config";
import { asTextBank } from "../lib/text-bank";

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
    // The option's name is its letter then its text; anchor both ends, since "2 月 28 日" is inside "12 月 28 日".
    const name = new RegExp(`^[A-D]\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    await phone.getByRole("button", { name }).click();
    return phone.getByRole("button", { name: "鎖定答案" }).click();
  }
  throw new Error(`no phone in room ${code} is on turn`);
}

/** Puts room 0 back after each test in the calling file. The dev server's bank is shared by every
 * spec file, so a test that seeds or filters room 0 would otherwise change what later files deal. */
export function restoreRoom0AfterEach() {
  let original: unknown;
  test.beforeEach(async ({ request }) => {
    original = (await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json()).bank.pools["1"];
  });
  test.afterEach(async ({ request }) => {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    bank.pools["1"] = original;
    await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank, version } });
  });
}

/** For specs about the host judging by hand (keys, 答錯・重答, a whole game driven by HOST_JUDGE):
 * every question becomes a text question (the correct option as the answer), since a
 * multipleChoice turn is judged by the phone's lock, not the host, and the bundled bank is all
 * multipleChoice. The whole bank is put back after each test, like restoreRoom0AfterEach. */
export function textOnlyBank() {
  let original: unknown;
  test.beforeEach(async ({ request }) => {
    const { bank, version } = await (await request.get(`${WORKER}/api/bank`, { headers: HEADERS })).json();
    original = bank;
    const saved = await request.put(`${WORKER}/api/bank`, { headers: HEADERS, data: { bank: asTextBank(bank), version } });
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
