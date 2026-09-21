/**
 * The server (server/lib/ratecard.js) always builds a Larger Pack row's
 * skuId by slugifying "<category>-<productName>-larger-pack" (with a
 * collision suffix appended after that if two sheets share a name) - so
 * this substring check is an exact, not a heuristic, signal.
 */
export function isLargerPack(skuId: string): boolean {
  return skuId.includes("-larger-pack");
}
