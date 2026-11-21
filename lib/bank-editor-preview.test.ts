import { describe, expect, it, vi } from "vitest";
import { activePreview, claimPreview, releasePreview, subscribePreview } from "./bank-editor-preview";

describe("bank editor: one preview at a time", () => {
  it("a new claim replaces the old one, and only the holder can release", () => {
    const seen = vi.fn();
    const stop = subscribePreview(seen);
    claimPreview("a");
    expect(activePreview()).toBe("a");
    claimPreview("b");
    expect(activePreview()).toBe("b");
    releasePreview("a"); // a's row unmounting must not stop b
    expect(activePreview()).toBe("b");
    claimPreview("b"); // pressing ▶ again on the same one changes nothing
    expect(seen).toHaveBeenCalledTimes(2);
    releasePreview("b");
    expect(activePreview()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(3);
    stop();
    claimPreview("c");
    expect(seen).toHaveBeenCalledTimes(3);
    releasePreview("c");
  });
});
