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
  // Untyped internally (Set<Handler<any>>) — every external caller goes
  // through the generic `on`/`emit` below, which is where the real type
  // safety lives. TS can't verify a single map's value type varies per key
  // the way DomainEvents does, so the internal storage stays loose on purpose.
  private handlers = new Map<EventName, Set<Handler<any>>>();

  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<E extends EventName>(event: E, payload: DomainEvents[E]): void {
    const set = this.handlers.get(event) as Set<Handler<E>> | undefined;
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
