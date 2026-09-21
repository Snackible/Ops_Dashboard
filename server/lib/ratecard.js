import { listSheets, readTabs, writeRange, colLetter } from "./sheetsClient.js";

const OPERATIONAL_HEADERS = {
  standard: { stock: "Current Stock", active: "Active", tier: "Tier" },
  largerPack: { stock: "Larger Pack Current Stock", active: "Larger Pack Active", tier: "Larger Pack Tier" },
};

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findHeaderCol(header, matcher) {
  for (let i = 0; i < header.length; i++) if (matcher(header[i])) return i;
  return -1;
}

/** Same column-by-name matching as the Apps Script version - takes an already-fetched header row, no API call of its own. */
function ratecardColumns(headerRow) {
  const header = headerRow.map((h) => String(h).trim().toLowerCase());
  const isLarger = (h) => h.indexOf("larger") !== -1;
  return {
    catCol: findHeaderCol(header, (h) => h === "category"),
    nameCol: findHeaderCol(header, (h) => h.indexOf("product") !== -1),
    gramCol: findHeaderCol(header, (h) => h.indexOf("grammage") !== -1 && !isLarger(h)),
    mrpCol: findHeaderCol(header, (h) => h.indexOf("mrp") !== -1 && !isLarger(h)),
    shelfCol: findHeaderCol(header, (h) => h.indexOf("shelf") !== -1),
    stockCol: findHeaderCol(header, (h) => !isLarger(h) && (h.indexOf("current stock") !== -1 || h === "inventory" || h === "stock")),
    activeCol: findHeaderCol(header, (h) => h === "active"),
    tierCol: findHeaderCol(header, (h) => h === "tier"),
    largerGramCol: findHeaderCol(header, (h) => h.indexOf("grammage") !== -1 && isLarger(h)),
    largerMrpCol: findHeaderCol(header, (h) => h.indexOf("mrp") !== -1 && isLarger(h)),
    largerStockCol: findHeaderCol(header, (h) => isLarger(h) && (h.indexOf("current stock") !== -1 || h.indexOf("inventory") !== -1 || h.indexOf("stock") !== -1)),
    largerActiveCol: findHeaderCol(header, (h) => h === "larger pack active"),
    largerTierCol: findHeaderCol(header, (h) => h === "larger pack tier"),
  };
}

function uniqueSkuId(seenIds, base, sheetTitle) {
  let skuId = base;
  if (seenIds[skuId]) {
    skuId = slugify(base + "-" + sheetTitle);
    let suffix = 2;
    while (seenIds[skuId]) skuId = slugify(base + "-" + sheetTitle) + "-" + suffix++;
  }
  seenIds[skuId] = true;
  return skuId;
}

function readNumericCell(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function readOperationalCell(colIndex, r, kind, fallback) {
  if (colIndex === -1) return fallback;
  const val = r[colIndex];
  if (val === "" || val === null || val === undefined) return fallback;
  if (kind === "stock") { const n = Number(val); return isNaN(n) ? fallback : n; }
  if (kind === "active") return val === true || String(val).toUpperCase() === "TRUE";
  return String(val).trim().toLowerCase();
}

/**
 * Reads every real product row off every ratecard tab in one spreadsheet.
 * Two API calls total no matter how many tabs exist: one to list tab
 * titles, one batchGet for all of their contents (vs. one-plus-per-tab in
 * the old Apps Script version).
 *
 * Returns { rows, sheetMeta } - sheetMeta is a Map<title, {sheetId,
 * headerMap, lastCol}> that write helpers use to create a missing
 * Current Stock/Active/Tier column exactly once even when several rows in
 * this same request come from the same tab (see resolveRatecardColumn).
 */
export async function readRatecardRows(spreadsheetId, managedTitles) {
  const allSheets = await listSheets(spreadsheetId);
  const candidateSheets = allSheets.filter((s) => managedTitles.indexOf(s.title) === -1);
  if (candidateSheets.length === 0) throw new Error('No ratecard tab found. Add a tab with "Category" and "Product Name" header columns.');

  const tabValues = await readTabs(spreadsheetId, candidateSheets.map((s) => s.title));

  const matches = candidateSheets
    .map((s) => ({ ...s, values: tabValues[s.title] || [] }))
    .filter((s) => {
      if (s.values.length === 0 || s.values[0].length === 0) return false;
      const header = s.values[0].map((h) => String(h).trim().toLowerCase());
      return header.indexOf("category") !== -1 && header.some((h) => h.indexOf("product") !== -1);
    });
  if (matches.length === 0) throw new Error('No ratecard tab found. Add a tab with "Category" and "Product Name" header columns.');

  const rows = [];
  const seenIds = {};
  const sheetMeta = new Map();

  matches.forEach(({ sheetId, title, values }) => {
    const cols = ratecardColumns(values[0]);
    const missing = ["catCol", "nameCol", "gramCol", "mrpCol", "shelfCol"].filter((k) => cols[k] === -1);
    if (missing.length > 0) throw new Error(`Ratecard tab "${title}" is missing a header column for: ${missing.join(", ")}`);

    const headerMap = new Map();
    values[0].forEach((h, i) => headerMap.set(String(h).trim().toLowerCase(), i + 1));
    sheetMeta.set(title, { sheetId, headerMap, lastCol: values[0].length });

    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const category = r[cols.catCol];
      const productName = r[cols.nameCol];
      const grammage = r[cols.gramCol];
      const mrp = r[cols.mrpCol];
      const shelfLife = r[cols.shelfCol];
      if (!category || !productName) continue;
      if (grammage === "" || grammage === undefined || mrp === "" || mrp === undefined || shelfLife === "" || shelfLife === undefined) continue;
      if (isNaN(Number(grammage)) || isNaN(Number(mrp)) || isNaN(Number(shelfLife))) continue;

      const catTrimmed = String(category).trim();
      const nameTrimmed = String(productName).trim();
      const rowNumber = i + 1;

      const standardBase = slugify(catTrimmed + "-" + nameTrimmed);
      rows.push({
        spreadsheetId, title, row: rowNumber,
        skuId: uniqueSkuId(seenIds, standardBase, title),
        category: catTrimmed, productName: nameTrimmed,
        grammageG: Number(grammage), mrpInr: Number(mrp), shelfLifeDays: Number(shelfLife),
        currentStock: readOperationalCell(cols.stockCol, r, "stock", 0),
        active: readOperationalCell(cols.activeCol, r, "active", true),
        tier: readOperationalCell(cols.tierCol, r, "tier", "yellow"),
        fields: {
          stock: { index: cols.stockCol, header: OPERATIONAL_HEADERS.standard.stock },
          active: { index: cols.activeCol, header: OPERATIONAL_HEADERS.standard.active },
          tier: { index: cols.tierCol, header: OPERATIONAL_HEADERS.standard.tier },
        },
      });

      if (cols.largerGramCol !== -1 && cols.largerMrpCol !== -1) {
        const largerGrammage = readNumericCell(r[cols.largerGramCol]);
        const largerMrp = readNumericCell(r[cols.largerMrpCol]);
        if (largerGrammage !== null && largerMrp !== null) {
          const largerBase = slugify(catTrimmed + "-" + nameTrimmed + "-larger-pack");
          rows.push({
            spreadsheetId, title, row: rowNumber,
            skuId: uniqueSkuId(seenIds, largerBase, title),
            category: catTrimmed, productName: nameTrimmed,
            grammageG: largerGrammage, mrpInr: largerMrp, shelfLifeDays: Number(shelfLife),
            currentStock: readOperationalCell(cols.largerStockCol, r, "stock", 0),
            active: readOperationalCell(cols.largerActiveCol, r, "active", true),
            tier: readOperationalCell(cols.largerTierCol, r, "tier", "yellow"),
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

  return { rows, sheetMeta };
}

/**
 * Resolves a field (stock/active/tier) to a 1-based column to write to.
 * `field.index` is used as-is when the read already found a recognized
 * column (e.g. one named "Inventory"). Otherwise this checks `sheetMeta`
 * (shared across every row from this request) before creating a new
 * column, so two rows from the same tab that both need, say, "Current
 * Stock" created only create it once.
 */
export async function resolveRatecardColumn(sheetMeta, row, field) {
  if (field.index !== -1) return field.index + 1;
  const meta = sheetMeta.get(row.title);
  const key = field.header.toLowerCase();
  if (meta.headerMap.has(key)) return meta.headerMap.get(key);

  const colIndex = meta.lastCol + 1;
  await writeRange(row.spreadsheetId, row.title, `${colLetter(colIndex)}1`, [[field.header]]);
  meta.headerMap.set(key, colIndex);
  meta.lastCol = colIndex;
  return colIndex;
}
