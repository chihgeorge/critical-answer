import { describe, it, expect, vi } from "vitest";
import { deleteOrphanedImages, type ImageBucket } from "./image-cleanup";

describe("deleteOrphanedImages", () => {
  it("calls images.delete with the given keys", async () => {
    const images: ImageBucket = { delete: vi.fn(async () => {}) };
    await deleteOrphanedImages(images, ["key-a", "key-b"]);
    expect(images.delete).toHaveBeenCalledWith(["key-a", "key-b"]);
  });

  it("swallows a failing delete and logs image_cleanup_failed instead of throwing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const images: ImageBucket = {
      delete: vi.fn(async () => {
        throw new Error("R2 down");
      }),
    };
    await expect(deleteOrphanedImages(images, ["key-a"])).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("image_cleanup_failed"));
    spy.mockRestore();
  });
});
