import { supabase } from "./supabaseClient";
import { eventBus } from "../events";
import type { B2BAccount, InventoryItem, RequestLineItem, RequestStatus, StockRequest, Tier } from "../types";
import type { DataClient } from "./dataClient";

/**
 * Real backend behind the same DataClient interface the mock implements.
 * Every mutation goes through a Postgres function (see supabase/schema.sql)
 * so a stock delta is computed and applied in one transaction — safe under
 * concurrent commits from multiple B2B accounts, which a naive
 * read-then-write from the browser would not be.
 *
 * Events still flow through the same eventBus the mock uses, but the
 * *source* of truth for firing them is the Realtime subscription set up in
 * `startRealtimeSync`, not the mutation call sites below — that way an Ops
 * dashboard open in one browser sees a push made from a completely
 * different browser, which local-only event emission never could.
 */

interface InventoryRow {
  sku_id: string;
  category: string;
  product_name: string;
  grammage_g: number;
  mrp_inr: number;
  shelf_life_days: number;
  current_stock: number;
  active: boolean;
  tier: Tier;
  metadata: Record<string, unknown> | null;
}

interface AccountRow {
  account_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  pricing_tier_id: string | null;
}

interface RequestRow {
  request_id: string;
  account_id: string;
  status: RequestStatus;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
}

interface LineItemRow {
  line_item_id: string;
  request_id: string;
  sku_id: string;
  qty: number;
  unit_mrp_snapshot: number;
}

function toInventoryItem(r: InventoryRow): InventoryItem {
  return {
    skuId: r.sku_id,
    category: r.category,
    productName: r.product_name,
    grammageG: r.grammage_g,
    mrpInr: r.mrp_inr,
    shelfLifeDays: r.shelf_life_days,
    currentStock: r.current_stock,
    active: r.active,
    tier: r.tier,
    metadata: r.metadata ?? undefined,
  };
}

function toAccount(r: AccountRow): B2BAccount {
  return {
    accountId: r.account_id,
    companyName: r.company_name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    pricingTierId: r.pricing_tier_id,
  };
}

function toLineItem(r: LineItemRow): RequestLineItem {
  return { lineItemId: r.line_item_id, skuId: r.sku_id, qty: r.qty, unitMrpSnapshot: r.unit_mrp_snapshot };
}

function toRequest(r: RequestRow, lineItems: LineItemRow[]): StockRequest {
  return {
    requestId: r.request_id,
    accountId: r.account_id,
    status: r.status,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    decisionNote: r.decision_note,
    lineItems: lineItems.filter((li) => li.request_id === r.request_id).map(toLineItem),
  };
}

function db() {
  if (!supabase) throw new Error("Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY");
  return supabase;
}

async function fetchRequestWithLineItems(requestId: string): Promise<StockRequest> {
  const [{ data: request, error: reqErr }, { data: lineItems, error: liErr }] = await Promise.all([
    db().from("requests").select("*").eq("request_id", requestId).single(),
    db().from("request_line_items").select("*").eq("request_id", requestId),
  ]);
  if (reqErr) throw reqErr;
  if (liErr) throw liErr;
  return toRequest(request as RequestRow, (lineItems ?? []) as LineItemRow[]);
}

async function fetchRequestsWithLineItems(filter?: { accountId?: string; status?: RequestStatus }): Promise<StockRequest[]> {
  let query = db().from("requests").select("*").order("created_at", { ascending: false });
  if (filter?.accountId) query = query.eq("account_id", filter.accountId);
  if (filter?.status) query = query.eq("status", filter.status);
  const { data: requests, error: reqErr } = await query;
  if (reqErr) throw reqErr;
  const requestRows = (requests ?? []) as RequestRow[];
  if (requestRows.length === 0) return [];

  const { data: lineItems, error: liErr } = await db()
    .from("request_line_items")
    .select("*")
    .in(
      "request_id",
      requestRows.map((r) => r.request_id)
    );
  if (liErr) throw liErr;
  return requestRows.map((r) => toRequest(r, (lineItems ?? []) as LineItemRow[]));
}

export const supabaseDataClient: DataClient = {
  async getInventory() {
    const { data, error } = await db().from("inventory_items").select("*").order("category");
    if (error) throw error;
    return (data as InventoryRow[]).map(toInventoryItem);
  },

  async updateStock(skuId, currentStock) {
    const { data, error } = await db()
      .from("inventory_items")
      .update({ current_stock: currentStock })
      .eq("sku_id", skuId)
      .select()
      .single();
    if (error) throw error;
    return toInventoryItem(data as InventoryRow);
  },

  async setActive(skuId, active) {
    const { data, error } = await db().from("inventory_items").update({ active }).eq("sku_id", skuId).select().single();
    if (error) throw error;
    return toInventoryItem(data as InventoryRow);
  },

  async setTier(skuId, tier) {
    const { data, error } = await db().from("inventory_items").update({ tier }).eq("sku_id", skuId).select().single();
    if (error) throw error;
    return toInventoryItem(data as InventoryRow);
  },

  async getAccounts() {
    const { data, error } = await db().from("b2b_accounts").select("*").order("company_name");
    if (error) throw error;
    return (data as AccountRow[]).map(toAccount);
  },

  async getAccount(accountId) {
    const { data, error } = await db().from("b2b_accounts").select("*").eq("account_id", accountId).maybeSingle();
    if (error) throw error;
    return data ? toAccount(data as AccountRow) : undefined;
  },

  async getDraftOrder(accountId) {
    const [draft] = await fetchRequestsWithLineItems({ accountId, status: "draft" });
    return draft ?? null;
  },

  async commitItem(accountId, skuId, qty) {
    const { data, error } = await db().rpc("commit_item", { p_account_id: accountId, p_sku_id: skuId, p_qty: qty });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as RequestRow;
    return fetchRequestWithLineItems(row.request_id);
  },

  async pushOrder(accountId) {
    const { data, error } = await db().rpc("push_order", { p_account_id: accountId });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as RequestRow;
    return fetchRequestWithLineItems(row.request_id);
  },

  async getRequests() {
    return fetchRequestsWithLineItems();
  },

  async getRequestsForAccount(accountId) {
    return fetchRequestsWithLineItems({ accountId });
  },

  async decideRequest(requestId, decidedBy, approve, decisionNote) {
    const { data, error } = await db().rpc("decide_request", {
      p_request_id: requestId,
      p_decided_by: decidedBy,
      p_approve: approve,
      p_note: decisionNote,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as RequestRow;
    return fetchRequestWithLineItems(row.request_id);
  },
};

let realtimeStarted = false;

/**
 * Wires Postgres changes on `requests` and `inventory_items` to the same
 * event bus every subscriber (popups, sound, the sheet log) already
 * listens on — so those subscribers work identically whether the change
 * came from this browser tab or someone else's.
 */
export function startRealtimeSync(): void {
  if (realtimeStarted || !supabase) return;
  realtimeStarted = true;

  supabase
    .channel("requests-changes")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "requests" }, async (payload) => {
      const row = payload.new as RequestRow;
      if (row.status === "pending" && payload.old && (payload.old as RequestRow).status === "draft") {
        const request = await fetchRequestWithLineItems(row.request_id);
        eventBus.emit("RequestSubmitted", { request });
      }
      if (row.status === "approved" || row.status === "declined") {
        const request = await fetchRequestWithLineItems(row.request_id);
        eventBus.emit(row.status === "approved" ? "RequestApproved" : "RequestDeclined", { request });
      }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "inventory_items" }, (payload) => {
      eventBus.emit("InventoryUpdated", { item: toInventoryItem(payload.new as InventoryRow) });
    })
    .subscribe();
}
