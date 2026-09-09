import { registerOpsPopupSound } from "./opsPopupSound";
import { registerB2BPopup } from "./b2bPopup";
import { registerFulfillmentSheetLog } from "./fulfillmentSheetLog";

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
  registerFulfillmentSheetLog();
}
