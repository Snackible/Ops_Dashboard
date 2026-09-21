import { eventBus } from "../events";
import { sheetsDataClient } from "./sheetsDataClient";
import type { RequestStatus } from "../types";

/**
 * Sheets has no change feed, so this poller is what turns "someone else
 * changed a row" into the domain events every subscriber (Ops popup + sound,
 * B2B popup) already listens on. It diffs each poll against the statuses it
 * saw last time and emits only on transitions.
 *
 * The first poll seeds the baseline without emitting, otherwise every
 * already-pending order would fire a "new request" chime on page load.
 */
let started = false;
let timer: number | undefined;

export function startSheetsPolling(intervalMs = 6000): void {
  if (started) return;
  started = true;

  const lastSeen = new Map<string, RequestStatus>();
  const lastSeenProductRequests = new Map<string, string>();
  let seeded = false;

  const poll = async () => {
    try {
      const [requests, productRequests] = await Promise.all([
        sheetsDataClient.getRequests(),
        sheetsDataClient.getProductRequests(),
      ]);

      for (const request of requests) {
        const previous = lastSeen.get(request.requestId);
        lastSeen.set(request.requestId, request.status);
        if (!seeded || previous === request.status) continue;

        if (request.status === "pending") eventBus.emit("RequestSubmitted", { request });
        if (request.status === "approved") eventBus.emit("RequestApproved", { request });
        if (request.status === "declined") eventBus.emit("RequestDeclined", { request });
      }

      for (const request of productRequests) {
        const previous = lastSeenProductRequests.get(request.requestId);
        lastSeenProductRequests.set(request.requestId, request.status);
        if (!seeded || previous === request.status) continue;

        if (request.status === "pending") eventBus.emit("ProductRequestSubmitted", { request });
        else eventBus.emit("ProductRequestDecided", { request });
      }

      seeded = true;
    } catch (err) {
      // A failed poll is not worth surfacing - the next one will catch up.
      console.warn("[sheets-polling] poll failed", err);
    }
  };

  poll();
  timer = window.setInterval(poll, intervalMs);
}

export function stopSheetsPolling(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  started = false;
}
