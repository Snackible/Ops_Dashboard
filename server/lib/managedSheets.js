import {
  listSheets,
  readTabs,
  createSheetWithHeader,
  writeRange,
  appendRows as appendRowsRaw,
  deleteRow as deleteRowRaw,
  colLetter,
} from "./sheetsClient.js";

export const TAB_ACCOUNTS = "Accounts";
export const TAB_ORDERS = "Orders";
export const TAB_ORDER_LINES = "OrderLines";
export const TAB_FULFILLMENT = "FulfillmentLog";
export const TAB_PRODUCT_REQUESTS = "ProductRequests";
export const TAB_LOCK = "Lock";

export const COLUMNS = {
  [TAB_ACCOUNTS]: ["account_id", "company_name", "contact_name", "contact_email", "contact_phone"],
  [TAB_ORDERS]: ["request_id", "account_id", "status", "created_at", "submitted_at", "decided_at", "decided_by", "decision_note"],
  [TAB_ORDER_LINES]: ["line_item_id", "request_id", "sku_id", "qty", "unit_mrp_snapshot"],
  [TAB_FULFILLMENT]: ["date_fulfilled", "request_id", "company_name", "contact_name", "contact_phone", "category", "product_name", "qty", "unit_mrp", "line_total", "approved_by", "notes"],
  [TAB_PRODUCT_REQUESTS]: ["request_id", "account_id", "sku_id", "qty", "note", "status", "created_at", "decided_at", "decided_by", "hold_until"],
  [TAB_LOCK]: ["token", "acquired_at"],
};

/** Every tab this module manages, including the Lock tab used for the advisory mutex - kept out of ratecard scanning too. */
export const MANAGED_TITLES = Object.keys(COLUMNS);

/** Ensures every listed tab exists (creating it with its header row if missing) and returns Map<title, sheetId>. */
export async function ensureTabs(spreadsheetId, titles) {
  const all = await listSheets(spreadsheetId);
  const sheetIds = new Map(all.map((s) => [s.title, s.sheetId]));
  for (const title of titles) {
    if (!sheetIds.has(title)) {
      const sheetId = await createSheetWithHeader(spreadsheetId, title, COLUMNS[title]);
      sheetIds.set(title, sheetId);
    }
  }
  return sheetIds;
}

function parseObjects(values) {
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const line = values[i];
    if ((line[0] === "" || line[0] === undefined) && (line[1] === "" || line[1] === undefined)) continue;
    const row = {};
    headers.forEach((h, c) => { row[h] = line[c] !== undefined ? line[c] : ""; });
    row.__row = i + 1;
    rows.push(row);
  }
  return rows;
}

/** Ensures the given tabs exist, then reads all of them in one batchGet - {title: object[]}. */
export async function readManagedTabs(spreadsheetId, titles) {
  await ensureTabs(spreadsheetId, titles);
  const raw = await readTabs(spreadsheetId, titles);
  const out = {};
  titles.forEach((t) => { out[t] = parseObjects(raw[t] || []); });
  return out;
}

export async function appendRows(spreadsheetId, title, objects) {
  if (objects.length === 0) return;
  const headers = COLUMNS[title];
  const rows = objects.map((obj) => headers.map((h) => (obj[h] === undefined || obj[h] === null ? "" : obj[h])));
  await appendRowsRaw(spreadsheetId, title, rows);
}

export async function writeCell(spreadsheetId, title, row1Based, column, value) {
  const colIndex = COLUMNS[title].indexOf(column);
  if (colIndex < 0) throw new Error("Unknown column " + column);
  await writeRange(spreadsheetId, title, `${colLetter(colIndex + 1)}${row1Based}`, [[value]]);
}

export async function deleteManagedRow(spreadsheetId, sheetId, row1Based) {
  await deleteRowRaw(spreadsheetId, sheetId, row1Based);
}

export function newId(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function isoOrNull(value) {
  return value ? String(value) : null;
}
