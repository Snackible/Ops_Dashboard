import { eventBus } from "../events";
import { dataClient } from "../data";
import type { FulfillmentLogRow, StockRequest } from "../types";

const SHEET_STORAGE_KEY = "snackible-ops-fulfillment-sheet-mock";

function readMockSheet(): FulfillmentLogRow[] {
  try {
    const raw = localStorage.getItem(SHEET_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FulfillmentLogRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Stands in for the real Google Sheets API call (service-account auth +
 * spreadsheets.values.append). Swapping this one function for a real
 * network call is the entire migration — every caller above it is unaware
 * this is a sheet at all, only that fulfillment rows get "written" somewhere.
 * Failures here are caught by the event bus and never block an approval.
 */
async function appendRowsToSheet(rows: FulfillmentLogRow[]): Promise<void> {
  const existing = readMockSheet();
  const next = [...existing, ...rows];
  localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify(next));
  // eslint-disable-next-line no-console
  console.info(`[fulfillment-log] appended ${rows.length} row(s) to the mock sheet:`, rows);
}

export function readFulfillmentLog(): FulfillmentLogRow[] {
  return readMockSheet();
}

async function buildRows(request: StockRequest): Promise<FulfillmentLogRow[]> {
  const account = await dataClient.getAccount(request.accountId);
  const inventory = await dataClient.getInventory();
  const bySku = new Map(inventory.map((i) => [i.skuId, i]));

  return request.lineItems
    .filter((li) => (li.qtyFulfilled ?? 0) > 0)
    .map((li) => {
      const catalogItem = bySku.get(li.skuId);
      const qtyFulfilled = li.qtyFulfilled ?? 0;
      return {
        dateFulfilled: request.decidedAt ?? new Date().toISOString(),
        requestId: request.requestId,
        companyName: account?.companyName ?? "Unknown account",
        contactName: account?.contactName ?? "",
        contactPhone: account?.contactPhone ?? "",
        category: catalogItem?.category ?? "",
        productName: catalogItem?.productName ?? li.skuId,
        qtyRequested: li.qtyRequested,
        qtyFulfilled,
        unitMrp: li.unitMrpSnapshot,
        lineTotal: qtyFulfilled * li.unitMrpSnapshot,
        approvedBy: request.decidedBy ?? "",
        notes: request.decisionNote ?? "",
      } satisfies FulfillmentLogRow;
    });
}

/** Subscriber #3 on the event bus: the only one that writes to the fulfillment sheet, and only on approval. */
export function registerFulfillmentSheetLog(): void {
  eventBus.on("RequestApproved", async ({ request }) => {
    const rows = await buildRows(request);
    if (rows.length === 0) return;
    try {
      await appendRowsToSheet(rows);
    } catch (err) {
      console.error("[fulfillment-log] failed to append rows, will not block the approval", err);
    }
  });
}
