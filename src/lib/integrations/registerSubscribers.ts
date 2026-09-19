import { registerOpsPopupSound } from "./opsPopupSound";
import { registerB2BPopup } from "./b2bPopup";
import { registerFulfillmentSheetLog } from "./fulfillmentSheetLog";
import { isSheetsConfigured } from "../data/sheetsClient";

let registered = false;

/**
 * Every current integration attaches here, and only here. Adding a future
 * one (email/SMS, an ERP export) means writing a new `registerX()` module
 * and calling it in this list — never touching the request/inventory logic
 * that emits the events these subscribers listen for.
 */
export function registerAllSubscribers(): void {
  if (registered) return;
  registered = true;
  registerOpsPopupSound();
  registerB2BPopup();

  // On the Sheets backend the fulfillment rows are written server-side,
  // inside the same approval that flips the status. Registering the mock
  // writer too would double-log every approval.
  if (!isSheetsConfigured) registerFulfillmentSheetLog();
}
