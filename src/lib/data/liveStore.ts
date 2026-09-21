import { useSyncExternalStore } from "react";
import { dataClient } from "./index";
import type { B2BAccount, FulfillmentLogRow, InventoryItem, ProductRequest, StockRequest } from "../types";

/**
 * Ops-wide shared data: accounts, inventory, all requests, all product
 * requests. Every page that needs any of this (Queue, Product Requests,
 * Inventory, and New Order for inventory alone - it's public catalog data)
 * reads from here instead of fetching its own copy on mount, so navigating
 * between them never fires a new network call on its own. The only writers
 * are: the background poller (sheetsPolling.ts, for requests/product
 * requests), a manual refresh button, and a mutation's own success handler
 * refreshing the slice it just changed.
 */
interface LiveState {
  accounts: B2BAccount[];
  inventory: InventoryItem[];
  requests: StockRequest[];
  productRequests: ProductRequest[];
  fulfillmentLog: FulfillmentLogRow[];
  accountsReady: boolean;
  inventoryReady: boolean;
  requestsReady: boolean;
  productRequestsReady: boolean;
  fulfillmentLogReady: boolean;
}

type Listener = () => void;

let state: LiveState = {
  accounts: [],
  inventory: [],
  requests: [],
  productRequests: [],
  fulfillmentLog: [],
  accountsReady: false,
  inventoryReady: false,
  requestsReady: false,
  productRequestsReady: false,
  fulfillmentLogReady: false,
};
const listeners = new Set<Listener>();

function setState(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LiveState {
  return state;
}

export const liveStore = {
  async refreshAccounts(): Promise<void> {
    const accounts = await dataClient.getAccounts();
    setState({ accounts, accountsReady: true });
  },
  async refreshInventory(): Promise<void> {
    const inventory = await dataClient.getInventory();
    setState({ inventory, inventoryReady: true });
  },
  async refreshRequests(): Promise<void> {
    const requests = await dataClient.getRequests();
    setState({ requests, requestsReady: true });
  },
  async refreshProductRequests(): Promise<void> {
    const productRequests = await dataClient.getProductRequests();
    setState({ productRequests, productRequestsReady: true });
  },
  /** History is rarely visited, so this is fetched lazily on first visit (see HistoryPage) rather than at boot with everything else. */
  async refreshFulfillmentLog(): Promise<void> {
    const fulfillmentLog = await dataClient.getFulfillmentLog();
    setState({ fulfillmentLog, fulfillmentLogReady: true });
  },
  async refreshAll(): Promise<void> {
    await Promise.all([
      liveStore.refreshAccounts(),
      liveStore.refreshInventory(),
      liveStore.refreshRequests(),
      liveStore.refreshProductRequests(),
    ]);
  },
  /** Lets the poller push data it already fetched in without a second read. */
  setRequests(requests: StockRequest[]): void {
    setState({ requests, requestsReady: true });
  },
  setProductRequests(productRequests: ProductRequest[]): void {
    setState({ productRequests, productRequestsReady: true });
  },
  /** For call sites outside a component (e.g. a page refreshing another page's already-loaded slice after a mutation). */
  getState(): LiveState {
    return state;
  },
};

export function useLiveStore(): LiveState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
