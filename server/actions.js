import { readRatecardRows, resolveRatecardColumn } from "./lib/ratecard.js";
import { writeRange, colLetter } from "./lib/sheetsClient.js";
import {
  readManagedTabs,
  appendRows,
  writeCell,
  deleteManagedRow,
  ensureTabs,
  newId,
  isoOrNull,
  TAB_ACCOUNTS,
  TAB_ORDERS,
  TAB_ORDER_LINES,
  TAB_FULFILLMENT,
  TAB_PRODUCT_REQUESTS,
  MANAGED_TITLES,
} from "./lib/managedSheets.js";
import { withLock } from "./lib/lock.js";

function toInventoryItem(r) {
  return {
    skuId: r.skuId, category: r.category, productName: r.productName,
    grammageG: r.grammageG, mrpInr: r.mrpInr, shelfLifeDays: r.shelfLifeDays,
    currentStock: r.currentStock, active: r.active, tier: r.tier,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────

export async function getInventory(ratecardId) {
  const { rows } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  return rows.map(toInventoryItem);
}

export async function getAccounts(opsId) {
  const { [TAB_ACCOUNTS]: rows } = await readManagedTabs(opsId, [TAB_ACCOUNTS]);
  return rows.map((r) => ({
    accountId: String(r.account_id), companyName: String(r.company_name),
    contactName: String(r.contact_name), contactEmail: String(r.contact_email),
    contactPhone: String(r.contact_phone), pricingTierId: null,
  }));
}

function buildRequests(orderRows, lineRows, accountId) {
  return orderRows
    .filter((r) => !accountId || String(r.account_id) === accountId)
    .map((r) => ({
      requestId: String(r.request_id), accountId: String(r.account_id), status: String(r.status),
      createdAt: isoOrNull(r.created_at) || new Date().toISOString(),
      submittedAt: isoOrNull(r.submitted_at), decidedAt: isoOrNull(r.decided_at),
      decidedBy: r.decided_by ? String(r.decided_by) : null,
      decisionNote: r.decision_note ? String(r.decision_note) : null,
      lineItems: lineRows
        .filter((li) => String(li.request_id) === String(r.request_id))
        .map((li) => ({
          lineItemId: String(li.line_item_id), skuId: String(li.sku_id),
          qty: Number(li.qty), unitMrpSnapshot: Number(li.unit_mrp_snapshot),
        })),
    }));
}

export async function getRequests(opsId, accountId) {
  const { [TAB_ORDERS]: orders, [TAB_ORDER_LINES]: lines } = await readManagedTabs(opsId, [TAB_ORDERS, TAB_ORDER_LINES]);
  return buildRequests(orders, lines, accountId);
}

export async function getFulfillmentLog(opsId) {
  const { [TAB_FULFILLMENT]: rows } = await readManagedTabs(opsId, [TAB_FULFILLMENT]);
  return rows.map((r) => ({
    dateFulfilled: isoOrNull(r.date_fulfilled), requestId: String(r.request_id),
    companyName: String(r.company_name), contactName: String(r.contact_name), contactPhone: String(r.contact_phone),
    category: String(r.category), productName: String(r.product_name),
    qty: Number(r.qty), unitMrp: Number(r.unit_mrp), lineTotal: Number(r.line_total),
    approvedBy: String(r.approved_by), notes: r.notes ? String(r.notes) : "",
  }));
}

function toProductRequest(r) {
  return {
    requestId: String(r.request_id), accountId: String(r.account_id), skuId: String(r.sku_id),
    qty: Number(r.qty), note: r.note ? String(r.note) : null, status: String(r.status),
    createdAt: isoOrNull(r.created_at) || new Date().toISOString(),
    decidedAt: isoOrNull(r.decided_at), decidedBy: r.decided_by ? String(r.decided_by) : null,
    holdUntil: isoOrNull(r.hold_until),
  };
}

export async function getProductRequests(opsId, accountId) {
  const { [TAB_PRODUCT_REQUESTS]: rows } = await readManagedTabs(opsId, [TAB_PRODUCT_REQUESTS]);
  return rows.filter((r) => !accountId || String(r.account_id) === accountId).map(toProductRequest);
}

// ── Writes (each wrapped in withLock by the route handler) ─────────────

export async function setInventoryField(ratecardId, skuId, field, value) {
  const key = field === "current_stock" ? "stock" : field;
  if (["stock", "active", "tier"].indexOf(key) === -1) throw new Error("Unknown column " + field);

  const { rows, sheetMeta } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  const row = rows.find((r) => r.skuId === skuId);
  if (!row) throw new Error("Unknown SKU " + skuId);

  const colIndex = await resolveRatecardColumn(sheetMeta, row, row.fields[key]);
  await writeRange(row.spreadsheetId, row.title, `${colLetter(colIndex)}${row.row}`, [[value]]);

  if (key === "stock") row.currentStock = Number(value) || 0;
  if (key === "active") row.active = Boolean(value);
  if (key === "tier") row.tier = String(value).toLowerCase();
  return toInventoryItem(row);
}

export async function commitOrder(ratecardId, opsId, accountId, lineItems) {
  const wanted = (lineItems || []).filter((li) => Number(li.qty) > 0);
  if (wanted.length === 0) throw new Error("Add at least one item before committing");

  const { rows, sheetMeta } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  const bySku = new Map(rows.map((r) => [r.skuId, r]));

  wanted.forEach((li) => {
    const row = bySku.get(li.skuId);
    if (!row) throw new Error("Unknown SKU " + li.skuId);
    if (Number(li.qty) > row.currentStock) throw new Error(`Only ${row.currentStock} available for ${row.productName}`);
  });

  for (const li of wanted) {
    const row = bySku.get(li.skuId);
    const colIndex = await resolveRatecardColumn(sheetMeta, row, row.fields.stock);
    await writeRange(row.spreadsheetId, row.title, `${colLetter(colIndex)}${row.row}`, [[row.currentStock - Number(li.qty)]]);
    row.currentStock -= Number(li.qty);
  }

  const requestId = newId("req");
  const createdAt = new Date().toISOString();
  const withLineIds = wanted.map((li) => ({ ...li, lineItemId: newId("line") }));

  await appendRows(opsId, TAB_ORDERS, [{
    request_id: requestId, account_id: accountId, status: "committed", created_at: createdAt,
    submitted_at: "", decided_at: "", decided_by: "", decision_note: "",
  }]);
  await appendRows(opsId, TAB_ORDER_LINES, withLineIds.map((li) => ({
    line_item_id: li.lineItemId, request_id: requestId, sku_id: li.skuId,
    qty: Number(li.qty), unit_mrp_snapshot: Number(bySku.get(li.skuId).mrpInr),
  })));

  return {
    requestId, accountId, status: "committed", createdAt,
    submittedAt: null, decidedAt: null, decidedBy: null, decisionNote: null,
    lineItems: withLineIds.map((li) => ({
      lineItemId: li.lineItemId, skuId: li.skuId, qty: Number(li.qty), unitMrpSnapshot: Number(bySku.get(li.skuId).mrpInr),
    })),
  };
}

export async function pushOrder(opsId, requestId) {
  const { [TAB_ORDERS]: orders, [TAB_ORDER_LINES]: lines } = await readManagedTabs(opsId, [TAB_ORDERS, TAB_ORDER_LINES]);
  const row = orders.find((r) => String(r.request_id) === requestId);
  if (!row) throw new Error("Unknown request " + requestId);
  if (String(row.status) !== "committed") throw new Error("Only a committed order can be pushed");

  const submittedAt = new Date().toISOString();
  await writeCell(opsId, TAB_ORDERS, row.__row, "status", "pending");
  await writeCell(opsId, TAB_ORDERS, row.__row, "submitted_at", submittedAt);

  row.status = "pending";
  row.submitted_at = submittedAt;
  return buildRequests([row], lines, null)[0];
}

async function releaseStock(sheetMeta, rowsBySku, lines) {
  for (const li of lines) {
    const row = rowsBySku.get(String(li.sku_id));
    if (!row) continue;
    const colIndex = await resolveRatecardColumn(sheetMeta, row, row.fields.stock);
    const next = row.currentStock + Number(li.qty);
    await writeRange(row.spreadsheetId, row.title, `${colLetter(colIndex)}${row.row}`, [[next]]);
    row.currentStock = next;
  }
}

export async function cancelOrder(ratecardId, opsId, requestId) {
  const { [TAB_ORDERS]: orders, [TAB_ORDER_LINES]: lines } = await readManagedTabs(opsId, [TAB_ORDERS, TAB_ORDER_LINES]);
  const orderRow = orders.find((r) => String(r.request_id) === requestId);
  if (!orderRow) throw new Error("Unknown request " + requestId);
  if (String(orderRow.status) !== "committed") throw new Error("Only a committed order can be cancelled");

  const myLines = lines.filter((li) => String(li.request_id) === requestId);
  const { rows, sheetMeta } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  const bySku = new Map(rows.map((r) => [r.skuId, r]));
  await releaseStock(sheetMeta, bySku, myLines);

  const sheetIds = await ensureTabs(opsId, [TAB_ORDERS, TAB_ORDER_LINES]);
  const lineRowNumbers = myLines.map((li) => li.__row).sort((a, b) => b - a);
  for (const rowNum of lineRowNumbers) await deleteManagedRow(opsId, sheetIds.get(TAB_ORDER_LINES), rowNum);
  await deleteManagedRow(opsId, sheetIds.get(TAB_ORDERS), orderRow.__row);
}

export async function decideRequest(ratecardId, opsId, requestId, decidedBy, approve, decisionNote) {
  const { [TAB_ORDERS]: orders, [TAB_ORDER_LINES]: lines, [TAB_ACCOUNTS]: accounts } = await readManagedTabs(opsId, [TAB_ORDERS, TAB_ORDER_LINES, TAB_ACCOUNTS]);
  const orderRow = orders.find((r) => String(r.request_id) === requestId);
  if (!orderRow) throw new Error("Unknown request " + requestId);

  const myLines = lines.filter((li) => String(li.request_id) === requestId);
  const { rows, sheetMeta } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  const bySku = new Map(rows.map((r) => [r.skuId, r]));

  if (!approve) await releaseStock(sheetMeta, bySku, myLines);

  const decidedAt = new Date().toISOString();
  await writeCell(opsId, TAB_ORDERS, orderRow.__row, "status", approve ? "approved" : "declined");
  await writeCell(opsId, TAB_ORDERS, orderRow.__row, "decided_at", decidedAt);
  await writeCell(opsId, TAB_ORDERS, orderRow.__row, "decided_by", decidedBy || "");
  await writeCell(opsId, TAB_ORDERS, orderRow.__row, "decision_note", decisionNote || "");
  orderRow.status = approve ? "approved" : "declined";
  orderRow.decided_at = decidedAt;
  orderRow.decided_by = decidedBy || "";
  orderRow.decision_note = decisionNote || "";

  if (approve) {
    const account = accounts.find((a) => String(a.account_id) === String(orderRow.account_id)) || {};
    await appendRows(opsId, TAB_FULFILLMENT, myLines.map((li) => {
      const item = bySku.get(String(li.sku_id)) || {};
      return {
        date_fulfilled: decidedAt, request_id: requestId,
        company_name: account.company_name || "", contact_name: account.contact_name || "", contact_phone: account.contact_phone || "",
        category: item.category || "", product_name: item.productName || li.sku_id,
        qty: Number(li.qty), unit_mrp: Number(li.unit_mrp_snapshot),
        line_total: Number(li.qty) * Number(li.unit_mrp_snapshot),
        approved_by: decidedBy || "", notes: decisionNote || "",
      };
    }));
  }

  return buildRequests([orderRow], myLines, null)[0];
}

export async function requestProduct(ratecardId, opsId, accountId, skuId, qty, note) {
  if (!(Number(qty) > 0)) throw new Error("Quantity must be greater than 0");
  const { rows } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  if (!rows.some((r) => r.skuId === skuId)) throw new Error("Unknown SKU " + skuId);

  const requestId = newId("preq");
  const createdAt = new Date().toISOString();
  await appendRows(opsId, TAB_PRODUCT_REQUESTS, [{
    request_id: requestId, account_id: accountId, sku_id: skuId, qty: Number(qty), note: note || "",
    status: "pending", created_at: createdAt, decided_at: "", decided_by: "", hold_until: "",
  }]);

  return { requestId, accountId, skuId, qty: Number(qty), note: note || null, status: "pending", createdAt, decidedAt: null, decidedBy: null, holdUntil: null };
}

export async function decideProductRequests(opsId, skuId, decidedBy, status, holdUntil) {
  if (["accepted", "declined", "on_hold"].indexOf(status) === -1) throw new Error("Unknown status " + status);

  const { [TAB_PRODUCT_REQUESTS]: rows } = await readManagedTabs(opsId, [TAB_PRODUCT_REQUESTS]);
  const decidedAt = new Date().toISOString();
  const pending = rows.filter((r) => String(r.sku_id) === skuId && String(r.status) === "pending");

  for (const row of pending) {
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "status", status);
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "decided_at", decidedAt);
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "decided_by", decidedBy || "");
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "hold_until", status === "on_hold" ? (holdUntil || "") : "");
    row.status = status;
    row.decided_at = decidedAt;
    row.decided_by = decidedBy || "";
    row.hold_until = status === "on_hold" ? (holdUntil || "") : "";
  }

  return pending.map(toProductRequest);
}

export { withLock };
