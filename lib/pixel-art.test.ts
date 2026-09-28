import { describe, expect, it } from "vitest";
import { drawHomeScene, homeSceneCell } from "./pixel-art";

// A stand-in canvas: drawHomeScene only sets width/height and asks for a 2D context, and returns
// early (no pixels flushed) when there is none, so the layout can be checked without a browser.
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement;

describe("homeSceneCell", () => {
  it("is a whole number between 4 and 7, so pixels stay square", () => {
    for (const [w, h] of [[320, 568], [390, 844], [820, 1180], [1440, 900], [1920, 800], [3840, 2160]]) {
      const c = homeSceneCell(w, h);
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(4);
      expect(c).toBeLessThanOrEqual(7);
    }
  });

  it("is chunkier on a laptop than on a phone", () => {
    expect(homeSceneCell(390, 844)).toBe(5);
    expect(homeSceneCell(1440, 900)).toBe(7);
  });
});

describe("drawHomeScene", () => {
  it.each([[78, 169], [206, 129], [275, 115], [117, 169], [40, 40]])("fits a %i×%i grid and hangs one torch on each side wall", (W, H) => {
    const cv = fakeCanvas();
    const { torches } = drawHomeScene(cv, W, H);
    expect([cv.width, cv.height]).toEqual([W, H]);
    expect(torches).toHaveLength(2);
    for (const t of torches) {
      expect(t.x).toBeGreaterThan(0);
      expect(t.x).toBeLessThan(W);
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThan(H);
    }
    expect(torches[0].x).toBeLessThan(W / 2);
    expect(torches[1].x).toBeGreaterThan(W / 2);
  });

  it("is seeded, so the same size always gives the same scene", () => {
    expect(drawHomeScene(fakeCanvas(), 120, 90)).toEqual(drawHomeScene(fakeCanvas(), 120, 90));
  });
});
