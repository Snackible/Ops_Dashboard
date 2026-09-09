import type { StockRequest, InventoryItem } from "./types";

/**
 * The names below are the only contract between core domain logic and every
 * integration (popups, sound, the sheet export, and anything added later).
 * Core code should only ever call `emit` — never a specific subscriber
 * directly — so a new integration is a new `on(...)` call, not an edit here
 * or in the request/inventory logic that triggers these events.
 */
export interface DomainEvents {
  RequestSubmitted: { request: StockRequest };
  RequestApproved: { request: StockRequest };
  RequestDeclined: { request: StockRequest };
  InventoryUpdated: { item: InventoryItem };
}

type EventName = keyof DomainEvents;
type Handler<E extends EventName> = (payload: DomainEvents[E]) => void;

class EventBus {
  private handlers: { [K in EventName]?: Set<Handler<K>> } = {};

  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    const set = (this.handlers[event] ??= new Set()) as Set<Handler<E>>;
    set.add(handler);
    return () => set.delete(handler);
  }

  emit<E extends EventName>(event: E, payload: DomainEvents[E]): void {
    const set = this.handlers[event] as Set<Handler<E>> | undefined;
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // A broken subscriber (e.g. the sheet export failing) must never
        // take down the approval flow that triggered it.
        console.error(`[event-bus] subscriber to "${event}" threw`, err);
      }
    }
  }
}

export const eventBus = new EventBus();
