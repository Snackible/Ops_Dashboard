/**
 * Snackible Ops Dashboard - Google Sheets backend.
 *
 * This file is the whole backend. It runs as an Apps Script Web App bound to
 * one spreadsheet, and that spreadsheet IS the database.
 *
 * Inventory has no tab of its own - it reads and writes directly against
 * every existing tab that looks like a ratecard (a "Category" + "Product
 * Name" header pair), the same tabs you already price products in - e.g. a
 * "Standard Grammage" tab and a "One Serving Pack" tab both contribute rows,
 * kept as distinct SKUs. Nothing is copied out of them. Three extra columns
 * get added to each tab the first time they're needed:
 *   - Current Stock - absent (or blank on a row) means 0. Ops can type real
 *     counts into this column by hand, or the app fills it in the moment
 *     someone commits an order, toggles active, or re-tiers something.
 *   - Active        - absent or blank means active.
 *   - Tier          - absent or blank means "yellow".
 * If you'd rather name the stock column yourself, "Inventory" or "Stock"
 * are recognized too - see ratecardColumns_() below.
 *
 * Why Apps Script rather than calling the Sheets API from the browser:
 *   - The browser never holds a credential. The script runs as the sheet's
 *     owner, so B2B users don't need Google accounts or sheet access.
 *   - LockService gives us a global mutex. Sheets has no transactions, so
 *     without it two accounts committing at the same moment could both read
 *     "12 in stock" and both reserve 10. Every mutating action below runs
 *     inside withLock_(), which is what makes stock math safe.
 *
 * Setup (once):
 *   1. Open the spreadsheet that already has your ratecard tab in it
 *      (a tab with "Category" and "Product Name" header columns somewhere
 *      in row 1 - Grammage/MRP/Shelf Life columns can be named and ordered
 *      however your sheet already has them) > Extensions > Apps Script.
 *   2. Paste this file into the editor.
 *   3. Run setupSheets() once. It creates the operational tabs - Accounts,
 *      Orders, OrderLines, FulfillmentLog - alongside your existing ones.
 *      It does not touch or seed your ratecard tab.
 *   4. (Optional) Project Settings > Script Properties > add API_TOKEN.
 *   5. Deploy > New deployment > Web app > Execute as: Me,
 *      Who has access: Anyone. Copy the /exec URL into VITE_SHEETS_API_URL.
 */

const TAB_ACCOUNTS = 'Accounts';
const TAB_ORDERS = 'Orders';
const TAB_ORDER_LINES = 'OrderLines';
const TAB_FULFILLMENT = 'FulfillmentLog';
const TAB_PRODUCT_REQUESTS = 'ProductRequests';

const COLUMNS = {
  [TAB_ACCOUNTS]: ['account_id', 'company_name', 'contact_name', 'contact_email', 'contact_phone'],
  [TAB_ORDERS]: ['request_id', 'account_id', 'status', 'created_at', 'submitted_at', 'decided_at', 'decided_by', 'decision_note'],
  [TAB_ORDER_LINES]: ['line_item_id', 'request_id', 'sku_id', 'qty', 'unit_mrp_snapshot'],
  [TAB_FULFILLMENT]: ['date_fulfilled', 'request_id', 'company_name', 'contact_name', 'contact_phone', 'category', 'product_name', 'qty', 'unit_mrp', 'line_total', 'approved_by', 'notes'],
  [TAB_PRODUCT_REQUESTS]: ['request_id', 'account_id', 'sku_id', 'qty', 'note', 'status', 'created_at', 'decided_at', 'decided_by', 'hold_until'],
};

const OPERATIONAL_HEADERS = {
  standard: { stock: 'Current Stock', active: 'Active', tier: 'Tier' },
  largerPack: { stock: 'Larger Pack Current Stock', active: 'Larger Pack Active', tier: 'Larger Pack Tier' },
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
      case 'getProductRequests': return ok_(getProductRequests_(null));
      case 'getProductRequestsForAccount': return ok_(getProductRequests_(body.accountId));

      // writes
      case 'updateStock': return ok_(withLock_(() => setInventoryField_(body.skuId, 'current_stock', body.currentStock)));
      case 'setActive': return ok_(withLock_(() => setInventoryField_(body.skuId, 'active', body.active)));
      case 'setTier': return ok_(withLock_(() => setInventoryField_(body.skuId, 'tier', body.tier)));
      case 'commitOrder': return ok_(withLock_(() => commitOrder_(body.accountId, body.lineItems)));
      case 'pushOrder': return ok_(withLock_(() => pushOrder_(body.requestId)));
      case 'cancelOrder': return ok_(withLock_(() => cancelOrder_(body.requestId)));
      case 'decideRequest': return ok_(withLock_(() => decideRequest_(body.requestId, body.decidedBy, body.approve, body.decisionNote)));
      case 'requestProduct': return ok_(withLock_(() => requestProduct_(body.accountId, body.skuId, body.qty, body.note)));
      case 'decideProductRequests': return ok_(withLock_(() => decideProductRequests_(body.skuId, body.decidedBy, body.status, body.holdUntil)));

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

// ── Managed-tab helpers (Accounts / Orders / OrderLines / FulfillmentLog) ──

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '". Run setupSheets() first.');
  return sheet;
}

/** Reads a whole managed tab as objects keyed by the header row. */
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

function slugify_(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Ratecard sheet (this IS the Inventory tab) ──────────────────────────

/**
 * Finds every ratecard tab already sitting in this spreadsheet - any
 * non-managed tab whose header row has both a "Category" and a
 * "Product Name"-ish column, wherever they happen to be. Column order and
 * naming otherwise (Grammage/MRP/Shelf Life, plus whatever else like a
 * "Larger Pack" variant lives alongside them) don't matter - see
 * ratecardColumns_(). All matching tabs are used - e.g. a "Standard
 * Grammage" tab and a "One Serving Pack" tab both feed Inventory as
 * distinct, independently-stocked rows.
 */
function findRatecardSheets_() {
  const managed = Object.keys(COLUMNS);
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  const matches = [];
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    if (managed.indexOf(sheet.getName()) !== -1) continue;
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) continue;
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
    const hasCategory = header.indexOf('category') !== -1;
    const hasProduct = header.some(h => h.indexOf('product') !== -1);
    if (hasCategory && hasProduct) matches.push(sheet);
  }
  if (matches.length === 0) throw new Error('No ratecard tab found. Add a tab with "Category" and "Product Name" header columns.');
  return matches;
}

function findHeaderCol_(header, matcher) {
  for (let i = 0; i < header.length; i++) {
    if (matcher(header[i])) return i;
  }
  return -1;
}

/** Locates every column this app cares about on the ratecard tab by header name, not position. */
function ratecardColumns_(sheet) {
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toLowerCase());
  const isLarger = h => h.indexOf('larger') !== -1;
  return {
    lastCol: lastCol,
    catCol: findHeaderCol_(header, h => h === 'category'),
    nameCol: findHeaderCol_(header, h => h.indexOf('product') !== -1),
    gramCol: findHeaderCol_(header, h => h.indexOf('grammage') !== -1 && !isLarger(h)),
    mrpCol: findHeaderCol_(header, h => h.indexOf('mrp') !== -1 && !isLarger(h)),
    shelfCol: findHeaderCol_(header, h => h.indexOf('shelf') !== -1),
    stockCol: findHeaderCol_(header, h => !isLarger(h) && (h.indexOf('current stock') !== -1 || h === 'inventory' || h === 'stock')),
    activeCol: findHeaderCol_(header, h => h === 'active'),
    tierCol: findHeaderCol_(header, h => h === 'tier'),
    // Some ratecard tabs (e.g. "Standard Grammage") also price a bigger pack
    // of the same product on the same row - a distinct orderable SKU with
    // its own grammage/price and, once touched, its own stock/active/tier.
    largerGramCol: findHeaderCol_(header, h => h.indexOf('grammage') !== -1 && isLarger(h)),
    largerMrpCol: findHeaderCol_(header, h => h.indexOf('mrp') !== -1 && isLarger(h)),
    largerStockCol: findHeaderCol_(header, h => isLarger(h) && (h.indexOf('current stock') !== -1 || h.indexOf('inventory') !== -1 || h.indexOf('stock') !== -1)),
    largerActiveCol: findHeaderCol_(header, h => h === 'larger pack active'),
    largerTierCol: findHeaderCol_(header, h => h === 'larger pack tier'),
  };
}

/**
 * Resolves a field (stock/active/tier) to a 1-based column to write to.
 * `field.index` is the column ratecardColumns_() already found for this
 * sheet via alias matching (e.g. a column the user named "Inventory") - if
 * that's set, it's used as-is, so a write never creates a second column
 * next to one that already exists under a different recognized name. Only
 * when no such column was found at all does this fall back to looking for
 * (or creating) one under the canonical name, re-checking the header row
 * first in case an earlier write in this same request already added it.
 */
function resolveRatecardColumn_(sheet, field) {
  if (field.index !== -1) return field.index + 1;

  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < header.length; i++) {
    if (String(header[i]).trim().toLowerCase() === field.header.toLowerCase()) return i + 1;
  }
  const newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(field.header).setFontWeight('bold');
  return newCol;
}

function uniqueSkuId_(seenIds, base, sheetName) {
  let skuId = base;
  if (seenIds[skuId]) {
    // Already used by another row (a different tab, or this product's own
    // larger-pack variant) - tag it with the tab name so both stay
    // addressable and stable.
    skuId = slugify_(base + '-' + sheetName);
    let suffix = 2;
    while (seenIds[skuId]) { skuId = slugify_(base + '-' + sheetName) + '-' + suffix++; }
  }
  seenIds[skuId] = true;
  return skuId;
}

function readNumericCell_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function readOperationalCell_(colIndex, r, kind, fallback) {
  if (colIndex === -1) return fallback;
  const val = r[colIndex];
  if (val === '' || val === null || val === undefined) return fallback;
  if (kind === 'stock') { const n = Number(val); return isNaN(n) ? fallback : n; }
  if (kind === 'active') return val === true || String(val).toUpperCase() === 'TRUE';
  return String(val).trim().toLowerCase(); // tier
}

/**
 * Reads every real product row off every ratecard tab. Section-banner rows
 * (a big merged "Best Sellers"-style divider) and blank spacer rows have no
 * numeric grammage/MRP/shelf life - that's what distinguishes an actual
 * product row here, not just a non-empty Category cell. Each row carries
 * its own `sheet` reference and its own `fields` (which Current
 * Stock/Active/Tier columns to read/write, and under what name to create
 * one if it's missing) so writes land back on the right tab and column.
 *
 * The same Category + Product Name can legitimately appear more than once -
 * across tabs (a bulk pack on "Standard Grammage", a trial size on "One
 * Serving Pack") or on the same row (a "Larger Pack Grammage/MRP" pair next
 * to the standard one). Each becomes its own row with a distinct sku_id
 * rather than colliding together.
 */
function readRatecardRows_() {
  const sheets = findRatecardSheets_();
  const rows = [];
  const seenIds = {};

  sheets.forEach(sheet => {
    const cols = ratecardColumns_(sheet);
    const missing = ['catCol', 'nameCol', 'gramCol', 'mrpCol', 'shelfCol'].filter(k => cols[k] === -1);
    if (missing.length > 0) {
      throw new Error('Ratecard tab "' + sheet.getName() + '" is missing a header column for: ' + missing.join(', '));
    }

    const values = sheet.getDataRange().getValues();

    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const category = r[cols.catCol];
      const productName = r[cols.nameCol];
      const grammage = r[cols.gramCol];
      const mrp = r[cols.mrpCol];
      const shelfLife = r[cols.shelfCol];
      if (!category || !productName) continue;
      if (grammage === '' || mrp === '' || shelfLife === '') continue;
      if (isNaN(Number(grammage)) || isNaN(Number(mrp)) || isNaN(Number(shelfLife))) continue;

      const catTrimmed = String(category).trim();
      const nameTrimmed = String(productName).trim();
      const rowNumber = i + 1;

      const standardBase = slugify_(catTrimmed + '-' + nameTrimmed);
      rows.push({
        sheet: sheet,
        __row: rowNumber,
        skuId: uniqueSkuId_(seenIds, standardBase, sheet.getName()),
        category: catTrimmed,
        productName: nameTrimmed,
        grammageG: Number(grammage),
        mrpInr: Number(mrp),
        shelfLifeDays: Number(shelfLife),
        currentStock: readOperationalCell_(cols.stockCol, r, 'stock', 0),
        active: readOperationalCell_(cols.activeCol, r, 'active', true),
        tier: readOperationalCell_(cols.tierCol, r, 'tier', 'yellow'),
        fields: {
          stock: { index: cols.stockCol, header: OPERATIONAL_HEADERS.standard.stock },
          active: { index: cols.activeCol, header: OPERATIONAL_HEADERS.standard.active },
          tier: { index: cols.tierCol, header: OPERATIONAL_HEADERS.standard.tier },
        },
      });

      if (cols.largerGramCol !== -1 && cols.largerMrpCol !== -1) {
        const largerGrammage = readNumericCell_(r[cols.largerGramCol]);
        const largerMrp = readNumericCell_(r[cols.largerMrpCol]);
        if (largerGrammage !== null && largerMrp !== null) {
          const largerBase = slugify_(catTrimmed + '-' + nameTrimmed + '-larger-pack');
          rows.push({
            sheet: sheet,
            __row: rowNumber,
            skuId: uniqueSkuId_(seenIds, largerBase, sheet.getName()),
            category: catTrimmed,
            productName: nameTrimmed,
            grammageG: largerGrammage,
            mrpInr: largerMrp,
            shelfLifeDays: Number(shelfLife),
            currentStock: readOperationalCell_(cols.largerStockCol, r, 'stock', 0),
            active: readOperationalCell_(cols.largerActiveCol, r, 'active', true),
            tier: readOperationalCell_(cols.largerTierCol, r, 'tier', 'yellow'),
            fields: {
              stock: { index: cols.largerStockCol, header: OPERATIONAL_HEADERS.largerPack.stock },
              active: { index: cols.largerActiveCol, header: OPERATIONAL_HEADERS.largerPack.active },
              tier: { index: cols.largerTierCol, header: OPERATIONAL_HEADERS.largerPack.tier },
            },
          });
        }
      }
    }
  });

  return { rows: rows };
}

// ── Reads (rows come back already shaped for the app) ───────────────────

function getInventory_() {
  return readRatecardRows_().rows.map(r => ({
    skuId: r.skuId,
    category: r.category,
    productName: r.productName,
    grammageG: r.grammageG,
    mrpInr: r.mrpInr,
    shelfLifeDays: r.shelfLifeDays,
    currentStock: r.currentStock,
    active: r.active,
    tier: r.tier,
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

function getProductRequests_(accountId) {
  return readTab_(TAB_PRODUCT_REQUESTS)
    .filter(r => !accountId || String(r.account_id) === accountId)
    .map(r => ({
      requestId: String(r.request_id),
      accountId: String(r.account_id),
      skuId: String(r.sku_id),
      qty: Number(r.qty),
      note: r.note ? String(r.note) : null,
      status: String(r.status),
      createdAt: isoOrNull_(r.created_at) || new Date().toISOString(),
      decidedAt: isoOrNull_(r.decided_at),
      decidedBy: r.decided_by ? String(r.decided_by) : null,
      holdUntil: isoOrNull_(r.hold_until),
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

function setInventoryField_(skuId, field, value) {
  const key = field === 'current_stock' ? 'stock' : field; // 'active' | 'tier' already match
  if (['stock', 'active', 'tier'].indexOf(key) === -1) throw new Error('Unknown column ' + field);

  const { rows } = readRatecardRows_();
  const row = rows.filter(r => r.skuId === skuId)[0];
  if (!row) throw new Error('Unknown SKU ' + skuId);

  const colIndex = resolveRatecardColumn_(row.sheet, row.fields[key]);
  row.sheet.getRange(row.__row, colIndex).setValue(value);
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

  const { rows } = readRatecardRows_();
  const bySku = {};
  rows.forEach(r => { bySku[r.skuId] = r; });

  wanted.forEach(li => {
    const row = bySku[li.skuId];
    if (!row) throw new Error('Unknown SKU ' + li.skuId);
    if (Number(li.qty) > row.currentStock) {
      throw new Error('Only ' + row.currentStock + ' available for ' + row.productName);
    }
  });

  const requestId = newId_('req');
  const createdAt = new Date().toISOString();

  wanted.forEach(li => {
    const row = bySku[li.skuId];
    const colIndex = resolveRatecardColumn_(row.sheet, row.fields.stock);
    row.sheet.getRange(row.__row, colIndex).setValue(row.currentStock - Number(li.qty));
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
    unit_mrp_snapshot: Number(bySku[li.skuId].mrpInr),
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
 * A committed-but-not-yet-pushed order is just a reservation - cancelling it
 * undoes that reservation completely rather than leaving a declined-looking
 * record behind, since Ops never saw it in the first place.
 */
function cancelOrder_(requestId) {
  const orderRow = readTab_(TAB_ORDERS).filter(r => String(r.request_id) === requestId)[0];
  if (!orderRow) throw new Error('Unknown request ' + requestId);
  if (String(orderRow.status) !== 'committed') throw new Error('Only a committed order can be cancelled');

  const lines = readTab_(TAB_ORDER_LINES).filter(li => String(li.request_id) === requestId);
  const { rows } = readRatecardRows_();
  const bySku = {};
  rows.forEach(r => { bySku[r.skuId] = r; });
  releaseStock_(lines, bySku);

  // Highest row number first so deleting one line doesn't shift the next one out from under us.
  const orderLinesSheet = sheet_(TAB_ORDER_LINES);
  lines.map(li => li.__row).sort((a, b) => b - a).forEach(rowNum => orderLinesSheet.deleteRow(rowNum));
  sheet_(TAB_ORDERS).deleteRow(orderRow.__row);
}

/** Puts every reserved unit in `lines` back onto its ratecard row. */
function releaseStock_(lines, bySku) {
  lines.forEach(li => {
    const row = bySku[String(li.sku_id)];
    if (!row) return;
    const colIndex = resolveRatecardColumn_(row.sheet, row.fields.stock);
    row.sheet.getRange(row.__row, colIndex).setValue(row.currentStock + Number(li.qty));
  });
}

/**
 * Approve keeps the stock deducted and writes the fulfillment rows.
 * Decline puts every reserved unit back. No partial approval.
 */
function decideRequest_(requestId, decidedBy, approve, decisionNote) {
  const orderRow = readTab_(TAB_ORDERS).filter(r => String(r.request_id) === requestId)[0];
  if (!orderRow) throw new Error('Unknown request ' + requestId);

  const lines = readTab_(TAB_ORDER_LINES).filter(li => String(li.request_id) === requestId);
  const { rows } = readRatecardRows_();
  const bySku = {};
  rows.forEach(r => { bySku[r.skuId] = r; });

  if (!approve) releaseStock_(lines, bySku);

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
        product_name: item.productName || li.sku_id,
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

/** B2B asking for more of a SKU than's currently available - doesn't touch stock at all. */
function requestProduct_(accountId, skuId, qty, note) {
  if (!(Number(qty) > 0)) throw new Error('Quantity must be greater than 0');
  const item = readRatecardRows_().rows.filter(r => r.skuId === skuId)[0];
  if (!item) throw new Error('Unknown SKU ' + skuId);

  const requestId = newId_('preq');
  appendRows_(TAB_PRODUCT_REQUESTS, [{
    request_id: requestId,
    account_id: accountId,
    sku_id: skuId,
    qty: Number(qty),
    note: note || '',
    status: 'pending',
    created_at: new Date().toISOString(),
    decided_at: '',
    decided_by: '',
    hold_until: '',
  }]);

  return getProductRequests_(null).filter(r => r.requestId === requestId)[0];
}

/**
 * Decides every still-pending ProductRequest for one SKU at once - this is
 * what makes multiple accounts' requests for the same product "add up":
 * Ops only ever sees and acts on one aggregated line per SKU.
 */
function decideProductRequests_(skuId, decidedBy, status, holdUntil) {
  if (['accepted', 'declined', 'on_hold'].indexOf(status) === -1) throw new Error('Unknown status ' + status);

  const decidedAt = new Date().toISOString();
  const rows = readTab_(TAB_PRODUCT_REQUESTS).filter(r => String(r.sku_id) === skuId && String(r.status) === 'pending');
  rows.forEach(row => {
    writeCell_(TAB_PRODUCT_REQUESTS, row.__row, 'status', status);
    writeCell_(TAB_PRODUCT_REQUESTS, row.__row, 'decided_at', decidedAt);
    writeCell_(TAB_PRODUCT_REQUESTS, row.__row, 'decided_by', decidedBy || '');
    writeCell_(TAB_PRODUCT_REQUESTS, row.__row, 'hold_until', status === 'on_hold' ? (holdUntil || '') : '');
  });

  const decidedIds = rows.map(r => String(r.request_id));
  return getProductRequests_(null).filter(r => decidedIds.indexOf(r.requestId) !== -1);
}

// ── One-time setup ──────────────────────────────────────────────────────

/** Creates any missing operational tabs and writes their headers. Never touches the ratecard tab. */
function setupSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(COLUMNS).forEach(name => {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const headers = COLUMNS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  if (sheet_(TAB_ACCOUNTS).getLastRow() < 2) {
    appendRows_(TAB_ACCOUNTS, [
      { account_id: 'acct-blue-orchard', company_name: 'Blue Orchard Mart', contact_name: 'Rahul Mehta', contact_email: 'rahul@blueorchardmart.example', contact_phone: '+91 98200 11223' },
      { account_id: 'acct-corner-cafe', company_name: 'Corner Cafe Collective', contact_name: 'Ayesha Khan', contact_email: 'ayesha@cornercafe.example', contact_phone: '+91 98100 44556' },
    ]);
  }

  try {
    const ratecards = findRatecardSheets_();
    Logger.log('Using as Inventory: ' + ratecards.map(s => s.getName()).join(', '));
  } catch (err) {
    Logger.log('Warning: ' + err.message + ' getInventory will fail until one exists.');
  }
}
