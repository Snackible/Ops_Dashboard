import { eventBus } from "../events";
import { dataClient } from "../data";
import { appendMockFulfillmentSheet } from "./mockFulfillmentSheet";
import type { FulfillmentLogRow, StockRequest } from "../types";

/**
 * Subscriber #3 on the event bus: writes approved line items to the
 * fulfillment log, and only on approval.
 *
 * This is registered ONLY when the app is running on the localStorage mock.
 * With the Google Sheets backend, the same rows are appended inside the
 * approval transaction in apps-script/Code.gs, where they belong - a browser
 * that closes mid-approval can't leave the log half-written.
 */
async function buildRows(request: StockRequest): Promise<FulfillmentLogRow[]> {
  const account = await dataClient.getAccount(request.accountId);
  const inventory = await dataClient.getInventory();
  const bySku = new Map(inventory.map((i) => [i.skuId, i]));

  return request.lineItems.map((li) => {
    const catalogItem = bySku.get(li.skuId);
    return {
      dateFulfilled: request.decidedAt ?? new Date().toISOString(),
      requestId: request.requestId,
      companyName: account?.companyName ?? "Unknown account",
      contactName: account?.contactName ?? "",
      contactPhone: account?.contactPhone ?? "",
      category: catalogItem?.category ?? "",
      productName: catalogItem?.productName ?? li.skuId,
      qty: li.qty,
      unitMrp: li.unitMrpSnapshot,
      lineTotal: li.qty * li.unitMrpSnapshot,
      approvedBy: request.decidedBy ?? "",
      notes: request.decisionNote ?? "",
    } satisfies FulfillmentLogRow;
  });
}

export function registerFulfillmentSheetLog(): void {
  eventBus.on("RequestApproved", async ({ request }) => {
    const rows = await buildRows(request);
    if (rows.length === 0) return;
    try {
      appendMockFulfillmentSheet(rows);
    } catch (err) {
      console.error("[fulfillment-log] failed to append rows, will not block the approval", err);
    }
  });
}
