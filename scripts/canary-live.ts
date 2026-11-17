// Post-deploy canary: plays one real game per round on a deployed site, as a host, a big screen and two phones.
// Run: npm run canary:live [-- --rounds N] [-- --turns N] [-- --boss] [-- --base URL]   (or CANARY_BASE_URL=... ; default: production)
// It uses no owner key: it creates a room from the home page like any host, and ends the game with 結束冒險.
// So it plays the site's default bank; to try other questions, put a bank into a local stack's default bank (docs/deployment.md).
// The room itself is not deleted (there is no host control for that); the worker forgets it 6 hours after the
// first start (ROOM_EXPIRE_MS, docs/hosting.md), and its connections rest after 2 idle hours.
import { chromium, expect, type Browser, type Locator, type Page } from "@playwright/test";

export const DEFAULT_BASE = "https://critical-answer.vercel.app";
/** Past this, a round skips its remaining steps (end-game still runs). Each step's own waits are bounded. */
const ROUND_BUDGET_MS = 150_000;
/** Each turn past the first adds this much to the round's budget. */
const TURN_BUDGET_MS = 60_000;
const UI_MS = 20_000;
const NEXT_TURN_MS = 60_000;
/** Longest one question may take, from its turn to its answer on the big screen. */
const ANSWER_MS = 60_000;
/** A buzzer song that has not opened this long after ▶ 播放 is skipped (the screen cannot play it). */
export const PLAY_WAIT_MS = 10_000;
/** Joins a music question's field answers (lib/question-bank.ts FIELD_SEP; this script runs on plain node, which
 * cannot load lib/'s extensionless imports). */
export const FIELD_SEP = "／";
const shown = (...ids: string[]) => ids.map((id) => `[data-testid="${id}"]:visible`).join(", ");
/** The big screen's answer: the answer card, or a music question's fields beside its player. */
const SCREEN_REVEAL = shown("answer-reveal", "reveal-fields");
/** What the big screen shows between one turn and the next: the answer or a boss phase card. */
const SCREEN_HOLDS = shown("answer-reveal", "reveal-fields", "phase-card");

export type Options = { base: string; rounds: number; turns: number; boss: boolean };

const positive = (flag: string, v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer, got ${v}`);
  return n;
};

/** `--rounds N`, `--turns N`, `--boss`, `--base URL` (or `--base=URL`), else CANARY_BASE_URL, else production. Throws on a bad value. */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): Options {
  const opts: Options = { base: env.CANARY_BASE_URL || DEFAULT_BASE, rounds: 1, turns: 1, boss: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/);
    const value = () => inline ?? argv[++i];
    if (flag === "--rounds") opts.rounds = positive(flag, value());
    else if (flag === "--turns") opts.turns = positive(flag, value());
    else if (flag === "--boss" && inline === undefined) opts.boss = true;
    else if (flag === "--base") opts.base = value() ?? "";
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!/^https?:\/\/[^/]/.test(opts.base)) throw new Error(`base URL must start with http(s)://, got ${opts.base}`);
  opts.base = opts.base.replace(/\/+$/, "");
  return opts;
}

export type PageResult = { round: number; name: string; status: number | null; ms: number; errs: string[] };
/** `note`: why an ok step did not do all of its work, e.g. a timing question the host skipped. */
export type StepResult = { round: number; name: string; ok: boolean; ms: number; error?: string; note?: string };

/** The STEP / PAGE / CANARY report lines (docs/deployment.md), and whether the run is healthy (every step ok, no page errors). */
export function summarize(pages: PageResult[], steps: StepResult[]): { lines: string[]; healthy: boolean } {
  const lines = [
    ...steps.map(
      (s) => `STEP r${s.round} ${s.name} ${s.ok ? "ok" : "FAIL"} ms=${s.ms}${s.error ? ` error=${JSON.stringify(s.error)}` : ""}${s.note ? ` note=${JSON.stringify(s.note)}` : ""}`,
    ),
    ...pages.map((p) => `PAGE r${p.round} ${p.name} status=${p.status ?? "none"} ms=${p.ms} errs=${JSON.stringify(p.errs)}`),
  ];
  const healthy = steps.length > 0 && steps.every((s) => s.ok) && pages.every((p) => p.errs.length === 0 && p.status !== null && p.status < 400);
  lines.push(`CANARY ${healthy ? "HEALTHY" : "BROKEN"}`);
  return { lines, healthy };
}

/** What the host, the big screen and the phones show right now, as far as answering the question goes. */
export type Seen = {
  /** The big screen shows the answer, or the team's phone says 答對了！. */
  revealed: boolean;
  /** A phone shows 遊戲結束！ (the boss fell). */
  over: boolean;
  /** The host waits on a team that answered wrong. */
  wrong: boolean;
  /** A boss phase card holds the next question until 下一題. */
  phaseCard: boolean;
  /** The host's 上菜 or 下一題 is up (an answer, a mystery room or a fortune card is on show). */
  next: boolean;
  /** The canary already answered this question (so a 下一題 means its answer is on the way, not a card). */
  acted: boolean;
  reveal: boolean;
  roll: boolean;
  checkFirst: boolean;
  hostRoll: boolean;
  fork: boolean;
  fortune: boolean;
  memory: boolean;
  fields: boolean;
  judge: boolean;
  sort: boolean;
  choice: boolean;
  buzz: boolean;
  buzzWaiting: boolean;
  tap: boolean;
  play: boolean;
  /** The canary already pressed ▶ 播放 on this question. */
  played: boolean;
  liveOpen: boolean;
  skip: boolean;
};

export type Action =
  | "over" | "done" | "wrong" | "next" | "card" | "reveal" | "roll" | "host-roll" | "fork" | "fortune" | "memory"
  | "fields" | "sort" | "choice" | "judge" | "buzz" | "play" | "live" | "skip" | "wait";

/** The next move on a question of any kind. It answers right when a phone or the host can (choice, sort, fill-in,
 * fields, a buzz), and falls back to the host's skip where nothing can be answered on purpose (a timing tap, a song
 * the big screen cannot play). `waitMs`: how long the song has had to start (since ▶ 播放, or since the phones first
 * showed 等音樂開始 when there is no ▶), or null. */
export function decide(s: Seen, waitMs: number | null): Action {
  if (s.over) return "over";
  if (s.revealed) return "done";
  if (s.wrong) return "wrong";
  if (s.phaseCard) return "next";
  if (s.reveal) return "reveal";
  if (s.roll) return "roll";
  if (s.fork) return "fork";
  if (s.fortune) return "fortune";
  // The host's 答對！ is live before the check and during a memory clip: answer neither early. The check comes first:
  // the room refuses ⏭ 直接出題 until it is done.
  if (s.checkFirst) return s.hostRoll ? "host-roll" : "wait";
  if (s.memory) return "memory";
  if (s.fields) return "fields";
  if (s.sort) return "sort";
  if (s.choice) return "choice";
  if (s.judge) return "judge";
  if (s.buzz) return "buzz";
  if (s.tap) return s.skip ? "skip" : "wait";
  if (s.buzzWaiting) {
    if (s.liveOpen) return "live";
    if (s.play && !s.played) return "play";
    return s.skip && waitMs !== null && waitMs > PLAY_WAIT_MS ? "skip" : "wait";
  }
  if (s.next) return s.acted ? "wait" : "card";
  return "wait";
}

/** The row to move down one place to bring `rows` closer to `want` (one bubble-sort swap), or null once in order. */
export function sortStep(rows: string[], want: string[]): number | null {
  for (let i = 0; i < rows.length - 1; i++) if (want.indexOf(rows[i]) > want.indexOf(rows[i + 1])) return i;
  return null;
}

/** answered: judged right and revealed. skipped: the host skipped it. passed: a card, no question. over: the game ended. */
export type Outcome = "answered" | "skipped" | "passed" | "over";

const visible = (l: Locator) => l.isVisible().catch(() => false);
const live = async (l: Locator) => (await visible(l)) && (await l.isEnabled().catch(() => false));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Clicks `l` until it is gone or disabled, so the next look never presses it twice. A press the room drops (sent with
 * the eventId of a STATE that had just moved on) leaves the button up: it is pressed again after a moment. */
async function press(l: Locator) {
  const until = Date.now() + UI_MS;
  await l.click({ timeout: UI_MS });
  for (;;) {
    const t = Date.now();
    while (Date.now() - t < 2500) {
      if (!(await live(l))) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (Date.now() > until) throw new Error(`${l} still up after a click`);
    await l.click({ timeout: 1000 }).catch(() => {});
  }
}

/** Plays the question (or card) up now until its answer is on the big screen. `setTeam` gets the phone that answers. */
async function playQuestion(host: Page, screen: Page, phones: Page[], setTeam: (i: number) => void): Promise<{ outcome: Outcome; answer: string; why?: string }> {
  const hostAnswer = host.getByTestId("host-answer");
  const lock = (p: Page) => p.getByRole("button", { name: "鎖定答案" });
  const onPhone = async (pick: (p: Page) => Locator, test: (l: Locator) => Promise<boolean> = visible) => {
    for (const [i, p] of phones.entries()) if (await test(pick(p))) return i;
    return -1;
  };
  const deadline = Date.now() + ANSWER_MS;
  let answer = "";
  let acted = false;
  let locked = false;
  // Judged by the host: during the killing blow's 4d20 beat its keys stay up, disabled, and must not be pressed again.
  let judged = false;
  let playedAt: number | null = null;
  let waitingSince: number | null = null;
  let wentLive = false;
  let last: Action = "wait";
  const team = { roll: -1, fork: -1, fortune: -1, sort: -1, choice: -1, buzz: -1 };
  for (;;) {
    if (Date.now() > deadline) throw new Error(`question not answered in ${ANSWER_MS / 1000} s (last move: ${last})`);
    team.roll = await onPhone((p) => p.getByTestId("roll-check"), live);
    team.fork = await onPhone((p) => p.getByTestId("phone-fork-left"), live);
    team.fortune = await onPhone((p) => p.getByTestId("phone-fortune").getByRole("button").first(), live);
    // Visible, not live: disabled until an option is picked. Once locked it stays up, so it is not picked again.
    team.choice = locked ? -1 : await onPhone(lock);
    team.sort = team.choice >= 0 && (await visible(phones[team.choice].getByTestId("sort-item-0"))) ? team.choice : -1;
    team.buzz = await onPhone((p) => p.getByTestId("buzz").getByRole("button"), live);
    const s: Seen = {
      // The big screen only: a buzz winner's phone keeps 答對了！選下一首的類別 into the next question.
      revealed: (await screen.locator(SCREEN_REVEAL).count()) > 0,
      over: (await onPhone((p) => p.getByText("遊戲結束！").first())) >= 0,
      wrong: await visible(host.getByText(/答錯！等|答錯了！等|答錯！首領換一題/).first()),
      phaseCard: await visible(screen.getByTestId("phase-card")),
      next: (await visible(host.getByRole("button", { name: "🍲 上菜", exact: true }))) || (await live(host.getByRole("button", { name: "下一題", exact: true }))),
      acted,
      reveal: await live(host.getByRole("button", { name: /公布答案/ })),
      roll: team.roll >= 0,
      checkFirst: await visible(host.getByTestId("host-check-first")),
      hostRoll: await live(host.getByTestId("host-roll-check")),
      fork: team.fork >= 0,
      fortune: team.fortune >= 0,
      memory: await live(host.getByRole("button", { name: "⏭ 直接出題" })),
      fields: !judged && await visible(host.getByTestId("host-field-judge")),
      judge: !judged && await live(host.getByRole("button", { name: "答對！" })),
      sort: team.sort >= 0,
      choice: team.choice >= 0,
      buzz: team.buzz >= 0,
      buzzWaiting: (await onPhone((p) => p.getByTestId("buzz").getByText("等音樂開始…"))) >= 0,
      tap: (await onPhone((p) => p.getByTestId("tap"))) >= 0,
      play: await live(host.getByRole("button", { name: "播放", exact: true })),
      played: playedAt !== null,
      liveOpen: await live(host.getByRole("button", { name: "🎤 現場放歌，開放搶答" })),
      skip: await live(host.getByRole("button", { name: "沒人答對，換下一題" })),
    };
    if (s.buzzWaiting) waitingSince ??= Date.now();
    const since = playedAt ?? waitingSince;
    const action = decide(s, since === null ? null : Date.now() - since);
    if (action !== "wait") last = action;
    // The host page shows the answer to the host (it is the host). It can lag the phones by one message, and the
    // judgment moves it on, so keep reading it until the canary acted on one.
    if (action !== "over" && !(acted && answer) && (await visible(hostAnswer))) answer = ((await hostAnswer.textContent()) ?? "").trim() || answer;
    if ((action === "choice" || action === "sort") && !answer) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    switch (action) {
      case "over":
        return { outcome: "over", answer, why: "game over" };
      case "done":
        // An answer the canary never gave (or never read) checks nothing afterwards: that is a broken turn, not a pass.
        if (!acted || !answer) throw new Error("the answer was revealed before the canary answered");
        return { outcome: "answered", answer, why: wentLive ? "the big screen could not play the song: the host opened the buzz live" : undefined };
      case "card": {
        const card = (await visible(screen.getByTestId("event-result"))) ? "mystery room" : (await visible(screen.getByTestId("fortune-screen"))) ? "fortune teller" : null;
        if (!card) throw new Error("the host moved on before the question was answered");
        return { outcome: "passed", answer, why: `${card}, no question` };
      }
      case "wrong":
        throw new Error("the host waits on a wrong answer");
      case "next":
        await press(host.getByRole("button", { name: "下一題", exact: true }));
        break;
      case "reveal":
        acted = true;
        await press(host.getByRole("button", { name: /公布答案/ }));
        break;
      case "roll":
        acted = true;
        setTeam(team.roll);
        await press(phones[team.roll].getByTestId("roll-check"));
        break;
      case "host-roll":
        acted = true;
        await press(host.getByTestId("host-roll-check"));
        break;
      case "fork":
        await press(phones[team.fork].getByTestId("phone-fork-left"));
        break;
      case "fortune":
        await press(phones[team.fortune].getByTestId("phone-fortune").getByRole("button").first());
        break;
      case "memory":
        await press(host.getByRole("button", { name: "⏭ 直接出題" }));
        break;
      case "fields": {
        judged = true;
        acted = true;
        const judge = host.getByTestId("host-field-judge");
        for (const right of await judge.getByRole("button", { name: /答對$/ }).all()) await right.click();
        await press(judge.getByRole("button", { name: /^送出判定/ }));
        break;
      }
      case "sort": {
        locked = true;
        acted = true;
        setTeam(team.sort);
        const phone = phones[team.sort];
        const want = answer.split("→").map((t) => t.trim());
        const rows = async () => (await phone.locator('[data-testid^="sort-item-"] > span').allTextContents()).map((t) => t.trim());
        for (let i = sortStep(await rows(), want), n = 0; i !== null && n < want.length ** 2 && Date.now() < deadline; n++) {
          const before = await rows();
          await phone.getByTestId(`sort-item-${i}`).getByRole("button").press("ArrowDown");
          await expect.poll(rows, { timeout: UI_MS }).not.toEqual(before);
          i = sortStep(await rows(), want);
        }
        await press(lock(phone));
        break;
      }
      case "choice": {
        locked = true;
        acted = true;
        setTeam(team.choice);
        const phone = phones[team.choice];
        // The option's name is its letter then its text; anchor both ends, since "2 月 28 日" is inside "12 月 28 日".
        await phone.getByRole("button", { name: new RegExp(`^[A-D]?\\s*${escape(answer)}$`) }).click({ timeout: UI_MS });
        await press(lock(phone));
        break;
      }
      case "judge":
        judged = true;
        acted = true;
        await press(host.getByRole("button", { name: "答對！" }));
        break;
      case "buzz":
        setTeam(team.buzz);
        await press(phones[team.buzz].getByTestId("buzz").getByRole("button"));
        break;
      case "play":
        playedAt = Date.now();
        await host.getByRole("button", { name: "播放", exact: true }).click({ timeout: UI_MS });
        break;
      case "live":
        wentLive = true;
        await press(host.getByRole("button", { name: "🎤 現場放歌，開放搶答" }));
        break;
      case "skip": {
        // The next buzzer question has the same button, so wait for the question to change, not the button to go.
        // With its answer: song questions often share one prompt (這首歌的歌名和歌手是？).
        const question = async () =>
          (await Promise.all([host.getByTestId("host-question"), hostAnswer].map((l) => l.textContent({ timeout: 500 }).catch(() => "")))).join("|");
        const before = await question();
        await host.getByRole("button", { name: "沒人答對，換下一題" }).click({ timeout: UI_MS });
        await expect.poll(question, { timeout: UI_MS, message: "the host's skip left the question up" }).not.toBe(before);
        return { outcome: "skipped", answer, why: s.tap ? "timing question: the host skipped it" : "the song did not start: the host skipped it" };
      }
      case "wait":
        await new Promise((r) => setTimeout(r, 250));
    }
  }
}

const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 160);

type Context = Awaited<ReturnType<Browser["newContext"]>>;

/** A silent speechSynthesis (a copy of e2e/tts.ts stubSpeechSynthesis): headless Chromium on macOS reads the big
 * screen's narration aloud. Each line still ends a moment later, so the narration queue moves as with a real voice. */
function silenceSpeech() {
  const voice = { lang: "zh-TW", name: "Canary zh-TW Voice", default: true } as SpeechSynthesisVoice;
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [voice],
      addEventListener: () => {},
      removeEventListener: () => {},
      speak: (utter: SpeechSynthesisUtterance) => void setTimeout(() => utter.onend?.(new Event("end") as SpeechSynthesisEvent), 50),
      cancel: () => {},
    },
  });
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    lang = "";
    onend: ((e: SpeechSynthesisEvent) => void) | null = null;
    onerror: ((e: SpeechSynthesisErrorEvent) => void) | null = null;
    constructor(text = "") {
      this.text = text;
    }
  };
}

/** One game. The caller closes `contexts`, so they close even when something throws outside `step()`. */
async function round(browser: Browser, { base, turns, boss }: Options, r: number, pages: PageResult[], steps: StepResult[], contexts: Context[]) {
  const results = new Map<string, PageResult>();
  const opened = new Map<string, Page>();
  // Each role gets its own context: phones that shared storage would come back as the same team.
  async function open(name: string, viewport: { width: number; height: number }): Promise<Page> {
    const ctx = await browser.newContext({ viewport, baseURL: base });
    contexts.push(ctx);
    await ctx.addInitScript(silenceSpeech);
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
    // Without the #fragment: the screen link carries the room's screen key.
    if (!resp || resp.status() >= 400) throw new Error(`${url.split("#")[0]} answered ${resp?.status() ?? "nothing"}`);
  }
  let failed = false;
  const deadline = Date.now() + ROUND_BUDGET_MS + (turns - 1) * TURN_BUDGET_MS;
  /** `fn` may return a note: why the step did less than all of its work. */
  async function step(name: string, fn: () => Promise<string | void>, always = false) {
    if (failed && !always) return;
    const t = Date.now();
    try {
      if (!always && t > deadline) throw new Error("round over budget");
      const note = await fn();
      steps.push({ round: r, name, ok: true, ms: Date.now() - t, ...(note ? { note } : {}) });
    } catch (e) {
      // CANARY_SHOTS=<dir> keeps a screenshot of every page at the first failure, to see what each one showed.
      const dir = process.env.CANARY_SHOTS;
      if (dir && !failed) for (const [n, p] of opened) await p.screenshot({ path: `${dir}/r${r}-${name}-${n}.png` }).catch(() => {});
      failed = true;
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
  let over = false;

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
  if (boss) {
    // 送王房 (⚙ 更多): CANARY-1, which joined first, plays the boss's questions on its turns from now on.
    await step("send-to-boss", async () => {
      await host.getByRole("button", { name: /更多/ }).first().click();
      await host.getByRole("button", { name: "送王房" }).first().click();
      await host.getByRole("button", { name: "確定送？" }).click();
      await host.getByRole("button", { name: "關閉" }).first().click();
    });
  }
  const team = () => phones[onTurn];
  const other = () => phones[1 - onTurn];
  const ribbon = async () => (await host.locator(".px-ribbon").first().textContent({ timeout: 500 }).catch(() => "")) ?? "";
  /** The host's ribbon, question and answer. They move on at the judgment, so the key is read before answering. */
  const hostKey = async () =>
    [await ribbon(), ...(await Promise.all([host.getByTestId("host-question"), host.getByTestId("host-answer")].map((l) => l.textContent({ timeout: 500 }).catch(() => ""))))].join("|");
  const ribbonTeam = (text: string) => teams.findIndex((t) => text.includes(`輪到：${t}`));
  for (let t = 1; t <= turns && !over; t++) {
    const name = (s: string) => (t === 1 ? s : `${s}-t${t}`);
    let played: Awaited<ReturnType<typeof playQuestion>> = { outcome: "answered", answer: "" };
    let key = "";
    await step(name("answer-correctly"), async () => {
      key = await hostKey();
      played = await playQuestion(host, screen, phones, (i) => (onTurn = i));
      over = played.outcome === "over";
      // Only the boss falling ends a game: anywhere else, a game that ended by itself is a broken site.
      if (over && !key.includes("首領戰")) throw new Error("the game ended outside the boss room");
      if (played.outcome !== "answered") return `${played.outcome}: ${played.why}`;
      return played.why && `answered: ${played.why}`;
    });
    await step(name("others-see-result"), async () => {
      if (played.outcome !== "answered") return `skipped: the question was ${played.outcome}`;
      // The phones show 正解：<answer> on every kind; the big screen lists a music question's fields one by one.
      const reveal = screen.locator(SCREEN_REVEAL).first();
      for (const part of played.answer.split(FIELD_SEP)) await expect(reveal).toContainText(part.trim(), { timeout: UI_MS });
      await expect(other().getByText(`正解：${played.answer}`).first()).toBeVisible({ timeout: UI_MS });
    });
    if (over) break;
    await step(name("next-turn"), async () => {
      const serve = host.getByRole("button", { name: "🍲 上菜", exact: true });
      const next = host.getByRole("button", { name: "下一題", exact: true });
      const prevTeam = ribbonTeam(key);
      // Press 🍲 上菜 / 下一題 until the reveal is gone and the host shows another turn: a dish holds 下一題 while it
      // cooks, and a random room event (mystery room, fortune teller) or a boss phase card needs another 下一題.
      // The host's ribbon moves on at the judgment, so the turn has passed only once the host's key changed and
      // nothing is left to close, twice in a row: between 上菜 and the dish's 下一題 nothing shows for a moment.
      let clear = 0;
      await expect
        .poll(
          async () => {
            if (await visible(phones[0].getByText("遊戲結束！").first())) return (over = true);
            // The big screen is back on a turn: no answer or phase card up, and its ribbon names a turn, not the team eating.
            const closed =
              (await screen.locator(SCREEN_HOLDS).count()) === 0 && /輪到：|搶答|卡點題/.test((await screen.locator(".px-ribbon").first().textContent({ timeout: 500 }).catch(() => "")) ?? "");
            if (await visible(serve)) await serve.click().catch(() => {});
            else if (await visible(next)) await next.click({ timeout: 500 }).catch(() => {}); // disabled while the dish cooks
            else if (closed && (await hostKey()) !== key) return ++clear >= 2;
            clear = 0;
            return false;
          },
          { timeout: NEXT_TURN_MS, intervals: [1000] },
        )
        .toBe(true);
      if (over) {
        if (!key.includes("首領戰")) throw new Error("the game ended outside the boss room");
        return "skipped: game over";
      }
      const text = await ribbon();
      const now = ribbonTeam(text);
      if (now < 0) {
        if (/搶答|卡點題/.test(text)) return; // a buzzer question: every team is up
        throw new Error(`the host's ribbon names no team: ${JSON.stringify(text)}`);
      }
      // With two teams, a stun picked at the fortune teller gives the turn straight back.
      const stunPossible = played.outcome === "passed" && played.why?.startsWith("fortune");
      if (prevTeam >= 0 && now === prevTeam && !stunPossible) throw new Error(`the turn stayed with ${teams[now]}`);
      onTurn = now;
      await expect(screen.getByText(`輪到：${teams[onTurn]}`)).toBeVisible({ timeout: UI_MS });
      await expect(team().getByText("輪到我們了！")).toBeVisible({ timeout: UI_MS });
    });
  }
  // Runs even after a failure, so a broken round still ends its game instead of leaving it running.
  await step(
    "end-game",
    async () => {
      if (!started) return;
      if (over || (await visible(phones[0].getByText("遊戲結束！").first()))) return "skipped: the game is already over";
      // A failed step may have left ⚙ 更多 open: start from a closed drawer.
      await host.keyboard.press("Escape").catch(() => {});
      await host.getByRole("button", { name: /更多/ }).first().click();
      const end = host.getByRole("button", { name: "結束冒險" });
      await end.click();
      await host.getByRole("button", { name: "確定結束？" }).click();
      for (const phone of phones) await expect(phone.getByText("遊戲結束！")).toBeVisible({ timeout: UI_MS });
    },
    true,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env);
  console.log(`canary-live base=${opts.base} rounds=${opts.rounds} turns=${opts.turns}${opts.boss ? " boss" : ""}`);
  const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
  const pages: PageResult[] = [];
  const steps: StepResult[] = [];
  try {
    for (let r = 1; r <= opts.rounds; r++) {
      const t = Date.now();
      const contexts: Context[] = [];
      await round(browser, opts, r, pages, steps, contexts)
        .catch((e) => steps.push({ round: r, name: "round", ok: false, ms: Date.now() - t, error: short((e as Error).message) }))
        .finally(() => Promise.allSettled(contexts.map((c) => c.close())));
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
