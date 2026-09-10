import type { B2BAccount, InventoryItem, StockRequest, Tier } from "../types";

/**
 * Everything the UI needs from a backend, named after what the app does
 * (commit an item, push an order, decide a request) rather than how any one
 * backend stores it. `mockDataClient` implements this against localStorage
 * so the whole app runs with no server; a `supabaseDataClient` implementing
 * the same interface is the intended swap-in later — nothing outside this
 * file needs to change when that happens.
 */
export interface DataClient {
  getInventory(): Promise<InventoryItem[]>;
  updateStock(skuId: string, currentStock: number): Promise<InventoryItem>;
  setActive(skuId: string, active: boolean): Promise<InventoryItem>;
  /** Ops manually re-files an item into a different tier — no formula behind it. */
  setTier(skuId: string, tier: Tier): Promise<InventoryItem>;

  getAccounts(): Promise<B2BAccount[]>;
  getAccount(accountId: string): Promise<B2BAccount | undefined>;

  /** The account's in-progress order, if any (status "draft"). */
  getDraftOrder(accountId: string): Promise<StockRequest | null>;

  /**
   * Sets a line item's committed quantity on the account's draft order
   * (creating the draft if needed), immediately reserving the delta from
   * `InventoryItem.currentStock`. qty 0 removes the line item and releases
   * its reservation. Throws if qty exceeds what's currently available.
   */
  commitItem(accountId: string, skuId: string, qty: number): Promise<StockRequest>;

  /** Sends the draft to Ops: status draft -> pending. Requires at least one line item. */
  pushOrder(accountId: string): Promise<StockRequest>;

  getRequests(): Promise<StockRequest[]>;
  getRequestsForAccount(accountId: string): Promise<StockRequest[]>;

  /**
   * Approve keeps the already-reserved stock deducted. Decline releases
   * every line item's reserved qty back to `currentStock`. No partial
   * approval — a request is approved or declined as a whole.
   */
  decideRequest(
    requestId: string,
    decidedBy: string,
    approve: boolean,
    decisionNote: string | null
  ): Promise<StockRequest>;
}
