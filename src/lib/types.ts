export type Role = "b2b" | "ops";

export interface InventoryItem {
  skuId: string;
  category: string;
  productName: string;
  grammageG: number;
  mrpInr: number;
  shelfLifeDays: number;
  currentStock: number;
  reorderThreshold: number | null;
  active: boolean;
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

export type RequestStatus =
  | "pending"
  | "approved_full"
  | "approved_partial"
  | "declined";

export interface RequestLineItem {
  lineItemId: string;
  skuId: string;
  qtyRequested: number;
  qtyFulfilled: number | null;
  unitMrpSnapshot: number;
}

export interface StockRequest {
  requestId: string;
  accountId: string;
  status: RequestStatus;
  submittedAt: string;
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
  qtyRequested: number;
  qtyFulfilled: number;
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
