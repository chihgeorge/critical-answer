import { expect, it } from "vitest";
import { INTRO_PAGE_TEXT } from "./how-to-play";

it("explains that boss fill-ins skip persuasion and crit rolls depend on the host setting", () => {
  expect(INTRO_PAGE_TEXT[1].big).toContain("一般房");
  expect(INTRO_PAGE_TEXT[1].script).toContain("首領房不用擲說服骰");
  expect(INTRO_PAGE_TEXT[1].script).toContain("若本場開啟暴擊骰");
});
