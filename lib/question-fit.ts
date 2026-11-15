/** The big screen's question sizes, largest first: 30 px fits two lines above the option tiles, 16 px about four. */
export const QUESTION_SIZES = [30, 27, 24, 22, 20, 18, 16];

/**
 * The largest size whose box ends at or above `limit` (stage px). `bottomAt` lays the box out at a size and returns
 * where it ends. Past the smallest size the text keeps it and may still reach `limit`.
 */
export function fitQuestionSize(bottomAt: (size: number) => number, limit: number, sizes = QUESTION_SIZES): number {
  for (const size of sizes) if (bottomAt(size) <= limit) return size;
  return sizes[sizes.length - 1];
}
