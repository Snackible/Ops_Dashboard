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
  qty: number;
  unitMrpSnapshot: number;
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
