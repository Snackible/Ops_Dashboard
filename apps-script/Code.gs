/**
 * Snackible Ops Dashboard - Google Sheets backend.
 *
 * This file is the whole backend. It runs as an Apps Script Web App bound to
 * one spreadsheet, and that spreadsheet IS the database: one tab per table.
 *
 * Why Apps Script rather than calling the Sheets API from the browser:
 *   - The browser never holds a credential. The script runs as the sheet's
 *     owner, so B2B users don't need Google accounts or sheet access.
 *   - LockService gives us a global mutex. Sheets has no transactions, so
 *     without it two accounts committing at the same moment would both read
 *     "12 in stock" and both reserve 10. Every mutating action below runs
 *     inside withLock_(), which is what makes stock math safe.
 *
 * Setup (once):
 *   1. Open the SAME spreadsheet that already has your ratecard tab
 *      (Category | Product Name | Grammage (g) | MRP (INR) | Shelf Life)
 *      > Extensions > Apps Script.
 *   2. Paste this file and Catalog.gs into the editor.
 *   3. Run setupSheets() once. It creates the operational tabs (Inventory,
 *      Accounts, Orders, OrderLines, FulfillmentLog) alongside your existing
 *      ones, and seeds Inventory by reading the real rows out of your
 *      ratecard tab (see extractCatalogFromRatecard_) - not from a bundled
 *      snapshot. Catalog.gs is only a fallback if no ratecard tab is found.
 *   4. (Optional) Project Settings > Script Properties > add API_TOKEN.
 *   5. Deploy > New deployment > Web app > Execute as: Me,
 *      Who has access: Anyone. Copy the /exec URL into VITE_SHEETS_API_URL.
 */

const TAB_INVENTORY = 'Inventory';
const TAB_ACCOUNTS = 'Accounts';
const TAB_ORDERS = 'Orders';
const TAB_ORDER_LINES = 'OrderLines';
const TAB_FULFILLMENT = 'FulfillmentLog';

const COLUMNS = {
  [TAB_INVENTORY]: ['sku_id', 'category', 'product_name', 'grammage_g', 'mrp_inr', 'shelf_life_days', 'current_stock', 'active', 'tier'],
  [TAB_ACCOUNTS]: ['account_id', 'company_name', 'contact_name', 'contact_email', 'contact_phone'],
  [TAB_ORDERS]: ['request_id', 'account_id', 'status', 'created_at', 'submitted_at', 'decided_at', 'decided_by', 'decision_note'],
  [TAB_ORDER_LINES]: ['line_item_id', 'request_id', 'sku_id', 'qty', 'unit_mrp_snapshot'],
  [TAB_FULFILLMENT]: ['date_fulfilled', 'request_id', 'company_name', 'contact_name', 'contact_phone', 'category', 'product_name', 'qty', 'unit_mrp', 'line_total', 'approved_by', 'notes'],
};

// ── Web app entry points ────────────────────────────────────────────────

function doPost(e) {
  return respond_(route_(parseBody_(e)));
}

function doGet(e) {
  // Handy for poking at read actions from a browser address bar.
  return respond_(route_(e && e.parameter ? e.parameter : {}));
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return {};
  }
}

function respond_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function route_(body) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (expected && body.token !== expected) {
      return { ok: false, error: 'Unauthorized' };
    }

    switch (body.action) {
      // reads
      case 'getInventory': return ok_(getInventory_());
      case 'getAccounts': return ok_(getAccounts_());
      case 'getRequests': return ok_(getRequests_(null));
      case 'getRequestsForAccount': return ok_(getRequests_(body.accountId));
      case 'getCommittedOrders': return ok_(getRequests_(body.accountId).filter(r => r.status === 'committed'));
      case 'getFulfillmentLog': return ok_(getFulfillmentLog_());

      // writes
      case 'updateStock': return ok_(withLock_(() => setInventoryField_(body.skuId, 'current_stock', body.currentStock)));
      case 'setActive': return ok_(withLock_(() => setInventoryField_(body.skuId, 'active', body.active)));
      case 'setTier': return ok_(withLock_(() => setInventoryField_(body.skuId, 'tier', body.tier)));
      case 'commitOrder': return ok_(withLock_(() => commitOrder_(body.accountId, body.lineItems)));
      case 'pushOrder': return ok_(withLock_(() => pushOrder_(body.requestId)));
      case 'decideRequest': return ok_(withLock_(() => decideRequest_(body.requestId, body.decidedBy, body.approve, body.decisionNote)));

      default: return { ok: false, error: 'Unknown action: ' + body.action };
    }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function ok_(data) {
  return { ok: true, data: data };
}

/**
 * Serializes every mutating action across all callers. Sheets has no
 * transactions, so this mutex is the only thing preventing two simultaneous
 * commits from reserving the same units.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Server busy, please retry');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ── Sheet helpers ───────────────────────────────────────────────────────

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '". Run setupSheets() first.');
  return sheet;
}

/** Reads a whole tab as objects keyed by the header row. */
function readTab_(name) {
  const values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === '' && values[i][1] === '') continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    row.__row = i + 1; // 1-based sheet row, for targeted writes
    rows.push(row);
  }
  return rows;
}

function appendRows_(name, objects) {
  if (objects.length === 0) return;
  const headers = COLUMNS[name];
  const rows = objects.map(obj => headers.map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h])));
  sheet_(name).getRange(sheet_(name).getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function writeCell_(name, rowNumber, column, value) {
  const colIndex = COLUMNS[name].indexOf(column);
  if (colIndex < 0) throw new Error('Unknown column ' + column);
  sheet_(name).getRange(rowNumber, colIndex + 1).setValue(value);
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function isoOrNull_(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// ── Reads (rows come back already shaped for the app) ───────────────────

function getInventory_() {
  return readTab_(TAB_INVENTORY).map(r => ({
    skuId: String(r.sku_id),
    category: String(r.category),
    productName: String(r.product_name),
    grammageG: Number(r.grammage_g),
    mrpInr: Number(r.mrp_inr),
    shelfLifeDays: Number(r.shelf_life_days),
    currentStock: Number(r.current_stock) || 0,
    active: r.active === true || String(r.active).toUpperCase() === 'TRUE',
    tier: String(r.tier || 'yellow'),
  }));
}

function getAccounts_() {
  return readTab_(TAB_ACCOUNTS).map(r => ({
    accountId: String(r.account_id),
    companyName: String(r.company_name),
    contactName: String(r.contact_name),
    contactEmail: String(r.contact_email),
    contactPhone: String(r.contact_phone),
    pricingTierId: null,
  }));
}

function getRequests_(accountId) {
  const lines = readTab_(TAB_ORDER_LINES);
  return readTab_(TAB_ORDERS)
    .filter(r => !accountId || String(r.account_id) === accountId)
    .map(r => ({
      requestId: String(r.request_id),
      accountId: String(r.account_id),
      status: String(r.status),
      createdAt: isoOrNull_(r.created_at) || new Date().toISOString(),
      submittedAt: isoOrNull_(r.submitted_at),
      decidedAt: isoOrNull_(r.decided_at),
      decidedBy: r.decided_by ? String(r.decided_by) : null,
      decisionNote: r.decision_note ? String(r.decision_note) : null,
      lineItems: lines
        .filter(li => String(li.request_id) === String(r.request_id))
        .map(li => ({
          lineItemId: String(li.line_item_id),
          skuId: String(li.sku_id),
          qty: Number(li.qty),
          unitMrpSnapshot: Number(li.unit_mrp_snapshot),
        })),
    }));
}

function getFulfillmentLog_() {
  return readTab_(TAB_FULFILLMENT).map(r => ({
    dateFulfilled: isoOrNull_(r.date_fulfilled),
    requestId: String(r.request_id),
    companyName: String(r.company_name),
    contactName: String(r.contact_name),
    contactPhone: String(r.contact_phone),
    category: String(r.category),
    productName: String(r.product_name),
    qty: Number(r.qty),
    unitMrp: Number(r.unit_mrp),
    lineTotal: Number(r.line_total),
    approvedBy: String(r.approved_by),
    notes: r.notes ? String(r.notes) : '',
  }));
}

// ── Writes ──────────────────────────────────────────────────────────────

function setInventoryField_(skuId, column, value) {
  const row = readTab_(TAB_INVENTORY).filter(r => String(r.sku_id) === skuId)[0];
  if (!row) throw new Error('Unknown SKU ' + skuId);
  writeCell_(TAB_INVENTORY, row.__row, column, value);
  return getInventory_().filter(i => i.skuId === skuId)[0];
}

/**
 * Creates one order from a whole cart. Validates every line against current
 * stock before writing anything, so an order either reserves in full or not
 * at all - the closest thing to a transaction Sheets allows.
 */
function commitOrder_(accountId, lineItems) {
  const wanted = (lineItems || []).filter(li => Number(li.qty) > 0);
  if (wanted.length === 0) throw new Error('Add at least one item before committing');

  const inventoryRows = readTab_(TAB_INVENTORY);
  const bySku = {};
  inventoryRows.forEach(r => { bySku[String(r.sku_id)] = r; });

  wanted.forEach(li => {
    const row = bySku[li.skuId];
    if (!row) throw new Error('Unknown SKU ' + li.skuId);
    if (Number(li.qty) > Number(row.current_stock)) {
      throw new Error('Only ' + Number(row.current_stock) + ' available for ' + row.product_name);
    }
  });

  const requestId = newId_('req');
  const createdAt = new Date().toISOString();

  wanted.forEach(li => {
    const row = bySku[li.skuId];
    writeCell_(TAB_INVENTORY, row.__row, 'current_stock', Number(row.current_stock) - Number(li.qty));
  });

  appendRows_(TAB_ORDERS, [{
    request_id: requestId,
    account_id: accountId,
    status: 'committed',
    created_at: createdAt,
    submitted_at: '',
    decided_at: '',
    decided_by: '',
    decision_note: '',
  }]);

  appendRows_(TAB_ORDER_LINES, wanted.map(li => ({
    line_item_id: newId_('line'),
    request_id: requestId,
    sku_id: li.skuId,
    qty: Number(li.qty),
    unit_mrp_snapshot: Number(bySku[li.skuId].mrp_inr),
  })));

  return getRequests_(accountId).filter(r => r.requestId === requestId)[0];
}

function pushOrder_(requestId) {
  const row = readTab_(TAB_ORDERS).filter(r => String(r.request_id) === requestId)[0];
  if (!row) throw new Error('Unknown request ' + requestId);
  if (String(row.status) !== 'committed') throw new Error('Only a committed order can be pushed');

  writeCell_(TAB_ORDERS, row.__row, 'status', 'pending');
  writeCell_(TAB_ORDERS, row.__row, 'submitted_at', new Date().toISOString());
  return getRequests_(null).filter(r => r.requestId === requestId)[0];
}

/**
 * Approve keeps the stock deducted and writes the fulfillment rows.
 * Decline puts every reserved unit back. No partial approval.
 */
function decideRequest_(requestId, decidedBy, approve, decisionNote) {
  const orderRow = readTab_(TAB_ORDERS).filter(r => String(r.request_id) === requestId)[0];
  if (!orderRow) throw new Error('Unknown request ' + requestId);

  const lines = readTab_(TAB_ORDER_LINES).filter(li => String(li.request_id) === requestId);
  const inventoryRows = readTab_(TAB_INVENTORY);
  const bySku = {};
  inventoryRows.forEach(r => { bySku[String(r.sku_id)] = r; });

  if (!approve) {
    lines.forEach(li => {
      const row = bySku[String(li.sku_id)];
      if (row) writeCell_(TAB_INVENTORY, row.__row, 'current_stock', Number(row.current_stock) + Number(li.qty));
    });
  }

  const decidedAt = new Date().toISOString();
  writeCell_(TAB_ORDERS, orderRow.__row, 'status', approve ? 'approved' : 'declined');
  writeCell_(TAB_ORDERS, orderRow.__row, 'decided_at', decidedAt);
  writeCell_(TAB_ORDERS, orderRow.__row, 'decided_by', decidedBy || '');
  writeCell_(TAB_ORDERS, orderRow.__row, 'decision_note', decisionNote || '');

  if (approve) {
    const account = readTab_(TAB_ACCOUNTS).filter(a => String(a.account_id) === String(orderRow.account_id))[0] || {};
    appendRows_(TAB_FULFILLMENT, lines.map(li => {
      const item = bySku[String(li.sku_id)] || {};
      return {
        date_fulfilled: decidedAt,
        request_id: requestId,
        company_name: account.company_name || '',
        contact_name: account.contact_name || '',
        contact_phone: account.contact_phone || '',
        category: item.category || '',
        product_name: item.product_name || li.sku_id,
        qty: Number(li.qty),
        unit_mrp: Number(li.unit_mrp_snapshot),
        line_total: Number(li.qty) * Number(li.unit_mrp_snapshot),
        approved_by: decidedBy || '',
        notes: decisionNote || '',
      };
    }));
  }

  return getRequests_(null).filter(r => r.requestId === requestId)[0];
}

// ── One-time setup ──────────────────────────────────────────────────────

/**
 * Finds the existing ratecard tab already sitting in this spreadsheet
 * (Category | Product Name | Grammage (g) | MRP (INR) | Shelf Life, with
 * section-banner rows like "Best Sellers" and blank spacer rows mixed in)
 * and pulls out only the real product rows. This is what "the same sheet"
 * means: the app's Inventory tab is seeded from the ratecard that's
 * already here, not from a bundled snapshot.
 */
function extractCatalogFromRatecard_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const ownTabNames = Object.keys(COLUMNS);

  const candidate = spreadsheet.getSheets().find(sheet => {
    if (ownTabNames.indexOf(sheet.getName()) !== -1) return false;
    const header = sheet.getRange(1, 1, 1, Math.min(5, sheet.getLastColumn() || 1)).getValues()[0] || [];
    const normalized = header.map(h => String(h).trim().toLowerCase());
    return normalized[0] === 'category' && normalized[1] && normalized[1].indexOf('product') !== -1;
  });

  if (!candidate) return [];

  const values = candidate.getDataRange().getValues();
  const items = [];
  const seenIds = {};

  for (let i = 1; i < values.length; i++) {
    const [category, productName, grammage, mrp, shelfLife] = values[i];
    // Section-banner rows ("Best Sellers") and blank spacer rows have no
    // numeric grammage/MRP/shelf life - that's what distinguishes a real
    // product row here, not just a non-empty column A.
    if (!category || !productName) continue;
    if (grammage === '' || mrp === '' || shelfLife === '') continue;
    if (isNaN(Number(grammage)) || isNaN(Number(mrp)) || isNaN(Number(shelfLife))) continue;

    let skuId = slugify_(category + '-' + productName);
    let suffix = 2;
    while (seenIds[skuId]) { skuId = slugify_(category + '-' + productName) + '-' + suffix++; }
    seenIds[skuId] = true;

    items.push({
      skuId: skuId,
      category: String(category).trim(),
      productName: String(productName).trim(),
      grammageG: Number(grammage),
      mrpInr: Number(mrp),
      shelfLifeDays: Number(shelfLife),
    });
  }

  return items;
}

function slugify_(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Creates any missing tabs, writes headers, and seeds catalog + accounts. */
function setupSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(COLUMNS).forEach(name => {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const headers = COLUMNS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  if (sheet_(TAB_INVENTORY).getLastRow() < 2) {
    const extracted = extractCatalogFromRatecard_();
    const catalog = extracted.length > 0 ? extracted : CATALOG;
    if (extracted.length === 0) {
      Logger.log('No ratecard tab found in this spreadsheet - falling back to the bundled Catalog.gs snapshot. ' +
        'If your ratecard tab uses different header names, seed Inventory manually or adjust extractCatalogFromRatecard_().');
    }
    appendRows_(TAB_INVENTORY, catalog.map(item => ({
      sku_id: item.skuId,
      category: item.category,
      product_name: item.productName,
      grammage_g: item.grammageG,
      mrp_inr: item.mrpInr,
      shelf_life_days: item.shelfLifeDays,
      current_stock: 0,
      active: true,
      tier: 'yellow',
    })));
  }

  if (sheet_(TAB_ACCOUNTS).getLastRow() < 2) {
    appendRows_(TAB_ACCOUNTS, [
      { account_id: 'acct-blue-orchard', company_name: 'Blue Orchard Mart', contact_name: 'Rahul Mehta', contact_email: 'rahul@blueorchardmart.example', contact_phone: '+91 98200 11223' },
      { account_id: 'acct-corner-cafe', company_name: 'Corner Cafe Collective', contact_name: 'Ayesha Khan', contact_email: 'ayesha@cornercafe.example', contact_phone: '+91 98100 44556' },
    ]);
  }
}
