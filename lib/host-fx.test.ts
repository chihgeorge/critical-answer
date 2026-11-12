import { describe, expect, it, vi } from "vitest";
import { hostPad, playHostEffect, type HostFxDeps } from "./host-fx";
import { createFlashBudget, FLASH_MAX, FLASH_WINDOW_MS } from "./flash-budget";
import { heartbeatTimes } from "./boss-fx";
import { GROWL, THUNDER } from "./sfx";
import { parseClientMessage } from "./protocol";

const deps = (o: Partial<HostFxDeps> = {}): HostFxDeps => ({
  clipPlaying: false,
  reducedMotion: false,
  transitionUp: false,
  shaking: false,
  takeFlash: () => true,
  playCue: vi.fn(),
  show: vi.fn(),
  ...o,
});

describe("playHostEffect (immersion.md PR2)", () => {
  it("drops the press while this screen's own clip plays: no sound, nothing shown", () => {
    const d = deps({ clipPlaying: true });
    expect(playHostEffect("thunder", d)).toBeNull();
    expect(d.playCue).not.toHaveBeenCalled();
    expect(d.show).not.toHaveBeenCalled();
  });

  it.each([
    ["thunder with budget", "thunder", {}, "flash"],
    ["thunder, budget spent", "thunder", { takeFlash: () => false }, "tint"],
    ["thunder, reduced motion", "thunder", { reducedMotion: true }, "tint"],
    ["thunder over a transition", "thunder", { transitionUp: true }, "tint"],
    ["growl", "growl", {}, "shake"],
    ["growl, reduced motion", "growl", { reducedMotion: true }, "tint"],
    ["growl while another shake runs", "growl", { shaking: true }, "tint"],
    ["growl over a transition", "growl", { transitionUp: true }, "tint"],
  ] as const)("%s → %s", (_, effect, o, look) => {
    const d = deps(o);
    expect(playHostEffect(effect, d)).toEqual({ effect, look });
    expect(d.playCue).toHaveBeenCalledWith(effect);
  });

  it("reduced motion never asks the budget, and growl never spends a flash", () => {
    const takeFlash = vi.fn(() => true);
    playHostEffect("thunder", deps({ reducedMotion: true, takeFlash }));
    playHostEffect("growl", deps({ takeFlash }));
    expect(takeFlash).not.toHaveBeenCalled();
  });

  it("a throwing audio call is logged and never escapes", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ playCue: () => { throw new Error("audio"); } });
    expect(() => playHostEffect("growl", d)).not.toThrow();
    expect(err).toHaveBeenCalledWith("[fx] host-effect", expect.any(Error));
    err.mockRestore();
  });

  it("heartbeat at its fastest plus thunder presses never flash more than 3 times in any second", () => {
    let now = 0;
    const budget = createFlashBudget(() => now);
    const lit: number[] = [];
    const events = [
      ...heartbeatTimes(5).map((t) => ({ at: t * 1000, take: () => budget.take() })),
      // The room lets one thunder through per second; press every second through the clock's last seconds.
      ...[0, 1000, 2000, 3000, 4000].map((at) => ({ at: at + 50, take: () => playHostEffect("thunder", deps({ takeFlash: () => budget.take() }))?.look === "flash" })),
    ].sort((a, b) => a.at - b.at);
    for (const e of events) {
      now = e.at;
      if (e.take()) lit.push(now);
    }
    for (const t of lit) expect(lit.filter((x) => x >= t && x < t + FLASH_WINDOW_MS).length).toBeLessThanOrEqual(FLASH_MAX);
    expect(lit.length).toBeGreaterThan(0);
  });
});

describe("hostPad labels", () => {
  const base = { clipPlaying: false, sound: "ready" as const, sent: null, online: true };
  it.each([
    ["ready", base, "⚡ 雷聲", false],
    ["lobby (no screenSound)", { ...base, sound: undefined }, "⚡ 雷聲", false],
    ["muted screen", { ...base, sound: "muted" as const }, "⚡ 雷聲 🔇", false],
    ["no big screen", { ...base, sound: "none" as const }, "沒大螢幕", true],
    ["clip playing", { ...base, clipPlaying: true }, "⚡ 影片中", true],
    ["just sent", { ...base, sent: "thunder" as const }, "已送出", true],
    ["the other pad just sent", { ...base, sent: "growl" as const }, "⚡ 雷聲", true],
    ["offline", { ...base, online: false }, "⚡ 雷聲", true],
  ])("%s", (_, o, label, disabled) => {
    expect(hostPad("thunder", o)).toMatchObject({ label, disabled });
  });
  it("a muted screen says so to a screen reader", () => {
    expect(hostPad("growl", { ...base, sound: "muted" }).aria).toContain("大螢幕沒聲音");
  });
});

describe("the pads' sounds and message", () => {
  it("are synthesized without the sawtooth (the wrong-answer cue's mark) and stay short", () => {
    for (const notes of [THUNDER, GROWL]) {
      expect(notes.every((n) => n.wave !== "sawtooth")).toBe(true);
      expect(Math.max(...notes.map((n) => n.at + n.duration))).toBeLessThanOrEqual(1.5);
    }
  });
  it("HOST_EFFECT parses only thunder and growl", () => {
    expect(parseClientMessage({ type: "HOST_EFFECT", effect: "thunder" })).toEqual({ type: "HOST_EFFECT", effect: "thunder" });
    expect(parseClientMessage({ type: "HOST_EFFECT", effect: "growl" })).toEqual({ type: "HOST_EFFECT", effect: "growl" });
    for (const effect of ["dim", "", 1, undefined, "__proto__"]) expect(parseClientMessage({ type: "HOST_EFFECT", effect })).toBeNull();
  });
});
