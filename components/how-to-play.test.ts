import { expect, it } from "vitest";
import { INTRO_PAGE_TEXT, introPauseKey } from "./how-to-play";
import { INTRO_PAGES } from "@/lib/protocol";

it("has the owner's 8 pages, boss fill-ins skip persuasion, and the flee is the single flee", () => {
  expect(INTRO_PAGE_TEXT.map((p) => p.topic)).toEqual(["輪流上陣・用手機作答", "選擇題", "填空題", "排序題", "答對後的料理骰", "幸運藥水", "職業骰", "答錯與怎麼贏"]);
  expect(INTRO_PAGE_TEXT).toHaveLength(INTRO_PAGES);
  expect(INTRO_PAGE_TEXT[2].script).toContain("首領房不用擲說服骰");
  expect(INTRO_PAGE_TEXT[4].script).toContain("最後一擊不擲");
  expect(INTRO_PAGE_TEXT[7].script).toContain("逃跑：換一隻怪，換簡單題");
  const all = INTRO_PAGE_TEXT.map((p) => p.script + p.big + p.owl).join("");
  expect(all).not.toMatch(/暴擊|答對骰|同房|換房/);
});

// Value: protects=quick 下一頁 presses are not eaten by the host page's double-tap guard (#328 m8), while 開始冒險 keeps it;
// fails_when=each page gets its own guard key again; seam=the host page's pauseKey; no_claim=the guard's 500 ms
it("turns pages under one guard key, and gives the last page's 開始冒險 its own", () => {
  const keys = Array.from({ length: INTRO_PAGES - 1 }, (_, i) => introPauseKey(i + 1));
  expect(new Set(keys).size).toBe(1);
  expect(introPauseKey(INTRO_PAGES)).not.toBe(keys[0]);
});
