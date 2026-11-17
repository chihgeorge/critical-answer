import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classicArtRequested, drawScene, type SceneOptions, type SceneTheme } from "./pixel-art";

/** The RGBA `drawScene` writes, without a browser. */
function scene(theme: SceneTheme, W: number, H: number, arch: boolean | "fork", opts: SceneOptions) {
  let data: Uint8ClampedArray = new Uint8ClampedArray(0);
  const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img: { data: Uint8ClampedArray }) => (data = img.data) };
  const cv = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  drawScene(cv, theme, W, H, arch, opts);
  return data;
}
const hash = (d: Uint8ClampedArray) => createHash("sha256").update(d).digest("hex").slice(0, 16);
/** Mean luma (0–255) of the opaque pixels in rows [y0, y1). */
const luma = (d: Uint8ClampedArray, W: number, y0: number, y1: number) => {
  let sum = 0;
  let n = 0;
  for (let i = y0 * W * 4; i < y1 * W * 4; i += 4) {
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++;
  }
  return sum / n;
};

// Value: protects=the revert switch (DUNGEON_ART=false or ?art=classic) still draws the exact scene from before v0.81
// (docs/designs/dungeon-scene.md); fails_when=a shared refactor changes a classic pixel; why_new=new revert path;
// seam=a canvas stand-in that keeps the pixels Px.flush writes, hashes taken on main before the change; no_claim=how
// either look reads on the event TV
describe("the classic scene", () => {
  it.each([
    ["stone", 160, 90, true, "886a22972df2cd9f"],
    ["moss", 160, 90, false, "04a5416d3ab07941"],
    ["crimson", 160, 90, true, "3f339b12e627f3aa"],
    ["stone", 160, 90, "fork", "825d385a44b253aa"],
    ["moss", 160, 90, "fork", "6b0e841efccdc1e2"],
    ["stone", 48, 100, false, "08736250faaf3aa9"],
    ["crimson", 48, 100, false, "8b7bdff0facd1aa1"],
  ] as const)("%s %ix%i arch=%s is the old picture", (theme, W, H, arch, want) => {
    expect(hash(scene(theme, W, H, arch, { classic: true }))).toBe(want);
  });

  it("draws deep as stone (deep is new)", () => {
    expect(hash(scene("deep", 160, 90, true, { classic: true }))).toBe("886a22972df2cd9f");
  });
});

// Value: protects=the TV darkness floor agreed in review: the lit wall, away from any torch, is no darker than the
// old wall under the host's 🌑 (DIM_ALPHA 0.4), and the boss room is darker than a normal room; fails_when=an ambient
// or palette change crushes the wall; why_new=new look; seam=same stand-in; no_claim=what the event TV does to it
describe("the torch-lit scene", () => {
  const WALL = [6, 40] as const; // under the ceiling band, above the arch's crown: the wall the question screen shows
  it.each(["stone", "moss", "deep", "crimson"] as const)("%s wall is at least the old wall under 🌑", (theme) => {
    const old = luma(scene(theme === "deep" ? "stone" : theme, 160, 90, true, { classic: true }), 160, ...WALL) * 0.6;
    expect(luma(scene(theme, 160, 90, true, { lights: false }), 160, ...WALL)).toBeGreaterThanOrEqual(old * 0.95);
  });

  it("the boss room is the darkest", () => {
    const wall = (t: SceneTheme) => luma(scene(t, 160, 90, true, {}), 160, ...WALL);
    // gstack-timing-ok: compares wall brightness (luma), not elapsed time
    expect(wall("crimson")).toBeLessThan(Math.min(wall("stone"), wall("moss"), wall("deep")));
  });

  it("lighting the torches brightens the wall beside them", () => {
    const at = (lights: SceneOptions["lights"]) => luma(scene("stone", 160, 90, true, { lights }), 160, 20, 40);
    expect(at("high")).toBeGreaterThan(at(false));
  });
});

describe("classicArtRequested", () => {
  it("asks for the old look only with ?art=classic", () => {
    expect(classicArtRequested("")).toBe(false);
    expect(classicArtRequested("?art=classic")).toBe(true);
    expect(classicArtRequested("?x=1&art=classic")).toBe(true);
    expect(classicArtRequested("?art=new")).toBe(false);
  });
});
