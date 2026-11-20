import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { InitiativeOverlay, RollOverlay } from "./d20";

afterEach(() => void vi.unstubAllGlobals());

it("covers initiative values until every team has rolled", () => {
  const html = renderToStaticMarkup(<InitiativeOverlay ini={{ rolls: { a: 20 }, left: 5000 }} teams={[{ id: "a", name: "甲隊" }, { id: "b", name: "乙隊" }]} />);
  expect(html).toContain("還有 1 隊沒擲");
  expect(html).not.toContain(">20</text>");
});

// Value: protects=QA B3: the initiative dice tumble in the lobby order, so the row does not give the order away before
// they land; fails_when=the dice are laid out in ini.order at once; no_claim=the sort after TUMBLE_MS (an effect)
it("lays the initiative dice out in the lobby order while they tumble", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) }); // TumbleDie reads it as it mounts
  const html = renderToStaticMarkup(<InitiativeOverlay ini={{ rolls: { a: 3, b: 18 }, order: ["b", "a"], left: 5000 }} teams={[{ id: "a", name: "甲隊" }, { id: "b", name: "乙隊" }]} />);
  expect(html.indexOf("甲隊")).toBeLessThan(html.indexOf("乙隊"));
});

it("starts the dish die tumble without flashing the result or a 20 hint", () => {
  const html = renderToStaticMarkup(<RollOverlay teamName="甲隊" value={20} kind="dish" />);
  expect(html).not.toContain("20 是大成功");
  expect(html).toContain("visibility:hidden");
  expect(html).not.toContain(">20</text>");
});
