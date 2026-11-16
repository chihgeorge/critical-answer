// Post-deploy canary: plays one real game per round on a deployed site, as a host, a big screen and two phones.
// Run: npm run canary:live [-- --rounds N] [-- --base URL]   (or CANARY_BASE_URL=... ; default: production)
// It uses no owner key: it creates a room from the home page like any host, and ends the game with 結束冒險.
// The room itself is not deleted (there is no host control for that); the worker forgets it 6 hours after the
// first start (ROOM_EXPIRE_MS, docs/hosting.md), and its connections rest after 2 idle hours.
import { chromium, expect, type Browser, type Page } from "@playwright/test";

export const DEFAULT_BASE = "https://critical-answer.vercel.app";
const ROUND_BUDGET_MS = 180_000;
const UI_MS = 20_000;

export type Options = { base: string; rounds: number };

/** `--rounds N`, `--base URL` (or `--base=URL`), else CANARY_BASE_URL, else production. Throws on a bad value. */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): Options {
  const opts: Options = { base: env.CANARY_BASE_URL || DEFAULT_BASE, rounds: 1 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/);
    const value = () => inline ?? argv[++i];
    if (flag === "--rounds") {
      const v = value();
      opts.rounds = Number(v);
      if (!Number.isInteger(opts.rounds) || opts.rounds < 1) throw new Error(`--rounds must be a positive integer, got ${v}`);
    } else if (flag === "--base") opts.base = value() ?? "";
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!/^https?:\/\/[^/]/.test(opts.base)) throw new Error(`base URL must start with http(s)://, got ${opts.base}`);
  opts.base = opts.base.replace(/\/+$/, "");
  return opts;
}

export type PageResult = { round: number; name: string; status: number | null; ms: number; errs: string[] };
export type StepResult = { round: number; name: string; ok: boolean; ms: number; error?: string };

/** The report lines, in the old canary's shape, and whether the run is healthy (every step ok, no page errors). */
export function summarize(pages: PageResult[], steps: StepResult[]): { lines: string[]; healthy: boolean } {
  const lines = [
    ...steps.map((s) => `STEP r${s.round} ${s.name} ${s.ok ? "ok" : "FAIL"} ms=${s.ms}${s.error ? ` error=${JSON.stringify(s.error)}` : ""}`),
    ...pages.map((p) => `PAGE r${p.round} ${p.name} status=${p.status ?? "none"} ms=${p.ms} errs=${JSON.stringify(p.errs)}`),
  ];
  const healthy = steps.length > 0 && steps.every((s) => s.ok) && pages.every((p) => p.errs.length === 0 && p.status !== null && p.status < 400);
  lines.push(`CANARY ${healthy ? "HEALTHY" : "BROKEN"}`);
  return { lines, healthy };
}

const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 160);

async function round(browser: Browser, base: string, r: number, pages: PageResult[], steps: StepResult[]) {
  const contexts: Awaited<ReturnType<Browser["newContext"]>>[] = [];
  const results = new Map<string, PageResult>();
  const opened = new Map<string, Page>();
  // Each role gets its own context: phones that shared storage would come back as the same team.
  async function open(name: string, viewport: { width: number; height: number }): Promise<Page> {
    const ctx = await browser.newContext({ viewport, baseURL: base });
    contexts.push(ctx);
    const page = await ctx.newPage();
    const res: PageResult = { round: r, name, status: null, ms: 0, errs: [] };
    results.set(name, res);
    opened.set(name, page);
    pages.push(res);
    page.on("console", (m) => void (m.type() === "error" && res.errs.push(short(m.text()))));
    page.on("pageerror", (e) => res.errs.push(short(String(e))));
    return page;
  }
  async function load(page: Page, name: string, url: string) {
    const t = Date.now();
    const resp = await page.goto(url);
    const res = results.get(name)!;
    res.status = resp?.status() ?? null;
    res.ms = Date.now() - t;
    if (!resp || resp.status() >= 400) throw new Error(`${url} answered ${resp?.status() ?? "nothing"}`);
  }
  let failed = false;
  async function step(name: string, fn: () => Promise<void>, always = false) {
    if (failed && !always) return;
    const t = Date.now();
    try {
      await fn();
      steps.push({ round: r, name, ok: true, ms: Date.now() - t });
    } catch (e) {
      failed = true;
      // CANARY_SHOTS=<dir> keeps a screenshot of every page at the first failure, to see what each one showed.
      const dir = process.env.CANARY_SHOTS;
      if (dir) for (const [n, p] of opened) await p.screenshot({ path: `${dir}/r${r}-${name}-${n}.png` }).catch(() => {});
      steps.push({ round: r, name, ok: false, ms: Date.now() - t, error: short((e as Error).message) });
    }
  }

  const host = await open("host", { width: 1280, height: 900 });
  const screen = await open("screen", { width: 1920, height: 1080 });
  const phones = [await open("phone1", { width: 390, height: 844 }), await open("phone2", { width: 390, height: 844 })];
  const teams = ["CANARY-1", "CANARY-2"];
  let code = "";
  let started = false;
  let onTurn = 0;

  await step("create-room", async () => {
    await load(host, "host", "/");
    await host.getByRole("button", { name: /主持遊戲/ }).click();
    await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/, { timeout: UI_MS });
    code = host.url().match(/\/room\/([A-Z]{4})\//)![1];
  });
  await step("open-screen", async () => {
    const link = host.getByTestId("screen-link");
    await expect(link).toHaveAttribute("href", /\/screen#s=./, { timeout: UI_MS });
    await load(screen, "screen", (await link.getAttribute("href"))!);
    await expect(screen.getByText(code).first()).toBeVisible({ timeout: UI_MS });
  });
  for (const [i, phone] of phones.entries()) {
    await step(`join-${i + 1}`, async () => {
      await load(phone, `phone${i + 1}`, `/room/${code}/play?name=${encodeURIComponent(teams[i])}`);
      await expect(phone.getByText("等待主持人開始遊戲")).toBeVisible({ timeout: UI_MS });
      // 廚師 is passive, so no ability prompt can stall the turn.
      const card = phone.getByRole("button", { name: /廚師/ });
      await card.click();
      await expect(card).toHaveAttribute("aria-pressed", "true");
      await expect(host.getByText(teams[i]).first()).toBeVisible({ timeout: UI_MS });
      await expect(screen.getByText(teams[i]).first()).toBeVisible({ timeout: UI_MS });
    });
  }
  await step("start-game", async () => {
    await host.getByRole("checkbox", { name: "開始前播放玩法說明" }).uncheck();
    host.on("dialog", (d) => void (d.message().includes("確定要開始") ? d.accept() : d.dismiss()));
    await host.getByRole("button", { name: /開始遊戲/ }).click();
    started = true;
    await host.getByRole("button", { name: "🎲 全部代擲" }).click({ timeout: UI_MS });
    const ribbon = host.getByText(/輪到：CANARY-/);
    await expect(ribbon).toBeVisible({ timeout: UI_MS });
    onTurn = (await ribbon.textContent())!.includes(teams[0]) ? 0 : 1;
    await expect(screen.getByText(`輪到：${teams[onTurn]}`)).toBeVisible({ timeout: UI_MS });
    await expect(phones[onTurn].getByText("輪到我們了！")).toBeVisible({ timeout: UI_MS });
  });
  const team = () => phones[onTurn];
  const other = () => phones[1 - onTurn];
  let answer = "";
  await step("answer-correctly", async () => {
    // The host page shows the answer to the host (it is the host); the team then answers it.
    const hostAnswer = host.getByTestId("host-answer");
    await expect(hostAnswer).toBeVisible({ timeout: UI_MS });
    answer = (await hostAnswer.textContent())!.trim();
    const roll = team().getByTestId("roll-check");
    const lock = team().getByRole("button", { name: "鎖定答案" });
    const judge = host.getByRole("button", { name: "答對！" });
    // Locators on different pages cannot be or()-ed: poll for whichever shows first.
    const anyOf = (...ls: (typeof lock)[]) => expect.poll(async () => (await Promise.all(ls.map((l) => l.isVisible()))).some(Boolean), { timeout: UI_MS }).toBe(true);
    await anyOf(roll, lock, judge);
    if (await roll.isVisible()) {
      await roll.click();
      await anyOf(lock, judge);
    }
    if (await lock.isVisible()) {
      const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await team().getByRole("button", { name: new RegExp(`^[A-D]?\\s*${escaped}$`) }).click();
      await lock.click();
      const reveal = host.getByRole("button", { name: /公布答案/ });
      await expect(reveal).toBeEnabled({ timeout: UI_MS });
      await reveal.click();
    } else {
      await expect(judge).toBeEnabled({ timeout: UI_MS });
      await judge.click();
    }
    await expect(team().getByText(/答對了！/)).toBeVisible({ timeout: UI_MS });
  });
  await step("others-see-result", async () => {
    await expect(screen.getByText(`正解：${answer}`).first()).toBeVisible({ timeout: UI_MS });
    await expect(other().getByText(`正解：${answer}`).first()).toBeVisible({ timeout: UI_MS });
  });
  await step("next-turn", async () => {
    const serve = host.getByRole("button", { name: "🍲 上菜", exact: true });
    const next = host.getByRole("button", { name: "下一題", exact: true });
    // The host's ribbon moves on at the judgment; the big screen's waits for the reveal to close.
    const ribbon = screen.getByText(`輪到：${teams[1 - onTurn]}`);
    // Press 🍲 上菜 / 下一題 until the turn passes: a dish holds 下一題 while it cooks, and a random room event
    // (mystery room, fortune teller) can need another 下一題 once its card is up.
    await expect
      .poll(
        async () => {
          if (await ribbon.isVisible()) return true;
          if (await serve.isVisible()) await serve.click().catch(() => {});
          else if ((await next.isVisible()) && (await next.isEnabled())) await next.click().catch(() => {});
          return false;
        },
        { timeout: 60_000, intervals: [1000] },
      )
      .toBe(true);
    onTurn = 1 - onTurn;
    await expect(screen.getByText(`輪到：${teams[onTurn]}`)).toBeVisible({ timeout: UI_MS });
    await expect(team().getByText("輪到我們了！")).toBeVisible({ timeout: UI_MS });
  });
  // Runs even after a failure, so a broken round still ends its game instead of leaving it running.
  await step(
    "end-game",
    async () => {
      if (!started) return;
      await host.getByRole("button", { name: /更多/ }).first().click();
      const end = host.getByRole("button", { name: "結束冒險" });
      await end.click();
      await host.getByRole("button", { name: "確定結束？" }).click();
      for (const phone of phones) await expect(phone.getByText("遊戲結束！")).toBeVisible({ timeout: UI_MS });
    },
    true,
  );
  for (const ctx of contexts) await ctx.close();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env);
  console.log(`canary-live base=${opts.base} rounds=${opts.rounds}`);
  const browser = await chromium.launch({ headless: true });
  const pages: PageResult[] = [];
  const steps: StepResult[] = [];
  try {
    for (let r = 1; r <= opts.rounds; r++) {
      const t = Date.now();
      let timer: NodeJS.Timeout | undefined;
      const budget = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("round over budget")), ROUND_BUDGET_MS)));
      await Promise.race([round(browser, opts.base, r, pages, steps), budget]).catch((e) =>
        steps.push({ round: r, name: "round", ok: false, ms: Date.now() - t, error: short((e as Error).message) }),
      );
      clearTimeout(timer);
      console.log(`ROUND r${r} ms=${Date.now() - t}`);
    }
  } finally {
    await browser.close();
  }
  const { lines, healthy } = summarize(pages, steps);
  for (const line of lines) console.log(line);
  process.exit(healthy ? 0 : 1);
}

if (process.argv[1]?.endsWith("canary-live.ts")) {
  main().catch((e) => {
    console.error(e);
    console.log("CANARY BROKEN");
    process.exit(1);
  });
}
