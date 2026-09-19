import type { FulfillmentLogRow } from "../types";

const STORAGE_KEY = "snackible-ops-fulfillment-sheet-mock-v2";

/**
 * Stands in for the fulfillment tab of the real spreadsheet while the app
 * runs on the localStorage mock. With the Sheets backend configured, none of
 * this runs - Apps Script appends the rows itself as part of the approval.
 */
export function readMockFulfillmentSheet(): FulfillmentLogRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FulfillmentLogRow[]) : [];
  } catch {
    return [];
  }
}

export function appendMockFulfillmentSheet(rows: FulfillmentLogRow[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readMockFulfillmentSheet(), ...rows]));
  } catch {
    // localStorage unavailable - the log just won't persist in mock mode
  }
}
