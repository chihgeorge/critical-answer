import { test } from "@playwright/test";
// TEMPORARY probe: log every /api/bank request and every navigation, with the page's own JS stack.
test.beforeEach(async ({ page }, info) => {
  const t0 = Date.now();
  const log = (s: string) => console.log(`PROBE ${info.title.slice(0, 30)} r${info.repeatEachIndex} +${Date.now() - t0}ms ${s}`);
  page.on("request", (r) => { if (/\/api\/bank$/.test(r.url())) log(`REQ ${r.method()}`); });
  page.on("requestfinished", (r) => { if (/\/api\/bank$/.test(r.url())) log(`DONE ${r.method()}`); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) log(`NAV ${f.url()}`); });
  page.on("console", (m) => { if (m.text().startsWith("FETCHSTACK")) log(m.text().slice(0, 600)); });
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = (...a) => { if (String(a[0]).endsWith("/api/bank")) console.log("FETCHSTACK " + (a[1]?.method ?? "GET") + " " + new Error().stack); return orig(...a); };
  });
});
