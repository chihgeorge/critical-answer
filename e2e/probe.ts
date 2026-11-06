// TEMPORARY flake probe (claude/e2e-flake-probe, never merged): logs page loads, console, sockets and bank
// requests per test, so a CI failure shows whether the page reloaded or a socket dropped mid-test.
import type { Page, TestInfo } from "@playwright/test";

const logs = new WeakMap<Page, string[]>();

export function attachProbe(page: Page) {
  const t0 = Date.now();
  const out: string[] = [];
  logs.set(page, out);
  const log = (s: string) => out.push(`+${Date.now() - t0}ms ${s}`);
  page.on("load", () => log(`LOAD ${page.url()}`));
  page.on("framenavigated", (f) => f === page.mainFrame() && log(`NAV ${f.url()}`));
  page.on("console", (m) => log(`CONSOLE ${m.type()} ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => log(`PAGEERROR ${e.message.slice(0, 200)}`));
  page.on("requestfailed", (r) => log(`REQFAIL ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.url().includes("/api/bank") && log(`HTTP ${r.request().method()} ${r.status()} ${r.url()}`));
  page.on("websocket", (ws) => {
    const id = Math.random().toString(36).slice(2, 6);
    log(`WS ${id} OPEN ${ws.url()}`);
    ws.on("framesent", (f) => log(`WS ${id} > ${String(f.payload).slice(0, 120)}`));
    ws.on("framereceived", (f) => log(`WS ${id} < ${String(f.payload).slice(0, 80)}`));
    ws.on("close", () => log(`WS ${id} CLOSE`));
  });
}

export function dumpProbe(page: Page, info: TestInfo) {
  const out = logs.get(page) ?? [];
  const loads = out.filter((l) => l.includes(" LOAD ")).length;
  const wsOpens = out.filter((l) => / WS \w+ OPEN /.test(l)).length;
  console.log(`PROBE ${info.status} loads=${loads} wsOpens=${wsOpens} :: ${info.title}`);
  if (info.status !== info.expectedStatus) console.log(out.map((l) => `PROBE   ${l}`).join("\n"));
}
