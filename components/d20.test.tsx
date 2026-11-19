import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InitiativeOverlay, RollOverlay } from "./d20";

it("covers initiative values until every team has rolled", () => {
  const html = renderToStaticMarkup(<InitiativeOverlay ini={{ rolls: { a: 20 }, left: 5000 }} teams={[{ id: "a", name: "甲隊" }, { id: "b", name: "乙隊" }]} />);
  expect(html).toContain("還有 1 隊沒擲");
  expect(html).not.toContain(">20</text>");
});

it("starts the dish die tumble without flashing the result or a 20 hint", () => {
  const html = renderToStaticMarkup(<RollOverlay teamName="甲隊" value={20} kind="dish" />);
  expect(html).not.toContain("20 是大成功");
  expect(html).toContain("visibility:hidden");
  expect(html).not.toContain(">20</text>");
});
