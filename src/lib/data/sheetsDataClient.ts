import { callSheets } from "./sheetsClient";
import type { B2BAccount, FulfillmentLogRow, InventoryItem, StockRequest } from "../types";
import type { DataClient } from "./dataClient";

/**
 * Google Sheets backend behind the same DataClient interface the mock
 * implements. All the real work (stock math, atomicity via LockService,
 * appending fulfillment rows) happens in apps-script/Code.gs, which already
 * returns rows in the app's shape - so this file stays a thin transport.
 *
 * Note there are no eventBus.emit calls here. Sheets has no change feed, so
 * domain events come from the poller in sheetsPolling.ts instead, which is
 * also what lets an Ops tab hear about a push made in someone else's browser.
 */
export const sheetsDataClient: DataClient = {
  getInventory() {
    return callSheets<InventoryItem[]>("getInventory");
  },

  updateStock(skuId, currentStock) {
    return callSheets<InventoryItem>("updateStock", { skuId, currentStock });
  },

  setActive(skuId, active) {
    return callSheets<InventoryItem>("setActive", { skuId, active });
  },

  setTier(skuId, tier) {
    return callSheets<InventoryItem>("setTier", { skuId, tier });
  },

  getAccounts() {
    return callSheets<B2BAccount[]>("getAccounts");
  },

  async getAccount(accountId) {
    const accounts = await callSheets<B2BAccount[]>("getAccounts");
    return accounts.find((a) => a.accountId === accountId);
  },

  commitOrder(accountId, lineItems) {
    return callSheets<StockRequest>("commitOrder", { accountId, lineItems });
  },

  getCommittedOrders(accountId) {
    return callSheets<StockRequest[]>("getCommittedOrders", { accountId });
  },

  pushOrder(requestId) {
    return callSheets<StockRequest>("pushOrder", { requestId });
  },

  getRequests() {
    return callSheets<StockRequest[]>("getRequests");
  },

  getRequestsForAccount(accountId) {
    return callSheets<StockRequest[]>("getRequestsForAccount", { accountId });
  },

  decideRequest(requestId, decidedBy, approve, decisionNote) {
    return callSheets<StockRequest>("decideRequest", { requestId, decidedBy, approve, decisionNote });
  },

  getFulfillmentLog() {
    return callSheets<FulfillmentLogRow[]>("getFulfillmentLog");
  },
};
