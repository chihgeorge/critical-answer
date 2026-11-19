import { expect, it } from "vitest";
import { INTRO_PAGE_TEXT, introPauseKey } from "./how-to-play";
import { INTRO_PAGES } from "@/lib/protocol";

const page = (topic: string) => INTRO_PAGE_TEXT.find((p) => p.topic === topic)!;

it("explains that boss fill-ins skip persuasion and the host can turn the crit die off", () => {
  expect(page("用手機作答").big).toContain("一般房");
  expect(page("說服擲骰檢定").script).toContain("首領房不用擲說服骰");
  expect(page("暴擊骰").script).toContain("主持人可以在大廳關掉暴擊骰");
});

// Value: protects=quick 下一頁 presses are not eaten by the host page's double-tap guard (#328 m8), while 開始冒險 keeps it;
// fails_when=each page gets its own guard key again; seam=the host page's pauseKey; no_claim=the guard's 500 ms
it("turns pages under one guard key, and gives the last page's 開始冒險 its own", () => {
  const keys = Array.from({ length: INTRO_PAGES - 1 }, (_, i) => introPauseKey(i + 1));
  expect(new Set(keys).size).toBe(1);
  expect(introPauseKey(INTRO_PAGES)).not.toBe(keys[0]);
});
