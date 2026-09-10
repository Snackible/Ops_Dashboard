import catalogSeed from "../../data/catalog.json";
import { eventBus } from "../events";
import type { B2BAccount, InventoryItem, StockRequest, Tier } from "../types";
import type { DataClient } from "./dataClient";

const STORAGE_KEY = "snackible-ops-mock-db-v2";

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
    "currentStock" | "active" | "tier"
  >[]).map((item) => ({
    ...item,
    currentStock: 0,
    active: true,
    tier: "yellow" as Tier,
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

function findInventory(skuId: string): InventoryItem {
  const item = db.inventory.find((i) => i.skuId === skuId);
  if (!item) throw new Error(`Unknown SKU ${skuId}`);
  return item;
}

export const mockDataClient: DataClient = {
  async getInventory() {
    return tick([...db.inventory]);
  },

  async updateStock(skuId, currentStock) {
    const item = findInventory(skuId);
    item.currentStock = currentStock;
    saveDB(db);
    eventBus.emit("InventoryUpdated", { item });
    return tick(item);
  },

  async setActive(skuId, active) {
    const item = findInventory(skuId);
    item.active = active;
    saveDB(db);
    eventBus.emit("InventoryUpdated", { item });
    return tick(item);
  },

  async setTier(skuId, tier) {
    const item = findInventory(skuId);
    item.tier = tier;
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

  async getDraftOrder(accountId) {
    const draft = db.requests.find((r) => r.accountId === accountId && r.status === "draft");
    return tick(draft ?? null);
  },

  async commitItem(accountId, skuId, qty) {
    const clampedQty = Math.max(0, Math.floor(qty));
    let draft = db.requests.find((r) => r.accountId === accountId && r.status === "draft");
    if (!draft) {
      draft = {
        requestId: id("req"),
        accountId,
        status: "draft",
        createdAt: new Date().toISOString(),
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
        lineItems: [],
      };
      db.requests.unshift(draft);
    }

    const item = findInventory(skuId);
    const existing = draft.lineItems.find((li) => li.skuId === skuId);
    const previousQty = existing?.qty ?? 0;
    const delta = clampedQty - previousQty;

    if (delta > 0 && delta > item.currentStock) {
      throw new Error(`Only ${item.currentStock} available for ${item.productName}`);
    }

    item.currentStock -= delta;

    if (clampedQty === 0) {
      draft.lineItems = draft.lineItems.filter((li) => li.skuId !== skuId);
    } else if (existing) {
      existing.qty = clampedQty;
    } else {
      draft.lineItems.push({
        lineItemId: id("line"),
        skuId,
        qty: clampedQty,
        unitMrpSnapshot: item.mrpInr,
      });
    }

    saveDB(db);
    eventBus.emit("InventoryUpdated", { item });
    return tick(draft);
  },

  async pushOrder(accountId) {
    const draft = db.requests.find((r) => r.accountId === accountId && r.status === "draft");
    if (!draft) throw new Error("No draft order to push");
    if (draft.lineItems.length === 0) throw new Error("Add at least one item before pushing");

    draft.status = "pending";
    draft.submittedAt = new Date().toISOString();
    saveDB(db);
    eventBus.emit("RequestSubmitted", { request: draft });
    return tick(draft);
  },

  async getRequests() {
    return tick([...db.requests]);
  },

  async getRequestsForAccount(accountId) {
    return tick(db.requests.filter((r) => r.accountId === accountId));
  },

  async decideRequest(requestId, decidedBy, approve, decisionNote) {
    const request = db.requests.find((r) => r.requestId === requestId);
    if (!request) throw new Error(`Unknown request ${requestId}`);

    if (!approve) {
      for (const li of request.lineItems) {
        const item = db.inventory.find((i) => i.skuId === li.skuId);
        if (item) {
          item.currentStock += li.qty;
          eventBus.emit("InventoryUpdated", { item });
        }
      }
    }

    request.status = approve ? "approved" : "declined";
    request.decidedAt = new Date().toISOString();
    request.decidedBy = decidedBy;
    request.decisionNote = decisionNote;

    saveDB(db);

    eventBus.emit(approve ? "RequestApproved" : "RequestDeclined", { request });

    return tick(request);
  },
};
