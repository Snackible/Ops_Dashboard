import { readRatecardRows, resolveRatecardColumn } from "./lib/ratecard.js";
import {
  writeRange,
  batchWriteRanges,
  batchUpdateSpreadsheet,
  getConditionalFormatRuleCounts,
  listSheets,
  colLetter,
} from "./lib/sheetsClient.js";
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
  TAB_USERS,
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

// Users lives on its own dedicated spreadsheet (loginId) - kept separate
// from Accounts/Orders/etc. (which live on the ratecard spreadsheet, see
// api/sheets.js) so login credentials never share a sheet with anything else.
export async function login(loginId, ratecardId, username, password) {
  if (!username || !password) throw new Error("Username and password are required");
  const [{ [TAB_USERS]: users }, { [TAB_ACCOUNTS]: accounts }] = await Promise.all([
    readManagedTabs(loginId, [TAB_USERS]),
    readManagedTabs(ratecardId, [TAB_ACCOUNTS]),
  ]);

  const match = users.find(
    (u) => String(u.username).trim().toLowerCase() === String(username).trim().toLowerCase() && String(u.password) === String(password)
  );
  if (!match) throw new Error("Invalid username or password");

  const role = String(match.role) === "ops" ? "ops" : "b2b";
  let accountId;
  if (role === "b2b") {
    accountId = String(match.account_id || "").trim();
    if (accountId && !accounts.some((a) => String(a.account_id) === accountId)) {
      throw new Error(`User "${match.username}" has account_id "${accountId}", which doesn't match any row in Accounts`);
    }
    if (!accountId) {
      // A b2b login with no account_id yet gets a bare Account row
      // provisioned from its own name instead of blocking sign-in on a
      // manual two-tab edit - mirrors how the login id itself is derived
      // from the username rather than hand-entered.
      accountId = newId("acct");
      const companyName = match.display_name ? String(match.display_name) : String(match.username);
      await appendRows(ratecardId, TAB_ACCOUNTS, [
        { account_id: accountId, company_name: companyName, contact_name: "", contact_email: "", contact_phone: "" },
      ]);
      await writeCell(loginId, TAB_USERS, match.__row, "account_id", accountId);
    }
  }

  return {
    id: `user-${String(match.username).toLowerCase()}`,
    name: match.display_name ? String(match.display_name) : String(match.username),
    role,
    accountId,
  };
}

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
      requestedByName: r.requested_by_name ? String(r.requested_by_name) : null,
      clientName: r.client_name ? String(r.client_name) : null,
      lineItems: lineRows
        .filter((li) => String(li.request_id) === String(r.request_id))
        .map((li) => ({
          lineItemId: String(li.line_item_id), skuId: String(li.sku_id),
          qty: Number(li.qty), unitMrpSnapshot: Number(li.unit_mrp_snapshot),
          backorderQty: Number(li.backorder_qty) || 0,
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
    linkedRequestId: r.linked_request_id ? String(r.linked_request_id) : null,
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

/**
 * Applies several stock/active/tier edits across possibly-different SKUs in
 * one Sheets batchUpdate instead of one writeRange (and one lock cycle) per
 * field - see server/lib/sheetsClient.js#batchWriteRanges.
 */
export async function updateInventoryFields(ratecardId, updates) {
  const wanted = (updates || []).filter((u) => u && u.skuId && ["stock", "active", "tier"].indexOf(u.field) !== -1);
  if (wanted.length === 0) throw new Error("No updates to apply");

  const { rows, sheetMeta } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  const bySku = new Map(rows.map((r) => [r.skuId, r]));

  const ranges = [];
  const touched = new Map();
  for (const u of wanted) {
    const row = bySku.get(u.skuId);
    if (!row) throw new Error("Unknown SKU " + u.skuId);
    const colIndex = await resolveRatecardColumn(sheetMeta, row, row.fields[u.field]);
    ranges.push({ title: row.title, a1: `${colLetter(colIndex)}${row.row}`, value: u.value });
    if (u.field === "stock") row.currentStock = Number(u.value) || 0;
    if (u.field === "active") row.active = Boolean(u.value);
    if (u.field === "tier") row.tier = String(u.value).toLowerCase();
    touched.set(u.skuId, row);
  }

  await batchWriteRanges(ratecardId, ranges);
  return Array.from(touched.values()).map(toInventoryItem);
}

export async function commitOrder(ratecardId, opsId, accountId, lineItems, requestedByName, clientName) {
  const wanted = (lineItems || []).filter((li) => Number(li.qty) > 0);
  if (wanted.length === 0) throw new Error("Add at least one item before committing");

  const { rows, sheetMeta } = await readRatecardRows(ratecardId, MANAGED_TITLES);
  const bySku = new Map(rows.map((r) => [r.skuId, r]));

  // Only qty - backorderQty is ever reserved from stock; the rest is the
  // shortfall a linked ProductRequest tracks below, so the order (and any
  // fully-available lines in it) isn't held up waiting on production.
  const withReserve = wanted.map((li) => {
    const row = bySku.get(li.skuId);
    if (!row) throw new Error("Unknown SKU " + li.skuId);
    const backorderQty = Number(li.backorderQty) || 0;
    const reserveQty = Number(li.qty) - backorderQty;
    if (reserveQty > row.currentStock) throw new Error(`Only ${row.currentStock} available for ${row.productName}`);
    return { ...li, backorderQty, reserveQty, row };
  });

  for (const li of withReserve) {
    if (li.reserveQty === 0) continue;
    const colIndex = await resolveRatecardColumn(sheetMeta, li.row, li.row.fields.stock);
    await writeRange(li.row.spreadsheetId, li.row.title, `${colLetter(colIndex)}${li.row.row}`, [[li.row.currentStock - li.reserveQty]]);
    li.row.currentStock -= li.reserveQty;
  }

  const requestId = newId("req");
  const createdAt = new Date().toISOString();
  const withLineIds = withReserve.map((li) => ({ ...li, lineItemId: newId("line") }));

  await appendRows(opsId, TAB_ORDERS, [{
    request_id: requestId, account_id: accountId, status: "committed", created_at: createdAt,
    submitted_at: "", decided_at: "", decided_by: "", decision_note: "", requested_by_name: requestedByName || "",
    client_name: clientName || "",
  }]);
  await appendRows(opsId, TAB_ORDER_LINES, withLineIds.map((li) => ({
    line_item_id: li.lineItemId, request_id: requestId, sku_id: li.skuId,
    qty: Number(li.qty), unit_mrp_snapshot: Number(li.row.mrpInr), backorder_qty: li.backorderQty,
  })));

  const backordered = withLineIds.filter((li) => li.backorderQty > 0);
  if (backordered.length > 0) {
    await appendRows(opsId, TAB_PRODUCT_REQUESTS, backordered.map((li) => ({
      request_id: newId("preq"), account_id: accountId, sku_id: li.skuId, qty: li.backorderQty, note: "",
      status: "pending", created_at: createdAt, decided_at: "", decided_by: "", hold_until: "", linked_request_id: requestId,
    })));
  }

  return {
    requestId, accountId, status: "committed", createdAt,
    submittedAt: null, decidedAt: null, decidedBy: null, decisionNote: null, requestedByName: requestedByName || null,
    clientName: clientName || null,
    lineItems: withLineIds.map((li) => ({
      lineItemId: li.lineItemId, skuId: li.skuId, qty: Number(li.qty), unitMrpSnapshot: Number(li.row.mrpInr), backorderQty: li.backorderQty,
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
    // Only qty - backorder_qty was ever reserved (see commitOrder) - that's
    // all there is to give back.
    const reserved = Number(li.qty) - (Number(li.backorder_qty) || 0);
    if (reserved === 0) continue;
    const colIndex = await resolveRatecardColumn(sheetMeta, row, row.fields.stock);
    const next = row.currentStock + reserved;
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
    status: "pending", created_at: createdAt, decided_at: "", decided_by: "", hold_until: "", linked_request_id: "",
  }]);

  return { requestId, accountId, skuId, qty: Number(qty), note: note || null, status: "pending", createdAt, decidedAt: null, decidedBy: null, holdUntil: null, linkedRequestId: null };
}

export async function decideProductRequests(opsId, skuId, decidedBy, status, holdUntil) {
  if (["accepted", "declined", "on_hold"].indexOf(status) === -1) throw new Error("Unknown status " + status);
  // Accepting means production has been committed to - it needs an expected
  // delivery date for the same reason a hold needs a revisit date, so B2B
  // isn't left with an open-ended "yes" and no idea when to expect it.
  const needsDate = status === "accepted" || status === "on_hold";
  if (needsDate && !holdUntil) throw new Error(`A date is required to ${status === "accepted" ? "accept" : "hold"} a production request`);

  const { [TAB_PRODUCT_REQUESTS]: rows } = await readManagedTabs(opsId, [TAB_PRODUCT_REQUESTS]);
  const decidedAt = new Date().toISOString();
  const pending = rows.filter((r) => String(r.sku_id) === skuId && String(r.status) === "pending");

  for (const row of pending) {
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "status", status);
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "decided_at", decidedAt);
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "decided_by", decidedBy || "");
    await writeCell(opsId, TAB_PRODUCT_REQUESTS, row.__row, "hold_until", needsDate ? holdUntil : "");
    row.status = status;
    row.decided_at = decidedAt;
    row.decided_by = decidedBy || "";
    row.hold_until = needsDate ? holdUntil : "";
  }

  return pending.map(toProductRequest);
}

const TIER_FILL_COLORS = {
  green: { red: 0.702, green: 0.851, blue: 0.651 },
  yellow: { red: 1, green: 0.851, blue: 0.4 },
  orange: { red: 0.949, green: 0.702, blue: 0.349 },
  red: { red: 0.902, green: 0.549, blue: 0.549 },
};

/**
 * One-time setup: colors each ratecard row by its Tier. Split so the base
 * product's columns follow "Tier" and the Larger Pack columns follow
 * "Larger Pack Tier" independently, since a single row can carry two
 * different tiers for its two variants and can't be one solid color for
 * both. Safe to re-run - clears each target sheet's existing conditional
 * formats first instead of piling up duplicates on a second run.
 */
export async function addTierRowHighlighting(ratecardId) {
  const sheets = await listSheets(ratecardId);
  const byTitle = new Map(sheets.map((s) => [s.title, s.sheetId]));
  const ruleCounts = await getConditionalFormatRuleCounts(ratecardId);

  const requests = [];
  const targetSheetIds = new Set();

  function addTierRules(sheetId, colRanges, tierColLetter, startRowIndex = 1, endRowIndex = 2000) {
    targetSheetIds.add(sheetId);
    const ranges = colRanges.map((c) => ({
      sheetId, startRowIndex, endRowIndex, startColumnIndex: c.start, endColumnIndex: c.end,
    }));
    // An untiered product (blank Tier/Larger Pack Tier cell) defaults to
    // yellow rather than staying uncolored, so a missing tier reads as
    // "needs attention" instead of blending into the sheet's white background.
    // Gated on Product Name (column B) being non-blank so category banner
    // rows - which have no tier OR product name - don't get swept up too.
    const row = startRowIndex + 1;
    for (const [formula, tier] of [
      [`=$${tierColLetter}${row}="green"`, "green"],
      [`=$${tierColLetter}${row}="yellow"`, "yellow"],
      [`=$${tierColLetter}${row}="orange"`, "orange"],
      [`=$${tierColLetter}${row}="red"`, "red"],
      [`=AND($B${row}<>"", $${tierColLetter}${row}="")`, "yellow"],
    ]) {
      requests.push({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges,
            booleanRule: {
              condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] },
              format: { backgroundColor: TIER_FILL_COLORS[tier] },
            },
          },
        },
      });
    }
  }

  // "Standard Grammage": Category,Product Name,Grammage,MRP,Larger Pack
  // Grammage,Larger Pack MRP,Shelf Life,Inventory,Larger Pack Current
  // Stock,Larger Pack Tier,Tier - columns A-K, 0-based 0-10.
  const standardId = byTitle.get("Standard Grammage");
  if (standardId !== undefined) {
    addTierRules(standardId, [{ start: 0, end: 4 }, { start: 6, end: 8 }, { start: 10, end: 11 }], "K");
    addTierRules(standardId, [{ start: 4, end: 6 }, { start: 8, end: 10 }], "J");
  }

  // "One Serving Pack": Category,Product Name,Grammage,MRP,Shelf Life,
  // Inventory,Tier - columns A-G, 0-based 0-6, no Larger Pack columns.
  const oneServingId = byTitle.get("One Serving Pack");
  if (oneServingId !== undefined) {
    addTierRules(oneServingId, [{ start: 0, end: 7 }], "G");
  }

  if (requests.length === 0) throw new Error("Neither \"Standard Grammage\" nor \"One Serving Pack\" tab was found");

  const deletes = [];
  for (const sheetId of targetSheetIds) {
    const existing = ruleCounts.get(sheetId) || 0;
    for (let i = existing - 1; i >= 0; i--) deletes.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  await batchUpdateSpreadsheet(ratecardId, [...deletes, ...requests]);
  return { sheetsUpdated: targetSheetIds.size, rulesAdded: requests.length, rulesCleared: deletes.length };
}

/** Undoes addTierRowHighlighting - strips every conditional format rule from the two ratecard tabs, no replacement. */
export async function removeTierRowHighlighting(ratecardId) {
  const sheets = await listSheets(ratecardId);
  const byTitle = new Map(sheets.map((s) => [s.title, s.sheetId]));
  const ruleCounts = await getConditionalFormatRuleCounts(ratecardId);

  const targetSheetIds = ["Standard Grammage", "One Serving Pack"]
    .map((title) => byTitle.get(title))
    .filter((id) => id !== undefined);

  const deletes = [];
  for (const sheetId of targetSheetIds) {
    const existing = ruleCounts.get(sheetId) || 0;
    for (let i = existing - 1; i >= 0; i--) deletes.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  await batchUpdateSpreadsheet(ratecardId, deletes);
  return { sheetsUpdated: targetSheetIds.length, rulesCleared: deletes.length };
}

export { withLock };
