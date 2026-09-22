import catalogSeed from "../../data/catalog.json";
import { eventBus } from "../events";
import { readMockFulfillmentSheet } from "../integrations/mockFulfillmentSheet";
import type { AuthUser, B2BAccount, InventoryItem, ProductRequest, ProductRequestStatus, StockRequest, Tier } from "../types";
import type { DataClient } from "./dataClient";

/**
 * Local stand-in for the "Users" sheet tab (see managedSheets.js on the real
 * backend) - same shape, same idea: username + 4-digit code -> role (+
 * account for b2b). Add a row here to add a mock login; it never persists to
 * localStorage since credentials aren't something local testing should reset
 * independently of a code change.
 */
const mockUsers: { username: string; password: string; role: "ops" | "b2b"; accountId?: string }[] = [
  { username: "Priya", password: "4821", role: "ops" },
  { username: "Karan", password: "7093", role: "ops" },
  { username: "Rahul", password: "1620", role: "b2b", accountId: "acct-blue-orchard" },
  { username: "Ayesha", password: "3357", role: "b2b", accountId: "acct-corner-cafe" },
  { username: "Meera", password: "9042", role: "b2b", accountId: "acct-blue-orchard" },
];

const STORAGE_KEY = "snackible-ops-mock-db-v4";

interface DB {
  inventory: InventoryItem[];
  accounts: B2BAccount[];
  requests: StockRequest[];
  productRequests: ProductRequest[];
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
  return { inventory, accounts: seedAccounts, requests: [], productRequests: [] };
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
  async login(username, password) {
    const match = mockUsers.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password
    );
    if (!match) throw new Error("Invalid username or password");
    const user: AuthUser = { id: `user-${match.username.toLowerCase()}`, name: match.username, role: match.role, accountId: match.accountId };
    return tick(user);
  },

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

  async updateInventoryFields(updates) {
    const touched = new Map<string, InventoryItem>();
    for (const u of updates) {
      const item = findInventory(u.skuId);
      if (u.field === "stock") item.currentStock = u.value as number;
      if (u.field === "active") item.active = u.value as boolean;
      if (u.field === "tier") item.tier = u.value as Tier;
      touched.set(u.skuId, item);
    }
    saveDB(db);
    for (const item of touched.values()) eventBus.emit("InventoryUpdated", { item });
    return tick(Array.from(touched.values()));
  },

  async getAccounts() {
    return tick([...db.accounts]);
  },

  async getAccount(accountId) {
    return tick(db.accounts.find((a) => a.accountId === accountId));
  },

  async commitOrder(accountId, lineItems, requestedByName) {
    const wanted = lineItems.filter((li) => li.qty > 0);
    if (wanted.length === 0) throw new Error("Add at least one item before committing");

    // Validate every line first — an order either commits whole or not at
    // all. Only qty - backorderQty is ever reserved from stock; the rest is
    // the shortfall a linked ProductRequest tracks (see below).
    for (const li of wanted) {
      const item = findInventory(li.skuId);
      const reserveQty = li.qty - (li.backorderQty || 0);
      if (reserveQty > item.currentStock) {
        throw new Error(`Only ${item.currentStock} available for ${item.productName}`);
      }
    }

    const requestId = id("req");
    const createdAt = new Date().toISOString();

    const request: StockRequest = {
      requestId,
      accountId,
      status: "committed",
      createdAt,
      submittedAt: null,
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
      requestedByName: requestedByName || null,
      lineItems: wanted.map((li) => {
        const item = findInventory(li.skuId);
        const backorderQty = li.backorderQty || 0;
        const reserveQty = li.qty - backorderQty;
        item.currentStock -= reserveQty;
        eventBus.emit("InventoryUpdated", { item });
        return { lineItemId: id("line"), skuId: li.skuId, qty: li.qty, unitMrpSnapshot: item.mrpInr, backorderQty };
      }),
    };
    db.requests.unshift(request);

    for (const li of wanted) {
      if (!li.backorderQty) continue;
      const productRequest: ProductRequest = {
        requestId: id("preq"),
        accountId,
        skuId: li.skuId,
        qty: li.backorderQty,
        note: null,
        status: "pending",
        createdAt,
        decidedAt: null,
        decidedBy: null,
        holdUntil: null,
        linkedRequestId: requestId,
      };
      db.productRequests.unshift(productRequest);
      eventBus.emit("ProductRequestSubmitted", { request: productRequest });
    }

    saveDB(db);
    return tick(request);
  },

  async getCommittedOrders(accountId) {
    return tick(db.requests.filter((r) => r.accountId === accountId && r.status === "committed"));
  },

  async pushOrder(requestId) {
    const request = db.requests.find((r) => r.requestId === requestId);
    if (!request) throw new Error(`Unknown request ${requestId}`);
    if (request.status !== "committed") throw new Error("Only a committed order can be pushed");

    request.status = "pending";
    request.submittedAt = new Date().toISOString();
    saveDB(db);
    eventBus.emit("RequestSubmitted", { request });
    return tick(request);
  },

  async cancelOrder(requestId) {
    const request = db.requests.find((r) => r.requestId === requestId);
    if (!request) throw new Error(`Unknown request ${requestId}`);
    if (request.status !== "committed") throw new Error("Only a committed order can be cancelled");

    for (const li of request.lineItems) {
      const item = db.inventory.find((i) => i.skuId === li.skuId);
      if (item) {
        item.currentStock += li.qty - li.backorderQty;
        eventBus.emit("InventoryUpdated", { item });
      }
    }

    db.requests = db.requests.filter((r) => r.requestId !== requestId);
    saveDB(db);
    await tick(undefined);
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
          item.currentStock += li.qty - li.backorderQty;
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

  async getFulfillmentLog() {
    return tick(readMockFulfillmentSheet());
  },

  async requestProduct(accountId, skuId, qty, note) {
    findInventory(skuId); // throws if the SKU doesn't exist
    const request: ProductRequest = {
      requestId: id("preq"),
      accountId,
      skuId,
      qty,
      note,
      status: "pending",
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      holdUntil: null,
      linkedRequestId: null,
    };
    db.productRequests.unshift(request);
    saveDB(db);
    eventBus.emit("ProductRequestSubmitted", { request });
    return tick(request);
  },

  async getProductRequests() {
    return tick([...db.productRequests]);
  },

  async getProductRequestsForAccount(accountId) {
    return tick(db.productRequests.filter((r) => r.accountId === accountId));
  },

  async decideProductRequests(skuId, decidedBy, status, holdUntil) {
    const decidedAt = new Date().toISOString();
    const decided: ProductRequest[] = [];
    for (const r of db.productRequests) {
      if (r.skuId === skuId && r.status === "pending") {
        r.status = status as ProductRequestStatus;
        r.decidedAt = decidedAt;
        r.decidedBy = decidedBy;
        r.holdUntil = status === "on_hold" ? holdUntil : null;
        decided.push(r);
      }
    }
    saveDB(db);
    for (const r of decided) eventBus.emit("ProductRequestDecided", { request: r });
    return tick(decided);
  },
};
