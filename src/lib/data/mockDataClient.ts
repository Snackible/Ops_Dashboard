import catalogSeed from "../../data/catalog.json";
import { eventBus } from "../events";
import type { B2BAccount, InventoryItem, StockRequest } from "../types";
import type { DataClient, LineItemDecision } from "./dataClient";

const STORAGE_KEY = "snackible-ops-mock-db-v1";

interface DB {
  inventory: InventoryItem[];
  accounts: B2BAccount[];
  requests: StockRequest[];
}

const seedAccounts: B2BAccount[] = [
  {
    accountId: "acct-blue-orchard",
    companyName: "Blue Orchard Mart",
    contactName: "Rahul Mehta",
    contactEmail: "rahul@blueorchardmart.example",
    contactPhone: "+91 98200 11223",
    pricingTierId: null,
  },
  {
    accountId: "acct-corner-cafe",
    companyName: "Corner Cafe Collective",
    contactName: "Ayesha Khan",
    contactEmail: "ayesha@cornercafe.example",
    contactPhone: "+91 98100 44556",
    pricingTierId: null,
  },
];

function seedDB(): DB {
  const inventory: InventoryItem[] = (catalogSeed as Omit<
    InventoryItem,
    "currentStock" | "reorderThreshold" | "active"
  >[]).map((item) => ({
    ...item,
    currentStock: 0,
    reorderThreshold: null,
    active: true,
  }));
  return { inventory, accounts: seedAccounts, requests: [] };
}

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    // fall through to reseed
  }
  const fresh = seedDB();
  saveDB(fresh);
  return fresh;
}

function saveDB(db: DB): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // localStorage unavailable (private mode, quota) — state just won't persist
  }
}

let db = loadDB();

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function tick<T>(value: T): Promise<T> {
  // Keeps the UI honest about this being async I/O, so swapping in a real
  // network-backed client later doesn't change any calling code's shape.
  return new Promise((resolve) => setTimeout(() => resolve(value), 120));
}

export const mockDataClient: DataClient = {
  async getInventory() {
    return tick([...db.inventory]);
  },

  async updateStock(skuId, currentStock) {
    const item = db.inventory.find((i) => i.skuId === skuId);
    if (!item) throw new Error(`Unknown SKU ${skuId}`);
    item.currentStock = currentStock;
    saveDB(db);
    eventBus.emit("InventoryUpdated", { item });
    return tick(item);
  },

  async setReorderThreshold(skuId, threshold) {
    const item = db.inventory.find((i) => i.skuId === skuId);
    if (!item) throw new Error(`Unknown SKU ${skuId}`);
    item.reorderThreshold = threshold;
    saveDB(db);
    eventBus.emit("InventoryUpdated", { item });
    return tick(item);
  },

  async setActive(skuId, active) {
    const item = db.inventory.find((i) => i.skuId === skuId);
    if (!item) throw new Error(`Unknown SKU ${skuId}`);
    item.active = active;
    saveDB(db);
    eventBus.emit("InventoryUpdated", { item });
    return tick(item);
  },

  async getAccounts() {
    return tick([...db.accounts]);
  },

  async getAccount(accountId) {
    return tick(db.accounts.find((a) => a.accountId === accountId));
  },

  async submitRequest(accountId, lineItems) {
    const request: StockRequest = {
      requestId: id("req"),
      accountId,
      status: "pending",
      submittedAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
      lineItems: lineItems.map((li) => {
        const catalogItem = db.inventory.find((i) => i.skuId === li.skuId);
        return {
          lineItemId: id("line"),
          skuId: li.skuId,
          qtyRequested: li.qtyRequested,
          qtyFulfilled: null,
          unitMrpSnapshot: catalogItem?.mrpInr ?? 0,
        };
      }),
    };
    db.requests.unshift(request);
    saveDB(db);
    eventBus.emit("RequestSubmitted", { request });
    return tick(request);
  },

  async getRequests() {
    return tick([...db.requests]);
  },

  async getRequestsForAccount(accountId) {
    return tick(db.requests.filter((r) => r.accountId === accountId));
  },

  async decideRequest(requestId, decidedBy, lineItemDecisions, decisionNote) {
    const request = db.requests.find((r) => r.requestId === requestId);
    if (!request) throw new Error(`Unknown request ${requestId}`);

    const byLineItem = new Map(
      lineItemDecisions.map((d) => [d.lineItemId, d.qtyFulfilled])
    );
    request.lineItems = request.lineItems.map((li) => ({
      ...li,
      qtyFulfilled: byLineItem.get(li.lineItemId) ?? 0,
    }));

    const allFull = request.lineItems.every(
      (li) => li.qtyFulfilled === li.qtyRequested
    );
    const allZero = request.lineItems.every((li) => li.qtyFulfilled === 0);

    request.status = allZero ? "declined" : allFull ? "approved_full" : "approved_partial";
    request.decidedAt = new Date().toISOString();
    request.decidedBy = decidedBy;
    request.decisionNote = decisionNote;

    saveDB(db);

    if (request.status === "declined") {
      eventBus.emit("RequestDeclined", { request });
    } else {
      eventBus.emit("RequestApproved", { request });
    }

    return tick(request);
  },
};
