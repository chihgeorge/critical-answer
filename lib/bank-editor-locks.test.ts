import { describe, it, expect } from "vitest";
import { editorBusy } from "./bank-editor-locks";

describe("bank editor lock", () => {
  it("an image upload in flight locks the editor like a load or a save", () => {
    expect(editorBusy({ loading: false, saving: false, uploads: 1 })).toBe(true);
    expect(editorBusy({ loading: true, saving: false, uploads: 0 })).toBe(true);
    expect(editorBusy({ loading: false, saving: true, uploads: 0 })).toBe(true);
  });
  it("nothing in flight locks nothing", () => {
    expect(editorBusy({ loading: false, saving: false, uploads: 0 })).toBe(false);
  });
});
