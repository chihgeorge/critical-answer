import { expect, it } from "vitest";
import { INTRO_PAGE_TEXT } from "./how-to-play";

const page = (topic: string) => INTRO_PAGE_TEXT.find((p) => p.topic === topic)!;

it("explains that boss fill-ins skip persuasion and the host can turn the crit die off", () => {
  expect(page("用手機作答").big).toContain("一般房");
  expect(page("說服擲骰檢定").script).toContain("首領房不用擲說服骰");
  expect(page("暴擊骰").script).toContain("主持人可以在大廳關掉暴擊骰");
});
