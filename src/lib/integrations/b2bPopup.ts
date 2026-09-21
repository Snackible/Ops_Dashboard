import { eventBus } from "../events";
import { getCurrentUser } from "../auth/authStore";
import { notificationStore } from "./notificationStore";
import type { ProductRequest, StockRequest } from "../types";

function notifyIfMine(accountId: string, kind: "success" | "danger" | "warning", title: string, body: string): void {
  const user = getCurrentUser();
  if (user?.role !== "b2b" || user.accountId !== accountId) return;
  notificationStore.push({ kind, title, body });
}

/** Subscriber #2 on the event bus: tells the requesting B2B account the moment Ops decides. */
export function registerB2BPopup(): void {
  eventBus.on("RequestApproved", ({ request }: { request: StockRequest }) => {
    notifyIfMine(request.accountId, "success", "Order approved", "Your committed order has been confirmed by Ops.");
  });

  eventBus.on("RequestDeclined", ({ request }: { request: StockRequest }) => {
    notifyIfMine(
      request.accountId,
      "danger",
      "Order declined",
      request.decisionNote ? `Reason: ${request.decisionNote}` : "Reserved stock has been released back."
    );
  });

  eventBus.on("ProductRequestDecided", ({ request }: { request: ProductRequest }) => {
    if (request.status === "accepted") {
      notifyIfMine(request.accountId, "success", "Request accepted", "Ops confirmed your product request.");
    } else if (request.status === "declined") {
      notifyIfMine(request.accountId, "danger", "Request declined", "Ops declined your product request.");
    } else if (request.status === "on_hold") {
      notifyIfMine(
        request.accountId,
        "warning",
        "Request on hold",
        request.holdUntil
          ? `Ops put this on hold until ${new Date(request.holdUntil).toLocaleDateString()}.`
          : "Ops put this on hold."
      );
    }
  });
}
