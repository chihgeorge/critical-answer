// Deletes orphaned R2 image objects (see docs/designs/image-question-type.md's "R2 cleanup
// mechanism"). Pulled out of worker/index.ts so this logic is unit-testable: importing
// worker/index.ts directly would pull in "cloudflare:workers", which doesn't resolve outside
// the Workers runtime — see lib/bank-store.ts's header comment for the same platform-agnostic
// split this file follows.

/** The subset of R2Bucket this needs — structural, not the real Cloudflare type, so a test
 * double doesn't have to satisfy R2Bucket's full (large) interface. */
export interface ImageBucket {
  delete(keys: string[]): Promise<void>;
}

/** Best-effort and swallows its own failure (logs instead of throwing): the bank write that
 * orphaned these keys already succeeded, so a failed delete here is wasted storage, never data
 * loss — same reasoning as lib/bank-store.ts's own defensive .catch on this callback.
 * worker/index.ts wraps the call in ctx.waitUntil() to keep it alive past the request. */
export async function deleteOrphanedImages(images: ImageBucket, keys: string[]): Promise<void> {
  await images.delete(keys).catch((err: unknown) => {
    console.error(JSON.stringify({ event: "image_cleanup_failed", keys, error: String(err) }));
  });
}
