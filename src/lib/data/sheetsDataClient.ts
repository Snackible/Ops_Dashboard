import { callSheets } from "./sheetsClient";
import type { AuthUser, B2BAccount, FulfillmentLogRow, InventoryItem, ProductRequest, StockRequest } from "../types";
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
  login(username, password) {
    return callSheets<AuthUser>("login", { username, password });
  },

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

  updateInventoryFields(updates) {
    return callSheets<InventoryItem[]>("updateInventoryFields", { updates });
  },

  getAccounts() {
    return callSheets<B2BAccount[]>("getAccounts");
  },

  async getAccount(accountId) {
    const accounts = await callSheets<B2BAccount[]>("getAccounts");
    return accounts.find((a) => a.accountId === accountId);
  },

  commitOrder(accountId, lineItems, requestedByName) {
    return callSheets<StockRequest>("commitOrder", { accountId, lineItems, requestedByName });
  },

  getCommittedOrders(accountId) {
    return callSheets<StockRequest[]>("getCommittedOrders", { accountId });
  },

  pushOrder(requestId) {
    return callSheets<StockRequest>("pushOrder", { requestId });
  },

  cancelOrder(requestId) {
    return callSheets<void>("cancelOrder", { requestId });
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

  requestProduct(accountId, skuId, qty, note) {
    return callSheets<ProductRequest>("requestProduct", { accountId, skuId, qty, note });
  },

  getProductRequests() {
    return callSheets<ProductRequest[]>("getProductRequests");
  },

  getProductRequestsForAccount(accountId) {
    return callSheets<ProductRequest[]>("getProductRequestsForAccount", { accountId });
  },

  decideProductRequests(skuId, decidedBy, status, holdUntil) {
    return callSheets<ProductRequest[]>("decideProductRequests", { skuId, decidedBy, status, holdUntil });
  },
};
