export type Role = "b2b" | "ops";

export type Tier = "green" | "yellow" | "orange" | "red";

export interface InventoryItem {
  skuId: string;
  category: string;
  productName: string;
  grammageG: number;
  mrpInr: number;
  shelfLifeDays: number;
  currentStock: number;
  active: boolean;
  /**
   * Ops-assigned, not computed. Green = high inventory / high production
   * priority, descending to red. Ops rearranges these by hand whenever
   * they want — no formula drives it.
   */
  tier: Tier;
  metadata?: Record<string, unknown>;
}

export interface B2BAccount {
  accountId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  pricingTierId: string | null;
}

/**
 * committed  — B2B committed it: every line item's qty is reserved
 *              (subtracted) from InventoryItem.currentStock, but it has not
 *              been sent to Ops yet. A B2B account can hold several of
 *              these at once and push each whenever it's ready.
 * pending    — pushed to Ops; still reserved, now awaiting a decision.
 * approved   — Ops confirmed it. Stock stays deducted (it shipped/will ship).
 * declined   — Ops rejected it. Reserved qty is released back to stock.
 */
export type RequestStatus = "committed" | "pending" | "approved" | "declined";

export interface RequestLineItem {
  lineItemId: string;
  skuId: string;
  /** Total quantity the account asked for on this line. */
  qty: number;
  unitMrpSnapshot: number;
  /** Portion of qty not covered by stock at commit time - 0 unless this line needed production. */
  backorderQty: number;
}

export interface StockRequest {
  requestId: string;
  accountId: string;
  status: RequestStatus;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  lineItems: RequestLineItem[];
  /** Name of the B2B person who committed this order, so Ops knows who to ask about it. */
  requestedByName: string | null;
}

/**
 * A B2B account asking for more of something than's currently in stock -
 * separate from StockRequest, which only ever reserves what's actually
 * available. Ops can accept (they'll get it), decline, or hold with a
 * deadline (revisit by then). Multiple accounts requesting the same SKU
 * show up as one aggregated line on the Ops side - see ProductRequestsPage.
 */
export type ProductRequestStatus = "pending" | "accepted" | "declined" | "on_hold";

export interface ProductRequest {
  requestId: string;
  accountId: string;
  skuId: string;
  qty: number;
  note: string | null;
  status: ProductRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /** Only meaningful when status is "on_hold". */
  holdUntil: string | null;
  /**
   * The StockRequest this backorder belongs to, when it was created as the
   * production portion of an order (see CatalogPage's split option) rather
   * than a standalone request. Null for a standalone request.
   */
  linkedRequestId: string | null;
}

export interface FulfillmentLogRow {
  dateFulfilled: string;
  requestId: string;
  companyName: string;
  contactName: string;
  contactPhone: string;
  category: string;
  productName: string;
  qty: number;
  unitMrp: number;
  lineTotal: number;
  approvedBy: string;
  notes: string;
}

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  accountId?: string;
}
