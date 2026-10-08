import { describe, it, expect, vi } from "vitest";
import { createBreaker, withBreaker } from "./breaker";
import { NarrationError } from "./errors";
import type { NarrationEvent } from "./events";
import type { NarrationProvider } from "./scripted";

const event: NarrationEvent = { type: "retry", team: "紅隊", monster: "史萊姆" };

describe("createBreaker", () => {
  it("stays closed below the threshold and a success resets the count", () => {
    const b = createBreaker({ threshold: 3 });
    b.failure(new NarrationError("upstream", "x"));
    b.failure(new NarrationError("timeout", "x"));
    b.success();
    b.failure(new NarrationError("upstream", "x"));
    b.failure(new NarrationError("upstream", "x"));
    expect(b.open).toBe(false);
  });

  it("opens after 3 consecutive failures and reports the trip once", () => {
    const onTrip = vi.fn();
    const b = createBreaker({ threshold: 3, onTrip });
    for (let i = 0; i < 5; i++) b.failure(new NarrationError("upstream", "x"));
    expect(b.open).toBe(true);
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(onTrip.mock.calls[0][0]).toMatch(/3 consecutive/);
  });

  it("opens at once on an auth failure (401/403)", () => {
    const onTrip = vi.fn();
    const b = createBreaker({ onTrip });
    b.failure(new NarrationError("auth", "x", 401));
    expect(b.open).toBe(true);
    expect(onTrip.mock.calls[0][0]).toMatch(/auth/i);
  });

  it("stays open: a later success does not close it", () => {
    const b = createBreaker({});
    b.failure(new NarrationError("auth", "x", 403));
    b.success();
    expect(b.open).toBe(true);
  });
});

describe("withBreaker", () => {
  const inner = (narrate: NarrationProvider["narrate"]): NarrationProvider => ({ name: "llm", narrate });

  it("passes success through and counts it", async () => {
    const b = createBreaker({});
    const p = withBreaker(inner(async () => "行"), b);
    await expect(p.narrate(event, {})).resolves.toBe("行");
    expect(p.name).toBe("llm");
  });

  it("records failures, rethrows them, then refuses without calling the provider once open", async () => {
    const b = createBreaker({ threshold: 2 });
    const narrate = vi.fn(async () => {
      throw new NarrationError("upstream", "boom", 500);
    });
    const p = withBreaker(inner(narrate), b);
    await expect(p.narrate(event, {})).rejects.toMatchObject({ reason: "upstream" });
    await expect(p.narrate(event, {})).rejects.toMatchObject({ reason: "upstream" });
    await expect(p.narrate(event, {})).rejects.toMatchObject({ reason: "breaker_open" });
    expect(narrate).toHaveBeenCalledTimes(2);
  });

  it("counts an unnamed error (a bug in the provider) as an upstream failure", async () => {
    const b = createBreaker({ threshold: 1 });
    const p = withBreaker(inner(async () => { throw new Error("weird"); }), b);
    await expect(p.narrate(event, {})).rejects.toThrow("weird");
    expect(b.open).toBe(true);
  });
});
