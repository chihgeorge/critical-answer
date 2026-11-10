import { describe, it, expect } from "vitest";
import { editorLocks } from "./bank-editor-locks";

describe("bank editor locks", () => {
  it("an image upload in flight blocks load and save, but not editing other fields", () => {
    expect(editorLocks({ loading: false, saving: false, uploads: 1 })).toEqual({ fields: false, load: true, save: true });
  });
  it("a load or save in flight locks everything", () => {
    for (const s of [{ loading: true, saving: false }, { loading: false, saving: true }]) {
      expect(editorLocks({ ...s, uploads: 0 })).toEqual({ fields: true, load: true, save: true });
    }
  });
  it("nothing in flight locks nothing", () => {
    expect(editorLocks({ loading: false, saving: false, uploads: 0 })).toEqual({ fields: false, load: false, save: false });
  });
});
