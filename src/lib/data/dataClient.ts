import type { B2BAccount, InventoryItem, StockRequest } from "../types";

export interface LineItemDecision {
  lineItemId: string;
  qtyFulfilled: number;
}

/**
 * Everything the UI needs from a backend, named after what the app does
 * (submit a request, decide a request) rather than how any one backend
 * stores it. `mockDataClient` implements this against localStorage so the
 * whole app runs with no server; a `supabaseDataClient` implementing the
 * same interface is the intended swap-in later — nothing outside this file
 * needs to change when that happens.
 */
export interface DataClient {
  getInventory(): Promise<InventoryItem[]>;
  updateStock(skuId: string, currentStock: number): Promise<InventoryItem>;
  setReorderThreshold(skuId: string, threshold: number | null): Promise<InventoryItem>;
  setActive(skuId: string, active: boolean): Promise<InventoryItem>;

  getAccounts(): Promise<B2BAccount[]>;
  getAccount(accountId: string): Promise<B2BAccount | undefined>;

  submitRequest(
    accountId: string,
    lineItems: { skuId: string; qtyRequested: number }[]
  ): Promise<StockRequest>;

  getRequests(): Promise<StockRequest[]>;
  getRequestsForAccount(accountId: string): Promise<StockRequest[]>;

  decideRequest(
    requestId: string,
    decidedBy: string,
    lineItemDecisions: LineItemDecision[],
    decisionNote: string | null
  ): Promise<StockRequest>;
}
