import { sheetsApi } from "./googleAuth.js";

/** Wraps a sheet name for use in an A1 range - handles spaces and quotes in the title. */
function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

/** A generous fixed range so we never have to know a sheet's exact size up front - trailing blank rows/cols are dropped by the API automatically. */
function wholeSheetRange(name) {
  return `${quoteSheetName(name)}!A1:ZZ5000`;
}

/** Every tab's metadata (title + numeric sheetId, needed for structural edits like deleteDimension) - one call per spreadsheet. */
export async function listSheets(spreadsheetId) {
  const res = await sheetsApi().spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  return (res.data.sheets || []).map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title }));
}

/**
 * Reads every listed tab's full contents in ONE HTTP request via batchGet -
 * this is the thing Apps Script's SpreadsheetApp can't do (each of its calls
 * is its own round trip). Returns { [title]: string[][] }, missing/empty
 * tabs mapped to [].
 */
export async function readTabs(spreadsheetId, titles) {
  if (titles.length === 0) return {};
  const res = await sheetsApi().spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: titles.map(wholeSheetRange),
  });
  const out = {};
  (res.data.valueRanges || []).forEach((vr, i) => {
    out[titles[i]] = vr.values || [];
  });
  return out;
}

/** Reads one tab's full contents - prefer readTabs() when reading more than one tab in the same request. */
export async function readTab(spreadsheetId, title) {
  const res = await sheetsApi().spreadsheets.values.get({ spreadsheetId, range: wholeSheetRange(title) });
  return res.data.values || [];
}

export async function readRange(spreadsheetId, title, a1) {
  const res = await sheetsApi().spreadsheets.values.get({ spreadsheetId, range: `${quoteSheetName(title)}!${a1}` });
  return res.data.values || [];
}

export async function writeRange(spreadsheetId, title, a1, values) {
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(title)}!${a1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

export async function writeCell(spreadsheetId, title, row1Based, col1Based, value) {
  const a1 = `${colLetter(col1Based)}${row1Based}`;
  await writeRange(spreadsheetId, title, a1, [[value]]);
}

export async function appendRows(spreadsheetId, title, rows) {
  if (rows.length === 0) return;
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId,
    range: wholeSheetRange(title),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

/** Creates a tab with a bold, frozen header row - mirrors what setupSheets()/sheet_() did in Apps Script. */
export async function createSheetWithHeader(spreadsheetId, title, headers) {
  const addRes = await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const sheetId = addRes.data.replies[0].addSheet.properties.sheetId;
  await writeRange(spreadsheetId, title, `A1:${colLetter(headers.length)}1`, [headers]);
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
      ],
    },
  });
  return sheetId;
}

/** Adds one bold header cell at the end of a tab's existing columns - mirrors getOrCreateRatecardColumn_'s column creation. */
export async function appendHeaderColumn(spreadsheetId, title, sheetId, colIndex1Based, headerName) {
  await writeRange(spreadsheetId, title, `${colLetter(colIndex1Based)}1`, [[headerName]]);
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: colIndex1Based - 1, endColumnIndex: colIndex1Based },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
      ],
    },
  });
}

/** Deletes one row (1-based, as seen in the sheet) - used for cancelling a committed order. */
export async function deleteRow(spreadsheetId, sheetId, row1Based) {
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: row1Based - 1, endIndex: row1Based } } },
      ],
    },
  });
}

export function colLetter(col1Based) {
  let n = col1Based;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
