import { eventBus } from "../events";
import { sheetsDataClient } from "./sheetsDataClient";
import type { RequestStatus } from "../types";

/**
 * Sheets has no change feed, so this poller is what turns "someone else
 * changed a row" into the domain events every subscriber (Ops popup + sound,
 * B2B popup, and now each page's own refresh - see QueuePage/ProductRequestsPage/
 * MyRequestsPage) already listens on. It diffs each poll against the statuses
 * it saw last time and emits only on transitions.
 *
 * Requests (the Ops queue) and product requests poll on separate, independent
 * intervals - the queue is the actual "did a B2B account just push an order"
 * workflow and benefits from being fast, while product requests (accept/
 * decline/hold) are far less time-sensitive and can afford to be slow. Two
 * cheap, well-separated cadences stay comfortably under the Sheets API's
 * per-minute read quota in a way one fast shared interval couldn't.
 *
 * The first poll of each seeds the baseline without emitting, otherwise
 * every already-pending row would fire a "new" event on page load.
 */
let started = false;
let requestsTimer: number | undefined;
let productRequestsTimer: number | undefined;

export function startSheetsPolling(requestsIntervalMs = 6000, productRequestsIntervalMs = 25000): void {
  if (started) return;
  started = true;

  const lastSeen = new Map<string, RequestStatus>();
  let requestsSeeded = false;

  const pollRequests = async () => {
    try {
      const requests = await sheetsDataClient.getRequests();
      for (const request of requests) {
        const previous = lastSeen.get(request.requestId);
        lastSeen.set(request.requestId, request.status);
        if (!requestsSeeded || previous === request.status) continue;

        if (request.status === "pending") eventBus.emit("RequestSubmitted", { request });
        if (request.status === "approved") eventBus.emit("RequestApproved", { request });
        if (request.status === "declined") eventBus.emit("RequestDeclined", { request });
      }
      requestsSeeded = true;
    } catch (err) {
      // A failed poll is not worth surfacing - the next one will catch up.
      console.warn("[sheets-polling] requests poll failed", err);
    }
  };

  const lastSeenProductRequests = new Map<string, string>();
  let productRequestsSeeded = false;

  const pollProductRequests = async () => {
    try {
      const productRequests = await sheetsDataClient.getProductRequests();
      for (const request of productRequests) {
        const previous = lastSeenProductRequests.get(request.requestId);
        lastSeenProductRequests.set(request.requestId, request.status);
        if (!productRequestsSeeded || previous === request.status) continue;

        if (request.status === "pending") eventBus.emit("ProductRequestSubmitted", { request });
        else eventBus.emit("ProductRequestDecided", { request });
      }
      productRequestsSeeded = true;
    } catch (err) {
      console.warn("[sheets-polling] product requests poll failed", err);
    }
  };

  pollRequests();
  pollProductRequests();
  requestsTimer = window.setInterval(pollRequests, requestsIntervalMs);
  productRequestsTimer = window.setInterval(pollProductRequests, productRequestsIntervalMs);
}

export function stopSheetsPolling(): void {
  if (requestsTimer !== undefined) window.clearInterval(requestsTimer);
  if (productRequestsTimer !== undefined) window.clearInterval(productRequestsTimer);
  requestsTimer = undefined;
  productRequestsTimer = undefined;
  started = false;
}
