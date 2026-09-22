/**
 * The server (server/lib/ratecard.js) always builds a Larger Pack row's
 * skuId by slugifying "<category>-<productName>-larger-pack" (with a
 * collision suffix appended after that if two sheets share a name) - so
 * this substring check is an exact, not a heuristic, signal.
 */
export function isLargerPack(skuId: string): boolean {
  return skuId.includes("-larger-pack");
}

/**
 * A fixed-width qty/stock input has room for about 4 digits at the default
 * size before the browser starts scrolling the value to keep the cursor in
 * view - which reads as a truncated number even though nothing was lost
 * (25000 -> looks like "2500"). Shrinking the font as digits grow keeps the
 * whole value visible instead of relying on ever-wider boxes.
 */
export function digitFitFontSizePx(digitCount: number, basePx = 13, minPx = 9): number {
  return Math.max(minPx, basePx - Math.max(0, digitCount - 4));
}
