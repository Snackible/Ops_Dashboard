import type { B2BAccount, FulfillmentLogRow, InventoryItem, ProductRequest, ProductRequestStatus, StockRequest, Tier } from "../types";

/**
 * Everything the UI needs from a backend, named after what the app does
 * (commit an order, push an order, decide a request) rather than how any
 * one backend stores it. `mockDataClient` implements this against
 * localStorage so the whole app runs with no server; `sheetsDataClient`
 * implementing the same interface against a Google Sheet (via an Apps
 * Script web app, see apps-script/Code.gs) is the real-backend swap-in —
 * nothing outside this file needs to change either way.
 */
export interface DataClient {
  getInventory(): Promise<InventoryItem[]>;
  updateStock(skuId: string, currentStock: number): Promise<InventoryItem>;
  setActive(skuId: string, active: boolean): Promise<InventoryItem>;
  /** Ops manually re-files an item into a different tier — no formula behind it. */
  setTier(skuId: string, tier: Tier): Promise<InventoryItem>;

  getAccounts(): Promise<B2BAccount[]>;
  getAccount(accountId: string): Promise<B2BAccount | undefined>;

  /**
   * Creates a new order in one shot from a locally-built cart, reserving
   * every line item's qty from `InventoryItem.currentStock` atomically —
   * either the whole order commits or none of it does. An account can hold
   * several committed orders at once; this always creates a new one.
   */
  commitOrder(
    accountId: string,
    lineItems: { skuId: string; qty: number }[]
  ): Promise<StockRequest>;

  /** Committed-but-not-yet-pushed orders for an account — the "Committed" tab. */
  getCommittedOrders(accountId: string): Promise<StockRequest[]>;

  /** Sends one committed order to Ops: status committed -> pending. */
  pushOrder(requestId: string): Promise<StockRequest>;

  /** Undoes a commit that was never pushed - releases its reserved stock and removes it. */
  cancelOrder(requestId: string): Promise<void>;

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

  /** Fulfillment rows written on approval - a sheet tab, or its mock stand-in. */
  getFulfillmentLog(): Promise<FulfillmentLogRow[]>;

  /** B2B asks for more of a SKU than's currently available. */
  requestProduct(accountId: string, skuId: string, qty: number, note: string | null): Promise<ProductRequest>;

  getProductRequests(): Promise<ProductRequest[]>;
  getProductRequestsForAccount(accountId: string): Promise<ProductRequest[]>;

  /**
   * Decides every still-pending ProductRequest for one SKU at once - that's
   * the "multiple requests for the same product add up" behavior: Ops sees
   * one aggregated line per SKU and acts on it as a whole. `holdUntil` is
   * required for "on_hold" and ignored otherwise.
   */
  decideProductRequests(
    skuId: string,
    decidedBy: string,
    status: Exclude<ProductRequestStatus, "pending">,
    holdUntil: string | null
  ): Promise<ProductRequest[]>;
}
